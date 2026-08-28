"""
Module Unit 해상 운송 구조 해석 — 뷰어용 모델 데이터 서비스.

프론트 2단계(정반 상부 Module Unit 배치 설정)의 유한요소 뷰어에 넘길
**경량 지오메트리 페이로드**를 만든다.

왜 별도 슬림 포맷인가:
  nastran_bridge 가 만드는 모델 JSON 은 요소 품질 지표(edgeLengthsMm, aspectRatio…)까지
  담고 있어 정반 한 대만으로 **37MB** 다. 뷰어가 실제로 쓰는 것은 좌표와 연결도뿐이므로
  그대로 브라우저에 내리면 다운로드·JSON.parse·메모리 모두 낭비다.
  여기서는 node id 대신 **0-based 인덱스 연결도**로 바꿔 3~4MB(gzip 후 1MB 내외)로 줄인다.

정반(jungban)은 고정 모델이라 최초 1회 파싱 결과를 디스크(.viewer.json)와 메모리에 캐시한다.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
from typing import Any, Dict, List, Optional

from .analysis_runner import build_nastran_bridge_command
from .bdf_mass_properties import compute_mass_properties

logger = logging.getLogger(__name__)

_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))          # app/services
_BACKEND_DIR = os.path.abspath(os.path.join(_SERVICE_DIR, "..", ".."))

# 고정 정반 모델. InHouseProgram 규칙 그대로 — git 미추적이며 운영 서버에는 수동 배치한다.
JUNGBAN_DIR = os.path.abspath(os.path.join(
    _BACKEND_DIR, "InHouseProgram", "ModuleOceanMoving", "JungbanBDF",
))
# 정반은 A/B 두 타입으로 나뉜다. 사용자가 2단계 진입 시 하나를 고른다.
# 파일이 늘어나면 여기에만 추가하면 API·프론트가 그대로 따라온다.
JUNGBAN_DECK_TYPES: tuple[tuple[str, str, str], ...] = (
    # (id, 화면 표시 이름, 파일명)
    ("A", "A 타입 정반", "jungbanBDF_A.bdf"),
    ("B", "B 타입 정반", "jungbanBDF_B.bdf"),
)
DEFAULT_DECK_TYPE = "A"


def jungban_bdf_path(deck_type: str) -> str:
    """정반 타입 id → BDF 절대경로. 알 수 없는 id 면 ValueError."""
    for type_id, _label, filename in JUNGBAN_DECK_TYPES:
        if type_id == deck_type:
            return os.path.join(JUNGBAN_DIR, filename)
    raise ValueError(f"알 수 없는 정반 타입입니다: {deck_type}")


def _jungban_cache_path(deck_type: str) -> str:
    """슬림 페이로드 캐시. BDF 와 같은 폴더에 두어 InHouseProgram 수동 배포에 함께 따라가게 한다."""
    return f"{os.path.splitext(jungban_bdf_path(deck_type))[0]}.viewer.json"

# 뷰어가 그리는 요소 카드. 그 외(RBE2/CONM2 등)는 지오메트리가 아니므로 여기서 다루지 않는다.
_SHELL_TYPES = {"CQUAD4", "CTRIA3"}
_BEAM_TYPES = {"CBEAM", "CBAR", "CROD", "CONROD", "CBUSH"}

# 좌표 소수점 자리수 — mm 단위 모델에서 0.1mm 이하는 화면상 의미가 없고,
# 반올림만으로 JSON 텍스트가 30% 이상 줄어든다.
_COORD_NDIGITS = 2

# 슬림 페이로드 스키마 버전. 필드를 늘리면 올린다 — 이 값이 다른 .viewer.json 캐시는
# 원본 BDF 보다 새 것이어도 버리고 다시 만든다(예전 캐시에는 massProperties 가 없다).
_PAYLOAD_SCHEMA = 2

_jungban_lock = threading.Lock()
# 타입 id -> 슬림 페이로드. 타입이 둘뿐이라 둘 다 상주해도 메모리 부담이 없다(각 1~2MB).
_jungban_cache: Dict[str, Dict[str, Any]] = {}


class ModelParseError(RuntimeError):
    """뷰어용 모델을 만들지 못했을 때."""


# ── 모델 JSON → 슬림 지오메트리 ────────────────────────────────────────────

def _round_mass_properties(mp: Dict[str, Any]) -> Dict[str, Any]:
    """질량/무게중심을 화면에 쓸 자리수로 줄인다. 0.1kg·0.1mm 아래는 의미가 없다."""
    def pt(p):
        return None if not p else {k: round(v, 1) for k, v in p.items()}

    out = dict(mp)
    if out.get("totalMassTon") is not None:
        out["totalMassTon"] = round(out["totalMassTon"], 4)
    out["centerOfGravityMm"] = pt(out.get("centerOfGravityMm"))
    out["components"] = {
        name: {
            "massTon": round(c["massTon"], 4),
            "count": c["count"],
            "centroidMm": pt(c.get("centroidMm")),
        }
        for name, c in (out.get("components") or {}).items()
    }
    return out


def slim_model_json(model_json: Dict[str, Any], *, name: str) -> Dict[str, Any]:
    """
    nastran_bridge 모델 JSON 을 뷰어용 지오메트리로 압축한다.

    연결도는 node id 가 아니라 positions 배열의 **0-based 인덱스**로 내보낸다.
    (클라이언트에서 id→index 맵을 다시 만들 필요가 없고 페이로드도 작아진다.)
    """
    nodes = model_json.get("nodes") or []
    if not nodes:
        raise ModelParseError("모델 JSON 에 nodes 가 없습니다.")

    index_of: Dict[Any, int] = {}
    positions: List[float] = []
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3

    for node in nodes:
        nid = node.get("id")
        if nid is None or nid in index_of:
            continue
        try:
            xyz = (float(node.get("x", 0.0)), float(node.get("y", 0.0)), float(node.get("z", 0.0)))
        except (TypeError, ValueError):
            continue
        index_of[nid] = len(positions) // 3
        for axis in range(3):
            value = xyz[axis]
            positions.append(round(value, _COORD_NDIGITS))
            if value < lo[axis]:
                lo[axis] = value
            if value > hi[axis]:
                hi[axis] = value

    if not positions:
        raise ModelParseError("모델 JSON 의 nodes 에서 유효한 좌표를 찾지 못했습니다.")

    quads: List[int] = []
    trias: List[int] = []
    beams: List[int] = []
    skipped = 0

    for element in model_json.get("elements") or []:
        etype = str(element.get("type") or "").upper()
        node_ids = element.get("nodeIds") or []
        if etype in _SHELL_TYPES:
            want = 4 if etype == "CQUAD4" else 3
            if len(node_ids) < want:
                skipped += 1
                continue
            idx = [index_of.get(n) for n in node_ids[:want]]
            if any(i is None for i in idx):
                skipped += 1
                continue
            # 코너가 겹쳐 삼각형으로 퇴화한 CQUAD4 는 삼각형으로 그린다.
            unique = list(dict.fromkeys(idx))
            if want == 4 and len(unique) == 3:
                trias.extend(unique)
            elif len(unique) < 3:
                skipped += 1
            elif want == 4:
                quads.extend(idx)
            else:
                trias.extend(idx)
        elif etype in _BEAM_TYPES:
            # ⚠ nastran_bridge 는 1D 요소를 nodeIds 가 아니라 startNode/endNode 로 낸다
            #    (쉘만 nodeIds). 둘 다 받아 둬야 CBEAM 이 통째로 누락되지 않는다.
            ends = node_ids if len(node_ids) >= 2 else [
                element.get("startNode"), element.get("endNode"),
            ]
            a, b = index_of.get(ends[0]), index_of.get(ends[1])
            if a is None or b is None or a == b:
                skipped += 1
                continue
            beams.extend((a, b))

    # RBE2/RBE3 등 강체 요소는 독립절점↔종속절점을 잇는 선으로 표현한다.
    rigids: List[int] = []
    for rigid in model_json.get("rigids") or []:
        ind = index_of.get(rigid.get("independentNode"))
        if ind is None:
            continue
        for dep in rigid.get("dependentNodes") or []:
            dep_idx = index_of.get(dep)
            if dep_idx is not None and dep_idx != ind:
                rigids.extend((ind, dep_idx))

    if skipped:
        logger.info("[ModuleOceanTransport] %s — 연결도 불완전으로 건너뛴 요소 %d개", name, skipped)

    return {
        "schema": _PAYLOAD_SCHEMA,
        "name": name,
        "unit": (model_json.get("meta") or {}).get("unit") or "mm",
        # 질량/무게중심은 여기서만 계산할 수 있다 — 아래 지오메트리에는 PBEAML 치수·PSHELL 두께·
        # MAT1 밀도·CONM2 가 남지 않기 때문이다. 결과는 스칼라 몇 개뿐이라 페이로드 부담이 없다.
        "massProperties": _round_mass_properties(compute_mass_properties(model_json)),
        "nodeCount": len(positions) // 3,
        "quadCount": len(quads) // 4,
        "triaCount": len(trias) // 3,
        "beamCount": len(beams) // 2,
        "rigidCount": len(rigids) // 2,
        "bounds": {
            "min": [round(v, _COORD_NDIGITS) for v in lo],
            "max": [round(v, _COORD_NDIGITS) for v in hi],
        },
        "positions": positions,
        "quads": quads,
        "trias": trias,
        "beams": beams,
        "rigids": rigids,
    }


# ── BDF → 모델 JSON (nastran_bridge) ──────────────────────────────────────

def parse_bdf_to_model_json(bdf_path: str, *, timeout: int = 300) -> Dict[str, Any]:
    """
    nastran_bridge 로 BDF 를 모델 JSON 으로 변환한다.

    ⚠ nastran_bridge 는 산출 JSON 을 입력 BDF 옆에 떨군다. 원본 폴더(InHouseProgram)를
      더럽히지 않도록 임시 폴더에 복사해서 돌린 뒤 결과만 읽어 온다.
    """
    if not os.path.exists(bdf_path):
        raise ModelParseError(f"BDF 를 찾을 수 없습니다: {bdf_path}")

    with tempfile.TemporaryDirectory(prefix="mot_model_") as work_dir:
        local_bdf = os.path.join(work_dir, os.path.basename(bdf_path))
        shutil.copyfile(bdf_path, local_bdf)

        cmd = build_nastran_bridge_command(os.path.basename(local_bdf))
        result = subprocess.run(
            cmd, cwd=work_dir,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
        )
        if result.returncode != 0:
            from ._subproc_decode import safe_decode
            stderr_text = safe_decode(result.stderr).strip()
            raise ModelParseError(
                f"nastran_bridge exit {result.returncode}: {stderr_text[-2000:]}"
            )

        json_path = os.path.splitext(local_bdf)[0] + ".json"
        if not os.path.exists(json_path):
            raise ModelParseError(f"모델 JSON 이 생성되지 않았습니다: {json_path}")
        with open(json_path, "r", encoding="utf-8") as fp:
            return json.load(fp)


# ── 고정 정반 모델 ────────────────────────────────────────────────────────

def _cache_is_fresh(cache_path: str, source_path: str) -> bool:
    """캐시가 원본 BDF 보다 새 것인지. 정반 BDF 가 교체되면 자동으로 다시 만든다."""
    try:
        return os.path.getmtime(cache_path) >= os.path.getmtime(source_path)
    except OSError:
        return False


def get_jungban_viewer_model(deck_type: str = DEFAULT_DECK_TYPE, *,
                             force_rebuild: bool = False) -> Dict[str, Any]:
    """
    선택된 정반 타입의 뷰어 페이로드. 메모리 → 디스크 캐시 → BDF 파싱 순으로 찾는다.

    정반은 타입별로 고정된 입력이라 매 요청마다 3~4MB BDF 를 다시 파싱할 이유가 없다.
    """
    bdf_path = jungban_bdf_path(deck_type)      # 알 수 없는 타입이면 여기서 ValueError
    cache_path = _jungban_cache_path(deck_type)

    if not force_rebuild and deck_type in _jungban_cache:
        return _jungban_cache[deck_type]

    with _jungban_lock:
        if not force_rebuild and deck_type in _jungban_cache:
            return _jungban_cache[deck_type]

        if not os.path.exists(bdf_path):
            raise ModelParseError(
                f"{deck_type} 타입 정반 BDF 가 배치되어 있지 않습니다. "
                f"InHouseProgram 규칙에 따라 다음 위치에 수동 배포하세요: {bdf_path}"
            )

        if not force_rebuild and os.path.exists(cache_path)                 and _cache_is_fresh(cache_path, bdf_path):
            try:
                # ⚠ 회사 DRM 은 로컬 디스크의 파일을 at-rest 로 암호화하지만
                #   백엔드 프로세스의 read() 는 복호화된 내용을 준다(viewers.py 와 동일 전제).
                with open(cache_path, "r", encoding="utf-8") as fp:
                    slim = json.load(fp)
                # 스키마가 올라간 뒤의 캐시만 신뢰한다. 예전 캐시에는 massProperties 가 없어서
                # 그대로 쓰면 화면에 중량이 영영 안 뜬다(BDF 가 안 바뀌니 mtime 검사로는 못 잡는다).
                if slim.get("schema") != _PAYLOAD_SCHEMA:
                    logger.info("[ModuleOceanTransport] 정반(%s) 캐시 스키마 %s → %s, 재생성합니다",
                                deck_type, slim.get("schema"), _PAYLOAD_SCHEMA)
                    raise ValueError("stale schema")
                _jungban_cache[deck_type] = slim
                logger.info("[ModuleOceanTransport] 정반(%s) 뷰어 캐시 적중: %s", deck_type, cache_path)
                return slim
            except (OSError, ValueError) as exc:
                logger.warning("[ModuleOceanTransport] 정반(%s) 캐시 로드 실패 — 재생성합니다: %s",
                               deck_type, exc)

        logger.info("[ModuleOceanTransport] 정반(%s) BDF 파싱 시작: %s", deck_type, bdf_path)
        model_json = parse_bdf_to_model_json(bdf_path)
        slim = slim_model_json(model_json, name=f"jungban_{deck_type}")
        slim["deckType"] = deck_type
        _jungban_cache[deck_type] = slim

        try:
            with open(cache_path, "w", encoding="utf-8") as fp:
                json.dump(slim, fp, separators=(",", ":"), ensure_ascii=False)
            logger.info("[ModuleOceanTransport] 정반(%s) 뷰어 캐시 생성: %s", deck_type, cache_path)
        except OSError as exc:
            # 캐시 저장 실패는 치명적이지 않다 — 메모리 캐시로 이번 프로세스는 계속 동작한다.
            logger.warning("[ModuleOceanTransport] 정반(%s) 캐시 저장 실패: %s", deck_type, exc)

        return slim


def list_jungban_deck_types() -> List[Dict[str, Any]]:
    """
    정반 타입 선택 화면이 쓰는 **제원 목록**. 지오메트리는 포함하지 않는다.

    선택 카드는 치수·요소 수만 있으면 바로 그릴 수 있으므로, 무거운 지오메트리를
    기다리지 않고 제원부터 띄우기 위해 페이로드를 분리했다. 미리보기 3D 는
    프론트가 /jungban-model 을 타입별로 따로 받아 그린다.

    배치되지 않은 타입도 available=False 로 함께 돌려준다 — 목록에서 조용히 사라지면
    사용자는 '왜 A 타입이 없지?' 를 알 수 없다.
    """
    out: List[Dict[str, Any]] = []
    for type_id, label, filename in JUNGBAN_DECK_TYPES:
        path = os.path.join(JUNGBAN_DIR, filename)
        entry: Dict[str, Any] = {
            "id": type_id,
            "label": label,
            "file": filename,
            "available": os.path.exists(path),
        }
        if entry["available"]:
            try:
                model = get_jungban_viewer_model(type_id)
            except (ModelParseError, ValueError) as exc:
                entry["available"] = False
                entry["error"] = str(exc)
                out.append(entry)
                continue
            bounds = model.get("bounds") or {}
            mn, mx = bounds.get("min"), bounds.get("max")
            entry.update({
                "bounds": bounds,
                "size": [round(mx[i] - mn[i], 1) for i in range(3)] if mn and mx else None,
                "topZ": mx[2] if mx else None,
                "nodeCount": model.get("nodeCount", 0),
                "shellCount": model.get("quadCount", 0) + model.get("triaCount", 0),
                "beamCount": model.get("beamCount", 0),
                "rigidCount": model.get("rigidCount", 0),
                # 선택 카드에서 정반 자중을 바로 비교할 수 있게 한다.
                "massProperties": model.get("massProperties"),
            })
        out.append(entry)
    return out


def get_model_viewer_payload(model_json_path: str, *, name: str) -> Dict[str, Any]:
    """이미 생성된 모델 JSON(예: 1단계 검증의 JSON_ModelInfo)을 뷰어 페이로드로 변환한다."""
    if not os.path.exists(model_json_path):
        raise ModelParseError(f"모델 JSON 을 찾을 수 없습니다: {model_json_path}")
    with open(model_json_path, "r", encoding="utf-8") as fp:
        model_json = json.load(fp)
    return slim_model_json(model_json, name=name)
