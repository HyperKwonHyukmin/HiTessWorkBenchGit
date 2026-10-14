r"""기존 사용자(users 테이블)에 사내 PLM(HIPLM.VT_PLM_USER) 메일 주소를 일괄 백필한다.

로그인 백필(auth.py) 과 관리자 수동 액션(users.py sync-email) 과 **같은 서비스**
(``services.plm_user_directory.fetch_plm_email``) 를 쓴다. 이미 메일이 저장된 사용자는
기본적으로 건너뛰고, 비어 있는 사용자만 조회해 채운다. 그 상태로도 다시 돌려 안전하다.

실행(HiTessWorkBenchBackEnd 에서):
    WorkBenchEnv\Scripts\python.exe scripts\backfill_user_emails.py --dry-run
    WorkBenchEnv\Scripts\python.exe scripts\backfill_user_emails.py
    WorkBenchEnv\Scripts\python.exe scripts\backfill_user_emails.py --employee-id A477273
    WorkBenchEnv\Scripts\python.exe scripts\backfill_user_emails.py --refresh-all   # 이미 저장된 값도 재조회

종료 코드:
    0 — PLM 조회 가능 상태로 실행 완료(갱신 0건이어도 성공)
    2 — PLM 미설정(.env 의 PLM_ORACLE_DSN/USER/PASSWORD 중 하나라도 비어 있음)
    3 — PLM 조회 시도 중 전부 실패(네트워크 끊김·드라이버 미설치 등). 로그 참고.
"""
import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app import database, models                                       # noqa: E402
from app.services.plm_user_directory import fetch_plm_email, is_configured  # noqa: E402


def _print_user_line(user, before: str | None, after: str | None, note: str = "") -> None:
    tag = note or ("새로 저장" if not before and after
                   else "갱신" if before and after and before != after
                   else "그대로" if before == after else "지움")
    print(f"  {user.employee_id:<10} {user.name or '-':<10} {before or '(없음)'} → {after or '(없음)'}  [{tag}]")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--employee-id",
        default=None,
        help="특정 사번 1건만 백필(대소문자 무시). 미지정이면 조건에 맞는 전체.",
    )
    parser.add_argument(
        "--refresh-all",
        action="store_true",
        help="이미 메일이 저장된 사용자도 재조회해서 바뀐 값이 있으면 덮어쓴다.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="DB 에 쓰지 않고 어떤 값으로 바뀔지 미리 보기만.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="PLM 쪽 상세 로그를 함께 출력.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )

    if not is_configured():
        print(
            "ERROR: PLM 조회가 비활성 상태입니다. 백엔드 .env 의 PLM_ORACLE_DSN/USER/PASSWORD "
            "세 값이 모두 지정됐는지 확인하세요.",
            file=sys.stderr,
        )
        return 2

    session = database.SessionLocal()
    try:
        query = session.query(models.User)
        if args.employee_id:
            target = args.employee_id.strip().upper()
            query = query.filter(models.User.employee_id == target)
        elif not args.refresh_all:
            # 기본값: 메일이 비어 있는 사용자만. --refresh-all 이면 전부.
            query = query.filter(
                (models.User.email.is_(None)) | (models.User.email == "")
            )
        users = query.order_by(models.User.employee_id.asc()).all()

        if not users:
            print("대상 사용자가 없습니다(이미 모두 채워져 있거나 조건에 맞는 행이 없음).")
            return 0

        header_hint = []
        if args.employee_id:
            header_hint.append(f"사번={args.employee_id.upper()}")
        header_hint.append("재조회(refresh-all)" if args.refresh_all else "메일 미기재자만")
        if args.dry_run:
            header_hint.append("dry-run")
        print(f"대상 {len(users)}명 — {' · '.join(header_hint)}")
        print()

        changed = 0
        unchanged = 0
        missing = 0  # PLM 에 사번이 없거나 메일 미등록
        errors = 0   # fetch 자체가 실패해 None 이 아닌 예외로 떨어진 적은 없지만, 집계 자리 보존.

        for user in users:
            before = user.email or None
            try:
                plm_email = fetch_plm_email(user.employee_id)
            except Exception as exc:  # pragma: no cover — fetch_plm_email 는 자체 예외 삼킴
                errors += 1
                print(f"  {user.employee_id:<10} ERROR: {exc}", file=sys.stderr)
                continue

            if plm_email is None:
                missing += 1
                _print_user_line(user, before, before, note="PLM 미등록/조회 실패")
                continue

            if before == plm_email:
                unchanged += 1
                _print_user_line(user, before, plm_email, note="그대로")
                continue

            if not args.dry_run:
                user.email = plm_email
            changed += 1
            _print_user_line(user, before, plm_email)

        if not args.dry_run and changed > 0:
            session.commit()
        elif args.dry_run:
            session.rollback()

        print()
        print(f"요약: 갱신 {changed}건 · 그대로 {unchanged}건 · PLM 미등록 {missing}건", end="")
        if errors:
            print(f" · 오류 {errors}건", end="")
        print(" · dry-run" if args.dry_run else "")

        if changed == 0 and missing == len(users):
            # 조회 자체가 다 미등록으로 떨어지면 PLM 접속이 사실상 안 되는 상태일 가능성.
            print(
                "WARNING: 조회 결과가 전부 미등록입니다. PLM 접속·네트워크를 확인하세요.",
                file=sys.stderr,
            )
            return 3
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
