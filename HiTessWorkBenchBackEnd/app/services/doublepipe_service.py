"""이중관 Inner Support -> 내관 자동 생성 CSV 서비스.

하이브리드 구조:
- 미리보기(run_inner_pipe_preview): 내관 CSV 변환만 in-process 로 수행(빠름, matplotlib 불필요).
- 도면 PDF(generate_inner_pipe_pdf): 무거운 matplotlib 렌더는 온디맨드로 분리. 가능하면
  InnerPipeTransform.exe(pandas/numpy/matplotlib 번들)를 subprocess 로 실행해 실행 컴퓨터(특히
  145)의 venv 에 matplotlib 를 설치할 필요를 없앤다. exe 가 없으면 in-process 모듈로 폴백한다.
  (회사 DRM 때문에 PyInstaller onedir 은 base_library.zip at-rest 암호화로 기동 불가 → onefile.)
"""
import contextlib
import importlib.util
import io
import json
import logging
import os
import subprocess
import uuid
from datetime import datetime

from fastapi import HTTPException

from .analysis_runner import record_analysis
from .workspace import create_analysis_workspace

logger = logging.getLogger(__name__)

# 모든 경로는 이 파일(__file__) 기준 상대로 유도한다 — dev(내 PC)와 운영 서버(145)에서
# 폴더 구조가 동일(HiTessWorkBenchBackEnd/InHouseProgram/DoublePipe/)하므로 그대로 동작한다.
_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_SERVICES_DIR)
_BACKEND_DIR = os.path.dirname(_APP_DIR)
_DOUBLEPIPE_DIR = os.path.join(_BACKEND_DIR, "InHouseProgram", "DoublePipe")
_CONVERTING_DIR = os.path.join(_DOUBLEPIPE_DIR, "Converting CSV")
_TRANSFORM_MODULE_PATH = os.path.join(_CONVERTING_DIR, "inner_pipe_transform.py")
# 도면 PDF 생성용 번들 exe (PyInstaller onefile). 존재하면 venv 대신 이걸로 렌더한다.
_INNER_EXE_PATH = os.path.join(_CONVERTING_DIR, "InnerPipeTransform.exe")
_INNER_EXE_TIMEOUT = int(os.environ.get("DOUBLEPIPE_TRANSFORM_TIMEOUT", "300"))
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")

# userConnection 폴더 명명에 쓰는 프로그램 이름 (다른 앱과 동일 규칙: {timestamp}_{employee_id}_{ProgramName}).
_PROGRAM_NAME = "DoublePipeFuelLine"

# exe subprocess 실행 시 콘솔 창 팝업 방지.
_SUBPROC_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

_transform_module = None


def _load_transform_module():
    global _transform_module
    if _transform_module is not None:
        return _transform_module
    if not os.path.exists(_TRANSFORM_MODULE_PATH):
        raise HTTPException(status_code=503, detail="이중관 변환 모듈을 찾을 수 없습니다. 서버 관리자에게 문의하세요.")
    spec = importlib.util.spec_from_file_location("inner_pipe_transform", _TRANSFORM_MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _transform_module = module
    return module


def _pdf_supported() -> bool:
    """도면 PDF 생성 가능 여부 — 번들 exe 존재 또는 in-process matplotlib 사용 가능."""
    return os.path.isfile(_INNER_EXE_PATH) or (importlib.util.find_spec("matplotlib") is not None)


def _record_inner_support_analysis(job: dict):
    """Tab 1 실행 스냅샷을 Analysis DB에 upsert한다.

    변환 전에 Running 행을 만들고 성공/실패 시 같은 job_id를 갱신한다. WorkBench가 응답을
    받기 전에 종료되어도 서버 작업 폴더와 입력값, 변환 결과를 My Projects에서 복원할 수 있다.
    DB 장애가 실제 CSV 변환 결과까지 실패시키지는 않도록 오류는 로그로만 남긴다.
    """
    started_at = job.get("startedAt")
    finished_at = job.get("finishedAt")
    duration_sec = None
    if started_at and finished_at:
        try:
            duration_sec = max(
                0,
                int((datetime.fromisoformat(finished_at) - datetime.fromisoformat(started_at)).total_seconds()),
            )
        except (TypeError, ValueError):
            duration_sec = None

    input_csv_path = job.get("inputCsvPath")
    result_csv_path = job.get("resultCsvPath")
    config_path = job.get("configPath")
    input_info = {
        "schema_version": 3,
        "workflow_step": "inner_support",
        "input_mode": "inner_support",
        "input_csv": input_csv_path,
        "input_filename": os.path.basename(input_csv_path) if input_csv_path else None,
        "config_file": config_path,
        "inner_support_config": job.get("config") or {},
    }
    result_info = {
        "schema_version": 3,
        "workflow_step": "inner_support",
        "work_dir": job.get("workDir"),
        "status": job.get("status"),
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_sec": duration_sec,
        "row_count": job.get("rowCount"),
        "result_csv": result_csv_path,
        "result_filename": os.path.basename(result_csv_path) if result_csv_path else None,
        "pdf_supported": bool(job.get("pdfSupported")),
        "diagnostic": job.get("diagnostic"),
        "logs": list(job.get("logs") or []),
    }
    try:
        project, db_error = record_analysis(
            job_id=job.get("jobId"),
            project_name=job.get("projectName"),
            program_name=_PROGRAM_NAME,
            employee_id=job.get("employeeId") or "unknown",
            status=job.get("status") or "Failed",
            input_info=input_info,
            result_info=result_info,
            source="Workbench",
        )
        if db_error:
            logger.error("Inner Support analysis DB record failed: %s", db_error)
        return project
    except Exception as exc:  # noqa: BLE001
        logger.error("Inner Support analysis DB record failed: %s", exc, exc_info=True)
        return None


def run_inner_pipe_preview(config: dict, csv_bytes: bytes, csv_name: str, employee_id: str) -> dict:
    """
    사용자가 업로드한 외관 배관 CSV(csv_bytes)를 입력으로, Design Inner Support(Tab1)
    입력값(config)에 따라 append_offset.py 변환 로직(내관 Y-15000mm 오프셋 생성 +
    규격 스냅 + ELBO bendR 반영 + UBOLT 자동 배치 + 연결성 검사)을 실행한다.

    도면 PDF 는 여기서 만들지 않는다 — 무거운 matplotlib 렌더는 generate_inner_pipe_pdf()로
    분리한 온디맨드 경로다(미리보기는 빠르게 유지). 반환의 pdfSupported 로 프론트가 'PDF 생성'
    버튼 표시 여부를 판단한다.
    """
    module = _load_transform_module()

    # ── 작업 폴더 생성 (다른 앱과 동일 명명 규칙) ──
    work_dir, timestamp = create_analysis_workspace(
        _USER_CONNECTION_DIR,
        employee_id,
        _PROGRAM_NAME,
    )
    folder_name = os.path.basename(work_dir)

    # ── 입력 CSV 저장 ──
    safe_name = os.path.basename(csv_name) or "outer_input.csv"
    if not safe_name.lower().endswith('.csv'):
        safe_name += '.csv'
    input_csv_path = os.path.join(work_dir, safe_name)
    with open(input_csv_path, "wb") as f:
        f.write(csv_bytes)

    # ── 설정 JSON 저장 (inner_pipe_config.json 스키마) — 온디맨드 PDF 생성 시 재사용 ──
    with open(os.path.join(work_dir, "inner_pipe_config.json"), "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    # ── 결과 CSV 경로 (append_offset.py 출력 명명 규칙: <stem>_Y-15000.csv) ──
    stem, ext = os.path.splitext(safe_name)
    result_name = f"{stem}_Y-15000{ext or '.csv'}"
    result_csv_path = os.path.join(work_dir, result_name)

    job = {
        "jobId": uuid.uuid4().hex[:12],
        "projectName": f"Inner Support 설계_{timestamp}",
        "employeeId": employee_id or "unknown",
        "status": "Running",
        "config": config,
        "configPath": os.path.join(work_dir, "inner_pipe_config.json"),
        "inputCsvPath": input_csv_path,
        "resultCsvPath": result_csv_path,
        "workDir": work_dir,
        "startedAt": datetime.now().isoformat(timespec="seconds"),
        "finishedAt": None,
        "rowCount": None,
        "pdfSupported": _pdf_supported(),
        "diagnostic": None,
        "logs": [],
    }
    # 클라이언트가 응답을 받기 전에 닫혀도 이력이 보이도록 변환 시작 전에 먼저 저장한다.
    _record_inner_support_analysis(job)

    log_buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(log_buffer):
            # output_pdf_path 미지정 → matplotlib 을 import 하지 않는 빠른 경로.
            result_df = module.run_transform(input_csv_path, config, output_csv_path=result_csv_path)
    except Exception:
        job.update({
            "status": "Failed",
            "finishedAt": datetime.now().isoformat(timespec="seconds"),
            "diagnostic": "inner_support_transform_failed",
            "logs": [line for line in log_buffer.getvalue().splitlines() if line.strip()],
        })
        _record_inner_support_analysis(job)
        logger.exception("이중관 변환 실패 (employee_id=%s, csv=%s)", employee_id, safe_name)
        raise HTTPException(status_code=500, detail="이중관 변환 중 오류가 발생했습니다. CSV 형식과 입력값을 확인하세요.")

    result_df = result_df.fillna('')
    logs = [line for line in log_buffer.getvalue().splitlines() if line.strip()]

    job.update({
        "status": "Success",
        "finishedAt": datetime.now().isoformat(timespec="seconds"),
        "rowCount": len(result_df),
        "logs": logs,
    })
    project = _record_inner_support_analysis(job)

    return {
        "jobId": job["jobId"],
        "analysisId": project.get("id") if project else None,
        "columns": list(result_df.columns),
        "rows": result_df.to_dict('records'),
        "rowCount": len(result_df),
        "logs": logs,
        "sourceCsv": safe_name,
        "resultCsv": result_name,
        "workDir": folder_name,          # userConnection 기준 상대 폴더명 (이후 단계 진행 기준)
        "resultPath": result_csv_path,   # 서버 절대 경로 (Tab2 백엔드/다운로드 연동용)
        "pdfSupported": job["pdfSupported"],  # 프론트 'PDF 생성·다운로드' 버튼 표시 여부
    }


def generate_inner_pipe_pdf(work_dir: str, source_csv: str, employee_id: str) -> tuple[bytes, str]:
    """Tab1 작업 폴더의 입력 CSV + 설정으로 배치/치수 도면 PDF 를 생성해 (bytes, filename) 반환.

    미리보기와 분리된 온디맨드 경로. 무거운 matplotlib 렌더는 가능하면
    InnerPipeTransform.exe(번들)로 subprocess 실행하고(venv matplotlib 불필요), 없으면
    in-process 모듈로 폴백한다. 생성된 PDF 는 read() 로 다시 읽어(회사 DRM 화이트리스트로
    복호화) 정확한 바이트를 반환 — 디스크 at-rest 암호화와 무관하게 본문/Content-Length 가 일치한다.
    """
    # ── 경로 검증 (userConnection 밖 접근 차단) ──
    safe_dir = os.path.basename(work_dir or "")
    safe_csv = os.path.basename(source_csv or "")
    if not safe_dir or not safe_csv:
        raise HTTPException(status_code=400, detail="workDir 와 sourceCsv 를 모두 지정하세요.")

    work_path = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, safe_dir))
    if not work_path.startswith(os.path.abspath(_USER_CONNECTION_DIR) + os.sep):
        raise HTTPException(status_code=400, detail="작업 폴더 경로가 올바르지 않습니다.")

    input_csv_path = os.path.join(work_path, safe_csv)
    config_path = os.path.join(work_path, "inner_pipe_config.json")
    if not os.path.isfile(input_csv_path):
        raise HTTPException(status_code=404, detail=f"입력 CSV 를 찾을 수 없습니다: {safe_dir}/{safe_csv}")
    if not os.path.isfile(config_path):
        raise HTTPException(status_code=404, detail="설정(inner_pipe_config.json)을 찾을 수 없습니다.")

    stem, _ = os.path.splitext(safe_csv)
    pdf_name = f"{stem}_Y-15000.pdf"
    pdf_path = os.path.join(work_path, pdf_name)

    try:
        if os.path.isfile(_INNER_EXE_PATH):
            _generate_pdf_via_exe(input_csv_path, config_path, pdf_path)
        else:
            _generate_pdf_in_process(input_csv_path, config_path, pdf_path)
    except HTTPException:
        raise
    except Exception:
        logger.exception("이중관 도면 PDF 생성 실패 (employee_id=%s, dir=%s)", employee_id, safe_dir)
        raise HTTPException(status_code=500, detail="도면 PDF 생성 중 오류가 발생했습니다.")

    if not os.path.isfile(pdf_path):
        raise HTTPException(status_code=500, detail="도면 PDF 가 생성되지 않았습니다(엔진/의존성 확인 필요).")

    with open(pdf_path, "rb") as f:  # read() → DRM at-rest 복호화된 정확한 바이트
        pdf_bytes = f.read()
    return pdf_bytes, pdf_name


def _generate_pdf_via_exe(input_csv_path: str, config_path: str, pdf_path: str) -> None:
    """InnerPipeTransform.exe 로 PDF 만 생성(--out-pdf). venv 의 pandas/numpy/matplotlib 불필요."""
    cmd = [_INNER_EXE_PATH, input_csv_path, "--config", config_path, "--out-pdf", pdf_path]
    proc = subprocess.run(
        cmd,
        cwd=os.path.dirname(pdf_path),
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=_INNER_EXE_TIMEOUT,
        creationflags=_SUBPROC_FLAGS,
    )
    if proc.returncode != 0:
        logger.error(
            "InnerPipeTransform.exe 실패(exit=%s)\nstdout:%s\nstderr:%s",
            proc.returncode, proc.stdout, proc.stderr,
        )
        raise RuntimeError(f"InnerPipeTransform.exe exit={proc.returncode}")


def _generate_pdf_in_process(input_csv_path: str, config_path: str, pdf_path: str) -> None:
    """exe 미존재 시 폴백 — 모듈을 in-process 로 실행(개발 환경, venv matplotlib 필요)."""
    module = _load_transform_module()
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    with contextlib.redirect_stdout(io.StringIO()):
        module.run_transform(input_csv_path, config, output_pdf_path=pdf_path)
