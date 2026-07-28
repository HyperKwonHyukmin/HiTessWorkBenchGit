"""App별 서비스 상태(설정) 조회와 백엔드 접근 게이트.

관리자가 App Settings 화면에서 앱을 '개발 중' 또는 '점검 중'으로 돌리면
프론트엔드가 진입을 막는다. 이 모듈은 **같은 판정을 백엔드에서도 강제**해
API 를 직접 호출하는 우회를 차단한다(프론트 차단만으로는 실질적 통제가 아님).

판정 규칙(관리자는 항상 통과 — 개발·점검 중인 앱을 확인해야 하므로):
  - maintenance=True            → 차단(관리자가 입력한 안내 문구를 그대로 전달)
  - dev_status in {Developing, Planned} → 차단
  - 그 외                        → 통과

설정의 원본 카탈로그는 프론트엔드 코드(ANALYSIS_DATA)이고 DB 는 오버라이드만
담기 때문에, 여기서도 '행이 없으면 통과'가 기본이다. 코드에 새 앱이 추가돼도
백엔드를 건드릴 필요가 없다(게이트를 걸려면 GUARDED_ROUTES 에만 등록).
"""
from __future__ import annotations

import threading
import time

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models

# 관리자가 지정할 수 있는 서비스 상태. 프론트 ANALYSIS_DATA 의 devStatus 와 동일한 어휘.
VALID_DEV_STATUSES = ("Active", "Developing", "Planned")

# 진입을 막는 상태 — 'Active' 만 일반 사용자에게 열려 있다.
BLOCKED_DEV_STATUSES = frozenset({"Developing", "Planned"})

DEFAULT_MAINTENANCE_MESSAGE = "현재 점검 중입니다. 잠시 후 다시 시도해주세요."
DEV_STATUS_BLOCK_MESSAGE = {
    "Developing": "이 앱은 현재 개발 진행 중으로 관리자만 사용할 수 있습니다.",
    "Planned": "이 앱은 출시 예정으로 아직 사용할 수 없습니다.",
}

# 요청 경로 → 앱 이름(ANALYSIS_DATA 의 title) 매핑.
#
# ⚠ 순서가 중요하다 — 먼저 일치하는 접두사가 이긴다. 더 긴/구체적인 경로를 위에 둘 것.
# 여기에 등록되지 않은 경로는 게이트를 통과한다(fail-open). 새 앱의 엔드포인트를
# 실제로 막으려면 이 표에 반드시 추가해야 한다.
GUARDED_ROUTES: tuple[tuple[str, str], ...] = (
    ("/api/analysis/truss/request", "Truss Model Builder"),
    ("/api/analysis/assessment/request", "Truss Structural Assessment"),
    ("/api/analysis/modelflow/", "HiTESS Model Builder"),
    ("/api/analysis/hpscr/", "HP-SCR 배관응력 해석"),
    ("/api/doublepipe/", "이중관 구조 연료배관 해석"),
    # GMU 는 세 갈래 엔드포인트(빌드·자세 안정성·단위 구조해석)를 함께 쓴다.
    ("/api/analysis/groupmoduleunit/", "Group & Module Unit 권상 구조 해석"),
    ("/api/analysis/module-stability/", "Group & Module Unit 권상 구조 해석"),
    ("/api/analysis/unit-structural/", "Group & Module Unit 권상 구조 해석"),
    ("/api/analysis/sidepassage/", "Side Passage Assessment"),
    ("/api/analysis/drawing-to-analysis/", "DrawingToAnalysis"),
    ("/api/analysis/mooring-fitting/", "Mooring Fitting Assessment"),
    ("/api/analysis/plate-structure/", "Plate Structure Analysis"),
    ("/api/analysis/bdfscanner/", "BDF Scanner"),
    ("/api/analysis/f06parser/", "F06 Parser"),
    ("/api/analysis/hullacceleration/", "선급 Rule 기반 선체 가속도 Calculation"),
    ("/api/analysis/beam/request", "Simple Beam Assessment"),
    ("/api/section-property/calculate", "Section Property Calculator"),
    ("/api/davit/mast-post", "Mast Post Assessment"),
    ("/api/davit/jib-rest-", "Jib Rest Assessment"),
    ("/api/column-buckling/", "Column Buckling Load Calculator"),
    ("/api/hole-calculation/", "Simplified Hole Fatigue Assessment"),
    ("/api/d-type-lug/", "D Type Lug Assessment"),
    # /free/report · /optimization/report 도 각 접두사에 함께 걸린다.
    ("/api/carling/free", "Carling Free Calculator"),
    ("/api/carling/optimization", "Carling Design Optimization"),
    # 외부 앱은 '실행 권한 발급(bootstrap)' 단계에서만 막는다. 프록시 자산 요청까지
    # 막으면 이미 열려 있는 화면이 중간에 깨진다.
    ("/external-apps/block-weld/__wb_bootstrap", "Block Weld Assessment"),
    ("/external-apps/independent-tank/__wb_bootstrap", "Independent Tank Assessment"),
)

# 게이트를 적용할 HTTP 메서드 — 작업을 새로 만드는 요청만 막는다.
# 진행 중 작업의 상태 폴링·결과 다운로드(GET)까지 막으면, 관리자가 스위치를 내리는
# 순간 이미 돌고 있던 남의 작업이 화면에서 끊긴다.
GUARDED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# 설정 캐시 TTL. 요청마다 DB 를 때리지 않으면서도, 관리자가 상태를 바꾸면
# (쓰기 시 invalidate + 이 TTL) 곧바로 반영된다.
_CACHE_TTL_SECONDS = 5.0

_cache_lock = threading.Lock()
_cache: dict[str, dict] | None = None
_cache_expires_at = 0.0


def _row_to_dict(row: models.AppSetting) -> dict:
    return {
        "app_key": row.app_key,
        "dev_status": row.dev_status,
        "maintenance": bool(row.maintenance),
        "maintenance_message": row.maintenance_message,
        "description": row.description,
        "tags": row.tags if isinstance(row.tags, list) else None,
        "contributor": row.contributor,
        "updated_by": row.updated_by,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def invalidate_cache() -> None:
    """설정 변경 직후 호출 — 다음 조회가 DB 를 다시 읽게 한다."""
    global _cache, _cache_expires_at
    with _cache_lock:
        _cache = None
        _cache_expires_at = 0.0


def load_settings(db: Session, *, use_cache: bool = True) -> dict[str, dict]:
    """app_key → 설정 dict 전체를 반환한다(TTL 캐시)."""
    global _cache, _cache_expires_at

    if use_cache:
        with _cache_lock:
            if _cache is not None and time.monotonic() < _cache_expires_at:
                return _cache

    rows = db.query(models.AppSetting).all()
    settings = {row.app_key: _row_to_dict(row) for row in rows}

    with _cache_lock:
        _cache = settings
        _cache_expires_at = time.monotonic() + _CACHE_TTL_SECONDS
    return settings


def resolve_app_key(path: str) -> str | None:
    """요청 경로에서 게이트 대상 앱 이름을 찾는다. 미등록 경로는 None."""
    for prefix, app_key in GUARDED_ROUTES:
        if path.startswith(prefix):
            return app_key
    return None


def block_reason(setting: dict | None) -> tuple[str, str] | None:
    """차단 사유를 (reason, message) 로 반환한다. 통과면 None.

    reason 은 프론트가 안내 UI 를 고르는 데 쓰는 코드값이다.
    """
    if not setting:
        return None

    if setting.get("maintenance"):
        message = (setting.get("maintenance_message") or "").strip()
        return "maintenance", message or DEFAULT_MAINTENANCE_MESSAGE

    dev_status = setting.get("dev_status")
    if dev_status in BLOCKED_DEV_STATUSES:
        return dev_status.lower(), DEV_STATUS_BLOCK_MESSAGE[dev_status]

    return None


def is_admin_user(db: Session, employee_id: str) -> bool:
    user = (
        db.query(models.User)
        .filter(models.User.employee_id == employee_id)
        .first()
    )
    return bool(user and user.is_admin)


def assert_app_available(app_key: str, employee_id: str, db: Session) -> None:
    """차단 상태의 앱이면 403. 관리자는 언제나 통과한다."""
    settings = load_settings(db)
    reason = block_reason(settings.get(app_key))
    if reason is None:
        return
    if is_admin_user(db, employee_id):
        return
    raise HTTPException(status_code=403, detail=reason[1])
