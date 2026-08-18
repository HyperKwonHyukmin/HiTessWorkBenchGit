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


# ── 조용한 누락 금지 ────────────────────────────────────────────────────
# 계산서가 입력을 말없이 빠뜨리면 결재자가 그 사실을 알 방법이 없다.

def _result_fields(payload):
    doc = generic_adapter(payload, _meta())
    return next(s for s in doc.sections if s.key == "result").fields


def test_scalar_list_is_joined_into_one_field():
    fields = _result_fields({"input": {}, "result": {"loads": [1, 2, 3]}, "output": None})
    loads = next(f for f in fields if f.label == "loads")
    assert loads.value == "1, 2, 3"
    assert not any(f.label == "생략된 항목" for f in fields)


def test_long_scalar_list_is_trimmed_with_a_note():
    fields = _result_fields({"input": {}, "result": {"loads": list(range(30))}, "output": None})
    loads = next(f for f in fields if f.label == "loads")
    assert loads.value.startswith("0, 1, 2")
    assert loads.note == "상위 20개만 표시 (전체 30개)"


def test_mixed_list_is_recorded_as_omitted_instead_of_vanishing():
    fields = _result_fields({"input": {}, "result": {"odd": [1, {"a": 2}]}, "output": None})
    omitted = next(f for f in fields if f.label == "생략된 항목")
    assert omitted.value == "odd"


def test_deeply_nested_dict_is_recorded_as_omitted():
    payload = {"input": {}, "result": {"meta": {"flat": 5, "inner": {"deep": 1}}}, "output": None}
    fields = _result_fields(payload)
    assert next(f for f in fields if f.label == "meta.flat").value == 5
    assert next(f for f in fields if f.label == "생략된 항목").value == "meta.inner"


def test_empty_containers_produce_neither_field_nor_omission_note():
    fields = _result_fields({"input": {}, "result": {"a": [], "b": {}}, "output": None})
    assert fields == ()
