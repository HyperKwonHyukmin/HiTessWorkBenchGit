import math

import pytest

from app.services.module_ocean_acceleration import (
    BargeAccelerationError,
    GRAVITY_MS2,
    apol_rational,
    calculate_barge_acceleration,
)


DEFAULTS = {
    "significant_wave_height_m": 2.0,
    "critical_damping_pct": 3,
    "cargo_position": "single-center",
    "cargo_weight_t": 207.7,
    "cargo_vcg_from_bottom_m": 1.2,
    "barge_depth_m": 4.5,
    "support_height_m": 3.4,
    "load_case": "LC1",
}


def test_apol_rational_matches_excel_intermediate_value():
    # Excel COT CD3 H44: VCG 9.1m에서 Xacc SSA 보간값.
    actual = apol_rational(
        [3.0, 10.0, 17.0, 25.0],
        [0.198, 0.4, 0.616, 0.864],
        9.1,
    )
    assert actual == pytest.approx(0.356177812211922, abs=1e-8)


def test_excel_default_inputs_match_workbook_outputs():
    result = calculate_barge_acceleration(**DEFAULTS)

    # General_Information C23:E23 (Most Probable Maximum).
    assert result["dynamicAccelerationMS2"] == pytest.approx({
        "x": 0.610791949132211,
        "y": 1.67876730877425,
        "z": 1.07193459985025,
    }, abs=1e-6)
    assert result["input"]["cargoVcgFromBaselineM"] == pytest.approx(9.1)
    assert result["source"]["sheet"] == "COT_ACCOMMODATION_CD3"
    assert result["source"]["gravityMS2"] == 9.8


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        (
            {
                "significant_wave_height_m": 1.5,
                "critical_damping_pct": 5,
                "cargo_position": "multiple-offset",
                "cargo_weight_t": 550,
                "cargo_vcg_from_bottom_m": 3.6,
                "barge_depth_m": 4.5,
                "support_height_m": 3.4,
            },
            (0.446283434017268, 1.22680437843434, 1.08592757517123),
        ),
        (
            {
                "significant_wave_height_m": 2.7,
                "critical_damping_pct": 3,
                "cargo_position": "multiple-offset",
                "cargo_weight_t": 1000,
                "cargo_vcg_from_bottom_m": 12.1,
                "barge_depth_m": 4.5,
                "support_height_m": 3.4,
            },
            (1.21561344755525, 4.41997794649473, 2.20810020716622),
        ),
        (
            {
                "significant_wave_height_m": 1.2,
                "critical_damping_pct": 5,
                "cargo_position": "single-center",
                "cargo_weight_t": 75,
                "cargo_vcg_from_bottom_m": 0.0,
                "barge_depth_m": 3.0,
                "support_height_m": 1.0,
            },
            (0.0513885729282938, 0.10062065778453, 0.535679983903564),
        ),
    ],
)
def test_python_matches_excel_reference_points(overrides, expected):
    """서로 다른 네 계산 시트와 APOL 구간을 실제 Excel COM 결과와 대조한다."""
    result = calculate_barge_acceleration(**{**DEFAULTS, **overrides})
    actual = result["dynamicAccelerationMS2"]
    assert (actual["x"], actual["y"], actual["z"]) == pytest.approx(expected, abs=1e-6)


@pytest.mark.parametrize(
    ("load_case", "x_sign", "z_sign"),
    [("LC1", 1, -1), ("LC2", -1, -1), ("LC3", 1, 1), ("LC4", -1, 1)],
)
def test_selected_load_case_is_combined_with_gravity(load_case, x_sign, z_sign):
    result = calculate_barge_acceleration(**{**DEFAULTS, "load_case": load_case})
    dynamic = result["dynamicAccelerationMS2"]
    total = result["totalAccelerationG"]

    assert total["ax"] == pytest.approx(x_sign * dynamic["x"] / GRAVITY_MS2)
    assert total["ay"] == pytest.approx(dynamic["y"] / GRAVITY_MS2)
    assert total["az"] == pytest.approx(-1 + z_sign * dynamic["z"] / GRAVITY_MS2)
    assert result["totalMagnitudeG"] == pytest.approx(math.sqrt(sum(v * v for v in total.values())))


def test_calculation_rejects_excel_limit_violations():
    with pytest.raises(BargeAccelerationError, match="50~1200"):
        calculate_barge_acceleration(**{**DEFAULTS, "cargo_weight_t": 49.9})

    with pytest.raises(BargeAccelerationError, match="3~25"):
        calculate_barge_acceleration(**{
            **DEFAULTS,
            "cargo_vcg_from_bottom_m": 20.0,
            "barge_depth_m": 4.5,
            "support_height_m": 3.4,
        })
