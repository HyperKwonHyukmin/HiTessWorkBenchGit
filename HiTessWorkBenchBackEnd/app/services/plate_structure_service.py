"""Plate Structure Analysis 서비스 — Plate Studio 가 내보낸 BDF 의 Nastran SOL 101 해석.

흐름:
  1) 사용자 PC 의 Plate Studio 가 BDF 본문을 업로드 (router 가 work_dir 에 저장)
  2) 본 서비스가 Nastran 을 실행해 F06 생성
  3) NastranBridge (nastran_bridge.exe) 로 F06 → displacement / member stress JSON 변환
  4) Plate 의 shell(CQUAD4/CTRIA3) stress 는 NastranBridge 가 지원하지 않으므로
     본 서비스 내부 F06 shell stress 파서로 추출
  5) Studio 가 시각화에 바로 쓸 수 있는 plate_result.json 으로 통합 저장

산출 파일 (work_dir):
  <bdfStem>.bdf                  : 원본 BDF (router 가 저장)
  <bdfStem>.f06                  : Nastran 출력
  <bdfStem>_results.json         : NastranBridge 출력 (displacement + 1D stress)
  <bdfStem>_plate_result.json    : Studio 시각화용 통합 결과 (displacement + shell stress)
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from datetime import datetime
from typing import Any, Dict, List, Optional

from .analysis_runner import (
    get_backend_dir,
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)

logger = logging.getLogger(__name__)

# 사내 표준 Nastran 경로 (NASTRAN_EXE 환경변수로 override 가능 — unit_structural_service 와 동일 규약)
_DEFAULT_NASTRAN_EXE = r"C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe"


def _resolve_nastran_exe() -> Optional[str]:
    env = os.environ.get("NASTRAN_EXE", "").strip().strip('"')
    if env and os.path.exists(env):
        return env
    if os.path.exists(_DEFAULT_NASTRAN_EXE):
        return _DEFAULT_NASTRAN_EXE
    return None


def _decode_completed(proc: subprocess.CompletedProcess) -> str:
    """cp949/utf-8 fallback decode — 사내 Nastran 한글 출력 보존."""
    from ._subproc_decode import safe_decode
    out = safe_decode(proc.stdout)
    err = safe_decode(proc.stderr)
    if err.strip():
        out += "\n[stderr] " + err.strip()
    return out


# ────────────────────────────────────────────────────────────────────────────
# F06 Shell(CQUAD4 / CTRIA3) stress 파서
# NastranBridge 가 shell stress 를 미지원하므로 본 서비스에서 직접 처리한다.
#
# F06 표준 형식 (요약):
#   `S T R E S S E S   I N   Q U A D R I L A T E R A L   E L E M E N T S   ( Q U A D 4 )`
#   ELEMENT  FIBRE     STRESSES IN ELEMENT COORD SYSTEM      PRINCIPAL STRESSES (ZERO SHEAR)
#     ID    DISTANCE   NORMAL-X   NORMAL-Y   SHEAR-XY   ANGLE   MAJOR     MINOR   VON MISES
#
# CQUAD4 는 두 fiber(상/하면)를 각각 한 줄로 출력. centroid only 모드 가정.
# CTRIA3 도 동일 컬럼 레이아웃. SUBCASE 구분은 'SUBCASE  N' 헤더.
# ────────────────────────────────────────────────────────────────────────────

_SUBCASE_RX = re.compile(r"SUBCASE\s+(\d+)")
_HDR_QUAD4 = "Q U A D R I L A T E R A L"
_HDR_TRIA3 = "T R I A N G U L A R"
_HDR_STRESS_KEY = "S T R E S S"


def _f06_float(token: str) -> Optional[float]:
    """Nastran F06 의 1.234567E+02 형식 또는 일반 float 토큰을 안전하게 변환."""
    s = token.strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_shell_stress(lines: List[str]) -> Dict[str, Any]:
    """F06 lines 에서 CQUAD4 / CTRIA3 stress 를 element 단위로 집계.

    각 element 의 상/하 fiber stress(Von Mises 등) 중 절대값 큰 쪽을 대표값으로 채택.
    반환:
      {
        "subcases": {
          "1": {
            "quad4": [{"id": 1001, "vonMises": 123.4, "majorPrincipal": 80.0,
                       "minorPrincipal": -10.0}, ...],
            "tria3": [...]
          }, ...
        }
      }
    """
    subcases: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    current_subcase = "1"
    current_kind: Optional[str] = None  # 'quad4' | 'tria3' | None
    # 같은 element 의 두 fiber 줄을 합치기 위한 임시 보관소
    pending: Dict[int, Dict[str, Any]] = {}

    def flush_pending():
        if not current_kind or not pending:
            return
        bucket = subcases.setdefault(current_subcase, {}).setdefault(current_kind, [])
        for eid, rec in pending.items():
            bucket.append({"id": eid, **rec})
        pending.clear()

    for raw in lines:
        # SUBCASE 변경 추적
        m = _SUBCASE_RX.search(raw)
        if m:
            new_sc = m.group(1)
            if new_sc != current_subcase:
                flush_pending()
                current_subcase = new_sc

        # 섹션 헤더 감지
        if _HDR_STRESS_KEY in raw and _HDR_QUAD4 in raw:
            flush_pending()
            current_kind = "quad4"
            continue
        if _HDR_STRESS_KEY in raw and _HDR_TRIA3 in raw:
            flush_pending()
            current_kind = "tria3"
            continue

        # 다른 섹션 전환 시 종료
        if current_kind and ("E L E M E N T S" in raw or "V E C T O R" in raw):
            if (_HDR_QUAD4 not in raw) and (_HDR_TRIA3 not in raw):
                flush_pending()
                current_kind = None

        if not current_kind:
            continue

        tokens = raw.split()
        if not tokens:
            continue
        # Nastran F06 는 element 가 있는 첫 fiber 행 앞에 page marker '0' 을
        # 붙여 `0 <eid> <fiber distance> ...` 형식으로 출력할 수 있다.
        if tokens[0] == "0" and len(tokens) >= 10:
            try:
                eid = int(tokens[1])
            except ValueError:
                continue
            if eid <= 0:
                continue
            rec = pending.setdefault(eid, {})
            if not _absorb_fiber_row(rec, tokens, value_start=2):
                pending.pop(eid, None)
            continue

        try:
            eid = int(tokens[0])
        except ValueError:
            # 두 번째 fiber 행 — 가장 최근 pending 의 마지막 element 에 적용
            if _f06_float(tokens[0]) is None or not pending:
                continue
            last_eid = next(reversed(pending))
            _absorb_fiber_row(pending[last_eid], tokens, value_start=0)
            continue

        if eid <= 0 or len(tokens) < 9 or _f06_float(tokens[1]) is None:
            continue
        rec = pending.setdefault(eid, {})
        if not _absorb_fiber_row(rec, tokens, value_start=1):
            pending.pop(eid, None)

    flush_pending()
    return {"subcases": subcases}


def _absorb_fiber_row(rec: Dict[str, Any], tokens: List[str], value_start: int) -> bool:
    """한 fiber 행의 stress 값을 누적해 rec 에 반영.

    F06 레이아웃 (CQUAD4 centroid only):
      page0  id  fibDist  nrmX  nrmY  shrXY  angle  major  minor  vonMises
         0   1       2     3     4      5      6      7      8         9
      id  fibDist  nrmX  nrmY  shrXY  angle  major  minor  vonMises
       0       1     2     3      4      5      6      7         8
          fibDist  nrmX  nrmY  shrXY  angle  major  minor  vonMises
              0     1     2      3      4      5      6         7
    두 fiber 중 von Mises 절대값이 큰 쪽을 대표값으로 보존.
    """
    try:
        fiber_distance = _f06_float(tokens[value_start])
        normal_x = _f06_float(tokens[value_start + 1])
        normal_y = _f06_float(tokens[value_start + 2])
        shear_xy = _f06_float(tokens[value_start + 3])
        angle = _f06_float(tokens[value_start + 4])
        major = _f06_float(tokens[value_start + 5])
        minor = _f06_float(tokens[value_start + 6])
        von_mises = _f06_float(tokens[value_start + 7])
    except IndexError:
        return False

    if von_mises is None:
        return False

    prev_vm = rec.get("vonMises")
    if prev_vm is None or (von_mises is not None and abs(von_mises) > abs(prev_vm)):
        rec["vonMises"] = von_mises
        rec["majorPrincipal"] = major
        rec["minorPrincipal"] = minor
        rec["normalX"] = normal_x
        rec["normalY"] = normal_y
        rec["shearXY"] = shear_xy
        rec["fiberDistance"] = fiber_distance
        rec["angle"] = angle
    return True


_HDR_CBEAM_STRESS = "S T R E S S E S   I N   B E A M   E L E M E N T S"
_HDR_CBEAM = "C B E A M"


def _parse_cbeam_stress(lines: List[str]) -> Dict[str, Any]:
    """F06 lines 에서 CBEAM stress 테이블을 직접 파싱한다.

    Nastran CBEAM stress 출력은 element id 행과 그 뒤의 grid/stat-distance 행으로
    분리된다. 한 element 가 페이지 경계를 넘어갈 수 있으므로 current element 를
    유지하면서 다음 페이지의 연속 row 까지 흡수한다.
    """
    subcases: Dict[str, List[Dict[str, Any]]] = {}
    current_subcase = "1"
    in_section = False
    current_eid: Optional[int] = None

    def append_row(tokens: List[str]) -> None:
        nonlocal current_eid
        if current_eid is None or len(tokens) < 8:
            return
        try:
            grid_id = int(tokens[0])
        except ValueError:
            return
        stat_dist = _f06_float(tokens[1])
        if stat_dist is None:
            return

        vals = [_f06_float(tok) for tok in tokens[2:10]]
        while len(vals) < 8:
            vals.append(None)
        sxc, sxd, sxe, sxf, smax, smin, ms_t, ms_c = vals[:8]
        if abs(stat_dist) < 1e-9:
            end = "A"
        elif abs(stat_dist - 1.0) < 1e-9:
            end = "B"
        else:
            end = f"{stat_dist:g}"

        subcases.setdefault(current_subcase, []).append({
            "subcaseId": int(current_subcase),
            "elementId": current_eid,
            "gridId": grid_id,
            "end": end,
            "sXC": sxc,
            "sXD": sxd,
            "sXE": sxe,
            "sXF": sxf,
            "sMax": smax,
            "sMin": smin,
            "mSTension": ms_t,
            "mSCompression": ms_c,
        })

    for raw in lines:
        m = _SUBCASE_RX.search(raw)
        if m:
            current_subcase = m.group(1)

        if _HDR_CBEAM_STRESS in raw and _HDR_CBEAM in raw:
            was_in_section = in_section
            in_section = True
            if not was_in_section:
                current_eid = None
            continue

        if in_section and _HDR_STRESS_KEY in raw and _HDR_CBEAM not in raw:
            in_section = False
            current_eid = None
            continue
        if in_section and "F O R C E S   I N" in raw:
            in_section = False
            current_eid = None
            continue

        if not in_section:
            continue

        tokens = raw.split()
        if not tokens:
            continue

        # Element marker line: "0       361"
        if tokens[0] == "0" and len(tokens) >= 2:
            try:
                current_eid = int(tokens[1])
            except ValueError:
                pass
            continue

        append_row(tokens)

    return {"subcases": subcases}


# ────────────────────────────────────────────────────────────────────────────
# 메인 태스크
# ────────────────────────────────────────────────────────────────────────────

def task_execute_plate_structure(
    job_id: str,
    bdf_path: str,
    work_dir: str,
    employee_id: str,
    timestamp: str,
    source: str,
):
    """Plate Studio BDF → Nastran SOL 101 → displacement + shell stress JSON."""
    mark_running(job_id, "초기화 중...", progress=5)

    status_msg = "Success"
    engine_output = ""
    result_data: Dict[str, Any] = {}

    bridge_exe = os.path.join(get_backend_dir(), "InHouseProgram", "NastranBridge", "nastran_bridge.exe")

    try:
        if not os.path.exists(bdf_path):
            raise FileNotFoundError(f"BDF 가 존재하지 않습니다: {bdf_path}")
        if not os.path.exists(bridge_exe):
            raise FileNotFoundError(f"NastranBridge 실행 파일을 찾을 수 없습니다: {bridge_exe}")

        bdf_dir      = os.path.dirname(os.path.abspath(bdf_path))
        bdf_filename = os.path.basename(bdf_path)
        bdf_stem     = os.path.splitext(bdf_filename)[0]

        f06_path           = os.path.join(bdf_dir, f"{bdf_stem}.f06")
        bridge_result_json = os.path.join(bdf_dir, f"{bdf_stem}_results.json")
        plate_result_json  = os.path.join(bdf_dir, f"{bdf_stem}_plate_result.json")

        # 기존 산출물 정리 (덮어쓰기 보장)
        for stale in (f06_path, bridge_result_json, plate_result_json):
            if os.path.exists(stale):
                try: os.remove(stale)
                except OSError: pass

        # 1) Nastran SOL 101 실행
        nastran_exe = _resolve_nastran_exe()
        if not nastran_exe:
            raise RuntimeError(
                f"Nastran 실행 파일을 찾을 수 없습니다 — 기본 경로 {_DEFAULT_NASTRAN_EXE} 또는 환경변수 NASTRAN_EXE 를 지정하세요."
            )

        update_progress(job_id, 30, "Nastran 실행 중...")
        nastran_args = [nastran_exe, bdf_filename]
        logger.info("[PlateStructure] nastran cmd: %s (cwd=%s)", " ".join(nastran_args), bdf_dir)
        run = subprocess.run(
            nastran_args, cwd=bdf_dir,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=1800,
        )
        engine_output += _decode_completed(run)
        if run.returncode != 0:
            engine_output += (
                f"\n[Warning] Nastran exit code {run.returncode} — "
                f"F06 결과 신뢰도가 낮을 수 있습니다."
            )
        if not os.path.exists(f06_path):
            raise RuntimeError(f"Nastran F06 파일이 생성되지 않았습니다: {f06_path}")

        # 2) NastranBridge 로 F06 → displacement / 1D stress JSON
        update_progress(job_id, 70, "F06 파싱 (displacement)...")
        bridge_args = [bridge_exe, os.path.basename(f06_path), "-o", os.path.basename(bridge_result_json)]
        logger.info("[PlateStructure] bridge cmd: %s (cwd=%s)", " ".join(bridge_args), bdf_dir)
        bridge = subprocess.run(
            bridge_args, cwd=bdf_dir,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300,
        )
        engine_output += "\n" + _decode_completed(bridge)
        if bridge.returncode != 0:
            raise RuntimeError(f"NastranBridge F06 파싱 실패 (exit={bridge.returncode})")
        if not os.path.exists(bridge_result_json):
            raise RuntimeError(f"NastranBridge 결과 JSON 이 생성되지 않았습니다: {bridge_result_json}")

        with open(bridge_result_json, "r", encoding="utf-8") as f:
            bridge_payload = json.load(f)

        if bridge_payload.get("fatalMessages"):
            engine_output += "\n[Error] F06 fatal — 결과 파싱 불가."
            status_msg = "Failed"
            result_data = {
                "bdfPath":          bdf_path,
                "f06Path":          f06_path,
                "bridgeResultJson": bridge_result_json,
                "fatalMessages":    bridge_payload["fatalMessages"],
            }
        else:
            # 3) Shell(CQUAD4/CTRIA3) stress 직접 파싱
            update_progress(job_id, 85, "F06 파싱 (shell stress)...")
            with open(f06_path, "r", encoding="utf-8", errors="replace") as f:
                f06_lines = f.read().splitlines()
            shell_stress = _parse_shell_stress(f06_lines)
            cbeam_stress = _parse_cbeam_stress(f06_lines)

            # 4) Studio 시각화용 통합 JSON 작성
            analysis_results = bridge_payload.get("analysisResults", {})
            subcase_list = analysis_results.get("subcases", [])

            unified_subcases: List[Dict[str, Any]] = []
            for sc in subcase_list:
                sc_id = str(sc.get("id", 1))
                shell_for_sc = shell_stress["subcases"].get(sc_id, {})
                cbeam_for_sc = cbeam_stress["subcases"].get(sc_id) or sc.get("cbeamStresses", [])
                unified_subcases.append({
                    "id":            sc.get("id", 1),
                    "displacements": sc.get("displacements", []),
                    "shellStresses": {
                        "quad4": shell_for_sc.get("quad4", []),
                        "tria3": shell_for_sc.get("tria3", []),
                    },
                    "cbarStresses":  sc.get("cbarStresses", []),
                    "cbeamStresses": cbeam_for_sc,
                    "crodStresses":  sc.get("crodStresses", []),
                })

            summary = _summarize(unified_subcases)

            plate_payload = {
                "meta": {
                    "bdfFileName":  bdf_filename,
                    "generatedAt":  datetime.now().isoformat(),
                    "subcaseCount": len(unified_subcases),
                },
                "summary":  summary,
                "subcases": unified_subcases,
            }
            with open(plate_result_json, "w", encoding="utf-8") as f:
                json.dump(plate_payload, f, ensure_ascii=False, indent=2)

            result_data = {
                "bdfPath":           bdf_path,
                "f06Path":           f06_path,
                "bridgeResultJson":  bridge_result_json,
                "plateResultJson":   plate_result_json,
                "summary":           summary,
            }
            engine_output += (
                f"\n[OK] Plate 해석 완료 — "
                f"subcases={summary.get('subcaseCount', 0)}, "
                f"nodes={summary.get('nodeCount', 0)}, "
                f"shellElements={summary.get('shellElementCount', 0)}, "
                f"cbeamStressRows={summary.get('cbeamStressRowCount', 0)}, "
                f"maxDisp={summary.get('maxDisplacementMm', 0):.4g} mm, "
                f"maxVonMises={summary.get('maxVonMisesMPa', 0):.4g} MPa, "
                f"maxCbeamStress={summary.get('maxCbeamStressMPa', 0):.4g} MPa"
            )

    except subprocess.TimeoutExpired as te:
        status_msg = "Failed"
        engine_output += f"\n[Error] 시간 초과: {te}"
    except Exception as e:
        status_msg = "Failed"
        logger.error("PlateStructure 오류: %s", str(e), exc_info=True)
        engine_output += f"\n[Error] {str(e)}"

    update_progress(job_id, 95, "데이터베이스 저장 중...")

    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"PlateStructure_{timestamp}",
        program_name="PlateStructureAnalysis",
        employee_id=employee_id,
        status=status_msg,
        input_info={"bdf_path": bdf_path},
        # F06 fatal 케이스에서 status=Failed 라도 result_data 가 채워졌으면 그대로 기록 (기존 동작 보존)
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="Plate 구조 해석 완료",
        failure_message="Plate 구조 해석 실패",
    )


def _summarize(unified_subcases: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Studio 헤더 표시용 — 첫 subcase 기준 최대치/카운트."""
    if not unified_subcases:
        return {"subcaseCount": 0, "nodeCount": 0, "shellElementCount": 0,
                "cbeamStressRowCount": 0, "maxDisplacementMm": 0.0,
                "maxVonMisesMPa": 0.0, "maxCbeamStressMPa": 0.0,
                "maxStressMPa": 0.0}

    sc0 = unified_subcases[0]
    disps = sc0.get("displacements", [])
    quads = sc0.get("shellStresses", {}).get("quad4", [])
    trias = sc0.get("shellStresses", {}).get("tria3", [])
    cbeams = sc0.get("cbeamStresses", [])

    def disp_mag(d: Dict[str, Any]) -> float:
        tx = d.get("t1", d.get("x", 0.0)) or 0.0
        ty = d.get("t2", d.get("y", 0.0)) or 0.0
        tz = d.get("t3", d.get("z", 0.0)) or 0.0
        return (tx * tx + ty * ty + tz * tz) ** 0.5

    max_disp = max((disp_mag(d) for d in disps), default=0.0)
    max_vm = 0.0
    for e in quads + trias:
        v = e.get("vonMises")
        if v is None:
            continue
        if abs(v) > max_vm:
            max_vm = abs(v)
    max_cbeam = 0.0
    for e in cbeams:
        for key in ("sMax", "sMin", "sXC", "sXD", "sXE", "sXF"):
            v = e.get(key)
            if v is None:
                continue
            if abs(v) > max_cbeam:
                max_cbeam = abs(v)

    return {
        "subcaseCount":       len(unified_subcases),
        "nodeCount":          len(disps),
        "shellElementCount":  len(quads) + len(trias),
        "cbeamStressRowCount": len(cbeams),
        "maxDisplacementMm":  max_disp,
        "maxVonMisesMPa":     max_vm,
        "maxCbeamStressMPa":  max_cbeam,
        "maxStressMPa":       max(max_vm, max_cbeam),
    }
