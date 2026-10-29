"""Studio 릴리스 표(HiTessWorkBenchBackEnd/app/studio_release.json) 갱신.

운영(145) 백엔드는 이 표에 적힌 버전의 Studio 만 내준다(viewers.py). 개발 PC(70)는 `.env` STUDIO_CHANNEL=dev 라
표와 무관하게 최고 버전을 쓴다. 그래서 UNC 에 올리기(배포)와 145 사용자에게 열기(릴리스)가 나뉜다.

  python scripts/studio_release.py --check                 # 표 ↔ UNC 최신 비교만
  python scripts/studio_release.py --all                   # 모든 Studio 를 UNC 최신으로 (/wb-release)
  python scripts/studio_release.py model-studio            # 한 Studio 만 최신으로 (/studio-release)
  python scripts/studio_release.py model-studio --version 0.0.118   # 지정 버전(롤백 포함)

기준은 UNC 의 정상 zip(루트 manifest.json) — 145 가 실제로 받을 수 있는 곳이다. 70 로컬에만 있는 버전은 쓰지 않는다.
마지막 줄 `CHANGED=<n>` (0 이면 표가 그대로).
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TABLE = os.path.join(ROOT, "HiTessWorkBenchBackEnd", "app", "studio_release.json")
LOCAL_DIR = os.path.join(ROOT, "HiTessWorkBenchBackEnd", "StudioProgram")
UNC_DIR = (
    r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44"
    r"\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram"
)
ZIP_RE = re.compile(r"^(?P<id>[a-z][a-z0-9-]*?)-(?P<ver>\d+(?:\.\d+)+)\.zip$", re.I)


def vkey(v: str) -> tuple[int, ...]:
    return tuple(int(n) for n in v.split("."))


def valid_zip(path: str) -> bool:
    try:
        with zipfile.ZipFile(path) as zf:
            return "manifest.json" in zf.namelist()
    except (zipfile.BadZipFile, OSError):
        return False


def scan(d: str) -> dict[str, list[str]]:
    """{viewer_id: [버전 …]} — 파일명 기준(무결성은 고를 때 본다)."""
    out: dict[str, list[str]] = {}
    for name in os.listdir(d):
        m = ZIP_RE.match(name)
        if m:
            out.setdefault(m["id"], []).append(m["ver"])
    for vs in out.values():
        vs.sort(key=vkey, reverse=True)
    return out


def latest_valid(viewer_id: str, versions: list[str]) -> str | None:
    for v in versions:
        if valid_zip(os.path.join(UNC_DIR, f"{viewer_id}-{v}.zip")):
            return v
        print(f"  ⚠ {viewer_id}-{v}.zip 이 깨져 있어 건너뜀(UNC)")
    return None


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Studio 릴리스 표 갱신")
    ap.add_argument("ids", nargs="*", help="올릴 viewer id (예: model-studio)")
    ap.add_argument("--all", action="store_true", help="UNC 의 모든 Studio 를 최신으로")
    ap.add_argument("--version", help="지정 버전(Studio 1개일 때만, 롤백 포함)")
    ap.add_argument("--check", action="store_true", help="비교만 하고 표는 고치지 않음")
    a = ap.parse_args()

    if not os.path.isdir(UNC_DIR):
        print(f"✗ UNC 폴더에 접근할 수 없습니다: {UNC_DIR}")
        return 2
    unc = scan(UNC_DIR)
    local = scan(LOCAL_DIR) if os.path.isdir(LOCAL_DIR) else {}

    table: dict = {"studios": {}}
    if os.path.isfile(TABLE):
        with open(TABLE, encoding="utf-8") as f:
            table = json.load(f)
    studios: dict[str, str] = dict(table.get("studios") or {})

    if a.check:
        targets = sorted(set(unc) | set(studios))
    elif a.all:
        targets = sorted(unc)
    else:
        targets = a.ids
    if not targets:
        print("✗ 올릴 Studio 를 적거나 --all / --check 를 쓰세요.")
        return 1
    if a.version and len(targets) != 1:
        print("✗ --version 은 Studio 하나에만 쓸 수 있습니다.")
        return 1

    changed = 0
    for vid in targets:
        cur = studios.get(vid)
        if vid not in unc:
            if not (a.check or a.all):
                # 직접 적은 id 가 없으면 오타일 가능성이 크다 — '이미 최신(CHANGED=0)' 으로 오인되지 않게 실패로.
                print(f"✗ {vid}: UNC 에 zip 이 없습니다(id 오타?). 있는 id: {', '.join(sorted(unc))}")
                return 1
            print(f"  {vid:<24} UNC 에 zip 없음 (표 {cur or '-'}) — 그대로")
            continue
        if a.version:
            want = a.version.strip()
            if want not in unc[vid] or not valid_zip(os.path.join(UNC_DIR, f"{vid}-{want}.zip")):
                print(f"✗ {vid}-{want}.zip 이 UNC 에 없거나 깨져 있습니다.")
                return 1
        else:
            want = latest_valid(vid, unc[vid])
            if not want:
                print(f"✗ {vid}: UNC 에 정상 zip 이 없습니다.")
                return 1
        note = "" if want in local.get(vid, []) else " (70 로컬 StudioProgram 에는 없음)"
        if a.check:
            mark = "같음" if cur == want else "릴리스 대기"
            print(f"  {vid:<24} 표 {cur or '-':<8} UNC 최신 {want:<8} {mark}")
            continue
        if cur == want:
            print(f"  {vid:<24} {want} 그대로")
            continue
        studios[vid] = want
        changed += 1
        print(f"  {vid:<24} {cur or '(없음)'} → {want}{note}")

    if changed and not a.check:
        table["studios"] = dict(sorted(studios.items()))
        table["updatedAt"] = dt.date.today().isoformat()
        with open(TABLE, "w", encoding="utf-8", newline="\n") as f:
            json.dump(table, f, ensure_ascii=False, indent=2)
            f.write("\n")
    print(f"CHANGED={changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
