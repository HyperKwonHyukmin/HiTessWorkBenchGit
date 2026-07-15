"""Mast Post 선박 구분 API 계약 테스트."""

import pytest
from pydantic import ValidationError

from app.routers import davit


def test_mast_post_request_defaults_to_large_vessel():
    body = davit.MastPostRequest(height_mm=5000, weight_kg=200)

    assert body.vessel_size == "large"


def test_mast_post_request_rejects_unknown_vessel_size():
    with pytest.raises(ValidationError):
        davit.MastPostRequest(
            vessel_size="small",
            height_mm=5000,
            weight_kg=200,
        )


def test_mast_post_route_passes_vessel_size_to_service(monkeypatch):
    captured = {}

    def fake_run_mast_post(height_mm, weight_kg, employee_id, vessel_size):
        captured.update(
            height_mm=height_mm,
            weight_kg=weight_kg,
            employee_id=employee_id,
            vessel_size=vessel_size,
        )
        return {"candidates": []}

    monkeypatch.setattr(davit, "run_mast_post", fake_run_mast_post)
    body = davit.MastPostRequest(
        vessel_size="medium",
        height_mm=5000,
        weight_kg=200,
        employee_id="E123",
    )

    assert davit.mast_post(body) == {"candidates": []}
    assert captured == {
        "height_mm": 5000,
        "weight_kg": 200,
        "employee_id": "E123",
        "vessel_size": "medium",
    }
