r"""운영/개발 MySQL 프로파일 측정 — dev 와 운영의 차이를 눈으로 확인한다.

계기: v1.5.8 에서 Analysis 모델에 컬럼 2개를 더하자 운영만 500
(`1038 Out of sort memory`). dev 는 같은 MySQL 8.0.44 · 기본 sort_buffer_size 로도
통과해, **왜 dev 에서 재현되지 않았는지 아직 isolate 되지 않았다.**
이 스크립트는 그 차이를 확정하기 위한 것이다(읽기 전용).

실행:
    WorkBenchEnv\Scripts\python.exe scripts\measure_mysql_profile.py

결과를 docs/operations/regression-prevention-master-plan.md §1.2 표에 기록한다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Windows 콘솔 기본 코덱은 cp949 라 '—' 같은 문자에서 UnicodeEncodeError 가 난다.
# 운영 서버(145)도 같은 환경이므로 출력 인코딩을 여기서 고정한다.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from sqlalchemy import text                                    # noqa: E402

from app import database                                       # noqa: E402

# 정렬·전송 한계에 직접 관여하는 변수만 본다.
VARIABLES = (
    "version",
    "sort_buffer_size",
    "max_sort_length",
    "max_allowed_packet",
    "tmp_table_size",
    "max_heap_table_size",
    "innodb_buffer_pool_size",
    "sql_mode",
    "character_set_server",
    "collation_server",
)


def main() -> int:
    with database.engine.connect() as conn:
        print("=" * 68)
        print("MySQL 서버 변수")
        print("=" * 68)
        for name in VARIABLES:
            row = conn.execute(text("SHOW VARIABLES LIKE :n"), {"n": name}).fetchone()
            print(f"  {name:26} = {row[1] if row else '(없음)'}")

        print()
        print("=" * 68)
        print("analysis 테이블 — 정렬 버퍼에 실리는 행 폭")
        print("=" * 68)
        # JSON 두 컬럼이 정렬 버퍼 사용량을 지배한다.
        stats = conn.execute(text(
            "SELECT COUNT(*),"
            "       AVG(LENGTH(CAST(input_info AS CHAR)) + LENGTH(CAST(result_info AS CHAR))),"
            "       MAX(LENGTH(CAST(input_info AS CHAR)) + LENGTH(CAST(result_info AS CHAR)))"
            "  FROM analysis"
        )).fetchone()
        count, avg_bytes, max_bytes = stats
        print(f"  {'행 수':26} = {count}")
        print(f"  {'JSON 평균 byte':26} = {float(avg_bytes or 0):.0f}")
        print(f"  {'JSON 최대 byte':26} = {max_bytes or 0}")

        widest = conn.execute(text(
            "SELECT id, program_name,"
            "       LENGTH(CAST(input_info AS CHAR)) + LENGTH(CAST(result_info AS CHAR)) AS w"
            "  FROM analysis ORDER BY w DESC LIMIT 5"
        )).fetchall()
        print("  가장 넓은 행 5건 (id / program / byte):")
        for row in widest:
            print(f"    - {row[0]:>8}  {str(row[1])[:34]:34} {row[2]}")

        print()
        print("=" * 68)
        print("created_at 인덱스 (filesort 회피 여부)")
        print("=" * 68)
        idx = conn.execute(text("SHOW INDEX FROM analysis")).fetchall()
        names = sorted({r[2] for r in idx})
        print(f"  인덱스 목록: {', '.join(names)}")
        print(f"  ix_analysis_created_at: {'있음' if 'ix_analysis_created_at' in names else '**없음 — 백엔드 재시작 필요**'}")

        print()
        print("=" * 68)
        print("목록 쿼리 실행 계획 (Using filesort 가 없어야 한다)")
        print("=" * 68)
        plan = conn.execute(text(
            "EXPLAIN SELECT id FROM analysis"
            " WHERE source <> 'WorkbenchSample'"
            " ORDER BY created_at DESC, id DESC LIMIT 25"
        )).fetchall()
        keys = plan[0]._mapping.keys() if plan else []
        for row in plan:
            m = row._mapping
            print("  " + " | ".join(f"{k}={m[k]}" for k in keys if m[k] is not None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
