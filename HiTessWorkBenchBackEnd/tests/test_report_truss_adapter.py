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


def test_verdict_is_unknown_when_no_element_declares_a_result():
    """판정 근거가 없으면 합격이라 단정하지 않는다.

    result 키가 없으면 5배 과응력이어도 any_fail 은 False 다. 그걸 합격으로 찍으면
    없는 데이터로 결재를 통과시키는 셈이다.
    """
    payload = _payload()
    payload["output"]["loadCases"] = [
        {"loadCaseId": 1, "elements": [{"element": 11, "assessment": 5.0}]}
    ]
    assert get_adapter("truss-assessment")(payload, _meta()).verdict is None


def test_verdict_is_unknown_when_every_load_case_is_empty():
    payload = _payload()
    payload["output"]["loadCases"] = [{"loadCaseId": 1, "elements": []}]
    assert get_adapter("truss-assessment")(payload, _meta()).verdict is None


def test_extra_element_keys_are_kept_as_columns():
    """허용응력 같은 '비율의 근거'가 고정 투영에 잘려 나가면 안 된다."""
    payload = _payload()
    payload["output"]["loadCases"] = [{
        "loadCaseId": 1,
        "elements": [{
            "element": 11, "axial": 100.0, "allowAxial": 250.0,
            "assessment": 0.4, "result": "OK", "note": "x",
        }],
    }]
    table = next(
        s for s in get_adapter("truss-assessment")(payload, _meta()).sections
        if s.key == "result"
    ).tables[0]
    assert table.columns == ("element", "axial", "allowAxial", "assessment", "result", "note")


def test_boolean_assessment_does_not_pollute_the_worst_value():
    payload = _payload()
    payload["output"]["loadCases"] = [{
        "loadCaseId": 1,
        "elements": [{"element": 11, "assessment": True, "result": "OK"}],
    }]
    fields = next(
        s for s in get_adapter("truss-assessment")(payload, _meta()).sections
        if s.key == "result"
    ).fields
    assert not any(f.label == "최대 Assessment" for f in fields)


def test_load_case_without_an_id_is_labelled_explicitly():
    payload = _payload()
    payload["output"]["loadCases"] = [{"elements": [{"element": 1, "result": "OK"}]}]
    table = next(
        s for s in get_adapter("truss-assessment")(payload, _meta()).sections
        if s.key == "result"
    ).tables[0]
    assert table.title == "Load Case (미지정)"


def test_generic_adapter_still_emits_the_result_section_we_replace():
    """delegate-then-replace 는 generic 이 'result' 섹션을 낸다는 전제 위에 있다.

    generic 이 그 키를 바꾸면 이 어댑터는 예외 없이 조용히 무력화된다 — 표도 판정도
    사라진 채 generic 결과만 나간다. 런타임에 못 알아채니 여기서 고정한다.
    """
    from app.services.report.adapters.generic import generic_adapter

    base = generic_adapter({"input": {}, "result": {}, "output": None}, _meta())
    assert any(section.key == "result" for section in base.sections)


def test_generic_omission_notices_survive_the_result_swap():
    """result 섹션만 갈아끼우고 notices 를 떨어뜨리면 조용한 누락으로 되돌아간다.

    truss 어댑터는 loadCases 만 해결한다. input 이나 output 의 다른 키를 generic 이
    펴지 못했다면 그 사실은 계속 남아야 한다.
    """
    payload = _payload()
    payload["input"]["weird"] = [1, {"a": 2}]  # generic 이 표로도 값으로도 못 펴는 모양

    doc = get_adapter("truss-assessment")(payload, _meta())

    assert doc.notices == ("입력 조건에서 생략됨: weird",)


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
