"""Four-segment fillet-weld group assessment tests.

The weld group is treated as four line elements centred on the edges of a
rectangular plate. Demand is evaluated at every segment end point so that
normal and shear components are always combined at the same physical point.
"""
import math

import pytest

from app.services.module_ocean_weld import (
    DEFAULT_WELD_SPEC,
    evaluate_weld,
    normalize_spec,
    weld_section,
)


def _leg(index, fx, fy, fz, mx, my, mz=0.0):
    return {
        "index": index,
        "jungbanNodeId": 100000 + index,
        "x": 0.0,
        "y": 0.0,
        "z": 0.0,
        "fxN": fx,
        "fyN": fy,
        "fzN": fz,
        "mxNmm": mx,
        "myNmm": my,
        "mzNmm": mz,
    }


def test_section_uses_effective_throat_and_line_weld_geometry():
    section = weld_section()
    throat = 10.0 / math.sqrt(2.0)
    length = 268.0
    height = breadth = 500.0
    expected_ix = 2.0 * throat * (
        length * (height / 2.0) ** 2 + length ** 3 / 12.0
    )
    expected_iy = 2.0 * throat * (
        length * (breadth / 2.0) ** 2 + length ** 3 / 12.0
    )

    assert section["throatMm"] == pytest.approx(throat)
    assert section["weldAreaMm2"] == pytest.approx(throat * length)
    assert section["totalAreaMm2"] == pytest.approx(4.0 * throat * length)
    assert section["ixxMm4"] == pytest.approx(expected_ix)
    assert section["iyyMm4"] == pytest.approx(expected_iy)
    assert section["polarMomentMm4"] == pytest.approx(expected_ix + expected_iy)
    assert section["sectionModulusXMm3"] == pytest.approx(expected_ix / (height / 2.0))
    assert section["sectionModulusYMm3"] == pytest.approx(expected_iy / (breadth / 2.0))
    assert section["allowableMPa"] == pytest.approx(150.0)


def test_default_spec_matches_the_excel_reference_screen():
    assert DEFAULT_WELD_SPEC == {
        "yieldMPa": 450.0,
        "safetyFactor": 3.0,
        "plateHeightMm": 500.0,
        "plateBreadthMm": 500.0,
        "tackCount": 4,
        "weldLengthMm": 268.0,
        "weldLegMm": 10.0,
    }


def test_legacy_pad_size_expands_to_both_plate_dimensions():
    spec = normalize_spec({"padSizeMm": 250.0, "weldLengthMm": 30.0})
    assert spec["plateHeightMm"] == 250.0
    assert spec["plateBreadthMm"] == 250.0
    assert "padSizeMm" not in spec


def test_axial_tension_and_compression_are_checked_at_equal_magnitude():
    section = weld_section()
    force = 120.0 * section["totalAreaMm2"]
    tension = evaluate_weld([_leg(1, 0.0, 0.0, force, 0.0, 0.0)])["legs"][0]
    compression = evaluate_weld([_leg(1, 0.0, 0.0, -force, 0.0, 0.0)])["legs"][0]

    assert tension["sigmaEqMPa"] == pytest.approx(120.0)
    assert compression["sigmaEqMPa"] == pytest.approx(120.0)
    assert tension["sigmaNormalMPa"] == pytest.approx(120.0)
    assert compression["sigmaNormalMPa"] == pytest.approx(-120.0)


def test_pure_bending_uses_the_actual_weld_endpoint():
    section = weld_section()
    target = 50.0
    mx = target * section["ixxMm4"] / 250.0
    row = evaluate_weld([_leg(1, 0.0, 0.0, 0.0, mx, 0.0)])["legs"][0]

    assert row["sigmaEqMPa"] == pytest.approx(target)
    assert abs(row["governingPoint"]["yMm"]) == pytest.approx(250.0)
    assert row["sigmaBendingXMPa"] == pytest.approx(row["sigmaNormalMPa"])


def test_biaxial_bending_is_combined_at_one_physical_point():
    section = weld_section()
    moment = section["ixxMm4"]
    row = evaluate_weld([_leg(1, 0.0, 0.0, 0.0, moment, moment)])["legs"][0]

    # With L=268 and a 500x500 plate, the critical end point is (x,y)=(-134,250)
    # or its opposite. The two normal bending stresses add at that same point.
    assert row["sigmaEqMPa"] == pytest.approx(250.0 + 134.0)
    assert abs(row["governingPoint"]["xMm"]) == pytest.approx(134.0)
    assert abs(row["governingPoint"]["yMm"]) == pytest.approx(250.0)
    assert row["sigmaBendingMPa"] == pytest.approx(row["sigmaNormalMPa"])
    assert row["sigmaEqMPa"] != pytest.approx(math.hypot(250.0, 250.0))


def test_direct_shear_components_are_combined_vectorially():
    section = weld_section()
    area = section["totalAreaMm2"]
    row = evaluate_weld([_leg(1, 3.0 * area, 4.0 * area, 0.0, 0.0, 0.0)])["legs"][0]

    assert row["tauDirectMPa"] == pytest.approx(5.0)
    assert row["tauTorsionMPa"] == pytest.approx(0.0)
    assert row["tauMPa"] == pytest.approx(5.0)
    assert row["sigmaEqMPa"] == pytest.approx(math.sqrt(3.0) * 5.0)


def test_mz_torsion_changes_stress_and_can_govern():
    section = weld_section()
    radius = math.hypot(250.0, 134.0)
    mz = 100.0 * section["polarMomentMm4"] / radius
    without = evaluate_weld([_leg(1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)])["legs"][0]
    with_torsion = evaluate_weld([_leg(1, 0.0, 0.0, 0.0, 0.0, 0.0, mz)])["legs"][0]

    assert without["sigmaEqMPa"] == pytest.approx(0.0)
    assert with_torsion["tauTorsionMPa"] == pytest.approx(100.0)
    assert with_torsion["sigmaEqMPa"] == pytest.approx(math.sqrt(3.0) * 100.0)
    assert with_torsion["status"] == "NG"


def test_all_eight_segment_endpoints_are_auditable():
    row = evaluate_weld([_leg(1, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0)])["legs"][0]
    points = row["pointChecks"]

    assert len(points) == 8
    assert {point["side"] for point in points} == {"top", "right", "bottom", "left"}
    assert row["governingPoint"] in points


def test_summary_points_at_the_governing_leg_and_point():
    section = weld_section()
    area = section["totalAreaMm2"]
    result = evaluate_weld([
        _leg(1, 0.0, 0.0, 50.0 * area, 0.0, 0.0),
        _leg(2, 0.0, 0.0, 100.0 * area, 0.0, 0.0),
    ])

    assert result["summary"]["governingLegIndex"] == 2
    assert result["summary"]["maxSigmaEqMPa"] == pytest.approx(100.0)
    assert result["summary"]["governingPoint"]["key"] == result["legs"][1]["governingPoint"]["key"]
    assert result["summary"]["status"] == "OK"


def test_allowable_exactly_met_is_ok():
    section = weld_section()
    force = section["allowableMPa"] * section["totalAreaMm2"]
    row = evaluate_weld([_leg(1, 0.0, 0.0, force, 0.0, 0.0)])["legs"][0]

    assert row["sigmaEqMPa"] == pytest.approx(150.0)
    assert row["usage"] == pytest.approx(1.0)
    assert row["actualSafetyFactor"] == pytest.approx(3.0)
    assert row["status"] == "OK"


def test_zero_demand_has_no_finite_actual_safety_factor():
    row = evaluate_weld([_leg(1, 0.0, 0.0, 0.0, 0.0, 0.0)])["legs"][0]
    assert row["actualSafetyFactor"] is None
    assert row["status"] == "OK"


def test_spec_changes_move_area_and_allowable():
    base = weld_section()
    thicker = weld_section({"weldLegMm": 12.0})
    softer = weld_section({"yieldMPa": 300.0, "safetyFactor": 3.0})

    assert thicker["totalAreaMm2"] > base["totalAreaMm2"]
    assert softer["allowableMPa"] == pytest.approx(100.0)


def test_only_the_four_segment_excel_layout_is_accepted():
    with pytest.raises(ValueError, match="4개"):
        weld_section({"tackCount": 6})


def test_weld_length_must_fit_every_plate_side():
    with pytest.raises(ValueError, match="Plate"):
        weld_section({"plateHeightMm": 200.0, "plateBreadthMm": 300.0, "weldLengthMm": 250.0})


@pytest.mark.parametrize("bad", [
    {"weldLegMm": 0},
    {"weldLegMm": -8},
    {"weldLengthMm": 0},
    {"safetyFactor": 0},
    {"yieldMPa": -1},
    {"plateHeightMm": 0},
    {"plateBreadthMm": 0},
    {"tackCount": 0},
])
def test_zero_or_negative_spec_is_rejected_with_a_readable_message(bad):
    with pytest.raises(ValueError) as excinfo:
        weld_section(bad)
    assert any(word in str(excinfo.value)
               for word in ("각장", "길이", "안전율", "항복강도", "Plate", "용접"))


def test_non_numeric_and_nan_spec_are_rejected():
    with pytest.raises(ValueError, match="숫자가 아닌"):
        normalize_spec({"weldLegMm": "두꺼운 거"})
    with pytest.raises(ValueError, match="올바르지 않"):
        normalize_spec({"weldLegMm": float("nan")})


def test_empty_legs_is_rejected():
    with pytest.raises(ValueError, match="Leg 반력이 없습니다"):
        evaluate_weld([])


def test_result_carries_method_spec_and_identity():
    legs = [{
        **_leg(3, 0.0, 0.0, 1000.0, 0.0, 0.0),
        "jungbanNodeId": 102725,
        "x": 26260.0,
        "y": -5200.0,
        "z": -125.0,
    }]
    result = evaluate_weld(legs, {"weldLegMm": 12.0})
    row = result["legs"][0]

    assert result["schema"] == "module-ocean-weld/2"
    assert result["method"] == "elastic-line-weld-group"
    assert result["spec"]["weldLegMm"] == 12.0
    assert (row["index"], row["jungbanNodeId"]) == (3, 102725)
    assert (row["x"], row["y"], row["z"]) == (26260.0, -5200.0, -125.0)
