"""선별형 BDF Model Registry API.

권한 모델:
    쓰기(preview/register/patch/archive) = 관리자 전용 (require_admin)
    읽기(list/detail/download)           = 인증된 전 사용자 + visibility ACL

등록이 관리자 전용인 이유는 이 저장소가 '큐레이션된 기준 모델 라이브러리'이기 때문이다.
관리자는 타인의 Analysis 도 등록할 수 있고, 그때 owner_id 에는 원 해석 수행자가 남는다.
"""
from __future__ import annotations

import hashlib
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_admin, require_auth
from ..model_registry_schemas import (
    SUMMARY_SCHEMA_VERSION,
    ArtifactResponse,
    DuplicateInfo,
    ModelDetailResponse,
    ModelListItem,
    ModelListResponse,
    ModelPatchRequest,
    PreviewRequest,
    PreviewResponse,
    RegisterRequest,
    RegisterResponse,
    RevisionResponse,
    SourceInfo,
)
from ._access_control import is_admin_user
from ..services.activity_service import log_activity
from ..services.model_family import derive_model_family
from ..services.model_registry_service import (
    RegistrationError,
    SourceResolutionError,
    available_artifacts,
    can_read,
    find_duplicate,
    register_model,
    resolve_source,
    visible_models_query,
)
from ..services.model_geometry_service import (
    GeometryUnavailable,
    load_preview_geometry,
)
from ..services.model_insight_service import (
    build_export_rows,
    build_scoped_overview,
)
from ..services.model_search_service import (
    CANDIDATE_SCALE_BAND as SIMILAR_SCALE_BAND,
    DEFAULT_LIMIT as SIMILAR_DEFAULT_LIMIT,
    find_similar,
)
from ..services.model_registry_storage import (
    RegistryStorageError,
    absolute_path,
    resolve_registry_root,
)
from ..services.model_summary_service import SummaryExtractionError, summarize_resolved_source

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/model-registry", tags=["model-registry"])

# PATCH 로 바꿀 수 있는 필드 — 이 목록 밖의 키는 무시한다.
PATCHABLE_FIELDS = {
    "title", "description", "model_type", "model_role", "confidence",
    "reuse_notes", "visibility", "tags", "review_status",
}


def _sha256_of_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _http(exc) -> HTTPException:
    """도메인 오류를 HTTP 로 변환한다. code 를 응답에 실어 프론트가 분기할 수 있게 한다."""
    detail = {"code": getattr(exc, "code", "ERROR"), "message": str(exc)}
    detail.update(getattr(exc, "extra", None) or {})
    return HTTPException(status_code=getattr(exc, "status_code", 400), detail=detail)


def _latest_revision(db: Session, model_id: int):
    return (
        db.query(models.RegisteredModelRevision)
        .filter(models.RegisteredModelRevision.model_id == model_id)
        .order_by(models.RegisteredModelRevision.revision_no.desc())
        .first()
    )


def _to_list_item(model: models.RegisteredModel, rev) -> ModelListItem:
    return ModelListItem(
        model_uid=model.model_uid,
        title=model.title,
        model_type=model.model_type,
        model_role=model.model_role,
        confidence=model.confidence,
        visibility=model.visibility,
        tags=model.tags,
        owner_id=model.owner_id,
        registered_by=model.registered_by,
        status=model.status,
        created_at=model.created_at,
        updated_at=model.updated_at,
        latest_revision=rev.revision_no if rev else None,
        quality_level=rev.quality_level if rev else None,
        review_status=rev.review_status if rev else None,
        design_outcome=rev.design_outcome if rev else None,
        source_program_name=rev.source_program_name if rev else None,
        node_count=rev.node_count if rev else None,
        element_count=rev.element_count if rev else None,
        total_mass_kg=rev.total_mass_kg if rev else None,
        max_utilization=rev.max_utilization if rev else None,
    )


# --------------------------------------------------------------------------- #
# 쓰기 — 관리자 전용
# --------------------------------------------------------------------------- #

@router.post("/preview", response_model=PreviewResponse)
def preview_registration(
    payload: PreviewRequest,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_admin),
):
    """등록 전 미리보기. **DB 와 저장소를 절대 변경하지 않는다.**

    summary 계산에 엔진 폴백이 필요한 경우에도 임시 폴더에서 돌려
    원본 작업 폴더(userConnection)를 오염시키지 않는다.
    """
    try:
        resolved = resolve_source(db, payload.source_analysis_id, payload.artifact_kind)
    except SourceResolutionError as exc:
        raise _http(exc) from exc

    try:
        summary = summarize_resolved_source(resolved)
    except SummaryExtractionError as exc:
        raise _http(exc) from exc

    warnings: list[str] = []
    units = summary.get("units") or {}
    if units.get("confidence") != "declared":
        warnings.append(
            "모델 단위계가 완전히 선언되어 있지 않습니다. 질량/응력 수치는 참고용입니다."
        )
    if (summary.get("modelQuality") or {}).get("totalErrors"):
        warnings.append("모델에 연결성 오류가 있습니다. 품질 등급을 확인하세요.")

    duplicate = None
    try:
        sha = _sha256_of_file(resolved.bdf_path)
    except OSError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "SOURCE_EXPIRED", "message": f"원본을 읽을 수 없습니다: {exc}"},
        ) from exc

    existing = find_duplicate(db, sha)
    if existing is not None:
        parent = (
            db.query(models.RegisteredModel)
            .filter(models.RegisteredModel.id == existing.model_id)
            .first()
        )
        duplicate = DuplicateInfo(
            model_uid=parent.model_uid if parent else None,
            revision=existing.revision_no,
            title=parent.title if parent else None,
            # 보관 상태면 프론트가 '등록 거부' 대신 '복원'을 안내해야 한다.
            status=parent.status if parent else None,
        )

    return PreviewResponse(
        source=SourceInfo(
            analysis_id=resolved.analysis.id,
            program_name=resolved.program_name,
            artifact_kind=resolved.artifact_kind,
            file_name=resolved.file_name,
            size_bytes=os.path.getsize(resolved.bdf_path),
            owner_id=resolved.owner_id,
        ),
        summary=summary,
        available_artifacts=available_artifacts(resolved),
        duplicate=duplicate,
        warnings=warnings,
        suggested_model_type=derive_model_family(
            resolved.program_name, resolved.artifact_kind,
        ),
    )


@router.post("/models", response_model=RegisterResponse, status_code=201)
def create_registration(
    payload: RegisterRequest,
    req: Request,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_admin),
):
    """BDF 를 Model Library 에 영구 등록한다. 성공(201)은 DB commit 이후에만 반환된다."""
    try:
        resolved = resolve_source(db, payload.source_analysis_id, payload.artifact_kind)
    except SourceResolutionError as exc:
        raise _http(exc) from exc

    try:
        bdf_sha256 = _sha256_of_file(resolved.bdf_path)
    except OSError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "SOURCE_EXPIRED", "message": f"원본을 읽을 수 없습니다: {exc}"},
        ) from exc

    try:
        model, revision = register_model(
            db,
            resolved=resolved,
            request=payload,
            registered_by=current_user,   # 클라이언트가 보낸 신원은 쓰지 않는다
            bdf_sha256=bdf_sha256,
        )
    except (RegistrationError, SummaryExtractionError) as exc:
        raise _http(exc) from exc

    log_activity(
        db,
        "MODEL_REGISTER",
        employee_id=current_user,
        action_detail={
            "model_uid": model.model_uid,
            "revision": revision.revision_no,
            "source_analysis_id": payload.source_analysis_id,
            "artifact_kind": payload.artifact_kind.value,
            "owner_id": model.owner_id,
            "quality_level": revision.quality_level,
        },
        ip_address=req.client.host if req.client else None,
    )

    return RegisterResponse(
        model_uid=model.model_uid,
        revision=revision.revision_no,
        quality_level=revision.quality_level,
        status=model.status,
        registered_at=revision.created_at,
    )


@router.patch("/models/{model_uid}", response_model=ModelDetailResponse)
def update_registration(
    model_uid: str,
    payload: ModelPatchRequest,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_admin),
):
    """metadata 부분 갱신. 새 revision 을 만들지 않는다."""
    model = (
        db.query(models.RegisteredModel)
        .filter(models.RegisteredModel.model_uid == model_uid)
        .first()
    )
    if model is None:
        raise HTTPException(status_code=404, detail="등록 모델을 찾을 수 없습니다.")

    changes = payload.model_dump(exclude_unset=True)
    review_status = changes.pop("review_status", None)
    for field, value in changes.items():
        if field not in PATCHABLE_FIELDS:
            continue
        setattr(model, field, value.value if hasattr(value, "value") else value)

    if review_status is not None:
        rev = _latest_revision(db, model.id)
        if rev is not None:
            status_value = (
                review_status.value if hasattr(review_status, "value") else review_status
            )
            rev.review_status = status_value
            # Q4(Golden)는 자동 부여하지 않는다 — 명시적 승인에서만 올라간다.
            if status_value == "approved":
                rev.quality_level = "Q4"
            elif rev.quality_level == "Q4":
                rev.quality_level = "Q3"

    db.commit()
    db.refresh(model)
    return _detail_payload(db, model)


@router.post("/models/{model_uid}/archive", response_model=ModelDetailResponse)
def archive_registration(
    model_uid: str,
    req: Request,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_admin),
):
    """목록에서 내린다. **파일은 지우지 않는다** — 물리 삭제 API 는 MVP 에 없다.

    보관은 되돌릴 수 있어야 한다. bdf_sha256 이 전역 unique 라 보관된 모델과 같은 BDF 는
    재등록할 수 없기 때문에, restore 가 없으면 보관이 사실상 '영구 차단'이 되어 버린다.
    """
    model = (
        db.query(models.RegisteredModel)
        .filter(models.RegisteredModel.model_uid == model_uid)
        .first()
    )
    if model is None:
        raise HTTPException(status_code=404, detail="등록 모델을 찾을 수 없습니다.")

    model.status = "archived"
    db.commit()
    db.refresh(model)

    log_activity(
        db,
        "MODEL_ARCHIVE",
        employee_id=current_user,
        action_detail={"model_uid": model.model_uid},
        ip_address=req.client.host if req.client else None,
    )
    return _detail_payload(db, model)


@router.post("/models/{model_uid}/restore", response_model=ModelDetailResponse)
def restore_registration(
    model_uid: str,
    req: Request,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_admin),
):
    """보관을 해제해 목록으로 되돌린다(archive 의 역연산).

    파일과 revision 은 보관 중에도 그대로 남아 있으므로 상태만 되돌리면 된다.
    이미 active 면 아무것도 바꾸지 않고 현재 상태를 그대로 돌려준다(재시도 안전).
    """
    model = (
        db.query(models.RegisteredModel)
        .filter(models.RegisteredModel.model_uid == model_uid)
        .first()
    )
    if model is None:
        raise HTTPException(status_code=404, detail="등록 모델을 찾을 수 없습니다.")

    if model.status != "active":
        model.status = "active"
        db.commit()
        db.refresh(model)
        log_activity(
            db,
            "MODEL_RESTORE",
            employee_id=current_user,
            action_detail={"model_uid": model.model_uid},
            ip_address=req.client.host if req.client else None,
        )
    return _detail_payload(db, model)


# --------------------------------------------------------------------------- #
# 읽기 — 인증된 전 사용자 + visibility ACL
# --------------------------------------------------------------------------- #

@router.get("/models", response_model=ModelListResponse)
def list_models(
    skip: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=200),
    query: str | None = None,
    source_program: str | None = None,
    model_type: str | None = None,
    model_role: str | None = None,
    quality_level: str | None = None,
    review_status: str | None = None,
    design_outcome: str | None = None,
    tag: str | None = None,
    status: str = "active",
    sort: str = "created_desc",
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """서버 사이드 검색/필터/페이지네이션. 기존 analysis history 와 같은 envelope."""
    q = visible_models_query(db, current_user)

    if status and status != "All":
        q = q.filter(models.RegisteredModel.status == status)
    if query:
        like = f"%{query}%"
        q = q.filter(
            models.RegisteredModel.title.ilike(like)
            | models.RegisteredModel.description.ilike(like)
        )
    if model_type:
        q = q.filter(models.RegisteredModel.model_type == model_type)
    if model_role:
        q = q.filter(models.RegisteredModel.model_role == model_role)

    revision_filters = [
        (source_program, models.RegisteredModelRevision.source_program_name),
        (quality_level, models.RegisteredModelRevision.quality_level),
        (review_status, models.RegisteredModelRevision.review_status),
        (design_outcome, models.RegisteredModelRevision.design_outcome),
    ]
    active = [(v, col) for v, col in revision_filters if v]
    if active:
        sub = db.query(models.RegisteredModelRevision.model_id)
        for value, column in active:
            sub = sub.filter(column == value)
        q = q.filter(models.RegisteredModel.id.in_(sub))

    order = (
        models.RegisteredModel.created_at.asc()
        if sort == "created_asc"
        else models.RegisteredModel.created_at.desc()
    )
    q = q.order_by(order, models.RegisteredModel.id.desc())

    rows = q.all()
    # 태그는 JSON 컬럼이라 DB 이식성(MySQL/SQLite) 문제로 파이썬에서 거른다.
    if tag:
        needle = tag.strip().lower()
        rows = [r for r in rows if needle in (r.tags or [])]

    total = len(rows)
    page = rows[skip:skip + limit]
    items = [_to_list_item(m, _latest_revision(db, m.id)) for m in page]
    return ModelListResponse(total=total, skip=skip, limit=limit, items=items)


def _visible_revision_rows(db: Session, current_user: str, *, status: str | None = None) -> list[dict]:
    """Insight 입력 — 현재 사용자가 볼 수 있는 모델의 revision 을 평범한 dict 로 만든다.

    집계 함수를 ORM 에서 떼어내 순수하게 유지하기 위한 어댑터다.
    """
    q = visible_models_query(db, current_user)
    if status and status != "All":
        q = q.filter(models.RegisteredModel.status == status)
    model_rows = q.all()
    if not model_rows:
        return []

    by_id = {m.id: m for m in model_rows}
    revisions = (
        db.query(models.RegisteredModelRevision)
        .filter(models.RegisteredModelRevision.model_id.in_(list(by_id)))
        .all()
    )
    rows = []
    for rev in revisions:
        model = by_id.get(rev.model_id)
        if model is None:
            continue
        rows.append({
            "model_uid": model.model_uid,
            "title": model.title,
            "model_type": model.model_type,
            "model_role": model.model_role,
            "tags": model.tags,
            "visibility": model.visibility,
            "status": model.status,
            "owner_id": model.owner_id,
            "registered_by": model.registered_by,
            "revision_no": rev.revision_no,
            "source_program_name": rev.source_program_name,
            "source_artifact_kind": rev.source_artifact_kind,
            "quality_level": rev.quality_level,
            "review_status": rev.review_status,
            "design_outcome": rev.design_outcome,
            "node_count": rev.node_count,
            "element_count": rev.element_count,
            "total_mass_kg": rev.total_mass_kg,
            "max_utilization": rev.max_utilization,
            "summary_json": rev.summary_json,
            "created_at": rev.created_at,
        })
    return rows


@router.get("/insights/overview")
def get_insights_overview(
    status: str = "active",
    family: str | None = None,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """등록 모델 통계. 현재 사용자가 볼 수 있는 모델만 집계한다.

    응답은 **두 스코프**로 나뉜다 — `overall`(항상 전체)과 `family`(선택 계열).
    개수·분포·데이터 위생은 전체에서만, 연속값 통계·교차표·학습 표본은 계열 안에서만
    의미가 있기 때문이다. family 를 생략하면 서버가 건수 최다 계열을 고른다.

    표본 수·결측 수를 항상 함께 내며, 표본이 없는 통계는 0 이 아니라 null 이다.
    """
    rows = _visible_revision_rows(db, current_user, status=status)
    # 빈 문자열(`?family=`)은 '선택 안 함'과 같다 — 그대로 넘기면 존재하지 않는 계열을
    # 명시적으로 고른 것으로 처리돼 빈 스코프가 나간다.
    return build_scoped_overview(rows, family=family or None)


@router.get("/export.json")
def export_registry(
    status: str = "active",
    include_identity: bool = False,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """분석/데이터셋용 export. **사번은 기본 제외**이며, 포함은 관리자만 요청할 수 있다."""
    if include_identity and not is_admin_user(db, current_user):
        raise HTTPException(
            status_code=403,
            detail={"code": "IDENTITY_FORBIDDEN", "message": "식별 정보 포함은 관리자만 가능합니다."},
        )

    rows = _visible_revision_rows(db, current_user, status=status)
    return {
        "schemaVersion": SUMMARY_SCHEMA_VERSION,
        "count": len(rows),
        "includesIdentity": bool(include_identity),
        "rows": build_export_rows(rows, include_identity=include_identity),
    }


def _detail_payload(db: Session, model: models.RegisteredModel) -> ModelDetailResponse:
    revisions = (
        db.query(models.RegisteredModelRevision)
        .filter(models.RegisteredModelRevision.model_id == model.id)
        .order_by(models.RegisteredModelRevision.revision_no.desc())
        .all()
    )
    payload = []
    for rev in revisions:
        artifacts = (
            db.query(models.RegisteredModelArtifact)
            .filter(models.RegisteredModelArtifact.revision_id == rev.id)
            .order_by(models.RegisteredModelArtifact.id.asc())
            .all()
        )
        item = RevisionResponse.model_validate(rev)
        item.artifacts = [ArtifactResponse.model_validate(a) for a in artifacts]
        payload.append(item)

    detail = ModelDetailResponse.model_validate(model)
    detail.revisions = payload
    return detail


@router.get("/models/{model_uid}", response_model=ModelDetailResponse)
def get_model(
    model_uid: str,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    model = (
        db.query(models.RegisteredModel)
        .filter(models.RegisteredModel.model_uid == model_uid)
        .first()
    )
    # 볼 수 없는 모델은 존재 여부 자체를 노출하지 않는다.
    if model is None or not can_read(model, current_user, db):
        raise HTTPException(status_code=404, detail="등록 모델을 찾을 수 없습니다.")
    return _detail_payload(db, model)


def _revision_dict(model: models.RegisteredModel, rev) -> dict:
    """유사도 계산이 쓰는 평면 dict. 서비스 계층을 ORM 에서 떼어 놓는다."""
    return {
        "model_uid": model.model_uid,
        "title": model.title,
        "model_type": model.model_type,
        "revision_no": rev.revision_no,
        "schema_version": rev.schema_version,
        "source_program_name": rev.source_program_name,
        "quality_level": rev.quality_level,
        "design_outcome": rev.design_outcome,
        "node_count": rev.node_count,
        "element_count": rev.element_count,
        "total_mass_kg": rev.total_mass_kg,
        "max_utilization": rev.max_utilization,
        "summary_json": rev.summary_json,
    }


@router.get("/models/{model_uid}/similar")
def get_similar_models(
    model_uid: str,
    limit: int = Query(SIMILAR_DEFAULT_LIMIT, ge=1, le=30),
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """형상이 비슷한 등록 모델. **왜 비슷한지**를 차원별로 함께 돌려준다.

    2단 구조다 — SQL 로 후보를 좁히고(규모 밴드), 파이썬으로 거리를 잰다.
    vector DB 없이도 수백 건 규모에서는 충분하고, 무엇보다 근거를 설명할 수 있다.
    """
    model = (
        db.query(models.RegisteredModel)
        .filter(models.RegisteredModel.model_uid == model_uid)
        .first()
    )
    if model is None or not can_read(model, current_user, db):
        raise HTTPException(status_code=404, detail="등록 모델을 찾을 수 없습니다.")

    target_rev = _latest_revision(db, model.id)
    if target_rev is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "NO_REVISION", "message": "비교할 revision 이 없습니다."},
        )

    # ── 1단계: SQL 후보 축소 ──
    q = visible_models_query(db, current_user).filter(
        models.RegisteredModel.status == "active",
        models.RegisteredModel.id != model.id,
    )
    candidate_models = q.all()
    if not candidate_models:
        # 후보가 없어도 같은 응답 모양을 유지한다 — 프론트가 빈 상태를 특별 취급하지 않게.
        return find_similar(_revision_dict(model, target_rev), [], limit=limit)

    by_id = {m.id: m for m in candidate_models}
    rev_query = db.query(models.RegisteredModelRevision).filter(
        models.RegisteredModelRevision.model_id.in_(list(by_id))
    )
    # 노드 수가 10배 이상 차이 나면 사실상 다른 모델이라 파이썬까지 끌고 오지 않는다.
    # 축소는 최적화일 뿐이므로 target 에 노드 수가 없으면 건너뛴다(전부 비교).
    if target_rev.node_count:
        rev_query = rev_query.filter(
            models.RegisteredModelRevision.node_count.is_(None)
            | (
                models.RegisteredModelRevision.node_count.between(
                    target_rev.node_count / SIMILAR_SCALE_BAND,
                    target_rev.node_count * SIMILAR_SCALE_BAND,
                )
            )
        )

    # 모델당 최신 revision 하나만 비교한다 — 같은 모델의 revision 이 순위를 채우면 안 된다.
    latest_by_model: dict[int, models.RegisteredModelRevision] = {}
    for rev in rev_query.all():
        current = latest_by_model.get(rev.model_id)
        if current is None or rev.revision_no > current.revision_no:
            latest_by_model[rev.model_id] = rev

    candidates = [
        _revision_dict(by_id[mid], rev)
        for mid, rev in latest_by_model.items()
        if mid in by_id
    ]

    # ── 2단계: 파이썬 거리 ──
    return find_similar(_revision_dict(model, target_rev), candidates, limit=limit)


@router.get("/models/{model_uid}/geometry")
def get_model_geometry(
    model_uid: str,
    revision: int | None = None,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """3D 미리보기용 좌표/연결 정보.

    상세 응답에 싣지 않고 따로 두는 이유는 크기다 — 노드/요소 배열은 수 MB 라
    목록·상세를 매번 무겁게 만든다. 사용자가 미리보기를 열 때만 받아 간다.

    응답에는 좌표와 연결만 담기며 저장소 경로는 나가지 않는다.
    """
    model = (
        db.query(models.RegisteredModel)
        .filter(models.RegisteredModel.model_uid == model_uid)
        .first()
    )
    if model is None or not can_read(model, current_user, db):
        raise HTTPException(status_code=404, detail="등록 모델을 찾을 수 없습니다.")

    rev_query = db.query(models.RegisteredModelRevision).filter(
        models.RegisteredModelRevision.model_id == model.id
    )
    if revision is not None:
        rev = rev_query.filter(
            models.RegisteredModelRevision.revision_no == revision
        ).first()
    else:
        rev = rev_query.order_by(models.RegisteredModelRevision.revision_no.desc()).first()
    if rev is None:
        raise HTTPException(status_code=404, detail="revision 을 찾을 수 없습니다.")

    artifacts = (
        db.query(models.RegisteredModelArtifact)
        .filter(models.RegisteredModelArtifact.revision_id == rev.id)
        .all()
    )
    by_kind = {a.kind: a for a in artifacts}

    try:
        root = resolve_registry_root(create=False)
        # DB 값이 오염됐더라도 저장소 밖 파일은 읽지 않는다(다운로드와 같은 규칙).
        def _path(kind: str) -> str | None:
            art = by_kind.get(kind)
            return absolute_path(root, art.relative_path) if art else None

        normalized = _path("normalized-model")
        bdf = _path("bdf")
    except RegistryStorageError as exc:
        logger.error("[registry] 잘못된 artifact 경로: revision=%s", rev.id)
        raise HTTPException(
            status_code=404,
            detail={"code": "GEOMETRY_UNAVAILABLE", "message": "미리보기 파일을 찾을 수 없습니다."},
        ) from exc

    try:
        payload = load_preview_geometry(
            root=root,
            revision_id=rev.id,
            normalized_model_path=normalized,
            bdf_path=bdf,
        )
    except GeometryUnavailable as exc:
        raise HTTPException(
            status_code=404,
            detail={"code": GeometryUnavailable.code, "message": str(exc)},
        ) from exc
    except SummaryExtractionError as exc:
        # BDF 재파싱 실패 — 등록 자체는 유효하므로 미리보기만 실패시킨다.
        raise HTTPException(
            status_code=422,
            detail={"code": "GEOMETRY_PARSE_FAILED", "message": str(exc)},
        ) from exc

    payload.update({"model_uid": model.model_uid, "revision": rev.revision_no})
    return payload


@router.get("/artifacts/{artifact_id}/download")
def download_artifact(
    artifact_id: int,
    req: Request,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """artifact **ID 로만** 조회한다. 브라우저가 보낸 경로는 받지 않는다."""
    artifact = (
        db.query(models.RegisteredModelArtifact)
        .filter(models.RegisteredModelArtifact.id == artifact_id)
        .first()
    )
    if artifact is None:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    revision = (
        db.query(models.RegisteredModelRevision)
        .filter(models.RegisteredModelRevision.id == artifact.revision_id)
        .first()
    )
    model = (
        db.query(models.RegisteredModel)
        .filter(models.RegisteredModel.id == revision.model_id)
        .first()
        if revision
        else None
    )
    if model is None or not can_read(model, current_user, db):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    try:
        root = resolve_registry_root(create=False)
        # DB 값이 오염됐더라도 저장소 밖 파일은 서빙하지 않는다.
        path = absolute_path(root, artifact.relative_path)
    except RegistryStorageError as exc:
        logger.error("[registry] 잘못된 artifact 경로: id=%s", artifact_id)
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.") from exc

    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")

    log_activity(
        db,
        "FILE_DOWNLOAD",
        employee_id=current_user,
        action_detail={
            "source": "model-registry",
            "model_uid": model.model_uid,
            "artifact_id": artifact_id,
            "file_name": artifact.file_name,
        },
        ip_address=req.client.host if req.client else None,
    )
    return FileResponse(
        path=path,
        filename=artifact.file_name,
        media_type=artifact.media_type or "application/octet-stream",
    )
