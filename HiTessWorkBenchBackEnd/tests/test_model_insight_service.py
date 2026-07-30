"""Model Registry — Insight 집계 테스트.

가장 중요한 계약:
1. 표본이 없으면 0 이 아니라 null 이고, sampleSize 를 항상 함께 낸다.
2. 단위가 다른 길이 값을 그대로 합산하지 않는다.
3. 품질(Q4)과 설계 결과(pass)를 한 KPI 로 합치지 않는다.
4. export 는 기본적으로 사번을 노출하지 않는다.
"""
from datetime import datetime

import pytest

from app.services.model_insight_service import (
    aggregate_registry_insights,
    build_dataset_readiness,
    build_export_rows,
    build_scoped_overview,
    describe,
)


def _revision(**kw):
    """기본값이 채워진 revision dict — 테스트마다 필요한 필드만 덮어쓴다."""
    summary = kw.pop("summary", None)
    base = {
        "model_uid": kw.pop("model_uid", "uid-1"),
        "revision_no": 1,
        "title": "모델",
        "model_type": "module-unit",
        "model_role": "reference",
        "tags": [],
        "source_program_name": "HiTessModelBuilder",
        "source_artifact_kind": "modelbuilder_final",
        "quality_level": "Q2",
        "review_status": "unreviewed",
        "design_outcome": "unknown",
        "status": "active",
        "node_count": None,
        "element_count": None,
        "total_mass_kg": None,
        "max_utilization": None,
        "owner_id": "EMP001",
        "registered_by": "ADMIN001",
        "created_at": datetime(2026, 7, 28, 12, 0, 0),
        "summary_json": summary if summary is not None else {
            "units": {"length": "mm"},
            "geometry": {},
            "modelQuality": {},
            "analysisOutcome": {},
        },
    }
    base.update(kw)
    return base


# --------------------------------------------------------------------------- #
# describe — null vs 0
# --------------------------------------------------------------------------- #

def test_describe_returns_null_stats_for_empty_sample():
    """★ 표본이 없으면 평균 0 이 아니라 null 이다."""
    stats = describe([])
    assert stats["sampleSize"] == 0
    for key in ("min", "max", "mean", "median"):
        assert stats[key] is None, f"{key} 는 표본이 없으면 null 이어야 한다"


def test_describe_ignores_none_but_keeps_zero():
    stats = describe([0, None, 0, None])
    assert stats["sampleSize"] == 2
    assert stats["mean"] == 0.0, "실제로 측정된 0 은 유효한 값이다"


def test_describe_reports_missing_against_total():
    stats = describe([1, None, 3], total=3)
    assert stats["sampleSize"] == 2
    assert stats["missing"] == 1


def test_describe_computes_median_for_even_and_odd():
    assert describe([1, 3, 5])["median"] == 3
    assert describe([1, 3, 5, 7])["median"] == 4


def test_describe_rejects_non_numeric_and_nan():
    stats = describe(["abc", None, float("nan"), 2])
    assert stats["sampleSize"] == 1
    assert stats["mean"] == 2.0


# --------------------------------------------------------------------------- #
# 빈 registry
# --------------------------------------------------------------------------- #

def test_empty_registry_reports_zero_counts_and_null_stats():
    result = aggregate_registry_insights([])

    assert result["totals"]["revisions"] == 0
    assert result["metrics"]["nodeCount"]["sampleSize"] == 0
    assert result["metrics"]["nodeCount"]["mean"] is None
    assert result["topTags"] == []
    assert result["recentTrend"] == []


def test_single_revision_still_reports_sample_size():
    result = aggregate_registry_insights([_revision(node_count=100)])
    node = result["metrics"]["nodeCount"]
    assert node["sampleSize"] == 1
    assert node["mean"] == 100.0
    assert node["missing"] == 0


# --------------------------------------------------------------------------- #
# 품질과 설계 결과는 별개 KPI
# --------------------------------------------------------------------------- #

def test_golden_and_design_pass_are_separate_kpis():
    """★ Q4(품질 승인)와 설계 pass 는 다른 축이므로 별도 KPI 로 보고한다.

    여기서 Q4 인 모델은 설계가 fail 이고, 설계 pass 인 모델은 Q2 다 — 두 집합이
    서로소인데도 각각 1 로 잡혀야 한다. 하나의 '좋은 모델 수' 로 합치면 이게 불가능하다.
    """
    revisions = [
        _revision(model_uid="a", quality_level="Q4", review_status="approved", design_outcome="fail"),
        _revision(model_uid="b", quality_level="Q2", design_outcome="pass"),
    ]

    totals = aggregate_registry_insights(revisions)["totals"]

    assert totals["goldenApproved"] == 1
    assert totals["designPass"] == 1
    # 두 KPI 는 서로 다른 키로 노출되어야 한다(합쳐진 단일 지표가 존재하면 안 된다).
    assert "goldenApproved" in totals and "designPass" in totals
    for key in totals:
        assert "quality" not in key.lower() or "outcome" not in key.lower(), (
            f"{key} 가 품질과 설계 결과를 한 지표로 합치고 있다"
        )


def test_failed_design_can_be_golden_quality():
    """설계 미통과 모델도 품질 Q4 일 수 있다(정확한 실패 예제)."""
    result = aggregate_registry_insights([
        _revision(quality_level="Q4", review_status="approved", design_outcome="fail"),
    ])
    quality = {d["key"]: d["count"] for d in result["distributions"]["qualityLevel"]}
    outcome = {d["key"]: d["count"] for d in result["distributions"]["designOutcome"]}
    assert quality["Q4"] == 1
    assert outcome["fail"] == 1


def test_quality_distribution_includes_all_levels_even_when_zero():
    """표본이 없는 등급도 0 으로 표시해 분포를 왜곡하지 않는다."""
    result = aggregate_registry_insights([_revision(quality_level="Q2")])
    keys = [d["key"] for d in result["distributions"]["qualityLevel"]]
    assert keys[:5] == ["Q0", "Q1", "Q2", "Q3", "Q4"]


def test_review_needed_counts_unreviewed():
    revisions = [
        _revision(model_uid="a", review_status="unreviewed"),
        _revision(model_uid="b", review_status="approved"),
        _revision(model_uid="c", review_status=None),
    ]
    assert aggregate_registry_insights(revisions)["totals"]["reviewNeeded"] == 2


def test_archived_excluded_from_active_count():
    revisions = [
        _revision(model_uid="a", status="active"),
        _revision(model_uid="b", status="archived"),
    ]
    totals = aggregate_registry_insights(revisions)["totals"]
    assert totals["active"] == 1
    assert totals["archived"] == 1


def test_models_counted_distinctly_from_revisions():
    revisions = [
        _revision(model_uid="a", revision_no=1),
        _revision(model_uid="a", revision_no=2),
        _revision(model_uid="b", revision_no=1),
    ]
    totals = aggregate_registry_insights(revisions)["totals"]
    assert totals["revisions"] == 3
    assert totals["models"] == 2


# --------------------------------------------------------------------------- #
# 단위 혼합 금지
# --------------------------------------------------------------------------- #

def _with_bbox(unit, span):
    return _revision(summary={
        "units": {"length": unit},
        "geometry": {"boundingBox": {
            "xMin": 0.0, "xMax": span, "yMin": 0.0, "yMax": 1.0, "zMin": 0.0, "zMax": 1.0,
        }},
        "modelQuality": {},
        "analysisOutcome": {},
    })


def test_length_metrics_never_mix_units():
    """★ mm 모델과 m 모델의 치수를 그대로 합산하지 않는다."""
    revisions = [
        _with_bbox("mm", 10000.0),
        _with_bbox("mm", 20000.0),
        _with_bbox("m", 15.0),          # 단위가 달라 제외되어야 함
    ]

    span = aggregate_registry_insights(revisions)["metrics"]["modelSpan"]

    assert span["unit"] == "mm"
    assert span["sampleSize"] == 2
    assert span["excludedForUnitMismatch"] == 1
    assert span["mean"] == 15000.0   # (10000+20000)/2 — 15.0 이 섞이지 않았다


def test_length_unit_distribution_is_reported():
    revisions = [_with_bbox("mm", 1.0), _with_bbox("m", 1.0)]
    units = {d["key"]: d["count"] for d in aggregate_registry_insights(revisions)["distributions"]["lengthUnit"]}
    assert units == {"mm": 1, "m": 1}


def test_model_span_is_null_when_no_bounding_box():
    result = aggregate_registry_insights([_revision()])
    assert result["metrics"]["modelSpan"]["sampleSize"] == 0
    assert result["metrics"]["modelSpan"]["mean"] is None


def test_mass_metric_declares_its_unit():
    result = aggregate_registry_insights([_revision(total_mass_kg=1000.0)])
    assert result["metrics"]["totalMassKg"]["unit"] == "kg"
    assert result["metrics"]["maxUtilization"]["unit"] == "ratio"


# --------------------------------------------------------------------------- #
# 품질 이슈 빈도
# --------------------------------------------------------------------------- #

def _with_quality(**issues):
    return _revision(summary={
        "units": {"length": "mm"},
        "geometry": {},
        "modelQuality": issues,
        "analysisOutcome": {},
    })


def test_quality_issue_frequency_counts_affected_models():
    revisions = [
        _with_quality(orphanNodeCount=3, isolatedNodeCount=0),
        _with_quality(orphanNodeCount=0, isolatedNodeCount=0),
        _with_quality(orphanNodeCount=1, isolatedNodeCount=2),
    ]

    issues = {i["key"]: i for i in aggregate_registry_insights(revisions)["qualityIssues"]}

    assert issues["orphanNodeCount"]["modelsAffected"] == 2
    assert issues["orphanNodeCount"]["measured"] == 3
    assert issues["orphanNodeCount"]["share"] == pytest.approx(2 / 3)
    assert issues["isolatedNodeCount"]["modelsAffected"] == 1


def test_quality_issue_share_is_null_when_never_measured():
    """측정된 적이 없으면 0% 가 아니라 null 이다."""
    issues = {i["key"]: i for i in aggregate_registry_insights([_revision()])["qualityIssues"]}
    assert issues["orphanNodeCount"]["measured"] == 0
    assert issues["orphanNodeCount"]["share"] is None


def test_free_end_nodes_are_not_treated_as_a_quality_issue():
    """freeEnd(degree=1)는 결함이 아니므로 이슈 목록에 없다."""
    keys = {i["key"] for i in aggregate_registry_insights([_revision()])["qualityIssues"]}
    assert "freeEndNodeCount" not in keys


# --------------------------------------------------------------------------- #
# 교차표 / 태그 / 추이
# --------------------------------------------------------------------------- #

def test_quality_by_outcome_crosstab_counts_and_disclaims_causation():
    revisions = [
        _revision(quality_level="Q3", design_outcome="pass"),
        _revision(quality_level="Q3", design_outcome="fail"),
        _revision(quality_level="Q1", design_outcome="fail"),
    ]

    cross = aggregate_registry_insights(revisions)["qualityByOutcome"]
    cells = {(c["quality"], c["outcome"]): c["count"] for c in cross["cells"]}

    assert cells[("Q3", "pass")] == 1
    assert cells[("Q3", "fail")] == 1
    assert cells[("Q1", "fail")] == 1
    assert cells[("Q0", "pass")] == 0
    # 상관을 인과로 읽지 않도록 명시한다.
    assert "인과" in cross["note"] or "뜻이 아닙니다" in cross["note"]


def test_top_tags_are_counted_and_normalized():
    revisions = [
        _revision(tags=["Lifting", "beam"]),
        _revision(tags=["lifting", "  "]),
        _revision(tags=None),
    ]
    tags = {t["tag"]: t["count"] for t in aggregate_registry_insights(revisions)["topTags"]}
    assert tags["lifting"] == 2
    assert tags["beam"] == 1
    assert "" not in tags


def test_recent_trend_groups_by_day():
    revisions = [
        _revision(created_at=datetime(2026, 7, 27, 9, 0)),
        _revision(created_at=datetime(2026, 7, 27, 18, 0)),
        _revision(created_at=datetime(2026, 7, 28, 9, 0)),
    ]
    trend = aggregate_registry_insights(revisions)["recentTrend"]
    assert trend == [
        {"date": "2026-07-27", "count": 2},
        {"date": "2026-07-28", "count": 1},
    ]


def test_recent_trend_accepts_iso_strings():
    trend = aggregate_registry_insights([
        _revision(created_at="2026-07-28T12:00:00Z"),
    ])["recentTrend"]
    assert trend == [{"date": "2026-07-28", "count": 1}]


def test_invalid_created_at_is_skipped_not_crashing():
    trend = aggregate_registry_insights([_revision(created_at="언제인지 모름")])["recentTrend"]
    assert trend == []


# --------------------------------------------------------------------------- #
# export — PII
# --------------------------------------------------------------------------- #

def test_export_excludes_employee_ids_by_default():
    """★ 기본 export 에는 사번이 없어야 한다."""
    rows = build_export_rows([_revision()])

    assert len(rows) == 1
    assert "owner_id" not in rows[0]
    assert "registered_by" not in rows[0]
    blob = str(rows[0])
    assert "EMP001" not in blob
    assert "ADMIN001" not in blob


def test_export_can_include_identity_when_explicitly_requested():
    rows = build_export_rows([_revision()], include_identity=True)
    assert rows[0]["owner_id"] == "EMP001"
    assert rows[0]["registered_by"] == "ADMIN001"


def test_export_carries_analysis_fields_and_serializes_dates():
    rows = build_export_rows([
        _revision(
            node_count=10, element_count=20, max_utilization=0.5,
            summary={
                "units": {"length": "mm"},
                "geometry": {"elementBreakdown": {"CBEAM": 20}},
                "modelQuality": {"orphanNodeCount": 0},
                "analysisOutcome": {"maxStressMPa": 100.0, "allowableStressMPa": 200.0},
            },
        ),
    ])
    row = rows[0]
    assert row["node_count"] == 10
    assert row["element_breakdown"] == {"CBEAM": 20}
    assert row["quality_issues"]["orphanNodeCount"] == 0
    assert row["max_stress_mpa"] == 100.0
    assert row["length_unit"] == "mm"
    assert row["created_at"] == "2026-07-28T12:00:00"


def test_export_is_empty_for_empty_registry():
    assert build_export_rows([]) == []


# --------------------------------------------------------------------------- #
# 데이터셋 준비도 — 기대를 부풀리지 않는 것이 이 절의 목적이다
# --------------------------------------------------------------------------- #

def test_readiness_reports_shortfall_instead_of_claiming_ready():
    """표본 20건으로 분류기가 '준비됨'이 되면 안 된다."""
    revisions = [
        _revision(model_uid=f"uid-{i}", design_outcome="pass") for i in range(20)
    ]
    readiness = build_dataset_readiness(revisions)

    tasks = {t["key"]: t for t in readiness["tasks"]}
    assert tasks["outcome-classifier"]["ready"] is False
    assert tasks["outcome-classifier"]["available"] == 20
    assert tasks["outcome-classifier"]["shortfall"] == 180
    # 표본이 적어도 검색은 색인이라 쓸 수 있다.
    assert tasks["similar-search"]["ready"] is False
    assert tasks["similar-search"]["shortfall"] == 10


def test_readiness_flags_class_imbalance_even_when_sample_is_large():
    """총량을 채워도 소수 클래스가 비면 학습해서는 안 된다."""
    revisions = [
        _revision(model_uid=f"uid-{i}", design_outcome="pass") for i in range(250)
    ]
    revisions += [_revision(model_uid="uid-fail", design_outcome="fail")]
    readiness = build_dataset_readiness(revisions)

    task = next(t for t in readiness["tasks"] if t["key"] == "outcome-classifier")
    assert task["available"] == 251
    assert task["shortfall"] == 0
    assert task["ready"] is False, "표본 수만 채웠다고 준비된 것이 아니다"
    assert task["blockers"], "치우침을 말해 주지 않으면 사용자가 알 수 없다"
    assert readiness["labels"]["designOutcome"]["minorityClass"] == 1


def test_readiness_does_not_count_unknown_outcome_as_a_label():
    """'미해석'은 정답이 아니다 — 라벨로 세면 데이터가 있는 것처럼 보인다."""
    revisions = [_revision(model_uid=f"uid-{i}") for i in range(10)]   # design_outcome=unknown
    readiness = build_dataset_readiness(revisions)
    assert readiness["labels"]["designOutcome"]["labeled"] == 0
    assert readiness["labels"]["designOutcome"]["unlabeled"] == 10


def test_readiness_feature_coverage_is_null_for_empty_registry():
    """표본이 0 이면 커버리지는 0% 가 아니라 정의되지 않음이다."""
    readiness = build_dataset_readiness([])
    assert readiness["sampleSize"] == 0
    for feature in readiness["features"]:
        assert feature["coverage"] is None


def test_readiness_feature_coverage_counts_present_values():
    revisions = [
        _revision(model_uid="uid-1", node_count=100),
        _revision(model_uid="uid-2", node_count=None),
    ]
    readiness = build_dataset_readiness(revisions)
    node = next(f for f in readiness["features"] if f["key"] == "node_count")
    assert node["present"] == 1
    assert node["missing"] == 1
    assert node["coverage"] == pytest.approx(0.5)


def test_readiness_warns_when_revisions_of_one_model_are_pooled():
    """같은 모델의 revision 이 학습/검증 양쪽에 들어가면 성능이 부풀려진다."""
    revisions = [
        _revision(model_uid="uid-1", revision_no=1),
        _revision(model_uid="uid-1", revision_no=2),
    ]
    readiness = build_dataset_readiness(revisions)
    assert readiness["distinctModels"] == 1
    assert any("revision" in c for c in readiness["caveats"])


def test_readiness_warns_about_undeclared_units():
    revisions = [_revision(model_uid="uid-1", summary={"units": {}, "geometry": {},
                                                       "modelQuality": {}, "analysisOutcome": {}})]
    readiness = build_dataset_readiness(revisions)
    assert any("단위" in c for c in readiness["caveats"])


def test_insight_overview_embeds_dataset_readiness():
    result = aggregate_registry_insights([_revision()])
    assert "datasetReadiness" in result
    assert result["datasetReadiness"]["sampleSize"] == 1


# --------------------------------------------------------------------------- #
# 스코프 투영 — 전체 통계와 계열 통계는 다른 질문에 답한다
# --------------------------------------------------------------------------- #

def test_scoped_overview_puts_each_block_in_exactly_one_scope():
    """전체 전용 블록과 계열 전용 블록이 양쪽에 동시에 나타나면 안 된다."""
    result = build_scoped_overview([_revision()])

    assert set(result["overall"]) == {
        "totals", "distributions", "topTags", "recentTrend", "dataHygiene",
    }
    assert set(result["family"]) == {
        "metrics", "qualityIssues", "qualityByOutcome", "datasetReadiness",
    }


def test_scoped_overview_defaults_to_largest_family():
    revisions = [
        _revision(model_uid="u1", model_type="module-unit"),
        _revision(model_uid="u2", model_type="module-unit"),
        _revision(model_uid="u3", model_type="side-passage"),
    ]

    result = build_scoped_overview(revisions)

    assert result["scope"]["family"] == "module-unit"
    assert result["scope"]["familyCount"] == 2
    assert result["scope"]["sampleSize"] == {"overall": 3, "family": 2}


def test_scoped_overview_keeps_overall_totals_when_family_selected():
    """계열을 골라도 상단은 전체 모집단이다 — 스코프가 섞이지 않는다."""
    revisions = [
        _revision(model_uid="u1", model_type="module-unit", node_count=100),
        _revision(model_uid="u2", model_type="side-passage", node_count=900),
    ]

    result = build_scoped_overview(revisions, family="side-passage")

    assert result["overall"]["totals"]["revisions"] == 2
    assert result["family"]["metrics"]["nodeCount"]["sampleSize"] == 1
    assert result["family"]["metrics"]["nodeCount"]["max"] == 900


def test_scoped_overview_unknown_family_returns_empty_scope_not_error():
    result = build_scoped_overview([_revision()], family="truss")

    assert result["scope"]["family"] == "truss"
    assert result["family"]["metrics"]["nodeCount"]["sampleSize"] == 0
    assert result["family"]["metrics"]["nodeCount"]["mean"] is None


def test_scoped_overview_separates_unassigned_from_explicit_other():
    """명시적 '기타'와 어휘 밖 레거시 값을 한 버킷에 담으면 통계가 거짓말을 한다."""
    revisions = [
        _revision(model_uid="u1", model_type="other"),
        _revision(model_uid="u2", model_type="beam-frame"),   # 옛 자유 입력
        _revision(model_uid="u3", model_type=None),
    ]

    keys = {f["key"]: f["count"] for f in build_scoped_overview(revisions)["families"]}

    assert keys == {"unassigned": 2, "other": 1}


def test_scoped_overview_hygiene_and_readiness_go_to_different_scopes():
    result = build_scoped_overview([_revision()])

    hygiene = result["overall"]["dataHygiene"]
    readiness = result["family"]["datasetReadiness"]

    assert hygiene["features"]           # 피처 커버리지 = 데이터 위생 → 전체
    assert "extractorVersion" in hygiene
    assert readiness["tasks"]            # 학습 과제 표본 → 계열
    assert "features" not in readiness   # 중복 노출 금지
    assert "split" not in readiness


def test_scoped_overview_returns_null_family_for_empty_registry():
    result = build_scoped_overview([])

    assert result["family"] is None
    assert result["families"] == []
    assert result["overall"]["totals"]["revisions"] == 0


def test_readiness_warns_when_families_are_pooled():
    """라우터를 거치지 않는 직접 호출에서도 침묵하지 않는다."""
    revisions = [
        _revision(model_uid="u1", model_type="module-unit"),
        _revision(model_uid="u2", model_type="side-passage"),
    ]

    caveats = " ".join(build_dataset_readiness(revisions)["caveats"])

    assert "계열" in caveats
