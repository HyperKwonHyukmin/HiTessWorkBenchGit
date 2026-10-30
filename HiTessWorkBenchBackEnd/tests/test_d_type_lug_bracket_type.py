"""D Type Lug — 화면에서 고른 Bracket 형식은 기록에만 남고 엔진 입력에는 들어가지 않는다."""
import pytest
from pydantic import ValidationError

from app.routers import d_type_lug

BODY = {
    "load": {"force_N": 1000000},
    "geometry": {k: 1 for k in (
        "l1 l2 h1 h2 h3 h4 h5 t1 t2 t3 r1 r2 pin_radius d1 d2 d3 w1 w2 w1_prime w2_prime".split()
    )},
    "material": {"yield_base_MPa": 235, "yield_weld_MPa": 291.76},
    "employee_id": "A123456",
}


def _call(monkeypatch, body):
    seen = {}

    def fake_run(inputs, employee_id, bracket_type=None):
        seen.update(inputs=inputs, employee_id=employee_id, bracket_type=bracket_type)
        return {"ok": True}

    monkeypatch.setattr(d_type_lug, "run_d_type_lug", fake_run)
    monkeypatch.setattr(d_type_lug, "authenticated_employee_id", lambda claimed, current: current)
    d_type_lug.calculate(d_type_lug.DTypeLugRequest(**body), current_user="A123456")
    return seen


def test_bracket_type_kept_out_of_engine_input(monkeypatch):
    seen = _call(monkeypatch, {**BODY, "bracket_type": "bracket_2EA_double"})
    assert seen["bracket_type"] == "bracket_2EA_double"
    assert "bracket_type" not in seen["inputs"]
    assert "employee_id" not in seen["inputs"]


def test_old_client_without_bracket_type(monkeypatch):
    seen = _call(monkeypatch, BODY)
    assert seen["bracket_type"] is None


def test_unknown_bracket_type_rejected():
    with pytest.raises(ValidationError):
        d_type_lug.DTypeLugRequest(**{**BODY, "bracket_type": "bracket_3EA"})


def test_all_zero_weld_rejected():
    geometry = {**BODY["geometry"], "w1": 0, "w2": 0, "w1_prime": 0, "w2_prime": 0}
    with pytest.raises(ValidationError):
        d_type_lug.DTypeLugRequest(**{**BODY, "geometry": geometry})
