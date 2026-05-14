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

from .. import database, models
from ..services.job_manager import job_status_store

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
#   ELEMENT  FIBRE     STRESSES IN ELEMENT COORD SYSTEM      PRINCIPAL STRESSES (ZERO SHEAR)      MAX
#     ID    DISTANCE   NORMAL-X   NORMAL-Y   SHEAR-XY   ANGLE   MAJOR     MINOR   SHEAR    VON MISES
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
                       "minorPrincipal": -10.0, "shearMax": 50.0}, ...],
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
        try:
            eid = int(tokens[0])
        except ValueError:
            # 두 번째 fiber 행 — 가장 최근 pending 의 마지막 element 에 적용
            try:
                _ = float(tokens[0])
            except ValueError:
                continue
            if not pending:
                continue
            last_eid = next(reversed(pending))
            _absorb_fiber_row(pending[last_eid], tokens, lead_has_id=False)
            continue

        rec = pending.setdefault(eid, {})
        _absorb_fiber_row(rec, tokens, lead_has_id=True)

    flush_pending()
    return {"subcases": subcases}


def _absorb_fiber_row(rec: Dict[str, Any], tokens: List[str], lead_has_id: bool) -> None:
    """한 fiber 행의 stress 값을 누적해 rec 에 반영.

    F06 레이아웃 (CQUAD4 centroid only):
      id  fibDist  nrmX  nrmY  shrXY  angle  major  minor  shrMax  vonMises
       0       1     2     3      4      5      6      7       8         9   (lead_has_id=True)
              0     1     2      3      4      5      6       7         8   (lead_has_id=False)
    두 fiber 중 von Mises 절대값이 큰 쪽을 대표값으로 보존.
    """
    base = 1 if lead_has_id else 0
    try:
        major = _f06_float(tokens[base + 5])
        minor = _f06_float(tokens[base + 6])
        shear_max = _f06_float(tokens[base + 7])
        von_mises = _f06_float(tokens[base + 8])
    except IndexError:
        return

    prev_vm = rec.get("vonMises")
    if prev_vm is None or (von_mises is not None and abs(von_mises) > abs(prev_vm)):
        rec["vonMises"] = von_mises
        rec["majorPrincipal"] = major
        rec["minorPrincipal"] = minor
        rec["shearMax"] = shear_max


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
    job_status_store.update_job(job_id, {
        "status": "Running", "progress": 5, "message": "초기화 중...",
    })

    db = database.SessionLocal()
    status_msg = "Success"
    engine_output = ""
    result_data: Dict[str, Any] = {}
    project_data: Optional[Dict[str, Any]] = None

    base_dir    = os.path.dirname(os.path.abspath(__file__))   # app/services
    app_dir     = os.path.dirname(base_dir)                    # app
    backend_dir = os.path.dirname(app_dir)                     # HiTessWorkBenchBackEnd
    bridge_exe  = os.path.join(backend_dir, "InHouseProgram", "NastranBridge", "nastran_bridge.exe")

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

        job_status_store.update_job(job_id, {"progress": 30, "message": "Nastran 실행 중..."})
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
        job_status_store.update_job(job_id, {"progress": 70, "message": "F06 파싱 (displacement)..."})
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
            job_status_store.update_job(job_id, {"progress": 85, "message": "F06 파싱 (shell stress)..."})
            with open(f06_path, "r", encoding="utf-8", errors="replace") as f:
                f06_lines = f.read().splitlines()
            shell_stress = _parse_shell_stress(f06_lines)

            # 4) Studio 시각화용 통합 JSON 작성
            analysis_results = bridge_payload.get("analysisResults", {})
            subcase_list = analysis_results.get("subcases", [])

            unified_subcases: List[Dict[str, Any]] = []
            for sc in subcase_list:
                sc_id = str(sc.get("id", 1))
                shell_for_sc = shell_stress["subcases"].get(sc_id, {})
                unified_subcases.append({
                    "id":            sc.get("id", 1),
                    "displacements": sc.get("displacements", []),
                    "shellStresses": {
                        "quad4": shell_for_sc.get("quad4", []),
                        "tria3": shell_for_sc.get("tria3", []),
                    },
                    "cbarStresses":  sc.get("cbarStresses", []),
                    "cbeamStresses": sc.get("cbeamStresses", []),
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
                f"maxDisp={summary.get('maxDisplacementMm', 0):.4g} mm, "
                f"maxVonMises={summary.get('maxVonMisesMPa', 0):.4g} MPa"
            )

    except subprocess.TimeoutExpired as te:
        status_msg = "Failed"
        engine_output += f"\n[Error] 시간 초과: {te}"
    except Exception as e:
        status_msg = "Failed"
        logger.error("PlateStructure 오류: %s", str(e), exc_info=True)
        engine_output += f"\n[Error] {str(e)}"

    job_status_store.update_job(job_id, {"progress": 95, "message": "데이터베이스 저장 중..."})

    try:
        new_analysis = models.Analysis(
            project_name=f"PlateStructure_{timestamp}",
            program_name="PlateStructureAnalysis",
            employee_id=employee_id,
            status=status_msg,
            input_info={"bdf_path": bdf_path},
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
            "created_at":   new_analysis.created_at.isoformat()
                            if new_analysis.created_at
                            else datetime.now().isoformat(),
        }
    except Exception as db_e:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {str(db_e)}"
    finally:
        db.close()

    job_status_store.update_job(job_id, {
        "status":     status_msg,
        "progress":   100,
        "message":    "Plate 구조 해석 완료" if status_msg == "Success" else "Plate 구조 해석 실패",
        "engine_log": engine_output,
        "project":    project_data,
    })


def _summarize(unified_subcases: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Studio 헤더 표시용 — 첫 subcase 기준 최대치/카운트."""
    if not unified_subcases:
        return {"subcaseCount": 0, "nodeCount": 0, "shellElementCount": 0,
                "maxDisplacementMm": 0.0, "maxVonMisesMPa": 0.0}

    sc0 = unified_subcases[0]
    disps = sc0.get("displacements", [])
    quads = sc0.get("shellStresses", {}).get("quad4", [])
    trias = sc0.get("shellStresses", {}).get("tria3", [])

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

    return {
        "subcaseCount":       len(unified_subcases),
        "nodeCount":          len(disps),
        "shellElementCount":  len(quads) + len(trias),
        "maxDisplacementMm":  max_disp,
        "maxVonMisesMPa":     max_vm,
    }
