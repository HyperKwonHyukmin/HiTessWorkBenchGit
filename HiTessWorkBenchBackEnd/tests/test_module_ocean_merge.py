"""Module Unit 해상 운송 — 정반 + Module Unit 합본 테스트.

파일 I/O 도 Nastran 도 타지 않는다. 줄 목록이 들어가 줄 목록이 나오므로
카드 양식과 ID 규칙을 골든 텍스트로 고정할 수 있다.

여기서 지키려는 계약은 셋이다.
  ① Module Unit ID 를 밀어도 **참조가 하나도 새지 않는다** (정반 ID 를 가리키면 안 된다)
  ② 배치 변환이 화면(feGeometry.transformModulePoint)과 **같은 식**이다
  ③ **지지점 최하단**이 상판에서 정확히 clearance 위에 오고, 그보다 낮은 부재가
     정반 위에 있으면 멈춘다 (= 쉘 관통 불가)
"""
import math

import pytest

from app.services.module_ocean_bdf import cont, extract_bulk_lines, line
from app.services.module_ocean_merge import (
    DEFAULT_CLEARANCE_MM,
    ID_OFFSET,
    MergeError,
    assert_global_coordinates,
    build_combined_bdf,
    collect_ids,
    deck_spc_sid,
    deck_landing_levels,
    landing_level_at,
    primary_landing_level,
    grid_coords_map,
    pair_supports_to_plate,
    place_grid_lines,
    renumber_bulk,
    scale_mass,
    split_param_lines,
    verify_renumbered,
)


# ── 픽스처: 아주 작은 정반과 Module Unit ──────────────────────────────────
# 정반은 z=1000 상판(3×3 절점 → CQUAD4 4장)과 z=0 Leg 절점(SPC) 하나.
# Leg 를 상판보다 낮게 두는 것은 실제 정반과 같은 구성이다(상판이 최고점).

def _deck_lines():
    lines = [
        line("GRID", 1, None, 0.0, 0.0, 0.0),                  # Leg = SPC 절점
        line("PSHELL", 1006, 1, 15.0),
        line("MAT1", 1, 206000.0, None, 0.3, 7.85e-9),
        line("SPC", 1, 1, "123456", 0.0),
        line("GRAV", 2, 0, 9800.0, 0.0, 0.0, -1.0),            # 정반이 품고 있는 자기 하중
        "PARAM,POST,-1",
    ]
    grid = {}
    nid = 11
    for ix in range(3):
        for iy in range(3):
            grid[(ix, iy)] = nid
            lines.append(line("GRID", nid, None, ix * 1000.0, iy * 1000.0, 1000.0))
            nid += 1
    eid = 101
    for ix in range(2):
        for iy in range(2):
            lines.append(line("CQUAD4", eid, 1006, grid[(ix, iy)], grid[(ix + 1, iy)],
                              grid[(ix + 1, iy + 1)], grid[(ix, iy + 1)]))
            eid += 1
    return lines


def _stepped_deck_lines():
    """2단 정반 — 실제 A·B 정반의 성질(상단/하단이 나란히, 단차 3,000mm)을 줄인 것.

    상단 z=1000 (X 0~2000), 하단 z=-2000 (X -2000~0). 두 면의 면적이 같아
    '가장 높은 면 하나' 만 상판으로 보던 규칙이 왜 하단을 통째로 잃는지 드러난다.
    """
    lines = [
        line("GRID", 1, None, 0.0, 0.0, -4000.0),              # Leg = SPC 절점
        line("PSHELL", 1006, 1, 15.0),
        line("MAT1", 1, 206000.0, None, 0.3, 7.85e-9),
        line("SPC", 1, 1, "123456", 0.0),
        "PARAM,POST,-1",
    ]
    nid, eid = 11, 101
    for x0, z in ((0.0, 1000.0), (-2000.0, -2000.0)):
        grid = {}
        for ix in range(3):
            for iy in range(3):
                grid[(ix, iy)] = nid
                lines.append(line("GRID", nid, None, x0 + ix * 1000.0, iy * 1000.0, z))
                nid += 1
        for ix in range(2):
            for iy in range(2):
                lines.append(line("CQUAD4", eid, 1006, grid[(ix, iy)], grid[(ix + 1, iy)],
                                  grid[(ix + 1, iy + 1)], grid[(ix, iy + 1)]))
                eid += 1
    return lines


def _holed_deck_lines():
    """가운데가 뚫린 정반 상판 — bbox 로만 판정하면 구멍 위도 '적치면 안' 이 된다.

    4×4 절점(9장) 중 가운데 한 장을 빼서 1,000mm 구멍을 만든다. 면적이 bbox 의
    8/9 라 solidRect 가 깨지고 삼각형 판정으로 떨어진다.
    """
    lines = [
        line("GRID", 1, None, 0.0, 0.0, 0.0),
        line("PSHELL", 1006, 1, 15.0),
        line("MAT1", 1, 206000.0, None, 0.3, 7.85e-9),
        line("SPC", 1, 1, "123456", 0.0),
        "PARAM,POST,-1",
    ]
    grid = {}
    nid = 11
    for ix in range(4):
        for iy in range(4):
            grid[(ix, iy)] = nid
            lines.append(line("GRID", nid, None, ix * 1000.0, iy * 1000.0, 1000.0))
            nid += 1
    eid = 101
    for ix in range(3):
        for iy in range(3):
            if (ix, iy) == (1, 1):          # 가운데 한 장을 뺀다 = 구멍
                continue
            lines.append(line("CQUAD4", eid, 1006, grid[(ix, iy)], grid[(ix + 1, iy)],
                              grid[(ix + 1, iy + 1)], grid[(ix, iy + 1)]))
            eid += 1
    return lines


def _unit_lines():
    return [
        line("GRID", 1, None, 0.0, 0.0, 0.0),
        line("GRID", 2, None, 1000.0, 0.0, 0.0),
        line("GRID", 3, None, 0.0, 1000.0, 0.0),
        line("GRID", 4, None, 500.0, 500.0, 500.0),
        line("CBEAM", 77, 8, 1, 2, 0.0, 0.0, 1.0),
        line("CBEAM", 78, 8, 1, 3, 0.0, 0.0, 1.0),
        line("PBEAML", 8, 3, None, "TUBE"),
        cont(50.8, 47.6, 0.0),
        line("MAT1", 3, 206000.0, None, 0.3, 7.85e-9),
        line("CONM2", 90, 4, 0, 0.5),
        line("RBE2", 55, 4, "123456", 3),
        "PARAM,POST,-1",
    ]


def _placement(**overrides):
    base = {"anchorMm": [500.0, 500.0, 0.0], "rotationZDeg": 0.0,
            "offsetXMm": 0.0, "offsetYMm": 0.0}
    base.update(overrides)
    return base


def _fields(raw):
    return [raw[i:i + 8].strip() for i in range(8, len(raw), 8)]


def _card(lines, name, first_field=None):
    """카드명(+첫 필드)으로 줄 하나를 찾는다."""
    for raw in lines:
        if raw[:8].strip() != name:
            continue
        if first_field is None or _fields(raw)[0] == str(first_field):
            return raw
    raise AssertionError(f"{name} {first_field} 를 찾지 못했습니다.")


# ── ID 재번호 ─────────────────────────────────────────────────────────────

def test_renumber_shifts_every_id_and_leaves_coordinates_alone():
    out = renumber_bulk(_unit_lines(), offset=ID_OFFSET)
    grid = _fields(_card(out, "GRID", 200002))
    assert grid[0] == str(200002)
    assert [float(v) for v in grid[2:5]] == [1000.0, 0.0, 0.0]   # 좌표는 그대로

    beam = _fields(_card(out, "CBEAM", 200077))
    assert beam[:4] == ["200077", "200008", "200001", "200002"]
    assert [float(v) for v in beam[4:7]] == [0.0, 0.0, 1.0]      # 방향벡터는 ID 가 아니다

    assert _fields(_card(out, "PBEAML", 200008))[:2] == ["200008", "200003"]
    assert _fields(_card(out, "MAT1", 200003))[0] == "200003"


def test_renumber_keeps_the_global_coordinate_system_shared():
    """CONM2 의 CID 0 은 전역 좌표계다 — 밀면 없는 좌표계를 가리킨다."""
    out = renumber_bulk(_unit_lines(), offset=ID_OFFSET)
    conm2 = _fields(_card(out, "CONM2", 200090))
    assert conm2[:4] == ["200090", "200004", "0", "0.5"]


def test_renumber_shifts_rbe2_dependents_including_continuations():
    deck = [
        line("RBE2", 55, 4, "123456", 3, 5, 6, 7, 8),
        cont(9, 10, 1.2e-5),                       # 마지막은 ALPHA — 절점이 아니다
        line("GRID", 4, None, 0.0, 0.0, 0.0),
    ]
    out = renumber_bulk(deck, offset=1000)
    first = _fields(out[0])
    assert first[:3] == ["1055", "1004", "123456"]
    assert first[3:] == ["1003", "1005", "1006", "1007", "1008"]
    tail = _fields(out[1])
    assert tail[:2] == ["1009", "1010"]
    assert float(tail[2].replace("-5", "e-5")) == pytest.approx(1.2e-5)


@pytest.mark.parametrize("g0_card,expected", [
    # G0 형식 — 5번 필드가 방향**절점**이라 밀어야 한다
    (line("CBEAM", 77, 8, 1, 2, 3), ["200077", "200008", "200001", "200002", "200003"]),
    # X 벡터 형식 — 실수 3개라 밀면 안 된다
    (line("CBEAM", 77, 8, 1, 2, 0.0, 0.0, 1.0),
     ["200077", "200008", "200001", "200002", "0.0", "0.0", "1.0"]),
])
def test_renumber_tells_cbeam_orientation_node_from_orientation_vector(g0_card, expected):
    out = renumber_bulk([g0_card], offset=ID_OFFSET)
    assert _fields(out[0])[:len(expected)] == expected


def test_renumber_stops_on_a_card_it_does_not_know():
    """모르는 카드를 조용히 통과시키면 참조가 어긋난 채 해석이 정상 종료한다."""
    with pytest.raises(MergeError, match="CQUAD8"):
        renumber_bulk([line("CQUAD8", 1, 2, 3, 4, 5, 6, 7)], offset=ID_OFFSET)


def test_verify_catches_a_reference_the_renumberer_missed():
    """필드표에서 한 칸을 빠뜨리면 그 참조만 정반 ID 로 남는다 — 그걸 잡는 그물이다."""
    leaked = [
        line("GRID", 200001, None, 0.0, 0.0, 0.0),
        line("CBEAM", 200077, 200008, 200001, 2, 0.0, 0.0, 1.0),   # 2 = 안 밀린 참조
        line("PBEAML", 200008, 200003, None, "TUBE"),
        line("MAT1", 200003, 206000.0, None, 0.3, 7.85e-9),
    ]
    with pytest.raises(MergeError, match="재번호가 새어 나갔"):
        verify_renumbered(leaked, defined=collect_ids(leaked))


def test_verify_passes_for_a_properly_renumbered_deck():
    out = renumber_bulk(_unit_lines(), offset=ID_OFFSET)
    verify_renumbered(out, defined=collect_ids(out))      # 예외가 없으면 통과다


# ── 좌표계 ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [
    line("CORD2R", 7, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
    line("GRID", 1, 7, 0.0, 0.0, 0.0),                   # CP = 7
])
def test_placement_refuses_a_model_that_is_not_in_global_coordinates(bad):
    with pytest.raises(MergeError, match="전역 좌표계"):
        assert_global_coordinates([bad])


# ── 배치 변환 ─────────────────────────────────────────────────────────────

def _transform_like_the_frontend(point, *, anchor, deck_center, deck_top_z,
                                 offset_x=0.0, offset_y=0.0, rotation_deg=0.0, gap=300.0):
    """feGeometry.transformModulePoint 를 그대로 옮긴 것 — 이 식과 맞는지가 계약이다."""
    lx, ly, lz = (point[i] - anchor[i] for i in range(3))
    th = math.radians(rotation_deg)
    cs, sn = math.cos(th), math.sin(th)
    return (deck_center[0] + offset_x + lx * cs - ly * sn,
            deck_center[1] + offset_y + lx * sn + ly * cs,
            deck_top_z + gap + lz)


@pytest.mark.parametrize("rotation", [0.0, 90.0, 180.0, 270.0])
def test_placement_matches_the_transform_the_screen_uses(rotation):
    anchor = [500.0, 500.0, 0.0]
    out, stats = place_grid_lines(
        _unit_lines(), anchor_mm=anchor, deck_center_mm=(1000.0, 1000.0),
        deck_top_z_mm=1000.0, offset_x_mm=250.0, offset_y_mm=-125.0,
        rotation_z_deg=rotation, gap_mm=300.0,
    )
    coords = grid_coords_map(out)
    for nid, source in grid_coords_map(_unit_lines()).items():
        expected = _transform_like_the_frontend(
            source, anchor=anchor, deck_center=(1000.0, 1000.0), deck_top_z=1000.0,
            offset_x=250.0, offset_y=-125.0, rotation_deg=rotation, gap=300.0)
        assert coords[nid] == pytest.approx(expected, abs=1e-3)
    assert stats["gridCount"] == 4
    assert stats["bottomZMm"] == pytest.approx(1300.0)


def test_placement_puts_the_module_bottom_exactly_at_the_gap():
    _out, stats = place_grid_lines(
        _unit_lines(), anchor_mm=[500.0, 500.0, 0.0], deck_center_mm=(1000.0, 1000.0),
        deck_top_z_mm=8026.0, gap_mm=300.0,
    )
    assert stats["gapMm"] == pytest.approx(300.0)
    assert stats["bottomZMm"] == pytest.approx(8326.0)


# ── 정반 상판과 지지점 배정 ───────────────────────────────────────────────

def test_landing_levels_are_the_flat_shell_faces_only():
    levels = deck_landing_levels(_deck_lines())
    assert [lv["z"] for lv in levels] == [pytest.approx(1000.0)]
    assert [nid for nid, *_ in levels[0]["nodes"]] == list(range(11, 20))  # Leg 절점 1 은 쉘이 아니다


def test_a_two_level_deck_yields_two_landing_levels():
    """★ 실제 A·B 정반이 2단이다. 상단 하나만 보면 하단에 앉을 지지점이 전부 막힌다."""
    levels = deck_landing_levels(_stepped_deck_lines())
    assert [lv["z"] for lv in levels] == [pytest.approx(1000.0), pytest.approx(-2000.0)]
    assert levels[0]["bbox"] == (0.0, 0.0, 2000.0, 2000.0)
    assert levels[1]["bbox"] == (-2000.0, 0.0, 0.0, 2000.0)
    # 배치 기준면은 면적이 가장 넓은 층(같으면 높은 쪽) — 프론트 primary 와 같은 규칙이다.
    assert primary_landing_level(levels)["z"] == pytest.approx(1000.0)


def test_landing_level_lookup_picks_the_highest_face_over_the_point():
    levels = deck_landing_levels(_stepped_deck_lines())
    assert landing_level_at(levels, 1000.0, 1000.0)["z"] == pytest.approx(1000.0)
    assert landing_level_at(levels, -1000.0, 1000.0)["z"] == pytest.approx(-2000.0)
    assert landing_level_at(levels, 9000.0, 1000.0) is None


def test_a_full_rectangle_level_needs_no_triangle_test():
    """A·B 정반처럼 꽉 찬 사각형이면 삼각형을 들고 있지 않는다(판정은 bbox 로 끝난다)."""
    levels = deck_landing_levels(_deck_lines())
    assert levels[0]["solidRect"] is True
    assert levels[0]["tris"] == []


def test_a_hole_in_the_deck_is_not_a_landing_place():
    """★ 구멍 뚫린 상판 — bbox 안이지만 면이 없는 자리는 적치면이 아니다.

    화면(feGeometry.landingLevelAt)이 삼각형까지 보고 '밖' 이라 판정하는 자리를
    서버가 bbox 만 보고 '안' 이라 하면, 두 쪽이 서로 다른 배치를 푼다.
    """
    levels = deck_landing_levels(_holed_deck_lines())
    assert len(levels) == 1
    assert levels[0]["solidRect"] is False, "구멍이 있으면 꽉 찬 사각형이 아니다"

    # 구멍 한가운데 — bbox 안이지만 쉘이 없다.
    assert landing_level_at(levels, 1500.0, 1500.0) is None
    # 구멍 바로 옆 판 위 — 정상적으로 잡힌다.
    assert landing_level_at(levels, 500.0, 500.0)["z"] == pytest.approx(1000.0)
    assert landing_level_at(levels, 2500.0, 2500.0)["z"] == pytest.approx(1000.0)


def test_a_support_over_a_hole_is_refused_by_name():
    """구멍 위 지지점은 '발밑에 적치면이 없다' 로 절점 번호를 대며 막힌다."""
    levels = deck_landing_levels(_holed_deck_lines())
    with pytest.raises(MergeError, match="1234"):
        pair_supports_to_plate([(1234, 1500.0, 1500.0)], levels)


def test_deck_spc_sid_is_the_only_boundary_condition():
    assert deck_spc_sid(_deck_lines()) == 1


def test_each_support_takes_the_nearest_free_plate_node():
    levels = deck_landing_levels(_deck_lines())
    pairs = pair_supports_to_plate([(1, 0.0, 0.0), (2, 2000.0, 2000.0)], levels)
    assert [p["deckNodeId"] for p in pairs] == [11, 19]
    assert all(p["distanceMm"] == pytest.approx(0.0) for p in pairs)


def test_a_support_is_paired_to_a_node_on_its_own_level():
    """★ 층을 섞으면 스툴이 단차를 가로질러 엉뚱한 곳에 하중을 건다."""
    levels = deck_landing_levels(_stepped_deck_lines())
    pairs = pair_supports_to_plate([(1, 1000.0, 1000.0), (2, -1000.0, 1000.0)], levels)
    assert pairs[0]["landingZMm"] == pytest.approx(1000.0)
    assert pairs[1]["landingZMm"] == pytest.approx(-2000.0)
    assert pairs[0]["deckXYZMm"][2] == pytest.approx(1000.0)
    assert pairs[1]["deckXYZMm"][2] == pytest.approx(-2000.0)


def test_pairing_refuses_a_support_with_no_landing_level_below_it():
    levels = deck_landing_levels(_deck_lines())
    with pytest.raises(MergeError, match="발밑에 정반 적치면이 없습니다"):
        pair_supports_to_plate([(7, 9000.0, 9000.0)], levels)


def test_two_supports_never_share_a_plate_node():
    """같은 절점을 두 지지점이 종속으로 잡으면 Nastran 이 m-set 충돌로 죽는다."""
    levels = deck_landing_levels(_deck_lines())
    pairs = pair_supports_to_plate([(1, 0.0, 0.0), (2, 10.0, 10.0)], levels)
    assert pairs[0]["deckNodeId"] != pairs[1]["deckNodeId"]


def test_supports_skip_plate_nodes_that_are_already_rigid_dependents():
    levels = deck_landing_levels(_deck_lines())
    pairs = pair_supports_to_plate([(1, 0.0, 0.0)], levels, forbidden=[11])
    assert pairs[0]["deckNodeId"] != 11


def test_pairing_refuses_when_there_are_more_supports_than_plate_nodes():
    levels = deck_landing_levels(_deck_lines())
    with pytest.raises(MergeError, match="남지 않았"):
        pair_supports_to_plate([(n, 0.0, 0.0) for n in range(20)], levels)


# ── 중량 여유 ─────────────────────────────────────────────────────────────

def test_contingency_scales_density_and_lumped_mass():
    out = scale_mass(_unit_lines(), 1.1, what="Module Unit")
    rho = _fields(_card(out, "MAT1", 3))[4]
    assert float(rho.replace("-9", "e-9")) == pytest.approx(7.85e-9 * 1.1, rel=1e-6)
    assert float(_fields(_card(out, "CONM2", 90))[3]) == pytest.approx(0.55)


def test_zero_contingency_leaves_the_deck_byte_identical():
    assert scale_mass(_unit_lines(), 1.0, what="Module Unit") == _unit_lines()


def test_contingency_refuses_a_mass_card_it_cannot_scale():
    """일부 질량에만 여유율이 걸리면 조용히 틀린다 — 그럴 바에는 멈춘다."""
    with pytest.raises(MergeError, match="MAT8"):
        scale_mass([line("MAT8", 5, 1.0)], 1.1, what="Module Unit")


def test_param_cards_are_collected_once_per_name():
    rest, params = split_param_lines(["PARAM,POST,-1", "PARAM,POST,-2",
                                      line("GRID", 1, None, 0.0, 0.0, 0.0)])
    assert list(params) == ["POST"]
    assert params["POST"] == "PARAM,POST,-1"        # 먼저 나온 것을 남긴다
    assert len(rest) == 1


# ── 합본 전체 ─────────────────────────────────────────────────────────────

def _build(**overrides):
    kwargs = dict(
        deck_bulk_lines=_deck_lines(),
        unit_bulk_lines=_unit_lines(),
        support_node_ids=[1, 2, 3],
        placement=_placement(),
        accel_g=(0.0, 0.0, -1.0),
    )
    kwargs.update(overrides)
    return build_combined_bdf(**kwargs)


def test_combined_bdf_keeps_the_deck_spc_as_the_only_boundary_condition():
    build = _build()
    text = build["text"]
    assert f"  SPC = {build['spcSid']}" in text
    assert "SPC1" not in text                    # 우리가 새로 거는 구속은 없다
    assert text.count("SPC     ") == 1


def test_combined_bdf_replaces_the_deck_own_gravity_load():
    """정반 BDF 는 자기 GRAV 를 품고 있다. 남겨 두면 하중이 두 번 걸린다."""
    build = _build()
    gravs = [raw for raw in build["text"].splitlines() if raw.startswith("GRAV    ")]
    assert len(gravs) == 1
    assert int(_fields(gravs[0])[0]) == build["loadSid"]
    assert f"  LOAD = {build['loadSid']}" in build["text"]
    assert build["removedDeckLoadCards"] == {"GRAV": 1}


def test_combined_bdf_connects_every_support_to_one_plate_node():
    build = _build()
    bulk = extract_bulk_lines(build["text"])
    rbe2 = [raw for raw in bulk if raw.startswith("RBE2    ")]
    # Module Unit 자체 RBE2 1개 + 지지점 3개
    assert len(rbe2) == 1 + len(build["supportPairs"])
    for pair in build["supportPairs"]:
        gn = int(pair["moduleNodeId"]) + build["idOffset"]
        assert any(_fields(raw)[1] == str(gn) and _fields(raw)[3] == str(pair["deckNodeId"])
                   for raw in rbe2)


def test_support_rbe2_makes_the_deck_node_the_dependent_one():
    """정반 쉘 절점의 법선 회전은 강성이 없다 — 독립으로 두면 특이가 된다."""
    build = _build()
    rbe2 = [raw for raw in extract_bulk_lines(build["text"])
            if raw.startswith("RBE2    ") and int(_fields(raw)[0]) >= 990100]
    for raw in rbe2:
        fields = _fields(raw)
        assert int(fields[1]) > build["idOffset"]      # GN = Module Unit
        assert int(fields[3]) < build["idOffset"]      # GM = 정반
        assert fields[2] == "123456"


def test_combined_bdf_reports_the_support_pairs_with_screen_side_node_ids():
    """화면은 업로드한 BDF 의 절점 ID 만 안다 — 밀어 둔 ID 로 돌려주면 못 알아본다."""
    build = _build()
    assert sorted(p["moduleNodeId"] for p in build["supportPairs"]) == [1, 2, 3]


def test_combined_bdf_leaves_the_module_unit_clear_of_the_deck():
    # 이 픽스처는 지지점 셋이 모두 모듈 최하단(local z 0)이라 스툴이 전부 이격값과 같다.
    # 숫자를 박아 두면 이격을 바꿀 때마다 계약이 아니라 상수를 다시 적게 된다.
    build = _build()
    c = DEFAULT_CLEARANCE_MM
    assert build["clearanceMm"] == pytest.approx(c)
    assert build["supportStoolMm"] == {"min": pytest.approx(c), "max": pytest.approx(c)}
    assert build["gapMm"] == pytest.approx(c)
    assert build["minDeckClearanceMm"] == pytest.approx(c)
    assert build["moduleBottomZMm"] > build["deckMaxZMm"]


def test_combined_bdf_puts_the_lowest_support_at_the_clearance():
    """★ 높이를 정하는 것은 지지점이다 — 지지점이 500 높으면 모듈은 500 내려온다."""
    # 절점 4(local z 500)만 지지점으로 쓰고, 그보다 낮은 절점 1·2 는 상판 **밖**에 둔다
    # (bbox 중심이 절점 4 에 오도록 대칭으로 배치했다 — anchor 는 화면 식 그대로다).
    # 지지점보다 낮은 부재가 정반 위에 없으므로 통과해야 한다.
    unit = [
        line("GRID", 1, None, -2500.0, -2500.0, 0.0),        # 상판 밖(아래에 정반 없음)
        line("GRID", 2, None, 3500.0, 3500.0, 0.0),
        line("GRID", 4, None, 500.0, 500.0, 500.0),          # 유일한 지지점
        line("CBEAM", 77, 8, 1, 4, 0.0, 0.0, 1.0),
        line("CBEAM", 78, 8, 2, 4, 0.0, 0.0, 1.0),
        line("PBEAML", 8, 3, None, "TUBE"),
        cont(50.8, 47.6, 0.0),
        line("MAT1", 3, 206000.0, None, 0.3, 7.85e-9),
    ]
    build = _build(unit_bulk_lines=unit, support_node_ids=[4])
    assert build["gapMm"] == pytest.approx(DEFAULT_CLEARANCE_MM - 500.0),         "지지점이 500 높으면 모듈 바닥은 그만큼 더 내려간다"
    # 그래도 상판 위에 있는 것은 지지점뿐이고, 그 지지점은 정확히 이격값 위에 있다.
    pair = build["supportPairs"][0]
    assert pair["moduleNodeId"] == 4
    assert build["minDeckClearanceMm"] == pytest.approx(DEFAULT_CLEARANCE_MM)


def test_combined_bdf_refuses_a_member_lower_than_the_supports_over_the_plate():
    """사용자 결정: 지지점보다 낮은 부재가 상판 위에 있으면 막고 그 절점을 알려 준다."""
    with pytest.raises(MergeError, match="절점 1 이 정반면에서"):
        _build(support_node_ids=[4])       # 절점 4 는 z=500, 절점 1~3 은 z=0 이고 상판 위다


def test_combined_bdf_refuses_a_support_with_no_landing_level_below_it():
    unit = _unit_lines() + [line("GRID", 5, None, 9000.0, 9000.0, 0.0)]
    with pytest.raises(MergeError, match="발밑에 정반 적치면이 없습니다"):
        _build(unit_bulk_lines=unit, support_node_ids=[5])


def test_combined_bdf_seats_a_stepped_module_on_a_two_level_deck():
    """★ 사용자 형상 그대로 — 단차진 모듈이 2단 정반의 두 층에 나눠 앉는다.

    이것이 "지지점 5개가 상판 밖입니다" 를 만든 형상이다. 상단 하나만 적치면으로
    보면 하단에 앉을 발이 전부 밖으로 판정돼 3단계가 막혔다. 이제는 층마다 앉고,
    스툴 길이만 층별로 달라진다.
    """
    # 모듈: 하단(z=-2000)에 앉을 발 2개(local z 0) + 상단(z=1000)에 앉을 발 2개(local z 3200).
    # bbox XY 중심 = (0, 1000) → anchor. 정반 기준면 중심은 (1000, 1000) 이라 X 오프셋 -1000.
    unit = [
        line("GRID", 1, None, -1000.0, 500.0, 0.0),
        line("GRID", 2, None, -1000.0, 1500.0, 0.0),
        line("GRID", 3, None, 1000.0, 500.0, 3200.0),
        line("GRID", 4, None, 1000.0, 1500.0, 3200.0),
        line("CBEAM", 77, 8, 1, 3, 0.0, 0.0, 1.0),
        line("CBEAM", 78, 8, 2, 4, 0.0, 0.0, 1.0),
        line("PBEAML", 8, 3, None, "TUBE"),
        cont(50.8, 47.6, 0.0),
        line("MAT1", 3, 206000.0, None, 0.3, 7.85e-9),
    ]
    build = _build(
        deck_bulk_lines=_stepped_deck_lines(),
        unit_bulk_lines=unit,
        support_node_ids=[1, 2, 3, 4],
        placement=_placement(anchorMm=[0.0, 1000.0, 0.0], offsetXMm=-1000.0),
    )
    # baseZ = max(-2000 + c - 0, 1000 + c - 3200) = -2000 + c → 하단이 빡빡한 쪽이다.
    # 하단 발은 스툴이 정확히 c, 상단 발은 (정반 단차 3,000 − 모듈 단차 3,200)만큼 더 길다.
    c = DEFAULT_CLEARANCE_MM
    stools = {p["moduleNodeId"]: p["stoolMm"] for p in build["supportPairs"]}
    assert stools[1] == pytest.approx(c)
    assert stools[2] == pytest.approx(c)
    assert stools[3] == pytest.approx(c + 200.0)      # (-2000 + c + 3200) - 1000
    assert stools[4] == pytest.approx(c + 200.0)
    assert {p["landingZMm"] for p in build["supportPairs"]} == {1000.0, -2000.0}
    assert build["supportStoolMm"] == {"min": pytest.approx(c), "max": pytest.approx(c + 200.0)}
    assert [lv["zMm"] for lv in build["landingLevelsMm"]] == [1000.0, -2000.0]


def test_combined_bdf_refuses_a_gap_that_disagrees_with_the_screen():
    """프론트·백엔드의 층 판정이 갈리면 결과만 보고는 알 수 없다 — 여기서 멈춘다."""
    with pytest.raises(MergeError, match="적치 검사를 다시 실행"):
        _build(placement=_placement(gapMm=1234.0))


def test_combined_bdf_refuses_a_placement_that_drifted_from_the_screen():
    with pytest.raises(MergeError, match="어긋납니다"):
        _build(placement=_placement(deckCenterMm=[1500.0, 1000.0]))


def test_combined_bdf_refuses_a_deck_top_that_disagrees_with_the_screen():
    with pytest.raises(MergeError, match="다릅니다"):
        _build(placement=_placement(deckTopZMm=8026.0))


def test_combined_bdf_accepts_the_placement_the_screen_computed():
    build = _build(placement=_placement(deckCenterMm=[1000.0, 1000.0], deckTopZMm=1000.0))
    assert build["deckCenterMm"] == [1000.0, 1000.0]


def test_combined_bdf_restricts_output_to_the_module_unit():
    """정반 쉘까지 응력을 찍으면 F06 이 수백 MB 가 되는데 평가 대상이 아니다."""
    build = _build()
    text = build["text"]
    lo, hi = build["unitElementIdRange"]
    assert f"SET 200 = {lo} THRU {hi}" in text
    assert "  STRESS = 200" in text
    assert "  FORCE = 200" in text
    assert "  DISPLACEMENT = 100" in text
    assert "  SPCFORCES = ALL" in text          # Leg 반력은 정반 쪽이라 전체로 받는다


def test_combined_bdf_never_lets_the_two_decks_share_an_id():
    build = _build()
    bulk = extract_bulk_lines(build["text"])
    deck_ids = set(collect_ids(_deck_lines())["grid"])
    unit_ids = {nid for nid in grid_coords_map(bulk) if nid > build["idOffset"]}
    assert not (deck_ids & unit_ids)
    assert len(grid_coords_map(bulk)) == 10 + 4        # 정반 10 + Module Unit 4


def test_combined_bdf_refuses_a_support_node_that_is_not_in_the_model():
    with pytest.raises(MergeError, match="찾지 못했"):
        _build(support_node_ids=[1, 4242])


def test_combined_bdf_carries_the_contingency_into_the_model_mass():
    build = _build(deck_contingency_pct=10.0, module_contingency_pct=5.0)
    bulk = extract_bulk_lines(build["text"])
    deck_rho = _fields(_card(bulk, "MAT1", 1))[4]
    unit_rho = _fields(_card(bulk, "MAT1", 200003))[4]
    assert float(deck_rho.replace("-9", "e-9")) == pytest.approx(7.85e-9 * 1.10, rel=1e-6)
    assert float(unit_rho.replace("-9", "e-9")) == pytest.approx(7.85e-9 * 1.05, rel=1e-6)


def test_combined_bdf_writes_one_param_per_name():
    build = _build()
    posts = [raw for raw in build["text"].splitlines() if raw.upper().startswith("PARAM,POST")]
    assert len(posts) == 1


def test_combined_bdf_data_cards_stay_within_eighty_columns():
    """Nastran 은 데이터 줄의 81번째 칸부터를 **말없이 버린다**.

    주석($)은 통째로 무시되므로 길이를 재지 않는다 — 생성 내역을 한 줄에 적는 편이 낫다.
    """
    text = build_combined_bdf(
        deck_bulk_lines=_deck_lines(), unit_bulk_lines=_unit_lines(),
        support_node_ids=[1], placement=_placement(), accel_g=(0.0, 0.0, -1.0),
    )["text"]
    for raw in extract_bulk_lines(text):
        if raw.lstrip().startswith("$"):
            continue
        assert len(raw) <= 80, raw


def test_combined_bdf_publishes_the_pair_distance_warning_threshold():
    """화면이 같은 기준으로 경고하도록 문턱값을 결과에 싣는다 — 400 을 프론트에 다시
    적으면 두 값이 갈린다."""
    from app.services.module_ocean_merge import PAIR_WARN_MM

    build = build_combined_bdf(
        deck_bulk_lines=_deck_lines(),
        unit_bulk_lines=_unit_lines(),
        support_node_ids=[1, 2, 3],
        placement=_placement(),
        accel_g=(0.0, 0.0, -1.0),
    )
    assert build["pairWarnMm"] == PAIR_WARN_MM
    # 이 픽스처의 정반 격자는 1,000mm 라 가장 가까운 절점도 707mm 떨어져 있다 —
    # 실제 정반(약 400mm 격자)보다 성기므로 경고 문턱을 넘는 것이 정상이다.
    assert build["maxPairDistanceMm"] > PAIR_WARN_MM
