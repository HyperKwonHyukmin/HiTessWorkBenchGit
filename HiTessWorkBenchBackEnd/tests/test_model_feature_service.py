"""Model Library — 피처 / 코호트 / 분할 모듈 테스트.

지켜야 할 계약:
1. **'해당 없음'과 '결측'은 다르다.** 스키마가 낮아 애초에 못 뽑는 피처를 결측으로 세면
   "데이터를 더 모으면 채워진다"는 잘못된 결론이 나온다(실제 조치는 재등록이다).
2. 코호트는 **무엇이 왜 빠졌는지**를 결과와 함께 들고 다닌다.
3. 분할은 `model_uid` 를 절대 쪼개지 않는다. 난수를 쓰지 않아 재현 가능하다.
"""
import pytest

from app.services.model_feature_service import (
    FEATURE_EXTRACTOR_VERSION,
    FEATURES_BY_KEY,
    build_cohort,
    categorical_similarity,
    composition_similarity,
    feature_coverage,
    feature_row,
    group_kfold,
    ratio_similarity,
    split_report,
)


def _rev(schema="1.1", uid="uid-1", **kw):
    summary = kw.pop("summary", None)
    base = {
        "model_uid": uid,
        "revision_no": 1,
        "schema_version": schema,
        "model_type": "module-unit",
        "source_program_name": "HiTessModelBuilder",
        "design_outcome": "pass",
        "node_count": 100,
        "element_count": 120,
        "total_mass_kg": 5000.0,
        "summary_json": summary if summary is not None else {
            "units": {"length": "mm"},
            "geometry": {
                "nodeCount": 100,
                "elementCount": 120,
                "rigidElementCount": 4,
                "pointMassCount": 2,
                "boundingBox": {
                    "xMin": 0, "xMax": 1000, "yMin": 0, "yMax": 500, "zMin": 0, "zMax": 200,
                },
                "elementBreakdown": {"BEAM": 100, "RBE2": 20},
            },
            "modelQuality": {"solverRan": True},
            "physicalProperties": {"totalMassKg": 5000.0},
            "inputAudit": {"conversionRate": 0.95},
            "buildStages": {"stageCount": 6},
            "diagnostics": {"counts": {"warning": 12}},
        },
    }
    base.update(kw)
    return base


# --------------------------------------------------------------------------- #
# 스키마 인지 — 이 모듈의 존재 이유
# --------------------------------------------------------------------------- #

def test_old_schema_features_are_not_applicable_not_missing():
    """1.0 추출기는 totalMassKg 를 항상 비워 뒀다 — 그건 결측이 아니라 '해당 없음'이다."""
    old = _rev(schema="1.0", summary={"units": {"length": "mm"}, "geometry": {}})
    row = feature_row(old)

    assert "total_mass_kg" not in row["values"], "값 자체가 들어가면 결측과 구분되지 않는다"
    assert "total_mass_kg" in row["notApplicable"]
    # 1.0 에도 있던 피처는 정상적으로 뽑힌다.
    assert "node_count" in row["values"]


def test_coverage_denominator_excludes_non_applicable_revisions():
    """분모가 전체면 '1.1 로는 100% 채워졌다'는 사실이 통계에 묻힌다."""
    revisions = [_rev(schema="1.0", uid="old"), _rev(schema="1.1", uid="new")]
    mass = next(f for f in feature_coverage(revisions) if f["key"] == "total_mass_kg")

    assert mass["notApplicable"] == 1
    assert mass["applicable"] == 1
    assert mass["present"] == 1
    assert mass["coverage"] == pytest.approx(1.0), "적용 대상 안에서는 100% 다"


def test_coverage_is_none_when_nothing_is_applicable():
    revisions = [_rev(schema="1.0", uid="a"), _rev(schema="1.0", uid="b")]
    mass = next(f for f in feature_coverage(revisions) if f["key"] == "total_mass_kg")
    assert mass["applicable"] == 0
    assert mass["coverage"] is None, "0% 로 쓰면 '측정했더니 전부 비었다'로 읽힌다"


def test_schema_versions_compare_numerically_not_lexically():
    """'1.10' 은 '1.9' 보다 높다. 문자열 비교면 반대로 판정된다."""
    spec = FEATURES_BY_KEY["total_mass_kg"]
    assert spec.applies_to(_rev(schema="1.10"))
    assert spec.applies_to(_rev(schema="1.1"))
    assert not spec.applies_to(_rev(schema="1.0"))


def test_feature_row_records_extractor_version():
    """어느 추출기로 뽑았는지 없으면 나중에 데이터셋을 섞어도 알 수 없다."""
    assert feature_row(_rev())["extractorVersion"] == FEATURE_EXTRACTOR_VERSION


def test_revision_without_schema_is_treated_as_the_first_contract():
    row = feature_row(_rev(schema=None, summary={"units": {}, "geometry": {}}))
    assert row["schemaVersion"] == "1.0"


# --------------------------------------------------------------------------- #
# 코호트 — 빠진 이유를 들고 다닌다
# --------------------------------------------------------------------------- #

def test_cohort_reports_why_rows_were_excluded():
    revisions = [
        _rev(uid="ok"),
        _rev(uid="no-unit", summary={"units": {}, "geometry": {}, "modelQuality": {}}),
        _rev(uid="no-label", design_outcome="unknown"),
    ]
    cohort = build_cohort(revisions, require_length_unit=True, require_design_label=True)

    assert cohort.size == 1
    reasons = {e["reason"] for e in cohort.excluded}
    assert any("단위" in r for r in reasons)
    assert any("라벨" in r for r in reasons)
    assert sum(e["count"] for e in cohort.excluded) == 2


def test_cohort_without_filters_keeps_everything():
    revisions = [_rev(uid=f"uid-{i}") for i in range(3)]
    cohort = build_cohort(revisions)
    assert cohort.size == 3
    assert cohort.excluded == []


def test_cohort_dominant_unit_drops_the_odd_ones_out():
    mm = [_rev(uid=f"mm-{i}") for i in range(3)]
    m = _rev(uid="m-1", summary={"units": {"length": "m"}, "geometry": {}, "modelQuality": {}})
    cohort = build_cohort(mm + [m], dominant_unit_only=True)
    assert cohort.size == 3
    assert any("지배 단위" in e["reason"] for e in cohort.excluded)


def test_cohort_carries_its_filters_and_extractor_version():
    payload = build_cohort([_rev()], require_length_unit=True).to_dict()
    assert payload["filters"]["requireLengthUnit"] is True
    assert payload["extractorVersion"] == FEATURE_EXTRACTOR_VERSION


# --------------------------------------------------------------------------- #
# 분할 — 누수 방지
# --------------------------------------------------------------------------- #

def test_group_kfold_never_splits_one_model_across_folds():
    revisions = (
        [_rev(uid="A", revision_no=i) for i in range(1, 4)]
        + [_rev(uid="B", revision_no=i) for i in range(1, 3)]
        + [_rev(uid=f"C{i}") for i in range(6)]
    )
    folds = group_kfold(revisions, k=3)

    fold_of = {}
    for fold_idx, fold in enumerate(folds):
        for i in fold:
            uid = revisions[i]["model_uid"]
            assert fold_of.setdefault(uid, fold_idx) == fold_idx, (
                f"{uid} 의 revision 이 여러 fold 에 걸쳤다 — 성능이 부풀려진다"
            )


def test_group_kfold_is_deterministic():
    revisions = [_rev(uid=f"uid-{i}") for i in range(10)]
    assert group_kfold(revisions, k=3) == group_kfold(revisions, k=3)


def test_group_kfold_covers_every_row_exactly_once():
    revisions = [_rev(uid=f"uid-{i % 4}") for i in range(11)]
    folds = group_kfold(revisions, k=3)
    flat = sorted(i for fold in folds for i in fold)
    assert flat == list(range(11))


def test_group_kfold_rejects_meaningless_k():
    with pytest.raises(ValueError):
        group_kfold([_rev()], k=1)


def test_split_report_proves_no_leakage():
    revisions = [_rev(uid="A"), _rev(uid="A", revision_no=2), _rev(uid="B")]
    report = split_report(revisions, k=2)
    assert report["distinctModels"] == 2
    assert report["groupOverlap"] == 0
    assert report["leakageFree"] is True


def test_rows_without_uid_do_not_get_pooled_together():
    """uid 가 없는 행끼리 한 그룹으로 묶이면 서로 남남인데도 같은 fold 에 갇힌다."""
    revisions = [_rev(uid=None) for _ in range(6)]
    folds = group_kfold(revisions, k=3)
    assert all(len(f) > 0 for f in folds), "각자 독립 그룹이라 고르게 퍼져야 한다"


# --------------------------------------------------------------------------- #
# 유사도 기본 연산
# --------------------------------------------------------------------------- #

def test_ratio_similarity_is_scale_free_and_readable():
    assert ratio_similarity(100, 100) == 1.0
    assert ratio_similarity(90, 100) == pytest.approx(0.9)
    # 규모가 달라도 비율이 같으면 같은 값 — 설명 가능한 성질
    assert ratio_similarity(900, 1000) == pytest.approx(0.9)


def test_ratio_similarity_returns_none_when_a_side_is_missing():
    assert ratio_similarity(None, 100) is None
    assert ratio_similarity(100, None) is None


def test_ratio_similarity_treats_both_zero_as_identical():
    assert ratio_similarity(0, 0) == 1.0


def test_composition_similarity_ignores_scale():
    """같은 비율로 이루어졌으면 규모가 10배여도 같은 구성이다."""
    a = {"BEAM": 100, "RBE2": 20}
    b = {"BEAM": 1000, "RBE2": 200}
    assert composition_similarity(a, b) == pytest.approx(1.0)


def test_composition_similarity_drops_when_types_differ():
    a = {"BEAM": 100}
    b = {"QUAD4": 100}
    assert composition_similarity(a, b) == pytest.approx(0.0)


def test_composition_similarity_is_none_without_data():
    assert composition_similarity(None, {"BEAM": 1}) is None
    assert composition_similarity({}, {"BEAM": 1}) is None


def test_categorical_similarity_never_guesses():
    assert categorical_similarity("a", "a") == 1.0
    assert categorical_similarity("a", "b") == 0.0
    # 모른다는 것을 0(다르다)으로 쓰지 않는다
    assert categorical_similarity(None, "a") is None
    assert categorical_similarity("", "a") is None
