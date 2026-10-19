r"""PLM(HIPLM)에서 호선(선박) 정보가 들어 있는 테이블/뷰를 찾는 1회성 조사 스크립트.

호선 조회 기능을 만들기 전에 '어느 테이블에 무엇이 있는지'와 'caduser 가 읽을 수 있는지'를
확인하려는 용도다. DB 를 수정하지 않는다(SELECT 만). 접속 설정·thick 초기화는
plm_user_directory 서비스를 그대로 재사용한다.

실행(HiTessWorkBenchBackEnd 에서, 145 서버):
    # 1단계 — 이름/컬럼에 키워드가 들어간 테이블·뷰·시노님 찾기 (기본 키워드: HULL SHIP PROJ VESSEL)
    WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_hull_tables.py
    WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_hull_tables.py --keywords HULL 호선

    # 2단계 — 후보 테이블의 컬럼 목록 + 샘플 행 보기
    WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_hull_tables.py --table VT_PLM_HULL
    WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_hull_tables.py --table PLM.TB_HULL_OUTFIT_UPDATE --rows 5

    # 3단계 — 특정 호선 번호로 행 찾기
    WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_hull_tables.py --table VT_PLM_HULL --column HULL_NO --value 3370

    # 4단계 — 한 컬럼에 어떤 값이 몇 건씩 있는지(값 형식 조사용)
    WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_hull_tables.py --table VT_PLM_SHIP --distinct SHIP_TYPE_NAME

    # 결과를 파일로도 남기기(서버 콘솔 복사가 불편할 때)
    ... --out plm_hull_scan.txt

종료 코드:
    0 — 조사 성공
    2 — .env 미설정 또는 oracledb 미설치
    3 — PLM 접속·쿼리 실패
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# plm_user_directory 는 .env 를 자체 로드하지 않으므로 여기서 명시적으로 로드한다.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.services.plm_user_directory import (  # noqa: E402
    _plm_settings, _ensure_thick_mode, is_configured,
)

DEFAULT_KEYWORDS = ["HULL", "SHIP", "PROJ", "VESSEL"]
# 테이블명은 바인드 변수로 못 넣어 문자열로 삽입한다 — 식별자 형식만 허용해 엉뚱한 SQL 을 막는다.
_IDENT = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]*(\.[A-Za-z][A-Za-z0-9_$#]*)?$")
# 오라클 시스템 스키마는 후보에서 뺀다(이름에 PROJ 등이 들어간 내부 객체가 많다).
_SYSTEM_OWNERS = (
    "SYS", "SYSTEM", "XDB", "MDSYS", "CTXSYS", "ORDSYS", "OLAPSYS", "WMSYS",
    "EXFSYS", "DBSNMP", "APEX_030200", "APEX_040200", "FLOWS_FILES", "OUTLN",
    "ORDDATA", "SYSMAN", "LBACSYS", "DVSYS", "AUDSYS", "GSMADMIN_INTERNAL",
)

_out_file = None


def emit(text: str = "") -> None:
    print(text)
    if _out_file is not None:
        _out_file.write(text + "\n")


def _owner_filter_sql(col: str) -> str:
    return f"{col} NOT IN (" + ", ".join(f"'{o}'" for o in _SYSTEM_OWNERS) + ")"


def _display(val):
    # LOB 은 커넥션 닫기 전에 read() 로 꺼내야 한다. 너무 긴 값은 잘라 보여 준다.
    if hasattr(val, "read"):
        try:
            val = val.read()
        except Exception:
            return f"<LOB: {type(val).__name__}>"
    text = repr(val)
    return text if len(text) <= 120 else text[:117] + "..."


def search_objects(conn, keywords: list[str], limit: int) -> None:
    """1단계: 객체 이름 / 컬럼 이름에 키워드가 들어간 것을 모두 찾는다."""
    for kw in keywords:
        pattern = f"%{kw.upper()}%"

        emit(f"\n== 이름에 '{kw}' 가 들어간 테이블·뷰·시노님 (caduser 가 볼 수 있는 것) ==")
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT owner, object_name, object_type
                FROM all_objects
                WHERE object_type IN ('TABLE', 'VIEW', 'SYNONYM', 'MATERIALIZED VIEW')
                  AND UPPER(object_name) LIKE :pat
                  AND {_owner_filter_sql('owner')}
                ORDER BY owner, object_name
                """,
                pat=pattern,
            )
            rows = cur.fetchmany(limit)
        if not rows:
            emit("  (없음)")
        for owner, name, otype in rows:
            emit(f"  {otype:<18} {owner}.{name}")
        if len(rows) == limit:
            emit(f"  ... (상위 {limit}건까지만 표시, --limit 로 늘릴 수 있음)")

        emit(f"\n== 컬럼 이름에 '{kw}' 가 들어간 테이블·뷰 ==")
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT owner, table_name, column_name, data_type
                FROM all_tab_columns
                WHERE UPPER(column_name) LIKE :pat
                  AND {_owner_filter_sql('owner')}
                ORDER BY owner, table_name, column_id
                """,
                pat=pattern,
            )
            rows = cur.fetchmany(limit)
        if not rows:
            emit("  (없음)")
        for owner, table, column, dtype in rows:
            emit(f"  {owner}.{table:<40} {column:<30} {dtype}")
        if len(rows) == limit:
            emit(f"  ... (상위 {limit}건까지만 표시, --limit 로 늘릴 수 있음)")


def _resolve_table(conn, table: str) -> tuple[str | None, str]:
    """'OWNER.NAME' 또는 'NAME' → (owner, name). 시노님이면 실제 대상 테이블로 풀어 준다."""
    if "." in table:
        owner, name = table.upper().split(".", 1)
    else:
        owner, name = None, table.upper()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_owner, table_name FROM all_synonyms
            WHERE synonym_name = :name AND (:owner IS NULL OR owner = :owner)
            ORDER BY CASE owner WHEN 'PUBLIC' THEN 1 ELSE 0 END
            """,
            name=name, owner=owner,
        )
        syn = cur.fetchone()
    if syn:
        emit(f"  (시노님 → 실제 대상 {syn[0]}.{syn[1]})")
        return syn[0], syn[1]
    return owner, name


def describe_table(conn, table: str, rows: int, column: str | None, value: str | None) -> None:
    """2·3단계: 컬럼 목록 + 샘플 행(또는 특정 값으로 찾은 행)."""
    emit(f"\n== {table} 컬럼 목록 ==")
    owner, name = _resolve_table(conn, table)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT owner, column_name, data_type, data_length, nullable
            FROM all_tab_columns
            WHERE table_name = :name AND (:owner IS NULL OR owner = :owner)
            ORDER BY owner, column_id
            """,
            name=name, owner=owner,
        )
        cols = cur.fetchall()
    if not cols:
        emit(f"  (컬럼이 조회되지 않습니다. 이름 '{table}' 또는 읽기 권한을 확인하세요.)")
    else:
        emit(f"  {'OWNER':<14} {'COLUMN_NAME':<30} {'DATA_TYPE':<15} {'LEN':>6}  NULL?")
        for c_owner, c_name, dtype, length, nullable in cols:
            emit(f"  {c_owner:<14} {c_name:<30} {dtype:<15} {str(length or '-'):>6}  {nullable}")
        emit(f"\n  총 {len(cols)}개 컬럼")

    # 샘플 행 — 입력한 이름 그대로 SELECT 해 본다(시노님이면 시노님으로 읽힌다 = 실제 쓸 이름).
    if column and value is not None:
        if not _IDENT.match(column):
            emit(f"  ERROR: 컬럼 이름 형식이 아닙니다: {column}")
            return
        sql = f"SELECT * FROM {table} WHERE TO_CHAR({column}) LIKE :val AND ROWNUM <= :n"
        binds = {"val": f"%{value}%", "n": rows}
        emit(f"\n== {table} 에서 {column} LIKE '%{value}%' (최대 {rows}행) ==")
    else:
        sql = f"SELECT * FROM {table} WHERE ROWNUM <= :n"
        binds = {"n": rows}
        emit(f"\n== {table} 샘플 {rows}행 ==")

    with conn.cursor() as cur:
        cur.execute(sql, **binds)
        names = [d[0] for d in cur.description]
        data = cur.fetchall()
        if not data:
            emit("  (행 없음)")
            return
        width = max(len(n) for n in names)
        for i, row in enumerate(data, 1):
            emit(f"  --- 행 {i} ---")
            for col, val in zip(names, row):
                emit(f"  {col:<{width}} = {_display(val)}")

    # 전체 행 수 — 큰 테이블이면 시간이 걸릴 수 있어 마지막에 센다.
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            emit(f"\n  전체 행 수: {cur.fetchone()[0]:,}")
    except Exception as exc:
        emit(f"\n  전체 행 수 조회 실패: {exc}")


def distinct_values(conn, table: str, column: str, limit: int) -> None:
    """4단계: 한 컬럼의 서로 다른 값과 건수를 많은 순으로 보여 준다."""
    if not _IDENT.match(column):
        emit(f"  ERROR: 컬럼 이름 형식이 아닙니다: {column}")
        return
    emit(f"\n== {table}.{column} 값 분포 (많은 순, 최대 {limit}종) ==")
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {column}, COUNT(*) AS n FROM {table} "
            f"GROUP BY {column} ORDER BY n DESC, {column}"
        )
        rows = cur.fetchall()
    for value, n in rows[:limit]:
        emit(f"  {n:>6}  {value!r}")
    emit(f"\n  서로 다른 값 {len(rows)}종 (표시 {min(len(rows), limit)}종)")


def main() -> int:
    global _out_file
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--keywords", nargs="+", default=DEFAULT_KEYWORDS,
                        help="1단계 검색 키워드(기본: HULL SHIP PROJ VESSEL)")
    parser.add_argument("--table", default=None,
                        help="2단계: 자세히 볼 테이블/뷰/시노님 이름 (OWNER.NAME 가능)")
    parser.add_argument("--rows", type=int, default=3, help="샘플 행 수(기본 3)")
    parser.add_argument("--column", default=None, help="3단계: 값으로 찾을 컬럼(예: HULL_NO)")
    parser.add_argument("--value", default=None, help="3단계: 찾을 값(부분 일치, 예: 3370)")
    parser.add_argument("--distinct", default=None,
                        help="4단계: --table 의 이 컬럼 값 분포(값별 건수)를 보여 준다")
    parser.add_argument("--limit", type=int, default=200,
                        help="1단계 키워드당 / 4단계 최대 표시 건수")
    parser.add_argument("--out", default=None, help="결과를 이 파일에도 저장")
    args = parser.parse_args()

    if args.table and not _IDENT.match(args.table):
        print(f"ERROR: 테이블 이름 형식이 아닙니다: {args.table}", file=sys.stderr)
        return 2
    if (args.column is None) != (args.value is None):
        print("ERROR: --column 과 --value 는 함께 지정하세요.", file=sys.stderr)
        return 2

    if not is_configured():
        print("ERROR: PLM 조회 비활성 — .env 의 PLM_ORACLE_DSN/USER/PASSWORD 를 확인하세요.",
              file=sys.stderr)
        return 2
    try:
        import oracledb  # type: ignore[import-not-found]
    except Exception:
        print("ERROR: python-oracledb 미설치. 'pip install -r requirements.txt' 실행하세요.",
              file=sys.stderr)
        return 2

    _ensure_thick_mode()
    settings = _plm_settings()
    try:
        conn = oracledb.connect(
            user=settings["user"], password=settings["password"],
            dsn=settings["dsn"], tcp_connect_timeout=5,
        )
    except Exception as exc:
        print(f"ERROR: PLM 접속 실패: {exc}", file=sys.stderr)
        return 3

    if args.out:
        _out_file = open(args.out, "w", encoding="utf-8")
    try:
        emit(f"PLM 접속 성공 (dsn={settings['dsn']}, user={settings['user']}, "
             f"mode={'thin' if oracledb.is_thin_mode() else 'thick'})")
        if args.table and args.distinct:
            distinct_values(conn, args.table, args.distinct, args.limit)
        elif args.table:
            describe_table(conn, args.table, args.rows, args.column, args.value)
        else:
            search_objects(conn, args.keywords, args.limit)
            emit("\n다음 단계: 후보를 골라 --table <이름> 으로 컬럼과 샘플 행을 확인하세요.")
        return 0
    except Exception as exc:
        print(f"ERROR: 조사 쿼리 실패: {exc}", file=sys.stderr)
        return 3
    finally:
        try:
            conn.close()
        except Exception:
            pass
        if _out_file is not None:
            _out_file.close()
            print(f"\n결과 저장: {Path(args.out).resolve()}")


if __name__ == "__main__":
    raise SystemExit(main())
