"""Program registry and its read-side integration contracts."""
from datetime import datetime

import pytest

from app import models
from app.services.program_registry import (
    PROGRAM_SPECS,
    ProgramSpec,
    aliases_for,
    internal_substep_programs,
    resolve_program,
)


def test_registry_is_unambiguous_and_covers_persisted_program_names():
    aliases = [alias.casefold() for spec in PROGRAM_SPECS for alias in spec.aliases]
    assert len(aliases) == len(set(aliases))

    observed_names = {
        "TrussModelBuilder",
        "Truss Assessment",
        "BDF Scanner",
        "F06 Parser",
        "MooringFitting",
        "MooringFittingSolve",
        "HiTessModelBuilder",
        "ModelBuilderAnalysis",
        "Simple Beam Assessment",
        "GroupModuleUnit",
        "SidePassage",
        "선급 Rule 기반 선체 가속도 Calculation",
        "DrawingToAnalysis",
        "PlateStructureAnalysis",
        "Plate Structure Analysis",
        "DoublePipeFuelLine",
        "IndependentTankAssessment",
        "BlockWeldAssessment",
        "Heavy Block Lifting Simulation",
        "Carling Free Calculator",
        "Carling Design Optimization",
        "Column Buckling Load Calculator",
        "Mast Post Assessment",
        "Jib Rest Assessment (1단)",
        "Jib Rest Assessment (2단)",
        "D Type Lug Assessment",
        "Simplified Hole Fatigue Assessment",
        "Section Property Calculator",
        "ModuleStability",
        "ModuleHoistOptimize",
        "UnitStructuralAnalysis",
    }
    assert all(resolve_program(name) is not None for name in observed_names)


def test_solve_variants_are_known_but_not_rerunnable():
    model_solve = resolve_program("ModelBuilderAnalysis")
    mooring_solve = resolve_program("MooringFittingSolve")
    assert model_solve.rerun_adapter is None
    assert mooring_solve.rerun_adapter is None
    assert model_solve.statistics_group == "model-builder-analysis"
    assert mooring_solve.statistics_group == "mooring-fitting-solve"
    assert resolve_program("HiTESS Model Builder").rerun_adapter == "model-builder"
    assert resolve_program("Mooring Fitting Assessment").rerun_adapter == "mooring-fitting"
    assert aliases_for("ModelBuilderAnalysis") == ("ModelBuilderAnalysis",)
    assert set(aliases_for("MooringFitting")) == {
        "MooringFitting",
        "Mooring Fitting Assessment",
    }
    assert aliases_for("MooringFittingSolve") == ("MooringFittingSolve",)


def test_internal_substeps_are_derived_from_registry():
    assert set(internal_substep_programs()) == {
        "ModuleStability",
        "ModuleHoistOptimize",
        "UnitStructuralAnalysis",
    }


def test_program_stats_are_exact_by_default_and_support_explicit_aliases(admin_client, db_session):
    for name in ("BDF Scanner", "BdfScanner"):
        db_session.add(models.Analysis(
            employee_id="ADMIN001",
            program_name=name,
            status="Success",
            source="Workbench",
            created_at=datetime(2026, 7, 28, 12, 0),
        ))
    db_session.commit()

    response = admin_client.get("/api/analysis/stats/program/BDF%20Scanner")

    assert response.status_code == 200
    assert response.json()["summary"]["total"] == 1
    assert aliases_for("BDF Scanner") == ("BDF Scanner", "BdfScanner")

    aliased = admin_client.get(
        "/api/analysis/stats/program/BDF%20Scanner",
        params={"aliases": "BdfScanner"},
    )
    assert aliased.status_code == 200
    assert aliased.json()["summary"]["total"] == 2


def test_program_summary_rows_match_exact_detail_counts_for_solve_variants(
    admin_client,
    db_session,
):
    for name in ("HiTessModelBuilder", "HiTessModelBuilder", "ModelBuilderAnalysis"):
        db_session.add(models.Analysis(
            employee_id="ADMIN001",
            program_name=name,
            status="Success",
            source="Workbench",
            created_at=datetime(2026, 7, 28, 12, 0),
        ))
    db_session.commit()

    summary_response = admin_client.get(
        "/api/analysis/all",
        params={"include_summary": "true"},
    )

    assert summary_response.status_code == 200
    summary_rows = {
        row["name"]: row["count"]
        for row in summary_response.json()["summary"]["programRows"]
    }
    assert summary_rows["HiTessModelBuilder"] == 2
    assert summary_rows["ModelBuilderAnalysis"] == 1

    for name, expected in (
        ("HiTessModelBuilder", 2),
        ("ModelBuilderAnalysis", 1),
    ):
        detail = admin_client.get(f"/api/analysis/stats/program/{name}")
        assert detail.status_code == 200
        assert detail.json()["summary"]["total"] == expected
        assert detail.json()["summary"]["total"] == summary_rows[name]


def test_history_item_key_set_remains_unchanged(admin_client, db_session):
    record = models.Analysis(
        job_id="history-contract-job",
        project_name="contract",
        program_name="BDF Scanner",
        employee_id="ADMIN001",
        status="Success",
        input_info={},
        result_info={},
        source="Workbench",
    )
    db_session.add(record)
    db_session.commit()

    response = admin_client.get("/api/analysis/history/ADMIN001")

    assert response.status_code == 200
    assert set(response.json()["items"][0]) == {
        "id",
        "job_id",
        "project_name",
        "program_name",
        "employee_id",
        "status",
        "job_status",
        "progress",
        "job_message",
        "input_info",
        "result_info",
        "source",
        "created_at",
        "started_at",
        "updated_at",
        "files_available",
    }


def test_spec_defaults_report_fields_to_none():
    spec = resolve_program("BDF Scanner")
    assert spec is not None
    assert spec.report_adapter is None
    assert spec.report_template is None


def test_truss_assessment_declares_a_report_adapter():
    spec = resolve_program("Truss Structural Assessment")
    assert spec is not None
    assert spec.report_adapter == "truss-assessment"
    assert "report" in spec.capabilities


def test_model_builders_are_not_report_targets():
    """모델을 만드는 App 은 계산서 대상이 아니다.

    성과물이 BDF·모델이라 result_info 가 경로 매니페스트뿐이고, 실제로
    HiTessModelBuilder 리포트의 '해석 결과' 시트는 필드가 0개로 비어 있었다.
    """
    for name in ("HiTessModelBuilder", "TrussModelBuilder", "DrawingToAnalysis", "BDF Scanner"):
        spec = resolve_program(name)
        assert spec is not None, name
        assert spec.report_scope == "not-applicable", name


def test_internal_substeps_are_never_report_targets():
    """이력에도 안 보이는 내부 단계가 계산서 목록에 뜨면 안 된다."""
    for spec in PROGRAM_SPECS:
        if not spec.history_visible:
            assert spec.report_scope == "not-applicable", spec.program_id


def test_calculator_apps_are_report_targets():
    for name in (
        "Carling Free Calculator", "Column Buckling Load Calculator",
        "Mast Post Assessment", "Jib Rest Assessment", "D Type Lug Assessment",
        "Simplified Hole Fatigue Assessment", "Section Property Calculator",
        "Simple Beam Assessment", "Truss Structural Assessment",
    ):
        spec = resolve_program(name)
        assert spec is not None, name
        assert spec.report_scope == "supported", name


def test_report_scope_rejects_an_unknown_value():
    with pytest.raises(ValueError):
        ProgramSpec(
            program_id="x", display_name="X", aliases=("X",),
            capabilities=frozenset(), report_scope="maybe",
        )


def test_simple_beam_analyzer_is_a_known_alias():
    """이력에 실제로 저장된 이름이다 — 미등록이면 program_id 가 'unknown' 이 된다."""
    spec = resolve_program("Simple Beam Analyzer")
    assert spec is not None
    assert spec.program_id == "simple-beam"


def test_hitess_modelflow_is_registered():
    """Success 51건이 쌓여 있는데 레지스트리에 없어 'unknown' 으로 떨어지던 App."""
    spec = resolve_program("HiTessModelFlow")
    assert spec is not None
    assert spec.report_scope == "not-applicable"


def test_property_calculators_declare_no_verdict():
    """허용하중·단면 특성 산출은 합격/불합격을 내는 해석이 아니다.

    이런 App 에 주황색 '판정 미확정' 을 띄우면 도구가 고장 난 것처럼 보인다.
    """
    for name in ("Column Buckling Load Calculator", "Section Property Calculator"):
        spec = resolve_program(name)
        assert spec is not None, name
        assert spec.verdict_kind == "none", name


def test_assessment_apps_require_a_verdict():
    """판정이 있어야 정상인 App — 비어 있으면 '확인 필요' 라는 진짜 신호가 된다."""
    for name in ("Truss Structural Assessment", "Mast Post Assessment", "D Type Lug Assessment"):
        spec = resolve_program(name)
        assert spec is not None, name
        assert spec.verdict_kind == "required", name


def test_verdict_kind_rejects_an_unknown_value():
    with pytest.raises(ValueError):
        ProgramSpec(
            program_id="x", display_name="X", aliases=("X",),
            capabilities=frozenset(), verdict_kind="probably",
        )
