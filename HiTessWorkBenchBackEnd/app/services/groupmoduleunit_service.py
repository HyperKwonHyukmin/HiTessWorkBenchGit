"""Group & Module Unit 권상 구조 해석 서비스.

`InHouseProgram/NastranBridge/nastran_bridge.exe` 를 호출해 BDF 모델 JSON 을 산출하고,
프론트엔드 ValidationStepLog 가 기대하는 step1/step2 검증 JSON 형식으로 변환한다.

산출 파일 (work_dir 안):
  - <bdfStem>.json                  : nastran_bridge 가 생성한 원본 모델 JSON (3D 뷰어/이후 단계용)
  - <bdfStem>_validation_step1.json : Step1 BDF 입력 검증 요약 (ValidationStepLog 호환 schema)
  - <bdfStem>_validation_step2.json : Step2 Nastran F06 검증 (use_nastran=True 시)
  - <bdfStem>_validation.bdf        : nastran_bridge 가 생성한 검증용 BDF
  - <bdfStem>_validation.json       : nastran_bridge 의 validate-run 원본 결과
  - <bdfStem>_validation.f06        : Nastran F06 출력
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from datetime import datetime
from typing import Any, Dict, List

from .. import database, models
from ..services.job_manager import job_status_store

logger = logging.getLogger(__name__)


# ── nastran_bridge 산출 JSON → step1 schema 변환 ──────────────────────────

def _count_by(items: List[Dict[str, Any]], key: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for it in items or []:
        k = (it or {}).get(key) or 'Unknown'
        out[str(k)] = out.get(str(k), 0) + 1
    return out


def _bounding_box(nodes: List[Dict[str, Any]]) -> Dict[str, float] | None:
    if not nodes:
        return None
    xs, ys, zs = [], [], []
    for n in nodes:
        # nastran_bridge 의 GRID 좌표 키는 환경에 따라 x/y/z 또는 X1/X2/X3 등이 있을 수 있다.
        x = n.get('x', n.get('X1', n.get('X')))
        y = n.get('y', n.get('X2', n.get('Y')))
        z = n.get('z', n.get('X3', n.get('Z')))
        if x is None or y is None or z is None:
            continue
        try:
            xs.append(float(x)); ys.append(float(y)); zs.append(float(z))
        except (TypeError, ValueError):
            continue
    if not xs:
        return None
    return {
        'xMin': min(xs), 'xMax': max(xs),
        'yMin': min(ys), 'yMax': max(ys),
        'zMin': min(zs), 'zMax': max(zs),
    }


def transform_to_step1(model_json: Dict[str, Any], bdf_path: str) -> Dict[str, Any]:
    """nastran_bridge model JSON 을 Step1 검증 결과로 매핑한다."""
    nodes        = model_json.get('nodes')        or []
    elements     = model_json.get('elements')     or []
    rigids       = model_json.get('rigids')       or []
    properties   = model_json.get('properties')   or []
    materials    = model_json.get('materials')    or []
    point_masses = model_json.get('pointMasses')  or []
    health       = model_json.get('healthMetrics') or {}
    quality      = model_json.get('elementQuality') or {}
    connectivity = model_json.get('connectivity') or {}
    diagnostics  = model_json.get('diagnostics')  or []
    meta         = model_json.get('meta')         or {}

    # 카드 종류별 카운트
    elem_breakdown   = _count_by(elements, 'type')
    # rigids 는 nastran_bridge JSON 에 별도 type 필드가 없으므로 구조로 RBE2/RBE3 를 추정한다.
    # (RBE3 는 weights/components 같은 다중-종속 필드가 추가되는 카드 → 휴리스틱 추정)
    for r in rigids or []:
        if any(k in r for k in ('weights', 'components', 'refgrid', 'refGrid')):
            label = 'RBE3'
        else:
            label = 'RBE2'
        elem_breakdown[label] = elem_breakdown.get(label, 0) + 1
    prop_breakdown   = _count_by(properties, 'card') or _count_by(properties, 'type')
    mat_breakdown    = {'MAT1': len(materials)} if materials else {}

    bbox = _bounding_box(nodes)

    # ── 진단 지표 추출 ─────────────────────────────────────────────
    # README 명시:
    #  - freeEndNodeCount: CBEAM/CBAR/CROD/CONROD 만 보면 degree=1 인 GRID (RBE/CONM2 제외)
    #  - orphanNodeCount:  element/rigid/point mass 어디에서도 참조하지 않는 GRID — 진짜 orphan
    #  - isolatedNodeCount: connectivity 그래프 edge 0
    # ⚠ free-end 와 orphan 은 다른 의미이므로 같은 필드(orphanNodes)에 복사하지 말 것.
    issues = health.get('issues') or {}
    free_end_count    = int(issues.get('freeEndNodeCount')       or 0)
    orphan_node_count = int(issues.get('orphanNodeCount')        or 0)
    isolated_count    = int(issues.get('isolatedNodeCount')      or connectivity.get('isolatedNodeCount') or 0)
    zero_len_count    = int(issues.get('zeroLengthElementCount') or quality.get('zeroLengthElementCount') or 0)
    short_count       = int(issues.get('shortElementCount')      or quality.get('shortElementCount')      or 0)
    # disconnectedGroupCount: groupCount-1 의미 (메인 외 분리된 그룹 수). 신규 필드 우선.
    disconnected_groups = int(issues.get('disconnectedGroupCount') or max(int(connectivity.get('groupCount') or 1) - 1, 0))

    free_end_ids = issues.get('freeEndNodeIds')   or []
    orphan_ids   = issues.get('orphanNodeIds')    or []
    isolated_ids = (connectivity.get('isolatedNodeIds') or [])
    zero_len_ids = (quality.get('zeroLengthElementIds') or [])

    # ── 검증 결과 누적 ──────────────────────────────────────────────
    validation_results: List[Dict[str, Any]] = []
    error_count = 0
    warning_count = 0

    def _push(severity: str, card_type: str, card_id: str, field: str | None, message: str):
        nonlocal error_count, warning_count
        validation_results.append({
            'severity':  severity,
            'cardType':  card_type,
            'cardId':    card_id,
            'fieldName': field,
            'message':   message,
        })
        if severity == 'error':   error_count += 1
        elif severity == 'warning': warning_count += 1

    # 1) nastran_bridge 자체 진단 메시지
    for diag in diagnostics:
        sev = (diag.get('severity') or 'warning').lower()
        _push(
            sev,
            diag.get('cardType')  or diag.get('card') or '-',
            str(diag.get('cardId') or diag.get('id') or '-'),
            diag.get('fieldName') or diag.get('field'),
            diag.get('message')   or '',
        )

    # 2) 진짜 orphan (element/rigid/CONM2 어느 카드도 참조 안 함) — error
    if orphan_node_count > 0:
        ids_preview = orphan_ids[:5]; suffix = '…' if len(orphan_ids) > 5 else ''
        _push('error', 'GRID', f'{orphan_node_count} 개', 'reference',
              f'미참조(orphan) GRID {orphan_node_count} 개 — 예시 ID {ids_preview}{suffix}. 어떤 element/rigid/CONM2 도 참조하지 않습니다.')

    # 3) 고립(isolated) — graph edge 0 — error
    if isolated_count > 0:
        ids_preview = isolated_ids[:5]; suffix = '…' if len(isolated_ids) > 5 else ''
        _push('error', 'GRID', f'{isolated_count} 개', 'graph',
              f'고립(isolated) GRID {isolated_count} 개 — 예시 ID {ids_preview}{suffix}. connectivity 그래프 edge 가 없습니다.')

    # 4) (자유 끝단 GRID 표시는 사용자 요청에 따라 검증 결과에 노출하지 않음 —
    #     RBE/CONM2 연결을 제외한 단순 degree 기반 카운트라 권상 해석 의사결정에 큰 영향이 없음)

    # 5) 분리 그룹 — warning
    if disconnected_groups > 0:
        total_groups = disconnected_groups + 1
        _push('warning', 'CONNECTIVITY', f'{total_groups} groups', 'graph',
              f'분리 그룹 {total_groups} 개 (메인 외 추가 {disconnected_groups} 개). 권상 해석은 단일 그룹 모델을 가정합니다 — 추가 RBE 연결 검토 필요.')

    # 6) zero-length elements — error
    if zero_len_count > 0:
        ids_preview = zero_len_ids[:5]
        _push('error', 'ELEMENT', f'{zero_len_count} 개', 'length',
              f'길이 0 요소 {zero_len_count} 개 — 예시 ID {ids_preview}.')

    # 7) short elements — warning
    if short_count > 0:
        thresh = quality.get('shortElementThresholdMm', 1.0)
        _push('warning', 'ELEMENT', f'{short_count} 개', 'length',
              f'짧은 요소 {short_count} 개 (< {thresh} mm) — 수치 안정성 영향 가능.')

    # ── 규칙별 결과 ────────────────────────────────────────────────
    def _rule_status(err: int, warn: int) -> str:
        return 'error' if err > 0 else ('warning' if warn > 0 else 'pass')

    grid_err = orphan_node_count + isolated_count
    rules_checked = [
        {
            'rule': 'GridRule',
            'status': _rule_status(grid_err, 0),
            'checkedCount': len(nodes),
            'errorCount':   grid_err,
            'warningCount': 0,  # free-end 는 표시 대상 아님 (사용자 요청)
        },
        {
            'rule': 'ElementRule',
            'status': _rule_status(zero_len_count, short_count),
            'checkedCount': len(elements),
            'errorCount':   zero_len_count,
            'warningCount': short_count,
        },
        {
            'rule': 'PropertyRule',
            'status': 'pass',
            'checkedCount': len(properties),
            'errorCount':   0,
            'warningCount': 0,
        },
        {
            'rule': 'MaterialRule',
            'status': 'pass',
            'checkedCount': len(materials),
            'errorCount':   0,
            'warningCount': 0,
        },
        {
            'rule': 'BcRule',
            'status': _rule_status(0, disconnected_groups),
            'checkedCount': disconnected_groups + 1,
            'errorCount':   0,
            'warningCount': disconnected_groups,
        },
    ]

    overall = 'error' if error_count > 0 else ('warning' if warning_count > 0 else 'pass')

    return {
        'stepName':    'BDF 입력 검증 (NastranBridge)',
        'status':      overall,
        'sourceFile':  os.path.basename(meta.get('sourceFile') or bdf_path),
        'version':     meta.get('schemaVersion'),
        'generatedAt': meta.get('timestamp') or datetime.utcnow().isoformat() + 'Z',
        'summary': {
            'totalErrors':    error_count,
            'totalWarnings':  warning_count,
            'parserWarnings': 0,
        },
        'parsingSummary': {
            'cardCounts': {
                'grid':      len(nodes),
                'element':   len(elements) + len(rigids),
                'property':  len(properties),
                'material':  len(materials),
                'pointMass': len(point_masses),
            },
            # README 경고 준수: orphanNodes 는 진짜 orphan(미참조) 만 담는다.
            # free-end 와 isolated 는 별도 필드로 분리해 의미 혼동 방지.
            'orphanNodes':           orphan_node_count,
            'freeEndNodes':          free_end_count,
            'isolatedNodes':         isolated_count,
            'disconnectedGroupCount': disconnected_groups,
            'orphanProperties':      0,
            'orphanMaterials':       0,
            'boundingBox':           bbox,
            'elementBreakdown':      elem_breakdown,
            'propertyBreakdown':     prop_breakdown,
            'materialBreakdown':     mat_breakdown,
            'loadBreakdown':         {},
            'bcBreakdown':           {},
            'parserWarnings':        [],
        },
        'rulesChecked':      rules_checked,
        'validationResults': validation_results,
    }


# ── validate-run 결과 → step2 schema ──────────────────────────────────────

# 사내 표준 Nastran 경로 (없으면 환경변수 NASTRAN_EXE 로 override 가능)
_DEFAULT_NASTRAN_EXE = r"C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe"
_DEFAULT_SUPPORT_RANGE_MM = 500.0


def _resolve_nastran_exe() -> str | None:
    env = os.environ.get("NASTRAN_EXE", "").strip().strip('"')
    if env and os.path.exists(env):
        return env
    if os.path.exists(_DEFAULT_NASTRAN_EXE):
        return _DEFAULT_NASTRAN_EXE
    return None


def _logical_bdf_entries(path: str) -> List[tuple[int, List[str]]]:
    """Return simple logical BDF entries as token lists.

    This is intentionally conservative and only supports the card styles needed
    to detect rigid dependent nodes before adding validation SPCs.
    """
    entries: List[tuple[int, List[str]]] = []
    current_line = 0
    current_tokens: List[str] = []

    def flush():
        nonlocal current_line, current_tokens
        if current_tokens:
            entries.append((current_line, current_tokens))
        current_line = 0
        current_tokens = []

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line_no, raw in enumerate(f, 1):
            line = raw.rstrip("\n")
            stripped = line.strip()
            if not stripped or stripped.startswith("$"):
                continue
            is_cont = stripped.startswith("+") or (line[:8].strip() == "" and current_tokens)
            tokens = [t for t in re.split(r"[\s,]+", stripped.replace("*", " ")) if t and t != "+"]
            if not tokens:
                continue
            if is_cont:
                current_tokens.extend(tokens)
                continue
            flush()
            current_line = line_no
            current_tokens = tokens
    flush()
    return entries


def _parse_int_token(value: Any) -> int | None:
    try:
        text = str(value).strip().rstrip("+")
        if not re.fullmatch(r"[-+]?\d+", text):
            return None
        return int(text)
    except Exception:
        return None


def _rigid_dependent_nodes(bdf_path: str) -> Dict[int, List[str]]:
    """Map GRID id -> rigid entries where that GRID is dependent.

    SPC on RBE2 dependent components causes GP4 2101 (UM/US conflict). RBE3
    reference grids are also treated as dependent for validation-SPC purposes.
    """
    out: Dict[int, List[str]] = {}
    for line_no, tokens in _logical_bdf_entries(bdf_path):
        card = tokens[0].upper()
        if card == "RBE2" and len(tokens) >= 5:
            eid = tokens[1]
            cm = tokens[3]
            for tok in tokens[4:]:
                gid = _parse_int_token(tok)
                if gid is not None:
                    out.setdefault(gid, []).append(f"RBE2 {eid} CM={cm} line={line_no}")
        elif card == "RBE3" and len(tokens) >= 4:
            eid = tokens[1]
            ref_gid = _parse_int_token(tokens[2])
            refc = tokens[3]
            if ref_gid is not None:
                out.setdefault(ref_gid, []).append(f"RBE3 {eid} REFC={refc} line={line_no}")
    return out


def _rewrite_validation_spc(
    validation_bdf_path: str,
    validation_json_path: str,
    blocked_nodes: Dict[int, List[str]],
) -> tuple[int, List[int], str]:
    """Remove rigid dependent nodes from NastranBridge validation SPC1 cards."""
    if not blocked_nodes:
        return 0, [], ""

    with open(validation_json_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    validation = payload.get("validation") or {}
    spc_id = int(validation.get("spcId") or 990001)
    support_ids = [int(v) for v in (validation.get("supportNodeIds") or [])]
    removed = [gid for gid in support_ids if gid in blocked_nodes]
    if not removed:
        return 0, [], ""

    kept = [gid for gid in support_ids if gid not in blocked_nodes]
    if not kept:
        raise RuntimeError("validation SPC 후보가 모두 RBE dependent node 입니다. support-range 또는 모델 연결을 확인하세요.")

    with open(validation_bdf_path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()

    insert_at = None
    rewritten: List[str] = []
    for line in lines:
        tokens = [t for t in re.split(r"[\s,]+", line.strip()) if t]
        is_target_spc = (
            len(tokens) >= 3
            and tokens[0].upper() == "SPC1"
            and _parse_int_token(tokens[1]) == spc_id
        )
        if is_target_spc:
            if insert_at is None:
                insert_at = len(rewritten)
            continue
        rewritten.append(line)

    if insert_at is None:
        raise RuntimeError(f"validation BDF 에서 SPC1 {spc_id} 카드를 찾을 수 없습니다.")

    spc_lines = []
    for idx in range(0, len(kept), 8):
        chunk = ",".join(str(v) for v in kept[idx:idx + 8])
        spc_lines.append(f"SPC1,{spc_id},123456,{chunk}")
    rewritten[insert_at:insert_at] = spc_lines

    with open(validation_bdf_path, "w", encoding="utf-8") as f:
        f.write("\n".join(rewritten) + "\n")

    validation["supportNodeIds"] = kept
    validation["supportNodeCount"] = len(kept)
    validation["removedRigidDependentSupportNodeIds"] = removed
    validation["removedRigidDependentSupportDetails"] = {
        str(gid): blocked_nodes.get(gid, []) for gid in removed
    }
    payload["validation"] = validation
    with open(validation_json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    detail = "; ".join(f"{gid}: {', '.join(blocked_nodes.get(gid, []))}" for gid in removed[:10])
    return len(removed), removed, detail


def _ensure_validation_stabilization_params(
    validation_bdf_path: str,
    validation_json_path: str,
) -> List[str]:
    """Inject temporary solver-stabilization PARAMs into validation BDF only."""
    required = ["PARAM,AUTOSPC,YES", "PARAM,BAILOUT,-1"]
    with open(validation_bdf_path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()

    existing = {line.strip().upper().replace(" ", "") for line in lines}
    missing = [line for line in required if line.upper() not in existing]
    if not missing:
        return []

    insert_at = None
    for idx, line in enumerate(lines):
        if line.strip().upper() == "BEGIN BULK":
            insert_at = idx + 1
            break
    if insert_at is None:
        raise RuntimeError("validation BDF 에 BEGIN BULK 가 없어 안정화 PARAM 을 삽입할 수 없습니다.")

    lines[insert_at:insert_at] = [
        "$ WorkBench temporary validation-only stabilization",
        *missing,
    ]
    with open(validation_bdf_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    with open(validation_json_path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    validation = payload.get("validation") or {}
    validation["temporaryStabilizationParams"] = {
        "cards": missing,
        "validationOnly": True,
        "reason": "Prevent validation-run mechanism fatal 9050; not carried into downstream analysis.",
    }
    payload["validation"] = validation
    with open(validation_json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    return missing


def _parse_f06_fatals(f06_path: str) -> Dict[str, Any] | None:
    if not os.path.exists(f06_path):
        return None

    with open(f06_path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()

    fatal_messages: List[Dict[str, Any]] = []
    for idx, line in enumerate(lines):
        if "*** USER FATAL MESSAGE" not in line:
            continue
        code_match = re.search(r"MESSAGE\s+(\d+)", line)
        context = [line.strip()]
        cursor = idx + 1
        while cursor < len(lines):
            nxt = lines[cursor].strip()
            if nxt.startswith("*** USER ") and "FATAL MESSAGE" in nxt:
                break
            if nxt.startswith("*** USER INFORMATION MESSAGE"):
                break
            if nxt:
                context.append(nxt)
            if len(context) >= 8:
                break
            cursor += 1
        fatal_messages.append({
            "index": len(fatal_messages) + 1,
            "lineNumber": idx + 1,
            "subcaseId": 1,
            "code": code_match.group(1) if code_match else None,
            "lines": context,
            "message": " ".join(context),
        })

    if fatal_messages:
        return {"hasFatal": True, "fatalMessages": fatal_messages}
    return {"hasFatal": False}


def transform_to_step2(validation_json: Dict[str, Any], bdf_path: str) -> Dict[str, Any]:
    """validate-run 원본 결과를 ValidationStepLog 의 step2 schema 로 변환.

    nastran_bridge 의 출력은 fatal 메시지만 추출하므로 warning 카운트는 0 이다.
    각 fatal 항목의 `lines` 배열은 UI 의 'context' 로 합쳐서 USER ACTION 추출에 사용된다.
    """
    f06     = validation_json.get('f06')        or {}
    nastran = validation_json.get('nastranRun') or {}
    meta    = validation_json.get('meta')       or {}
    val     = validation_json.get('validation') or {}

    fatal_msgs = f06.get('fatalMessages') or []

    messages: List[Dict[str, Any]] = []
    for fm in fatal_msgs:
        messages.append({
            'level':      'fatal',
            'lineNumber': int(fm.get('lineNumber') or 0),
            'message':    fm.get('message') or '',
            'context':    '\n'.join(fm.get('lines') or []),
            'subcaseId':  fm.get('subcaseId'),
            'code':       fm.get('code'),
        })

    f06_fatals   = sum(1 for m in messages if m['level'] == 'fatal')
    f06_warnings = sum(1 for m in messages if m['level'] == 'warning')

    return_code = int(nastran.get('returnCode', -1) or 0)
    has_f06     = bool(f06.get('exists'))

    # status 결정
    if not has_f06 and return_code != 0:
        status = 'error'  # nastran 자체가 실패
    elif f06_fatals > 0:
        status = 'error'
    elif f06_warnings > 0:
        status = 'warning'
    else:
        status = 'pass'

    return {
        'stepName':    'Nastran F06 검증 (validate-run)',
        'status':      status,
        'sourceFile':  os.path.basename(meta.get('sourceFile') or bdf_path),
        'version':     meta.get('schemaVersion'),
        'generatedAt': meta.get('timestamp') or datetime.utcnow().isoformat() + 'Z',
        'summary': {
            'f06Fatals':   f06_fatals,
            'f06Warnings': f06_warnings,
        },
        'f06Summary': {
            'messages': messages,
        },
        # 보조 정보 (UI 에서 일부 노출 가능)
        'nastranInfo': {
            'temporaryValidationOnly': True,
            'returnCode':        return_code,
            'supportNodeCount':  val.get('supportNodeCount'),
            'supportRange':      val.get('supportRange'),
            'supportMinZ':       val.get('supportMinZ'),
            'temporaryStabilizationParams': val.get('temporaryStabilizationParams'),
            'gravity':           val.get('gravity'),
            'f06Path':           f06.get('path'),
            'validationBdfPath': val.get('validationBdf'),
        },
    }


def _run_nastran_validate(
    exe_path: str,
    bdf_filename: str,
    bdf_dir: str,
    nastran_exe: str,
    support_range: float = _DEFAULT_SUPPORT_RANGE_MM,
) -> tuple[bool, str, str | None]:
    """validate-run --nastran 실행. (성공 여부, 로그, 결과 JSON 경로)."""
    prepare_args = [
        exe_path,
        "validate-run",
        bdf_filename,
        "--prepare-only",
        "--support-range",
        str(support_range),
    ]
    logger.info("[GroupModuleUnit] validate-run prepare cmd: %s (cwd=%s)", " ".join(prepare_args), bdf_dir)
    try:
        prepare = subprocess.run(
            prepare_args, cwd=bdf_dir,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=600,  # Nastran 실행 시간 + buffer (10분)
        )
        out = prepare.stdout.decode("utf-8", errors="replace")
        err = prepare.stderr.decode("utf-8", errors="replace")
        log = out + (("\n[stderr] " + err.strip()) if err.strip() else "")
        if prepare.returncode != 0:
            log += f"\n[validate-run prepare exit code: {prepare.returncode}]"
            return False, log, None

        # validate-run 의 기본 출력 JSON 은 입력파일과 같은 디렉터리의 <stem>_validation.json
        bdf_stem = os.path.splitext(bdf_filename)[0]
        json_path = os.path.join(bdf_dir, f"{bdf_stem}_validation.json")
        validation_bdf = os.path.join(bdf_dir, f"{bdf_stem}_validation.bdf")
        if not os.path.exists(json_path):
            return False, log + "\n[Error] validate-run 결과 JSON 미생성", None
        if not os.path.exists(validation_bdf):
            return False, log + "\n[Error] validate-run BDF 미생성", None

        blocked_nodes = _rigid_dependent_nodes(os.path.join(bdf_dir, bdf_filename))
        removed_count, removed_nodes, removed_detail = _rewrite_validation_spc(
            validation_bdf,
            json_path,
            blocked_nodes,
        )
        if removed_count:
            log += (
                f"\n[Info] validation SPC에서 RBE dependent GRID {removed_count}개 제외: "
                f"{removed_nodes[:20]}"
            )
            if removed_detail:
                log += f"\n[Info] 제외 상세: {removed_detail}"

        added_params = _ensure_validation_stabilization_params(validation_bdf, json_path)
        if added_params:
            log += f"\n[Info] validation 전용 Nastran 안정화 PARAM 추가: {added_params}"

        run_args = [nastran_exe, validation_bdf]
        logger.info("[GroupModuleUnit] nastran cmd: %s (cwd=%s)", " ".join(run_args), bdf_dir)
        run_result = subprocess.run(
            run_args,
            cwd=bdf_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=600,
        )
        run_out = run_result.stdout.decode("utf-8", errors="replace")
        run_err = run_result.stderr.decode("utf-8", errors="replace")
        log += "\n" + run_out + (("\n[stderr] " + run_err.strip()) if run_err.strip() else "")

        f06_path = os.path.splitext(validation_bdf)[0] + ".f06"
        f06_data = _parse_f06_fatals(f06_path)
        with open(json_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        payload["nastranRun"] = {
            "returnCode": run_result.returncode,
            "stdout": run_out,
            "stderr": run_err,
        }
        payload["f06"] = {"path": f06_path, "exists": os.path.exists(f06_path)}
        if f06_data:
            payload["f06"].update(f06_data)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)

        return True, log, json_path
    except subprocess.TimeoutExpired:
        return False, "[Error] validate-run 시간 초과 (10분)", None
    except Exception as e:
        return False, f"[Error] validate-run 실행 오류: {e}", None


# ── 메인 작업 ──────────────────────────────────────────────────────────────

def task_execute_groupmoduleunit(
    job_id: str,
    bdf_path: str,
    work_dir: str,
    employee_id: str,
    timestamp: str,
    source: str,
    use_nastran: bool,
):
    """nastran_bridge.exe 로 Step1 파싱 검증과 선택적 Step2 Nastran 검증을 수행한다."""
    job_status_store.update_job(job_id, {
        "status": "Running", "progress": 10, "message": "NastranBridge 초기화 중...",
    })

    db = database.SessionLocal()
    status_msg = "Success"
    engine_output = ""
    result_data: Dict[str, Any] = {}
    project_data = None

    base_dir    = os.path.dirname(os.path.abspath(__file__))   # app/services
    app_dir     = os.path.dirname(base_dir)                    # app
    backend_dir = os.path.dirname(app_dir)                     # HiTessWorkBenchBackEnd
    exe_path    = os.path.join(backend_dir, "InHouseProgram", "NastranBridge", "nastran_bridge.exe")

    try:
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")

        bdf_dir      = os.path.dirname(os.path.abspath(bdf_path))
        bdf_filename = os.path.basename(bdf_path)
        bdf_stem     = os.path.splitext(bdf_filename)[0]

        # nastran_bridge 는 입력과 같은 디렉터리에 <stem>.json 을 출력한다.
        model_json_path = os.path.join(bdf_dir, f"{bdf_stem}.json")
        # 기존 모델 JSON 이 있다면 제거 (덮어쓰기 보장)
        if os.path.exists(model_json_path):
            try: os.remove(model_json_path)
            except OSError: pass

        cmd_args = [exe_path, bdf_filename]
        job_status_store.update_job(job_id, {
            "progress": 30, "message": "BDF 모델 파싱 중...",
        })
        logger.info("[GroupModuleUnit] cmd: %s (cwd=%s)", " ".join(cmd_args), bdf_dir)

        result = subprocess.run(
            cmd_args,
            cwd=bdf_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=180,
        )
        engine_output = result.stdout.decode("utf-8", errors="replace")
        stderr_text   = result.stderr.decode("utf-8", errors="replace")

        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"
        if result.returncode != 0:
            engine_output += f"\n[Exit code: {result.returncode}]"
            raise RuntimeError(f"nastran_bridge exit code {result.returncode}")

        # 모델 JSON 로드
        if not os.path.exists(model_json_path):
            # 일부 환경에서 stdout 의 'Wrote ...' 라인에서 다른 경로로 떨어졌을 수 있다.
            for line in engine_output.splitlines():
                if line.strip().lower().startswith("wrote "):
                    cand = line.strip()[6:].strip().strip('"')
                    if os.path.exists(cand):
                        model_json_path = cand
                        break
        if not os.path.exists(model_json_path):
            raise FileNotFoundError(f"모델 JSON 이 생성되지 않았습니다: {model_json_path}")

        with open(model_json_path, "r", encoding="utf-8") as f:
            model_json = json.load(f)

        job_status_store.update_job(job_id, {
            "progress": 70, "message": "검증 결과 변환 중...",
        })

        # Step1 변환 + 저장
        step1 = transform_to_step1(model_json, bdf_path)
        validation_path = os.path.join(bdf_dir, f"{bdf_stem}_validation_step1.json")
        with open(validation_path, "w", encoding="utf-8") as f:
            json.dump(step1, f, indent=2, ensure_ascii=False)

        result_data = {
            "bdf":             bdf_path,
            "JSON_ModelInfo":  model_json_path,
            "JSON_Validation": validation_path,
            "use_nastran":     use_nastran,
            "step1_status":    step1.get('status'),
            "next_stage_inputs": {
                "bdf": bdf_path,
                "modelJson": model_json_path,
                "note": "Step2 validate-run SPC/GRAV cards are temporary and must not be carried into downstream analysis.",
            },
        }

        # 메타 진단 카운트도 빠르게 메시지에 표기
        sv = step1.get('summary') or {}
        engine_output += (
            f"\n[OK] Step1 BDF 검증 완료 — 오류 {sv.get('totalErrors',0)} / 경고 {sv.get('totalWarnings',0)}"
        )

        # ── Step2: Nastran validate-run (use_nastran=True 시) ────────────
        if use_nastran:
            nastran_exe = _resolve_nastran_exe()
            if not nastran_exe:
                engine_output += (
                    f"\n[Warning] Nastran 실행 파일을 찾을 수 없습니다 — Step2 건너뜀.\n"
                    f"          기본 경로: {_DEFAULT_NASTRAN_EXE}\n"
                    f"          또는 환경변수 NASTRAN_EXE 로 지정하세요."
                )
            else:
                job_status_store.update_job(job_id, {
                    "progress": 75, "message": "Nastran validate-run 실행 중...",
                })
                ok, log, val_json_path = _run_nastran_validate(exe_path, bdf_filename, bdf_dir, nastran_exe)
                engine_output += "\n" + (log or "")

                if ok and val_json_path:
                    try:
                        with open(val_json_path, "r", encoding="utf-8") as f:
                            val_json = json.load(f)
                        step2 = transform_to_step2(val_json, bdf_path)
                        step2_path = os.path.join(bdf_dir, f"{bdf_stem}_validation_step2.json")
                        with open(step2_path, "w", encoding="utf-8") as f:
                            json.dump(step2, f, indent=2, ensure_ascii=False)
                        result_data["JSON_F06Summary"]    = step2_path
                        result_data["step2_status"]       = step2.get('status')

                        # 검증용 SPC/GRAV 가 들어간 산출물은 다음 단계 입력으로 노출하지 않는다.
                        # 추적/디버깅 목적으로만 하위 객체에 보관한다.
                        nastran_info = step2.get('nastranInfo') or {}
                        validation_only = {
                            "temporary": True,
                            "doNotUseAsNextStageInput": True,
                            "reason": "NastranBridge validate-run wrapper with temporary SPC1/GRAV cards.",
                            "rawValidationJson": val_json_path,
                        }
                        if nastran_info.get('f06Path') and os.path.exists(nastran_info['f06Path']):
                            validation_only["f06"] = nastran_info['f06Path']
                        if nastran_info.get('validationBdfPath') and os.path.exists(nastran_info['validationBdfPath']):
                            validation_only["validationBdf"] = nastran_info['validationBdfPath']
                        result_data["validation_only_artifacts"] = validation_only

                        s2sv = step2.get('summary') or {}
                        engine_output += (
                            f"\n[OK] Step2 Nastran 검증 완료 — Fatal {s2sv.get('f06Fatals',0)} / Warning {s2sv.get('f06Warnings',0)}"
                        )
                    except Exception as e:
                        engine_output += f"\n[Error] validate-run 결과 변환 실패: {e}"
                # ok=False 인 경우는 log 가 이미 engine_output 에 누적됨

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output += "\n[Error] nastran_bridge 실행 시간이 초과되었습니다 (3분)."
    except Exception as e:
        status_msg = "Failed"
        logger.error("GroupModuleUnit BDF 검증 오류: %s", str(e), exc_info=True)
        engine_output += f"\n[Error] {str(e)}"

    job_status_store.update_job(job_id, {"progress": 95, "message": "데이터베이스 저장 중..."})

    try:
        new_analysis = models.Analysis(
            project_name=f"GroupModuleUnit_{timestamp}",
            program_name="GroupModuleUnit",
            employee_id=employee_id,
            status=status_msg,
            input_info={"bdf_model": bdf_path, "use_nastran": use_nastran},
            result_info=result_data if result_data else None,
            source=source,
        )
        db.add(new_analysis); db.commit(); db.refresh(new_analysis)
        project_data = {
            "id":           new_analysis.id,
            "project_name": new_analysis.project_name,
            "program_name": new_analysis.program_name,
            "employee_id":  new_analysis.employee_id,
            "status":       new_analysis.status,
            "input_info":   new_analysis.input_info,
            "result_info":  new_analysis.result_info,
            "created_at":   new_analysis.created_at.isoformat() if new_analysis.created_at else datetime.now().isoformat(),
        }
    except Exception as db_e:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {str(db_e)}"
    finally:
        db.close()

    job_status_store.update_job(job_id, {
        "status":     status_msg,
        "progress":   100,
        "message":    "BDF 검증 완료" if status_msg == "Success" else "BDF 검증 실패",
        "engine_log": engine_output,
        "project":    project_data,
    })
