"""Barge 가속도 Excel을 서버에서 재현하는 순수 계산 모듈.

원본 ``Barge_Acceleration_rev02_YJH_RE(회신).xlsm`` 은 네 개의 원시 가속도
표와 ``APOL(1)`` 보간으로 결과를 만든다. 운영 서버에서 Excel COM에 의존하면
동시 실행과 Office 설치 여부에 따라 결과가 달라지므로, XLSM에서 추출한
원시 표만 읽고 같은 2차 합리함수 보간을 Python으로 수행한다.

계산 순서는 원본 시트와 같다.
  1. Hs 방향 APOL(1)
  2. VCG 방향 APOL(1)
  3. DWT 방향 APOL(1)
  4. Significant Single Amplitude × 1.86

``APOL(1)`` 은 ITTC 1978 Performance Prediction Method에 수록된 2차
합리함수 ``A + B/x + C/x²`` 보간이다. 범위 밖 외삽은 원본 계산 제한 조건과
마찬가지로 허용하지 않는다.
"""
from __future__ import annotations

from functools import lru_cache
import json
import math
import os
from typing import Any, Dict, Optional, Sequence


GRAVITY_MS2 = 9.8
MPM_FACTOR = 1.86

HS_POINTS = (1.0, 2.0, 3.0)
VCG_POINTS = (3.0, 10.0, 17.0, 25.0)
DWT_POINTS = (50.0, 200.0, 400.0, 600.0, 800.0, 1000.0, 1200.0)

DEFAULT_INPUT = {
    "significantWaveHeightM": 2.0,
    "criticalDampingPct": 3,
    "cargoPosition": "single-center",
    "cargoWeightT": 207.7,
    "cargoVcgFromBottomM": 1.2,
    "bargeDepthM": 4.5,
    "supportHeightM": 3.4,
    "loadCase": "LC1",
}

LOAD_CASE_SIGNS = {
    "LC1": {"label": "++−", "x": 1.0, "y": 1.0, "z": -1.0},
    "LC2": {"label": "−+−", "x": -1.0, "y": 1.0, "z": -1.0},
    "LC3": {"label": "+++", "x": 1.0, "y": 1.0, "z": 1.0},
    "LC4": {"label": "−++", "x": -1.0, "y": 1.0, "z": 1.0},
    # ★ 2026-09-14 추가 — 횡방향 −Y. LC1~4 는 x=±, z=± 를 다 훑으면서 **y 만 항상 +**
    #   였다. 모듈·정반 배치는 좌우 대칭이 아니므로 그 4개는 포락이 아니다.
    #   실측(3521 · 정반 B · LC1 의 부호만 −Y 로 바꿔 Nastran 재실행):
    #     부재 최대  180.4 → 103.6 MPa   (내려간다)
    #     Leg 용접   114.9 → 117.6 MPa   (**올라가고**)
    #     지배 Leg   2번   → 7번          (**바뀐다**, Leg 별 −13% ~ +21.5%)
    #   즉 +Y 만 풀면 지배 Leg 를 통째로 놓친다. 8개가 한 세트다.
    "LC5": {"label": "+−−", "x": 1.0, "y": -1.0, "z": -1.0},
    "LC6": {"label": "−−−", "x": -1.0, "y": -1.0, "z": -1.0},
    "LC7": {"label": "+−+", "x": 1.0, "y": -1.0, "z": 1.0},
    "LC8": {"label": "−−+", "x": -1.0, "y": -1.0, "z": 1.0},
}

# 기본 포락 집합 = 전부. 부분 집합을 고르는 것은 사용자의 선택이지 기본값이 아니다.
DEFAULT_LOAD_CASES = tuple(LOAD_CASE_SIGNS)

_SHEET_BY_OPTION = {
    (3, "single-center"): "COT_ACCOMMODATION_CD3",
    (5, "single-center"): "COT_ACCOMMODATION_CD5",
    (3, "multiple-offset"): "곡 블록_CD3",
    (5, "multiple-offset"): "곡 블록_CD5",
}

SOURCE_WORKBOOK_NAME = "Barge_Acceleration_rev02_YJH_RE(회신).xlsm"
_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TABLE_PATH = os.path.abspath(os.path.join(
    _MODULE_DIR, "..", "data", "module_ocean_barge_acceleration.json",
))


class BargeAccelerationError(ValueError):
    """입력 범위나 원본 가속도 표가 올바르지 않을 때."""


def _as_finite(value: float, label: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise BargeAccelerationError(f"{label}은(는) 유한한 숫자여야 합니다.")
    return number


def _in_range(value: float, low: float, high: float, label: str) -> float:
    number = _as_finite(value, label)
    if number < low or number > high:
        raise BargeAccelerationError(
            f"{label}은(는) {low:g}~{high:g} 범위여야 합니다. (입력 {number:g})"
        )
    return number


def apol_rational(xs: Sequence[float], ys: Sequence[float], target: float) -> float:
    """원본 Excel ``APOL(1)``과 같은 3점 2차 합리함수 보간.

    target을 둘러싼 세 점을 고른 뒤 ``y=A+B/x+C/x²``를 통과시키는 방식이다.
    원본 표의 축은 모두 양수 오름차순이므로 그 계약을 명시적으로 검증한다.
    """
    if len(xs) != len(ys) or len(xs) < 3:
        raise BargeAccelerationError("APOL 보간에는 같은 길이의 3개 이상 좌표가 필요합니다.")
    x = tuple(float(v) for v in xs)
    y = tuple(float(v) for v in ys)
    if any(not math.isfinite(v) for v in (*x, *y)):
        raise BargeAccelerationError("APOL 보간 표에 유효하지 않은 숫자가 있습니다.")
    if any(x[i] >= x[i + 1] for i in range(len(x) - 1)):
        raise BargeAccelerationError("APOL 보간 축은 오름차순이어야 합니다.")

    ex = _in_range(target, x[0], x[-1], "보간값")
    n = len(x)
    # Fortran APOL의 1-based L/M 선택을 그대로 옮긴다.
    l = next(i + 1 for i, xi in enumerate(x) if ex <= xi)
    m = 2
    if l == 1:
        m = 1
    if l == n:
        m = 3
    start = l - m
    x1, x2, x3 = x[start:start + 3]
    y1, y2, y3 = y[start:start + 3]

    x21 = x2 - x1
    x31 = x3 - x1
    x32 = x3 - x2
    y21 = y2 * x2 * x2 - y1 * x1 * x1
    y32 = y3 * x3 * x3 - y2 * x2 * x2
    a0 = (y32 - x32 * y21 / x21) / (x32 * x31)
    b0 = y21 / x21 - a0 * (x1 + x2)
    c0 = ((y1 - a0) * x1 - b0) * x1
    return (c0 / ex + b0) / ex + a0


@lru_cache(maxsize=4)
def load_acceleration_tables(table_path: str = DEFAULT_TABLE_PATH) -> Dict[str, dict]:
    """DRM Excel에서 추출해 둔 원시표를 읽는다.

    원본 XLSM은 파일 헤더가 ``HHIDRMC``인 사내 DRM 문서라 서버 프로세스가 직접
    해독할 수 없다. JSON에는 계산식 결과가 아니라 Hs=1의 원시 X/Y/Z SSA 값만
    보관해 계산 과정을 코드에서 계속 감사할 수 있게 한다.
    """
    source_path = os.path.abspath(table_path)
    if not os.path.isfile(source_path):
        raise BargeAccelerationError(f"가속도 기준 데이터가 없습니다: {source_path}")
    with open(source_path, "r", encoding="utf-8-sig") as fp:
        payload = json.load(fp)
    if payload.get("schemaVersion") != 1:
        raise BargeAccelerationError("지원하지 않는 가속도 기준 데이터 버전입니다.")

    raw_sheets = payload.get("sheets") or {}
    tables: Dict[str, dict] = {}
    for sheet_name in _SHEET_BY_OPTION.values():
        raw_sheet = raw_sheets.get(sheet_name)
        if not raw_sheet:
            raise BargeAccelerationError(f"가속도 기준 시트가 없습니다: {sheet_name}")
        by_dwt: Dict[float, Dict[float, tuple[float, float, float]]] = {}
        for dwt in DWT_POINTS:
            raw_by_vcg = raw_sheet.get(f"{dwt:g}") or {}
            by_vcg: Dict[float, tuple[float, float, float]] = {}
            for vcg in VCG_POINTS:
                raw_value = raw_by_vcg.get(f"{vcg:g}")
                if not isinstance(raw_value, list) or len(raw_value) != 3:
                    raise BargeAccelerationError(
                        f"{sheet_name} 원시 가속도 표의 DWT {dwt:g}, VCG {vcg:g} 값이 없습니다."
                    )
                by_vcg[vcg] = tuple(float(value) for value in raw_value)
            by_dwt[dwt] = by_vcg
        tables[sheet_name] = by_dwt
    return tables


def _axis_ssa(
    table: dict,
    *,
    significant_wave_height_m: float,
    cargo_vcg_from_baseline_m: float,
    cargo_weight_t: float,
    axis_index: int,
) -> float:
    values_by_dwt = []
    for dwt in DWT_POINTS:
        values_by_vcg = []
        for vcg in VCG_POINTS:
            base_at_hs_1 = table[dwt][vcg][axis_index]
            values_by_vcg.append(apol_rational(
                HS_POINTS,
                tuple(base_at_hs_1 * hs for hs in HS_POINTS),
                significant_wave_height_m,
            ))
        values_by_dwt.append(apol_rational(
            VCG_POINTS, values_by_vcg, cargo_vcg_from_baseline_m,
        ))
    return apol_rational(DWT_POINTS, values_by_dwt, cargo_weight_t)


def _apply_signs(dynamic_ms2: Dict[str, float], load_case: str) -> Dict[str, Any]:
    """LC 부호를 씌워 그 조건의 동적·총 가속도[g]를 만든다."""
    signs = LOAD_CASE_SIGNS[load_case]
    dynamic_g = {
        "ax": signs["x"] * dynamic_ms2["x"] / GRAVITY_MS2,
        "ay": signs["y"] * dynamic_ms2["y"] / GRAVITY_MS2,
        "az": signs["z"] * dynamic_ms2["z"] / GRAVITY_MS2,
    }
    # 전역 Z+가 위쪽인 현재 Nastran 모델에서 중력은 -1g이다.
    total_g = {**dynamic_g, "az": -1.0 + dynamic_g["az"]}
    return {
        "id": load_case,
        "signs": signs["label"],
        "dynamicAccelerationG": dynamic_g,
        "totalAccelerationG": total_g,
        "totalMagnitudeG": math.sqrt(sum(value * value for value in total_g.values())),
    }


def normalize_load_cases(requested: Optional[Sequence[str]]) -> list[str]:
    """요청한 LC 목록을 정의 순서로 정리한다. 비어 있으면 8개 전부(기본 포락)."""
    if not requested:
        return list(DEFAULT_LOAD_CASES)
    unknown = [case for case in requested if case not in LOAD_CASE_SIGNS]
    if unknown:
        raise BargeAccelerationError(f"알 수 없는 하중조건입니다: {', '.join(unknown)}")
    chosen = set(requested)
    return [case for case in LOAD_CASE_SIGNS if case in chosen]


def calculate_barge_acceleration(
    *,
    significant_wave_height_m: float,
    critical_damping_pct: int,
    cargo_position: str,
    cargo_weight_t: float,
    cargo_vcg_from_bottom_m: float,
    barge_depth_m: float,
    support_height_m: float,
    load_case: str,
    table_path: str = DEFAULT_TABLE_PATH,
) -> dict:
    """원본 Excel 입력을 받아 선택 LC 한 개의 총 가속도[g]를 반환한다."""
    hs = _in_range(significant_wave_height_m, 1.0, 3.0, "유의파고 Hs [m]")
    dwt = _in_range(cargo_weight_t, 50.0, 1200.0, "화물 중량 [ton]")
    cargo_vcg = _as_finite(cargo_vcg_from_bottom_m, "화물 바닥 기준 VCG [m]")
    barge_depth = _as_finite(barge_depth_m, "Barge Depth [m]")
    support_height = _as_finite(support_height_m, "Support Height [m]")
    baseline_vcg = _in_range(
        cargo_vcg + barge_depth + support_height,
        3.0,
        25.0,
        "Barge baseline 기준 화물 VCG [m]",
    )
    option = (int(critical_damping_pct), cargo_position)
    if option not in _SHEET_BY_OPTION:
        raise BargeAccelerationError("감쇠율은 3%/5%, 화물 위치는 중앙/편심 옵션이어야 합니다.")
    if load_case not in LOAD_CASE_SIGNS:
        raise BargeAccelerationError(f"알 수 없는 하중조건입니다: {load_case}")

    sheet_name = _SHEET_BY_OPTION[option]
    table = load_acceleration_tables(os.path.abspath(table_path))[sheet_name]
    dynamic_ms2 = {
        axis: _axis_ssa(
            table,
            significant_wave_height_m=hs,
            cargo_vcg_from_baseline_m=baseline_vcg,
            cargo_weight_t=dwt,
            axis_index=index,
        ) * MPM_FACTOR
        for index, axis in enumerate(("x", "y", "z"))
    }

    # 동적 가속도의 **크기**는 LC 와 무관하다(Hs·VCG·DWT·감쇠·화물위치만의 함수).
    # LC 는 부호 조합일 뿐이므로 8개를 한 번에 펼쳐 두고, 호출부가 그중 필요한 것을
    # 고른다 — 포락 해석이 LC 마다 표를 다시 보간하지 않아도 되게 하려는 것이다.
    all_cases = {case: _apply_signs(dynamic_ms2, case) for case in LOAD_CASE_SIGNS}
    selected = all_cases[load_case]
    dynamic_g = selected["dynamicAccelerationG"]
    total_g = selected["totalAccelerationG"]

    return {
        "loadCases": all_cases,
        "source": {
            "workbook": SOURCE_WORKBOOK_NAME,
            "sheet": sheet_name,
            "method": "APOL(1) rational interpolation × 1.86",
            "gravityMS2": GRAVITY_MS2,
        },
        "input": {
            "significantWaveHeightM": hs,
            "criticalDampingPct": int(critical_damping_pct),
            "cargoPosition": cargo_position,
            "cargoWeightT": dwt,
            "cargoVcgFromBottomM": cargo_vcg,
            "bargeDepthM": barge_depth,
            "supportHeightM": support_height,
            "cargoVcgFromBaselineM": baseline_vcg,
            "loadCase": load_case,
        },
        "loadCase": {"id": load_case, "signs": selected["signs"]},
        "dynamicAccelerationMS2": dynamic_ms2,
        "dynamicAccelerationG": dynamic_g,
        "totalAccelerationG": total_g,
        "totalMagnitudeG": selected["totalMagnitudeG"],
    }
