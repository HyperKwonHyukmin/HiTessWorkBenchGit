"""generic 어댑터 — 어떤 App 이든 표준 섹션으로 편다."""
from app.services.report.adapters import get_adapter
from app.services.report.adapters.generic import generic_adapter
from app.services.report.models import ReportMeta


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="column-buckling",
        display_name="Column Buckling Load Calculator",
        analysis_id=7,
        project_name="ColumnBuckling_20260818",
        employee_id="EMP001",
        created_at=None,
        status="Success",
    )


def test_builds_overview_input_and_result_sections():
    payload = {
        "input": {"length_mm": 3000, "sectionName": "H-300x300"},
        "result": {"maxWorkingLoadTon": 12.5},
        "output": None,
    }
    doc = generic_adapter(payload, _meta())

    keys = [s.key for s in doc.ordered_sections()]
    assert keys[:3] == ["overview", "input", "result"]

    input_labels = {f.label for f in next(s for s in doc.sections if s.key == "input").fields}
    assert input_labels == {"length_mm", "sectionName"}


def test_file_path_keys_are_excluded_from_the_input_and_result_sections():
    payload = {
        "input": {"bdf_model": "C:/x/model.bdf", "mesh_size": 50},
        "result": {"output_json": "C:/x/out.json", "assessment": 0.9},
        "output": None,
    }
    doc = generic_adapter(payload, _meta())

    input_labels = {f.label for f in next(s for s in doc.sections if s.key == "input").fields}
    result_labels = {f.label for f in next(s for s in doc.sections if s.key == "result").fields}

    assert input_labels == {"mesh_size"}
    assert result_labels == {"assessment"}


def test_list_of_dicts_becomes_a_table():
    payload = {
        "input": {},
        "result": {
            "candidates": [
                {"name": "A", "weight": 1.0},
                {"name": "B", "weight": 2.0},
            ]
        },
        "output": None,
    }
    doc = generic_adapter(payload, _meta())
    result = next(s for s in doc.sections if s.key == "result")

    assert len(result.tables) == 1
    table = result.tables[0]
    assert table.title == "candidates"
    assert table.columns == ("name", "weight")
    assert table.rows == (("A", 1.0), ("B", 2.0))


def test_verdict_is_read_from_common_keys():
    payload = {"input": {}, "result": {"assessment": "PASS"}, "output": None}
    doc = generic_adapter(payload, _meta())
    assert doc.verdict == "합격"


def test_verdict_is_none_when_no_known_key_exists():
    payload = {"input": {}, "result": {"someNumber": 3}, "output": None}
    doc = generic_adapter(payload, _meta())
    assert doc.verdict is None


def test_output_json_contributes_a_result_table():
    payload = {
        "input": {},
        "result": {},
        "output": {"members": [{"id": 1, "stress": 120.0}]},
    }
    doc = generic_adapter(payload, _meta())
    result = next(s for s in doc.sections if s.key == "result")
    assert result.tables[0].title == "members"


def test_get_adapter_falls_back_to_generic_for_unknown_key():
    assert get_adapter(None) is generic_adapter
    assert get_adapter("no-such-adapter") is generic_adapter
