r"""userConnection 에 이미 쌓인 Model Builder 입력 CSV 를 DataStorage/ModelBuilderCsv 로 모은다.

대상: 이름이 HiTessModelBuilder·AmToModelBuilder 로 끝나는 작업 폴더의 맨 위 *.csv.
새 실행은 백엔드가 실행 때 바로 보관하므로(hitess_modelflow_service) 이 스크립트는 배포 직후 한 번이면 된다.
같은 내용은 한 번만 저장하고, 이미 적은 자리는 건너뛰므로 다시 돌려도 안전하다. 원본은 읽기만 한다.

실행(HiTessWorkBenchBackEnd 에서):
    WorkBenchEnv\Scripts\python.exe scripts\collect_mb_csv.py --dry-run   # 몇 개인지 세기만
    WorkBenchEnv\Scripts\python.exe scripts\collect_mb_csv.py             # 실제 수집
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.services import mb_csv_archive as arc  # noqa: E402

LABELS = {
    "stored": "새로 저장",
    "duplicate": "같은 내용 있음(기록만)",
    "same_name": "같은 파일명 있음 — 건너뜀(기록만)",
    "seen": "이미 수집함",
    "drm": "DRM 암호문 — 건너뜀",
    "missing": "파일 없음",
    "error": "오류",
    "found": "찾음",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="쓰지 않고 찾은 CSV 수만 출력")
    parser.add_argument("--source", default=None, help="userConnection 경로(기본 = 백엔드 userConnection)")
    parser.add_argument("--dest", default=None, help="보관 폴더(기본 = DataStorage/ModelBuilderCsv)")
    args = parser.parse_args()

    dest = os.path.abspath(args.dest) if args.dest else arc.archive_root()
    print(f"대상: {args.source or arc.USER_CONNECTION_DIR}")
    print(f"보관: {dest}{' (dry-run, 쓰지 않음)' if args.dry_run else ''}")
    counts = arc.collect_existing(args.source, root=dest, dry_run=args.dry_run)
    if not counts:
        print("MB 작업 폴더의 CSV 가 없습니다.")
        return 0
    for key, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {LABELS.get(key, key)}: {n}")
    if not args.dry_run:
        stored = sum(1 for p in Path(dest).rglob("*.csv") if p.name != arc.MANIFEST_NAME)
        print(f"보관 폴더의 CSV 파일 수(내용 기준): {stored}")
    return 1 if counts.get("error") else 0


if __name__ == "__main__":
    raise SystemExit(main())
