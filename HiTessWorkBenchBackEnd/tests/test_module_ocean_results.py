"""F06 결과 JSON → 응력 평가 / Leg 반력 추출 테스트.

입력 스키마는 nastran_bridge.convert_f06 산출물이다(new_subcase_result 참조).
"""
import pytest

from app.services.module_ocean_results import evaluate_stress, f06_fatal_messages


def _f06(**subcase):
    base = {
        "subcaseId": 1,
        "displacements": [], "spcForces": [],
        "cbarForces": [], "cbarStresses": [],
        "cbeamForces": [], "cbeamStresses": [],
        "crodForces": [], "crodStresses": [],
        "quadStresses": [], "triaStresses": [],
    }
    base.update(subcase)
    return {"analysisResults": {"fileName": "x.f06", "subcases": [base]}}


def test_fatal_messages_detected():
    data = {"fatalMessages": [{"text": "USER FATAL MESSAGE 9137"}]}
    assert f06_fatal_messages(data) == [{"text": "USER FATAL MESSAGE 9137"}]
    assert f06_fatal_messages(_f06()) == []


def test_cbeam_uses_absolute_max_over_both_ends():
    data = _f06(cbeamStresses=[
        {"elementId": 10, "gridId": 1, "end": "A", "sMax": 100.0, "sMin": -30.0},
        {"elementId": 10, "gridId": 2, "end": "B", "sMax": 40.0, "sMin": -180.0},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    assert out["summary"]["elementCount"] == 1
    assert out["summary"]["maxStressMPa"] == pytest.approx(180.0)
    assert out["summary"]["maxStressElementId"] == 10
    assert out["topElements"][0]["type"] == "CBEAM"


def test_cbar_uses_absolute_max_over_a_and_b_sections():
    data = _f06(cbarStresses=[
        {"elementId": 7, "sAMax": 55.0, "sAMin": -12.0, "sBMax": 5.0, "sBMin": -66.0},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    assert out["summary"]["maxStressMPa"] == pytest.approx(66.0)
    assert out["topElements"][0]["type"] == "CBAR"


def test_shell_uses_max_von_mises_over_fibers():
    data = _f06(quadStresses=[
        {"elementId": 3, "elementType": "CQUAD4", "vmZ1": 90.0, "vmZ2": 145.0},
    ], triaStresses=[
        {"elementId": 4, "elementType": "CTRIA3", "vmZ1": 20.0, "vmZ2": None},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    by_id = {e["elementId"]: e for e in out["topElements"]}
    assert by_id[3]["stressMPa"] == pytest.approx(145.0)
    assert by_id[3]["type"] == "CQUAD4"
    assert by_id[4]["stressMPa"] == pytest.approx(20.0)


def test_verdict_boundary_at_allowable():
    data = _f06(cbeamStresses=[
        {"elementId": 1, "sMax": 220.0, "sMin": 0.0},
        {"elementId": 2, "sMax": 220.1, "sMin": 0.0},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    verdicts = {e["elementId"]: e["verdict"] for e in out["topElements"]}
    assert verdicts[1] == "OK"
    assert verdicts[2] == "NG"
    assert out["summary"]["exceedCount"] == 1
    assert out["summary"]["maxUsage"] == pytest.approx(220.1 / 220.0)


def test_top_elements_sorted_desc_and_capped():
    data = _f06(cbeamStresses=[
        {"elementId": i, "sMax": float(i), "sMin": 0.0} for i in range(1, 40)
    ])
    out = evaluate_stress(data, allowable_mpa=220.0, top_n=20)
    assert len(out["topElements"]) == 20
    stresses = [e["stressMPa"] for e in out["topElements"]]
    assert stresses == sorted(stresses, reverse=True)
    assert stresses[0] == pytest.approx(39.0)


def test_records_without_any_stress_value_are_skipped():
    """응력 필드가 전부 None 인 레코드는 '0 MPa 합격 요소' 가 아니라 데이터 없음이다."""
    data = _f06(cbeamStresses=[
        {"elementId": 1, "sMax": 150.0, "sMin": -20.0},
        {"elementId": 2, "sMax": None, "sMin": None},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    assert out["summary"]["elementCount"] == 1
    assert [e["elementId"] for e in out["topElements"]] == [1]


def test_missing_subcase_raises_instead_of_returning_another_one():
    """조용히 다른 하중조건 결과를 주면 호출부가 틀린 줄도 모른다."""
    data = _f06(cbeamStresses=[{"elementId": 1, "sMax": 10.0, "sMin": 0.0}])
    with pytest.raises(ValueError, match="SUBCASE 99"):
        evaluate_stress(data, allowable_mpa=220.0, subcase_id=99)


def test_summary_counts_exceeding_elements_beyond_top_n():
    """요약은 top_n 슬라이스가 아니라 전체에서 나와야 한다 — NG 가 잘려 나가면 안 된다."""
    data = _f06(cbeamStresses=[
        {"elementId": i, "sMax": 300.0 + i, "sMin": 0.0} for i in range(1, 31)
    ])
    out = evaluate_stress(data, allowable_mpa=220.0, top_n=5)
    assert len(out["topElements"]) == 5
    assert out["summary"]["elementCount"] == 30
    assert out["summary"]["exceedCount"] == 30


def test_empty_results_raise():
    with pytest.raises(ValueError, match="응력 결과"):
        evaluate_stress(_f06(), allowable_mpa=220.0)


def test_allowable_must_be_positive():
    with pytest.raises(ValueError, match="허용응력"):
        evaluate_stress(_f06(cbeamStresses=[{"elementId": 1, "sMax": 1.0, "sMin": 0.0}]),
                        allowable_mpa=0.0)


# ── 과정 2: Leg 반력 ──────────────────────────────────────────────────────

from app.services.module_ocean_bdf import G_MM_S2
from app.services.module_ocean_results import (
    envelope_displacement,
    envelope_stress,
    envelope_weld,
    extract_leg_reactions,
    scan_f06_warnings,
)


# 합본 모델에서는 정반 Leg 절점 자체가 SPC 절점이다 — F06 의 pointId 가 곧 이 id 다.
LEGS = [
    {"id": 102723, "x": 20260.0, "y": 5200.0, "z": -125.0},
    {"id": 102724, "x": 20260.0, "y": -5200.0, "z": -125.0},
]


def _reaction_f06(t3_each, t1_each=0.0):
    def row(pid):
        return {"pointId": pid, "t1": t1_each, "t2": 0.0, "t3": t3_each,
                "r1": 0.0, "r2": 0.0, "r3": 0.0}
    return {"analysisResults": {"fileName": "x.f06", "subcases": [{
        "subcaseId": 1, "displacements": [],
        "spcForces": [row(102723), row(102724)],
        "cbarForces": [], "cbarStresses": [], "cbeamForces": [], "cbeamStresses": [],
        "crodForces": [], "crodStresses": [], "quadStresses": [], "triaStresses": [],
    }]}}


def _extract(f06, **overrides):
    kwargs = dict(legs=LEGS, total_mass_t=10.0, accel_g=(0.0, 0.0, -1.0))
    kwargs.update(overrides)
    return extract_leg_reactions(f06, **kwargs)


def test_leg_reactions_are_read_at_the_jungban_leg_nodes_themselves():
    each = 10.0 * G_MM_S2 / 2.0            # 자중을 두 Leg 가 균등 분담
    out = _extract(_reaction_f06(each))
    assert [leg["jungbanNodeId"] for leg in out["legs"]] == [102723, 102724]
    assert [leg["spcNodeId"] for leg in out["legs"]] == [102723, 102724]
    assert out["legs"][0]["x"] == 20260.0
    assert out["legs"][0]["fzN"] == pytest.approx(each)
    assert out["legs"][0]["resultantN"] == pytest.approx(each)


def test_leg_reaction_sum_check_passes_when_balanced():
    out = _extract(_reaction_f06(10.0 * G_MM_S2 / 2.0))
    assert out["check"]["ok"] is True
    assert out["check"]["expectedN"][2] == pytest.approx(10.0 * G_MM_S2)
    assert out["check"]["maxRelError"] < 1e-6


def test_leg_reaction_sum_check_fails_when_unbalanced():
    out = _extract(_reaction_f06(1.0))     # 터무니없이 작은 반력
    assert out["check"]["ok"] is False


def test_leg_reaction_check_handles_lateral_acceleration():
    """횡가속도에서도 부호와 크기가 맞아야 한다 — Nastran SPCFORCE 는 관성력의 반대다."""
    mass, ax = 10.0, 0.3
    out = _extract(
        _reaction_f06(mass * G_MM_S2 / 2.0, t1_each=-mass * ax * G_MM_S2 / 2.0),
        accel_g=(ax, 0.0, -1.0),
    )
    assert out["check"]["expectedN"][0] == pytest.approx(-mass * ax * G_MM_S2)
    assert out["check"]["ok"] is True


def test_leg_reaction_raises_when_spc_force_missing():
    empty = _reaction_f06(0.0)
    empty["analysisResults"]["subcases"][0]["spcForces"] = []
    with pytest.raises(ValueError, match="SPC 반력"):
        _extract(empty)


def test_leg_reaction_raises_when_a_leg_node_has_no_reaction():
    """Leg 하나가 F06 에 없으면 조용히 빼지 않는다 — 용접 평가 입력이라 막아야 한다."""
    out = _reaction_f06(1.0)
    out["analysisResults"]["subcases"][0]["spcForces"].pop()   # 102724 반력이 없다
    with pytest.raises(ValueError, match="102724"):
        _extract(out)


def test_leg_reaction_rejects_an_empty_leg_list():
    with pytest.raises(ValueError, match="Leg 절점이 없습니다"):
        _extract(_reaction_f06(1.0), legs=[])


# ── F06 경고 스캔 ─────────────────────────────────────────────────────────

def test_scan_f06_warnings_picks_up_autospc():
    """AUTOSPC 가 강체모드를 조용히 고정하면 접촉점 선정 오류가 경고 속에 묻힌다."""
    text = "\n".join([
        "   SOME NORMAL LINE",
        "*** USER WARNING MESSAGE 4698 (SEKRRS)",
        "    DEGREES OF FREEDOM ... AUTOMATICALLY SET TO ZERO",
        "   ANOTHER NORMAL LINE",
    ])
    found = scan_f06_warnings(text)
    assert len(found) == 2
    assert any("AUTOMATICALLY SET" in line for line in found)


def test_scan_f06_warnings_returns_empty_for_clean_run():
    assert scan_f06_warnings("   NORMAL\n   ALSO NORMAL\n") == []


# ── F06 품질 신호 ─────────────────────────────────────────────────────────
# mechanism 이 남은 채 PARAM,BAILOUT 으로 풀리면 응력이 물리적으로 말이 안 되는 값이 된다.
# 실측에서 자중만으로 사용률 450배가 나왔다 — 그 사실이 조용히 묻히면 안 된다.

from app.services.module_ocean_results import scan_f06_quality

PIVOT_TABLE = "\n".join([
    " *** USER WARNING MESSAGE 4698 (DCMPD)",
    "     STATISTICS FOR DECOMPOSITION OF MATRIX KLL.",
    "         GRID POINT ID       DEGREE OF FREEDOM   MATRIX/FACTOR DIAGONAL RATIO        MATRIX DIAGONAL",
    "               9                    T2                   4.24643E+15                   9.88699E+05",
    "               9                    R1                   4.33465E+14                   6.45722E+08",
    "              28                    T1                   1.00000E+03                   5.00000E+05",
])


def test_quality_flags_mechanism_from_high_pivot_ratios():
    q = scan_f06_quality(PIVOT_TABLE)
    assert q["highPivotDofCount"] == 2          # 1e3 짜리는 임계값 아래라 세지 않는다
    assert q["highPivotNodeCount"] == 1
    assert q["worstPivotRatio"] == pytest.approx(4.24643e15)
    assert q["trustworthy"] is False


def test_quality_is_trustworthy_for_a_clean_run():
    q = scan_f06_quality("   NORMAL LINE\n   ANOTHER LINE\n")
    assert q["trustworthy"] is True
    assert q["highPivotDofCount"] == 0
    assert q["warnings"] == []


def test_quality_ignores_the_msc_boilerplate_mentioning_mechanism():
    """MSC 안내문에 'mechanism' 이라는 단어가 들어 있다 — 경고로 세면 안 된다."""
    text = "      * A mechanism for sending us product feedback or enhancement requests."
    assert scan_f06_quality(text)["warnings"] == []


def test_quality_collects_autospc_evidence():
    text = "0*** USER WARNING MESSAGE 4698\n    DOF AUTOMATICALLY SET TO ZERO"
    q = scan_f06_quality(text)
    assert len(q["warnings"]) == 2


# ── 특이 자유도 영향 판정 ────────────────────────────────────────────────
# "고피벗이 있으면 전부 못 믿는다"는 과잉 차단이라, 실제로 판정을 오염시켰는지를 가른다.

from app.services.module_ocean_results import (  # noqa: E402
    SINGULARITY_HOPS,
    assess_singularity_impact,
)


def test_no_singular_nodes_is_clean():
    out = assess_singularity_impact(
        singular_node_ids=[], element_nodes={1: (10, 11)}, top_element_ids=[1],
    )
    assert out["localized"] is True
    assert out["governingContaminated"] is False
    assert out["affectedElementCount"] == 0


def test_singularity_far_from_governing_element_is_localized():
    """특이가 하중을 안 받는 스터브에만 있으면 결과는 쓸 수 있다(실측 3521 패턴)."""
    elements = {
        1: (100, 101),   # 지배 부재 — 특이에서 멀다
        2: (101, 102),
        3: (900, 901),   # 스터브 자유단
    }
    out = assess_singularity_impact(
        singular_node_ids=[901],
        element_nodes=elements,
        top_element_ids=[1, 2],
        governing_element_id=1,
    )
    assert out["localized"] is True
    assert out["governingContaminated"] is False
    assert out["contaminatedTopElementIds"] == []
    assert 3 in out["affectedElementIds"]


def test_governing_element_on_singular_node_invalidates_result():
    elements = {1: (100, 101), 2: (101, 102)}
    out = assess_singularity_impact(
        singular_node_ids=[100],
        element_nodes=elements,
        top_element_ids=[1, 2],
        governing_element_id=1,
    )
    assert out["governingContaminated"] is True
    assert out["localized"] is False
    assert 1 in out["contaminatedTopElementIds"]


def test_influence_zone_spans_configured_hops():
    """기본 2홉 — 특이 절점의 이웃 부재까지 영향권으로 본다."""
    elements = {1: (1, 2), 2: (2, 3), 3: (3, 4), 4: (4, 5)}
    two_hop = assess_singularity_impact(
        singular_node_ids=[1], element_nodes=elements, top_element_ids=[],
    )
    one_hop = assess_singularity_impact(
        singular_node_ids=[1], element_nodes=elements, top_element_ids=[], hops=1,
    )
    assert SINGULARITY_HOPS == 2
    assert one_hop["affectedElementIds"] == [1]
    assert two_hop["affectedElementIds"] == [1, 2]


def test_contaminated_top_elements_do_not_imply_governing_contamination():
    """상위 요소 일부만 오염된 경우 — 결과는 살리고 그 부재만 배제해야 한다."""
    elements = {1: (100, 101), 2: (700, 701)}
    out = assess_singularity_impact(
        singular_node_ids=[701],
        element_nodes=elements,
        top_element_ids=[1, 2],
        governing_element_id=1,
    )
    assert out["governingContaminated"] is False
    assert out["contaminatedTopElementIds"] == [2]
    assert out["localized"] is False


def test_scan_quality_reports_singular_node_ids():
    f06 = "\n".join([
        "     THE FOLLOWING DEGREES OF FREEDOM HAVE FACTOR DIAGONAL RATIOS",
        "               9                    T2                   4.24643E+15                   9.88699E+05",
        "             397                    T2                  -4.52738E+18                   9.76336E+05",
        "             397                    R1                   1.80277E+13                   6.41497E+08",
        "             500                    T1                   1.00000E+03                   1.00000E+05",
    ])
    q = scan_f06_quality(f06)
    assert q["highPivotNodeIds"] == [9, 397]   # 임계 미만인 500 은 빠진다
    assert q["highPivotDofCount"] == 3
    assert q["trustworthy"] is False


# ── 절점 변위 ────────────────────────────────────────────────────────────

from app.services.module_ocean_results import extract_displacements  # noqa: E402


def _disp_f06(rows):
    return {"analysisResults": {"subcases": [{"subcaseId": 1, "displacements": rows}]}}


def test_extract_displacements_computes_magnitude_and_peak():
    out = extract_displacements(_disp_f06([
        {"pointId": 1, "t1": 3.0, "t2": 4.0, "t3": 0.0},
        {"pointId": 2, "t1": 0.0, "t2": 0.0, "t3": -12.0},
    ]))
    assert [n["nodeId"] for n in out["nodes"]] == [1, 2]
    assert out["nodes"][0]["mag"] == 5.0
    assert out["summary"]["maxMagMm"] == 12.0
    assert out["summary"]["maxNodeId"] == 2


def test_extract_displacements_reports_per_component_peaks():
    """해상 운송은 어느 방향으로 눕는지가 판단 근거라 성분별 최댓값을 따로 낸다."""
    out = extract_displacements(_disp_f06([
        {"pointId": 1, "t1": -9.0, "t2": 2.0, "t3": 1.0},
        {"pointId": 2, "t1": 3.0, "t2": -7.0, "t3": 4.0},
    ]))
    assert out["summary"]["maxAbsT1Mm"] == 9.0
    assert out["summary"]["maxAbsT2Mm"] == 7.0
    assert out["summary"]["maxAbsT3Mm"] == 4.0


def test_extract_displacements_accepts_nodeid_key_and_missing_components():
    """F06 파서 버전에 따라 키 이름이 다르고, 성분이 비어 오는 줄도 있다."""
    out = extract_displacements(_disp_f06([
        {"nodeId": 7, "t1": None, "t2": 5.0},
        {"t1": 1.0},                      # 절점 ID 없음 — 버린다
    ]))
    assert [n["nodeId"] for n in out["nodes"]] == [7]
    assert out["nodes"][0]["mag"] == 5.0


def test_extract_displacements_without_rows_is_empty_not_an_error():
    out = extract_displacements(_disp_f06([]))
    assert out["nodes"] == []
    assert out["summary"]["nodeCount"] == 0


def test_leg_records_carry_z_for_the_result_viewer():
    """모달이 과정 2 모델(스터브 빔)을 그리려면 Leg 높이가 있어야 한다."""
    out = _extract(_reaction_f06(10.0 * G_MM_S2 / 2.0))
    assert [leg["z"] for leg in out["legs"]] == [-125.0, -125.0]


# ── 소구경 배관 제외 (판정에서만 뺀다) ─────────────────────────────────────

def _mixed_f06():
    """구조 부재 하나(낮은 응력) + 소구경 배관 둘(허용 초과)."""
    return _f06(cbeamStresses=[
        {"elementId": 10, "sMax": 164.0, "sMin": -10.0},   # 형강 — 평가 대상
        {"elementId": 20, "sMax": 512.0, "sMin": 0.0},     # OD33.4 — 제외 대상
        {"elementId": 21, "sMax": 300.0, "sMin": 0.0},     # OD60.4 — 제외 대상
    ])


def test_excluded_elements_are_dropped_from_the_verdict_only():
    out = evaluate_stress(_mixed_f06(), allowable_mpa=220.0,
                          excluded_elements={20: 33.4, 21: 60.4})
    summary = out["summary"]
    # 판정 숫자는 남은 부재만 본다.
    assert summary["maxStressMPa"] == pytest.approx(164.0)
    assert summary["maxStressElementId"] == 10
    assert summary["exceedCount"] == 0
    assert summary["evaluatedCount"] == 1
    assert summary["excludedCount"] == 2
    # elementCount 의 뜻은 예전 그대로 — 결과에 응력이 잡힌 전체 요소 수.
    assert summary["elementCount"] == 3
    assert [e["elementId"] for e in out["topElements"]] == [10]


def test_excluded_elements_stay_in_the_colormap_payload():
    """제외해도 elements 에서는 빠지지 않는다 — 빠지면 3D 색맵에 구멍이 난다."""
    out = evaluate_stress(_mixed_f06(), allowable_mpa=220.0,
                          excluded_elements={20: 33.4, 21: 60.4})
    ids = {e["elementId"] for e in out["elements"]}
    assert ids == {10, 20, 21}
    flagged = {e["elementId"] for e in out["elements"] if e.get("excluded")}
    assert flagged == {20, 21}


def test_excluded_summary_reports_what_was_dropped():
    """뺀 쪽을 따로 실어 준다 — 감추면 배관에 실제 문제가 있어도 안 보인다."""
    out = evaluate_stress(_mixed_f06(), allowable_mpa=220.0,
                          excluded_elements={20: 33.4, 21: 60.4},
                          excluded_reason="외경 60.5mm 이하 소구경 배관")
    dropped = out["excludedSummary"]
    assert dropped["reason"] == "외경 60.5mm 이하 소구경 배관"
    assert dropped["elementCount"] == 2
    assert dropped["maxStressMPa"] == pytest.approx(512.0)
    assert dropped["maxStressElementId"] == 20
    assert dropped["exceedCount"] == 2
    # 제외 요소의 verdict 는 사실 그대로 NG 다 — '제외'와 '합격'은 다르다.
    assert dropped["topElements"][0]["verdict"] == "NG"
    assert dropped["topElements"][0]["outerDiameterMm"] == pytest.approx(33.4)


def test_no_exclusion_keeps_the_previous_behaviour():
    out = evaluate_stress(_mixed_f06(), allowable_mpa=220.0)
    assert out["summary"]["maxStressMPa"] == pytest.approx(512.0)
    assert out["summary"]["exceedCount"] == 2
    assert out["summary"]["evaluatedCount"] == 3
    assert out["excludedSummary"] is None
    assert all("excluded" not in e for e in out["elements"])


def test_excluding_everything_raises_instead_of_reporting_a_pipe_as_the_verdict():
    """전부 제외되면 조용히 배관을 판정값으로 쓰지 않고 멈춘다."""
    with pytest.raises(ValueError, match="제외 기준"):
        evaluate_stress(_mixed_f06(), allowable_mpa=220.0,
                        excluded_elements={10: 20.0, 20: 33.4, 21: 60.4})


def test_singularity_impact_counts_free_end_nodes():
    """특이 절점이 '부재 하나만 붙은 끝점'인지 세어 준다.

    화면이 "왜 이런 게 나왔나"에 일반론 대신 이 모델의 사실로 답할 수 있어야 한다.
    실측(3521): 특이 13개가 전부 차수 1 이고 붙은 부재는 전부 L 50×50×6 짧은 앵글.
    """
    from app.services.module_ocean_results import assess_singularity_impact
    out = assess_singularity_impact(
        singular_node_ids=[10, 2],
        # 10 = 빔 하나만 붙은 끝점, 2 = 빔 두 개가 만나는 중간 절점
        element_nodes={1: (1, 2), 2: (2, 3), 3: (3, 10)},
        top_element_ids=[1],
    )
    assert out["freeEndNodeCount"] == 1


def test_singularity_impact_reports_zero_free_ends_when_none_are_singular():
    from app.services.module_ocean_results import assess_singularity_impact
    out = assess_singularity_impact(singular_node_ids=[], element_nodes={1: (1, 2)},
                                    top_element_ids=[])
    assert out["freeEndNodeCount"] == 0


# ── 용접면 모멘트 이송 ────────────────────────────────────────────────────

def test_leg_moments_are_moved_to_the_weld_plane():
    """SPC 절점(z=−125)과 용접군이 놓인 패드면(z=−25)은 100mm 떨어져 있다.

    모멘트를 옮기지 않으면 용접 응력이 그 지렛대만큼 틀린다(실측 4~7%).
    """
    legs = [{**LEGS[0], "weldPlaneZMm": -25.0}]
    f06 = {"analysisResults": {"subcases": [{
        "subcaseId": 1, "displacements": [],
        "spcForces": [{"pointId": 102723, "t1": 300.0, "t2": -500.0, "t3": 7000.0,
                       "r1": 1.0e6, "r2": 2.0e6, "r3": 3.0e6}],
    }]}}
    out = extract_leg_reactions(f06, legs=legs, total_mass_t=10.0, accel_g=(0.0, 0.0, -1.0))
    row = out["legs"][0]

    dz = -125.0 - (-25.0)                       # = −100
    assert row["mxNmm"] == pytest.approx(1.0e6 - dz * (-500.0))
    assert row["myNmm"] == pytest.approx(2.0e6 + dz * 300.0)
    assert row["mzNmm"] == pytest.approx(3.0e6)       # 비틀림은 이송에 불변
    # 힘은 옮겨도 그대로다.
    assert (row["fxN"], row["fyN"], row["fzN"]) == (300.0, -500.0, 7000.0)
    # 원본을 남겨 두어야 "이 차이가 어디서 왔나" 를 되짚을 수 있다.
    assert row["momentAtSpcNmm"] == {"mx": 1.0e6, "my": 2.0e6, "mz": 3.0e6}
    assert out["weldMomentReference"] == "weld-plane"


def test_leg_moments_stay_at_the_spc_node_when_no_weld_plane_is_known():
    """패드를 못 찾은 정반(구 캐시 포함)에서는 예전 동작 그대로여야 한다."""
    f06 = {"analysisResults": {"subcases": [{
        "subcaseId": 1, "displacements": [],
        "spcForces": [{"pointId": 102723, "t1": 0.0, "t2": -500.0, "t3": 7000.0,
                       "r1": 1.0e6, "r2": 0.0, "r3": 0.0}],
    }]}}
    out = extract_leg_reactions(f06, legs=[LEGS[0]], total_mass_t=10.0,
                               accel_g=(0.0, 0.0, -1.0))
    assert out["legs"][0]["mxNmm"] == pytest.approx(1.0e6)
    assert out["legs"][0]["weldPlaneZMm"] is None
    assert out["weldMomentReference"] == "spc-node"


# ── 모멘트 평형 검산 ──────────────────────────────────────────────────────

def _moment_f06(rows):
    return {"analysisResults": {"subcases": [{
        "subcaseId": 1, "displacements": [], "spcForces": rows,
    }]}}


def test_moment_check_passes_for_a_balanced_pair():
    """무게중심이 두 Leg 한가운데면 두 반력이 같고 모멘트 잔차가 0 이다."""
    mass = 10.0
    each = mass * G_MM_S2 / 2.0
    out = extract_leg_reactions(
        _moment_f06([
            {"pointId": 102723, "t1": 0.0, "t2": 0.0, "t3": each, "r1": 0.0, "r2": 0.0, "r3": 0.0},
            {"pointId": 102724, "t1": 0.0, "t2": 0.0, "t3": each, "r1": 0.0, "r2": 0.0, "r3": 0.0},
        ]),
        legs=LEGS, total_mass_t=mass, accel_g=(0.0, 0.0, -1.0),
        cog_mm=[20260.0, 0.0, 3000.0],
    )
    assert out["check"]["moment"]["ok"] is True
    assert out["check"]["allOk"] is True


def test_moment_check_catches_a_wrong_center_of_gravity():
    """힘 합계만 보면 통과하는데 무게중심이 틀린 경우 — 여기서 걸려야 한다."""
    mass = 10.0
    each = mass * G_MM_S2 / 2.0
    f06 = _moment_f06([
        {"pointId": 102723, "t1": 0.0, "t2": 0.0, "t3": each, "r1": 0.0, "r2": 0.0, "r3": 0.0},
        {"pointId": 102724, "t1": 0.0, "t2": 0.0, "t3": each, "r1": 0.0, "r2": 0.0, "r3": 0.0},
    ])
    out = extract_leg_reactions(
        f06, legs=LEGS, total_mass_t=mass, accel_g=(0.0, 0.0, -1.0),
        cog_mm=[20260.0, 4000.0, 3000.0],      # Y 로 4m 틀린 무게중심
    )
    assert out["check"]["ok"] is True           # 힘은 여전히 맞는다
    assert out["check"]["moment"]["ok"] is False
    assert out["check"]["allOk"] is False


def test_moment_check_is_skipped_without_a_center_of_gravity():
    out = extract_leg_reactions(
        _moment_f06([
            {"pointId": 102723, "t1": 0.0, "t2": 0.0, "t3": 10.0 * G_MM_S2 / 2.0,
             "r1": 0.0, "r2": 0.0, "r3": 0.0},
            {"pointId": 102724, "t1": 0.0, "t2": 0.0, "t3": 10.0 * G_MM_S2 / 2.0,
             "r1": 0.0, "r2": 0.0, "r3": 0.0},
        ]),
        legs=LEGS, total_mass_t=10.0, accel_g=(0.0, 0.0, -1.0),
    )
    assert out["check"]["moment"] is None
    assert out["check"]["allOk"] is True


# ── 하중조건 포락 ─────────────────────────────────────────────────────────

def _stress_case(values, allowable=220.0):
    """{EID: 응력} → evaluate_stress 와 같은 모양의 결과."""
    ordered = sorted(({"elementId": eid, "type": "CBEAM", "stressMPa": s,
                       "usage": s / allowable} for eid, s in values.items()),
                     key=lambda e: e["stressMPa"], reverse=True)
    worst = ordered[0]
    return {
        "schema": "moduleOceanStress/1", "allowableMPa": allowable,
        "elements": ordered, "topElements": ordered,
        "summary": {"elementCount": len(ordered), "evaluatedCount": len(ordered),
                    "excludedCount": 0, "maxStressMPa": worst["stressMPa"],
                    "maxStressElementId": worst["elementId"],
                    "maxUsage": worst["usage"],
                    "exceedCount": sum(1 for e in ordered if e["usage"] > 1.0)},
        "excludedSummary": None,
    }


def test_stress_envelope_takes_each_element_at_its_own_worst_load_case():
    """부재마다 최악 LC 가 다르다 — 하나의 LC 만 보면 지배 부재를 놓친다."""
    envelope = envelope_stress([
        ("LC1", _stress_case({1: 180.0, 2: 40.0})),
        ("LC5", _stress_case({1: 100.0, 2: 200.0})),
    ])
    by_id = {e["elementId"]: e for e in envelope["elements"]}
    assert by_id[1]["stressMPa"] == pytest.approx(180.0)
    assert by_id[1]["loadCase"] == "LC1"
    assert by_id[2]["stressMPa"] == pytest.approx(200.0)
    assert by_id[2]["loadCase"] == "LC5"
    assert envelope["summary"]["maxStressElementId"] == 2
    assert envelope["summary"]["governingLoadCase"] == "LC5"
    assert set(envelope["perLoadCase"]) == {"LC1", "LC5"}
    assert set(envelope["perLoadCaseElements"]) == {"LC1", "LC5"}
    assert {row["elementId"] for row in envelope["perLoadCaseElements"]["LC5"]} == {1, 2}


def test_stress_envelope_refuses_to_mix_different_allowables():
    with pytest.raises(ValueError, match="허용응력"):
        envelope_stress([("LC1", _stress_case({1: 10.0}, allowable=220.0)),
                         ("LC2", _stress_case({1: 10.0}, allowable=200.0))])


def _weld_case(sigmas):
    legs = [{"index": i + 1, "sigmaEqMPa": s, "usage": s / 150.0,
             "actualSafetyFactor": 450.0 / s, "status": "OK",
             "resultantN": 1000.0 * (i + 1), "governingPoint": {"key": "top-right"}}
            for i, s in enumerate(sigmas)]
    worst = max(legs, key=lambda r: r["sigmaEqMPa"])
    return {
        "schema": "module-ocean-weld/2", "method": "m", "capacityBasis": "c",
        "spec": {}, "section": {"allowableMPa": 150.0}, "legs": legs,
        "summary": {"maxSigmaEqMPa": worst["sigmaEqMPa"],
                    "governingLegIndex": worst["index"], "status": "OK", "ngCount": 0},
    }


def test_weld_envelope_finds_the_leg_that_only_the_other_sign_governs():
    """실측 그대로 — +Y 는 Leg 2, −Y 는 Leg 7 이 지배였다."""
    envelope = envelope_weld([
        ("LC1", _weld_case([94.0, 114.9, 107.3, 78.0, 75.5, 99.6, 101.3, 80.6])),
        ("LC5", _weld_case([83.4, 100.1, 97.8, 76.2, 79.9, 109.1, 117.6, 98.0])),
    ])
    assert envelope["summary"]["maxSigmaEqMPa"] == pytest.approx(117.6)
    assert envelope["summary"]["governingLegIndex"] == 7
    assert envelope["summary"]["governingLoadCase"] == "LC5"
    by_index = {row["index"]: row for row in envelope["legs"]}
    assert by_index[2]["loadCase"] == "LC1"       # Leg 별로 지배 LC 가 다르다
    assert by_index[7]["loadCase"] == "LC5"


def test_displacement_envelope_keeps_one_real_load_case_field():
    """변위장을 절점별로 섞으면 어떤 하중상태에도 없는 변형 형상이 된다."""
    def case(mag):
        return {"nodes": [{"nodeId": 1, "t1": mag, "t2": 0.0, "t3": 0.0, "mag": mag}],
                "summary": {"nodeCount": 1, "maxMagMm": mag, "maxNodeId": 1}}

    envelope = envelope_displacement([("LC1", case(35.9)), ("LC5", case(38.4))])
    assert envelope["loadCase"] == "LC5"
    assert envelope["nodes"][0]["t1"] == pytest.approx(38.4)
    assert envelope["perLoadCase"]["LC1"]["maxMagMm"] == pytest.approx(35.9)
