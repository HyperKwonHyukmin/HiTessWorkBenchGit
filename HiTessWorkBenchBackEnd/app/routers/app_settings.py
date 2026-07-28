"""App별 관리자 설정 API.

앱 카탈로그의 원본은 프론트엔드 코드(ANALYSIS_DATA)다. 이 API 는 그 위에 덮는
오버라이드(서비스 상태·점검 안내·설명/태그/담당자)만 다룬다. 따라서:

  - 목록에는 오버라이드가 **있는** 앱만 나온다. 나머지는 코드 기본값이 그대로다.
  - 삭제(DELETE)는 곧 '코드 기본값으로 초기화'다.
  - 코드에 새 앱이 추가돼도 이 API 를 미리 손댈 필요가 없다.

읽기(GET /api/app-settings)는 모든 로그인 사용자에게 열려 있다. 프론트가 앱
목록을 그릴 때 필요하고, 여기 담긴 내용(상태·안내 문구)은 어차피 화면에 표시되는
값이기 때문이다. 쓰기는 관리자 전용이다.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import database, models, schemas
from ..dependencies import require_admin, require_auth
from ..services import app_settings as app_settings_service
from ..services.activity_service import log_activity

router = APIRouter(tags=["app-settings"])

MAX_APP_KEY_LEN = 200
MAX_TAGS = 12
MAX_TAG_LEN = 30


def _serialize(row: models.AppSetting) -> schemas.AppSettingResponse:
    return schemas.AppSettingResponse.model_validate(row)


@router.get("/api/app-settings", response_model=list[schemas.AppSettingResponse])
def list_effective_app_settings(
    db: Session = Depends(database.get_db),
    _: str = Depends(require_auth),
):
    """오버라이드가 설정된 App 목록. 프론트가 코드 기본값 위에 덮어 쓴다."""
    rows = (
        db.query(models.AppSetting)
        .order_by(models.AppSetting.app_key.asc())
        .all()
    )
    return [_serialize(row) for row in rows]


@router.get("/api/admin/app-settings", response_model=list[schemas.AppSettingResponse])
def list_app_settings_admin(
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    """관리 화면용 — 현재는 사용자용과 같은 내용이지만 권한 경계를 분리해 둔다."""
    rows = (
        db.query(models.AppSetting)
        .order_by(models.AppSetting.app_key.asc())
        .all()
    )
    return [_serialize(row) for row in rows]


def _normalize_app_key(app_key: str) -> str:
    key = (app_key or "").strip()
    if not key:
        raise HTTPException(status_code=422, detail="App key는 비워둘 수 없습니다.")
    if len(key) > MAX_APP_KEY_LEN:
        raise HTTPException(status_code=422, detail="App key가 너무 깁니다.")
    return key


def _clean_optional_text(value, *, max_len: int):
    """빈 문자열은 None(오버라이드 해제)으로 접는다."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:max_len]


def _clean_tags(value):
    if value is None:
        return None
    tags = [
        str(tag).strip()[:MAX_TAG_LEN]
        for tag in value
        if str(tag).strip()
    ]
    return tags[:MAX_TAGS] or None


def _validated_updates(payload: schemas.AppSettingUpdate) -> dict:
    """요청에 담긴 필드만 골라 정규화한다(명시적 null = 오버라이드 해제).

    ⚠ DB 세션을 건드리기 **전에** 호출해야 한다. 검증 실패 시 예외를 던지므로,
    행을 add() 한 뒤에 호출하면 실패한 요청이 세션에 유령 객체를 남긴다.
    """
    sent = payload.model_dump(exclude_unset=True)
    updates: dict = {}

    if "dev_status" in sent:
        dev_status = sent["dev_status"]
        if dev_status is not None:
            dev_status = str(dev_status).strip()
            if dev_status not in app_settings_service.VALID_DEV_STATUSES:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "허용되지 않는 상태입니다: "
                        f"{', '.join(app_settings_service.VALID_DEV_STATUSES)} 중 하나여야 합니다."
                    ),
                )
        updates["dev_status"] = dev_status

    if "maintenance" in sent:
        updates["maintenance"] = bool(sent["maintenance"])

    if "maintenance_message" in sent:
        updates["maintenance_message"] = _clean_optional_text(
            sent["maintenance_message"], max_len=500
        )

    if "description" in sent:
        updates["description"] = _clean_optional_text(sent["description"], max_len=1000)

    if "contributor" in sent:
        updates["contributor"] = _clean_optional_text(sent["contributor"], max_len=100)

    if "tags" in sent:
        updates["tags"] = _clean_tags(sent["tags"])

    return updates


@router.put(
    "/api/admin/app-settings/{app_key:path}",
    response_model=schemas.AppSettingResponse,
)
def upsert_app_setting(
    app_key: str,
    payload: schemas.AppSettingUpdate,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    """App 오버라이드를 생성하거나 부분 갱신한다.

    app_key 는 ANALYSIS_DATA 의 title 이며 한글·공백·'&' 를 포함할 수 있어
    ``{app_key:path}`` 로 받는다. 코드 카탈로그와의 대조는 하지 않는다 — 프론트에
    앱을 추가했는데 백엔드 목록이 낡아서 설정이 막히는 일을 피하기 위해서다.
    """
    key = _normalize_app_key(app_key)
    # 세션을 건드리기 전에 검증을 끝낸다.
    updates = _validated_updates(payload)

    row = (
        db.query(models.AppSetting)
        .filter(models.AppSetting.app_key == key)
        .first()
    )
    created = row is None
    if created:
        row = models.AppSetting(app_key=key, maintenance=False)
        db.add(row)

    for field, value in updates.items():
        setattr(row, field, value)
    row.updated_by = current_admin
    row.updated_at = datetime.now()

    db.commit()
    db.refresh(row)
    app_settings_service.invalidate_cache()

    log_activity(
        db,
        employee_id=current_admin,
        action_type="app_setting_created" if created else "app_setting_updated",
        action_detail={
            "app_key": key,
            "dev_status": row.dev_status,
            "maintenance": bool(row.maintenance),
        },
        status="success",
        ip_address=request.client.host if request.client else None,
    )
    return _serialize(row)


@router.delete("/api/admin/app-settings/{app_key:path}")
def delete_app_setting(
    app_key: str,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    """오버라이드를 지워 코드 기본값으로 되돌린다."""
    key = _normalize_app_key(app_key)
    row = (
        db.query(models.AppSetting)
        .filter(models.AppSetting.app_key == key)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="설정된 App이 아닙니다.")

    db.delete(row)
    db.commit()
    app_settings_service.invalidate_cache()

    log_activity(
        db,
        employee_id=current_admin,
        action_type="app_setting_reset",
        action_detail={"app_key": key},
        status="success",
        ip_address=request.client.host if request.client else None,
    )
    return {"ok": True, "app_key": key}
