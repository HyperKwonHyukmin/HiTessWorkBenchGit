"""보고서 3D 그림 — 합본 BDF 를 solid3d 가 아는 형상으로 옮기는 부분.

렌더(matplotlib)는 느려서 여기서 돌리지 않는다. 이 테스트가 지키는 것은
**BDF 해석**이다 — 단면 종류·치수·방향벡터를 잘못 읽으면 그림이 조용히 거짓말을
하고(배관이 각기둥이 되거나 H 형강이 90° 돌아간다) 아무도 알아채지 못한다.
"""
import math

import pytest

from app.services.module_ocean_bdf import extract_bulk_lines
from app.services.module_ocean_figures import (
    module_element_ids,
    parse_geometry,
    parse_sections,
    _usage_by_bdf_eid,
    _usage_norm,
)

# free-field BDF. 정반(저 ID) + Module Unit(+200000) 이 섞인 합본 모양을 흉내낸다.
BDF = """
BEGIN BULK
GRID,1,,0.0,0.0,0.0
GRID,2,,1000.0,0.0,0.0
GRID,3,,1000.0,1000.0,0.0
GRID,9,,0.0,0.0,1000.0
GRID,200001,,0.0,0.0,5000.0
GRID,200002,,2000.0,0.0,5000.0
GRID,200003,,2000.0,1500.0,5000.0
$ 정반 쪽 부재 — 그림에서는 빠져야 한다
CBAR,50,11,1,2,0.0,0.0,1.0
$ Module Unit — X 벡터로 방향을 준 H 형강
CBEAM,200010,21,200001,200002,0.0,1.0,0.0
$ Module Unit — G0 절점(9)으로 방향을 준 부재
CBEAM,200011,22,200002,200003,9
$ 배관
CTUBE,200012,23,200001,200003
$ 단면적만 있는 카드
CROD,200013,24,200002,200003
PBEAML,21,1,,H
,300.0,20.0,150.0,10.0
PBARL,22,1,,L
,100.0,80.0,8.0,8.0
PTUBE,23,1,168.3,6.0
PROD,24,1,1256.6,0.0
PBAR,11,1,10000.0,1.0,1.0,1.0
ENDDATA
"""


@pytest.fixture(scope="module")
def parsed():
    bulk = extract_bulk_lines(BDF)
    return parse_geometry(bulk), {s.pid: s for s in parse_sections(bulk)}


def test_geometry_reads_nodes_and_line_elements(parsed):
    geometry, _ = parsed
    assert geometry.nodes[200002] == (2000.0, 0.0, 5000.0)
    # CBAR/CBEAM/CTUBE/CROD 를 모두 잡되 카드마다 GA/GB 자리가 달라도 맞아야 한다.
    by_eid = {row[0]: row for row in geometry.elements}
    assert set(by_eid) == {50, 200010, 200011, 200012, 200013}
    assert by_eid[200010][1:4] == (200001, 200002, 21)
    assert by_eid[200012][1:4] == (200001, 200003, 23)


def test_x_vector_orientation_is_read_as_given(parsed):
    geometry, _ = parsed
    assert geometry.orientations[200010] == (0.0, 1.0, 0.0)


def test_g0_orientation_becomes_a_vector(parsed):
    """G0 는 절점 번호다 — 그대로 벡터로 쓰면 (9,0,0) 같은 엉뚱한 방향이 된다.

    GA(200002, z=5000) → G0(9, z=1000) 이므로 아래를 향한 벡터여야 한다.
    """
    geometry, _ = parsed
    vector = geometry.orientations[200011]
    assert vector == (0.0 - 2000.0, 0.0 - 0.0, 1000.0 - 5000.0)


def test_sections_carry_kind_and_dims(parsed):
    _, sections = parsed
    assert sections[21].kind == "H"
    assert sections[21].dims == [300.0, 20.0, 150.0, 10.0]
    assert sections[22].kind == "L"


def test_ptube_dim1_is_the_outer_radius(parsed):
    """solid3d 의 TUBE 규약은 DIM1 = 외반경(지름 = 2·DIM1)이다.

    PTUBE 는 외경을 주므로 반으로 나눠 넣어야 한다. 그냥 넣으면 배관이 실제의
    두 배 굵기로 그려진다.
    """
    _, sections = parsed
    assert sections[23].kind == "TUBE"
    assert sections[23].dims == [168.3 / 2.0]


def test_area_only_cards_get_an_equivalent_size(parsed):
    """PBAR/PROD 는 치수가 없다 — 기본값으로 두면 굵기가 전부 같아 형상이 안 읽힌다."""
    _, sections = parsed
    assert sections[24].kind == "ROD"
    assert sections[24].dims == [pytest.approx(math.sqrt(1256.6 / math.pi))]
    assert sections[11].kind == "BAR"
    assert sections[11].dims == [pytest.approx(100.0), pytest.approx(100.0)]


def test_module_elements_are_picked_by_shifted_result_ids(parsed):
    """결과 JSON 의 EID 는 사용자 BDF 기준이라 offset 을 도로 더해야 합본과 맞는다."""
    geometry, _ = parsed
    ids = module_element_ids(geometry, {"elements": [{"elementId": 10}, {"elementId": 12}]},
                             200000)
    assert ids == {200010, 200012}


def test_module_elements_fall_back_to_the_id_band(parsed):
    """결과에 요소 목록이 없는 옛 기록도 그려져야 한다 — 정반은 빼고."""
    geometry, _ = parsed
    ids = module_element_ids(geometry, {}, 200000)
    assert 50 not in ids
    assert ids == {200010, 200011, 200012, 200013}


# ── 색 눈금 ──────────────────────────────────────────────────────────────────

def test_usage_scale_ignores_excluded_small_bore_piping():
    """★ 판정에서 뺀 배관까지 눈금에 넣으면 정작 판정하는 부재가 안 보인다.

    실측(3521): 배관 사용률이 2.0 을 넘어 눈금 상한이 2.3 이 되고, 최대 0.63 인
    구조 부재가 전부 눈금 아래 25% 에 뭉쳐 색이 읽히지 않았다.
    """
    entries = [
        {"elementId": 1, "usage": 0.63},
        {"elementId": 2, "usage": 0.20},
        {"elementId": 3, "usage": 2.31, "excluded": True},
    ]
    values, excluded = _usage_by_bdf_eid(entries, 200000)

    assert excluded == {200003}
    assert _usage_norm(values, excluded).vmax == 1.0


def test_usage_scale_opens_above_one_when_a_judged_member_exceeds():
    """판정 대상이 허용을 넘으면 그때는 눈금을 열어야 한다 — 색이 포화되면 안 된다."""
    values, excluded = _usage_by_bdf_eid([{"elementId": 1, "usage": 1.42}], 0)
    assert _usage_norm(values, excluded).vmax == pytest.approx(1.47)
