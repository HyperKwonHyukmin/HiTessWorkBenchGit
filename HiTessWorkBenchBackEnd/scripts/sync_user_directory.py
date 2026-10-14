r"""사내 PLM(VT_PLM_USER) 기준으로 users 테이블 사용자 정보(이름·회사·부서·직책·메일)를 리프레시한다.

관리자 UI 의 'PLM 정보 갱신' 버튼·주기 스케줄러·이 CLI 가 모두 ``services.user_directory_sync``
의 같은 로직을 쓴다. 안전 규약: PLM 조회가 아예 실패하거나 특정 필드가 비어 있으면
그 필드는 **기존 DB 값을 그대로 유지**한다.

실행(HiTessWorkBenchBackEnd 에서):
    WorkBenchEnv\Scripts\python.exe scripts\sync_user_directory.py --dry-run
    WorkBenchEnv\Scripts\python.exe scripts\sync_user_directory.py
    WorkBenchEnv\Scripts\python.exe scripts\sync_user_directory.py --employee-id A477273

종료 코드:
    0 — 정상 종료(갱신 0건이어도 성공)
    2 — PLM 미설정(.env 의 PLM_ORACLE_DSN/USER/PASSWORD)
    3 — PLM 조회 결과가 전부 미등록(네트워크·인증 의심)
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app import database                                   # noqa: E402 — .env 로드 트리거
from app.services.plm_user_directory import is_configured  # noqa: E402
from app.services.user_directory_sync import sync_users    # noqa: E402


_FIELD_LABEL = {
    "email": "메일", "name": "이름", "company": "회사",
    "department": "부서", "position": "직책",
}


def _print_outcome(outcome) -> None:
    tag = {
        "updated": "갱신", "unchanged": "그대로",
        "missing": "PLM 미등록/조회 실패", "error": "오류",
    }.get(outcome.status, outcome.status)
    header = f"  {outcome.employee_id:<10} {outcome.name or '-':<10}"
    if outcome.status == "updated" and outcome.changes:
        parts = [
            f"{_FIELD_LABEL.get(k, k)}: {before or '(없음)'} → {after}"
            for k, (before, after) in outcome.changes.items()
        ]
        print(f"{header} [{tag}] " + " · ".join(parts))
    elif outcome.reason:
        print(f"{header} [{tag}] {outcome.reason}")
    else:
        print(f"{header} [{tag}]")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--employee-id", default=None, help="특정 사번 1건만 리프레시.")
    parser.add_argument("--dry-run", action="store_true", help="DB 에 쓰지 않고 미리 보기만.")
    args = parser.parse_args()

    if not is_configured():
        print(
            "ERROR: PLM 조회가 비활성 상태입니다. .env 의 "
            "PLM_ORACLE_DSN/USER/PASSWORD 세 값을 확인하세요.",
            file=sys.stderr,
        )
        return 2

    db = database.SessionLocal()
    try:
        employee_ids = [args.employee_id] if args.employee_id else None
        summary = sync_users(db, employee_ids=employee_ids, dry_run=args.dry_run)
    finally:
        db.close()

    if summary.total == 0:
        print("대상 사용자가 없습니다.")
        return 0

    hint = []
    if args.employee_id:
        hint.append(f"사번={args.employee_id.upper()}")
    else:
        hint.append("전체 사용자")
    if args.dry_run:
        hint.append("dry-run")
    print(f"대상 {summary.total}명 — {' · '.join(hint)}\n")

    for outcome in summary.outcomes:
        _print_outcome(outcome)

    tail = f"요약: 갱신 {summary.updated}건 · 그대로 {summary.unchanged}건 · PLM 미등록 {summary.missing}건"
    if summary.errors:
        tail += f" · 오류 {summary.errors}건"
    if args.dry_run:
        tail += " · dry-run"
    print()
    print(tail)

    if summary.updated == 0 and summary.missing == summary.total:
        print(
            "WARNING: 조회 결과가 전부 미등록입니다. PLM 접속·네트워크를 확인하세요.",
            file=sys.stderr,
        )
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
