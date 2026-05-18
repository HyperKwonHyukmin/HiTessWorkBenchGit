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
from typing import Any, Dict

from .. import database, models
from .analysis_runner import (
    get_backend_dir,
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)

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
    # MSC Nastran 한글 오류 메시지가 cp949 로 출력되는 케이스를 보존하기 위해
    # utf-8 → cp949 → euc-kr fallback. 기존 호출자 시그니처/의미는 동일.
    from ._subproc_decode import safe_decode
    out = safe_decode(proc.stdout)
    err = safe_decode(proc.stderr)
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
    mark_running(job_id, "초기화 중...", progress=5)

    status_msg = "Success"
    engine_output = ""
    result_data: Dict[str, Any] = {}

    exe_path = os.path.join(get_backend_dir(), "InHouseProgram", "NastranBridge", "nastran_bridge.exe")

    try:
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")

        # 1. Parent (GroupModuleUnit) 조회 — BDF 경로 확보 (조회만 별도 세션 사용)
        parent_db = database.SessionLocal()
        try:
            parent = parent_db.query(models.Analysis).filter(
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
        finally:
            parent_db.close()

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

        # Studio 가 업로드한 편집 적용 결과 (이미 편집이 반영된 완전한 모델 JSON).
        # 존재하면 lift-run 의 입력으로 이 모델로부터 생성한 _edited.bdf 를 사용한다.
        edited_json = os.path.join(bdf_dir, f"{bdf_stem}_edited.json")
        edited_bdf  = os.path.join(bdf_dir, f"{bdf_stem}_edited.bdf")

        # 기존 산출물 정리 (덮어쓰기 보장)
        for stale in (lifting_bdf, lifting_meta, lifting_f06, result_json, edited_bdf):
            if os.path.exists(stale):
                try: os.remove(stale)
                except OSError: pass

        # 1.5. Studio 편집(_edited.json) 이 있으면 nastran_bridge 로 BDF 변환 후
        #      그 _edited.bdf 를 lift-run 입력으로 사용한다. 편집이 없으면 원본 BDF 그대로.
        #      nastran_bridge 는 입력이 plain model JSON 이면 -o 로 지정된 경로에 BDF 를 출력한다.
        lift_input_bdf = bdf_filename
        if os.path.exists(edited_json):
            update_progress(job_id, 10, "Studio 편집 적용 BDF 생성 중...")
            apply_args = [
                exe_path, os.path.basename(edited_json),
                "-o", os.path.basename(edited_bdf),
            ]
            logger.info("[UnitStructural] apply-edit cmd: %s (cwd=%s)", " ".join(apply_args), bdf_dir)
            apply_proc = subprocess.run(
                apply_args, cwd=bdf_dir,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
            )
            engine_output += "\n[apply-edit]\n" + _decode_completed(apply_proc)
            if apply_proc.returncode != 0:
                raise RuntimeError(
                    f"Studio 편집 적용 실패 (exit={apply_proc.returncode}). "
                    f"_edited.json 을 BDF 로 변환할 수 없습니다."
                )
            if not os.path.exists(edited_bdf):
                raise FileNotFoundError(f"편집 적용 BDF 가 생성되지 않았습니다: {edited_bdf}")
            lift_input_bdf = os.path.basename(edited_bdf)
            logger.info("[UnitStructural] Studio 편집 반영된 BDF 를 lift-run 입력으로 사용: %s", edited_bdf)
        else:
            logger.info("[UnitStructural] _edited.json 없음 — 원본 BDF 를 lift-run 입력으로 사용: %s", bdf_filename)

        # 2. lift-run --prepare-only — Wire 포함 BDF + meta 빌드
        update_progress(job_id, 15, "Wire 포함 BDF 생성 중...")
        prepare_args = [
            exe_path, "lift-run", lift_input_bdf,
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

        update_progress(job_id, 40, "Nastran 실행 중...")
        nastran_args = [nastran_exe, lifting_bdf]
        logger.info("[UnitStructural] nastran cmd: %s (cwd=%s)", " ".join(nastran_args), bdf_dir)
        run = subprocess.run(
            nastran_args, cwd=bdf_dir,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=1800,  # SOL 101 + 모델 크기 고려해 30분 여유
        )
        engine_output += "\n" + _decode_completed(run)
        # Nastran 의 비정상 종료(returncode != 0) 는 F06 가 존재해도 결과 신뢰성이 없을 수 있다.
        # FATAL 9050(Mechanism) 등의 케이스가 returncode != 0 으로 끝나면서 빈 결과가 그대로
        # 다음 단계(lift-result) 까지 흘러가는 것을 방지한다. 실제 fatal 분류는 lift-result 의
        # f06.hasFatal 에서 다시 한 번 확정하므로 여기서는 경고만 누적하고 진행한다.
        if run.returncode != 0:
            engine_output += (
                f"\n[Warning] Nastran exit code {run.returncode} — "
                f"F06 결과 신뢰도가 낮을 수 있습니다 (FATAL/메커니즘 가능성)."
            )
        if not os.path.exists(lifting_f06):
            raise RuntimeError(f"Nastran F06 파일이 생성되지 않았습니다: {lifting_f06}")

        # 4. lift-result — F06 → Studio 매핑 JSON
        update_progress(job_id, 80, "F06 결과 매핑 중...")
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

    update_progress(job_id, 95, "데이터베이스 저장 중...")

    project_data, db_err = record_analysis(
        project_name=f"UnitStructural_{timestamp}",
        program_name="UnitStructuralAnalysis",
        employee_id=employee_id,
        status=status_msg,
        input_info={
            "parent_analysis_id": parent_analysis_id,
            "safety_factor": safety_factor,
            "allowable_mpa": allowable_mpa,
        },
        # F06 fatal 등으로 status=Failed 라도 result_data 가 채워졌으면 그대로 기록 (기존 동작 보존)
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="Unit 구조 해석 완료",
        failure_message="Unit 구조 해석 실패",
    )
