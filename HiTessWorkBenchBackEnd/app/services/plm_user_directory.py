"""사내 PLM(Oracle `HIPLM.VT_PLM_USER`)에서 사번으로 메일 주소를 조회한다.

레거시 C# 유틸(`Postman_Console/Program.cs`)의 쿼리와 접속 규약을 그대로 옮긴 것이다.
WorkBench 사용자 가입/승인·관리자 수동 갱신·로그인 백필에서 호출한다.

설계 원칙
---------
- **가입을 막지 않는다**: Oracle 접속 실패·쿼리 실패·드라이버 미설치는 전부 조용히
  ``None`` 을 돌려주고 로그만 남긴다. PLM 이 다운돼도 WorkBench 가입/로그인이 계속
  돌아야 한다(사내망 접근 불가 개발 PC 포함).
- **접속정보는 .env**: 하드코딩 금지. ``PLM_ORACLE_DSN/USER/PASSWORD`` 미설정이면
  기능 비활성 상태로 간주해 조용히 ``None`` 반환.
- **드라이버는 선택 의존**: ``python-oracledb`` 가 없어도 서버 import 가 깨지지 않도록
  모듈 수준에서 import 하지 않고 호출 시점에 import 한다.

호출 규약은 ``fetch_plm_email(employee_id) -> Optional[str]`` 하나다. 전부 동기 호출이며
짧은 timeout 안에 끝나야 한다(가입/로그인 응답을 늦추면 안 된다).
"""
from __future__ import annotations

import logging
import os
import re
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# 사번 포맷(auth.py EMPLOYEE_ID_PATTERN 과 호환) — PLM 쿼리는 대문자 사번만 받는다.
_EMPLOYEE_ID_PATTERN = re.compile(r"^[A-Z]\d{5,7}$")
# 쿼리 timeout(초). 가입/로그인 응답을 가로채지 않도록 짧게 유지한다.
_CONNECT_TIMEOUT_SEC = 3.0
_QUERY_TIMEOUT_SEC = 3.0
# C# 레거시 쿼리와 동일 — VT_PLM_USER 는 PLM 뷰, USER_ID 는 대문자 사번.
_SQL = "SELECT EMAIL FROM VT_PLM_USER WHERE USER_ID = :user_id"


def _normalize_employee_id(employee_id: str | None) -> Optional[str]:
    if not employee_id:
        return None
    normalized = str(employee_id).strip().upper()
    if not _EMPLOYEE_ID_PATTERN.fullmatch(normalized):
        return None
    return normalized


def _plm_settings() -> Optional[dict]:
    """.env 에서 접속정보를 읽는다. 하나라도 비면 비활성(None)."""
    dsn = (os.getenv("PLM_ORACLE_DSN") or "").strip()
    user = (os.getenv("PLM_ORACLE_USER") or "").strip()
    password = os.getenv("PLM_ORACLE_PASSWORD") or ""
    if not dsn or not user or not password:
        return None
    return {"dsn": dsn, "user": user, "password": password}


def is_configured() -> bool:
    """PLM 접속정보가 .env 에 모두 지정됐는지 — 관리자 액션 가용성 판단용."""
    return _plm_settings() is not None


# thick mode 초기화 상태. 프로세스당 1회만 호출 가능하므로 플래그로 보호한다.
# 운영 서버의 Oracle 이 10G password verifier(0x939) 를 쓰면 thin mode 는 DPY-3015 로
# 인증을 못 하기 때문에 Oracle Client(OCI) 를 로드하는 thick mode 로 전환해야 한다.
# .env 에 PLM_ORACLE_LIB_DIR 가 있으면 thick, 없으면 thin(기본).
_thick_initialized = False


def _ensure_thick_mode() -> bool:
    """PLM_ORACLE_LIB_DIR 가 설정돼 있으면 OCI 를 로드해 thick mode 로 전환한다.

    반환값은 참고용(True=이번/이전 호출로 thick 활성, False=thin 유지 또는 실패).
    실패해도 예외는 던지지 않고 로그만 남긴다 — 어떤 상황에서도 가입/로그인을 가로채지 않는다.
    """
    global _thick_initialized
    if _thick_initialized:
        return False  # 이미 1회 시도했음. 재시도하지 않는다(oracledb 가 중복 호출을 거부).
    lib_dir = (os.getenv("PLM_ORACLE_LIB_DIR") or "").strip()
    if not lib_dir:
        _thick_initialized = True  # thin 유지. 다음 호출에선 다시 안 들어온다.
        return False
    try:
        import oracledb  # type: ignore[import-not-found]
        oracledb.init_oracle_client(lib_dir=lib_dir)
        _thick_initialized = True
        logger.info("PLM thick mode 활성화 (lib_dir=%s)", lib_dir)
        return True
    except Exception as exc:
        _thick_initialized = True  # 실패도 1회로 끝내 로그 소음 방지
        logger.warning(
            "PLM thick mode 초기화 실패 (lib_dir=%s): %s — thin mode 로 폴백합니다",
            lib_dir, exc,
        )
        return False


def _default_fetcher(employee_id: str) -> Optional[str]:
    """운영용 fetcher — python-oracledb thin mode 로 1건만 조회한다.

    드라이버가 설치돼 있지 않거나(ImportError), DSN 설정이 없거나, 접속·쿼리에서
    예외가 나면 로그만 남기고 ``None`` 을 반환한다. 호출자는 반환값만 보고 성공/실패를
    구분하면 된다.
    """
    settings = _plm_settings()
    if not settings:
        logger.debug("PLM 조회 비활성: PLM_ORACLE_DSN/USER/PASSWORD 미설정")
        return None

    try:
        import oracledb  # type: ignore[import-not-found]
    except Exception:
        logger.warning(
            "PLM 조회 비활성: python-oracledb 미설치 — "
            "requirements.txt 반영 후 pip install 필요"
        )
        return None

    # thick mode 가 필요한 환경이면 1회 로드. 설정이 없으면 조용히 thin 유지.
    _ensure_thick_mode()

    connection = None
    try:
        connection = oracledb.connect(
            user=settings["user"],
            password=settings["password"],
            dsn=settings["dsn"],
            tcp_connect_timeout=_CONNECT_TIMEOUT_SEC,
        )
        # 쿼리 중 네트워크가 끊어졌을 때 응답이 수십 초 블록되지 않도록 호출 단위 timeout.
        try:
            connection.call_timeout = int(_QUERY_TIMEOUT_SEC * 1000)
        except Exception:  # noqa: BLE001 — 드라이버 버전차에 유연
            pass
        with connection.cursor() as cursor:
            cursor.execute(_SQL, user_id=employee_id)
            row = cursor.fetchone()
    except Exception as exc:  # noqa: BLE001 — 외부 의존이라 어떤 예외든 삼킨다
        logger.warning("PLM 메일 조회 실패 (employee_id=%s): %s", employee_id, exc)
        return None
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass

    if not row or not row[0]:
        return None
    email = str(row[0]).strip()
    return email or None


# 테스트에서 교체 가능한 전역 fetcher. 운영은 _default_fetcher 가 Oracle 을 친다.
# 서비스 호출자(auth/users 라우터)는 ``fetch_plm_email`` 만 쓴다.
_fetcher: Callable[[str], Optional[str]] = _default_fetcher


def set_fetcher(fetcher: Callable[[str], Optional[str]] | None) -> None:
    """테스트에서 Oracle 접속을 모킹하기 위한 fetcher 교체 지점.

    ``None`` 을 전달하면 운영 기본 fetcher 로 복원한다.
    """
    global _fetcher
    _fetcher = fetcher or _default_fetcher


def fetch_plm_email(employee_id: str | None) -> Optional[str]:
    """사번으로 PLM 메일 주소를 조회한다. 어떤 실패에도 ``None`` 을 돌려준다."""
    normalized = _normalize_employee_id(employee_id)
    if not normalized:
        return None
    try:
        return _fetcher(normalized)
    except Exception as exc:  # noqa: BLE001 — fetcher 테스트 더블의 예외까지 삼킴
        logger.warning("PLM fetcher 예외 (employee_id=%s): %s", normalized, exc)
        return None
