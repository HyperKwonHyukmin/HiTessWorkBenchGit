r"""운영 서버(145)의 해석 오류 유형 기록을 개발 PC(70)로 가져오고, 대응 결과를 서버에 표시한다.

수집은 운영 서버에서 일어나고(services/nastran_diagnostics), 코드 수정·테스트는 개발 PC 에서 한다.
이 도구가 그 사이를 잇는다. 표준 라이브러리만 쓴다.

가져오기(미처리 new·regressed 유형 + 재현 자료 zip):
    WorkBenchEnv\Scripts\python.exe scripts\pull_diagnostics.py pull --employee <관리자 사번>
        → DataStorage/DiagnosticsPull/<날짜시각>/summary.md · signatures.json · <지문>/(재현 자료)

대응 결과 표시(코드로 막았으면 handled + 무엇으로 막았는지):
    WorkBenchEnv\Scripts\python.exe scripts\pull_diagnostics.py mark --employee <사번> \
        --fingerprint <지문> --status handled --note "bdf_deck_check.missing_begin_bulk (v1.6.3)"

⚠ 사번 로그인으로 토큰을 받는다(WorkBench 로그인과 같은 API). 로그아웃은 하지 않는다 — 로그아웃 API 는
  그 사번의 외부 앱 세션까지 끊기 때문이다. 토큰은 서버 세션 만료로 정리된다.
"""
import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SERVER = "http://10.14.42.145:9091"


class Client:
    def __init__(self, server: str, employee: str):
        self.server = server.rstrip("/")
        self.token = self._login(employee)

    def _request(self, method: str, path: str, body=None, raw=False):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.server + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if getattr(self, "token", None):
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                payload = res.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            raise SystemExit(f"{method} {path} 실패 — HTTP {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            raise SystemExit(f"{self.server} 에 연결하지 못했습니다: {e.reason}") from None
        return payload if raw else json.loads(payload.decode("utf-8"))

    def _login(self, employee: str) -> str:
        user = self._request("POST", "/api/login", {"employee_id": employee})
        if not user.get("is_admin"):
            raise SystemExit(f"{employee} 는 관리자가 아닙니다 — 오류 유형 기록은 관리자만 볼 수 있습니다.")
        return user["token"]

    def get(self, path: str, **params):
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return self._request("GET", path + (f"?{query}" if query else ""))

    def get_bytes(self, path: str) -> bytes:
        return self._request("GET", path, raw=True)

    def patch(self, path: str, body):
        return self._request("PATCH", path, body)


def pull(args) -> int:
    client = Client(args.server, args.employee)
    out = Path(args.out) if args.out else BACKEND_DIR / "DataStorage" / "DiagnosticsPull" / datetime.now().strftime("%Y%m%d_%H%M")
    out.mkdir(parents=True, exist_ok=True)

    items = client.get("/api/admin/diagnostics", status=args.status, level=args.level, limit=5000)["items"]
    (out / "signatures.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# 해석 오류 유형 — {args.server} ({datetime.now():%Y-%m-%d %H:%M})",
        "",
        f"조건: status={args.status or '전체'} · level={args.level or '전체'} · {len(items)}개 (발생 많은 순)",
        "",
        "| 횟수 | 등급 | 코드 | 상태 | App | 지문 | 대표 메시지 |",
        "|---:|---|---|---|---|---|---|",
    ]
    for it in sorted(items, key=lambda i: -i["occurrenceCount"]):
        msg = (it["template"] or "").replace("|", "/")[:120]
        lines.append(f"| {it['occurrenceCount']} | {it['level']} | {it['code'] or '-'} | {it['status']} | "
                     f"{', '.join(it['programs'])} | `{it['fingerprint']}` | {msg} |")
        if args.no_archives:
            continue
        sig_dir = out / it["fingerprint"]
        sig_dir.mkdir(exist_ok=True)
        detail = client.get(f"/api/admin/diagnostics/{it['fingerprint']}", limit=50)
        (sig_dir / "signature.json").write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8")
        if it.get("archiveDir"):
            blob = client.get_bytes(f"/api/admin/diagnostics/{it['fingerprint']}/archive")
            with zipfile.ZipFile(io.BytesIO(blob)) as zf:
                zf.extractall(sig_dir / "case")
    (out / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n저장: {out}")
    return 0


def mark(args) -> int:
    client = Client(args.server, args.employee)
    res = client.patch(f"/api/admin/diagnostics/{args.fingerprint}", {"status": args.status, "note": args.note})
    print(f"{res['fingerprint']} → {res['status']}  ({res.get('handledNote') or ''})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--server", default=os.environ.get("HITESS_DIAG_SERVER", DEFAULT_SERVER))
    parser.add_argument("--employee", required=True, help="관리자 사번(토큰 발급용)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_pull = sub.add_parser("pull", help="오류 유형·재현 자료 가져오기")
    p_pull.add_argument("--status", default="new,regressed", help="쉼표 구분. 빈 문자열이면 전체")
    p_pull.add_argument("--level", default=None, help="fatal,engine,warning 중 쉼표 구분")
    p_pull.add_argument("--out", default=None)
    p_pull.add_argument("--no-archives", action="store_true", help="목록만(재현 자료 zip 생략)")
    p_pull.set_defaults(func=pull)

    p_mark = sub.add_parser("mark", help="대응 결과 표시")
    p_mark.add_argument("--fingerprint", required=True)
    p_mark.add_argument("--status", required=True, choices=["new", "handled", "ignored"])
    p_mark.add_argument("--note", default=None)
    p_mark.set_defaults(func=mark)

    args = parser.parse_args()
    if getattr(args, "status", None) == "":
        args.status = None
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
