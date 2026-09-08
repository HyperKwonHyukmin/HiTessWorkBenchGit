"""슬림 뷰어 페이로드 — 절점 ID 노출 회귀 테스트.

3단계 구조 해석은 접촉 절점의 **BDF 절점 ID** 를 백엔드로 넘겨야 한다.
페이로드가 인덱스만 내보내면 프론트가 ID 를 알 수 없다.
"""
from app.services.module_ocean_transport_service import _PAYLOAD_SCHEMA, slim_model_json


def _model():
    return {
        "meta": {"unit": "mm"},
        "nodes": [
            {"id": 101, "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": 205, "x": 1000.0, "y": 0.0, "z": 0.0},
            {"id": 309, "x": 1000.0, "y": 1000.0, "z": 0.0},
            {"id": 412, "x": 0.0, "y": 1000.0, "z": 0.0},
        ],
        "elements": [
            {"id": 1, "type": "CBEAM", "startNode": 101, "endNode": 205},
            # 쉘 요소는 CBEAM 과 달리 nodeIds 로 연결도를 낸다 — elem_node_ids 가 실제로
            # 읽히는 경로(개명된 변수의 shadowing 회귀를 잡는 경로)는 이쪽이다.
            # nodes 순서와 일부러 다르게 참조한다 — 우연히 전체 node_ids 리스트와 같은 순서로
            # 겹치면 shadowing 버그가 있어도 결과가 같아져 회귀를 못 잡는다.
            {"id": 2, "type": "CQUAD4", "nodeIds": [412, 309, 205, 101]},
        ],
        "rigids": [],
        "properties": [],
        "materials": [],
        "pointMasses": [],
    }


def test_slim_payload_exposes_node_ids_in_position_order():
    slim = slim_model_json(_model(), name="t")
    assert slim["nodeIds"] == [101, 205, 309, 412]
    assert len(slim["nodeIds"]) == slim["nodeCount"]


def test_slim_payload_builds_shell_connectivity_from_node_ids():
    # CQUAD4 는 nodeIds 로만 연결도를 낸다 — 이 어서션이 elem_node_ids shadowing 버그를
    # 실제로 잡는다(개명 전에는 CQUAD4 연결도가 통째로 비었다).
    slim = slim_model_json(_model(), name="t")
    assert slim["quadCount"] == 1
    assert slim["quads"] == [3, 2, 1, 0]


def test_slim_payload_schema_bumped_to_4():
    # 스키마를 올려야 서버에 남아 있는 정반 .viewer.json 캐시가 재생성된다.
    # 4 = beamIds 추가(3단계 응력 색맵이 선분↔요소를 잇는 데 필요).
    assert _PAYLOAD_SCHEMA == 4
    assert slim_model_json(_model(), name="t")["schema"] == 4


def test_beam_ids_align_one_to_one_with_beam_segments():
    """색맵은 beams 선분 i 와 beamIds[i] 가 같은 요소라고 믿는다 — 어긋나면 엉뚱한 곳이 붉어진다."""
    slim = slim_model_json(_model(), name="t")
    assert len(slim["beamIds"]) == slim["beamCount"] == len(slim["beams"]) // 2


def test_skipped_beam_does_not_shift_beam_ids():
    """연결도가 깨진 빔은 beams 와 beamIds 에서 **함께** 빠져야 한다.

    한쪽만 빠지면 그 뒤 모든 요소의 색이 한 칸씩 밀린다 — 화면은 멀쩡해 보이는데
    붉은 부재가 실제 과응력 부재가 아니게 되는, 가장 알아채기 어려운 실패다.
    """
    model = _model()
    model["elements"].append({"id": 999, "type": "CBEAM", "startNode": 101, "endNode": 99999})
    model["elements"].append({"id": 1000, "type": "CBEAM", "startNode": 101, "endNode": 309})
    slim = slim_model_json(model, name="t")
    assert 999 not in slim["beamIds"]
    assert slim["beamIds"][-1] == 1000
    assert len(slim["beamIds"]) == len(slim["beams"]) // 2


# ── 정반 Leg 절점 추출 ──────────────────────────────────────────────────
#
# nastran_bridge 의 실제 모델 JSON 스키마 확인 결과(Step 2):
#   - 최상위 키는 "constraints" 가 아니라 "spcs" 다 (convert_bdf 반환 dict, nastran_bridge.py:1044).
#   - 각 원소는 parse_spc()/parse_spc1() 이 만드는 {"nodeId": int, "components": str} 다
#     (nodeId 키 이름 자체는 계획서의 가정과 일치, 다른 것은 최상위 키뿐).

import pytest

from app.services.module_ocean_transport_service import extract_leg_nodes


def test_extract_leg_nodes_from_spc_cards():
    model = {
        "nodes": [
            {"id": 102723, "x": 20260.0, "y": 5200.0, "z": -125.0},
            {"id": 102724, "x": 26260.0, "y": 5200.0, "z": -125.0},
            {"id": 500, "x": 0.0, "y": 0.0, "z": 2020.0},
        ],
        "spcs": [
            {"nodeId": 102723, "components": "123456"},
            {"nodeId": 102724, "components": "123456"},
        ],
    }
    legs = extract_leg_nodes(model)
    assert [leg["id"] for leg in legs] == [102723, 102724]
    assert legs[0]["x"] == 20260.0 and legs[0]["z"] == -125.0


def test_extract_leg_nodes_raises_when_no_constraints():
    with pytest.raises(ValueError, match="구속"):
        extract_leg_nodes({"nodes": [{"id": 1, "x": 0.0, "y": 0.0, "z": 0.0}], "spcs": []})


def test_extract_leg_nodes_sorts_dedupes_and_skips_missing_coordinates():
    """계약 3가지를 한 번에 고정한다 — 정렬 / 중복 제거 / 좌표 없는 ID 건너뜀.

    정반 BDF 는 SPC 카드가 여러 장으로 나뉘어 같은 절점이 두 번 나올 수 있고,
    SPC 가 참조하는 절점이 GRID 에 없으면 좌표를 만들 수 없다.
    """
    model = {
        "nodes": [
            {"id": 300, "x": 3.0, "y": 0.0, "z": -125.0},
            {"id": 100, "x": 1.0, "y": 0.0, "z": -125.0},
            {"id": 200, "x": 2.0, "y": 0.0, "z": -125.0},
        ],
        "spcs": [
            {"nodeId": 300, "components": "123456"},   # 역순으로 들어온다
            {"nodeId": 100, "components": "123456"},
            {"nodeId": 100, "components": "123456"},   # 중복
            {"nodeId": 999, "components": "123456"},   # nodes 에 좌표가 없다
            {"nodeId": 200, "components": "123456"},
        ],
    }
    legs = extract_leg_nodes(model)
    assert [leg["id"] for leg in legs] == [100, 200, 300]
    assert [leg["x"] for leg in legs] == [1.0, 2.0, 3.0]


def test_extract_leg_nodes_raises_when_every_spc_node_lacks_coordinates():
    """SPC 는 있지만 전부 좌표가 없으면 Leg 를 만들 수 없다 — 조용히 빈 리스트를 주면 안 된다."""
    with pytest.raises(ValueError, match="구속"):
        extract_leg_nodes({
            "nodes": [{"id": 1, "x": 0.0, "y": 0.0, "z": 0.0}],
            "spcs": [{"nodeId": 999, "components": "123456"}],
        })


def test_extract_leg_nodes_reads_the_column_top_from_the_rigid_above():
    """Leg 위 기둥의 상단 = 같은 (x, y) 의 rigid independent 절점.

    이 높이가 과정 2 기둥의 길이이고, 곧 용접부 모멘트의 지렛대다
    (고정-고정 기둥이라 M_base = 전단 × 높이/2). 못 읽으면 임의 높이로 떨어져
    굽힘응력이 실제와 다른 배수로 나온다.
    """
    model = {
        "nodes": [
            {"id": 102723, "x": 20260.0, "y": 5200.0, "z": -125.0},
            {"id": 29, "x": 20260.0, "y": 5200.0, "z": 2020.0},      # 같은 기둥 위
            {"id": 97, "x": 20260.0, "y": -5200.0, "z": 2020.0},     # 다른 Leg 의 기둥
        ],
        "spcs": [{"nodeId": 102723, "components": "123456"}],
        "rigids": [
            {"id": 99727, "independentNode": 102723, "dependentNodes": []},  # PAD 패치
            {"id": 98781, "independentNode": 29, "dependentNodes": []},
            {"id": 98782, "independentNode": 97, "dependentNodes": []},
        ],
    }
    legs = extract_leg_nodes(model)
    assert legs[0]["zTop"] == 2020.0                     # 기둥 높이 2145mm


def test_extract_leg_nodes_takes_the_lowest_rigid_above_the_leg():
    """강체가 매달리기 시작하는 높이가 기둥의 유효 길이다 — 그 위는 휘지 않는다."""
    model = {
        "nodes": [
            {"id": 1, "x": 0.0, "y": 0.0, "z": -125.0},
            {"id": 2, "x": 0.0, "y": 0.0, "z": 2020.0},
            {"id": 3, "x": 0.0, "y": 0.0, "z": 8026.0},
            {"id": 4, "x": 0.0, "y": 0.0, "z": -900.0},   # 아래쪽은 후보가 아니다
        ],
        "spcs": [{"nodeId": 1, "components": "123456"}],
        "rigids": [
            {"id": 10, "independentNode": 3, "dependentNodes": []},
            {"id": 11, "independentNode": 2, "dependentNodes": []},
            {"id": 12, "independentNode": 4, "dependentNodes": []},
        ],
    }
    assert extract_leg_nodes(model)[0]["zTop"] == 2020.0


def test_extract_leg_nodes_reports_no_top_when_nothing_stands_on_the_leg():
    """정반 모델이 상단 rigid 를 안 주면 None — 과정 2 가 실측 기본 높이로 폴백한다."""
    model = {
        "nodes": [
            {"id": 1, "x": 0.0, "y": 0.0, "z": -125.0},
            {"id": 2, "x": 9999.0, "y": 0.0, "z": 2020.0},   # 다른 자리
        ],
        "spcs": [{"nodeId": 1, "components": "123456"}],
        "rigids": [{"id": 10, "independentNode": 2, "dependentNodes": []}],
    }
    assert extract_leg_nodes(model)[0]["zTop"] is None
