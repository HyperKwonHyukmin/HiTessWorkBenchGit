"""Model Registry — BDF summary 추출.

설계 원칙:
1. **엔진을 요청 경로에서 다시 돌리지 않는다.** 각 프로그램이 이미 만들어 둔 normalized
   model JSON / validation JSON 을 재사용하고, 전부 없을 때만 nastran_bridge 로 폴백한다.
2. **품질 어휘를 새로 만들지 않는다.** orphan/isolated/zeroLength/disconnected 의 정의는
   groupmoduleunit_service.transform_to_step1 이 읽는 nastran_bridge 키를 그대로 쓴다.
   ⚠ freeEnd(degree=1) / orphan(미참조) / isolated(graph edge 0) 는 서로 다른 의미다.
3. **모델 품질과 설계 결과를 분리한다.** 응력 초과는 '나쁜 모델'을 뜻하지 않는다 —
   실패 설계를 정확히 표현한 모델은 고품질 회귀 예제일 수 있다.
4. **없는 값은 null 이다.** 0 으로 채우면 Insight 통계가 조용히 오염된다.
5. **파일을 내려받아야만 알 수 있는 정보는 요약에 끌어올린다.** 입력 감사·단계 요약·진단은
   원본 JSON 이 수 MB 라 사람이 열어 볼 수 없다. 화면에서 바로 읽히는 집계만 뽑아 둔다.
   ⚠ 원본에 들어 있는 **서버 절대경로는 절대 승격하지 않는다**(파일명만 남긴다).
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from typing import Any, Optional

from ..model_registry_schemas import SUMMARY_SCHEMA_VERSION
from .analysis_runner import build_nastran_bridge_command
from .groupmoduleunit_service import _bounding_box, _count_by

logger = logging.getLogger(__name__)

NASTRAN_BRIDGE_TIMEOUT = 120


class SummaryExtractionError(Exception):
    """summary 생성 실패. 라우터가 422 BDF_SUMMARY_FAILED 로 변환한다."""

    code = "BDF_SUMMARY_FAILED"


# --------------------------------------------------------------------------- #
# 순수 매핑 함수 — 파일시스템/DB 의존 없음
# --------------------------------------------------------------------------- #

def _as_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f


def _rigid_breakdown(rigids: list) -> dict[str, int]:
    """RBE2/RBE3 추정 — transform_to_step1 의 휴리스틱과 동일하게 유지한다.

    nastran_bridge JSON 의 rigids 에는 type 필드가 없어 구조로 추정한다.
    """
    out: dict[str, int] = {}
    for r in rigids or []:
        label = "RBE3" if any(k in r for k in ("weights", "components", "refgrid", "refGrid")) else "RBE2"
        out[label] = out.get(label, 0) + 1
    return out


def extract_geometry(model_json: dict) -> dict:
    nodes = model_json.get("nodes") or []
    elements = model_json.get("elements") or []
    rigids = model_json.get("rigids") or []
    properties = model_json.get("properties") or []
    materials = model_json.get("materials") or []
    point_masses = model_json.get("pointMasses") or []

    element_breakdown = _count_by(elements, "type")
    element_breakdown.update(_rigid_breakdown(rigids))

    return {
        "nodeCount": len(nodes),
        "elementCount": len(elements),
        "rigidElementCount": len(rigids),
        "pointMassCount": len(point_masses),
        "boundingBox": _bounding_box(nodes),
        "elementBreakdown": element_breakdown,
        "propertyBreakdown": _count_by(properties, "card") or _count_by(properties, "type"),
        "materialBreakdown": {"MAT1": len(materials)} if materials else {},
    }


def extract_units(model_json: dict, analysis_result: Optional[dict]) -> dict:
    """단위를 '선언된 것만' 기록한다. 추정하지 않는다.

    nastran_bridge 모델 JSON 은 meta.unit 으로 길이 단위만 선언한다. force/mass 는
    어디에도 선언되지 않으므로 null 로 남기고 confidence 를 낮춘다.
    """
    meta = model_json.get("meta") or {}
    length = meta.get("unit")

    # allowable 이 MPa 로 명시된 해석 결과가 있으면 응력 단위만은 확실하다.
    stress = None
    if analysis_result:
        evaluation = analysis_result.get("evaluation") or {}
        if evaluation.get("structuralAllowableMPa") is not None:
            stress = "MPa"

    declared = [v for v in (length, stress) if v]
    if length and stress:
        confidence = "declared"
    elif declared:
        confidence = "partial"
    else:
        confidence = "unknown"

    return {
        "length": length,
        "force": None,
        "mass": None,
        "stress": stress,
        "confidence": confidence,
    }


def _cog_from_stage_summary(stage_summary_json: Optional[dict]) -> Optional[dict]:
    """StageSummary.summary.massProperties.centerOfGravityMm 는 [x, y, z] 배열이다."""
    mass = ((stage_summary_json or {}).get("summary") or {}).get("massProperties") or {}
    raw = mass.get("centerOfGravityMm")
    if not isinstance(raw, (list, tuple)) or len(raw) < 3:
        return None
    x, y, z = (_as_float(raw[i]) for i in range(3))
    if None in (x, y, z):
        return None
    return {"x": x, "y": y, "z": z}


def extract_physical_properties(
    model_json: dict,
    validation_json: Optional[dict],
    stage_summary_json: Optional[dict] = None,
) -> dict:
    """질량/COG. 신뢰할 수 있는 소스가 없으면 null 이다.

    CONM2 질량 합은 모델 단위계가 선언되어 있지 않아 kg 로 단정할 수 없다.
    그래서 totalMassKg 로 승격하지 않고 pointMassSumRaw 로만 보존한다.

    ★ 예외: Model Builder 의 `00_StageSummary.json` 은 `massProperties.totalMassTon`
    처럼 **필드 이름에 단위가 박혀 있다.** 이건 추정이 아니라 선언이므로 kg 로 승격한다.
    어디서 온 값인지 `massSource` 로 남겨 나중에 출처를 되짚을 수 있게 한다.
    """
    point_masses = model_json.get("pointMasses") or []
    raw_sum = 0.0
    seen = False
    for pm in point_masses:
        v = _as_float((pm or {}).get("mass"))
        if v is not None:
            raw_sum += v
            seen = True

    cog = None
    if validation_json:
        cog_dict = ((validation_json.get("input") or {}).get("centerOfGravityMm")) or {}
        x, y, z = (_as_float(cog_dict.get(k)) for k in ("x", "y", "z"))
        if None not in (x, y, z):
            cog = {"x": x, "y": y, "z": z}
    if cog is None:
        cog = _cog_from_stage_summary(stage_summary_json)

    mass = ((stage_summary_json or {}).get("summary") or {}).get("massProperties") or {}
    total_ton = _as_float(mass.get("totalMassTon"))
    beam_ton = _as_float(mass.get("beamMassTon"))
    point_ton = _as_float(mass.get("pointMassTon"))

    return {
        "totalMassKg": total_ton * 1000 if total_ton is not None else None,
        "beamMassKg": beam_ton * 1000 if beam_ton is not None else None,
        "pointMassKg": point_ton * 1000 if point_ton is not None else None,
        "massSource": "stage-summary" if total_ton is not None else None,
        "pointMassSumRaw": raw_sum if seen else None,
        "centerOfGravityMm": cog,
    }


# --------------------------------------------------------------------------- #
# 파일을 열지 않고도 읽히는 요약
#   원본 JSON(입력 감사 수 MB, 단계 요약, 진단 수만 건)을 사람이 내려받아 읽을 수는 없다.
#   화면에서 판단에 쓰이는 집계만 뽑아 summary 에 넣는다.
# --------------------------------------------------------------------------- #

MAX_LISTED_STAGES = 24
MAX_TOP_REASONS = 8
MAX_TOP_DIAGNOSTIC_CODES = 8


def _count_pairs(value: Any) -> list[tuple[str, int]]:
    """{reason: count} 또는 [{reason, count}] 어느 쪽이든 (이름, 수) 목록으로 만든다."""
    pairs: list[tuple[str, int]] = []
    if isinstance(value, dict):
        for k, v in value.items():
            n = _as_int(v)
            if n:
                pairs.append((str(k), n))
    elif isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            name = item.get("reason") or item.get("code") or item.get("key") or item.get("name")
            n = _as_int(item.get("count") or item.get("rows"))
            if name and n:
                pairs.append((str(name), n))
    pairs.sort(key=lambda kv: -kv[1])
    return pairs


def extract_input_audit(audit_json: Optional[dict]) -> Optional[dict]:
    """`00_InputAudit.json` → 입력 CSV 가 어떻게 처리됐는지의 집계.

    ⚠ `inputFiles[].path` 는 서버 절대경로다. **파일명만** 남기고 경로는 버린다.
    ⚠ `rowAudit` 는 CSV 행마다 원문을 담아 수만 건이 된다. 통째로 싣지 않는다.
    """
    if not audit_json:
        return None

    summary = audit_json.get("summary") or {}
    files = []
    for f in audit_json.get("inputFiles") or []:
        if not isinstance(f, dict):
            continue
        raw_path = f.get("path") or ""
        files.append({
            "kind": f.get("kind"),
            "fileName": os.path.basename(raw_path) if raw_path else None,
            "exists": f.get("exists"),
            "columnCount": len(f.get("header") or []) or None,
            "dataRowCount": _as_int(f.get("dataRowCount")),
            "blankDataRowCount": _as_int(f.get("blankDataRowCount")),
        })

    total = _as_int(summary.get("totalDataRows"))
    converted = _as_int(summary.get("convertedRows"))
    top = _count_pairs(summary.get("ignoredByReason"))[:MAX_TOP_REASONS]

    return {
        "unit": (audit_json.get("meta") or {}).get("unit"),
        "files": files,
        "totals": {
            "totalDataRows": total,
            "convertedRows": converted,
            "ignoredRows": _as_int(summary.get("ignoredRows")),
            "errorRows": _as_int(summary.get("errorRows")),
            "parseFailedRows": _as_int(summary.get("parseFailedRows")),
            "blankRows": _as_int(summary.get("blankRows")),
            "ambiguousNameRows": _as_int(summary.get("ambiguousDuplicateSourceNameRows")),
        },
        # 분모가 0 이면 비율은 정의되지 않는다 — 0% 로 쓰지 않는다.
        "conversionRate": (converted / total) if (total and converted is not None) else None,
        "topIgnoredReasons": [{"reason": k, "count": v} for k, v in top],
    }


def extract_build_stages(stage_summary_json: Optional[dict]) -> Optional[dict]:
    """`00_StageSummary.json` → 모델이 단계별로 어떻게 변해 왔는지.

    "노드가 4165 → 9893 으로 늘었다"는 사실은 파일을 받아야만 알 수 있었다. 표로 보여 준다.
    """
    if not stage_summary_json:
        return None

    summary = stage_summary_json.get("summary") or {}
    raw_stages = stage_summary_json.get("stages") or []

    stages = []
    for s in raw_stages[:MAX_LISTED_STAGES]:
        if not isinstance(s, dict):
            continue
        counts = s.get("counts") or {}
        delta = s.get("delta") or {}
        conn = s.get("connectivity") or {}
        diag = s.get("diagnostics") or {}
        stages.append({
            "index": _as_int(s.get("stageIndex")),
            "name": s.get("stageName"),
            "nodeCount": _as_int(counts.get("nodes")),
            "elementCount": _as_int(counts.get("elements")),
            "rigidCount": _as_int(counts.get("rigids")),
            "pointMassCount": _as_int(counts.get("pointMasses")),
            "netNodeDelta": _as_int(delta.get("netNodeDelta")),
            "netElementDelta": _as_int(delta.get("netElementDelta")),
            "groupCount": _as_int(conn.get("groupCount")),
            "errorCount": _as_int(diag.get("error")),
            "warningCount": _as_int(diag.get("warning")),
        })

    return {
        "unit": (stage_summary_json.get("meta") or {}).get("unit"),
        "stageCount": _as_int(summary.get("stageCount")),
        "firstStage": summary.get("firstStage"),
        "lastStage": summary.get("lastStage"),
        "final": {
            "nodeCount": _as_int(summary.get("finalNodeCount")),
            "elementCount": _as_int(summary.get("finalElementCount")),
            "rigidCount": _as_int(summary.get("finalRigidCount")),
            "pointMassCount": _as_int(summary.get("finalPointMassCount")),
        },
        "totals": {
            "errors": _as_int(summary.get("totalErrors")),
            "warnings": _as_int(summary.get("totalWarnings")),
            "infos": _as_int(summary.get("totalInfos")),
        },
        "stages": stages,
        "truncated": len(raw_stages) > MAX_LISTED_STAGES,
    }


def extract_diagnostics(model_json: dict) -> Optional[dict]:
    """엔진이 남긴 진단 메시지를 코드별로 묶는다.

    "경고 11,691건" 이라는 숫자만으로는 아무 판단도 못 한다. **어떤 코드가 몇 건인지**와
    대표 메시지 하나가 있어야 무시해도 되는 경고인지 알 수 있다.
    """
    if not model_json:
        return None

    health = model_json.get("healthMetrics") or {}
    counts = health.get("diagnosticCounts") or {}
    raw = model_json.get("diagnostics") or []

    # 코드별 대표 메시지 — 첫 등장 하나만 남긴다(수만 건을 모두 실을 이유가 없다).
    sample: dict[str, dict] = {}
    counted: dict[str, int] = {}
    severity_totals = {"error": 0, "warning": 0, "info": 0}
    for d in raw:
        if not isinstance(d, dict):
            continue
        code = str(d.get("code") or "UNKNOWN")
        counted[code] = counted.get(code, 0) + 1
        sev = str(d.get("severity") or "").lower()
        if sev in severity_totals:
            severity_totals[sev] += 1
        if code not in sample:
            sample[code] = {"severity": d.get("severity"), "message": d.get("message")}

    by_code = _count_pairs(counts.get("byCode")) or _count_pairs(counted)
    if not by_code and not any(severity_totals.values()) and not counts:
        return None

    return {
        "counts": {
            "error": _as_int(counts.get("error")) if counts.get("error") is not None else (severity_totals["error"] or None),
            "warning": _as_int(counts.get("warning")) if counts.get("warning") is not None else (severity_totals["warning"] or None),
            "info": _as_int(counts.get("info")) if counts.get("info") is not None else (severity_totals["info"] or None),
        },
        "topCodes": [
            {
                "code": code,
                "count": count,
                "severity": (sample.get(code) or {}).get("severity"),
                "sampleMessage": (sample.get(code) or {}).get("message"),
            }
            for code, count in by_code[:MAX_TOP_DIAGNOSTIC_CODES]
        ],
        "distinctCodes": len(by_code),
        # 대표 메시지는 전체 진단 배열이 있을 때만 채워진다(집계만 있는 소스도 있다).
        "hasMessages": bool(sample),
    }


def extract_model_quality(
    model_json: dict,
    *,
    parse_ok: bool = True,
    solver_ran: bool = False,
    nastran_fatal: bool = False,
) -> dict:
    """파싱·연결성·요소품질·solver health. 설계 pass/fail 과 절대 섞지 않는다."""
    health = model_json.get("healthMetrics") or {}
    quality = model_json.get("elementQuality") or {}
    connectivity = model_json.get("connectivity") or {}
    meta = model_json.get("meta") or {}
    issues = health.get("issues") or {}

    orphan = _as_int(issues.get("orphanNodeCount")) or 0
    isolated = (
        _as_int(issues.get("isolatedNodeCount"))
        or _as_int(connectivity.get("isolatedNodeCount"))
        or 0
    )
    zero_len = (
        _as_int(issues.get("zeroLengthElementCount"))
        or _as_int(quality.get("zeroLengthElementCount"))
        or 0
    )
    short = (
        _as_int(issues.get("shortElementCount"))
        or _as_int(quality.get("shortElementCount"))
        or 0
    )
    disconnected = _as_int(issues.get("disconnectedGroupCount"))
    if disconnected is None:
        disconnected = max((_as_int(connectivity.get("groupCount")) or 1) - 1, 0)

    # freeEnd 는 degree=1 일 뿐 결함이 아니다 — 참고값으로만 남기고 등급에 쓰지 않는다.
    free_end = _as_int(issues.get("freeEndNodeCount")) or 0

    mq = {
        "parseStatus": "pass" if parse_ok else "fail",
        "orphanNodeCount": orphan,
        "isolatedNodeCount": isolated,
        "zeroLengthElementCount": zero_len,
        "shortElementCount": short,
        "disconnectedGroupCount": disconnected,
        "freeEndNodeCount": free_end,
        "totalErrors": orphan + isolated + zero_len,
        "totalWarnings": short + disconnected,
        "solverRan": solver_ran,
        "nastranFatal": nastran_fatal,
        "validationSchemaVersion": meta.get("schemaVersion"),
        "reviewStatus": "unreviewed",
    }
    mq["qualityLevel"] = derive_quality_level(mq)
    return mq


def derive_quality_level(model_quality: dict) -> str:
    """Q0~Q3 자동 산정. Q4(Golden)는 사람이 승인할 때만 부여한다."""
    if model_quality.get("parseStatus") != "pass":
        return "Q0"

    critical = (
        (model_quality.get("orphanNodeCount") or 0)
        + (model_quality.get("isolatedNodeCount") or 0)
        + (model_quality.get("zeroLengthElementCount") or 0)
        + (model_quality.get("disconnectedGroupCount") or 0)
    )
    if critical > 0:
        return "Q1"
    if model_quality.get("solverRan") and not model_quality.get("nastranFatal"):
        return "Q3"
    return "Q2"


def extract_analysis_outcome(analysis_result: Optional[dict]) -> dict:
    """설계 결과. 해석을 안 돌린 모델은 'unknown' 이지 'fail' 이 아니다."""
    if not analysis_result:
        return {
            "outcome": "unknown",
            "analysisType": None,
            "allowableStressMPa": None,
            "maxStressMPa": None,
            "maxUtilization": None,
            "memberExceedCount": None,
            "wireCompressionCount": None,
            "maxDisplacementMag": None,
        }

    summary = analysis_result.get("summary") or {}
    evaluation = analysis_result.get("evaluation") or {}

    allowable = _as_float(evaluation.get("structuralAllowableMPa"))
    max_stress = _as_float(summary.get("memberMaxStressMPa"))
    exceed = _as_int(summary.get("memberExceedCount"))
    wire_comp = _as_int(summary.get("wireCompressionCount"))

    utilization = None
    if max_stress is not None and allowable:
        utilization = max_stress / allowable

    if exceed is None and max_stress is None:
        outcome = "unknown"
    elif exceed:
        outcome = "fail"
    elif wire_comp:
        # 부재는 통과했지만 와이어 압축(슬랙)이 있어 그대로 'pass' 라 부를 수 없다.
        outcome = "mixed"
    else:
        outcome = "pass"

    return {
        "outcome": outcome,
        "analysisType": "lifting" if "wires" in analysis_result else "static",
        "allowableStressMPa": allowable,
        "maxStressMPa": max_stress,
        "maxUtilization": utilization,
        "memberExceedCount": exceed,
        "wireCompressionCount": wire_comp,
        "maxDisplacementMag": _as_float(summary.get("maxDisplacementMag")),
    }


def build_summary(
    *,
    model_json: dict,
    validation_json: Optional[dict] = None,
    analysis_result: Optional[dict] = None,
    input_audit_json: Optional[dict] = None,
    stage_summary_json: Optional[dict] = None,
    provenance: Optional[dict] = None,
    model_meta: Optional[dict] = None,
    parse_ok: bool = True,
) -> dict:
    """summary.json 본문을 만든다(디스크 접근 없음).

    artifacts 항목과 artifactId 는 여기서 넣지 않는다 — artifact PK 는 DB flush 후에야
    정해지고 summary.json 자체도 artifact 라 자기참조 순환이 생긴다.

    inputAudit/buildStages/diagnostics 는 소스가 없으면 **키는 두되 값은 None** 이다.
    "제공되지 않음"과 "0건"은 다르며, 프론트가 그 둘을 구분해 표시해야 한다.
    """
    solver_ran = bool(analysis_result)
    nastran_fatal = bool((analysis_result or {}).get("meta", {}).get("hasFatal"))

    quality = extract_model_quality(
        model_json,
        parse_ok=parse_ok,
        solver_ran=solver_ran,
        nastran_fatal=nastran_fatal,
    )
    return {
        "schemaVersion": SUMMARY_SCHEMA_VERSION,
        "model": model_meta or {},
        "provenance": provenance or {},
        "units": extract_units(model_json, analysis_result),
        "geometry": extract_geometry(model_json),
        "physicalProperties": extract_physical_properties(
            model_json, validation_json, stage_summary_json,
        ),
        "modelQuality": quality,
        "analysisOutcome": extract_analysis_outcome(analysis_result),
        "inputAudit": extract_input_audit(input_audit_json),
        "buildStages": extract_build_stages(stage_summary_json),
        "diagnostics": extract_diagnostics(model_json),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


# --------------------------------------------------------------------------- #
# 파일 어댑터
# --------------------------------------------------------------------------- #

def _load_json(path: Optional[str]) -> Optional[dict]:
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        logger.warning("[registry] JSON 로드 실패: %s", path, exc_info=True)
        return None


def parse_bdf_to_model_json(bdf_path: str) -> dict:
    """normalized model JSON 이 없을 때만 쓰는 폴백.

    ⚠ nastran_bridge 는 BDF 옆에 <stem>.json 을 쓴다. 원본 작업 폴더에서 그대로 돌리면
    preview 가 userConnection 을 오염시키므로, 임시 폴더에 복사해 실행하고 정리한다.
    """
    tmp_dir = tempfile.mkdtemp(prefix="registry_parse_")
    try:
        local_bdf = os.path.join(tmp_dir, os.path.basename(bdf_path))
        shutil.copyfile(bdf_path, local_bdf)

        cmd = build_nastran_bridge_command(os.path.basename(local_bdf))
        result = subprocess.run(
            cmd,
            cwd=tmp_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=NASTRAN_BRIDGE_TIMEOUT,
        )
        if result.returncode != 0:
            from ._subproc_decode import safe_decode
            raise SummaryExtractionError(
                "BDF 파싱에 실패했습니다: "
                f"{safe_decode(result.stderr).strip()[-500:]}"
            )

        stem = os.path.splitext(os.path.basename(local_bdf))[0]
        model_json = _load_json(os.path.join(tmp_dir, f"{stem}.json"))
        if model_json is None:
            raise SummaryExtractionError("BDF 파싱 결과 JSON 을 찾을 수 없습니다.")
        return model_json
    except subprocess.TimeoutExpired as exc:
        raise SummaryExtractionError("BDF 파싱이 제한 시간을 초과했습니다.") from exc
    except OSError as exc:
        raise SummaryExtractionError(f"BDF 파싱 중 오류: {exc}") from exc
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def summarize_resolved_source(resolved, *, model_meta: Optional[dict] = None) -> dict:
    """ResolvedSource 로부터 summary 를 만든다.

    companions 에 normalized-model 이 있으면 그것을 쓰고, 없을 때만 엔진을 돌린다.
    """
    companions = resolved.companions or {}

    model_json = _load_json(companions.get("normalized-model"))
    parse_ok = True
    if model_json is None:
        model_json = parse_bdf_to_model_json(resolved.bdf_path)

    validation_json = _load_json(companions.get("validation"))
    analysis_result = _load_json(companions.get("analysis-result"))
    input_audit_json = _load_json(companions.get("input-audit"))
    stage_summary_json = _load_json(companions.get("stage-summary"))

    provenance = {
        "sourceAnalysisId": resolved.analysis.id,
        "sourceProgramName": resolved.program_name,
        "sourceArtifactKind": resolved.artifact_kind.value,
        "sourceFileName": resolved.file_name,
    }
    return build_summary(
        model_json=model_json,
        validation_json=validation_json,
        analysis_result=analysis_result,
        input_audit_json=input_audit_json,
        stage_summary_json=stage_summary_json,
        provenance=provenance,
        model_meta=model_meta,
        parse_ok=parse_ok,
    )
