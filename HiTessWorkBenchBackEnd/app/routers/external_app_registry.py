"""App Settings 에서 외부 앱을 등록·수정·삭제하는 API.

등록하면 곧바로 카탈로그 카드와 실행 입구(/external-apps/<slug> 프록시)가 생긴다 —
코드 수정·재시작·exe 재배포가 필요 없다. 쓰기는 관리자 전용이다(등록 앱 화면은
WorkBench 서버 주소에서 뜨므로 아무나 등록하게 두면 안 된다).
"""
from __future__ import annotations

from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import database, models, schemas
from ..dependencies import require_admin, require_auth
from ..services import app_settings as app_settings_service
from ..services import external_app_registry as registry
from ..services.activity_service import log_activity
from ..services.program_registry import resolve_program
from .external_apps import external_app_configs, registered_app_proxy_path

router = APIRouter(tags=["external-app-registry"])

PROBE_TIMEOUT_SECONDS = 4.0


def _public(data: dict) -> schemas.ExternalAppRegistrationPublic:
    return schemas.ExternalAppRegistrationPublic(
        **{key: data[key] for key in schemas.ExternalAppRegistrationPublic.model_fields if key in data},
        proxy_path=registered_app_proxy_path(data["slug"]),
    )


def _admin(data: dict) -> schemas.ExternalAppRegistrationAdmin:
    return schemas.ExternalAppRegistrationAdmin(
        **{key: data[key] for key in schemas.ExternalAppRegistrationAdmin.model_fields if key in data},
        proxy_path=registered_app_proxy_path(data["slug"]),
    )


def _clean_text(value, *, max_len: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:max_len] or None


def _validate_host_port(host, port) -> tuple[str, int]:
    host_text = str(host or "").strip()
    if not registry.is_private_ipv4(host_text):
        raise HTTPException(
            status_code=422,
            detail="IP는 사내 사설 대역(10.x · 172.16~31.x · 192.168.x)의 IPv4만 쓸 수 있습니다.",
        )
    if not app_settings_service.is_valid_external_port(port):
        raise HTTPException(status_code=422, detail="Port는 1~65535 사이의 숫자여야 합니다.")
    return host_text, port


def _validate_common(fields: dict) -> dict:
    """mode·category·art·dev_status·tags·description·contributor 를 정규화한다(있는 것만)."""
    cleaned: dict = {}
    if "mode" in fields:
        if fields["mode"] not in registry.VALID_MODES:
            raise HTTPException(
                status_code=422,
                detail=f"분류 화면(mode)은 {', '.join(registry.VALID_MODES)} 중 하나여야 합니다.",
            )
        cleaned["mode"] = fields["mode"]
    if "category" in fields:
        category = _clean_text(fields["category"], max_len=40)
        if not category:
            raise HTTPException(status_code=422, detail="분류를 입력하세요.")
        cleaned["category"] = category
    if "art" in fields:
        art = _clean_text(fields["art"], max_len=20)
        if art is not None and art not in registry.VALID_ART_NAMES:
            raise HTTPException(status_code=422, detail="지원하지 않는 카드 그림입니다.")
        cleaned["art"] = art
    if "dev_status" in fields:
        if fields["dev_status"] not in app_settings_service.VALID_DEV_STATUSES:
            raise HTTPException(status_code=422, detail="허용되지 않는 상태입니다.")
        cleaned["dev_status"] = fields["dev_status"]
    if "tags" in fields:
        cleaned["tags"] = registry.clean_tags(fields["tags"])
    if "description" in fields:
        cleaned["description"] = _clean_text(fields["description"], max_len=1000)
    if "contributor" in fields:
        cleaned["contributor"] = _clean_text(fields["contributor"], max_len=100)
    return cleaned


def _get_row_or_404(db: Session, slug: str) -> models.ExternalAppRegistration:
    row = (
        db.query(models.ExternalAppRegistration)
        .filter(models.ExternalAppRegistration.slug == slug)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="등록되지 않은 외부 앱입니다.")
    return row


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get(
    "/api/external-app-registry",
    response_model=list[schemas.ExternalAppRegistrationPublic],
)
def list_registered_apps(
    db: Session = Depends(database.get_db),
    _: str = Depends(require_auth),
):
    """카탈로그에 덧붙일 등록 외부 앱 목록(접속 주소 제외)."""
    return [_public(data) for data in registry.load_registrations(db).values()]


@router.get(
    "/api/admin/external-app-registry",
    response_model=list[schemas.ExternalAppRegistrationAdmin],
)
def list_registered_apps_admin(
    db: Session = Depends(database.get_db),
    _admin_id: str = Depends(require_admin),
):
    return [_admin(data) for data in registry.load_registrations(db, use_cache=False).values()]


@router.post(
    "/api/admin/external-app-registry",
    response_model=schemas.ExternalAppRegistrationAdmin,
    status_code=201,
)
def create_registered_app(
    payload: schemas.ExternalAppRegistrationCreate,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    slug = str(payload.slug or "").strip().lower()
    if not registry.SLUG_RE.fullmatch(slug):
        raise HTTPException(
            status_code=422,
            detail="주소 이름은 영문 소문자·숫자·하이픈 2~40자여야 합니다(하이픈으로 시작·끝 불가).",
        )
    if slug in registry.RESERVED_SLUGS:
        raise HTTPException(status_code=409, detail=f"'{slug}' 는 예약된 주소 이름입니다.")

    title = _clean_text(payload.title, max_len=200)
    if not title:
        raise HTTPException(status_code=422, detail="App 이름을 입력하세요.")
    # 코드 앱(해석 앱·코드 외부 앱)과 이름이 겹치면 설정·즐겨찾기·통계가 섞인다.
    if resolve_program(title) is not None or title in {c.app_key for c in external_app_configs()}:
        raise HTTPException(status_code=409, detail=f"'{title}' 는 이미 있는 App 이름입니다.")

    fields = _validate_common(payload.model_dump())
    host, port = _validate_host_port(payload.host, payload.port)

    duplicate = (
        db.query(models.ExternalAppRegistration)
        .filter(
            (models.ExternalAppRegistration.slug == slug)
            | (models.ExternalAppRegistration.title == title)
        )
        .first()
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="같은 주소 이름이나 App 이름이 이미 등록되어 있습니다.")

    row = models.ExternalAppRegistration(
        slug=slug,
        title=title,
        host=host,
        port=port,
        created_by=current_admin,
        updated_by=current_admin,
        **fields,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    registry.invalidate_cache()

    log_activity(
        db,
        employee_id=current_admin,
        action_type="external_app_registered",
        action_detail={"slug": slug, "title": title, "host": host, "port": port},
        status="success",
        ip_address=_client_ip(request),
    )
    return _admin(registry.row_to_dict(row))


@router.put(
    "/api/admin/external-app-registry/{slug}",
    response_model=schemas.ExternalAppRegistrationAdmin,
)
def update_registered_app(
    slug: str,
    payload: schemas.ExternalAppRegistrationUpdate,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    sent = payload.model_dump(exclude_unset=True)
    # 필수 칸에 null 을 보내면 지우는 게 아니라 잘못된 요청이다.
    for required in ("mode", "category", "dev_status", "host", "port"):
        if required in sent and sent[required] is None:
            raise HTTPException(status_code=422, detail=f"{required} 는 비울 수 없습니다.")
    fields = _validate_common(sent)

    row = _get_row_or_404(db, slug)
    if "host" in sent or "port" in sent:
        host, port = _validate_host_port(sent.get("host", row.host), sent.get("port", row.port))
        fields["host"] = host
        fields["port"] = port

    for field, value in fields.items():
        setattr(row, field, value)
    row.updated_by = current_admin
    row.updated_at = datetime.now()
    db.commit()
    db.refresh(row)
    registry.invalidate_cache()

    log_activity(
        db,
        employee_id=current_admin,
        action_type="external_app_updated",
        action_detail={"slug": slug, "fields": sorted(fields)},
        status="success",
        ip_address=_client_ip(request),
    )
    return _admin(registry.row_to_dict(row))


@router.delete("/api/admin/external-app-registry/{slug}")
def delete_registered_app(
    slug: str,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    """등록 앱과 그 App Settings 오버라이드를 함께 지운다(카드·입구가 사라진다)."""
    row = _get_row_or_404(db, slug)
    title = row.title
    db.query(models.AppSetting).filter(models.AppSetting.app_key == title).delete()
    db.delete(row)
    db.commit()
    registry.invalidate_cache()
    app_settings_service.invalidate_cache()

    log_activity(
        db,
        employee_id=current_admin,
        action_type="external_app_deleted",
        action_detail={"slug": slug, "title": title},
        status="success",
        ip_address=_client_ip(request),
    )
    return {"ok": True, "slug": slug}


class ProbeRequest(BaseModel):
    host: str
    port: int


@router.post("/api/admin/external-app-registry/probe")
async def probe_external_app(
    payload: ProbeRequest,
    _admin_id: str = Depends(require_admin),
):
    """등록 전에 그 주소에서 앱이 응답하는지 확인한다(관리자 전용)."""
    host, port = _validate_host_port(payload.host, payload.port)
    url = f"http://{host}:{port}/"
    try:
        async with httpx.AsyncClient(
            follow_redirects=False, timeout=httpx.Timeout(PROBE_TIMEOUT_SECONDS)
        ) as client:
            response = await client.get(url)
    except httpx.RequestError as exc:
        return {"ok": False, "url": url, "message": f"연결할 수 없습니다: {exc.__class__.__name__}"}
    ok = response.status_code < 500
    return {
        "ok": ok,
        "url": url,
        "status": response.status_code,
        "message": f"응답 {response.status_code}" if ok else f"서버 오류 {response.status_code}",
    }
