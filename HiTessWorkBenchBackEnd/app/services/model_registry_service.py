"""Model Registry — source 해석 + 등록 오케스트레이션.

핵심 보안 계약:
    클라이언트는 파일 경로를 **보내지 않는다.** `source_analysis_id + artifact_kind` 만 받고
    서버가 ARTIFACT_RULES allowlist 로 실제 경로를 해석한다. 브라우저가 임의 경로를 넣어
    userConnection 밖 파일을 registry 로 복사시키는 것을 원천 차단한다.

프로그램마다 result_info 키가 제각각(bdf_path / bdf / liftingBdf / bdf_model)이라
매핑을 한곳에 모아 둔다. GroupModuleUnit 계열에서 실행 단계와 무관하게 안정적인 앵커는
input_info["bdf_model"] 뿐이다.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..model_registry_schemas import (
    SUMMARY_SCHEMA_VERSION,
    RegisterRequest,
    SourceArtifactKind,
    StoredArtifactKind,
)
from ..routers._access_control import is_admin_user
from ..routers._intake import USER_CONNECTION_DIR
from .hitess_modelflow_service import detect_edited_artifacts
from .lifting_artifacts import scan_lifting_artifacts
from .model_family import derive_model_family
from .model_registry_storage import (
    PendingArtifact,
    RegistryStorageError,
    is_within_dir,
    publish_revision,
    resolve_registry_root,
    unpublish_revision,
)
from .model_summary_service import summarize_resolved_source

logger = logging.getLogger(__name__)


class SourceResolutionError(Exception):
    """source 해석 실패. 라우터가 code 를 HTTP 상태로 변환한다."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass
class ResolvedSource:
    """해석된 source. bdf_path 만이 등록 대상 원본이고 나머지는 부가 artifact 후보다."""

    analysis: models.Analysis
    artifact_kind: SourceArtifactKind
    bdf_path: str
    owner_id: Optional[str]
    program_name: Optional[str]
    # 부가 artifact 후보 {stored_kind: 절대경로} — 존재하는 것만 담는다.
    companions: dict[str, str]

    @property
    def file_name(self) -> str:
        return os.path.basename(self.bdf_path)


def _result(analysis: models.Analysis) -> dict:
    return analysis.result_info or {}


def _input(analysis: models.Analysis) -> dict:
    return analysis.input_info or {}


# --------------------------------------------------------------------------- #
# artifact_kind 별 해석 규칙
#   각 함수는 (bdf_path|None, companions dict) 를 돌려준다.
# --------------------------------------------------------------------------- #

def _resolve_modelbuilder_final(a: models.Analysis) -> tuple[Optional[str], dict]:
    info = _result(a)
    companions = {}
    for key, kind in (
        ("json_path", "normalized-model"),
        ("audit_path", "input-audit"),
        ("summary_path", "stage-summary"),
    ):
        if info.get(key):
            companions[kind] = info[key]
    return info.get("bdf_path"), companions


def _resolve_modelbuilder_edited(a: models.Analysis) -> tuple[Optional[str], dict]:
    output_dir = _result(a).get("output_dir")
    if not output_dir:
        return None, {}
    edited = detect_edited_artifacts(output_dir)
    companions = {}
    for key, kind in (
        ("edited_json_path", "normalized-model"),
        ("apply_trace_path", "validation"),
        ("edited_f06_path", "f06"),
        ("edited_op2_path", "op2"),
        ("edited_f06_results_path", "analysis-result"),
    ):
        if edited.get(key):
            companions[kind] = edited[key]
    return edited.get("edited_bdf_path"), companions


def _resolve_modelbuilder_solved(a: models.Analysis) -> tuple[Optional[str], dict]:
    info = _result(a)
    companions = {}
    for key, kind in (
        ("f06", "f06"),
        ("op2", "op2"),
        ("nastranResultJson", "analysis-result"),
    ):
        if info.get(key):
            companions[kind] = info[key]
    return info.get("bdf"), companions


def _resolve_groupmodule_original(a: models.Analysis) -> tuple[Optional[str], dict]:
    info = _result(a)
    companions = {}
    for key, kind in (
        ("JSON_ModelInfo", "normalized-model"),
        ("JSON_Validation", "validation"),
    ):
        if info.get(key):
            companions[kind] = info[key]
    return _input(a).get("bdf_model"), companions


def _scan_parent_folder(a: models.Analysis, wanted_kind: str) -> tuple[Optional[str], dict]:
    """GroupModuleUnit/SidePassage 작업 폴더에서 lifting 산출물을 찾는다.

    폴더는 input_info['bdf_model'] 의 부모다(unit_structural_service 가 parent BDF 와
    같은 폴더에 산출물을 만든다). scan_lifting_artifacts 의 stem 정확매칭 → 글롭 폴백
    규칙을 그대로 재사용해 편집 과정에서 stem 이 어긋난 경우도 잡는다.
    """
    bdf_model = _input(a).get("bdf_model")
    if not bdf_model:
        return None, {}
    folder = os.path.dirname(os.path.abspath(bdf_model))
    stem = os.path.splitext(os.path.basename(bdf_model))[0]
    found = {item["kind"]: item["path"] for item in scan_lifting_artifacts(folder, stem)}

    companions = {}
    for key, kind in (("f06", "f06"), ("op2", "op2")):
        if found.get(key):
            companions[kind] = found[key]
    info = _result(a)
    for key, kind in (
        ("JSON_ModelInfo", "normalized-model"),
        ("JSON_Validation", "validation"),
    ):
        if info.get(key):
            companions[kind] = info[key]
    return found.get(wanted_kind), companions


def _resolve_module_unit_edited(a: models.Analysis) -> tuple[Optional[str], dict]:
    return _scan_parent_folder(a, "editedBdf")


def _resolve_module_unit_lifting(a: models.Analysis) -> tuple[Optional[str], dict]:
    # UnitStructuralAnalysis 는 자기 result_info 에 직접 들고 있다.
    if a.program_name == "UnitStructuralAnalysis":
        info = _result(a)
        companions = {}
        for key, kind in (
            ("f06", "f06"),
            ("nastranResultJson", "analysis-result"),
            ("stabilityJson", "validation"),
        ):
            if info.get(key):
                companions[kind] = info[key]
        return info.get("liftingBdf"), companions
    return _scan_parent_folder(a, "liftingBdf")


@dataclass(frozen=True)
class _ArtifactRule:
    programs: frozenset[str]
    resolver: Callable[[models.Analysis], tuple[Optional[str], dict]]


ARTIFACT_RULES: dict[SourceArtifactKind, _ArtifactRule] = {
    SourceArtifactKind.MODELBUILDER_FINAL: _ArtifactRule(
        frozenset({"HiTessModelBuilder"}), _resolve_modelbuilder_final,
    ),
    SourceArtifactKind.MODELBUILDER_EDITED: _ArtifactRule(
        frozenset({"HiTessModelBuilder"}), _resolve_modelbuilder_edited,
    ),
    SourceArtifactKind.MODELBUILDER_SOLVED: _ArtifactRule(
        frozenset({"ModelBuilderAnalysis"}), _resolve_modelbuilder_solved,
    ),
    SourceArtifactKind.GROUPMODULE_ORIGINAL: _ArtifactRule(
        frozenset({"GroupModuleUnit", "SidePassage"}), _resolve_groupmodule_original,
    ),
    SourceArtifactKind.MODULE_UNIT_EDITED: _ArtifactRule(
        frozenset({"GroupModuleUnit", "SidePassage"}), _resolve_module_unit_edited,
    ),
    SourceArtifactKind.MODULE_UNIT_LIFTING: _ArtifactRule(
        frozenset({"GroupModuleUnit", "SidePassage", "UnitStructuralAnalysis"}),
        _resolve_module_unit_lifting,
    ),
}


def resolve_source(
    db: Session,
    source_analysis_id: int,
    artifact_kind: SourceArtifactKind,
) -> ResolvedSource:
    """source_analysis_id + artifact_kind 를 실제 BDF 절대경로로 해석한다.

    소유권 검사는 하지 않는다 — 등록은 관리자 전용이라 라우터의 require_admin 이 이미
    막고 있고, 관리자는 타인 Analysis 도 큐레이션할 수 있어야 한다. 대신 원 수행자를
    owner_id 로 돌려주어 출처를 보존한다.

    Raises:
        SourceResolutionError: 404/400/409 로 변환될 도메인 오류
    """
    record = (
        db.query(models.Analysis)
        .filter(models.Analysis.id == source_analysis_id)
        .first()
    )
    if record is None:
        raise SourceResolutionError(
            "SOURCE_ANALYSIS_NOT_FOUND", "해석 기록을 찾을 수 없습니다.", 404,
        )

    rule = ARTIFACT_RULES.get(artifact_kind)
    if rule is None or record.program_name not in rule.programs:
        raise SourceResolutionError(
            "UNSUPPORTED_ARTIFACT_KIND",
            f"'{record.program_name}' 해석에는 '{artifact_kind.value}' 산출물을 등록할 수 없습니다.",
            400,
        )

    raw_path, raw_companions = rule.resolver(record)
    if not raw_path:
        raise SourceResolutionError(
            "SOURCE_EXPIRED",
            "등록할 BDF 경로를 찾을 수 없습니다. 30일 보존 기간이 지나 삭제되었을 수 있습니다.",
            409,
        )

    bdf_path = os.path.abspath(raw_path)

    # 경로 격리 — DB 값이 오염되었더라도 userConnection 밖 파일은 등록하지 않는다.
    if not is_within_dir(USER_CONNECTION_DIR, bdf_path):
        raise SourceResolutionError(
            "SOURCE_FORBIDDEN", "허용되지 않은 경로의 파일입니다.", 400,
        )

    if os.path.splitext(bdf_path)[1].lower() != ".bdf":
        raise SourceResolutionError(
            "UNSUPPORTED_ARTIFACT_KIND", "BDF 파일만 등록할 수 있습니다.", 400,
        )

    if not os.path.isfile(bdf_path):
        raise SourceResolutionError(
            "SOURCE_EXPIRED",
            "원본 파일이 존재하지 않습니다. 30일 보존 기간이 지나 삭제되었을 수 있습니다.",
            409,
        )

    companions = {}
    for kind, path in (raw_companions or {}).items():
        if not path:
            continue
        abs_path = os.path.abspath(path)
        if is_within_dir(USER_CONNECTION_DIR, abs_path) and os.path.isfile(abs_path):
            companions[kind] = abs_path

    return ResolvedSource(
        analysis=record,
        artifact_kind=artifact_kind,
        bdf_path=bdf_path,
        owner_id=record.employee_id,
        program_name=record.program_name,
        companions=companions,
    )


# --------------------------------------------------------------------------- #
# 접근 제어 (읽기)
# --------------------------------------------------------------------------- #

def can_read(model: models.RegisteredModel, current_user: str, db: Session) -> bool:
    """등록 모델 조회 권한.

    등록은 관리자 전용이지만 조회는 전 사용자에게 열려 있다. 기본 visibility 가 company 라
    관리자가 선별한 기준 모델은 팀 전체가 참조한다.
    """
    if (model.visibility or "company") == "company":
        return True
    if model.owner_id and model.owner_id == current_user:
        return True
    return is_admin_user(db, current_user)


def visible_models_query(db: Session, current_user: str):
    """현재 사용자가 볼 수 있는 모델만 남기는 쿼리."""
    q = db.query(models.RegisteredModel)
    if is_admin_user(db, current_user):
        return q
    return q.filter(
        (models.RegisteredModel.visibility == "company")
        | (models.RegisteredModel.owner_id == current_user)
    )


# --------------------------------------------------------------------------- #
# 등록
# --------------------------------------------------------------------------- #

class RegistrationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, **extra) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra


# f06/op2 는 크고 재생성 가능해 기본 제외한다(운영 정책 권장값).
DEFAULT_INCLUDED_KINDS = frozenset({
    StoredArtifactKind.BDF.value,
    StoredArtifactKind.NORMALIZED_MODEL.value,
    StoredArtifactKind.VALIDATION.value,
    StoredArtifactKind.INPUT_AUDIT.value,
    StoredArtifactKind.STAGE_SUMMARY.value,
    StoredArtifactKind.ANALYSIS_RESULT.value,
})

_COMPANION_FILE_NAMES = {
    "normalized-model": "normalized-model.json",
    "validation": "validation.json",
    "input-audit": "input-audit.json",
    "stage-summary": "stage-summary.json",
    "analysis-result": "analysis-result.json",
    "f06": "result.f06",
    "op2": "result.op2",
}


def find_duplicate(db: Session, bdf_sha256: str) -> Optional[models.RegisteredModelRevision]:
    return (
        db.query(models.RegisteredModelRevision)
        .filter(models.RegisteredModelRevision.bdf_sha256 == bdf_sha256)
        .first()
    )


def available_artifacts(resolved: ResolvedSource) -> list[dict]:
    """preview 가 보여줄 저장 가능 artifact 목록. 존재하는 것만 담는다."""
    out = [{
        "kind": StoredArtifactKind.BDF.value,
        "file_name": resolved.file_name,
        "size_bytes": _safe_size(resolved.bdf_path),
        "default_selected": True,
    }]
    for kind, path in sorted((resolved.companions or {}).items()):
        out.append({
            "kind": kind,
            "file_name": os.path.basename(path),
            "size_bytes": _safe_size(path),
            "default_selected": kind in DEFAULT_INCLUDED_KINDS,
        })
    return out


def _safe_size(path: str) -> Optional[int]:
    try:
        return os.path.getsize(path)
    except OSError:
        return None


def _selected_kinds(request: RegisterRequest) -> set[str]:
    if not request.include_artifacts:
        return set(DEFAULT_INCLUDED_KINDS)
    return {k.value for k in request.include_artifacts}


def _next_revision_no(db: Session, model_id: int) -> int:
    current = (
        db.query(func.max(models.RegisteredModelRevision.revision_no))
        .filter(models.RegisteredModelRevision.model_id == model_id)
        .scalar()
    )
    return int(current or 0) + 1


def register_model(
    db: Session,
    *,
    resolved: ResolvedSource,
    request: RegisterRequest,
    registered_by: str,
    bdf_sha256: str,
) -> tuple[models.RegisteredModel, models.RegisteredModelRevision]:
    """source 를 registry 로 복사하고 DB 에 등록한다.

    순서가 중요하다: DB insert + flush 로 PK/revision_no 를 먼저 확보하고, 파일을 확정한 뒤
    마지막에 commit 한다. commit 이 실패하면 이미 확정된 revision 폴더를 되돌린다.
    등록 성공은 commit 이후에만 성립한다.
    """
    duplicate = find_duplicate(db, bdf_sha256)
    if duplicate is not None:
        existing = (
            db.query(models.RegisteredModel)
            .filter(models.RegisteredModel.id == duplicate.model_id)
            .first()
        )
        # 보관된 모델은 목록에서 사라져 사용자에게는 '삭제된' 것처럼 보이지만,
        # bdf_sha256 이 전역 unique 라 재등록이 영구히 막힌다. 같은 409 로 뭉뚱그리면
        # 빠져나갈 길이 없으므로 코드를 분리해 프론트가 '복원'을 제안할 수 있게 한다.
        archived = existing is not None and existing.status == "archived"
        raise RegistrationError(
            "ARCHIVED_DUPLICATE" if archived else "EXACT_DUPLICATE",
            "동일한 BDF 가 보관 상태로 남아 있습니다. 새로 등록하는 대신 복원하세요."
            if archived
            else "동일한 BDF 가 이미 등록되어 있습니다.",
            409,
            model_uid=existing.model_uid if existing else None,
            revision=duplicate.revision_no,
            model_status=existing.status if existing else None,
        )

    try:
        root = resolve_registry_root()
    except RegistryStorageError as exc:
        raise RegistrationError("REGISTRY_STORAGE_UNAVAILABLE", str(exc), 503) from exc

    # 기존 모델에 revision 추가 vs 신규 모델
    model: Optional[models.RegisteredModel] = None
    if request.target_model_uid:
        model = (
            db.query(models.RegisteredModel)
            .filter(models.RegisteredModel.model_uid == request.target_model_uid)
            .first()
        )
        if model is None:
            raise RegistrationError(
                "TARGET_MODEL_NOT_FOUND", "대상 모델을 찾을 수 없습니다.", 404,
            )
        # 보관된 모델에 revision 을 추가하면 201 은 떨어지는데 목록엔 안 보인다.
        # 새 revision 을 붙이는 것 자체가 '다시 쓰겠다'는 뜻이므로 보관을 해제한다.
        if model.status != "active":
            model.status = "active"

    # 계열: 요청 → (기존 모델 유지) → 출처에서 파생.
    # ★ 신규 모델을 만들 때만 모델 행에 반영된다. target_model_uid 로 revision 을 덧붙이는
    #   경로(API 전용)에서는 summary.json 에만 남고 부모 행의 계열은 그대로다 — 계열 변경은
    #   PATCH 의 몫이다(제목·설명도 같은 규칙).
    if request.model_type is not None:
        family_value = request.model_type.value
    elif model is not None and model.model_type:
        family_value = model.model_type
    else:
        family_value = derive_model_family(
            resolved.program_name, resolved.artifact_kind,
        ).value

    if model is None:
        model = models.RegisteredModel(
            model_uid=str(uuid.uuid4()),
            title=request.title,
            description=request.description,
            model_type=family_value,
            model_role=request.model_role.value if request.model_role else None,
            confidence=request.confidence.value if request.confidence else None,
            reuse_notes=request.reuse_notes,
            visibility=request.visibility.value,
            tags=request.tags,
            owner_id=resolved.owner_id,      # 원 해석 수행자 — 출처 보존
            registered_by=registered_by,     # 등록한 관리자
            status="active",
        )
        db.add(model)
        db.flush()

    revision_no = _next_revision_no(db, model.id)

    summary = summarize_resolved_source(
        resolved,
        model_meta={
            "modelUid": model.model_uid,
            "revision": revision_no,
            "title": request.title,
            "modelType": family_value,
            "modelRole": request.model_role.value if request.model_role else None,
            "description": request.description,
            "tags": request.tags,
            "confidence": request.confidence.value if request.confidence else None,
            "reuseNotes": request.reuse_notes,
        },
    )
    summary["provenance"].update({
        "registeredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "registeredBy": registered_by,
        "ownerId": resolved.owner_id,
        "bdfSha256": bdf_sha256,
    })

    quality = summary.get("modelQuality") or {}
    outcome = summary.get("analysisOutcome") or {}
    geometry = summary.get("geometry") or {}
    physical = summary.get("physicalProperties") or {}

    revision = models.RegisteredModelRevision(
        model_id=model.id,
        revision_no=revision_no,
        schema_version=SUMMARY_SCHEMA_VERSION,
        source_analysis_id=resolved.analysis.id,
        source_program_name=resolved.program_name,
        source_artifact_kind=resolved.artifact_kind.value,
        bdf_sha256=bdf_sha256,
        storage_relative_path="",   # publish 후 채운다
        summary_json=summary,
        quality_level=quality.get("qualityLevel"),
        review_status="unreviewed",
        design_outcome=outcome.get("outcome") or "unknown",
        node_count=geometry.get("nodeCount"),
        element_count=geometry.get("elementCount"),
        total_mass_kg=physical.get("totalMassKg"),
        max_utilization=outcome.get("maxUtilization"),
    )
    db.add(revision)
    db.flush()

    # ── 파일 확정 ────────────────────────────────────────────────────────
    selected = _selected_kinds(request)
    pending: list[PendingArtifact] = []
    if StoredArtifactKind.BDF.value in selected:
        pending.append(PendingArtifact("bdf", resolved.bdf_path, "source.bdf"))
    for kind, path in (resolved.companions or {}).items():
        if kind in selected:
            pending.append(
                PendingArtifact(kind, path, _COMPANION_FILE_NAMES.get(kind, os.path.basename(path)))
            )

    summary_bytes = json.dumps(summary, ensure_ascii=False, indent=2).encode("utf-8")

    try:
        published = publish_revision(
            root=root,
            model_uid=model.model_uid,
            revision_no=revision_no,
            artifacts=pending,
            inline_files={"summary": ("summary.json", summary_bytes)},
        )
    except RegistryStorageError as exc:
        db.rollback()
        raise RegistrationError(getattr(exc, "code", "REGISTRY_STORAGE_ERROR"), str(exc), _storage_status(exc)) from exc

    # manifest 는 마지막에 쓴다. 자기 자신은 checksum 대상이 아니다.
    manifest = {
        "schemaVersion": SUMMARY_SCHEMA_VERSION,
        "modelUid": model.model_uid,
        "revision": revision_no,
        "files": published["artifacts"],
    }
    try:
        manifest_path = os.path.join(
            root, published["relative_path"].replace("/", os.sep), "manifest.json",
        )
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
    except OSError as exc:
        unpublish_revision(root, published["relative_path"])
        db.rollback()
        raise RegistrationError(
            "REGISTRY_STORAGE_UNAVAILABLE", f"manifest 기록 실패: {exc}", 503,
        ) from exc

    revision.storage_relative_path = published["relative_path"]
    revision.artifact_manifest = manifest
    for art in published["artifacts"]:
        db.add(models.RegisteredModelArtifact(
            revision_id=revision.id,
            kind=art["kind"],
            file_name=art["file_name"],
            relative_path=art["relative_path"],
            size_bytes=art["size_bytes"],
            sha256=art["sha256"],
            media_type=art["media_type"],
        ))

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        # 파일은 이미 확정됐으므로 되돌린다. 실패하면 orphan 으로 로그를 남긴다.
        unpublish_revision(root, published["relative_path"])
        raise RegistrationError(
            "EXACT_DUPLICATE" if _is_unique_violation(exc) else "REGISTRY_COMMIT_FAILED",
            "등록을 저장하지 못했습니다. 동일한 BDF 가 방금 등록되었을 수 있습니다."
            if _is_unique_violation(exc)
            else f"등록 정보를 저장하지 못했습니다: {exc}",
            409 if _is_unique_violation(exc) else 500,
        ) from exc

    db.refresh(model)
    db.refresh(revision)
    return model, revision


def _storage_status(exc: Exception) -> int:
    code = getattr(exc, "code", "")
    if code == "PACKAGE_TOO_LARGE":
        return 413
    if code == "REVISION_ALREADY_PUBLISHED":
        return 409
    if code == "CHECKSUM_MISMATCH":
        return 500
    return 503


def _is_unique_violation(exc: Exception) -> bool:
    from sqlalchemy.exc import IntegrityError

    return isinstance(exc, IntegrityError)
