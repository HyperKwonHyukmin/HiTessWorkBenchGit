"""Program registry and its read-side integration contracts."""
from datetime import datetime

from app import models
from app.services.program_registry import (
    PROGRAM_SPECS,
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
