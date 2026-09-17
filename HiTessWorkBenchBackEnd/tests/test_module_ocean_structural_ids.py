"""합본 ID → 사용자 모델 ID 되돌리기.

합본 BDF 는 Module Unit 요소·절점을 +ID_OFFSET 으로 밀어 정반과 겹치지 않게 한다.
화면과 사용자 BDF 가 아는 것은 **밀기 전 ID** 라, 결과에 실리는 모든 ID 는
빠짐없이 되돌아와야 한다. 한 곳이라도 빠지면 그 목록만 조용히 다른 요소를 가리킨다.
"""
from app.services.module_ocean_merge import ID_OFFSET
from app.services.module_ocean_structural_service import _to_module_ids


def _stress(**extra):
    base = {
        "elements": [{"elementId": 287 + ID_OFFSET, "stressMPa": 512.5, "usage": 2.33,
                      "excluded": True},
                     {"elementId": 480 + ID_OFFSET, "stressMPa": 164.3, "usage": 0.75}],
        "topElements": [{"elementId": 480 + ID_OFFSET, "stressMPa": 164.3}],
        "summary": {"maxStressElementId": 480 + ID_OFFSET},
        "excludedSummary": None,
    }
    base.update(extra)
    return base


def _disp():
    return {"nodes": [{"nodeId": 1141 + ID_OFFSET}],
            "summary": {"maxNodeId": 1141 + ID_OFFSET}}


def test_excluded_summary_ids_are_shifted_back_too():
    """제외 목록도 되돌린다 — 여기만 빠지면 사용자가 자기 BDF 에서 그 요소를 못 찾는다."""
    stress = _stress(excludedSummary={
        "maxStressElementId": 287 + ID_OFFSET,
        "topElements": [{"elementId": 287 + ID_OFFSET, "stressMPa": 512.5},
                        {"elementId": 320 + ID_OFFSET, "stressMPa": 491.9}],
    })
    _to_module_ids(stress, _disp(), offset=ID_OFFSET)

    assert stress["excludedSummary"]["maxStressElementId"] == 287
    assert [e["elementId"] for e in stress["excludedSummary"]["topElements"]] == [287, 320]
    # 나머지도 그대로 되돌아왔는지 함께 확인한다.
    assert stress["summary"]["maxStressElementId"] == 480
    assert [e["elementId"] for e in stress["elements"]] == [287, 480]
    assert stress["elements"][0]["excluded"] is True


def test_missing_excluded_summary_is_not_an_error():
    """제외를 끄면(기준 0) excludedSummary 가 None 이다 — 그때도 그냥 지나가야 한다."""
    stress = _stress()
    _to_module_ids(stress, _disp(), offset=ID_OFFSET)
    assert stress["excludedSummary"] is None
    assert stress["summary"]["maxStressElementId"] == 480


# ── 품질 진단 ID ────────────────────────────────────────────────────────────

from app.services.module_ocean_structural_service import _quality_to_display_ids  # noqa: E402


def test_quality_node_ids_are_shifted_back_to_the_users_bdf():
    """★ 이걸 빠뜨리면 사용자 BDF 에 없는 절점 번호(200009)가 화면에 찍힌다."""
    quality = {
        "highPivotNodeIds": [9 + ID_OFFSET, 28 + ID_OFFSET, 44 + ID_OFFSET],
        "affectedElementIds": [207 + ID_OFFSET, 210 + ID_OFFSET],
        "contaminatedTopElementIds": [],
    }
    _quality_to_display_ids(quality, offset=ID_OFFSET)
    assert quality["highPivotNodeIds"] == [9, 28, 44]
    assert quality["highPivotDeckNodeIds"] == []
    assert quality["affectedElementIds"] == [207, 210]


def test_deck_side_singular_nodes_are_kept_apart_not_shifted():
    """정반 절점은 프로그램 내장 모델 번호다 — 되돌리면 남의 BDF 번호를 만들어 낸다."""
    quality = {
        "highPivotNodeIds": [512, 9 + ID_OFFSET],     # 512 = 정반, 나머지 = 모듈
        "affectedElementIds": [99, 207 + ID_OFFSET],
        "contaminatedTopElementIds": [],
    }
    _quality_to_display_ids(quality, offset=ID_OFFSET)
    assert quality["highPivotNodeIds"] == [9]
    assert quality["highPivotDeckNodeIds"] == [512]
    assert quality["affectedElementIds"] == [207]
    assert quality["affectedElementIdsDeckCount"] == 1


def test_empty_quality_is_untouched():
    quality = {"highPivotNodeIds": [], "affectedElementIds": [],
               "contaminatedTopElementIds": []}
    _quality_to_display_ids(quality, offset=ID_OFFSET)
    assert quality["highPivotNodeIds"] == []
    assert quality["highPivotDeckNodeIds"] == []


def test_per_load_case_summaries_are_shifted_back():
    """포락 표의 '지배 부재'·'변위 절점' 열도 사용자 BDF 의 ID 여야 한다.

    이 열만 합본 ID 로 남으면 표는 멀쩡해 보이는데 사용자가 자기 모델에서
    그 부재·절점을 찾지 못한다 — 조용히 틀리는 종류의 오류다.
    """
    stress = _stress(perLoadCase={
        "LC1": {"maxStressElementId": 480 + ID_OFFSET, "maxStressMPa": 180.4},
        "LC2": {"maxStressElementId": 3509 + ID_OFFSET, "maxStressMPa": 218.4},
    })
    displacement = _disp()
    displacement["perLoadCase"] = {
        "LC1": {"maxNodeId": 1141 + ID_OFFSET, "maxMagMm": 35.9},
        "LC6": {"maxNodeId": 2044 + ID_OFFSET, "maxMagMm": 48.7},
    }

    _to_module_ids(stress, displacement, offset=ID_OFFSET)

    assert [row["maxStressElementId"] for row in stress["perLoadCase"].values()] == [480, 3509]
    assert [row["maxNodeId"] for row in displacement["perLoadCase"].values()] == [1141, 2044]
    # 포락 요약(화면 상단 수치)과 조건별 행이 **각각 한 번씩만** 밀려야 한다.
    assert stress["summary"]["maxStressElementId"] == 480
    assert displacement["summary"]["maxNodeId"] == 1141
