"""BDF 모델 JSON 의 질량/무게중심 산출 테스트.

기준값은 MSC Nastran 의 GRID POINT WEIGHT GENERATOR 출력(2026-08-28 실측)이다.
단면 공식은 실제 H형강/ㄱ형강 규격표와 대조해 검증한다 — 규격표는 필렛(모서리 라운드)을
포함하므로 치수 기반 계산이 2~3% 작게 나오는 것이 정상이며, 그 이상 벌어지면 DIM 해석이 틀린 것이다.
"""
import math

import pytest

from app.services.bdf_mass_properties import (
    compute_mass_properties,
    cross_section_area_mm2,
)

STEEL_RHO = 7.85e-9  # t/mm³


# ── 단면적 ────────────────────────────────────────────────────────────────

def _prop(kind, dims, pid=1, mid=1):
    return {"id": pid, "card": "PBEAML", "kind": kind, "dims": dims, "materialId": mid}


@pytest.mark.parametrize(
    "kind,dims,expected",
    [
        ("Tube", [50.8, 47.6], math.pi * (50.8 ** 2 - 47.6 ** 2)),   # 파이프 101.6 x 3.2t
        ("Rod", [10.0], math.pi * 100.0),
        ("Bar", [100.0, 50.0], 5000.0),
        ("BOX", [200.0, 100.0, 8.0, 6.0], 200 * 100 - 184 * 88),
    ],
)
def test_cross_section_area_basic_shapes(kind, dims, expected):
    assert cross_section_area_mm2(_prop(kind, dims)) == pytest.approx(expected)


@pytest.mark.parametrize(
    "dims,table_area_mm2,label",
    [
        ([176, 24, 200, 8], 6353, "H-200x200x8x12"),
        ([107, 18, 125, 6.5], 3000, "H-125x125x6.5x9"),
        ([130, 18, 100, 6], 2635, "H-148x100x6x9"),
        ([374, 26, 200, 8], 8412, "H-400x200x8x13"),
    ],
)
def test_h_section_matches_standard_tables(dims, table_area_mm2, label):
    """PBEAML 'H' 의 DIM 규약 회귀 방지.

    DIM1=웹 순높이(d-2tf), DIM2=2*tf, DIM3=플랜지폭, DIM4=웹두께.
    'DIM1=플랜지폭 / DIM2=전체높이' 로 잘못 읽으면 30% 이상 작아져 이 테스트가 깨진다.
    """
    area = cross_section_area_mm2(_prop("H", dims))
    ratio = area / table_area_mm2
    assert 0.96 <= ratio <= 1.0, f"{label}: {area:.0f} vs 규격표 {table_area_mm2} (비 {ratio:.3f})"


def test_h_section_is_not_confused_with_i_section():
    """같은 형상을 H 와 I 로 각각 기술했을 때 면적이 일치해야 한다.

    H-200x200x8x12 를 I 단면 규약(DIM1=전체높이, DIM2/3=플랜지폭, DIM4=tw, DIM5/6=tf)으로
    쓰면 [200,200,200,8,12,12] 다. 두 표현이 같은 값을 내야 DIM 해석이 옳다.
    """
    h_area = cross_section_area_mm2(_prop("H", [176, 24, 200, 8]))
    i_area = cross_section_area_mm2(_prop("I", [200, 200, 200, 8, 12, 12]))
    assert h_area == pytest.approx(i_area)


def test_l_section_matches_standard_table():
    # L-150x150x12 규격표 3,477 mm² (필렛 포함)
    area = cross_section_area_mm2(_prop("L", [150, 150, 12, 12]))
    assert area == pytest.approx(3456.0)
    assert 0.96 <= area / 3477 <= 1.0


def test_chan_section_matches_standard_table():
    # C-125x65x6x8 규격표 1,711 mm²
    area = cross_section_area_mm2(_prop("CHAN", [65, 125, 6, 8]))
    assert 0.96 <= area / 1711 <= 1.0


def test_unknown_section_returns_none():
    assert cross_section_area_mm2(_prop("HAT", [1, 2, 3, 4])) is None
    assert cross_section_area_mm2(None) is None


def test_missing_dims_returns_none_instead_of_raising():
    """치수가 잘린 카드에 KeyError/TypeError 가 아니라 None 이 나와야 상위에서 '미지원'으로 셀 수 있다."""
    assert cross_section_area_mm2(_prop("I", [200, 200])) is None
    assert cross_section_area_mm2(_prop("H", [])) is None


# ── 질량 / 무게중심 ────────────────────────────────────────────────────────

def _model(nodes, elements=(), properties=(), materials=(), point_masses=()):
    return {
        "nodes": [{"id": i, "x": x, "y": y, "z": z} for i, (x, y, z) in nodes.items()],
        "elements": list(elements),
        "properties": list(properties),
        "materials": list(materials),
        "pointMasses": list(point_masses),
    }


MAT_STEEL = {"id": 1, "name": "Steel", "E": 206000.0, "nu": 0.3, "rho": STEEL_RHO}


def test_single_beam_mass_and_midpoint_cog():
    model = _model(
        nodes={1: (0, 0, 0), 2: (1000, 0, 0)},
        elements=[{"id": 1, "type": "CBEAM", "startNode": 1, "endNode": 2, "propertyId": 1}],
        properties=[_prop("Bar", [100.0, 50.0])],
        materials=[MAT_STEEL],
    )
    r = compute_mass_properties(model)
    assert r["totalMassTon"] == pytest.approx(5000.0 * 1000.0 * STEEL_RHO)
    assert r["centerOfGravityMm"]["x"] == pytest.approx(500.0)
    assert r["centerOfGravityMm"]["y"] == pytest.approx(0.0)
    assert r["source"] == "computed:beam"


def test_shell_mass_uses_pshell_thickness_and_face_area():
    model = _model(
        nodes={1: (0, 0, 0), 2: (1000, 0, 0), 3: (1000, 2000, 0), 4: (0, 2000, 0)},
        elements=[{"id": 1, "type": "CQUAD4", "nodeIds": [1, 2, 3, 4], "propertyId": 10}],
        properties=[{"id": 10, "card": "PSHELL", "kind": "Shell", "materialId": 1, "thickness": 15.0}],
        materials=[MAT_STEEL],
    )
    r = compute_mass_properties(model)
    assert r["totalMassTon"] == pytest.approx(1000.0 * 2000.0 * 15.0 * STEEL_RHO)
    assert r["centerOfGravityMm"]["x"] == pytest.approx(500.0)
    assert r["centerOfGravityMm"]["y"] == pytest.approx(1000.0)
    assert r["source"] == "computed:shell"


def test_warped_quad_area_splits_into_two_triangles():
    """평면이 아닌 사각형도 면적이 0 이나 NaN 이 되지 않아야 한다."""
    model = _model(
        nodes={1: (0, 0, 0), 2: (1000, 0, 0), 3: (1000, 1000, 500), 4: (0, 1000, 0)},
        elements=[{"id": 1, "type": "CQUAD4", "nodeIds": [1, 2, 3, 4], "propertyId": 10}],
        properties=[{"id": 10, "card": "PSHELL", "kind": "Shell", "materialId": 1, "thickness": 10.0}],
        materials=[MAT_STEEL],
    )
    r = compute_mass_properties(model)
    assert r["totalMassTon"] > 0
    assert math.isfinite(r["centerOfGravityMm"]["z"])


def test_point_mass_is_placed_at_its_node():
    model = _model(
        nodes={1: (100, 200, 300)},
        point_masses=[{"id": 1, "nodeId": 1, "mass": 2.5}],
    )
    r = compute_mass_properties(model)
    assert r["totalMassTon"] == pytest.approx(2.5)
    assert r["centerOfGravityMm"] == {"x": 100, "y": 200, "z": 300}
    assert r["source"] == "computed:point"


def test_cog_is_mass_weighted_not_geometric_mean():
    """무거운 쪽으로 무게중심이 끌려가야 한다 — 단순 평균이면 이 테스트가 깨진다."""
    model = _model(
        nodes={1: (0, 0, 0), 2: (1000, 0, 0)},
        point_masses=[
            {"id": 1, "nodeId": 1, "mass": 9.0},
            {"id": 2, "nodeId": 2, "mass": 1.0},
        ],
    )
    r = compute_mass_properties(model)
    assert r["totalMassTon"] == pytest.approx(10.0)
    assert r["centerOfGravityMm"]["x"] == pytest.approx(100.0)


def test_components_are_reported_separately():
    model = _model(
        nodes={1: (0, 0, 0), 2: (1000, 0, 0)},
        elements=[{"id": 1, "type": "CBEAM", "startNode": 1, "endNode": 2, "propertyId": 1}],
        properties=[_prop("Bar", [100.0, 50.0])],
        materials=[MAT_STEEL],
        point_masses=[{"id": 1, "nodeId": 2, "mass": 1.0}],
    )
    r = compute_mass_properties(model)
    assert set(r["components"]) == {"beam", "point"}
    assert r["components"]["beam"]["count"] == 1
    assert r["components"]["point"]["massTon"] == pytest.approx(1.0)
    assert r["source"] == "computed:beam+point"
    total = r["components"]["beam"]["massTon"] + r["components"]["point"]["massTon"]
    assert r["totalMassTon"] == pytest.approx(total)


def test_unsupported_section_is_counted_not_silently_dropped():
    """총중량이 작게 나올 때 원인을 화면에서 짚을 수 있어야 한다."""
    model = _model(
        nodes={1: (0, 0, 0), 2: (1000, 0, 0)},
        elements=[{"id": 1, "type": "CBEAM", "startNode": 1, "endNode": 2, "propertyId": 1}],
        properties=[_prop("HAT", [1, 2, 3, 4])],
        materials=[MAT_STEEL],
    )
    r = compute_mass_properties(model)
    assert r["totalMassTon"] is None
    assert r["source"] == "unavailable"
    assert r["skipped"] == {"CBEAM: 단면적 미지원(HAT)": 1}


def test_missing_density_is_counted_as_its_own_reason():
    model = _model(
        nodes={1: (0, 0, 0), 2: (1000, 0, 0)},
        elements=[{"id": 1, "type": "CBEAM", "startNode": 1, "endNode": 2, "propertyId": 1}],
        properties=[_prop("Bar", [100.0, 50.0])],
        materials=[{"id": 1, "rho": None}],
    )
    r = compute_mass_properties(model)
    assert r["skipped"] == {"CBEAM: 밀도(MAT1 RHO) 없음": 1}


def test_empty_model_is_unavailable_not_zero():
    """0 t 로 내려보내면 화면이 '무게 0' 을 사실처럼 표시한다. None 이어야 한다."""
    r = compute_mass_properties({})
    assert r["totalMassTon"] is None
    assert r["centerOfGravityMm"] is None
    assert r["source"] == "unavailable"


def test_rigid_and_gap_cards_do_not_produce_skip_noise():
    """질량이 없는 게 정상인 카드는 '건너뜀' 으로 세지 않는다."""
    model = _model(
        nodes={1: (0, 0, 0), 2: (1000, 0, 0)},
        elements=[{"id": 1, "type": "CGAP", "startNode": 1, "endNode": 2, "propertyId": 99}],
        point_masses=[{"id": 1, "nodeId": 1, "mass": 1.0}],
    )
    r = compute_mass_properties(model)
    assert r["skipped"] == {}
    assert r["totalMassTon"] == pytest.approx(1.0)


def test_conrod_uses_area_on_the_element_card():
    """CONROD 는 property 없이 카드에 면적·재질이 있다 — property 없음으로 버리면 안 된다."""
    model = _model(
        nodes={1: (0, 0, 0), 2: (1000, 0, 0)},
        elements=[{"id": 1, "type": "CONROD", "startNode": 1, "endNode": 2,
                   "materialId": 1, "area": 500.0}],
        materials=[MAT_STEEL],
    )
    r = compute_mass_properties(model)
    assert r["totalMassTon"] == pytest.approx(500.0 * 1000.0 * STEEL_RHO)
    assert r["skipped"] == {}


def test_zero_length_beam_does_not_divide_by_zero():
    model = _model(
        nodes={1: (0, 0, 0), 2: (0, 0, 0)},
        elements=[{"id": 1, "type": "CBEAM", "startNode": 1, "endNode": 2, "propertyId": 1}],
        properties=[_prop("Bar", [100.0, 50.0])],
        materials=[MAT_STEEL],
    )
    r = compute_mass_properties(model)
    assert r["totalMassTon"] is None
    assert r["skipped"] == {"CBEAM: 길이 0": 1}
