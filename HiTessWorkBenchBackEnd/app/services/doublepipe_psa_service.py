"""이중관 연료배관 — 전체 Load Case 배관응력 해석(PSA) 실행 서비스.

Tab1(Design Inner Support)에서 생성한 내관 포함 결과 CSV(userConnection 작업 폴더에 저장됨)를
InHouseProgram/DoublePipe/"Piping Stress Analysis for all load cases"/Main.py 파이프라인의
입력으로 넘겨 전체 29개 Load Case(OPE 16 + SUS 1 + OCC 6 + EXP 6)를 해석한다.

이 프로젝트의 Main.py 는 위치 인자 하나(csv 경로)만 받고 항상 전체 Load Case 를 해석한다:
    python Main.py <csv_path>

⚠️ 이 파이프라인은 Abaqus(외부 솔버) + scipy + pyNastran 이 설치된 환경에서만 완주한다.
   - WorkBench 백엔드 가상환경에는 scipy/pyNastran/Abaqus 가 없으므로, 실행은 반드시 별도
     파이썬(솔버 환경)에서 이뤄진다. 실행 파이썬은 환경변수 DOUBLEPIPE_PSA_PYTHON 으로 지정하며,
     미지정 시 백엔드 파이썬(sys.executable)을 쓰되 scipy 부재로 import 단계에서 실패를 보고한다.
   - 실행은 백그라운드 스레드에서 subprocess 로 수행하고, stdout 을 라인 단위로 누적해
     프론트가 status 폴링으로 로그를 받아볼 수 있게 한다(작업 상태는 인메모리).
"""
import os
import subprocess
import sys
import threading
import uuid
from datetime import datetime

from fastapi import HTTPException

# ── 경로: 이 파일(__file__) 기준 상대 유도 (dev·서버 145 공통) ──
_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_SERVICES_DIR)
_BACKEND_DIR = os.path.dirname(_APP_DIR)
_PSA_DIR = os.path.join(
    _BACKEND_DIR, "InHouseProgram", "DoublePipe",
    "Piping Stress Analysis for all load cases",
)
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")
_REPORT_NAME = "Report for PSA.xlsx"

# 파이프라인 실행 파이썬(scipy·pyNastran·Abaqus 가 설치된 환경). 미지정 시 백엔드 파이썬.
_PSA_PYTHON = os.environ.get("DOUBLEPIPE_PSA_PYTHON") or sys.executable

# 최대 실행 시간(초) — Abaqus 반복 해석까지 고려. 필요 시 env 로 override.
_PSA_TIMEOUT = int(os.environ.get("DOUBLEPIPE_PSA_TIMEOUT", "7200"))

# jobId -> 작업 상태(인메모리). 서버 재시작 시 소실(다른 앱과 동일한 구조적 한계).
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()

_MAX_LOG_LINES = 3000  # 로그 폭주 방지 상한


def start_psa_job(work_dir: str, result_csv: str, employee_id: str) -> dict:
    """전체 Load Case PSA 해석을 백그라운드로 시작하고 jobId 를 반환한다."""
    # ── 입력 검증 ──
    safe_dir = os.path.basename(work_dir or "")
    safe_csv = os.path.basename(result_csv or "")
    if not safe_dir or not safe_csv:
        raise HTTPException(status_code=400, detail="workDir 와 resultCsv 를 모두 지정하세요.")

    csv_path = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, safe_dir, safe_csv))
    # userConnection 하위로 경로 고정(디렉터리 탈출 차단)
    if not csv_path.startswith(os.path.abspath(_USER_CONNECTION_DIR) + os.sep):
        raise HTTPException(status_code=400, detail="입력 CSV 경로가 올바르지 않습니다.")
    if not os.path.isfile(csv_path):
        raise HTTPException(status_code=404, detail=f"Tab1 결과 CSV 를 찾을 수 없습니다: {safe_dir}/{safe_csv}")

    main_py_path = os.path.join(_PSA_DIR, "Main.py")
    if not os.path.isdir(_PSA_DIR) or not os.path.isfile(main_py_path):
        raise HTTPException(status_code=503, detail="PSA 해석 프로그램(Main.py)을 찾을 수 없습니다. 서버 관리자에게 문의하세요.")

    # ⚠️ cwd 는 반드시 CSV 가 있는 폴더(job_dir)여야 한다 — Main.py 내부의 write_LC()/
    # make_report()/F06Format 이 "Report for PSA.xlsx", "Inforget_f06.txt", "L*_stress.txt" 등을
    # 전부 cwd 상대경로로 읽고 쓰기 때문(원본 이식 문서 §6-5·§9-3). Main.py 자체는 절대경로로
    # 지정해 cwd 와 무관하게 실행되게 하고(스크립트 자기 폴더는 Python 이 sys.path 에 자동 추가),
    # 하위 산출물만 job_dir 에 모이도록 한다. _PSA_DIR 를 cwd 로 쓰면 동시 작업 간 산출물이
    # 서로 덮어써지고 make_report() 가 파일을 못 찾아 빈 보고서가 나온다.
    job_dir = os.path.dirname(csv_path)
    command = [_PSA_PYTHON, main_py_path, csv_path]

    job_id = uuid.uuid4().hex[:12]
    now = datetime.now().isoformat(timespec="seconds")
    job = {
        "jobId": job_id,
        "status": "running",           # running | done | failed
        "returncode": None,
        "csvPath": csv_path,
        "command": " ".join(f'"{c}"' if " " in c else c for c in command),
        "logs": [],
        "reportPath": os.path.join(job_dir, _REPORT_NAME),
        "reportReady": False,
        "startedAt": now,
        "finishedAt": None,
        "python": _PSA_PYTHON,
    }
    with _jobs_lock:
        _jobs[job_id] = job

    thread = threading.Thread(target=_run_pipeline, args=(job_id, command, job_dir), daemon=True)
    thread.start()
    return {"jobId": job_id, "command": job["command"], "python": _PSA_PYTHON}


def _append_log(job_id: str, line: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        logs = job["logs"]
        logs.append(line)
        if len(logs) > _MAX_LOG_LINES:
            del logs[: len(logs) - _MAX_LOG_LINES]


def _run_pipeline(job_id: str, command: list, cwd: str):
    """subprocess 로 Main.py 를 실행하며 stdout 을 라인 단위로 누적한다."""
    try:
        proc = subprocess.Popen(
            command,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except Exception as exc:  # noqa: BLE001
        _append_log(job_id, f"[치명] 해석 프로세스 실행 실패: {exc}")
        _finish(job_id, status="failed", returncode=-1)
        return

    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            line = line.rstrip("\n")
            if line:
                _append_log(job_id, line)
        proc.wait(timeout=_PSA_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        _append_log(job_id, f"[치명] 해석 시간 초과({_PSA_TIMEOUT}s) — 프로세스를 종료했습니다.")
        _finish(job_id, status="failed", returncode=-2)
        return
    except Exception as exc:  # noqa: BLE001
        _append_log(job_id, f"[치명] 해석 중 예외: {exc}")
        _finish(job_id, status="failed", returncode=-1)
        return

    rc = proc.returncode
    report_ready = os.path.isfile(os.path.join(cwd, _REPORT_NAME))
    _finish(job_id, status="done" if rc == 0 else "failed", returncode=rc, report_ready=report_ready)


def _finish(job_id: str, status: str, returncode: int, report_ready: bool = False):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        # 실패이면서 솔버 의존성(scipy/pyNastran) 부재가 원인이면, 사용자용 친절한 진단을 덧붙인다.
        if status == "failed":
            joined = "\n".join(job["logs"])
            if "No module named 'scipy'" in joined or "No module named 'pyNastran'" in joined \
                    or "No module named" in joined:
                job["diagnostic"] = "solver_env_missing"
                job["logs"].append(
                    "[안내] 해석 솔버 환경이 이 컴퓨터에 없습니다. 배관응력 해석에는 "
                    "scipy·pyNastran 과 Abaqus(외부 솔버)가 필요합니다. 솔버가 설치된 파이썬을 "
                    "DOUBLEPIPE_PSA_PYTHON 환경변수로 지정하거나, Abaqus 가 설치된 서버에서 실행하세요."
                )
        job["status"] = status
        job["returncode"] = returncode
        job["reportReady"] = report_ready
        job["finishedAt"] = datetime.now().isoformat(timespec="seconds")


def get_psa_job(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="해당 해석 작업을 찾을 수 없습니다(서버 재시작으로 소실되었을 수 있음).")
        return dict(job)
