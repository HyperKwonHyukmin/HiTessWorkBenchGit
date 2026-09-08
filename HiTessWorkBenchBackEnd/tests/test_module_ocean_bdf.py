"""Module Unit 해상 운송 — BDF 조립 순수 함수 테스트.

파일 I/O 도 Nastran 도 타지 않는다. 문자열이 들어가 문자열이 나오므로
골든 텍스트로 카드 양식을 고정할 수 있다.

단위계: mm · ton · s (힘 N, 응력 MPa, 가속도 mm/s²)
"""
import math

import pytest

from app.services.module_ocean_bdf import (
    DEFAULT_SMALL_BORE_MAX_OD_MM,
    G_MM_S2,
    LOAD_SID,
    element_node_map,
    grav_line,
    line,
    real8,
    small_bore_element_ids,
)


def parse_bdf_real(text):
    """BDF 8칸 실수 표기를 float 으로 되돌린다 — Nastran 압축 지수 포함('7.85-9' → 7.85e-9)."""
    body = text.strip()
    sign = ""
    if body[0] in "+-":
        sign, body = body[0], body[1:]
    for i in range(1, len(body)):
        if body[i] in "+-":
            return float(f"{sign}{body[:i]}e{body[i:]}")
    return float(sign + body)


# ── 고정필드 포맷 ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    (0.0, "0.0"),
    (-125.0, "-125.0"),
    (20260.0, "20260.0"),
    (0.3, "0.3"),
    (9806.65, "9806.65"),
    (7.85e-9, "7.85-9"),      # Nastran 압축 지수 표기
])
def test_real8_keeps_decimal_within_eight_columns(value, expected):
    out = real8(value)
    assert out == expected
    assert len(out) <= 8


def test_real8_rejects_unrepresentable():
    with pytest.raises(ValueError):
        real8(float("nan"))


# 이 도메인의 실제 값 범위: 좌표 ~1e6 mm, 질량 ~1e2 t, 가속도 크기 ~1e4 mm/s²,
# 방향 코사인 ~1e-6..1. 그 범위를 대표하는 '깔끔하지 않은' 값들이다.
@pytest.mark.parametrize("value", [
    13868.697431446113,   # |(1,0,-1)| · g — sqrt 에서 나오는 전형적 GRAV 크기
    9806.650000000001,
    1234567.8,            # 큰 좌표 — '1234568.' 처럼 끝의 점만 남는 형태
    0.00012345678,
    1.23456e-6,           # 거의 축정렬인 가속도의 방향 코사인
    1.23456789e-9,
])
def test_real8_falls_back_to_best_approximation(value):
    """8칸 안에 정확히 복원되는 표기가 없는 값도 최선 근사로 담아야 한다.

    정확 복원을 고집하면 sqrt/삼각함수에서 나온 실제 가속도 크기가 전부 ValueError 가 된다.
    """
    out = real8(value)
    assert len(out) <= 8
    assert parse_bdf_real(out) == pytest.approx(value, rel=1e-4)


@pytest.mark.parametrize("value", [
    0.0, -125.0, 20260.0, 0.3, 9806.65, 7.85e-9,
    13868.697431446113, -1234567.8, 0.00012345678, 1.23456e-6, 1.23456789e-9,
])
def test_real8_always_contains_a_decimal_point(value):
    """MSC Nastran 실수 필드는 소수점을 요구한다 — 어떤 경로로 나오든 이 불변식은 지켜야 한다.

    소수점 없는 압축 지수('12345+8')는 유효숫자를 하나 더 벌지만 실수 필드에서 안전하지 않다.
    """
    assert "." in real8(value)


def test_line_pads_card_left_and_fields_right():
    # GRID 카드: 카드명 8칸 좌측정렬, 각 필드 8칸 우측정렬
    out = line("GRID", 9001, None, 20260.0, 5200.0, -125.0)
    assert out.startswith("GRID    ")
    assert out[8:16] == "    9001"
    assert out[16:24] == "        "      # CP 는 공백
    assert out[24:32] == " 20260.0"
    assert len(out) <= 80


def test_line_rejects_field_longer_than_eight():
    with pytest.raises(ValueError):
        line("GRID", 1234567890)


def test_line_leaves_the_continuation_column_free():
    """10번째 칸은 continuation 필드다 — 데이터로 채우면 뒤따르는 cont() 가 연결되지 않는다."""
    full = line("TESTCARD", 1, 2, 3, 4, 5, 6, 7, 8)
    assert len(full) <= 72                      # 카드 + 8필드 = 72칸, 10번째 칸은 비어 있다
    with pytest.raises(ValueError, match="continuation"):
        line("TESTCARD", 1, 2, 3, 4, 5, 6, 7, 8, 9)


def test_field_rejects_bool():
    """bool 은 int 의 서브클래스라 막지 않으면 '    True' 가 BDF 에 박힌다."""
    with pytest.raises(ValueError, match="bool"):
        line("GRID", True)


# ── 가속도 좌표 변환 ──────────────────────────────────────────────────────







# ── GRAV ─────────────────────────────────────────────────────────────────

def _grav_fields(out):
    return [out[i:i + 8].strip() for i in range(8, len(out), 8)]


def test_grav_line_unit_gravity():
    out = grav_line(LOAD_SID, (0.0, 0.0, -1.0))
    assert out.startswith("GRAV    ")
    fields = _grav_fields(out)
    assert fields[0] == str(LOAD_SID)
    assert fields[1] == "0"
    assert float(fields[2]) == pytest.approx(G_MM_S2)
    assert [float(f) for f in fields[3:6]] == [0.0, 0.0, -1.0]


@pytest.mark.parametrize("accel", [
    (0.0, 0.0, -2.0),
    (0.093, 0.273, -1.168),
    (0.007, 0.075, -1.0),
])
def test_grav_line_writes_the_g_values_verbatim(accel):
    """A 는 항상 중력가속도, N 칸에는 입력한 g 값이 **그대로** 찍혀야 한다.

    Nastran 하중은 A x N 이라 정규화해도 결과는 같지만, BDF 를 열어 하중조건을
    확인하는 사람은 N 칸에서 설계 g 값을 바로 읽어야 한다(사내 표기 규약).
    """
    fields = _grav_fields(grav_line(LOAD_SID, accel))
    assert float(fields[2]) == pytest.approx(G_MM_S2)
    assert [float(f) for f in fields[3:6]] == pytest.approx(list(accel))


def test_grav_line_rejects_zero_acceleration():
    with pytest.raises(ValueError, match="가속도"):
        grav_line(LOAD_SID, (0.0, 0.0, 0.0))


@pytest.mark.parametrize("accel", [
    (1.0, 0.0, -1.0),
    (0.3, -0.2, -1.05),
    (0.15, 0.27, -1.0),
])
def test_grav_line_load_vector_is_the_acceleration_in_mm_s2(accel):
    """표기를 바꿔도 실제 하중(A x N)은 같아야 한다 — 결과가 달라지면 안 된다."""
    out = grav_line(LOAD_SID, accel)
    assert out.startswith("GRAV    ")
    assert len(out) <= 80
    fields = _grav_fields(out)
    magnitude = float(fields[2])
    vector = [magnitude * float(f) for f in fields[3:6]]
    assert vector == pytest.approx([v * G_MM_S2 for v in accel], rel=1e-6)


from app.services.module_ocean_bdf import (
    extract_bulk_lines,
    next_free_load_sid,
    rigid_dependent_nodes,
    stabilization_param_lines,
    strip_constraint_cards,
)


SAMPLE_DECK = """\
SOL 101
CEND
TITLE = original
BEGIN BULK
$ 원본 주석
GRID           1              0.0     0.0     0.0
GRID           2           1000.0     0.0     0.0
SPC1           7  123456       1       2
SPC            9       1  123456     0.0
SUPORT         1  123456
CBEAM          1       1       1       2     1.0     0.0     0.0
ENDDATA
"""


def test_extract_bulk_lines_takes_only_bulk_region():
    bulk = extract_bulk_lines(SAMPLE_DECK)
    assert bulk[0].startswith("$ 원본 주석")
    assert not any("SOL 101" in ln for ln in bulk)
    assert not any("ENDDATA" in ln for ln in bulk)


def test_extract_bulk_lines_treats_bulk_only_file_as_bulk():
    text = "GRID           1              0.0     0.0     0.0\n"
    assert extract_bulk_lines(text) == ["GRID           1              0.0     0.0     0.0"]


def test_strip_constraint_cards_removes_spc_family():
    kept, removed = strip_constraint_cards(extract_bulk_lines(SAMPLE_DECK))
    assert not any(ln.startswith(("SPC", "SUPORT")) for ln in kept)
    assert any(ln.startswith("CBEAM") for ln in kept)
    assert removed == {"SPC1": 1, "SPC": 1, "SUPORT": 1}


def test_strip_constraint_cards_removes_continuation_lines():
    bulk = [
        "SPC1           7  123456       1       2       3       4       5       6",
        "                     7       8",
        "GRID           9              0.0     0.0     0.0",
    ]
    kept, _ = strip_constraint_cards(bulk)
    assert kept == ["GRID           9              0.0     0.0     0.0"]


@pytest.mark.parametrize("continuation", [
    "                     7       8",      # 고정필드 — 첫 8칸 공백
    "+SP1           7       8",            # 연속 마커
    ",5,123456,6,123456",                  # free-field — 콤마로 시작
])
def test_strip_constraint_cards_removes_every_continuation_form(continuation):
    """원본 BDF 는 외부에서 오므로 연속행 양식을 강제할 수 없다.

    한 형태라도 놓치면 구속 카드 본문만 지워지고 연속행이 살아남아,
    깨진 조각이 생성 BDF 에 실린다.
    """
    bulk = [
        "SUPORT1,1,123456,2,123456,3,123456,4,123456",
        continuation,
        "GRID,7,,0.0,0.0,0.0",
    ]
    kept, removed = strip_constraint_cards(bulk)
    assert kept == ["GRID,7,,0.0,0.0,0.0"]
    assert removed == {"SUPORT1": 1}








# ── 과정 2: Leg 반력 모델 BDF ─────────────────────────────────────────────

# 실제 정반 A 형상 — Leg SPC 절점 z=-125, 그 위 Module Unit 지지 rigid 절점 z=2020.
























# ── 생성 SID 가 원본과 겹치는 경우 ────────────────────────────────────────
# 실제 Nastran 으로 재현한 결함이다: 원본이 이미 SID 990002 를 하중 카드에 쓰고 있으면
# "USER FATAL MESSAGE 9994 (BULKPM) ... Entry was found previously with the same key(s)."
# 로 해석이 즉시 죽는다. 원본 BDF 는 외부에서 오므로 대역 관행만 믿을 수 없다.
# (합본 BDF 가 이 SID 를 case control 의 LOAD 와 맞춰 쓰는지는 test_module_ocean_merge 가 본다.)

def test_load_sid_is_kept_when_original_does_not_use_it():
    assert next_free_load_sid(["GRID           1              0.0     0.0     0.0"]) == LOAD_SID


@pytest.mark.parametrize("colliding", [
    "GRAV      990002       0  9800.0     0.0     0.0    -1.0",   # 고정필드
    "GRAV,990002,0,9800.0,0.0,0.0,-1.0",                          # free-field
    "FORCE     990002       1       0    100.0     1.0     0.0",  # 다른 하중 카드
])
def test_load_sid_moves_off_a_sid_the_original_already_uses(colliding):
    sid = next_free_load_sid(["GRID           1              0.0     0.0     0.0", colliding])
    assert sid != LOAD_SID


def test_load_sid_skips_a_whole_run_of_taken_sids():
    """비어 있는 자리를 찾을 때까지 계속 올라가야 한다 — 한 칸만 비켜서는 부족하다."""
    taken = [f"GRAV      {LOAD_SID + n}       0  9800.0     0.0     0.0    -1.0"
             for n in range(3)]
    assert next_free_load_sid(taken) == LOAD_SID + 3


def test_load_sid_scan_ignores_comments_and_non_load_cards():
    sid = next_free_load_sid([
        "$ GRAV      990002 는 주석이라 세면 안 된다",
        "PBEAML    990002       1               H",   # 하중 카드가 아니다
    ])
    assert sid == LOAD_SID








# ── RBE2 dependent 절점에는 SPC 를 걸 수 없다 ─────────────────────────────
# 실제 Nastran 으로 재현한 결함이다: m-set(강체 종속) 자유도에 s-set(SPC)을 걸면
# "USER FATAL MESSAGE 2101 (GP4) ... ILLEGALLY DEFINED IN SETS UM US" 로 죽는다.
# 과정 2 는 스터브 빔으로 두 집합을 갈라 놨지만 과정 1 은 원본 모델에 그대로 건다.

RBE2_DECK = [
    "GRID           1              0.0     0.0     0.0",
    "GRID           2           1000.0     0.0     0.0",
    "GRID           3           2000.0     0.0     0.0",
    "RBE2         500       1  123456       2       3",
    "CBEAM          1       1       1       2     1.0     0.0     0.0",
]


def test_rigid_dependent_nodes_reads_rbe2_gm_fields():
    assert rigid_dependent_nodes(RBE2_DECK) == {2, 3}


def test_rigid_dependent_nodes_reads_continuation_lines():
    deck = [
        "RBE2         500       1  123456       2       3       4       5       6",
        "               7       8",
        "GRID           9              0.0     0.0     0.0",
    ]
    assert rigid_dependent_nodes(deck) == {2, 3, 4, 5, 6, 7, 8}


def test_rigid_dependent_nodes_ignores_alpha_field():
    """RBE2 마지막 필드는 열팽창계수(ALPHA, 실수)일 수 있다 — 절점으로 세면 안 된다."""
    deck = ["RBE2         500       1  123456       2       3  1.2-5"]
    assert rigid_dependent_nodes(deck) == {2, 3}






# ── 해석 안정화 PARAM ─────────────────────────────────────────────────────
# 같은 MU 모델을 돌리는 GMU 권상 파이프라인과 동일 정책이다. 없으면 접촉 절점
# 몇 개로 지지할 때 USER FATAL 9050(EXCESSIVE PIVOT RATIOS)으로 죽는다.



@pytest.mark.parametrize("existing,expected_absent", [
    ("PARAM,AUTOSPC,NO", "PARAM,AUTOSPC,YES"),
    ("PARAM    BAILOUT       0", "PARAM,BAILOUT,-1"),
])
def test_stabilization_params_do_not_override_the_original(existing, expected_absent):
    """원본이 이미 지정했다면 그 선택을 덮어쓰지 않는다 — 중복 PARAM 도 피한다."""
    added = stabilization_param_lines([
        "GRID           1              0.0     0.0     0.0",
        existing,
    ])
    assert expected_absent not in added


def test_stabilization_params_are_added_when_the_original_is_silent():
    added = stabilization_param_lines(["GRID           1              0.0     0.0     0.0"])
    assert "PARAM,AUTOSPC,YES" in added
    assert "PARAM,BAILOUT,-1" in added


# ── 요소-절점 지도 ───────────────────────────────────────────────────────
# F06 특이도 표는 절점으로만 말하는데 응력 평가는 요소 단위라 이 다리가 필요하다.

def test_element_node_map_reads_fixed_field_beams():
    bulk = [
        "CBEAM       1990       2       9    1439     0.0-0.00851 0.99996     BGG",
        "CBAR         101       5     200     201      0.      0.      1.",
        "GRID           9               0    10.0    20.0 29453.0",
    ]
    mapping = element_node_map(bulk)
    assert mapping == {1990: (9, 1439), 101: (200, 201)}


def test_element_node_map_reads_free_field_and_conrod():
    """CONROD 는 EID GA GB MID 라 GA/GB 위치가 다르다 — 같은 자리로 읽으면 안 된다."""
    mapping = element_node_map([
        "CBEAM,7,2,11,12",
        "CONROD,8,21,22,1,100.0",
    ])
    assert mapping == {7: (11, 12), 8: (21, 22)}


def test_element_node_map_skips_malformed_and_non_line_elements():
    mapping = element_node_map([
        "CQUAD4         1       1       1       2       3       4",
        "CBEAM          2",
        "CBEAM          3       2     abc     def",
        "CBEAM          4       2      10      11",
    ])
    assert mapping == {4: (10, 11)}


# ── 부분 구속 RBE2 승격 (고박 처리) ──────────────────────────────────────
#
# 운송 검토는 **고박된 상태**를 푼다. 입력 BDF 는 운전 조건이라 배관 지지가
# 미끄러지는 지지(CM=13 처럼 한두 축만 잡는 것)로 돼 있는데, 운송 가속도는 그 자유
# 방향으로 그대로 들어온다. 실측(3521): OD406 배관 15.3m 의 상부 지지 2점이 CM=13
# (Y 자유)이라 Y 로 214mm 흔들렸고, 전부 승격하니 45.6mm 로 내려왔다.
#
# 잡는 것은 **병진 3개(123)뿐**이다. 회전까지 잡으면 두 강체 사이에 끼인 짧은 부재가
# 회전차를 흡수해 가짜 모멘트를 받는다 — 실측(3521, 소구경 제외 후) 123456 은 최대
# 459.4MPa(초과 2), 123 은 137.4MPa(초과 0). _SEA_FASTEN_CM 주석 참조.

from app.services.module_ocean_bdf import promote_partial_rigid_cm  # noqa: E402


def _floating_model():
    """접지된 본체(1-2-3) + 부분 구속 RBE2 하나로만 매달린 조각(10-11)."""
    return [
        "CBEAM          1       2       1       2      0.      0.      1.",
        "CBEAM          2       2       2       3      0.      0.      1.",
        "CBEAM         10       2      10      11      0.      0.      1.",
        "RBE2         100       3       3      10",
    ]


def test_piece_hanging_by_a_single_tie_is_escalated_to_full_fixity():
    """★ 한 점에만 매달린 조각은 병진만 잡으면 그 점을 축으로 **자유 회전** 한다.

    실측(3521): L 50×50×6 앵글 8개짜리 9절점 조각이 RBE2 하나(원래 CM=13)로 절점
    한 개에만 붙어 있었는데, 123 만 채웠더니 최대 변위가 3.4e12 mm 로 폭주했다
    (PARAM,BAILOUT 이라 해석은 끝까지 가고 요약 숫자는 멀쩡해 보인다).
    강체를 고정하려면 한 점 완전구속이거나 비공선 3점이 필요하다.
    """
    lines, info = promote_partial_rigid_cm(_floating_model(), spc_node_ids=[1])
    assert info["promotedEids"] == [100]
    assert info["escalatedEids"] == [100], "회전을 안 잡으면 조각이 돌아가 버린다"
    assert info["ungroundedComponentCount"] == 0
    rbe2 = next(l for l in lines if l.startswith("RBE2"))
    assert rbe2[24:32].strip() == "123456"
    # 나머지 필드는 한 칸도 밀리면 안 된다(RBE2 첫 줄은 GM5 까지 꽉 찰 수 있다).
    assert rbe2[8:16].strip() == "100" and rbe2[16:24].strip() == "3"
    assert rbe2[32:40].strip() == "10"


def _grounded_piece(cm="13"):
    """비공선 3점으로 본체에 매인 조각 — 회전 자유가 없으므로 123 으로 충분하다.

    좌표를 주는 이유: '세 점이 한 직선 위인가' 를 실제로 재기 때문이다(2점이거나
    일직선이면 그 축으로 여전히 돌 수 있어 완전 강결로 올려야 한다).
    """
    return [
        # 본체 1-2-3 (접지) / 조각 10-11-12
        "CBEAM          1       2       1       2      0.      0.      1.",
        "CBEAM          2       2       2       3      0.      0.      1.",
        "CBEAM         10       2      10      11      0.      0.      1.",
        "CBEAM         11       2      11      12      0.      0.      1.",
        # 좌표는 line() 으로 만든다 — 손으로 쓰면 8칸 경계가 어긋나 파서가 통째로 흘린다.
        line("GRID", 1, None, 0.0, 0.0, 0.0),
        line("GRID", 2, None, 1000.0, 0.0, 0.0),
        line("GRID", 3, None, 0.0, 1000.0, 0.0),
        line("GRID", 10, None, 2000.0, 0.0, 0.0),
        line("GRID", 11, None, 2000.0, 1000.0, 0.0),
        line("GRID", 12, None, 2000.0, 0.0, 1000.0),
        f"RBE2         100       2{cm:>8}      10",
        "RBE2         101       2     123      11",
        "RBE2         102       3     123      12",
    ]


def test_three_non_collinear_ties_need_no_rotational_fixity():
    """비공선 3점이면 병진만으로 강체가 고정된다 — 회전은 건드리지 않는다."""
    out, info = promote_partial_rigid_cm(_grounded_piece(), spc_node_ids=[1])
    assert info["escalatedEids"] == []
    assert info["ungroundedComponentCount"] == 0
    assert next(l for l in out if l.startswith("RBE2         100"))[24:32].strip() == "123"


def test_two_ties_still_leave_a_spin_axis_and_are_escalated():
    """2점은 그 두 점을 잇는 축으로 돌 수 있다 — 공선이므로 완전 강결이 필요하다."""
    lines = [l for l in _grounded_piece() if not l.startswith("RBE2         102")]
    out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["escalatedEids"], "2점 구속을 그대로 두면 축 회전 mechanism 이 남는다"
    assert info["ungroundedComponentCount"] == 0


def test_a_single_full_fixity_tie_is_enough_on_its_own():
    """한 점이라도 123456 이면 그 조각은 이미 고정이다 — 나머지는 123 그대로 둔다."""
    lines = [
        "CBEAM          1       2       1       2      0.      0.      1.",
        "CBEAM         10       2      10      11      0.      0.      1.",
        line("GRID", 1, None, 0.0, 0.0, 0.0),
        line("GRID", 2, None, 1000.0, 0.0, 0.0),
        line("GRID", 10, None, 2000.0, 0.0, 0.0),
        line("GRID", 11, None, 3000.0, 0.0, 0.0),
        "RBE2         100       2  123456      10",
        "RBE2         101       2      13      11",
    ]
    out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["escalatedEids"] == []
    assert next(l for l in out if l.startswith("RBE2         101"))[24:32].strip() == "123"


def test_partial_cm_between_grounded_pieces_is_also_promoted():
    """★ 접지된 곳끼리의 미끄러지는 연결도 승격한다 — 운송은 고박 상태를 푸는 것이다.

    예전에는 '떠 있는 조각을 잡는 RBE2' 만 올렸다. 그러면 접지돼 있지만 한 축이 자유인
    배관 지지가 그대로 남아, 운송 가속도가 그 방향으로 들어올 때 배관이 통째로
    흔들린다(실측 214mm). 참조 모델은 이런 지지를 하나도 두지 않는다.
    """
    lines = _floating_model() + ["CBEAM         11       2      11       3      0.      0.      1."]
    out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["promotedEids"] == [100]
    assert info["ungroundedComponentCount"] == 0
    # 조각이 빔으로 이미 본체에 이어져 있으니 회전은 건드리지 않는다 —
    # 여기서 456 까지 잡으면 짧은 부재에 가짜 모멘트가 생긴다.
    assert info["escalatedEids"] == []
    assert next(l for l in out if l.startswith("RBE2"))[24:32].strip() == "123"


def test_full_cm_rigid_grounds_a_piece_without_promotion():
    lines = [
        "CBEAM          1       2       1       2      0.      0.      1.",
        "CBEAM         10       2      10      11      0.      0.      1.",
        "RBE2         100       2  123456      10",
    ]
    _out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["promotedEids"] == [], "이미 병진이 잡혀 있으면 올릴 것이 없다"
    assert info["ungroundedComponentCount"] == 0


def test_promotion_is_skipped_when_it_would_duplicate_a_dependent_dof():
    """같은 절점의 같은 자유도가 두 RBE2 의 종속이 되면 Nastran 이 거부한다."""
    lines = [
        "CBEAM          1       2       1       2      0.      0.      1.",
        "CBEAM         10       2      10      11      0.      0.      1.",
        "RBE2         100       2       3      10",
        # 절점 10 의 X·Y 병진은 이미 다른 RBE2 의 종속이다 — 여기를 침범하면 FATAL 2101.
        "RBE2         101       2      12      10",
    ]
    out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["promotedEids"] == []
    assert info["skippedConflictCount"] >= 1
    assert out[2][24:32].strip() == "3", "충돌 시 원본을 그대로 둔다"


def test_rotation_owned_by_another_rigid_no_longer_blocks_promotion():
    """★ 회전은 건드리지 않으므로 남의 회전 종속과는 충돌하지 않는다.

    123456 으로 올리던 시절에는 이 조합이 m-set 충돌로 막혀 미끄러지는 지지가 그대로
    남았다. 병진만 잡으니 막힐 이유가 없어진다.
    """
    lines = [
        "CBEAM          1       2       1       2      0.      0.      1.",
        "CBEAM         10       2      10      11      0.      0.      1.",
        "RBE2         100       2       3      10",
        "RBE2         101       2     456      10",     # 회전은 남이 갖고 있다
    ]
    out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["promotedEids"] == [100], "회전 종속 때문에 막히면 안 된다"
    assert out[2][24:32].strip() == "123"
    # 101 은 병진을 100 이 이미 가져갔으므로 올릴 수 없다 — 이건 정상적인 충돌 회피다.
    assert info["skippedConflictCount"] == 1
    assert out[3][24:32].strip() == "456", "충돌한 카드는 원본 그대로 둔다"


def test_existing_rotation_constraint_is_never_dropped():
    """CM 을 '123' 으로 덮어쓰면 원래 잡고 있던 회전이 풀린다 — 합집합으로 올린다."""
    lines = _grounded_piece(cm="45")
    out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["promotedEids"] == [100]
    assert info["escalatedEids"] == []
    assert next(l for l in out if l.startswith("RBE2         100"))[24:32].strip() == "12345"


def test_promotion_chains_through_newly_grounded_pieces():
    """A(접지) -부분- B -부분- C 처럼 이어진 사슬도 끝까지 접지시킨다."""
    lines = [
        "CBEAM          1       2       1       2      0.      0.      1.",
        "CBEAM         10       2      10      11      0.      0.      1.",
        "CBEAM         20       2      20      21      0.      0.      1.",
        "RBE2         100       2       3      10",
        "RBE2         200      11       2      20",
    ]
    _out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["promotedEids"] == [100, 200]
    assert info["ungroundedComponentCount"] == 0


def test_free_field_rbe2_is_promoted_without_corrupting_the_card():
    lines = [
        "CBEAM,1,2,1,2,0.,0.,1.",
        "CBEAM,10,2,10,11,0.,0.,1.",
        "CBEAM,11,2,11,2,0.,0.,1.",          # 조각을 본체에 이어 회전 자유를 없앤다
        "RBE2,100,2,13,10",
    ]
    out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["promotedEids"] == [100]
    assert out[3] == "RBE2,100,2,123,10"


def test_model_without_rigids_is_returned_untouched():
    lines = ["CBEAM          1       2       1       2      0.      0.      1."]
    out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert out == lines
    assert info["promotedEids"] == []


def test_every_partial_cm_is_promoted_regardless_of_grounding():
    """★ 고박 계약 — 부분 구속 RBE2 는 접지 여부와 무관하게 하나도 남지 않는다.

    이 모델의 RBE2 셋은 모두 접지된 본체 안에 있어 예전 규칙이면 하나도 안 올라간다.
    운송 모델에서는 셋 다 올라가야 한다(참조 모델은 CM 이 전부 123456).
    """
    lines = [
        "CBEAM          1       2       1       2      0.      0.      1.",
        "CBEAM          2       2       2       3      0.      0.      1.",
        "RBE2         100       1      13       2",      # 미끄러지는 배관 지지
        "RBE2         200       2       3       3",
        "RBE2         300       3  123456       1",
    ]
    out, info = promote_partial_rigid_cm(lines, spc_node_ids=[1])
    assert info["promotedEids"] == [100, 200]
    assert info["skippedConflictCount"] == 0
    cms = [raw[24:32].strip() for raw in out if raw.startswith("RBE2")]
    assert cms == ["123", "123", "123456"], "병진이 안 잡힌 RBE2 가 하나도 남으면 안 된다"


# ── 소구경 배관 식별 ─────────────────────────────────────────────────────────

def _piped_lines():
    """관 3종(OD 33.4 / 60.4 / 406.4) + 형강 1종."""
    return [
        "PBEAML       104       1            TUBE",
        "            16.7    13.3     0.0",
        "PBEAML       110       1            TUBE",
        "            30.2    27.4     0.0",
        "PBEAML       200       1            TUBE",
        "           203.2   198.4     0.0",
        "PBEAML         3       1               I",
        "           200.0   200.0   200.0     8.0    12.0    12.0     0.0",
        "CBEAM          1     104       1       2",
        "CBEAM          2     110       2       3",
        "CBEAM          3     200       3       4",
        "CBEAM          4       3       4       5",
    ]


def test_small_bore_ids_carry_the_outer_diameter():
    found = small_bore_element_ids(_piped_lines(), max_od_mm=60.5)
    assert found == {1: pytest.approx(33.4), 2: pytest.approx(60.4)}


def test_small_bore_threshold_is_inclusive_and_excludes_bigger_pipe():
    assert set(small_bore_element_ids(_piped_lines(), max_od_mm=33.4)) == {1}
    assert set(small_bore_element_ids(_piped_lines(), max_od_mm=33.3)) == set()
    assert set(small_bore_element_ids(_piped_lines(), max_od_mm=500.0)) == {1, 2, 3}


def test_non_tube_sections_are_never_small_bore():
    """형강은 외경이라는 개념이 없다 — 어떤 기준에도 걸리면 안 된다."""
    assert 4 not in small_bore_element_ids(_piped_lines(), max_od_mm=1000.0)


def test_zero_threshold_means_no_exclusion():
    """0 은 '제외 안 함'이다. 여기서 막지 않으면 호출부마다 분기를 두어야 한다."""
    assert small_bore_element_ids(_piped_lines(), max_od_mm=0.0) == {}
    assert small_bore_element_ids(_piped_lines(), max_od_mm=-1.0) == {}


def test_ptube_property_is_read_as_outer_diameter():
    """PTUBE 는 반경이 아니라 외경을 직접 쓴다 — 2배 하면 안 된다."""
    lines = ["PTUBE         50       1    48.3     3.7",
             "CTUBE          9      50       1       2"]
    assert small_bore_element_ids(lines, max_od_mm=60.5) == {9: pytest.approx(48.3)}


def test_default_threshold_is_two_inch_small_bore():
    """NPS 2\"(OD 60.3) 이하가 배관 업계의 small-bore 통상 정의다."""
    assert DEFAULT_SMALL_BORE_MAX_OD_MM == 60.5
    found = small_bore_element_ids(_piped_lines(), max_od_mm=DEFAULT_SMALL_BORE_MAX_OD_MM)
    # 도면 표기 60.4 도 담긴다(공칭 60.3 과의 차이 때문에 60.3 으로 두면 놓친다).
    assert 2 in found
