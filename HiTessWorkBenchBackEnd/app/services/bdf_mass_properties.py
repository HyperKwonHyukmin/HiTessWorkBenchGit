"""
nastran_bridge 모델 JSON → 총 질량 / 무게중심(COG).

왜 백엔드인가:
  뷰어로 내려가는 슬림 페이로드는 좌표와 연결도뿐이다. 질량 계산에 필요한
  PBEAML 단면 치수·PSHELL 두께·MAT1 밀도·CONM2 는 슬림화 과정에서 버려진다.
  그래서 계산은 모델 JSON 을 온전히 들고 있는 여기서 한 번만 하고, 결과(스칼라 몇 개)만
  페이로드에 얹어 보낸다.

단위 — NASTRAN consistent units (mm · N · s · t) 를 가정한다:
  MAT1 RHO [t/mm³] × 면적[mm²] × 길이[mm] = [t],  CONM2 M = [t]

정확도(2026-08-28 실측, MSC Nastran GRID POINT WEIGHT GENERATOR 대조):
  정반 A   83.551 t / COG(27486.0,    35.1,  4585.2)  vs  83.5507 t / (27486.0,    35.11,  4584.78)
  정반 B  125.808 t / COG(47141.3,   -52.8,  4986.3)  vs 125.8084 t / (47141.22,  -52.86,  4985.88)
  MU 3521  16.381 t / COG(144023.4, -12839.4, 36642.8) vs  16.38108 t / (144024.8, -12838.44, 36644.91)
  → 질량 오차 0.000%, COG 오차 정반 0.4mm / 모듈 2.1mm.

계산에 넣지 않는 것 (위 모델들에서는 모두 0 이라 오차가 없었다. 다른 모델에 쓰기 전에 확인할 것):
  · 비구조질량 NSM (PSHELL/PBEAML) — nastran_bridge 가 파싱하지 않는다.
  · CONM2 의 질량중심 오프셋 X1/X2/X3 — 절점 좌표에 그대로 놓는다.
  · 용접·필렛·볼트 등 형상 외 중량.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# 자중을 계산하는 요소. 그 외 카드(RBE2/CGAP 등)는 질량이 없다.
_LINE_TYPES = {"CBEAM", "CBAR", "CROD", "CONROD"}
_SHELL_TYPES = {"CQUAD4", "CTRIA3"}


# ── PBEAML 단면적 ─────────────────────────────────────────────────────────

def cross_section_area_mm2(prop: Dict[str, Any]) -> Optional[float]:
    """
    PBEAML 단면 치수 → 단면적 [mm²]. 모르는 단면이면 None.

    DIM 순서는 MSC PBEAML 단면 라이브러리 규약을 따른다. 필렛(모서리 라운드)은
    치수에 없으므로 결과가 규격표보다 2% 안팎 작게 나오는데, 이는 정상이다.

    ⚠ 'H' 는 다른 단면들과 DIM 규약이 다르다 — 이것 때문에 실제로 틀린 적이 있다.
      DIM1 은 전체 높이가 아니라 **웹 순높이(d − 2·tf)**, DIM2 는 **플랜지 두께의 합(2·tf)**,
      DIM3 이 플랜지 폭, DIM4 가 웹 두께다. (DIM1=플랜지폭, DIM2=전체높이 로 읽으면
      H-400×400×18×21 이 23,244 → 15,288 mm² 로 34% 작아진다.)
      검증: [176,24,200,8]   = H-200×200×8×12   → 6,208 (규격표 6,353, 필렛분 −2.3%)
            [107,18,125,6.5] = H-125×125×6.5×9  → 2,946 (규격표 3,000, −1.8%)
            [130,18,100,6]   = H-148×100×6×9    → 2,580 (규격표 2,635, −2.1%)
    """
    if not prop:
        return None
    dims: List[Any] = prop.get("dims") or []

    def d(i: int) -> Optional[float]:
        if i >= len(dims):
            return None
        v = dims[i]
        return float(v) if isinstance(v, (int, float)) else None

    kind = str(prop.get("kind") or "").strip().upper()

    if kind == "ROD":
        r = d(0)                                    # DIM1 = 반지름
        return math.pi * r * r if r is not None else None

    if kind in ("TUBE", "TUBE2"):
        ro, ri = d(0), (d(1) or 0.0)                # DIM1/DIM2 = 외/내 반지름
        return math.pi * (ro * ro - ri * ri) if ro is not None else None

    if kind == "BAR":
        w, h = d(0), d(1)
        return w * h if None not in (w, h) else None

    if kind == "BOX":
        W, H, tw, tf = d(0), d(1), d(2), d(3)
        if None in (W, H, tw, tf):
            return None
        return W * H - (W - 2 * tw) * (H - 2 * tf)

    if kind in ("L", "T"):                          # DIM1=W, DIM2=H, DIM3=tw, DIM4=tf
        W, H, tw, tf = d(0), d(1), d(2), d(3)
        if None in (W, H, tw, tf):
            return None
        return W * tf + (H - tf) * tw

    if kind == "H":                                 # 위 주석 참고 — 규약이 다르다
        web_h, flange_2t, flange_w, web_t = d(0), d(1), d(2), d(3)
        if None in (web_h, flange_2t, flange_w, web_t):
            return None
        return web_h * web_t + flange_w * flange_2t

    if kind == "I":                                 # DIM1=d, DIM2/3=플랜지폭, DIM4=tw, DIM5/6=tf
        H, w1, w2, tw, tf1, tf2 = (d(i) for i in range(6))
        if None in (H, w1, w2, tw, tf1, tf2):
            return None
        return w1 * tf1 + w2 * tf2 + (H - tf1 - tf2) * tw

    if kind in ("CHAN", "CHANNEL", "Z"):            # DIM1=플랜지폭, DIM2=d, DIM3=tw, DIM4=tf
        W, H, tw, tf = d(0), d(1), d(2), d(3)
        if None in (W, H, tw, tf):
            return None
        return 2 * W * tf + (H - 2 * tf) * tw

    return None


# ── 면적/질량 ─────────────────────────────────────────────────────────────

def _triangle_area(a, b, c) -> float:
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    cx, cy, cz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    return 0.5 * math.sqrt(cx * cx + cy * cy + cz * cz)


class _Accumulator:
    """질량 1차 모멘트 누적기. 마지막에 (모멘트 / 질량) = 무게중심."""

    __slots__ = ("mass", "mx", "my", "mz", "count")

    def __init__(self) -> None:
        self.mass = 0.0
        self.mx = self.my = self.mz = 0.0
        self.count = 0

    def add(self, mass: float, x: float, y: float, z: float) -> None:
        self.mass += mass
        self.mx += mass * x
        self.my += mass * y
        self.mz += mass * z
        self.count += 1

    def as_dict(self) -> Optional[Dict[str, Any]]:
        if self.mass <= 0:
            return None
        return {
            "massTon": self.mass,
            "count": self.count,
            "centroidMm": {
                "x": self.mx / self.mass,
                "y": self.my / self.mass,
                "z": self.mz / self.mass,
            },
        }


def compute_mass_properties(model_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    모델 JSON → 질량 / 무게중심.

    반환:
      { totalMassTon, centerOfGravityMm{x,y,z}, components{beam,shell,point},
        skipped{사유: 개수}, source }
      질량이 하나도 안 잡히면 totalMassTon=None, source='unavailable'.

    질량을 못 세운 요소는 조용히 버리지 않고 **사유별로 세어 돌려준다**. 총중량이
    비어 있거나 작을 때 "밀도가 없어서"인지 "모르는 단면이라서"인지 화면에서 구분해야 하기 때문이다.
    """
    nodes: Dict[int, Tuple[float, float, float]] = {
        n["id"]: (n.get("x", 0.0), n.get("y", 0.0), n.get("z", 0.0))
        for n in (model_json.get("nodes") or [])
        if n.get("id") is not None
    }
    props = {p["id"]: p for p in (model_json.get("properties") or []) if p.get("id") is not None}
    mats = {m["id"]: m for m in (model_json.get("materials") or []) if m.get("id") is not None}

    beam, shell, point = _Accumulator(), _Accumulator(), _Accumulator()
    skipped: Dict[str, int] = {}

    def skip(reason: str) -> None:
        skipped[reason] = skipped.get(reason, 0) + 1

    for elem in model_json.get("elements") or []:
        etype = str(elem.get("type") or "").upper()
        is_line = etype in _LINE_TYPES
        if not is_line and etype not in _SHELL_TYPES:
            continue

        prop = props.get(elem.get("propertyId"))
        # CONROD 는 property 없이 카드 자체에 면적·재질을 들고 있다.
        if prop is None and etype != "CONROD":
            skip(f"{etype}: property 없음")
            continue

        mat_id = elem.get("materialId") if prop is None else prop.get("materialId")
        rho = (mats.get(mat_id) or {}).get("rho")
        if not rho:
            skip(f"{etype}: 밀도(MAT1 RHO) 없음")
            continue

        if is_line:
            area = elem.get("area") if prop is None else cross_section_area_mm2(prop)
            if not area or area <= 0:
                skip(f"{etype}: 단면적 미지원({(prop or {}).get('kind') or '?'})")
                continue
            a, b = nodes.get(elem.get("startNode")), nodes.get(elem.get("endNode"))
            if a is None or b is None:
                skip(f"{etype}: 절점 없음")
                continue
            length = math.dist(a, b)
            if length <= 0:
                skip(f"{etype}: 길이 0")
                continue
            beam.add(area * length * rho,
                     (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
        else:
            thickness = prop.get("thickness")
            if not thickness or thickness <= 0:
                skip(f"{etype}: 두께(PSHELL T) 없음")
                continue
            pts = [nodes[i] for i in (elem.get("nodeIds") or []) if i in nodes]
            if len(pts) < 3:
                skip(f"{etype}: 절점 부족")
                continue
            # 사각형은 대각선으로 두 삼각형으로 갈라 더한다 — 뒤틀린 요소도 안전하다.
            area = _triangle_area(pts[0], pts[1], pts[2])
            if len(pts) >= 4:
                area += _triangle_area(pts[0], pts[2], pts[3])
            if area <= 0:
                skip(f"{etype}: 면적 0")
                continue
            n = len(pts)
            shell.add(area * thickness * rho,
                      sum(p[0] for p in pts) / n,
                      sum(p[1] for p in pts) / n,
                      sum(p[2] for p in pts) / n)

    for pm in model_json.get("pointMasses") or []:
        mass = pm.get("mass")
        if not mass or mass <= 0:
            continue
        node = nodes.get(pm.get("nodeId"))
        if node is None:
            skip("CONM2: 절점 없음")
            continue
        point.add(float(mass), *node)

    total = beam.mass + shell.mass + point.mass
    if total <= 0:
        return {
            "totalMassTon": None,
            "centerOfGravityMm": None,
            "components": {},
            "skipped": skipped,
            "source": "unavailable",
        }

    mx = beam.mx + shell.mx + point.mx
    my = beam.my + shell.my + point.my
    mz = beam.mz + shell.mz + point.mz

    components: Dict[str, Any] = {}
    parts: List[str] = []
    for name, acc in (("beam", beam), ("shell", shell), ("point", point)):
        payload = acc.as_dict()
        if payload:
            components[name] = payload
            parts.append(name)

    return {
        "totalMassTon": total,
        "centerOfGravityMm": {"x": mx / total, "y": my / total, "z": mz / total},
        "components": components,
        "skipped": skipped,
        "source": "computed:" + "+".join(parts),
    }
