"""선별형 BDF Model Registry 의 enum / 요청 / 응답 스키마.

설계 원칙:
- 클라이언트는 **절대경로를 보내지 않는다.** `source_analysis_id + artifact_kind` 만 보내고
  서버가 allowlist 로 실제 파일 경로를 해석한다(model_registry_service.resolve_source).
- `registered_by` / `employee_id` 는 요청에서 받지 않는다. 인증 토큰 신원으로만 정한다.
- 모델 품질(modelQuality)과 설계 결과(analysisOutcome)는 별개 축이다. 응력 초과 모델도
  정확히 표현되었다면 고품질 회귀 예제일 수 있으므로 하나로 합치지 않는다.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# summary.json 계약 버전. 스키마가 바뀌면 올린다.
#   1.1 — inputAudit / buildStages / diagnostics 절과 physicalProperties.totalMassKg 추가.
#         1.0 으로 등록된 기존 모델에는 이 키들이 아예 없으므로, 프론트는 '값 없음'과
#         '이전 스키마'를 구분해 표시해야 한다(0 으로 대체 금지).
SUMMARY_SCHEMA_VERSION = "1.1"

MAX_TAGS = 20
MAX_TAG_LENGTH = 50


class SourceArtifactKind(str, Enum):
    """클라이언트가 고를 수 있는 source artifact 종류(allowlist).

    실제 파일 경로 해석 규칙은 model_registry_service.ARTIFACT_RULES 에 있다.
    """

    MODELBUILDER_FINAL = "modelbuilder_final"
    MODELBUILDER_EDITED = "modelbuilder_edited"
    MODELBUILDER_SOLVED = "modelbuilder_solved"
    GROUPMODULE_ORIGINAL = "groupmodule_original"
    MODULE_UNIT_EDITED = "module_unit_edited"
    MODULE_UNIT_LIFTING = "module_unit_lifting"


class StoredArtifactKind(str, Enum):
    """revision 폴더에 실제로 저장되는 파일 종류."""

    BDF = "bdf"
    SUMMARY = "summary"
    MANIFEST = "manifest"
    NORMALIZED_MODEL = "normalized-model"
    VALIDATION = "validation"
    INPUT_AUDIT = "input-audit"
    STAGE_SUMMARY = "stage-summary"
    ANALYSIS_RESULT = "analysis-result"
    F06 = "f06"
    OP2 = "op2"


class ModelRole(str, Enum):
    REFERENCE = "reference"
    NOTABLE = "notable"
    FAILURE = "failure"
    BEFORE = "before"
    AFTER = "after"


class Confidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    REVIEW_REQUIRED = "review-required"


class Visibility(str, Enum):
    OWNER = "owner"
    DEPARTMENT = "department"
    COMPANY = "company"


class ModelFamily(str, Enum):
    """모델 계열 — '구조가 무엇인가'.

    ⚠ '어떤 해석인가'(lifting / static)는 이 축이 아니다. 그것은 향후
    RegisteredAnalysisRun.run_kind 의 몫이며, 두 축을 한 필드에 섞으면 되돌릴 수 없다.
    truss 는 아직 등록 경로(SourceArtifactKind)가 없어 어휘에만 예약돼 있다.
    """

    MODULE_UNIT = "module-unit"
    SIDE_PASSAGE = "side-passage"
    TRUSS = "truss"
    OTHER = "other"


MODEL_FAMILY_LABELS: dict[str, str] = {
    ModelFamily.MODULE_UNIT.value: "Module / Group Unit 구조",
    ModelFamily.SIDE_PASSAGE.value: "Side Passage 구조",
    ModelFamily.TRUSS.value: "Truss 구조",
    ModelFamily.OTHER.value: "기타",
}

# 값이 비었거나 어휘 밖인 레거시 model_type 을 담는 집계 버킷.
# 관리자가 명시적으로 고른 'other'(기타)와 절대 합치지 않는다.
UNASSIGNED_FAMILY_KEY = "unassigned"
UNASSIGNED_FAMILY_LABEL = "미분류"


class QualityLevel(str, Enum):
    """Q0 Raw / Q1 Parse Valid / Q2 Topology Valid / Q3 Solver Verified / Q4 Golden.

    Q4 는 자동 부여하지 않는다 — review_status == approved 인 명시적 검토에서만 설정한다.
    """

    Q0 = "Q0"
    Q1 = "Q1"
    Q2 = "Q2"
    Q3 = "Q3"
    Q4 = "Q4"


class ReviewStatus(str, Enum):
    UNREVIEWED = "unreviewed"
    APPROVED = "approved"
    REJECTED = "rejected"


class DesignOutcome(str, Enum):
    UNKNOWN = "unknown"
    PASS = "pass"
    FAIL = "fail"
    MIXED = "mixed"


class ModelStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


def normalize_tags(value: Optional[list[str]]) -> list[str]:
    """태그를 정규화한다: trim → 소문자 → 빈 값 제거 → 순서 보존 중복 제거 → 최대 20개.

    순수 함수라 스키마 밖에서도(서비스/테스트) 그대로 쓸 수 있다.
    """
    if not value:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for raw in value:
        if not isinstance(raw, str):
            continue
        tag = raw.strip().lower()[:MAX_TAG_LENGTH]
        if not tag or tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
        if len(out) >= MAX_TAGS:
            break
    return out


# --------------------------------------------------------------------------- #
# 요청
# --------------------------------------------------------------------------- #

class PreviewRequest(BaseModel):
    """등록 전 미리보기. 이 호출은 DB/스토리지를 절대 변경하지 않는다."""

    source_analysis_id: int
    artifact_kind: SourceArtifactKind


class RegisterRequest(BaseModel):
    source_analysis_id: int
    artifact_kind: SourceArtifactKind
    # 기존 모델에 새 revision 을 붙일 때 사용. None 이면 새 모델을 만든다.
    target_model_uid: Optional[str] = None

    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    model_type: Optional[str] = Field(default=None, max_length=100)
    model_role: Optional[ModelRole] = None
    confidence: Optional[Confidence] = None
    reuse_notes: Optional[str] = None
    visibility: Visibility = Visibility.COMPANY
    tags: list[str] = Field(default_factory=list)
    # 저장할 artifact 선택. bdf/summary/manifest 는 서버가 항상 포함한다.
    include_artifacts: list[StoredArtifactKind] = Field(default_factory=list)

    @field_validator("tags")
    @classmethod
    def _normalize_tags(cls, v: list[str]) -> list[str]:
        return normalize_tags(v)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        title = (v or "").strip()
        if not title:
            raise ValueError("제목은 비워 둘 수 없습니다.")
        return title


class ModelPatchRequest(BaseModel):
    """metadata 부분 갱신. 새 revision 을 만들지 않는다.

    model_dump(exclude_unset=True) 로 '보낸 필드만' 반영하는 계약이다.
    """

    title: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = None
    model_type: Optional[str] = Field(default=None, max_length=100)
    model_role: Optional[ModelRole] = None
    confidence: Optional[Confidence] = None
    reuse_notes: Optional[str] = None
    visibility: Optional[Visibility] = None
    tags: Optional[list[str]] = None
    review_status: Optional[ReviewStatus] = None

    @field_validator("tags")
    @classmethod
    def _normalize_tags(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        return None if v is None else normalize_tags(v)


# --------------------------------------------------------------------------- #
# 응답
# --------------------------------------------------------------------------- #

class SourceInfo(BaseModel):
    analysis_id: int
    program_name: Optional[str] = None
    artifact_kind: SourceArtifactKind
    file_name: str
    size_bytes: Optional[int] = None
    owner_id: Optional[str] = None


class AvailableArtifact(BaseModel):
    kind: StoredArtifactKind
    file_name: Optional[str] = None
    size_bytes: Optional[int] = None
    default_selected: bool = False


class DuplicateInfo(BaseModel):
    """이미 같은 BDF 가 등록되어 있을 때의 안내.

    status 를 반드시 함께 준다. 보관(archived) 상태면 사용자에게는 '삭제된' 것처럼 보이는데,
    bdf_sha256 이 전역 unique 라 재등록은 계속 막힌다. 이 경우 프론트는 '복원'을 제안해야 하며,
    status 없이는 그 분기를 만들 수 없다.
    """

    model_uid: Optional[str] = None
    revision: Optional[int] = None
    title: Optional[str] = None
    status: Optional[ModelStatus] = None


class PreviewResponse(BaseModel):
    source: SourceInfo
    summary: dict[str, Any]
    available_artifacts: list[AvailableArtifact]
    duplicate: Optional[DuplicateInfo] = None
    warnings: list[str] = Field(default_factory=list)


class RegisterResponse(BaseModel):
    model_uid: str
    revision: int
    quality_level: Optional[QualityLevel] = None
    status: ModelStatus
    registered_at: Optional[datetime] = None


class ArtifactResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    file_name: str
    size_bytes: Optional[int] = None
    sha256: Optional[str] = None
    media_type: Optional[str] = None


class RevisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    revision_no: int
    schema_version: str
    source_analysis_id: Optional[int] = None
    source_program_name: Optional[str] = None
    source_artifact_kind: Optional[str] = None
    bdf_sha256: str
    summary_json: Optional[dict[str, Any]] = None
    quality_level: Optional[str] = None
    review_status: Optional[str] = None
    design_outcome: Optional[str] = None
    node_count: Optional[int] = None
    element_count: Optional[int] = None
    total_mass_kg: Optional[float] = None
    max_utilization: Optional[float] = None
    created_at: Optional[datetime] = None
    artifacts: list[ArtifactResponse] = Field(default_factory=list)


class ModelListItem(BaseModel):
    """목록 행 — summary_json 전체는 싣지 않고 scalar 만 보낸다."""

    model_config = ConfigDict(from_attributes=True)

    model_uid: str
    title: str
    model_type: Optional[str] = None
    model_role: Optional[str] = None
    confidence: Optional[str] = None
    visibility: str
    tags: Optional[list[str]] = None
    owner_id: Optional[str] = None
    registered_by: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    latest_revision: Optional[int] = None
    quality_level: Optional[str] = None
    review_status: Optional[str] = None
    design_outcome: Optional[str] = None
    source_program_name: Optional[str] = None
    node_count: Optional[int] = None
    element_count: Optional[int] = None
    total_mass_kg: Optional[float] = None
    max_utilization: Optional[float] = None


class ModelListResponse(BaseModel):
    """기존 analysis history 와 같은 envelope 형태를 유지한다."""

    total: int
    skip: int
    limit: int
    items: list[ModelListItem]


class ModelDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_uid: str
    title: str
    description: Optional[str] = None
    model_type: Optional[str] = None
    model_role: Optional[str] = None
    confidence: Optional[str] = None
    reuse_notes: Optional[str] = None
    visibility: str
    tags: Optional[list[str]] = None
    owner_id: Optional[str] = None
    registered_by: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    revisions: list[RevisionResponse] = Field(default_factory=list)
