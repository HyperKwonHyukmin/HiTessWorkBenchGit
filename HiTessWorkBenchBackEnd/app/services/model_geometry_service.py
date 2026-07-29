"""Model Registry — 등록 모델의 3D 미리보기 지오메트리.

왜 별도 엔드포인트인가:
    캡처 이미지로는 "이 모델이 내가 찾던 그것인지"를 판단할 수 없다. 라이브러리에서
    모델을 고르는 행위는 본질적으로 형상을 보는 일이라, 목록에서 바로 돌려 볼 수 있어야 한다.

왜 summary 에 넣지 않는가:
    노드/요소 배열은 수 MB 다. 목록 응답과 상세 응답에 매번 실으면 화면 전체가 느려진다.
    사용자가 '미리보기'를 열 때만 따로 받아 간다.

설계 계약:
- 응답에 **절대경로를 담지 않는다.** 좌표와 연결 정보만 나간다.
- 정규화 모델 JSON(등록 시 기본 포함)이 1순위, 없으면 저장된 BDF 를 파싱한다.
  BDF 파싱은 최대 120초짜리 subprocess 라 결과를 캐시에 적어 두 번 돌지 않게 한다.
- 너무 큰 모델은 **잘라서 주고 잘랐다고 말한다.** 조용히 일부만 보여 주면
  "요소가 이것뿐"이라는 잘못된 판단을 하게 된다.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

from . import model_summary_service
from .model_registry_storage import is_within_dir

logger = logging.getLogger(__name__)

# 브라우저에서 라인으로 그리는 한계. 넘으면 잘라서 주고 truncated 로 알린다.
MAX_PREVIEW_NODES = 200_000
MAX_PREVIEW_ELEMENTS = 150_000
MAX_PREVIEW_RIGIDS = 60_000

CACHE_DIRNAME = ".cache"
GEOMETRY_CACHE_SUBDIR = "geometry"


class GeometryUnavailable(Exception):
    """미리보기를 만들 소스가 없다. 라우터가 404 로 변환한다."""

    code = "GEOMETRY_UNAVAILABLE"


def _coord(node: dict) -> Optional[tuple[float, float, float]]:
    """GRID 좌표 키는 소스에 따라 x/y/z 또는 X1/X2/X3 다(_bounding_box 와 동일 규칙)."""
    x = node.get("x", node.get("X1", node.get("X")))
    y = node.get("y", node.get("X2", node.get("Y")))
    z = node.get("z", node.get("X3", node.get("Z")))
    if x is None or y is None or z is None:
        return None
    try:
        return float(x), float(y), float(z)
    except (TypeError, ValueError):
        return None


def _element_ends(el: dict) -> Optional[tuple[Any, Any]]:
    """요소의 양 끝 절점. startNode/endNode 우선, 없으면 nodeIds/GA·GB 를 본다."""
    a = el.get("startNode", el.get("n1", el.get("GA")))
    b = el.get("endNode", el.get("n2", el.get("GB")))
    if a is None or b is None:
        ids = el.get("nodeIds") or el.get("nodes")
        if isinstance(ids, (list, tuple)) and len(ids) >= 2:
            a, b = ids[0], ids[1]
    if a is None or b is None:
        return None
    return a, b


def build_preview_geometry(model_json: dict) -> dict:
    """정규화 모델 JSON → 브라우저가 바로 그릴 수 있는 최소 페이로드.

    노드는 `{id: [x, y, z]}`, 선분은 `[[startId, endId, elemId]]` 로 만든다.
    프론트의 기존 BDF 뷰어들이 이미 쓰는 모양이라 변환 계층이 더 필요 없다.
    """
    raw_nodes = model_json.get("nodes") or []
    raw_elements = model_json.get("elements") or []
    raw_rigids = model_json.get("rigids") or []
    raw_point_masses = model_json.get("pointMasses") or []

    nodes: dict[str, list[float]] = {}
    for n in raw_nodes[:MAX_PREVIEW_NODES]:
        if not isinstance(n, dict):
            continue
        nid = n.get("id")
        xyz = _coord(n)
        if nid is None or xyz is None:
            continue
        nodes[str(nid)] = [xyz[0], xyz[1], xyz[2]]

    elements: list[list] = []
    element_types: dict[str, int] = {}
    for el in raw_elements[:MAX_PREVIEW_ELEMENTS]:
        if not isinstance(el, dict):
            continue
        ends = _element_ends(el)
        if ends is None:
            continue
        a, b = str(ends[0]), str(ends[1])
        if a not in nodes or b not in nodes:
            continue
        elements.append([a, b, el.get("id")])
        etype = str(el.get("type") or el.get("cardType") or "ELEM")
        element_types[etype] = element_types.get(etype, 0) + 1

    # RBE2 는 독립절점 하나가 여러 종속절점을 붙잡는다 — 쌍으로 펼친다.
    rigids: list[list[str]] = []
    for r in raw_rigids:
        if not isinstance(r, dict):
            continue
        indep = r.get("independentNode", r.get("independentNodeId"))
        if indep is None:
            continue
        a = str(indep)
        if a not in nodes:
            continue
        for dep in (r.get("dependentNodes") or r.get("dependentNodeIds") or []):
            b = str(dep)
            if b in nodes:
                rigids.append([a, b])
            if len(rigids) >= MAX_PREVIEW_RIGIDS:
                break
        if len(rigids) >= MAX_PREVIEW_RIGIDS:
            break

    point_masses = []
    for pm in raw_point_masses:
        if not isinstance(pm, dict):
            continue
        nid = pm.get("nodeId")
        if nid is not None and str(nid) in nodes:
            point_masses.append(str(nid))

    truncated = (
        len(raw_nodes) > MAX_PREVIEW_NODES
        or len(raw_elements) > MAX_PREVIEW_ELEMENTS
        or len(rigids) >= MAX_PREVIEW_RIGIDS
    )

    return {
        "unit": (model_json.get("meta") or {}).get("unit"),
        "nodes": nodes,
        "elements": elements,
        "rigids": rigids,
        "pointMasses": point_masses,
        "elementTypes": element_types,
        "counts": {
            # 원본 개수 — 잘렸을 때 "실제로는 몇 개였나"를 알 수 있어야 한다.
            "nodeTotal": len(raw_nodes),
            "elementTotal": len(raw_elements),
            "nodeShown": len(nodes),
            "elementShown": len(elements),
            "rigidShown": len(rigids),
            "pointMassShown": len(point_masses),
        },
        "truncated": truncated,
    }


# --------------------------------------------------------------------------- #
# 캐시 — BDF 파싱은 비싸다(최대 120초 subprocess)
# --------------------------------------------------------------------------- #

def _cache_path(root: str, revision_id: int) -> str:
    return os.path.join(root, CACHE_DIRNAME, GEOMETRY_CACHE_SUBDIR, f"{revision_id}.json")


def _read_cache(root: str, revision_id: int) -> Optional[dict]:
    path = _cache_path(root, revision_id)
    if not is_within_dir(root, path) or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        # 캐시가 깨졌으면 없는 셈 친다 — 미리보기 하나 때문에 요청을 실패시키지 않는다.
        logger.warning("[registry] 지오메트리 캐시 손상: revision=%s", revision_id)
        return None


def _write_cache(root: str, revision_id: int, payload: dict) -> None:
    path = _cache_path(root, revision_id)
    if not is_within_dir(root, path):
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except OSError:
        # 캐시 실패는 기능 실패가 아니다. 다음 요청에 다시 파싱하면 된다.
        logger.warning("[registry] 지오메트리 캐시 기록 실패: revision=%s", revision_id, exc_info=True)


def load_preview_geometry(
    *,
    root: str,
    revision_id: int,
    normalized_model_path: Optional[str],
    bdf_path: Optional[str],
) -> dict:
    """revision 하나의 미리보기 지오메트리를 만든다.

    우선순위:
      1. 저장된 정규화 모델 JSON — 등록 시 기본 포함이라 대부분 여기서 끝난다.
      2. 캐시 — BDF 를 이미 파싱해 둔 결과.
      3. 저장된 BDF 파싱(느림) → 캐시에 기록.

    Raises:
        GeometryUnavailable: 셋 다 없을 때
    """
    if normalized_model_path and os.path.isfile(normalized_model_path):
        try:
            with open(normalized_model_path, "r", encoding="utf-8") as f:
                model_json = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            raise GeometryUnavailable("정규화 모델 JSON 을 읽지 못했습니다.") from exc
        if not isinstance(model_json, dict):
            raise GeometryUnavailable("정규화 모델 JSON 형식이 올바르지 않습니다.")
        payload = build_preview_geometry(model_json)
        payload["source"] = "normalized-model"
        return payload

    cached = _read_cache(root, revision_id)
    if cached is not None:
        cached["source"] = "bdf-parse-cached"
        return cached

    if bdf_path and os.path.isfile(bdf_path):
        # 모듈 속성으로 부른다 — 테스트가 파서를 갈아끼울 수 있어야 한다.
        model_json = model_summary_service.parse_bdf_to_model_json(bdf_path)
        payload = build_preview_geometry(model_json)
        _write_cache(root, revision_id, payload)
        payload["source"] = "bdf-parse"
        return payload

    raise GeometryUnavailable(
        "이 모델에는 미리보기를 만들 파일이 없습니다. "
        "등록 시 「정규화 모델 JSON」 또는 원본 BDF 를 함께 보관해야 합니다."
    )
