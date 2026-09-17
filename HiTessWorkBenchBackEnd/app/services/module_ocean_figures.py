"""해상 운송 보고서 그림을 **백엔드에서** 그린다.

화면 캡처를 쓰지 않는 것은 Unit 권상 보고서와 같은 결정이다(CLAUDE.md
"그림은 백엔드가 그린다 — Studio 3D 캡처를 쓰지 않는다"). 그래야

  · 해석 화면이 떠 있지 않아도 보고서가 나오고,
  · 서버에서도 같은 그림이 재생성되며,
  · 지난 이력(My Project)에서 보고서만 다시 뽑을 수 있다.

부재 솔리드·깊이 정렬·투영·컬러바·비율 맞춤은 `unit_lifting_report.solid3d` 를
그대로 쓴다. 이 모듈이 하는 일은 **합본 BDF 를 solid3d 가 아는 geometry 로
옮기고, 응력 결과를 요소 색으로 바꾸는 것**뿐이다.

⚠ 그리는 대상은 **Module Unit 뿐**이다. 합본 BDF 에는 정반이 함께 들어 있지만
  판정 범위(ASSESSMENT_SCOPE)가 Module Unit 으로 좁혀져 있고, 정반까지 각기둥으로
  세우면 면 수가 한 자릿수 배로 늘어 그림 1장에 수십 초가 걸린다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .module_ocean_bdf import (
    _card_fields,
    _card_name,
    _is_continuation,
    _parse_real,
    extract_bulk_lines,
)
from .module_ocean_merge import _cbeam_g0_index, grid_coords_map

# 각기둥으로 세울 1차원 요소. CBUSH(길이 0)·CBEND(곡선)는 제외한다 —
# 직선 각기둥으로 그리면 형상이 거짓말이 된다.
LINE_ELEMENT_CARDS = frozenset({"CBEAM", "CBAR", "CROD", "CONROD", "CTUBE"})

# 응력 색맵. 사용률 1.0 을 넘는 부재는 단색으로 튀게 해 눈에 먼저 들어오게 한다.
USAGE_OVER_RGB = (0.85, 0.11, 0.13)
STRESS_CMAP_NAME = "turbo"


@dataclass
class Section:
    """solid3d.section_profile 이 읽는 최소 단면 정보(getattr 로 kind/dims 만 본다)."""

    pid: int
    kind: str
    dims: List[float]


@dataclass
class Geometry:
    """solid3d.build_mesh 가 읽는 형상. unit_lifting_report 의 Geometry 와 같은 모양이다."""

    nodes: Dict[int, Tuple[float, float, float]]
    elements: List[Tuple[int, int, int, Optional[int], str]]
    center: Tuple[float, float, float]
    orientations: Dict[int, Tuple[float, float, float]] = field(default_factory=dict)


# ── BDF → geometry ───────────────────────────────────────────────────────────

def _continuation_dims(bulk_lines: Sequence[str], index: int) -> List[float]:
    """PBEAML/PBARL 의 연속행에 흩어진 치수를 순서대로 모은다."""
    dims: List[float] = []
    cursor = index + 1
    while cursor < len(bulk_lines) and _is_continuation(bulk_lines[cursor]):
        for token in _card_fields(bulk_lines[cursor]):
            if not token:
                continue
            try:
                dims.append(_parse_real(token))
            except ValueError:
                pass
        cursor += 1
    return dims


def parse_sections(bulk_lines: Sequence[str]) -> List[Section]:
    """단면 카드 → Section 목록.

    치수를 직접 갖지 않는 PBAR/PROD 는 **단면적에서 등가 변**을 만든다. 기본값으로
    두면 굵은 부재와 가는 부재가 화면에서 같은 굵기로 보여 형상이 읽히지 않는다.
    """
    out: List[Section] = []
    for index, raw in enumerate(bulk_lines):
        name = _card_name(raw)
        if name not in ("PBEAML", "PBARL", "PTUBE", "PBAR", "PROD"):
            continue
        fields = _card_fields(raw)
        try:
            pid = int(fields[0])
        except (IndexError, ValueError):
            continue

        if name in ("PBEAML", "PBARL"):
            # PBEAML PID MID GROUP TYPE — GROUP 은 비어 있을 수 있고 TYPE 은 4번째다.
            kind = (fields[3] if len(fields) > 3 else "").upper()
            out.append(Section(pid, kind, _continuation_dims(bulk_lines, index)))
        elif name == "PTUBE":
            # PTUBE PID MID OD T. solid3d 의 TUBE 규약은 DIM1 = 외반경이다.
            try:
                out.append(Section(pid, "TUBE", [_parse_real(fields[2]) / 2.0]))
            except (IndexError, ValueError):
                continue
        else:
            try:
                area = _parse_real(fields[2])
            except (IndexError, ValueError):
                continue
            if area <= 0:
                continue
            if name == "PROD":
                out.append(Section(pid, "ROD", [math.sqrt(area / math.pi)]))
            else:
                side = math.sqrt(area)
                out.append(Section(pid, "BAR", [side, side]))
    return out


def _orientation(fields: List[str], nodes: Dict[int, Tuple[float, float, float]],
                 ga: int) -> Tuple[float, float, float]:
    """CBEAM/CBAR 의 단면 방향 벡터.

    G0(방향절점) 형식이면 GA→G0 벡터로 바꾼다. 방향을 잘못 잡으면 H 단면의 웹과
    플랜지가 90° 돌아가 그림에서 부재 굵기가 반대로 보인다.
    """
    g0 = _cbeam_g0_index(fields)
    if g0 is not None:
        try:
            target = nodes.get(int(fields[g0 - 1]))
        except (IndexError, ValueError):
            target = None
        origin = nodes.get(ga)
        if target is not None and origin is not None:
            vector = tuple(float(target[i]) - float(origin[i]) for i in range(3))
            if any(abs(v) > 1.0e-9 for v in vector):
                return vector                                   # type: ignore[return-value]
        return (0.0, 0.0, 1.0)
    try:
        vector = tuple(_parse_real(fields[4 + i]) for i in range(3))
    except (IndexError, ValueError):
        return (0.0, 0.0, 1.0)
    return vector if any(abs(v) > 1.0e-9 for v in vector) else (0.0, 0.0, 1.0)


def parse_geometry(bulk_lines: Sequence[str]) -> Geometry:
    """합본 BDF 의 절점·1차원 요소·단면 방향을 읽는다."""
    nodes = grid_coords_map(bulk_lines)
    elements: List[Tuple[int, int, int, Optional[int], str]] = []
    orientations: Dict[int, Tuple[float, float, float]] = {}
    for raw in bulk_lines:
        name = _card_name(raw)
        if name not in LINE_ELEMENT_CARDS:
            continue
        fields = _card_fields(raw)
        try:
            eid = int(fields[0])
            if name == "CONROD":                       # CONROD EID G1 G2 MID A
                pid, ga, gb = None, int(fields[1]), int(fields[2])
            else:
                pid, ga, gb = int(fields[1]), int(fields[2]), int(fields[3])
        except (IndexError, ValueError):
            continue
        if ga not in nodes or gb not in nodes:
            continue
        elements.append((eid, ga, gb, pid, ""))
        orientations[eid] = _orientation(fields, nodes, ga)

    if nodes:
        xs, ys, zs = zip(*nodes.values())
        center = ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0,
                  (min(zs) + max(zs)) / 2.0)
    else:
        center = (0.0, 0.0, 0.0)
    return Geometry(nodes, elements, center, orientations)


# ── 결과 → 요소 색 ───────────────────────────────────────────────────────────

def module_element_ids(geometry: Geometry, stress: Dict[str, Any], id_offset: int) -> set:
    """합본 BDF 에서 **Module Unit 요소**의 EID 집합(합본 기준).

    결과 JSON 의 EID 는 사용자 BDF 기준으로 되돌아가 있으므로 offset 을 도로 더한다.
    결과에 요소 목록이 없으면(구 결과) ID 대역으로 가른다.
    """
    ids = {int(item["elementId"]) + id_offset
           for item in (stress.get("elements") or [])
           if item.get("elementId") is not None}
    if ids:
        return ids
    return {row[0] for row in geometry.elements if row[0] >= id_offset}


def _usage_by_bdf_eid(entries: Sequence[Dict[str, Any]],
                      id_offset: int) -> Tuple[Dict[int, float], set]:
    """(EID→사용률, 판정 제외 EID 집합). 둘 다 합본 BDF 기준 ID 다."""
    values: Dict[int, float] = {}
    excluded: set = set()
    for item in entries or []:
        eid, usage = item.get("elementId"), item.get("usage")
        if eid is None or usage is None:
            continue
        try:
            key = int(eid) + id_offset
            values[key] = float(usage)
        except (TypeError, ValueError):
            continue
        if item.get("excluded"):
            excluded.add(key)
    return values, excluded


def _usage_norm(values: Dict[int, float], excluded: set):
    """색 눈금 상한.

    ★ **판정 대상 부재만** 으로 상한을 잡는다. 소구경 배관은 판정에서 빠지는데
      실측(3521)에서 사용률이 2.0 을 넘어, 이것까지 눈금에 넣으면 정작 판정하는
      부재(최대 0.63)가 전부 눈금 아래 25% 에 뭉쳐 색이 읽히지 않는다.
      제외 부재는 눈금 밖 색(USAGE_OVER_RGB)으로 빠져 여전히 눈에 띈다.
    최대가 1 보다 낮아도 눈금은 1.0 까지 둔다 — 허용선이 어디인지 보여야 한다.
    """
    import matplotlib.colors as mcolors

    judged = [v for eid, v in values.items()
              if eid not in excluded and math.isfinite(v)]
    top = max(judged or [0.0])
    return mcolors.Normalize(vmin=0.0, vmax=max(1.0, round(top + 0.05, 2)))


# ── 그림 ─────────────────────────────────────────────────────────────────────

def render_report_figures(
    *,
    stress: Dict[str, Any],
    bdf_path: str,
    id_offset: int,
    load_case_ids: Sequence[str] = (),
) -> Tuple[Dict[str, bytes], Dict[str, str]]:
    """보고서가 쓰는 PNG 들을 만든다. 그림별로 실패를 격리한다.

    돌려주는 키는 화면 캡처 시절과 같다 — `model_iso.png`, `stress_envelope.png`,
    `stress_<LC>.png`. 보고서 조립부(module_ocean_report)는 그림이 어디서 왔는지
    몰라도 된다.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from .unit_lifting_report import solid3d

    figures: Dict[str, bytes] = {}
    errors: Dict[str, str] = {}

    try:
        bulk = extract_bulk_lines(_read_text(bdf_path))
        geometry = parse_geometry(bulk)
        sections = parse_sections(bulk)
    except Exception as exc:                                       # noqa: BLE001
        return figures, {"model": f"{type(exc).__name__}: {exc}"}
    if not geometry.nodes or not geometry.elements:
        return figures, {"model": "ValueError: 합본 BDF 에서 형상을 읽지 못했습니다."}

    include = module_element_ids(geometry, stress, id_offset)
    mesh = solid3d.build_mesh(geometry, sections, include=include)
    if not len(mesh.quads):
        return figures, {"model": "ValueError: Module Unit 요소를 찾지 못했습니다."}

    cmap = plt.get_cmap(STRESS_CMAP_NAME)
    allowable = stress.get("allowableMPa")
    allowable_note = f"allowable {allowable:g} MPa" if isinstance(allowable, (int, float)) else ""

    def _draw(key: str, fn) -> None:
        try:
            figures[key] = fn()
        except Exception as exc:                                   # noqa: BLE001
            errors[key] = f"{type(exc).__name__}: {exc}"
            plt.close("all")

    _draw("model_iso.png", lambda: solid3d.render(
        mesh, solid3d.face_colors(mesh), view="iso",
        title="Module Unit analysis model",
        subtitle=f"{len(include):,} members  ·  as seated on the transport deck"))

    def _stress_figure(key: str, entries: Sequence[Dict[str, Any]],
                       title: str, lead: str = "") -> None:
        values, excluded = _usage_by_bdf_eid(entries, id_offset)
        if not values:
            errors[key] = "ValueError: 요소별 응력 결과가 없습니다."
            return
        norm = _usage_norm(values, excluded)
        # ⚠ 부제는 한 줄이고 줄바꿈이 없다 — 길면 오른쪽에서 잘린다(실측 120자에서 잘림).
        #   빨간 부재가 왜 빨간지는 반드시 남긴다. 판정 대상이 아닌 배관이 눈금을 넘어
        #   빨갛게 나오는 것을 사용자가 NG 로 읽으면 안 된다.
        subtitle = "  ·  ".join(filter(None, [
            lead, allowable_note,
            f"small-bore piping excluded from verdict ({len(excluded)})" if excluded else "",
        ]))
        _draw(key, lambda: solid3d.render(
            mesh,
            solid3d.face_colors(mesh, per_element=solid3d.value_colors(
                values, cmap, norm, over_rgb=USAGE_OVER_RGB)),
            view="iso", title=title, subtitle=subtitle,
            colorbar=(cmap, norm, "usage  sigma / allowable")))

    governing = (stress.get("summary") or {}).get("governingLoadCase")
    _stress_figure(
        "stress_envelope.png", stress.get("elements") or [],
        "Stress usage envelope of all load cases",
        f"governing {governing}" if governing else "")

    per_case = stress.get("perLoadCaseElements") or {}
    for case_id in load_case_ids:
        entries = per_case.get(str(case_id))
        if entries:
            _stress_figure(f"stress_{case_id}.png", entries,
                           f"{case_id} member stress usage")

    return figures, errors


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as fp:
        return fp.read()
