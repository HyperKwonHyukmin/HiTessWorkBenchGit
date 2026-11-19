"""자세안정성 판정과 평가 모드 기록(stability_gate) — Advisory 로 fail 인 채 진행한 구조 해석을 결과에 남긴다(2026-11-18)."""
import json

from app.services.stability_gate import read_stability_gate


def _write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _stability(status, stages, posture_name="U_posture.json"):
    return {
        "meta": {"sourceFiles": {"model": "U_edited.json", "posture": posture_name}},
        "overall": {"status": status},
        "stages": stages,
    }


def test_advisory_fail_with_tipping(tmp_path):
    _write(tmp_path / "U_posture.json", {"strictEvaluation": False, "evaluationMode": "advisory"})
    _write(tmp_path / "U_stability.json", _stability("fail", [
        {"stage": 0, "status": "fail", "displayPolicy": "internal", "name": "InputParser"},
        {"stage": 3, "status": "pass", "displayPolicy": "user", "displayLabel": "Wire 정점"},
        {"stage": 6, "status": "fail", "displayPolicy": "user", "displayLabel": "전도 안정성"},
    ]))
    gate = read_stability_gate(str(tmp_path / "U_stability.json"))
    assert gate == {
        "overall": "fail", "evaluationMode": "advisory",
        "failingStages": ["전도 안정성"], "tippingFail": True, "unmet": True,
    }


def test_fail_with_standard_posture_counts_as_advisory(tmp_path):
    # Standard 로 평가해 FAIL → Advisory 로 바꿔 다시 평가 없이 해석: posture 에는 standard 가 남는다.
    _write(tmp_path / "U_posture.json", {"strictEvaluation": False, "evaluationMode": "standard"})
    _write(tmp_path / "U_stability.json", _stability("fail", [{"stage": 6, "status": "fail", "displayPolicy": "user", "displayLabel": "전도"}]))
    gate = read_stability_gate(str(tmp_path / "U_stability.json"))
    assert gate["evaluationMode"] == "advisory" and gate["unmet"] is True


def test_overall_not_a_dict_does_not_raise(tmp_path):
    _write(tmp_path / "U_stability.json", {"overall": "fail", "stages": []})
    assert read_stability_gate(str(tmp_path / "U_stability.json"))["overall"] is None


def test_old_posture_without_mode_falls_back_to_strict_flag(tmp_path):
    _write(tmp_path / "U_posture.json", {"strictEvaluation": True})
    _write(tmp_path / "U_stability.json", _stability("pass", []))
    gate = read_stability_gate(str(tmp_path / "U_stability.json"))
    assert gate["evaluationMode"] == "strict"
    assert gate["unmet"] is False


def test_posture_found_by_stem_when_meta_missing(tmp_path):
    _write(tmp_path / "U_posture.json", {"evaluationMode": "standard"})
    data = _stability("warn", [])
    data["meta"] = {}
    _write(tmp_path / "U_stability.json", data)
    assert read_stability_gate(str(tmp_path / "U_stability.json"))["evaluationMode"] == "standard"


def test_meta_posture_name_with_path_is_ignored(tmp_path):
    # 폴더 밖 파일을 가리키는 이름은 쓰지 않는다(같은 폴더의 이름만).
    _write(tmp_path / "U_stability.json", _stability("warn", [], posture_name="..\\other.json"))
    assert read_stability_gate(str(tmp_path / "U_stability.json"))["evaluationMode"] is None


def test_missing_or_broken_file_returns_none(tmp_path):
    assert read_stability_gate(None) is None
    assert read_stability_gate(str(tmp_path / "none.json")) is None
    (tmp_path / "bad_stability.json").write_text("{", encoding="utf-8")
    assert read_stability_gate(str(tmp_path / "bad_stability.json")) is None
