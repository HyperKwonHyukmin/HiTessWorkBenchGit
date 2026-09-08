"""Four-segment fillet-weld group assessment for Module Ocean Transport.

The four welds are modelled as effective-throat line elements centred on the
four edges of a rectangular plate.  For every load set, all six resultants are
resolved at the eight segment end points.  The governing value is therefore a
real point in one real load set; component-wise maxima are never mixed.

This is an elastic demand calculation.  The retained project acceptance basis
is ``allowable = yield / required safety factor``.  It is intentionally named
in the result so it cannot be mistaken for an AISC/AWS resistance calculation.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence


RESULT_SCHEMA_WELD = "module-ocean-weld/2"
ANALYSIS_METHOD = "elastic-line-weld-group"
CAPACITY_BASIS = "yield-over-safety-factor"

# Reference values from the visible Length_Breadth sheet in Weld Stress_ver01.xlsx.
# The 500x500 plate is not a guess: each Leg node in jungbanBDF_A/B carries an RBE2
# whose 441 dependent nodes span exactly 500 x 500 mm at z=-25 - the PAD footprint.
# The 268 mm x 10 mm weld is the sizing the sheet arrived at; its hidden 50/100/150 mm
# trial sheets all fail, so this default describes a deliberately sized weld.
DEFAULT_WELD_SPEC: Dict[str, float] = {
    "yieldMPa": 450.0,
    "safetyFactor": 3.0,
    "plateHeightMm": 500.0,
    "plateBreadthMm": 500.0,
    "tackCount": 4,
    "weldLengthMm": 268.0,
    "weldLegMm": 10.0,
}

_POSITIVE_FIELDS = (
    "yieldMPa",
    "safetyFactor",
    "plateHeightMm",
    "plateBreadthMm",
    "weldLengthMm",
    "weldLegMm",
)

_LABELS = {
    "yieldMPa": "항복강도",
    "safetyFactor": "안전율",
    "plateHeightMm": "Plate 높이",
    "plateBreadthMm": "Plate 폭",
    "weldLengthMm": "용접 길이",
    "weldLegMm": "용접 각장",
    "tackCount": "용접 개수",
}


def normalize_spec(spec: Dict[str, Any] | None) -> Dict[str, float]:
    """Validate a weld specification and expand the old square-PAD input.

    ``padSizeMm`` was used by result schema v1.  Old saved requests remain
    readable by mapping it to both rectangular plate dimensions when the new
    fields are absent.
    """
    incoming = dict(spec or {})
    legacy_pad = incoming.pop("padSizeMm", None)
    if legacy_pad is not None:
        incoming.setdefault("plateHeightMm", legacy_pad)
        incoming.setdefault("plateBreadthMm", legacy_pad)

    merged: Dict[str, Any] = dict(DEFAULT_WELD_SPEC)
    for key, value in incoming.items():
        if key in merged:
            merged[key] = value

    out: Dict[str, float] = {}
    for key, value in merged.items():
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{_LABELS[key]}에 숫자가 아닌 값이 들어왔습니다: {value!r}")
        if not math.isfinite(number):
            raise ValueError(f"{_LABELS[key]} 값이 올바르지 않습니다: {value!r}")
        out[key] = number

    for key in _POSITIVE_FIELDS:
        if out[key] <= 0:
            raise ValueError(f"{_LABELS[key]}는 0보다 커야 합니다 (입력 {out[key]:g}).")

    count = int(out["tackCount"])
    if out["tackCount"] != count:
        raise ValueError("용접 개수는 정수여야 합니다.")
    if count != 4:
        raise ValueError("현재 배치 모델은 Plate 네 면 중앙의 용접 4개만 지원합니다.")
    out["tackCount"] = count

    shortest_side = min(out["plateHeightMm"], out["plateBreadthMm"])
    if out["weldLengthMm"] > shortest_side:
        raise ValueError(
            "용접 길이는 Plate 높이와 폭보다 클 수 없습니다 "
            f"(용접 {out['weldLengthMm']:g} mm, 최소 변 {shortest_side:g} mm)."
        )
    return out


def weld_section(spec: Dict[str, Any] | None = None) -> Dict[str, float]:
    """Return effective-throat properties of the four line-weld group.

    Two horizontal segments are located at ``y=±height/2`` and two vertical
    segments at ``x=±breadth/2``.  The local ``a*L³/12`` contribution belongs
    only to segments parallel to the coordinate being integrated.
    """
    s = normalize_spec(spec)
    height = s["plateHeightMm"]
    breadth = s["plateBreadthMm"]
    length = s["weldLengthMm"]
    throat = s["weldLegMm"] / math.sqrt(2.0)
    weld_area = throat * length
    total_area = weld_area * 4.0

    ixx = 2.0 * throat * (length * (height / 2.0) ** 2 + length ** 3 / 12.0)
    iyy = 2.0 * throat * (length * (breadth / 2.0) ** 2 + length ** 3 / 12.0)
    polar = ixx + iyy
    zx = ixx / (height / 2.0)
    zy = iyy / (breadth / 2.0)

    return {
        "throatMm": throat,
        "weldAreaMm2": weld_area,
        "totalAreaMm2": total_area,
        "ixxMm4": ixx,
        "iyyMm4": iyy,
        "polarMomentMm4": polar,
        "sectionModulusXMm3": zx,
        "sectionModulusYMm3": zy,
        # Kept for readers of schema v1; new consumers should use X/Y values.
        "sectionModulusMm3": min(zx, zy),
        "yieldMPa": s["yieldMPa"],
        "requiredSafetyFactor": s["safetyFactor"],
        "allowableMPa": s["yieldMPa"] / s["safetyFactor"],
    }


def _weld_endpoints(spec: Dict[str, float]) -> List[Dict[str, Any]]:
    """Return the eight end points of the four centred weld segments."""
    half_h = spec["plateHeightMm"] / 2.0
    half_b = spec["plateBreadthMm"] / 2.0
    half_l = spec["weldLengthMm"] / 2.0
    return [
        {"key": "top-left", "label": "상단 · 좌측 끝", "side": "top", "xMm": -half_l, "yMm": half_h},
        {"key": "top-right", "label": "상단 · 우측 끝", "side": "top", "xMm": half_l, "yMm": half_h},
        {"key": "right-top", "label": "우측 · 상단 끝", "side": "right", "xMm": half_b, "yMm": half_l},
        {"key": "right-bottom", "label": "우측 · 하단 끝", "side": "right", "xMm": half_b, "yMm": -half_l},
        {"key": "bottom-right", "label": "하단 · 우측 끝", "side": "bottom", "xMm": half_l, "yMm": -half_h},
        {"key": "bottom-left", "label": "하단 · 좌측 끝", "side": "bottom", "xMm": -half_l, "yMm": -half_h},
        {"key": "left-bottom", "label": "좌측 · 하단 끝", "side": "left", "xMm": -half_b, "yMm": -half_l},
        {"key": "left-top", "label": "좌측 · 상단 끝", "side": "left", "xMm": -half_b, "yMm": half_l},
    ]


def _point_stress(
    point: Dict[str, Any],
    *,
    fx: float,
    fy: float,
    fz: float,
    mx: float,
    my: float,
    mz: float,
    section: Dict[str, float],
) -> Dict[str, Any]:
    """Resolve all load components at one weld-group point."""
    x = float(point["xMm"])
    y = float(point["yMm"])
    area = section["totalAreaMm2"]
    ixx = section["ixxMm4"]
    iyy = section["iyyMm4"]
    polar = section["polarMomentMm4"]

    sigma_axial = fz / area
    sigma_bx = mx * y / ixx
    sigma_by = -my * x / iyy
    sigma_bending = sigma_bx + sigma_by
    sigma_normal = sigma_axial + sigma_bending

    tau_direct_x = fx / area
    tau_direct_y = fy / area
    tau_torsion_x = -mz * y / polar
    tau_torsion_y = mz * x / polar
    tau_x = tau_direct_x + tau_torsion_x
    tau_y = tau_direct_y + tau_torsion_y
    tau_direct = math.hypot(tau_direct_x, tau_direct_y)
    tau_torsion = math.hypot(tau_torsion_x, tau_torsion_y)
    tau = math.hypot(tau_x, tau_y)
    sigma_eq = math.sqrt(sigma_normal ** 2 + 3.0 * tau ** 2)

    return {
        **point,
        "sigmaAxialMPa": sigma_axial,
        "sigmaBendingXMPa": sigma_bx,
        "sigmaBendingYMPa": sigma_by,
        "sigmaBendingMPa": sigma_bending,
        "sigmaNormalMPa": sigma_normal,
        "tauDirectXMPa": tau_direct_x,
        "tauDirectYMPa": tau_direct_y,
        "tauTorsionXMPa": tau_torsion_x,
        "tauTorsionYMPa": tau_torsion_y,
        "tauXMPa": tau_x,
        "tauYMPa": tau_y,
        "tauDirectMPa": tau_direct,
        "tauTorsionMPa": tau_torsion,
        "tauMPa": tau,
        "sigmaEqMPa": sigma_eq,
    }


def evaluate_leg(
    leg: Dict[str, Any],
    section: Dict[str, float],
    spec: Dict[str, float],
) -> Dict[str, Any]:
    """Evaluate one Leg load set and return its governing physical point."""
    fx = float(leg.get("fxN") or 0.0)
    fy = float(leg.get("fyN") or 0.0)
    fz = float(leg.get("fzN") or 0.0)
    mx = float(leg.get("mxNmm") or 0.0)
    my = float(leg.get("myNmm") or 0.0)
    mz = float(leg.get("mzNmm") or 0.0)

    point_checks = [
        _point_stress(
            point,
            fx=fx,
            fy=fy,
            fz=fz,
            mx=mx,
            my=my,
            mz=mz,
            section=section,
        )
        for point in _weld_endpoints(spec)
    ]
    governing = max(point_checks, key=lambda item: item["sigmaEqMPa"])
    sigma_eq = governing["sigmaEqMPa"]
    allowable = section["allowableMPa"]
    usage = sigma_eq / allowable
    status = "OK" if sigma_eq <= allowable * (1.0 + 1e-12) else "NG"
    actual_safety = section["yieldMPa"] / sigma_eq if sigma_eq > 0.0 else None

    return {
        "index": leg.get("index"),
        "jungbanNodeId": leg.get("jungbanNodeId"),
        "x": float(leg.get("x") or 0.0),
        "y": float(leg.get("y") or 0.0),
        "z": float(leg.get("z") or 0.0),
        "fxN": fx,
        "fyN": fy,
        "fzN": fz,
        "mxNmm": mx,
        "myNmm": my,
        "mzNmm": mz,
        "sigmaAxialMPa": governing["sigmaAxialMPa"],
        "sigmaBendingXMPa": governing["sigmaBendingXMPa"],
        "sigmaBendingYMPa": governing["sigmaBendingYMPa"],
        "sigmaBendingMPa": governing["sigmaBendingMPa"],
        "sigmaNormalMPa": governing["sigmaNormalMPa"],
        "tauDirectMPa": governing["tauDirectMPa"],
        "tauTorsionMPa": governing["tauTorsionMPa"],
        "tauMPa": governing["tauMPa"],
        "sigmaEqMPa": sigma_eq,
        "usage": usage,
        "actualSafetyFactor": actual_safety,
        "status": status,
        "governingPoint": governing,
        "pointChecks": point_checks,
    }


def evaluate_weld(
    legs: Sequence[Dict[str, Any]],
    spec: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Evaluate all Leg load sets with one common four-segment weld layout."""
    if not legs:
        raise ValueError("평가할 Leg 반력이 없습니다. 과정 2 해석을 먼저 수행하세요.")

    normalized = normalize_spec(spec)
    section = weld_section(normalized)
    rows: List[Dict[str, Any]] = [
        evaluate_leg(leg, section, normalized) for leg in legs
    ]
    governing = max(rows, key=lambda row: row["sigmaEqMPa"])
    ng_count = sum(1 for row in rows if row["status"] == "NG")

    return {
        "schema": RESULT_SCHEMA_WELD,
        "method": ANALYSIS_METHOD,
        "capacityBasis": CAPACITY_BASIS,
        "spec": normalized,
        "section": section,
        "legs": rows,
        "summary": {
            "legCount": len(rows),
            "allowableMPa": section["allowableMPa"],
            "maxSigmaEqMPa": governing["sigmaEqMPa"],
            "maxUsage": governing["usage"],
            "actualSafetyFactor": governing["actualSafetyFactor"],
            "governingLegIndex": governing["index"],
            "governingPoint": governing["governingPoint"],
            "ngCount": ng_count,
            "status": "NG" if ng_count else "OK",
        },
    }
