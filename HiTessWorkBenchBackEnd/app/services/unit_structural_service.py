"""Unit 구조 해석 서비스 (Wire 포함 BDF + Nastran 실행 + F06 결과 매핑).

자세 안정성(Stability) 평가가 PASS 된 GroupModuleUnit parent record 를 기준으로
같은 폴더에 wire 포함 lifting BDF 와 Studio 매핑용 nastranResult.json 을 생성한다.

산출 파일 (parent BDF 와 같은 디렉터리):
  - <bdfStem>_stability.json              : Studio 가 업로드한 stability JSON (이미 router 에서 저장됨)
  - <bdfStem>_lifting.bdf                 : nastran_bridge lift-run 산출 BDF
  - <bdfStem>_lifting_meta.json           : ID 충돌 회피 결과/wire 매핑 추적용 메타
  - <bdfStem>_lifting.f06                 : Nastran F06 출력
  - <bdfStem>_lifting_nastranResult.json  : Studio 색맵핑/호버용 결과 정제 JSON

DB 에는 별도의 Analysis record (program_name="UnitStructuralAnalysis") 로 저장하고
input_info.parent_analysis_id 로 GroupModuleUnit 원본을 참조한다.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
from datetime import datetime
from typing import Any, Dict, Optional

from .. import database, models
from ..services.job_manager import job_status_store

logger = logging.getLogger(__name__)

# 사내 표준 Nastran 경로 (없으면 환경변수 NASTRAN_EXE 로 override)
_DEFAULT_NASTRAN_EXE = r"C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe"


def _resolve_nastran_exe() -> Optional[str]:
    env = os.environ.get("NASTRAN_EXE", "").strip().strip('"')
    if env and os.path.exists(env):
        return env
    if os.path.exists(_DEFAULT_NASTRAN_EXE):
        return _DEFAULT_NASTRAN_EXE
    return None


def _decode_completed(proc: subprocess.CompletedProcess) -> str:
    out = proc.stdout.decode("utf-8", errors="replace") if proc.stdout else ""
    err = proc.stderr.decode("utf-8", errors="replace") if proc.stderr else ""
    if err.strip():
        out += "\n[stderr] " + err.strip()
    return out


def task_execute_unit_structural(
    job_id: str,
    parent_analysis_id: int,
    stability_json_path: str,
    safety_factor: float,
    allowable_mpa: float,
    employee_id: str,
    timestamp: str,
    source: str,
):
    """Wire 포함 BDF 빌드 → Nastran SOL 101 → F06 결과 정제까지 실행."""
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
    exe_path    = os.path.join(backend_dir, "InHouseProgram", "NastranBridge", "nastran_bridge.exe")

    try:
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")

        # 1. Parent (GroupModuleUnit) 조회 — BDF 경로 확보
        parent = db.query(models.Analysis).filter(
            models.Analysis.id == parent_analysis_id
        ).first()
        if parent is None:
            raise RuntimeError(f"Parent Analysis (id={parent_analysis_id}) 를 찾을 수 없습니다.")
        if parent.program_name != "GroupModuleUnit":
            raise RuntimeError(
                f"Parent program_name 이 'GroupModuleUnit' 이 아닙니다 (got '{parent.program_name}')."
            )
        if parent.status != "Success":
            raise RuntimeError(f"Parent BDF 검증이 성공 상태가 아닙니다 (status={parent.status}).")

        bdf_path = (parent.input_info or {}).get("bdf_model")
        if not bdf_path or not os.path.exists(bdf_path):
            raise FileNotFoundError(f"Parent BDF 파일을 찾을 수 없습니다: {bdf_path}")
        if not os.path.exists(stability_json_path):
            raise FileNotFoundError(f"stability JSON 을 찾을 수 없습니다: {stability_json_path}")

        bdf_dir      = os.path.dirname(os.path.abspath(bdf_path))
        bdf_filename = os.path.basename(bdf_path)
        bdf_stem     = os.path.splitext(bdf_filename)[0]

        lifting_bdf  = os.path.join(bdf_dir, f"{bdf_stem}_lifting.bdf")
        lifting_meta = os.path.join(bdf_dir, f"{bdf_stem}_lifting_meta.json")
        lifting_f06  = os.path.join(bdf_dir, f"{bdf_stem}_lifting.f06")
        result_json  = os.path.join(bdf_dir, f"{bdf_stem}_lifting_nastranResult.json")

        # 기존 산출물 정리 (덮어쓰기 보장)
        for stale in (lifting_bdf, lifting_meta, lifting_f06, result_json):
            if os.path.exists(stale):
                try: os.remove(stale)
                except OSError: pass

        # 2. lift-run --prepare-only — Wire 포함 BDF + meta 빌드
        job_status_store.update_job(job_id, {"progress": 15, "message": "Wire 포함 BDF 생성 중..."})
        prepare_args = [
            exe_path, "lift-run", bdf_filename,
            "--stability", stability_json_path,
            "-o", lifting_bdf,
            "--meta", lifting_meta,
            "--safety-factor", str(safety_factor),
            "--prepare-only",
        ]
        logger.info("[UnitStructural] prepare cmd: %s (cwd=%s)", " ".join(prepare_args), bdf_dir)
        prepare = subprocess.run(
            prepare_args, cwd=bdf_dir,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300,
        )
        engine_output += _decode_completed(prepare)
        if prepare.returncode != 0:
            raise RuntimeError(f"lift-run prepare exit code {prepare.returncode}")
        if not os.path.exists(lifting_bdf) or not os.path.exists(lifting_meta):
            raise RuntimeError("lifting BDF/meta 가 생성되지 않았습니다.")

        # 3. Nastran SOL 101 실행
        nastran_exe = _resolve_nastran_exe()
        if not nastran_exe:
            raise RuntimeError(
                f"Nastran 실행 파일을 찾을 수 없습니다 — 기본 경로 {_DEFAULT_NASTRAN_EXE} 또는 환경변수 NASTRAN_EXE 를 지정하세요."
            )

        job_status_store.update_job(job_id, {"progress": 40, "message": "Nastran 실행 중..."})
        nastran_args = [nastran_exe, lifting_bdf]
        logger.info("[UnitStructural] nastran cmd: %s (cwd=%s)", " ".join(nastran_args), bdf_dir)
        run = subprocess.run(
            nastran_args, cwd=bdf_dir,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=1800,  # SOL 101 + 모델 크기 고려해 30분 여유
        )
        engine_output += "\n" + _decode_completed(run)
        if not os.path.exists(lifting_f06):
            raise RuntimeError(f"Nastran F06 파일이 생성되지 않았습니다: {lifting_f06}")

        # 4. lift-result — F06 → Studio 매핑 JSON
        job_status_store.update_job(job_id, {"progress": 80, "message": "F06 결과 매핑 중..."})
        result_args = [
            exe_path, "lift-result", lifting_meta,
            "--f06", lifting_f06,
            "-o", result_json,
            "--allowable-mpa", str(allowable_mpa),
        ]
        logger.info("[UnitStructural] result cmd: %s (cwd=%s)", " ".join(result_args), bdf_dir)
        rmap = subprocess.run(
            result_args, cwd=bdf_dir,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300,
        )
        engine_output += "\n" + _decode_completed(rmap)
        if rmap.returncode != 0:
            raise RuntimeError(f"lift-result exit code {rmap.returncode}")
        if not os.path.exists(result_json):
            raise RuntimeError(f"nastranResult JSON 이 생성되지 않았습니다: {result_json}")

        with open(result_json, "r", encoding="utf-8") as f:
            result_payload = json.load(f)

        if result_payload.get("meta", {}).get("hasFatal"):
            engine_output += "\n[Error] F06 fatal — 결과 매핑 불가."
            status_msg = "Failed"

        result_summary = result_payload.get("summary") or {}
        result_data = {
            "parentAnalysisId": parent_analysis_id,
            "bdf":               bdf_path,
            "stabilityJson":     stability_json_path,
            "liftingBdf":        lifting_bdf,
            "liftingMetaJson":   lifting_meta,
            "f06":               lifting_f06,
            "nastranResultJson": result_json,
            "safetyFactor":      safety_factor,
            "allowableMPa":      allowable_mpa,
            "summary":           result_summary,
            "warnings":          result_payload.get("warnings", []),
        }
        engine_output += (
            f"\n[OK] Unit 구조 해석 완료 — "
            f"Members {result_summary.get('memberElementCount', 0)} "
            f"(exceeds {result_summary.get('memberExceedCount', 0)}) / "
            f"Wires {result_summary.get('wireCount', 0)} "
            f"(compression {result_summary.get('wireCompressionCount', 0)})"
        )

    except subprocess.TimeoutExpired as te:
        status_msg = "Failed"
        engine_output += f"\n[Error] 시간 초과: {te}"
    except Exception as e:
        status_msg = "Failed"
        logger.error("UnitStructural 오류: %s", str(e), exc_info=True)
        engine_output += f"\n[Error] {str(e)}"

    job_status_store.update_job(job_id, {"progress": 95, "message": "데이터베이스 저장 중..."})

    try:
        new_analysis = models.Analysis(
            project_name=f"UnitStructural_{timestamp}",
            program_name="UnitStructuralAnalysis",
            employee_id=employee_id,
            status=status_msg,
            input_info={
                "parent_analysis_id": parent_analysis_id,
                "safety_factor": safety_factor,
                "allowable_mpa": allowable_mpa,
            },
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
        "message":    "Unit 구조 해석 완료" if status_msg == "Success" else "Unit 구조 해석 실패",
        "engine_log": engine_output,
        "project":    project_data,
    })
