r"""과거 해석의 오류·경고를 오류 유형 기록(diagnostic_signatures)에 소급 수집한다.

수집기(services/nastran_diagnostics)는 배포 이후 끝나는 작업만 잡는다. userConnection 에 아직 남아 있는
최근 30일치 F06·입력 BDF 는 곧 지워지므로, 배포 직후 한 번 돌려 그 사례를 살린다(처음 보는 유형이면
입력 BDF 를 DataStorage/DiagnosticsArchive 로 보관). 이미 수집한 작업은 건너뛰므로 다시 돌려도 안전하다.

실행(HiTessWorkBenchBackEnd 에서):
    WorkBenchEnv\Scripts\python.exe scripts\backfill_diagnostics.py --dry-run      # 쓰지 않고 집계만
    WorkBenchEnv\Scripts\python.exe scripts\backfill_diagnostics.py --days 30      # 실제 수집
"""
import argparse
import collections
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app import database, models                              # noqa: E402
from app.services import nastran_diagnostics as nd            # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=30, help="며칠 전 작업까지 볼지(기본 30 = userConnection 보관 기간)")
    parser.add_argument("--dry-run", action="store_true", help="DB·보관 폴더에 쓰지 않고 유형별 집계만 출력")
    args = parser.parse_args()

    models.Base.metadata.create_all(
        bind=database.engine,
        tables=[models.DiagnosticSignature.__table__, models.DiagnosticOccurrence.__table__],
    ) if not args.dry_run else None

    since = datetime.now() - timedelta(days=args.days)
    db = database.SessionLocal()
    rows = (
        db.query(models.Analysis)
        .filter(models.Analysis.created_at >= since, models.Analysis.job_id.isnot(None))
        .order_by(models.Analysis.created_at.asc())
        .all()
    )

    print(f"대상 작업 {len(rows)}건 (최근 {args.days}일, {'집계만' if args.dry_run else '수집'})")
    tally = collections.Counter()
    samples = {}
    programs = collections.defaultdict(set)
    done = new = 0
    for rec in rows:
        info = rec.result_info if isinstance(rec.result_info, dict) else {}
        engine_log = info.get("engineLog") or ""
        fallback = rec.job_message if (rec.status or "").lower() == "failed" else None
        if args.dry_run:
            events = nd.collect_events(rec, engine_log, nd.record_paths(db, rec), fallback, until=rec.updated_at)
            for ev in events:
                key = (ev["level"], ev["code"] or "-", ev["fingerprint"])
                tally[key] += 1
                samples.setdefault(key, ev["template"][:110])
                programs[key].add(rec.program_name)
            continue
        try:
            summary = nd.collect_job_diagnostics(rec.job_id, engine_log, fallback, until=rec.updated_at)
        except Exception as e:  # noqa: BLE001 — 한 건 실패로 전체를 멈추지 않는다
            print(f"  ! job={rec.job_id} 수집 실패: {e}")
            continue
        if summary.get("events"):
            done += 1
            new += summary.get("new") or 0

    db.close()
    if args.dry_run:
        print(f"오류 유형 {len(tally)}개")
        for (level, code, fp), n in tally.most_common():
            print(f"  {n:4d}  {level:7s} {code:5s} {fp}  [{', '.join(sorted(programs[(level, code, fp)]))}]  {samples[(level, code, fp)]}")
    else:
        print(f"진단이 있던 작업 {done}건, 새로 보관한 유형 {new}건 → {nd.ARCHIVE_ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
