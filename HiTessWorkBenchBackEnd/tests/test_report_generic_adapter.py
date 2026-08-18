"""generic 어댑터 — 어떤 App 이든 표준 섹션으로 편다."""
import pytest

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
# 생략 사실은 필드가 아니라 문서 수준 notices 로 올라간다(표지 '유의 사항').

def _result_fields(payload):
    doc = generic_adapter(payload, _meta())
    return next(s for s in doc.sections if s.key == "result").fields


def test_scalar_list_is_joined_into_one_field():
    doc = generic_adapter({"input": {}, "result": {"loads": [1, 2, 3]}, "output": None}, _meta())
    fields = next(s for s in doc.sections if s.key == "result").fields
    assert next(f for f in fields if f.label == "loads").value == "1, 2, 3"
    assert doc.notices == ()


def test_long_scalar_list_is_trimmed_with_a_note():
    fields = _result_fields({"input": {}, "result": {"loads": list(range(30))}, "output": None})
    loads = next(f for f in fields if f.label == "loads")
    assert loads.value.startswith("0, 1, 2")
    assert loads.note == "상위 20개만 표시 (전체 30개)"


def test_float_list_is_not_written_with_binary_repr_artifacts():
    fields = _result_fields({"input": {}, "result": {"vals": [0.1 + 0.2]}, "output": None})
    assert next(f for f in fields if f.label == "vals").value == "0.3"


def test_mixed_list_becomes_a_document_notice_instead_of_vanishing():
    doc = generic_adapter({"input": {}, "result": {"odd": [1, {"a": 2}]}, "output": None}, _meta())
    assert doc.notices == ("해석 결과에서 생략됨: odd",)


def test_rows_of_empty_dicts_become_a_document_notice():
    doc = generic_adapter({"input": {}, "result": {"rows": [{}, {}]}, "output": None}, _meta())
    assert doc.notices == ("해석 결과에서 생략됨: rows",)


def test_deeply_nested_dict_becomes_a_document_notice():
    payload = {"input": {}, "result": {"meta": {"flat": 5, "inner": {"deep": 1}}}, "output": None}
    doc = generic_adapter(payload, _meta())
    fields = next(s for s in doc.sections if s.key == "result").fields
    assert next(f for f in fields if f.label == "meta.flat").value == 5
    assert doc.notices == ("해석 결과에서 생략됨: meta.inner",)


def test_result_and_output_omissions_merge_into_one_notice():
    payload = {"input": {}, "result": {"a": [1, {"x": 1}]}, "output": {"b": [1, {"y": 2}]}}
    doc = generic_adapter(payload, _meta())
    assert doc.notices == ("해석 결과에서 생략됨: a, b",)


def test_input_and_result_omissions_are_separate_notices():
    payload = {"input": {"x": [1, {"a": 2}]}, "result": {"y": [1, {"b": 2}]}, "output": None}
    doc = generic_adapter(payload, _meta())
    assert doc.notices == ("입력 조건에서 생략됨: x", "해석 결과에서 생략됨: y")


def test_empty_containers_produce_neither_field_nor_notice():
    doc = generic_adapter({"input": {}, "result": {"a": [], "b": {}}, "output": None}, _meta())
    assert next(s for s in doc.sections if s.key == "result").fields == ()
    assert doc.notices == ()


# ── 판정 감지 ───────────────────────────────────────────────────────────
# 실제 서비스가 내보내는 문자열로 검증한다. 정확 일치만 보면 전부 공란이 된다.

def _verdict(value):
    return generic_adapter({"input": {}, "result": {"assessment": value}, "output": None}, _meta()).verdict


def test_verdict_matches_carling_total_ok():
    """carling_service._assessment_from_checks 는 'Total OK' 를 내보낸다."""
    assert _verdict("Total OK") == "합격"


def test_verdict_does_not_mistake_not_ok_for_ok():
    """가장 위험한 오류 — 불합격을 합격으로 뒤집으면 안 된다."""
    assert _verdict("Not OK") == "불합격"


def test_verdict_ng_matches_only_as_a_whole_token():
    assert _verdict("NG") == "불합격"
    assert _verdict("bending governs") is None


def test_verdict_reads_warning_and_plain_words():
    assert _verdict("WARNING") == "경고"
    assert _verdict("pass") == "합격"
    assert _verdict("불합격") == "불합격"


@pytest.mark.parametrize(
    "value",
    ["not safe", "not pass", "not passed", "NOT PASS", "Not-Safe",
     "does not pass", "not 합격", "not 적합", "no ok", "never safe"],
)
def test_negated_positive_words_are_never_read_as_pass(value):
    """부정어가 앞선 긍정 토큰은 전부 불합격이다.

    'not ok' 만 리터럴로 막으면 긍정 토큰이 하나 늘 때마다 구멍이 하나 늘어난다.
    합격으로 새는 것이 이 기능의 최악 실패라 토큰 규칙으로 막고 여기서 고정한다.
    """
    assert _verdict(value) == "불합격"


@pytest.mark.parametrize("value", ["not applicable", "not tested", "not run"])
def test_negated_non_verdict_words_stay_unknown(value):
    """부정어가 붙었다고 아무 문장이나 불합격으로 만들지는 않는다."""
    assert _verdict(value) is None
