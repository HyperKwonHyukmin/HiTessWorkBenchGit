"""HiTESS Model Builder - Cmb.Cli `build-full` 호출 래퍼.

stdout 첫 줄의 `출력 폴더: <path>` 또는 `폴더: <path>` 를 캡처해
build-full 산출물(timestamp 디렉터리)의 절대 경로를 결과로 저장한다.
viewer 는 이 경로를 initialFolder 로 받아 phase JSON 일괄 자동 로드.

옵션 매핑 (UI 항목 → CLI 플래그):
  mesh_size            → --mesh-size <MM>
  mesh_size_structure  → --mesh-size-structure <MM>
  mesh_size_pipe       → --mesh-size-pipe <MM>
  ubolt_full_fix       → --ubolt-full-fix (bool)
  run_nastran          → --run-nastran (bool)
  nastran_path         → --nastran-path <PATH>
  leg_z_tol            → --leg-z-tol <MM>
"""
import glob
import importlib.util
import json
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from .analysis_runner import (
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)
from .job_manager import job_status_store  # task_execute_apply_edit 가 여전히 직접 사용

logger = logging.getLogger(__name__)

# stdout 첫 줄 형식: '출력 폴더: <path>' 또는 '폴더: <path>'
# 한글 콜론(`：`) 도 허용. README §1 / §5.4 참고.
_OUTPUT_LINE_RE = re.compile(r"^(?:출력\s*폴더|폴더)\s*[:：]\s*(.+)$")

# build-full 이 phase/audit 출력에 사용하는 파일명 패턴 (예: 00_InputAudit.json, 06_Validation.bdf).
# 최종 산출물 {designName}.json/.bdf 와 분리하기 위해 사용.
# 단순 prefix("06_") 매칭은 '06_3468-...' 처럼 도면번호로 시작하는 designName 을 오탐 제외하므로,
# '두자리숫자_영문단어.확장자' 정확 패턴으로 phase 파일만 좁혀 매칭한다.
_PHASE_FILE_RE = re.compile(r"^\d{2}_[A-Za-z]+\.(?:json|bdf)$", re.IGNORECASE)


def _parse_output_dir(stdout: str) -> str | None:
    """stdout 에서 timestamp 산출 디렉터리 경로를 캡처한다."""
    for line in stdout.splitlines():
        m = _OUTPUT_LINE_RE.match(line.strip())
        if m:
            cand = m.group(1).strip().strip('"')
            if os.path.isdir(cand):
                return os.path.abspath(cand)
    return None


def _scan_latest_timestamp_dir(parent: str) -> str | None:
    """fallback: parent 디렉터리에서 yyyyMMdd_HHmmss 패턴 폴더 중 mtime 최신을 채택."""
    pattern = os.path.join(parent, "[0-9]" * 8 + "_" + "[0-9]" * 6)
    cand = [d for d in glob.glob(pattern) if os.path.isdir(d)]
    return max(cand, key=os.path.getmtime) if cand else None


def _pick_final_artifact(output_dir: str, ext: str) -> str | None:
    """output_dir 에서 phase 파일(NN_영문.ext)이 아닌 최신 산출물을 반환한다."""
    files = [
        f for f in glob.glob(os.path.join(output_dir, f"*.{ext}"))
        if not _PHASE_FILE_RE.match(os.path.basename(f))
    ]
    if not files:
        return None
    files.sort(key=os.path.getmtime, reverse=True)
    return files[0]


def task_execute_modelflow(
    job_id: str,
    stru_path: str,
    pipe_path: str | None,
    equip_path: str | None,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    mesh_size: float = 200.0,
    ubolt_full_fix: bool = False,
    run_nastran: bool = False,
    nastran_path: str | None = None,
    leg_z_tol: float | None = None,
    mesh_size_structure: float | None = None,
    mesh_size_pipe: float | None = None,
):
    """Cmb.Cli build-full 백그라운드 실행 작업."""
    mark_running(job_id, "Model Builder 실행 준비...", progress=10)

    input_data = {"stru_csv": stru_path, "pipe_csv": pipe_path, "equip_csv": equip_path}
    result_data: dict = {}
    status_msg = "Success"
    engine_output = ""
    output_dir: str | None = None
    bdf_path: str | None = None
    json_path: str | None = None
    audit_path: str | None = None
    summary_path: str | None = None

    if not os.path.exists(exe_path):
        status_msg = "Failed"
        engine_output = f"Model Builder 실행 파일을 찾을 수 없습니다: {exe_path}"
    else:
        cmd = [exe_path, "build-full", "--stru", stru_path]
        if pipe_path:
            cmd += ["--pipe", pipe_path]
        if equip_path:
            cmd += ["--equip", equip_path]
        cmd += ["--mesh-size", str(int(mesh_size))]
        if mesh_size_structure:
            cmd += ["--mesh-size-structure", str(int(mesh_size_structure))]
        if mesh_size_pipe:
            cmd += ["--mesh-size-pipe", str(int(mesh_size_pipe))]
        if ubolt_full_fix:
            cmd += ["--ubolt-full-fix"]
        if run_nastran:
            cmd += ["--run-nastran"]
            if nastran_path:
                cmd += ["--nastran-path", nastran_path]
            if leg_z_tol is not None:
                cmd += ["--leg-z-tol", str(int(leg_z_tol))]

        logger.info("[ModelBuilder] cmd: %s", " ".join(cmd))
        update_progress(job_id, 30, "Model Builder 실행 중...")

        try:
            result = subprocess.run(
                cmd,
                cwd=work_dir,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=1200,  # 20분
            )
            engine_output = result.stdout or ""
            if result.stderr and result.stderr.strip():
                engine_output += f"\n[stderr]\n{result.stderr}"

            logger.info("[ModelBuilder] exit=%d", result.returncode)

            # README §5.5: exit 0/2 = 산출물 작성 OK, 1 = 산출물 없음
            if result.returncode == 1:
                status_msg = "Failed"
                engine_output += f"\n[Exit code: {result.returncode}]"
            else:
                update_progress(job_id, 70, "산출물 수집 중...")
                output_dir = (
                    _parse_output_dir(result.stdout)
                    or _scan_latest_timestamp_dir(work_dir)
                )
                if output_dir and os.path.isdir(output_dir):
                    result_data["output_dir"] = output_dir

                    audit_cand = os.path.join(output_dir, "00_InputAudit.json")
                    if os.path.exists(audit_cand):
                        audit_path = audit_cand
                        result_data["audit_path"] = audit_path

                    summary_cand = os.path.join(output_dir, "00_StageSummary.json")
                    if os.path.exists(summary_cand):
                        summary_path = summary_cand
                        result_data["summary_path"] = summary_path

                    bdf_path = _pick_final_artifact(output_dir, "bdf")
                    if bdf_path:
                        result_data["bdf_path"] = bdf_path
                    json_path = _pick_final_artifact(output_dir, "json")
                    if json_path:
                        result_data["json_path"] = json_path
                else:
                    status_msg = "Failed"
                    engine_output += "\n[오류] 출력 폴더 라인을 stdout에서 찾을 수 없음."

        except subprocess.TimeoutExpired:
            status_msg = "Failed"
            engine_output = "Model Builder 실행 시간 초과 (20분)."
        except Exception as e:
            status_msg = "Failed"
            logger.error("Cmb.Cli error: %s", e, exc_info=True)
            engine_output = f"실행 오류: {e}"

    update_progress(job_id, 90, "DB 기록 중...")

    # modelflow 는 project 응답에서 input_info/result_info 를 제외하는 기존 동작 보존.
    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"HiTessModelBuilder_{timestamp}",
        program_name="HiTessModelBuilder",
        employee_id=employee_id,
        status=status_msg,
        input_info=input_data,
        result_info=result_data if status_msg == "Success" else None,
        source=source,
        include_io_in_project=False,
    )
    if db_err is not None:
        # 기존 동작 보존: DB 실패 시 status 는 변경하지 않고 engine_output 에만 추가.
        logger.error("DB save error: %s", db_err)
        engine_output += f"\nDB 기록 오류: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="모델 생성 완료",
        failure_message="모델 생성 실패",
        extra={
            "output_dir":   output_dir,
            "audit_path":   audit_path,
            "summary_path": summary_path,
            "bdf_path":     bdf_path,
            "json_path":    json_path,
            "stru_path":    stru_path,
            "pipe_path":    pipe_path,
            "equip_path":   equip_path,
            "work_dir":     work_dir,
            "ubolt":        ubolt_full_fix,
            "run_nastran":  run_nastran,
            "mesh_size":    mesh_size,
        },
    )


# ────────────────────────────────────────────────────────────────────
# apply-edit-intent — Studio 편집 결과(*_edit.json) 적용
# README §6: cmb apply-edit-intent <folder> [--out <DIR>] [--strict]
# 기본 출력 폴더: <folder>/edited/  (이미 존재 시 자동 삭제 후 재작성)
# 산출물: <outDir>/<baseName>.bdf, <outDir>/<baseName>.json, <outDir>/apply-trace.json
# ────────────────────────────────────────────────────────────────────

def detect_edit_json(output_dir: str) -> str | None:
    """output_dir 안에서 가장 최신의 *_edit.json 을 반환한다."""
    if not os.path.isdir(output_dir):
        return None
    cand = [
        f for f in glob.glob(os.path.join(output_dir, "*_edit.json"))
        if os.path.isfile(f)
    ]
    if not cand:
        return None
    cand.sort(key=os.path.getmtime, reverse=True)
    return cand[0]


def detect_edited_artifacts(output_dir: str) -> dict:
    """output_dir/edited/ 산출물 경로를 dict 로 반환. 없으면 키 부재.

    Edit BDF 외에 Nastran 산출물(.f06/.op2/.log) 과 F06Parser 결과(_results.json,
    _SC*_*.csv) 도 함께 수집한다.
    """
    edited_dir = os.path.join(output_dir, "edited")
    result: dict = {"edited_dir": edited_dir if os.path.isdir(edited_dir) else None}
    if not os.path.isdir(edited_dir):
        return result

    bdf_files  = sorted(glob.glob(os.path.join(edited_dir, "*.bdf")),  key=os.path.getmtime, reverse=True)
    json_files = sorted(
        (f for f in glob.glob(os.path.join(edited_dir, "*.json"))
         if os.path.basename(f) not in ("apply-trace.json",)
            and not os.path.basename(f).endswith("_results.json")),
        key=os.path.getmtime, reverse=True,
    )
    trace_path = os.path.join(edited_dir, "apply-trace.json")

    if bdf_files:                          result["edited_bdf_path"]  = bdf_files[0]
    if json_files:                         result["edited_json_path"] = json_files[0]
    if os.path.isfile(trace_path):         result["apply_trace_path"] = trace_path

    # Nastran 출력 (BDF 와 동일 stem)
    if bdf_files:
        stem = os.path.splitext(os.path.basename(bdf_files[0]))[0]
        for ext in ("f06", "op2", "log"):
            cand = os.path.join(edited_dir, f"{stem}.{ext}")
            if os.path.isfile(cand):
                result[f"edited_{ext}_path"] = cand
        # F06Parser 산출물 (_results.json + _SC*_*.csv)
        results_json = os.path.join(edited_dir, f"{stem}_results.json")
        if os.path.isfile(results_json):
            result["edited_f06_results_path"] = results_json
        csv_keys = []
        for f in glob.glob(os.path.join(edited_dir, f"{stem}_SC*_*.csv")):
            csv_keys.append(f)
        if csv_keys:
            result["edited_f06_csv_paths"] = sorted(csv_keys)

    return result


def _edit_json_has_kind(edit_json_path: str | None, kind: str) -> bool:
    if not edit_json_path or not os.path.isfile(edit_json_path):
        return False
    try:
        with open(edit_json_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return any(
            isinstance(intent, dict) and intent.get("kind") == kind
            for intent in data.get("intents", [])
        )
    except Exception:
        return False


def _load_nastran_bridge_module():
    backend_dir = Path(__file__).resolve().parents[2]
    bridge_path = backend_dir / "InHouseProgram" / "NastranBridge" / "nastran_bridge.py"
    if not bridge_path.is_file():
        raise FileNotFoundError(f"nastran_bridge.py 없음: {bridge_path}")
    spec = importlib.util.spec_from_file_location("hitess_nastran_bridge", bridge_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"nastran_bridge.py 로드 실패: {bridge_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _apply_edit_with_nastran_bridge(output_dir: str, edit_json_path: str) -> tuple[dict, str]:
    """Cmb.Cli.exe가 모르는 신규 intent(deleteRigid 등)를 Python bridge로 적용한다."""
    nb = _load_nastran_bridge_module()
    edit_path = Path(edit_json_path)
    stem = edit_path.stem[:-5] if edit_path.stem.lower().endswith("_edit") else edit_path.stem + "_final"
    edited_dir = Path(output_dir) / "edited"
    if edited_dir.exists():
        shutil.rmtree(edited_dir)
    edited_dir.mkdir(parents=True, exist_ok=True)

    output_json_path = edited_dir / f"{stem}.json"
    output_bdf_path = edited_dir / f"{stem}.bdf"
    result = nb.write_edited_model_outputs(edit_path, output_json_path, output_bdf_path)

    edit_data = json.loads(edit_path.read_text(encoding="utf-8"))
    summary = result.get("summary", {})
    operations = []
    for rigid_id in summary.get("addedRigids", []) or []:
        operations.append({
            "code": "RIGID_ADDED",
            "level": "info",
            "kind": "addRigid",
            "details": f"RBE2 {rigid_id} created",
        })
    deleted_rigids = (summary.get("deleted") or {}).get("rigids", 0)
    if deleted_rigids:
        operations.append({
            "code": "RIGID_DELETED",
            "level": "info",
            "kind": "deleteRigid",
            "details": f"{deleted_rigids} RBE2 deleted",
        })
    trace = {
        "schemaVersion": "1.0",
        "appliedAt": datetime.now().isoformat(),
        "intentFile": edit_path.name,
        "baseStage": stem,
        "intents": edit_data.get("intents", []),
        "operations": operations,
        "summary": summary,
        "fallback": "nastran_bridge",
    }
    (edited_dir / "apply-trace.json").write_text(
        json.dumps(trace, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    edited = detect_edited_artifacts(output_dir)
    log = (
        "[nastran_bridge fallback]\n"
        f"edit={edit_path}\n"
        f"json={output_json_path}\n"
        f"bdf={output_bdf_path}\n"
        f"summary={json.dumps(summary, ensure_ascii=False)}"
    )
    return edited, log


_DEFAULT_NASTRAN_PATH = r"C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe"

# Nastran F06 의 표준 진단 마커. *** USER FATAL / *** USER ERROR / *** SYSTEM FATAL ...
_F06_FATAL_RE = re.compile(r"\*\*\*\s*(USER|SYSTEM)\s+FATAL\b", re.IGNORECASE)
_F06_ERROR_RE = re.compile(r"\*\*\*\s*(USER|SYSTEM)\s+ERROR\b", re.IGNORECASE)


def scan_f06_diagnostics(f06_path: str, max_samples: int = 5, snippet_lines: int = 6) -> dict:
    """F06 파일에서 FATAL / ERROR 메시지 검출. 각 발생부의 주변 라인을 sample 로 반환."""
    if not f06_path or not os.path.isfile(f06_path):
        return {"available": False}
    fatal_count = 0
    error_count = 0
    fatal_samples: list[str] = []
    error_samples: list[str] = []
    try:
        with open(f06_path, "r", encoding="cp949", errors="replace") as fh:
            lines = fh.readlines()
        for i, line in enumerate(lines):
            if _F06_FATAL_RE.search(line):
                fatal_count += 1
                if len(fatal_samples) < max_samples:
                    fatal_samples.append("".join(lines[i:i + snippet_lines]).rstrip())
            elif _F06_ERROR_RE.search(line):
                error_count += 1
                if len(error_samples) < max_samples:
                    error_samples.append("".join(lines[i:i + snippet_lines]).rstrip())
        return {
            "available":     True,
            "fatalCount":    fatal_count,
            "errorCount":    error_count,
            "fatalSamples":  fatal_samples,
            "errorSamples":  error_samples,
        }
    except Exception as e:
        return {"available": False, "error": str(e)}


def _run_nastran_on_bdf(bdf_path: str, nastran_path: str, timeout_sec: int = 1800) -> tuple[int, str]:
    """edited BDF 에 대해 nastran.exe 를 직접 spawn. (exit_code, log)."""
    if not os.path.isfile(nastran_path):
        return -1, f"[Nastran] 실행 파일이 없습니다: {nastran_path}"
    if not os.path.isfile(bdf_path):
        return -1, f"[Nastran] BDF 가 없습니다: {bdf_path}"

    work_dir = os.path.dirname(bdf_path)
    bdf_basename = os.path.basename(bdf_path)
    cmd = [nastran_path, bdf_basename, "scr=yes", "old=no", "batch=no"]
    logger.info("[Nastran] cmd: %s (cwd=%s)", " ".join(cmd), work_dir)
    try:
        proc = subprocess.run(
            cmd,
            cwd=work_dir,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_sec,
        )
        log = (proc.stdout or "") + (("\n[stderr]\n" + proc.stderr) if (proc.stderr or "").strip() else "")
        logger.info("[Nastran] exit=%d", proc.returncode)
        return proc.returncode, log
    except subprocess.TimeoutExpired:
        return -1, f"[Nastran] 실행 시간 초과 ({timeout_sec}초)."
    except Exception as e:
        logger.error("[Nastran] error: %s", e, exc_info=True)
        return -1, f"[Nastran] 실행 오류: {e}"


def _run_f06parser(f06_path: str, work_dir: str, timeout_sec: int = 300) -> tuple[int, str]:
    """F06Parser.Console.exe 를 spawn 해서 work_dir 에 *_results.json + *_SC*_*.csv 생성."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.dirname(os.path.dirname(base_dir))
    parser_exe = os.path.join(backend_dir, "InHouseProgram", "F06Parser", "F06Parser.Console.exe")
    if not os.path.isfile(parser_exe):
        return -1, f"[F06Parser] 실행 파일이 없습니다: {parser_exe}"
    if not os.path.isfile(f06_path):
        return -1, f"[F06Parser] F06 파일이 없습니다: {f06_path}"

    cmd = [parser_exe, f06_path, "--output-dir", work_dir]
    logger.info("[F06Parser] cmd: %s", " ".join(cmd))
    try:
        proc = subprocess.run(
            cmd,
            cwd=work_dir,
            capture_output=True,
            timeout=timeout_sec,
        )
        out = proc.stdout.decode("cp949", errors="replace") if proc.stdout else ""
        err = proc.stderr.decode("cp949", errors="replace") if proc.stderr else ""
        log = out + (("\n[stderr]\n" + err) if err.strip() else "")
        logger.info("[F06Parser] exit=%d", proc.returncode)
        return proc.returncode, log
    except subprocess.TimeoutExpired:
        return -1, f"[F06Parser] 실행 시간 초과 ({timeout_sec}초)."
    except Exception as e:
        logger.error("[F06Parser] error: %s", e, exc_info=True)
        return -1, f"[F06Parser] 실행 오류: {e}"


def task_execute_apply_edit(
    job_id: str,
    output_dir: str,
    exe_path: str,
    strict: bool = False,
    run_nastran: bool = True,           # Edit BDF 자동 Nastran 해석
    nastran_path: str | None = None,    # 미지정 시 기본 경로 사용
    parse_f06: bool = True,             # F06 자동 파싱
):
    """Studio 편집 결과(*_edit.json) → cmb apply-edit-intent → edited/ 폴더 생성.
    추가로 edited BDF 에 대해 Nastran 해석 + F06Parser 까지 자동 체인.

    output_dir: build-full timestamp 산출 디렉터리 (Studio 가 *_edit.json 을 쓴 위치)
    """
    job_status_store.update_job(job_id, {
        "status": "Running", "progress": 5, "message": "편집 결과 검색 중...",
    })

    engine_output = ""
    status_msg = "Success"
    edit_json_path = detect_edit_json(output_dir)
    edited: dict = {}
    nastran_used = bool(run_nastran)
    f06_parsed = False

    try:
        # ────────── (1/3) apply-edit-intent ──────────
        if not os.path.isdir(output_dir):
            status_msg = "Failed"
            engine_output = f"output_dir 없음: {output_dir}"
        elif not edit_json_path:
            status_msg = "Failed"
            engine_output = f"*_edit.json 을 찾을 수 없습니다: {output_dir}"
        elif not os.path.exists(exe_path):
            status_msg = "Failed"
            engine_output = f"Model Builder 실행 파일을 찾을 수 없습니다: {exe_path}"
        else:
            cmd = [exe_path, "apply-edit-intent", output_dir]
            if strict:
                cmd.append("--strict")
            logger.info("[apply-edit] cmd: %s", " ".join(cmd))
            job_status_store.update_job(job_id, {"progress": 15, "message": "편집 적용 중 (1/3)..."})

            try:
                result = subprocess.run(
                    cmd,
                    cwd=output_dir,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=600,
                )
                engine_output = "[apply-edit-intent]\n" + (result.stdout or "")
                if result.stderr and result.stderr.strip():
                    engine_output += f"\n[stderr]\n{result.stderr}"
                logger.info("[apply-edit] exit=%d", result.returncode)

                # README §6 exit codes: 0=성공, 2=*_edit.json 없음/intents 빔, 64/65/70=실패
                if result.returncode == 0:
                    edited = detect_edited_artifacts(output_dir)
                    if not edited.get("edited_bdf_path"):
                        status_msg = "Failed"
                        engine_output += "\n[오류] edited/ 폴더에 BDF 산출물이 없습니다."
                elif result.returncode == 2:
                    status_msg = "Failed"
                    engine_output += "\n[오류] 적용할 편집 내역이 없습니다 (intents 비어있음)."
                else:
                    can_bridge_fallback = (
                        result.returncode == 65
                        and _edit_json_has_kind(edit_json_path, "deleteRigid")
                        and "unsupported intent kind" in engine_output
                    )
                    if can_bridge_fallback:
                        logger.warning(
                            "[apply-edit] Cmb.Cli.exe가 deleteRigid를 지원하지 않아 nastran_bridge fallback 적용"
                        )
                        try:
                            edited, fallback_log = _apply_edit_with_nastran_bridge(output_dir, edit_json_path)
                            engine_output += (
                                f"\n[Exit code: {result.returncode}]"
                                "\n[호환 처리] Cmb.Cli.exe deleteRigid 미지원 → nastran_bridge로 편집 BDF 생성.\n"
                                f"{fallback_log}"
                            )
                            if not edited.get("edited_bdf_path"):
                                status_msg = "Failed"
                                engine_output += "\n[오류] nastran_bridge fallback 후 edited/ 폴더에 BDF 산출물이 없습니다."
                        except Exception as fallback_error:
                            status_msg = "Failed"
                            logger.exception("[apply-edit] nastran_bridge fallback 실패")
                            engine_output += (
                                f"\n[Exit code: {result.returncode}]"
                                f"\n[오류] nastran_bridge fallback 실패: {fallback_error}"
                            )
                    else:
                        status_msg = "Failed"
                        engine_output += f"\n[Exit code: {result.returncode}]"

            except subprocess.TimeoutExpired:
                status_msg = "Failed"
                engine_output += "\napply-edit-intent 실행 시간 초과 (10분)."
            except Exception as e:
                status_msg = "Failed"
                logger.error("apply-edit-intent error: %s", e, exc_info=True)
                engine_output += f"\n실행 오류: {e}"

        # ────────── (2/3) Nastran 해석 (Edit BDF) ──────────
        if status_msg == "Success" and run_nastran and edited.get("edited_bdf_path"):
            job_status_store.update_job(job_id, {"progress": 40, "message": "Edit BDF Nastran 해석 중 (2/3)..."})
            np_path = nastran_path or _DEFAULT_NASTRAN_PATH
            nast_code, nast_log = _run_nastran_on_bdf(edited["edited_bdf_path"], np_path)
            engine_output += f"\n\n[Nastran exit={nast_code}]\n{nast_log}"
            # Nastran exit 0 = OK, 그 외 = 부분 결과 가능. 산출물 재수집.
            edited = detect_edited_artifacts(output_dir)
            if not edited.get("edited_f06_path"):
                # F06 가 없으면 해석 실패 — but apply-edit 자체는 성공이니 task 는 Success 유지.
                # F06 미존재를 표면화만 함.
                engine_output += "\n[경고] F06 파일이 생성되지 않았습니다. Nastran 해석이 실패했을 수 있습니다."
                f06_parsed = False
            elif parse_f06:
                # ────────── (3/3) F06Parser ──────────
                job_status_store.update_job(job_id, {"progress": 75, "message": "F06 결과 파싱 중 (3/3)..."})
                p_code, p_log = _run_f06parser(
                    edited["edited_f06_path"],
                    work_dir=os.path.dirname(edited["edited_f06_path"]),
                )
                engine_output += f"\n\n[F06Parser exit={p_code}]\n{p_log}"
                edited = detect_edited_artifacts(output_dir)  # 결과 파일 재수집
                f06_parsed = bool(edited.get("edited_f06_results_path"))

        # ────────── 최종 job 상태 갱신 ──────────
        job_status_store.update_job(job_id, {
            "status":           status_msg,
            "progress":         100,
            "message":          (
                "편집 적용 + Nastran + F06 파싱 완료" if status_msg == "Success" and nastran_used and f06_parsed
                else "편집 적용 + Nastran 완료"      if status_msg == "Success" and nastran_used
                else "편집 적용 완료"                 if status_msg == "Success"
                else "편집 적용 실패"
            ),
            "engine_log":       engine_output,
            "output_dir":       output_dir,
            "edit_json_path":   edit_json_path,
            "edited_dir":              edited.get("edited_dir"),
            "edited_bdf_path":         edited.get("edited_bdf_path"),
            "edited_json_path":        edited.get("edited_json_path"),
            "apply_trace_path":        edited.get("apply_trace_path"),
            "edited_f06_path":         edited.get("edited_f06_path"),
            "edited_op2_path":         edited.get("edited_op2_path"),
            "edited_log_path":         edited.get("edited_log_path"),
            "edited_f06_results_path": edited.get("edited_f06_results_path"),
            "edited_f06_csv_paths":    edited.get("edited_f06_csv_paths"),
            "run_nastran":             nastran_used,
            "f06_parsed":              f06_parsed,
        })
    except Exception as outer:
        logger.error("apply-edit task fatal: %s", outer, exc_info=True)
        job_status_store.update_job(job_id, {
            "status": "Failed",
            "progress": 100,
            "message": "편집 적용 중 예외",
            "engine_log": engine_output + f"\n[fatal] {outer}",
        })
