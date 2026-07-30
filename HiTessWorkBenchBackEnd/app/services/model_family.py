"""모델 계열(family) — 파생 규칙과 읽기 관용 정규화.

계열은 '구조가 무엇인가'다. 등록자가 자유 입력하던 값을 통제 어휘로 승격하면서,
**기계가 이미 아는 사실**(원 프로그램 + artifact 종류)에서 기본값을 파생한다.

순수 함수만 둔다 — DB/ORM/파일을 모른다.
"""
from __future__ import annotations

from typing import Any, Optional

from ..model_registry_schemas import (
    MODEL_FAMILY_LABELS,
    UNASSIGNED_FAMILY_KEY,
    UNASSIGNED_FAMILY_LABEL,
    ModelFamily,
    SourceArtifactKind,
)

# 프로그램 이름 → 계열. **정확 일치만** 본다.
# 부분일치로 넓히면 새 프로그램이 조용히 잘못 분류된다 — 조용한 오분류는 미분류보다 나쁘다.
PROGRAM_FAMILIES: dict[str, ModelFamily] = {
    "SidePassage": ModelFamily.SIDE_PASSAGE,
}

# 이 artifact 종류들은 모듈 유닛 구조에서 나온다.
MODULE_UNIT_KINDS = frozenset({
    SourceArtifactKind.MODELBUILDER_FINAL,
    SourceArtifactKind.MODELBUILDER_EDITED,
    SourceArtifactKind.MODELBUILDER_SOLVED,
    SourceArtifactKind.GROUPMODULE_ORIGINAL,
    SourceArtifactKind.MODULE_UNIT_EDITED,
    SourceArtifactKind.MODULE_UNIT_LIFTING,
})


def derive_model_family(program_name: Optional[str], artifact_kind: Any) -> ModelFamily:
    """등록 출처에서 계열을 파생한다.

    ★ **판정 순서가 계약이다. 프로그램 이름을 먼저 본다.**
    SidePassage 는 groupmodule_original / module_unit_edited / module_unit_lifting 을
    GroupModuleUnit 과 공유하므로(ARTIFACT_RULES.programs), kind 를 먼저 보면
    SidePassage 모델이 전부 module-unit 으로 빨려 들어간다.
    """
    mapped = PROGRAM_FAMILIES.get((program_name or "").strip())
    if mapped is not None:
        return mapped

    try:
        kind = SourceArtifactKind(artifact_kind)
    except ValueError:
        kind = None
    if kind is not None and kind in MODULE_UNIT_KINDS:
        return ModelFamily.MODULE_UNIT

    return ModelFamily.OTHER


def family_key(model_type: Optional[str]) -> str:
    """저장된 model_type → 집계 버킷 키.

    **읽기는 관용적이다** — 어휘 밖 레거시 값이나 빈 값을 지우지 않고,
    'other'(명시적 기타)에 섞지도 않고 'unassigned' 로 분리한다.
    """
    value = (model_type or "").strip()
    if value in MODEL_FAMILY_LABELS:
        return value
    return UNASSIGNED_FAMILY_KEY


def family_label(key: Optional[str]) -> str:
    """버킷 키 → 화면 라벨. 모르는 키는 '미분류'."""
    if not key:
        return UNASSIGNED_FAMILY_LABEL
    return MODEL_FAMILY_LABELS.get(key, UNASSIGNED_FAMILY_LABEL)
