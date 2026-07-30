"""모델 계열(family) 파생 규칙.

가장 중요한 계약: **판정 순서**. SidePassage 는 GroupModuleUnit 과 artifact_kind 를
공유하므로(ARTIFACT_RULES.programs), kind 를 먼저 보면 side-passage 가 사라진다.
"""
from app.model_registry_schemas import (
    UNASSIGNED_FAMILY_KEY,
    ModelFamily,
    SourceArtifactKind,
)
from app.services.model_family import derive_model_family, family_key, family_label


# --------------------------------------------------------------------------- #
# 파생 규칙
# --------------------------------------------------------------------------- #

def test_side_passage_wins_over_shared_module_unit_kind():
    """★ 순서 회귀 테스트 — 이게 깨지면 SidePassage 모델이 전부 module-unit 으로 빨려 들어간다."""
    for kind in (
        SourceArtifactKind.GROUPMODULE_ORIGINAL,
        SourceArtifactKind.MODULE_UNIT_EDITED,
        SourceArtifactKind.MODULE_UNIT_LIFTING,
    ):
        assert derive_model_family("SidePassage", kind) is ModelFamily.SIDE_PASSAGE


def test_modelbuilder_artifacts_are_module_unit():
    for kind in (
        SourceArtifactKind.MODELBUILDER_FINAL,
        SourceArtifactKind.MODELBUILDER_EDITED,
        SourceArtifactKind.MODELBUILDER_SOLVED,
    ):
        assert derive_model_family("HiTessModelBuilder", kind) is ModelFamily.MODULE_UNIT


def test_group_module_and_unit_structural_are_module_unit():
    assert derive_model_family(
        "GroupModuleUnit", SourceArtifactKind.MODULE_UNIT_EDITED,
    ) is ModelFamily.MODULE_UNIT
    assert derive_model_family(
        "UnitStructuralAnalysis", SourceArtifactKind.MODULE_UNIT_LIFTING,
    ) is ModelFamily.MODULE_UNIT


def test_unknown_program_and_kind_fall_back_to_other():
    """조용한 오분류보다 미분류가 낫다 — 부분일치로 넓히지 않는다."""
    assert derive_model_family("SidePassageV2", "some_new_kind") is ModelFamily.OTHER
    assert derive_model_family(None, None) is ModelFamily.OTHER


def test_artifact_kind_accepts_plain_string():
    """DB 에서 읽은 값은 enum 이 아니라 문자열이다."""
    assert derive_model_family(
        "HiTessModelBuilder", "modelbuilder_final",
    ) is ModelFamily.MODULE_UNIT


# --------------------------------------------------------------------------- #
# 읽기 관용 — 어휘 밖 레거시 값
# --------------------------------------------------------------------------- #

def test_family_key_keeps_vocabulary_values():
    assert family_key("module-unit") == "module-unit"
    assert family_key(" side-passage ") == "side-passage"
    assert family_key("other") == "other"


def test_legacy_and_empty_values_are_unassigned_not_other():
    """명시적 '기타'(other)와 미지정을 합치면 통계가 거짓말을 한다."""
    assert family_key("beam-frame") == UNASSIGNED_FAMILY_KEY
    assert family_key("") == UNASSIGNED_FAMILY_KEY
    assert family_key(None) == UNASSIGNED_FAMILY_KEY


def test_family_label_is_human_readable():
    assert family_label("module-unit") == "Module / Group Unit 구조"
    assert family_label("other") == "기타"
    assert family_label(UNASSIGNED_FAMILY_KEY) == "미분류"
    assert family_label(None) == "미분류"
