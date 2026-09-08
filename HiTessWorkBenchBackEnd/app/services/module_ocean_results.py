"""Module Unit 해상 운송 구조 해석 — F06 결과 해석 (순수 함수).

입력은 `nastran_bridge <파일>.f06` 이 내는 JSON 이다(convert_f06 / new_subcase_result).
파일 I/O 는 하지 않는다 — 오케스트레이션 서비스가 읽어서 dict 로 넘겨 준다.
"""
from __future__ import annotations

import math
import re

from typing import Any, Dict, List, Optional, Sequence

RESULT_SCHEMA_STRESS = "moduleOceanStress/1"
RESULT_SCHEMA_LEG = "moduleOceanLegReaction/1"

# 반력 합계 검산 허용 상대오차.
REACTION_CHECK_TOL = 1.0e-3


def f06_fatal_messages(f06_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """FATAL 이 있으면 그 목록, 없으면 빈 리스트."""
    return list(f06_json.get("fatalMessages") or [])


def _subcase(f06_json: Dict[str, Any], subcase_id: int = 1) -> Dict[str, Any]:
    """요청한 SUBCASE 를 고른다. 없으면 **조용히 다른 것을 주지 않고** 예외를 낸다.

    첫 subcase 로 폴백하면 호출부는 요청한 것과 **다른 하중조건**의 결과를
    아무 신호 없이 받는다 — 형태가 멀쩡해 오류로 보이지도 않는다.
    이 함수의 출력은 합불 판정에 쓰이므로 조용히 틀리느니 멈추는 편이 낫다.
    """
    subcases = ((f06_json.get("analysisResults") or {}).get("subcases")) or []
    if not subcases:
        return {}
    for entry in subcases:
        if int(entry.get("subcaseId", 1)) == subcase_id:
            return entry
    available = [entry.get("subcaseId") for entry in subcases]
    raise ValueError(f"F06 에 SUBCASE {subcase_id} 이 없습니다. 있는 것: {available}")


def _abs_max(*values: Optional[float]) -> Optional[float]:
    """절대값 최대. 값이 하나도 없으면 **0.0 이 아니라 None** 을 돌려준다.

    데이터 없음(None)과 응력 0 은 다르다. 0.0 으로 뭉개면 F06 파싱이 깨진 레코드가
    '합격한 0응력 요소'로 둔갑해 요약만 멀쩡해 보인다.
    """
    present = [abs(v) for v in values if v is not None]
    return max(present) if present else None


def evaluate_stress(
    f06_json: Dict[str, Any],
    *,
    allowable_mpa: float,
    subcase_id: int = 1,
    top_n: int = 20,
    excluded_elements: Optional[Dict[int, float]] = None,
    excluded_reason: str = "",
) -> Dict[str, Any]:
    """요소별 대표 응력을 뽑아 허용응력과 비교한다.

    CBEAM/CBAR 은 축력+굽힘 합성 수직응력(sMax/sMin)의 절대 최대,
    쉘은 상·하면 fiber von Mises 의 최대를 대표값으로 쓴다.

    `excluded_elements` 는 {EID: 외경mm} — **판정에서만** 빼는 요소다(소구경 배관).
    요소 자체는 모델에도 `elements` 에도 그대로 남는다. 빼는 것은 요약 숫자
    (최대응력·사용률·초과개수)와 topElements 뿐이고, 뺀 쪽은 `excludedSummary`
    로 따로 실어 화면이 숨기지 않고 보여줄 수 있게 한다.

    ★ 왜 지우지 않고 표시만 하는가 — 소구경 배관은 화물이지 평가 대상 부재가
      아니지만, 그렇다고 그 응력이 '없는 것'은 아니다. 수치를 통째로 감추면
      배관에 실제 문제가 있어도 드러나지 않는다. 제외 근거는
      module_ocean_bdf.DEFAULT_SMALL_BORE_MAX_OD_MM 주석 참조.
    """
    if allowable_mpa <= 0:
        raise ValueError("허용응력은 0보다 커야 합니다.")
    excluded_map: Dict[int, float] = dict(excluded_elements or {})

    subcase = _subcase(f06_json, subcase_id)
    # 수직응력(CBEAM/CBAR)과 von Mises(쉘)를 같은 허용응력으로 재는 것은 의도다 —
    # 부재 검토의 통상 관행이다. 빔 쪽은 전단·비틀림이 빠져 있다는 점도 함께 기억할 것.
    peak: Dict[int, Dict[str, Any]] = {}

    def _record(element_id: Any, element_type: str, stress: Optional[float]) -> None:
        # stress 가 None 이면 그 레코드에 응력 값이 하나도 없다는 뜻이다 — 건너뛴다.
        if element_id is None or stress is None:
            return
        eid = int(element_id)
        current = peak.get(eid)
        if current is None or stress > current["stressMPa"]:
            peak[eid] = {"elementId": eid, "type": element_type, "stressMPa": stress}

    for row in subcase.get("cbeamStresses") or []:
        _record(row.get("elementId"), "CBEAM", _abs_max(row.get("sMax"), row.get("sMin")))
    for row in subcase.get("cbarStresses") or []:
        _record(row.get("elementId"), "CBAR",
                _abs_max(row.get("sAMax"), row.get("sAMin"),
                         row.get("sBMax"), row.get("sBMin")))
    for key in ("quadStresses", "triaStresses"):
        for row in subcase.get(key) or []:
            _record(row.get("elementId"), row.get("elementType") or "SHELL",
                    _abs_max(row.get("vmZ1"), row.get("vmZ2")))

    if not peak:
        raise ValueError("F06 에서 응력 결과를 찾지 못했습니다. STRESS 출력 요청을 확인하세요.")

    for entry in peak.values():
        entry["usage"] = entry["stressMPa"] / allowable_mpa
        # verdict 는 그 요소 자체의 사실이다 — 제외 대상이어도 초과했으면 NG 로 둔다.
        # 제외 여부는 excluded 플래그로 따로 말한다(둘을 한 필드에 섞으면 제외된
        # 배관이 '합격'으로 보인다).
        entry["verdict"] = "NG" if entry["usage"] > 1.0 else "OK"
        outer = excluded_map.get(entry["elementId"])
        if outer is not None:
            entry["excluded"] = True
            entry["outerDiameterMm"] = outer

    ordered = sorted(peak.values(), key=lambda e: e["stressMPa"], reverse=True)
    evaluated = [e for e in ordered if not e.get("excluded")]
    dropped = [e for e in ordered if e.get("excluded")]
    if not evaluated:
        raise ValueError(
            "제외 기준이 모든 요소를 걸러 평가할 부재가 남지 않았습니다. "
            "소구경 제외 외경을 낮추거나 0(제외 안 함)으로 두세요."
        )
    worst = evaluated[0]
    exceed = sum(1 for e in evaluated if e["verdict"] == "NG")

    excluded_summary: Optional[Dict[str, Any]] = None
    if excluded_map:
        worst_dropped = dropped[0] if dropped else None
        excluded_summary = {
            "reason": excluded_reason,
            # 결과에 응력이 잡힌 것만 센다 — BDF 상의 제외 대상 개수와 다를 수 있고
            # (응력 레코드가 없는 요소), 화면이 말하는 것은 '결과에서 뺀 개수'다.
            "elementCount": len(dropped),
            "maxStressMPa": worst_dropped["stressMPa"] if worst_dropped else None,
            "maxStressElementId": worst_dropped["elementId"] if worst_dropped else None,
            "maxUsage": worst_dropped["usage"] if worst_dropped else None,
            "exceedCount": sum(1 for e in dropped if e["verdict"] == "NG"),
            "topElements": dropped[:top_n],
        }

    return {
        "schema": RESULT_SCHEMA_STRESS,
        "allowableMPa": allowable_mpa,
        # 3D 색맵이 쓰는 **전 요소** 값. 요약 카드의 최대 응력이 모델 어디에서 나온
        # 값인지 확인할 방법이 topElements 20개뿐이면 사용자가 판독할 수 없다.
        # 화면에는 안 실리고(결과 JSON 파일에만 기록) 모달이 열릴 때만 내려받는다.
        # 제외된 요소도 **빠짐없이 담는다** — 색맵에서 구멍이 나면 사용자는 그 자리에
        # 요소가 없다고 읽는다. excluded 플래그로 구분만 해 준다.
        "elements": [
            dict({"elementId": e["elementId"], "stressMPa": e["stressMPa"],
                  "usage": e["usage"]},
                 **({"excluded": True} if e.get("excluded") else {}))
            for e in ordered
        ],
        "summary": {
            # elementCount 는 예나 지금이나 '결과에 응력이 잡힌 전체 요소 수'다.
            # 실제 판정에 쓴 개수는 evaluatedCount 로 따로 준다.
            "elementCount": len(ordered),
            "evaluatedCount": len(evaluated),
            "excludedCount": len(dropped),
            "maxStressMPa": worst["stressMPa"],
            "maxStressElementId": worst["elementId"],
            "maxUsage": worst["usage"],
            "exceedCount": exceed,
        },
        "topElements": evaluated[:top_n],
        "excludedSummary": excluded_summary,
    }


# ── 과정 2: Leg 반력 ──────────────────────────────────────────────────────

def extract_displacements(
    f06_json: Dict[str, Any], *, subcase_id: int = 1,
) -> Dict[str, Any]:
    """절점별 병진 변위(mm)와 합성 크기.

    결과 모달의 변위 색맵·변형 형상이 쓴다. 회전(R1~R3)은 싣지 않는다 — 단위가 rad 라
    같은 색 범례에 못 얹고, 변형 형상을 만드는 데도 쓰지 않는다.

    ⚠ 변위가 비정상적으로 크면(1e6 mm 급) 부분 구속 RBE2 로만 매달린 조각이
    강체 자유운동을 한 것이다 — module_ocean_bdf.promote_partial_rigid_cm 참조.
    """
    subcase = _subcase(f06_json, subcase_id)
    rows: List[Dict[str, Any]] = []
    for row in subcase.get("displacements") or []:
        node_id = row.get("pointId", row.get("nodeId"))
        if node_id is None:
            continue
        t1 = float(row.get("t1") or 0.0)
        t2 = float(row.get("t2") or 0.0)
        t3 = float(row.get("t3") or 0.0)
        rows.append({
            "nodeId": int(node_id),
            "t1": t1, "t2": t2, "t3": t3,
            "mag": math.sqrt(t1 * t1 + t2 * t2 + t3 * t3),
        })

    if not rows:
        return {"nodes": [], "summary": {"nodeCount": 0}}

    peak = max(rows, key=lambda r: r["mag"])
    return {
        "nodes": rows,
        "summary": {
            "nodeCount": len(rows),
            "maxMagMm": peak["mag"],
            "maxNodeId": peak["nodeId"],
            # 성분별 최댓값 — 어느 방향으로 눕는지가 해상 운송에서는 판단 근거가 된다.
            "maxAbsT1Mm": max(abs(r["t1"]) for r in rows),
            "maxAbsT2Mm": max(abs(r["t2"]) for r in rows),
            "maxAbsT3Mm": max(abs(r["t3"]) for r in rows),
        },
    }


def extract_leg_reactions(
    f06_json: Dict[str, Any],
    *,
    legs: Sequence[Dict[str, Any]],
    total_mass_t: float,
    accel_g: Sequence[float],
    subcase_id: int = 1,
) -> Dict[str, Any]:
    """정반 Leg 절점의 SPC 반력을 걷어 온다.

    합본 모델에서는 Leg 절점 자체가 SPC 절점이다(정반 BDF 가 원래 그렇게 만들어져 있다).
    그래서 반력의 힘·모멘트가 곧 그 자리, 즉 **용접부의 실제 하중**이다.
    예전에는 가짜 기둥을 세우고 그 밑동 절점을 대신 봤는데, 그때는 기둥 높이가
    모멘트의 지렛대를 정해 버려서 용접 판정이 임의의 높이에 좌우됐다.
    """
    from .module_ocean_bdf import G_MM_S2      # 순환 없음 — bdf 는 results 를 모른다

    if not legs:
        raise ValueError("정반 Leg 절점이 없습니다.")

    subcase = _subcase(f06_json, subcase_id)
    by_point = {int(row["pointId"]): row for row in (subcase.get("spcForces") or [])
                if row.get("pointId") is not None}
    if not by_point:
        raise ValueError("F06 에서 SPC 반력을 찾지 못했습니다. SPCFORCES 출력 요청을 확인하세요.")

    rows: List[Dict[str, Any]] = []
    total = [0.0, 0.0, 0.0]
    for index, leg in enumerate(legs, start=1):
        node_id = int(leg["id"])
        record = by_point.get(node_id)
        if record is None:
            raise ValueError(f"Leg {index}(절점 {node_id})의 SPC 반력이 F06 에 없습니다.")
        fx = float(record.get("t1") or 0.0)
        fy = float(record.get("t2") or 0.0)
        fz = float(record.get("t3") or 0.0)
        total = [total[0] + fx, total[1] + fy, total[2] + fz]
        rows.append({
            "index": index,
            "jungbanNodeId": node_id,
            # 이 Leg 의 반력을 읽어 온 SPC 절점. 합본에서는 Leg 절점 자신이다.
            "spcNodeId": node_id,
            "x": float(leg["x"]),
            "y": float(leg["y"]),
            # 결과 모달이 정반 Leg 기둥을 그리는 데 쓴다(하단 = SPC 절점, 상단 = 그 위
            # Module Unit 지지 rigid 절점). 반력 판정에는 안 쓰지만 화면 재현에 필요하다.
            "z": float(leg["z"]),
            "zTopMm": float(leg["zTop"]) if leg.get("zTop") is not None else None,
            "fxN": fx, "fyN": fy, "fzN": fz,
            "resultantN": (fx * fx + fy * fy + fz * fz) ** 0.5,
            "mxNmm": float(record.get("r1") or 0.0),
            "myNmm": float(record.get("r2") or 0.0),
            "mzNmm": float(record.get("r3") or 0.0),
        })

    # 검산: 반력 합계는 관성력과 크기가 같고 방향이 반대다(Nastran SPCFORCE 규약).
    # 기둥 밀도를 0 으로 둔 것이 이 등식을 깨끗하게 만든다.
    mass = float(total_mass_t)
    expected = [-mass * float(component) * G_MM_S2 for component in accel_g]
    scale = max(abs(v) for v in expected) or 1.0
    max_rel_error = max(abs(total[i] - expected[i]) / scale for i in range(3))

    return {
        "schema": RESULT_SCHEMA_LEG,
        "totalMassT": mass,
        "accelG": {"ax": float(accel_g[0]), "ay": float(accel_g[1]), "az": float(accel_g[2])},
        "legs": rows,
        "check": {
            "sumReactionN": total,
            "expectedN": expected,
            "maxRelError": max_rel_error,
            "ok": max_rel_error <= REACTION_CHECK_TOL,
        },
    }


# F06 에서 걷어 올릴 경고. AUTOSPC 는 접촉 절점 선정이 잘못돼 강체모드가 남았을 때
# Nastran 이 임의 절점을 조용히 고정한 흔적이고, 피벗비 경고는 mechanism 이 남은 채
# PARAM,BAILOUT 으로 풀렸다는 신호다. 둘 다 결과를 믿을 수 없다는 뜻이다.
_WARNING_MARKERS = (
    "AUTOMATICALLY SET",
    "USER WARNING MESSAGE",
    "EXCESSIVE PIVOT",
    "MAXRATIO",
)

# 피벗비 표의 한 줄: "  9    T2    4.24643E+15    9.88699E+05"
_PIVOT_ROW = re.compile(
    r"^\s*(\d+)\s+([TR][123])\s+([-+]?\d*\.?\d+E[-+]\d+)\s+([-+]?\d*\.?\d+E[-+]\d+)\s*$"
)
# 이 이상이면 사실상 mechanism 으로 본다(Nastran 자체 경고 임계값과 같은 자릿수).
PIVOT_RATIO_LIMIT = 1.0e7


def scan_f06_quality(f06_text: str, *, warning_limit: int = 40,
                     node_limit: int = 200) -> Dict[str, Any]:
    """F06 에서 "결과를 믿어도 되는가"에 관한 신호를 뽑는다(파일 I/O 는 호출부가 한다).

    `highPivotDofCount` 가 0 이 아니면 mechanism 이 남은 채 풀린 것이다.
    다만 **그것만으로 결과 전체가 무의미하다고 단정할 수는 없다** — 실측(3521 모델)에서
    특이 자유도는 하중을 거의 받지 않는 L-50x50x6 짧은 스터브 부재의 자유단에 몰려 있었고,
    응력 상위 60개 요소 중 그 절점에 붙은 것은 **하나도 없었다**. 어느 쪽인지는
    `assess_singularity_impact` 가 요소 연결로 가른다 — 여기서는 사실만 모은다.
    """
    warnings: List[str] = []
    pivot_nodes = set()
    pivot_dofs = 0
    worst_ratio = 0.0

    for raw in f06_text.splitlines():
        stripped = raw.strip()
        if not stripped:
            continue
        upper = stripped.upper()
        if any(marker in upper for marker in _WARNING_MARKERS) and len(warnings) < warning_limit:
            warnings.append(stripped)
        match = _PIVOT_ROW.match(raw)
        if match:
            ratio = abs(float(match.group(3)))
            if ratio >= PIVOT_RATIO_LIMIT:
                pivot_dofs += 1
                pivot_nodes.add(int(match.group(1)))
                worst_ratio = max(worst_ratio, ratio)

    return {
        "warnings": warnings,
        "highPivotDofCount": pivot_dofs,
        "highPivotNodeCount": len(pivot_nodes),
        # 어느 절점인지 — 이게 있어야 "이 특이가 결과를 오염시켰나"를 되짚을 수 있다.
        "highPivotNodeIds": sorted(pivot_nodes)[:node_limit],
        "worstPivotRatio": worst_ratio,
        # 수치적으로 깨끗한가. 오염 여부(=결과를 써도 되는가)는 별개이며
        # assess_singularity_impact 가 판단한다.
        "trustworthy": pivot_dofs == 0,
    }


def scan_f06_warnings(f06_text: str, *, limit: int = 40) -> List[str]:
    """경고 줄만 필요할 때의 얇은 래퍼."""
    return scan_f06_quality(f06_text, warning_limit=limit)["warnings"]


# 특이 절점에서 몇 홉까지를 "영향권"으로 볼 것인가.
# 1홉이면 특이 절점에 직접 붙은 부재만 본다. 국소 mechanism 은 인접 부재의 내력에만
# 영향을 주므로 기본 2홉으로 여유를 둔다.
SINGULARITY_HOPS = 2


def assess_singularity_impact(
    *,
    singular_node_ids: Sequence[int],
    element_nodes: Dict[int, Sequence[int]],
    top_element_ids: Sequence[int],
    governing_element_id: Optional[int] = None,
    hops: int = SINGULARITY_HOPS,
) -> Dict[str, Any]:
    """특이 자유도가 **응력 평가 결과를 실제로 오염시켰는지** 판단한다.

    "고피벗이 하나라도 있으면 전부 못 믿는다"는 과잉 차단이다. 실측(3521 모델):
    특이 14개 절점은 대부분 자유단/직선 중간의 짧은 스터브였고, 판정을 지배하는
    최대 응력 부재(EID 2216, 사용률 10.07)는 그 영향권 **밖** 이었다. 그런 경우
    사용자에게 필요한 말은 "믿지 마세요"가 아니라 "이 부재 값만 빼고 보세요"다.

    반대로 **지배 부재가 영향권 안** 이면 합불 판정 자체가 mechanism 이 만든 허수 위에
    서 있으므로 결과를 쓰면 안 된다. 둘을 같은 경고로 묶으면 진짜 위험이 묻힌다.
    """
    singular = {int(n) for n in singular_node_ids}
    if not singular:
        return {
            "affectedElementCount": 0,
            "affectedElementIds": [],
            "contaminatedTopElementIds": [],
            "governingContaminated": False,
            "localized": True,
            "freeEndNodeCount": 0,
        }

    adjacency: Dict[int, set] = {}
    for nodes in element_nodes.values():
        for a in nodes:
            for b in nodes:
                if a != b:
                    adjacency.setdefault(int(a), set()).add(int(b))

    reach = set(singular)
    for _ in range(max(0, hops - 1)):
        reach |= {n for m in list(reach) for n in adjacency.get(m, ())}

    affected = sorted(eid for eid, nodes in element_nodes.items()
                      if any(int(n) in reach for n in nodes))
    affected_set = set(affected)
    contaminated = [int(e) for e in top_element_ids if int(e) in affected_set]
    governing_bad = (governing_element_id is not None
                     and int(governing_element_id) in affected_set)

    # 특이 절점이 **부재 하나만 붙은 끝점**(자유단)인가. 화면이 "왜 이런 게 나왔나"에
    # 한 줄로 답할 수 있어야 한다 — 일반론을 길게 쓰는 대신 이 숫자를 보여 준다.
    # 실측(3521): 13개가 전부 차수 1 이고 붙은 부재는 전부 L 50×50×6 짧은 앵글이었다.
    degree: Dict[int, int] = {}
    for nodes in element_nodes.values():
        for n in nodes:
            degree[int(n)] = degree.get(int(n), 0) + 1
    free_ends = sum(1 for n in singular if degree.get(n, 0) <= 1)

    return {
        "affectedElementCount": len(affected),
        "affectedElementIds": affected[:500],
        "contaminatedTopElementIds": contaminated,
        # 판정을 지배하는 최대 응력 부재가 오염됐는가 — 결과 폐기 여부를 가르는 기준.
        "governingContaminated": governing_bad,
        # 상위 응력 요소가 전부 영향권 밖이면 특이는 순수 국소다.
        "localized": not contaminated,
        # 특이 절점 중 자유단(부재 1개만 붙은 끝점)의 개수.
        "freeEndNodeCount": free_ends,
    }
