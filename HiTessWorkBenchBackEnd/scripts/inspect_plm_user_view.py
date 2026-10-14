r"""VT_PLM_USER 뷰의 컬럼 목록을 조사하고, 선택적으로 사번 1건 샘플을 보여준다.

PLM 데이터를 어떻게 더 쓸지 결정하기 전 '뭐가 들어있는지' 확인하는 1회성 조사용.
DB 를 수정하지 않는다(SELECT 만). plm_user_directory 서비스의 접속 설정·thick 초기화를
그대로 재사용한다.

실행(HiTessWorkBenchBackEnd 에서):
    WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_user_view.py
    WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_user_view.py --employee-id A477273
    WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_user_view.py --table VT_OTHER

종료 코드:
    0 — 조사 성공
    2 — .env 미설정 또는 oracledb 미설치
    3 — PLM 접속·쿼리 실패
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# plm_user_directory 는 os.getenv 만 쓰고 .env 를 자체 로드하지 않는다.
# backfill_user_emails.py 는 app.database import 로 .env 가 함께 로드됐지만,
# 이 조사 스크립트는 database 를 쓰지 않으므로 여기서 명시적으로 로드한다.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.services.plm_user_directory import (  # noqa: E402
    _plm_settings, _ensure_thick_mode, is_configured,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--employee-id",
        default=None,
        help="샘플 1행을 출력할 사번. 미지정 시 메타데이터(컬럼 목록)만.",
    )
    parser.add_argument(
        "--table",
        default="VT_PLM_USER",
        help="조사할 테이블/뷰 이름. 기본 VT_PLM_USER.",
    )
    args = parser.parse_args()

    if not is_configured():
        print(
            "ERROR: PLM 조회가 비활성 상태입니다. .env 의 "
            "PLM_ORACLE_DSN/USER/PASSWORD 세 값을 확인하세요.",
            file=sys.stderr,
        )
        return 2

    try:
        import oracledb  # type: ignore[import-not-found]
    except Exception:
        print(
            "ERROR: python-oracledb 미설치. 'pip install -r requirements.txt' 실행하세요.",
            file=sys.stderr,
        )
        return 2

    _ensure_thick_mode()

    settings = _plm_settings()
    try:
        conn = oracledb.connect(
            user=settings["user"],
            password=settings["password"],
            dsn=settings["dsn"],
            tcp_connect_timeout=5,
        )
    except Exception as exc:
        print(f"ERROR: PLM 접속 실패: {exc}", file=sys.stderr)
        return 3

    try:
        # 1) 컬럼 메타데이터
        print(f"== {args.table} 컬럼 목록 ==")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name, data_type, data_length, nullable
                FROM all_tab_columns
                WHERE table_name = :tbl
                ORDER BY column_id
                """,
                tbl=args.table.upper(),
            )
            rows = cur.fetchall()
            if not rows:
                print(f"  (컬럼이 조회되지 않습니다. 뷰 이름 '{args.table}' 을 확인하세요.)")
            else:
                print(f"  {'COLUMN_NAME':<30} {'DATA_TYPE':<15} {'LEN':>6}  NULL?")
                print(f"  {'-'*30} {'-'*15} {'-'*6}  -----")
                for name, dtype, length, nullable in rows:
                    print(f"  {name:<30} {dtype:<15} {str(length or '-'):>6}  {nullable}")
                print(f"\n  총 {len(rows)}개 컬럼")

        # 2) 샘플 1행
        if args.employee_id:
            eid = args.employee_id.strip().upper()
            print(f"\n== {args.table} 샘플 (USER_ID='{eid}') ==")
            with conn.cursor() as cur:
                # 식별자(테이블명)는 바인드 변수로 못 넣는다. --table 은 CLI 로컬 입력이라 그대로 삽입.
                # 바인드 변수명으로 :uid 는 쓸 수 없다 — Oracle 내장 함수 UID 와 충돌해 ORA-01745 가 난다.
                cur.execute(
                    f"SELECT * FROM {args.table} WHERE USER_ID = :empid",
                    empid=eid,
                )
                row = cur.fetchone()
                if not row:
                    print(f"  (사번 {eid} 는 {args.table} 에 없습니다)")
                else:
                    cols = [d[0] for d in cur.description]
                    width = max(len(c) for c in cols)
                    for col, val in zip(cols, row):
                        # LOB(CLOB/BLOB) 는 커넥션 닫기 전에 .read() 로 꺼내야 한다.
                        display = val
                        if hasattr(val, "read"):
                            try:
                                display = val.read()
                            except Exception:
                                display = f"<LOB: {type(val).__name__}>"
                        print(f"  {col:<{width}} = {display!r}")

        return 0
    except Exception as exc:
        print(f"ERROR: 조사 쿼리 실패: {exc}", file=sys.stderr)
        return 3
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
