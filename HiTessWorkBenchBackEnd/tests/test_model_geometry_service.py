"""Model Registry — 3D 미리보기 지오메트리 테스트.

핵심 계약:
1. 좌표/연결만 나간다 — 저장소 절대경로는 응답에 절대 담기지 않는다.
2. 존재하지 않는 절점을 참조하는 요소는 그린 척하지 않고 버린다.
3. 잘랐으면 잘랐다고 말한다(truncated). 조용히 일부만 보여 주면 오판을 부른다.
"""
import json

import pytest

from app.services import model_geometry_service as geo


def _model_json(**overrides):
    base = {
        "meta": {"unit": "mm"},
        "nodes": [
            {"id": 1, "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": 2, "x": 100.0, "y": 0.0, "z": 0.0},
            {"id": 3, "x": 100.0, "y": 50.0, "z": 0.0},
        ],
        "elements": [
            {"id": 11, "type": "CBEAM", "startNode": 1, "endNode": 2},
            {"id": 12, "type": "CBAR", "startNode": 2, "endNode": 3},
        ],
        "rigids": [{"id": 21, "independentNode": 1, "dependentNodes": [2, 3]}],
        "pointMasses": [{"id": 31, "nodeId": 3, "mass": 5.0}],
    }
    base.update(overrides)
    return base


def test_geometry_payload_shape_matches_existing_viewers():
    """노드는 {id: [x,y,z]}, 선분은 [start, end, elemId] — 기존 BDF 뷰어와 같은 모양."""
    payload = geo.build_preview_geometry(_model_json())

    assert payload["nodes"]["1"] == [0.0, 0.0, 0.0]
    assert ["1", "2", 11] in payload["elements"]
    assert payload["rigids"] == [["1", "2"], ["1", "3"]]
    assert payload["pointMasses"] == ["3"]
    assert payload["elementTypes"] == {"CBEAM": 1, "CBAR": 1}
    assert payload["unit"] == "mm"
    assert payload["truncated"] is False


def test_elements_referencing_missing_nodes_are_dropped():
    """좌표를 모르는 절점을 잇는 선은 그릴 수 없다 — 원점으로 끌어다 붙이지 않는다."""
    model = _model_json(
        elements=[{"id": 11, "startNode": 1, "endNode": 999}],
    )
    payload = geo.build_preview_geometry(model)
    assert payload["elements"] == []
    # 원본 개수는 그대로 보고해 '왜 안 보이나'를 추적할 수 있게 한다.
    assert payload["counts"]["elementTotal"] == 1
    assert payload["counts"]["elementShown"] == 0


def test_alternate_coordinate_and_end_node_keys_are_accepted():
    """소스에 따라 x/X1, startNode/nodeIds 로 키가 갈린다."""
    model = {
        "nodes": [
            {"id": 1, "X1": 0.0, "X2": 0.0, "X3": 0.0},
            {"id": 2, "X1": 1.0, "X2": 0.0, "X3": 0.0},
        ],
        "elements": [{"id": 5, "nodeIds": [1, 2]}],
    }
    payload = geo.build_preview_geometry(model)
    assert payload["nodes"]["2"] == [1.0, 0.0, 0.0]
    assert payload["elements"] == [["1", "2", 5]]


def test_nodes_without_coordinates_are_skipped():
    model = _model_json(nodes=[{"id": 1, "x": 0.0, "y": 0.0}, {"id": 2, "x": 1.0, "y": 1.0, "z": 1.0}])
    payload = geo.build_preview_geometry(model)
    assert "1" not in payload["nodes"]
    assert "2" in payload["nodes"]


def test_oversized_model_is_truncated_and_says_so(monkeypatch):
    monkeypatch.setattr(geo, "MAX_PREVIEW_ELEMENTS", 1)
    payload = geo.build_preview_geometry(_model_json())
    assert payload["truncated"] is True
    assert payload["counts"]["elementTotal"] == 2
    assert payload["counts"]["elementShown"] == 1


def test_empty_model_produces_empty_payload_not_error():
    payload = geo.build_preview_geometry({"nodes": [], "elements": []})
    assert payload["nodes"] == {}
    assert payload["elements"] == []
    assert payload["truncated"] is False


# --------------------------------------------------------------------------- #
# 소스 우선순위와 캐시
# --------------------------------------------------------------------------- #

def test_normalized_model_json_is_preferred_over_bdf_parsing(tmp_path, monkeypatch):
    """정규화 JSON 이 있으면 비싼 BDF 파싱을 돌리지 않는다."""
    normalized = tmp_path / "normalized-model.json"
    normalized.write_text(json.dumps(_model_json()), encoding="utf-8")
    bdf = tmp_path / "source.bdf"
    bdf.write_text("CEND\nENDDATA\n", encoding="utf-8")

    def _boom(_path):
        raise AssertionError("정규화 JSON 이 있는데 BDF 를 파싱하면 안 된다")

    monkeypatch.setattr(
        "app.services.model_summary_service.parse_bdf_to_model_json", _boom,
    )

    payload = geo.load_preview_geometry(
        root=str(tmp_path),
        revision_id=1,
        normalized_model_path=str(normalized),
        bdf_path=str(bdf),
    )
    assert payload["source"] == "normalized-model"
    assert len(payload["nodes"]) == 3


def test_bdf_parse_result_is_cached_so_it_runs_only_once(tmp_path, monkeypatch):
    bdf = tmp_path / "source.bdf"
    bdf.write_text("CEND\nENDDATA\n", encoding="utf-8")
    calls = []

    def _parse(path):
        calls.append(path)
        return _model_json()

    monkeypatch.setattr(
        "app.services.model_summary_service.parse_bdf_to_model_json", _parse,
    )

    first = geo.load_preview_geometry(
        root=str(tmp_path), revision_id=7,
        normalized_model_path=None, bdf_path=str(bdf),
    )
    second = geo.load_preview_geometry(
        root=str(tmp_path), revision_id=7,
        normalized_model_path=None, bdf_path=str(bdf),
    )

    assert first["source"] == "bdf-parse"
    assert second["source"] == "bdf-parse-cached"
    assert len(calls) == 1, "캐시가 있으면 파서를 다시 부르지 않는다"
    assert second["nodes"] == first["nodes"]


def test_missing_sources_raise_geometry_unavailable(tmp_path):
    with pytest.raises(geo.GeometryUnavailable):
        geo.load_preview_geometry(
            root=str(tmp_path), revision_id=1,
            normalized_model_path=None, bdf_path=None,
        )


def test_corrupt_cache_falls_back_to_parsing(tmp_path, monkeypatch):
    """캐시 하나가 깨졌다고 미리보기 전체를 실패시키지 않는다."""
    cache = tmp_path / geo.CACHE_DIRNAME / geo.GEOMETRY_CACHE_SUBDIR
    cache.mkdir(parents=True)
    (cache / "9.json").write_text("{ this is not json", encoding="utf-8")

    bdf = tmp_path / "source.bdf"
    bdf.write_text("CEND\nENDDATA\n", encoding="utf-8")
    monkeypatch.setattr(
        "app.services.model_summary_service.parse_bdf_to_model_json",
        lambda path: _model_json(),
    )

    payload = geo.load_preview_geometry(
        root=str(tmp_path), revision_id=9,
        normalized_model_path=None, bdf_path=str(bdf),
    )
    assert payload["source"] == "bdf-parse"
