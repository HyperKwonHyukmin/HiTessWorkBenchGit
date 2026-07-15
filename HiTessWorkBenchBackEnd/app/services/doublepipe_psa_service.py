"""이중관 연료배관 — 전체 Load Case 배관응력 해석(PSA) 실행 서비스.

Tab1(Design Inner Support)에서 생성한 내관 포함 결과 CSV(userConnection 작업 폴더에 저장됨)를
InHouseProgram/DoublePipe/"Piping Stress Analysis for all load cases"/PSA_AllLoadCases.exe 의
입력으로 넘겨 전체 29개 Load Case(OPE 16 + SUS 1 + OCC 6 + EXP 6)를 해석한다.

PSA_AllLoadCases.exe 는 원본 Main.py(+scipy·pyNastran·numpy·openpyxl)를 PyInstaller 로 단일
실행파일로 빌드한 것이며, 위치 인자 하나(csv 경로)만 받고 항상 전체 Load Case 를 해석한다:
    PSA_AllLoadCases.exe <csv_path>

⚠️ scipy·pyNastran·numpy·openpyxl 은 exe 안에 이미 번들되어 있어 실행 컴퓨터에 별도 파이썬
   환경을 준비할 필요가 없다(DOUBLEPIPE_PSA_PYTHON 등 환경변수 불필요, 2026-07 exe 전환 이전
   방식). 다만 Abaqus(외부 CAE 솔버)만은 여전히 그 컴퓨터에 설치되어 PATH 의 `abaqus` 명령으로
   실행 가능해야 한다 — exe 는 파이썬 의존성만 해결하며 Abaqus 자체를 대체하지 않는다.
   - Abaqus 가 백엔드 프로세스 PATH 에 없으면(서비스로 기동/PATH 등록 이전에 뜬 셸 등)
     _build_subprocess_env 가 흔한 설치 경로나 환경변수 ABAQUS_COMMANDS_DIR 로 런처 폴더를
     찾아 자식 env 의 PATH 앞에 주입한다 — exe 가 내부에서 부르는 `abaqus` 가 이를 상속한다.
   - 실행은 백그라운드 스레드에서 subprocess 로 수행하고, stdout 을 라인 단위로 누적해
     프론트가 status 폴링으로 로그를 받아볼 수 있게 한다(작업 상태는 인메모리).
"""
import glob
import os
import re
import shutil
import subprocess
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
_PSA_EXE_NAME = "PSA_AllLoadCases.exe"
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")
_REPORT_NAME = "Report for PSA.xlsx"

# userConnection 폴더 명명에 쓰는 프로그램 이름 (doublepipe_service.py 와 동일 규칙:
# {timestamp}_{employee_id}_{ProgramName}). Tab2 직접 업로드 경로가 새 작업 폴더를 만들 때 사용.
_PROGRAM_NAME = "DoublePipeFuelLine"

# 최대 실행 시간(초) — Abaqus 반복 해석까지 고려. 필요 시 env 로 override.
_PSA_TIMEOUT = int(os.environ.get("DOUBLEPIPE_PSA_TIMEOUT", "7200"))

# jobId -> 작업 상태(인메모리). 서버 재시작 시 소실(다른 앱과 동일한 구조적 한계).
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()

_MAX_LOG_LINES = 3000  # 로그 폭주 방지 상한

# ⚠️ 서버 안정성: PSA exe 는 내부에서 Abaqus(외부 solver)를 shell 로 호출한다. Abaqus 가
# 종료되며 CTRL_BREAK 콘솔 신호를 던지면, 콘솔을 공유하는 부모 uvicorn 까지 함께 죽는다
# (무-로그 급사). CREATE_NO_WINDOW 로 자식에게 독립 콘솔을 주고 CREATE_NEW_PROCESS_GROUP
# 로 프로세스 그룹을 분리해, 자식 트리의 콘솔 신호가 서버로 전파되지 않게 한다.
_SUBPROC_FLAGS = 0
if os.name == "nt":
    _SUBPROC_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(
        subprocess, "CREATE_NEW_PROCESS_GROUP", 0
    )

# ── Abaqus 런처(PATH) 해석 ───────────────────────────────────────────────
# PSA exe 는 내부에서 `abaqus job=...` 를 shell 로 호출하는데, 이는 자식이 상속한 PATH 로만
# 해석된다. 백엔드(uvicorn)가 abaqus 미등록 PATH 로 떠 있으면 "'abaqus'은(는) … 아닙니다"
# (abaqus_not_found)로 전체 해석이 실패한다. → 실행 직전 abaqus 가 PATH 로 안 잡히면 런처
# 폴더를 찾아 자식 env 의 PATH 앞에 주입한다. 우선순위: 현재 PATH → ABAQUS_COMMANDS_DIR
# 환경변수 → 흔한 설치 경로 자동 탐지.
_ABAQUS_ENV_VAR = "ABAQUS_COMMANDS_DIR"
_ABAQUS_LAUNCHER_NAMES = ("abaqus.bat", "abaqus.exe", "abaqus")
# 버전 폴더는 glob 로 매칭 후 최신(역순 정렬) 우선.
_ABAQUS_CANDIDATE_GLOBS = (
    r"C:\SIMULIA\Commands",
    r"C:\SIMULIA\Abaqus\Commands",
    r"C:\SIMULIA\CAE\*\win_b64\code\bin",
    r"C:\Program Files\SIMULIA\*\win_b64\code\bin",
    r"C:\Program Files\Dassault Systemes\SIMULIA\*\win_b64\code\bin",
)


def start_psa_job(work_dir: str, result_csv: str, employee_id: str) -> dict:
    """Tab1 작업 폴더에 이미 저장된 결과 CSV 로 전체 Load Case PSA 해석을 백그라운드로 시작한다."""
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

    return _launch_job(csv_path)


def start_psa_job_from_upload(csv_bytes: bytes, csv_name: str, employee_id: str) -> dict:
    """Tab2 에서 직접 업로드한 내관 포함 배관 CSV 로 전체 Load Case PSA 해석을 시작한다.

    Tab1(inner-pipe-preview)을 거치지 않는 독립 실행 경로다. Tab1 과 동일하게
    {timestamp}_{employee_id}_DoublePipeFuelLine 작업 폴더를 새로 만들어 업로드 CSV 를 저장하고,
    그 폴더를 cwd 로 삼아 exe 를 돌린다(산출물 Report/txt 등이 이 폴더에 모임). 반환에는 jobId 와
    함께 이후 단계(Tab3 리포트)가 참조할 workDir/resultCsv 를 포함한다.
    """
    if not csv_bytes:
        raise HTTPException(status_code=400, detail="업로드된 CSV 파일이 비어 있습니다.")

    # 폴더명에 들어가는 사번은 경로 조작 문자를 제거해 userConnection 밖으로 새지 않게 한다.
    safe_employee = re.sub(r"[^A-Za-z0-9_-]", "", employee_id or "") or "unknown"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder_name = f"{timestamp}_{safe_employee}_{_PROGRAM_NAME}"
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, folder_name))
    os.makedirs(work_dir, exist_ok=True)

    safe_name = os.path.basename(csv_name or "") or "psa_input.csv"
    if not safe_name.lower().endswith(".csv"):
        safe_name += ".csv"
    csv_path = os.path.join(work_dir, safe_name)
    with open(csv_path, "wb") as f:
        f.write(csv_bytes)

    result = _launch_job(csv_path)
    result["workDir"] = folder_name
    result["resultCsv"] = safe_name
    return result


def _launch_job(csv_path: str) -> dict:
    """userConnection 하위 절대경로 csv_path 를 입력으로 PSA exe 를 백그라운드 스레드로 실행한다.

    Tab1 결과 CSV(start_psa_job)와 Tab2 직접 업로드(start_psa_job_from_upload)가 공유하는
    실행 로직 — exe 존재 확인 → job 등록 → 스레드 기동.
    """
    psa_exe_path = os.path.join(_PSA_DIR, _PSA_EXE_NAME)
    if not os.path.isdir(_PSA_DIR) or not os.path.isfile(psa_exe_path):
        raise HTTPException(status_code=503, detail=f"PSA 해석 프로그램({_PSA_EXE_NAME})을 찾을 수 없습니다. 서버 관리자에게 문의하세요.")

    # ⚠️ cwd 는 반드시 CSV 가 있는 폴더(job_dir)여야 한다 — Main.py 내부의 write_LC()/
    # make_report()/F06Format 이 "Report for PSA.xlsx", "Inforget_f06.txt", "L*_stress.txt" 등을
    # 전부 cwd 상대경로로 읽고 쓰기 때문(원본 이식 문서 §6-5·§9-3). exe 자체는 절대경로로
    # 지정해 cwd 와 무관하게 실행되게 하고, 하위 산출물만 job_dir 에 모이도록 한다. _PSA_DIR 를
    # cwd 로 쓰면 동시 작업 간 산출물이 서로 덮어써지고 make_report() 가 파일을 못 찾아
    # 빈 보고서가 나온다.
    job_dir = os.path.dirname(csv_path)
    command = [psa_exe_path, csv_path]

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
    }
    with _jobs_lock:
        _jobs[job_id] = job

    thread = threading.Thread(target=_run_pipeline, args=(job_id, command, job_dir), daemon=True)
    thread.start()
    return {"jobId": job_id, "command": job["command"]}


def _append_log(job_id: str, line: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        logs = job["logs"]
        logs.append(line)
        if len(logs) > _MAX_LOG_LINES:
            del logs[: len(logs) - _MAX_LOG_LINES]


def _dir_has_abaqus_launcher(d: str) -> bool:
    """디렉터리 d 안에 abaqus 런처(abaqus.bat/.exe)가 있으면 True."""
    if not d or not os.path.isdir(d):
        return False
    return any(os.path.isfile(os.path.join(d, name)) for name in _ABAQUS_LAUNCHER_NAMES)


def _resolve_abaqus_commands_dir() -> "str | None":
    """abaqus 런처가 있는 폴더를 찾는다: ABAQUS_COMMANDS_DIR → 흔한 설치 경로 자동 탐지."""
    override = os.environ.get(_ABAQUS_ENV_VAR, "").strip().strip('"')
    if override and _dir_has_abaqus_launcher(override):
        return override
    for pattern in _ABAQUS_CANDIDATE_GLOBS:
        for d in sorted(glob.glob(pattern), reverse=True):
            if _dir_has_abaqus_launcher(d):
                return d
    return None


def _build_subprocess_env(job_id: str) -> dict:
    """자식(exe → abaqus)이 상속할 환경을 만든다.

    abaqus 가 현재 PATH 로 이미 잡히면 그대로 두고, 안 잡히면 런처 폴더를 찾아 PATH 앞에
    주입한다(찾으면 알림 로그, 못 찾으면 경고 로그). 이 env 를 exe 에 넘기면 exe 가 내부에서
    부르는 `abaqus` 도 같은 PATH 를 상속하므로 abaqus_not_found 를 방지한다.
    """
    env = os.environ.copy()
    if shutil.which("abaqus"):
        return env  # 이미 PATH 로 해석됨 — 주입 불필요
    abaqus_dir = _resolve_abaqus_commands_dir()
    if abaqus_dir:
        env["PATH"] = abaqus_dir + os.pathsep + env.get("PATH", "")
        _append_log(job_id, f"[환경] abaqus 가 PATH 에 없어 '{abaqus_dir}' 를 PATH 앞에 주입했습니다.")
    else:
        _append_log(
            job_id,
            "[환경경고] abaqus 런처를 PATH 에서도 흔한 설치 경로에서도 찾지 못했습니다. "
            f"환경변수 {_ABAQUS_ENV_VAR} 에 런처 폴더(예: C:\\SIMULIA\\Commands)를 지정하거나 "
            "Abaqus 설치 후 시스템 PATH 에 등록하고 백엔드를 재시작하세요.",
        )
    return env


def _run_pipeline(job_id: str, command: list, cwd: str):
    """subprocess 로 Main.py 를 실행하며 stdout 을 라인 단위로 누적한다."""
    env = _build_subprocess_env(job_id)
    try:
        proc = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=_SUBPROC_FLAGS,
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
        # 실패 원인별 사용자용 친절한 진단을 덧붙인다.
        if status == "failed":
            joined = "\n".join(job["logs"])
            if "No module named" in joined:
                # exe 에 scipy/pyNastran/numpy/openpyxl 이 번들되어 있어 정상적으론 발생하지 않아야
                # 함 — 발생하면 exe 자체가 손상/구버전일 가능성이 높다.
                job["diagnostic"] = "solver_env_missing"
                job["logs"].append(
                    f"[안내] 해석 프로그램({_PSA_EXE_NAME}) 내부에 필요한 모듈이 빠져 있습니다. "
                    "exe 가 손상되었거나 구버전일 수 있습니다 — 서버 관리자에게 문의하세요."
                )
            elif "abaqus" in joined.lower() and (
                "내부 또는 외부 명령" in joined or "not recognized" in joined.lower()
            ):
                job["diagnostic"] = "abaqus_not_found"
                job["logs"].append(
                    "[안내] 이 컴퓨터에서 'abaqus' 명령을 찾을 수 없습니다. Abaqus CAE(외부 솔버)가 "
                    "설치되어 있고 PATH 에 등록되어 있는지 확인하세요."
                )
            elif "Abaqus/Analysis exited with errors" in joined or "Abaqus 해석" in joined:
                job["diagnostic"] = "abaqus_solve_failed"
                job["logs"].append(
                    "[안내] Abaqus 해석이 오류로 종료되었습니다. 위 로그의 Abaqus 메시지를 확인하세요."
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
