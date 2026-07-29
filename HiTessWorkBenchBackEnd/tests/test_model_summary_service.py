"""Model Registry — summary 추출 테스트.

가장 중요한 두 계약:
1. 모델 품질(modelQuality)과 설계 결과(analysisOutcome)는 분리된다.
   응력 초과 모델도 파싱/토폴로지가 깨끗하면 높은 품질등급을 받는다.
2. 소스에 없는 값은 null 이다. 0 으로 채우면 통계가 조용히 오염된다.
"""
import pytest

from app.model_registry_schemas import SUMMARY_SCHEMA_VERSION
from app.services.model_summary_service import (
    build_summary,
    derive_quality_level,
    extract_analysis_outcome,
    extract_build_stages,
    extract_diagnostics,
    extract_geometry,
    extract_input_audit,
    extract_model_quality,
    extract_physical_properties,
    extract_units,
)


def _model_json(**overrides):
    base = {
        "meta": {"unit": "mm", "schemaVersion": "1.2"},
        "nodes": [
            {"id": 1, "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": 2, "x": 100.0, "y": 50.0, "z": -20.0},
        ],
        "elements": [
            {"id": 1, "type": "CBEAM"},
            {"id": 2, "type": "CBEAM"},
            {"id": 3, "type": "CBAR"},
        ],
        "rigids": [{"id": 1}, {"id": 2, "weights": [1.0]}],
        "properties": [{"id": 1, "card": "PBEAM"}],
        "materials": [{"id": 1}],
        "pointMasses": [{"id": 1, "nodeId": 1, "mass": 12.5}],
        "healthMetrics": {"issues": {}},
        "elementQuality": {},
        "connectivity": {"groupCount": 1},
    }
    base.update(overrides)
    return base


# --------------------------------------------------------------------------- #
# geometry
# --------------------------------------------------------------------------- #

def test_geometry_counts_and_breakdown():
    g = extract_geometry(_model_json())

    assert g["nodeCount"] == 2
    assert g["elementCount"] == 3
    assert g["rigidElementCount"] == 2
    assert g["pointMassCount"] == 1
    assert g["elementBreakdown"]["CBEAM"] == 2
    assert g["elementBreakdown"]["CBAR"] == 1
    # rigids 는 구조로 RBE2/RBE3 를 추정한다(transform_to_step1 과 동일 휴리스틱).
    assert g["elementBreakdown"]["RBE2"] == 1
    assert g["elementBreakdown"]["RBE3"] == 1


def test_geometry_bounding_box_is_none_without_nodes():
    assert extract_geometry(_model_json(nodes=[]))["boundingBox"] is None


def test_geometry_bounding_box_values():
    bbox = extract_geometry(_model_json())["boundingBox"]
    assert bbox["xMin"] == 0.0 and bbox["xMax"] == 100.0
    assert bbox["zMin"] == -20.0 and bbox["zMax"] == 0.0


# --------------------------------------------------------------------------- #
# units — 추정 금지
# --------------------------------------------------------------------------- #

def test_units_length_declared_but_force_and_mass_stay_null():
    u = extract_units(_model_json(), None)
    assert u["length"] == "mm"
    assert u["force"] is None
    assert u["mass"] is None
    assert u["confidence"] == "partial"


def test_units_unknown_when_nothing_declared():
    u = extract_units(_model_json(meta={}), None)
    assert u["length"] is None
    assert u["confidence"] == "unknown"


def test_units_stress_declared_from_analysis_result():
    u = extract_units(
        _model_json(), {"evaluation": {"structuralAllowableMPa": 235.0}},
    )
    assert u["stress"] == "MPa"
    assert u["confidence"] == "declared"


# --------------------------------------------------------------------------- #
# physicalProperties — null vs 0
# --------------------------------------------------------------------------- #

def test_total_mass_stays_null_because_unit_is_not_declared():
    """CONM2 합은 있지만 단위계가 선언되지 않아 kg 로 단정하지 않는다."""
    p = extract_physical_properties(_model_json(), None)
    assert p["totalMassKg"] is None
    assert p["pointMassSumRaw"] == 12.5


def test_point_mass_sum_is_null_when_no_point_masses():
    p = extract_physical_properties(_model_json(pointMasses=[]), None)
    assert p["pointMassSumRaw"] is None, "질량이 없으면 0 이 아니라 null 이어야 한다"


def test_cog_read_from_validation_json():
    p = extract_physical_properties(
        _model_json(),
        {"input": {"centerOfGravityMm": {"x": 1.0, "y": 2.0, "z": 3.0}}},
    )
    assert p["centerOfGravityMm"] == {"x": 1.0, "y": 2.0, "z": 3.0}


def test_cog_is_null_when_incomplete():
    p = extract_physical_properties(
        _model_json(), {"input": {"centerOfGravityMm": {"x": 1.0, "y": 2.0}}},
    )
    assert p["centerOfGravityMm"] is None


# --------------------------------------------------------------------------- #
# modelQuality + 등급
# --------------------------------------------------------------------------- #

def test_clean_model_without_solver_is_q2():
    q = extract_model_quality(_model_json())
    assert q["qualityLevel"] == "Q2"
    assert q["totalErrors"] == 0


def test_clean_model_with_clean_solver_run_is_q3():
    q = extract_model_quality(_model_json(), solver_ran=True, nastran_fatal=False)
    assert q["qualityLevel"] == "Q3"


def test_solver_fatal_does_not_reach_q3():
    q = extract_model_quality(_model_json(), solver_ran=True, nastran_fatal=True)
    assert q["qualityLevel"] == "Q2"


def test_parse_failure_is_q0():
    q = extract_model_quality(_model_json(), parse_ok=False)
    assert q["qualityLevel"] == "Q0"


@pytest.mark.parametrize(
    "issue_key", ["orphanNodeCount", "isolatedNodeCount", "zeroLengthElementCount"],
)
def test_topology_defects_drop_to_q1(issue_key):
    q = extract_model_quality(_model_json(healthMetrics={"issues": {issue_key: 3}}))
    assert q["qualityLevel"] == "Q1"


def test_disconnected_groups_drop_to_q1():
    q = extract_model_quality(_model_json(connectivity={"groupCount": 3}))
    assert q["disconnectedGroupCount"] == 2
    assert q["qualityLevel"] == "Q1"


def test_short_elements_are_warnings_not_errors():
    """짧은 요소는 경고일 뿐 토폴로지 결함이 아니므로 등급을 떨어뜨리지 않는다."""
    q = extract_model_quality(_model_json(elementQuality={"shortElementCount": 5}))
    assert q["shortElementCount"] == 5
    assert q["totalErrors"] == 0
    assert q["qualityLevel"] == "Q2"


def test_free_end_nodes_are_recorded_but_never_downgrade_quality():
    """freeEnd(degree=1) 는 orphan/isolated 와 의미가 다르다 — 결함이 아니다."""
    q = extract_model_quality(
        _model_json(healthMetrics={"issues": {"freeEndNodeCount": 9}}),
    )
    assert q["freeEndNodeCount"] == 9
    assert q["orphanNodeCount"] == 0
    assert q["qualityLevel"] == "Q2"


def test_q4_is_never_assigned_automatically():
    for solver in (True, False):
        for fatal in (True, False):
            q = extract_model_quality(
                _model_json(), solver_ran=solver, nastran_fatal=fatal,
            )
            assert q["qualityLevel"] != "Q4"
    assert derive_quality_level({"parseStatus": "pass", "solverRan": True}) != "Q4"


# --------------------------------------------------------------------------- #
# analysisOutcome — 품질과 분리
# --------------------------------------------------------------------------- #

def test_outcome_unknown_without_analysis():
    o = extract_analysis_outcome(None)
    assert o["outcome"] == "unknown"
    assert o["maxUtilization"] is None
    assert o["memberExceedCount"] is None, "해석이 없으면 0 이 아니라 null 이어야 한다"


def test_outcome_pass_and_utilization():
    o = extract_analysis_outcome({
        "evaluation": {"structuralAllowableMPa": 200.0},
        "summary": {
            "memberMaxStressMPa": 100.0,
            "memberExceedCount": 0,
            "wireCompressionCount": 0,
        },
    })
    assert o["outcome"] == "pass"
    assert o["maxUtilization"] == pytest.approx(0.5)


def test_outcome_fail_when_members_exceed():
    o = extract_analysis_outcome({
        "evaluation": {"structuralAllowableMPa": 200.0},
        "summary": {"memberMaxStressMPa": 260.0, "memberExceedCount": 4},
    })
    assert o["outcome"] == "fail"
    assert o["maxUtilization"] == pytest.approx(1.3)


def test_outcome_mixed_when_only_wire_compression():
    o = extract_analysis_outcome({
        "evaluation": {"structuralAllowableMPa": 200.0},
        "summary": {
            "memberMaxStressMPa": 50.0,
            "memberExceedCount": 0,
            "wireCompressionCount": 2,
        },
    })
    assert o["outcome"] == "mixed"


# --------------------------------------------------------------------------- #
# build_summary 통합
# --------------------------------------------------------------------------- #

def test_failed_design_can_still_be_high_quality_model():
    """★ 핵심 계약 — 설계 fail 이 모델 품질을 끌어내리지 않는다."""
    summary = build_summary(
        model_json=_model_json(),
        analysis_result={
            "evaluation": {"structuralAllowableMPa": 200.0},
            "summary": {"memberMaxStressMPa": 400.0, "memberExceedCount": 12},
        },
    )

    assert summary["analysisOutcome"]["outcome"] == "fail"
    assert summary["modelQuality"]["qualityLevel"] == "Q3"


def test_summary_has_required_sections_and_schema_version():
    summary = build_summary(model_json=_model_json())
    for key in (
        "schemaVersion", "model", "provenance", "units",
        "geometry", "physicalProperties", "modelQuality", "analysisOutcome",
        "inputAudit", "buildStages", "diagnostics",
    ):
        assert key in summary
    assert summary["schemaVersion"] == SUMMARY_SCHEMA_VERSION


def test_summary_keeps_absent_sections_as_none_not_empty():
    """소스가 없으면 None 이다. {} 로 채우면 '측정했는데 0건'처럼 읽힌다."""
    summary = build_summary(model_json=_model_json())
    assert summary["inputAudit"] is None
    assert summary["buildStages"] is None


def test_summary_does_not_embed_node_or_element_arrays():
    """요약에 전체 노드/요소 배열을 중복 저장하지 않는다."""
    summary = build_summary(model_json=_model_json())
    blob = str(summary)
    assert "nodes" not in summary["geometry"]
    assert "elements" not in summary["geometry"]
    assert len(blob) < 4000


def test_summary_does_not_leak_absolute_paths():
    summary = build_summary(
        model_json=_model_json(),
        provenance={"sourceAnalysisId": 1, "sourceFileName": "model.bdf"},
    )
    blob = str(summary)
    assert "C:\\" not in blob and "\\\\storage" not in blob


def test_fatal_solver_run_still_registers_with_separated_axes():
    summary = build_summary(
        model_json=_model_json(),
        analysis_result={"meta": {"hasFatal": True}, "summary": {}},
    )
    assert summary["modelQuality"]["nastranFatal"] is True
    assert summary["modelQuality"]["qualityLevel"] == "Q2"
    assert summary["analysisOutcome"]["outcome"] == "unknown"


# --------------------------------------------------------------------------- #
# 파일을 열지 않고도 읽히는 요약 — 입력 감사 / 단계 요약 / 진단
# --------------------------------------------------------------------------- #

def _audit_json():
    return {
        "meta": {"unit": "mm"},
        "inputFiles": [
            {
                "kind": "Structure",
                # 서버 절대경로 — 승격되면 안 된다.
                "path": r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection\x\stru.csv",
                "exists": True,
                "header": ["name", "type", "pos"],
                "physicalLineCount": 1232,
                "dataRowCount": 1231,
                "blankDataRowCount": 0,
            },
        ],
        "summary": {
            "totalDataRows": 1000,
            "convertedRows": 900,
            "ignoredRows": 80,
            "errorRows": 20,
            "parseFailedRows": 0,
            "blankRows": 0,
            "ambiguousDuplicateSourceNameRows": 3,
            "ignoredByReason": {"NotStructural": 50, "ZeroDiameter": 30},
        },
        # 수만 건짜리 원문 — 요약에 실리면 안 된다.
        "rowAudit": [{"rawLine": "secret,row,data"} for _ in range(50)],
    }


def test_input_audit_summarizes_without_leaking_paths_or_raw_rows():
    audit = extract_input_audit(_audit_json())

    assert audit["files"][0]["fileName"] == "stru.csv"
    blob = str(audit)
    assert "C:\\" not in blob
    assert "secret,row,data" not in blob

    assert audit["totals"]["convertedRows"] == 900
    assert audit["totals"]["ambiguousNameRows"] == 3
    assert audit["conversionRate"] == pytest.approx(0.9)
    # 제외 사유는 많은 순으로 잘라서 준다 — 어떤 사유가 지배적인지가 판단 근거다.
    assert audit["topIgnoredReasons"][0] == {"reason": "NotStructural", "count": 50}


def test_input_audit_conversion_rate_is_none_when_denominator_missing():
    """분모가 없으면 비율은 정의되지 않는다. 0% 로 쓰면 '전부 버려졌다'로 읽힌다."""
    audit = extract_input_audit({"summary": {"convertedRows": 5}})
    assert audit["conversionRate"] is None


def test_input_audit_returns_none_without_source():
    assert extract_input_audit(None) is None


def _stage_json():
    return {
        "meta": {"unit": "mm"},
        "summary": {
            "stageCount": 2,
            "firstStage": "Preprocess",
            "lastStage": "Validation",
            "finalNodeCount": 9893,
            "finalElementCount": 10027,
            "finalRigidCount": 482,
            "finalPointMassCount": 240,
            "totalErrors": 0,
            "totalWarnings": 11691,
            "totalInfos": 307,
            "massProperties": {
                "totalMassTon": 102.5,
                "beamMassTon": 90.1,
                "pointMassTon": 12.4,
                "centerOfGravityMm": [84984.7, 4921.8, 38686.4],
            },
        },
        "stages": [
            {
                "stageIndex": 1, "stageName": "Preprocess",
                "counts": {"nodes": 4165, "elements": 3188, "rigids": 263, "pointMasses": 240},
                "delta": {"netNodeDelta": 310, "netElementDelta": 303},
                "connectivity": {"groupCount": 717},
                "diagnostics": {"error": 0, "warning": 12},
            },
            {
                "stageIndex": 2, "stageName": "Validation",
                "counts": {"nodes": 9893, "elements": 10027, "rigids": 482, "pointMasses": 240},
                "delta": {"netNodeDelta": 5728, "netElementDelta": 6839},
                "connectivity": {"groupCount": 1},
                "diagnostics": {"error": 0, "warning": 3},
            },
        ],
    }


def test_build_stages_exposes_per_stage_growth():
    stages = extract_build_stages(_stage_json())

    assert stages["stageCount"] == 2
    assert stages["totals"]["warnings"] == 11691
    assert stages["final"]["nodeCount"] == 9893
    assert [s["name"] for s in stages["stages"]] == ["Preprocess", "Validation"]
    assert stages["stages"][1]["nodeCount"] == 9893
    assert stages["stages"][1]["groupCount"] == 1
    assert stages["truncated"] is False


def test_declared_ton_mass_is_promoted_to_kg_with_its_source():
    """필드명에 단위가 박힌 값(totalMassTon)은 추정이 아니라 선언이다."""
    physical = extract_physical_properties(_model_json(), None, _stage_json())

    assert physical["totalMassKg"] == pytest.approx(102_500.0)
    assert physical["beamMassKg"] == pytest.approx(90_100.0)
    assert physical["massSource"] == "stage-summary"
    assert physical["centerOfGravityMm"]["x"] == pytest.approx(84984.7)


def test_mass_stays_null_without_a_declared_source():
    physical = extract_physical_properties(_model_json(), None, None)
    assert physical["totalMassKg"] is None
    assert physical["massSource"] is None


def test_validation_cog_wins_over_stage_summary_cog():
    """검증 JSON 의 COG 가 더 구체적인 소스다 — 있으면 그것을 쓴다."""
    validation = {"input": {"centerOfGravityMm": {"x": 1.0, "y": 2.0, "z": 3.0}}}
    physical = extract_physical_properties(_model_json(), validation, _stage_json())
    assert physical["centerOfGravityMm"] == {"x": 1.0, "y": 2.0, "z": 3.0}


def test_diagnostics_group_by_code_with_one_sample_message():
    model = _model_json()
    model["diagnostics"] = [
        {"severity": "warning", "code": "SHORT_ELEM", "message": "요소가 짧습니다 #1"},
        {"severity": "warning", "code": "SHORT_ELEM", "message": "요소가 짧습니다 #2"},
        {"severity": "error", "code": "ORPHAN", "message": "미참조 GRID"},
    ]
    diagnostics = extract_diagnostics(model)

    top = {d["code"]: d for d in diagnostics["topCodes"]}
    assert top["SHORT_ELEM"]["count"] == 2
    # 대표 메시지는 첫 등장 하나만 — 수만 건을 모두 싣지 않는다.
    assert top["SHORT_ELEM"]["sampleMessage"] == "요소가 짧습니다 #1"
    assert diagnostics["counts"]["error"] == 1
    assert diagnostics["distinctCodes"] == 2


def test_diagnostics_is_none_when_engine_reported_nothing():
    assert extract_diagnostics(_model_json()) is None
