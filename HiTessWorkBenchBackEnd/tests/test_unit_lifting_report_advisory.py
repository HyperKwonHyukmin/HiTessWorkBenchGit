"""보고서 — Advisory 모드로 자세안정성 FAIL 인 채 해석한 결과를 알린다(2026-11-18).

상세 레포트: '먼저 확인할 사항' 맨 앞 줄, 판정 기준 표의 평가 모드. 결과 레포트(사내 서식): 주의 사항 5번째 줄.
"""
import io
import json
import os
import shutil

from openpyxl import load_workbook

from app.services.unit_lifting_report import result_report as RR
from app.services.unit_lifting_report.collector import ADVISORY_ACTION, collect, ReportOptions
from app.services.unit_lifting_report_service import generate_result_report, generate_unit_lifting_report

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"


def _copy_fixture(tmp_path, mode, fail):
    for name in os.listdir(FIX):
        if name.startswith(STEM):
            shutil.copy(os.path.join(FIX, name), tmp_path / name)
    posture_path = tmp_path / f"{STEM}_posture.json"
    posture = json.loads(posture_path.read_text(encoding="utf-8"))
    posture["evaluationMode"] = mode
    posture["strictEvaluation"] = mode == "strict"
    posture_path.write_text(json.dumps(posture, ensure_ascii=False), encoding="utf-8")
    if fail:
        stab_path = tmp_path / f"{STEM}_stability.json"
        stab = json.loads(stab_path.read_text(encoding="utf-8"))
        stab["overall"]["status"] = "fail"
        us = stab["overall"].setdefault("userSummary", {})
        us["primaryMessage"] = "현재 권상 조건은 그대로 진행하기 어렵습니다. 아래 핵심 문제를 먼저 수정하세요."
        us["criticalIssues"] = [{"stage": 7, "target": "Lug N101", "headline": "SWL 초과", "message": "슬링 하중이 SWL 을 넘습니다."}]
        for s in stab["stages"]:
            if s.get("stage") == 6:
                s["status"] = "fail"
                (s.setdefault("summary", {}))["isStable"] = False
        stab_path.write_text(json.dumps(stab, ensure_ascii=False), encoding="utf-8")
    return {
        "nastranResultJson": str(tmp_path / f"{STEM}_lifting_nastranResult.json"),
        "stabilityJson": str(tmp_path / f"{STEM}_stability.json"),
        "liftingMetaJson": str(tmp_path / f"{STEM}_lifting_meta.json"),
        "bdf": str(tmp_path / f"{STEM}.bdf"),
    }


def test_collector_reads_mode_and_flags_advisory(tmp_path):
    d = collect(_copy_fixture(tmp_path, "advisory", fail=True), ReportOptions())
    assert d.stability.evaluation_mode == "advisory"
    assert d.stability.advisory_unmet is True
    assert d.verdicts.actions[0] == ADVISORY_ACTION
    # 보고서 판정은 WARN, 엔진 판정 값은 그대로 FAIL(2026-11-26 사용자 지시)
    assert d.verdicts.stability == "warn"
    assert d.stability.overall_status == "fail"


def test_detail_report_writes_warn_not_fail_for_advisory(tmp_path):
    info = _copy_fixture(tmp_path, "advisory", fail=True)
    _name, data, _w, summary = generate_unit_lifting_report(info, {}, generated_by="A476854")
    assert summary["stability"] == "warn"
    ws = load_workbook(io.BytesIO(data))["Report"]
    cells = [str(c.value) for row in ws.iter_rows() for c in row if c.value is not None]
    assert "FAIL" not in cells                       # 표지 판정 칸, 7단계 표의 판정 칸
    joined = "\n".join(cells)
    assert "종합 판정: WARN (Advisory)" in joined
    assert "자세 안정성: WARN" in joined             # 6. 결론
    assert "엔진 7단계 종합 판정 (Advisory: WARN 기록)" in joined
    assert "그대로 진행하기 어렵습니다" not in joined     # 엔진 FAIL 문장은 WARN 옆에 붙이지 않는다
    assert "[엔진 FAIL 항목] [7단계 · Lug N101] SWL 초과" in joined   # 핵심 문제는 따로 남긴다


def test_fail_with_standard_posture_still_flags_report(tmp_path):
    # 리뷰 '막아야 함'(2026-11-19): Standard 로 평가한 FAIL 을 Advisory 로 바꿔 바로 해석하면 posture 는 standard 그대로다.
    info = _copy_fixture(tmp_path, "standard", fail=True)
    d = collect(info, ReportOptions())
    assert d.stability.advisory_unmet is True
    assert d.stability.evaluation_mode == "advisory"
    assert d.verdicts.actions[0] == ADVISORY_ACTION
    assert d.verdicts.stability == "warn"
    _name, data, _w, _s = generate_result_report(info, {}, generated_by="A476854")
    ws = load_workbook(io.BytesIO(data))["Report"]
    assert ws[f"F{RR.NOTICE_EXTRA_ROW}"].value == RR.NOTICE_ADVISORY_LINE


def test_collector_standard_pass_unchanged(tmp_path):
    d = collect(_copy_fixture(tmp_path, "standard", fail=False), ReportOptions())
    assert d.stability.evaluation_mode == "standard"
    assert d.stability.advisory_unmet is False
    assert not any("Advisory" in a for a in d.verdicts.actions)
    assert d.stability.report_status("fail") == "fail"   # Advisory 가 아니면 바꾸지 않는다


def test_result_report_notice_row_shows_advisory_and_warns_lost_user_line(tmp_path):
    info = _copy_fixture(tmp_path, "advisory", fail=True)
    _name, data, warnings, _s = generate_result_report(info, {"extraNotice": "러그 육안 검사"}, generated_by="A476854")
    ws = load_workbook(io.BytesIO(data))["Report"]
    assert ws[f"F{RR.NOTICE_EXTRA_ROW}"].value == RR.NOTICE_ADVISORY_LINE
    assert ws.row_dimensions[RR.NOTICE_EXTRA_ROW].hidden is not True
    assert any("러그 육안 검사" in w for w in warnings)


def test_advisory_line_fits_notice_box():
    # 박스 폭 = 12pt 한글 36자(collector.EXTRA_NOTICE_MAX_CHARS 와 같은 기준)
    assert len(RR.NOTICE_ADVISORY_LINE) <= 36
