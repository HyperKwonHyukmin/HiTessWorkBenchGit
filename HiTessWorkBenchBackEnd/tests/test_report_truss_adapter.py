"""truss-assessment 어댑터 — Load Case 중첩을 표로 편다."""
from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="truss-assessment",
        display_name="Truss Assessment",
        analysis_id=3,
        project_name="truss-p",
        employee_id="EMP001",
        created_at=None,
        status="Success",
    )


def _payload() -> dict:
    return {
        "input": {"bdf_model": "C:/x/m.bdf"},
        "result": {"output_json": "C:/x/out.json"},
        "output": {
            "loadCases": [
                {
                    "loadCaseId": 1,
                    "elements": [
                        {"element": 11, "assessment": 0.42, "result": "OK"},
                        {"element": 12, "assessment": 1.31, "result": "FAIL"},
                    ],
                },
                {
                    "loadCaseId": 2,
                    "elements": [{"element": 11, "assessment": 0.20, "result": "OK"}],
                },
            ]
        },
    }


def test_registered_under_its_registry_key():
    assert get_adapter("truss-assessment") is not get_adapter("no-such-adapter")


def test_makes_one_table_per_load_case():
    doc = get_adapter("truss-assessment")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")

    assert [t.title for t in result.tables] == ["Load Case 1", "Load Case 2"]
    assert result.tables[0].columns == ("element", "assessment", "result")
    assert result.tables[0].rows[1] == (12, 1.31, "FAIL")


def test_verdict_is_fail_when_any_element_fails():
    doc = get_adapter("truss-assessment")(_payload(), _meta())
    assert doc.verdict == "불합격"


def test_summary_field_reports_the_worst_assessment():
    doc = get_adapter("truss-assessment")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    worst = next(f for f in result.fields if f.label == "최대 Assessment")
    assert worst.value == 1.31


def test_verdict_is_pass_when_every_element_is_ok():
    payload = _payload()
    payload["output"]["loadCases"] = [
        {"loadCaseId": 1, "elements": [{"element": 11, "assessment": 0.42, "result": "OK"}]}
    ]
    doc = get_adapter("truss-assessment")(payload, _meta())
    assert doc.verdict == "합격"


def test_missing_output_falls_back_to_an_empty_result_section():
    payload = {"input": {}, "result": {}, "output": None}
    doc = get_adapter("truss-assessment")(payload, _meta())
    result = next(s for s in doc.sections if s.key == "result")
    assert result.tables == ()
    assert doc.verdict is None


def test_every_declared_report_adapter_is_actually_registered():
    """레지스트리 오타는 조용히 generic 으로 떨어져 알아챌 수 없다.

    get_adapter 는 모르는 키를 generic 으로 폴백한다 — 신규 App 이 등록 없이도
    리포트가 나오게 하려는 의도지만, 그 탓에 report_adapter="truss-assesment" 같은
    오타도 그냥 밋밋한 리포트가 되어 버린다. 여기서 고정한다.
    """
    from app.services.program_registry import PROGRAM_SPECS
    from app.services.report.adapters import ADAPTERS

    declared = {spec.report_adapter for spec in PROGRAM_SPECS if spec.report_adapter}
    assert declared <= set(ADAPTERS), f"ADAPTERS 에 없는 report_adapter: {declared - set(ADAPTERS)}"
