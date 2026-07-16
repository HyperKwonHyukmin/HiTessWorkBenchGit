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
import signal
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
# 서식 템플릿 원본(프로그램 폴더). make_report() 가 cwd(job_dir) 상대경로로 이 이름을 읽으므로,
# 실행 직전 job_dir 로 복사해 둬야 이미지·서식이 살아있는 보고서가 나온다(복사 안 하면 빈 워크북).
_REPORT_TEMPLATE_SRC = os.path.join(_PSA_DIR, _REPORT_NAME)

# userConnection 폴더 명명에 쓰는 프로그램 이름 (doublepipe_service.py 와 동일 규칙:
# {timestamp}_{employee_id}_{ProgramName}). Tab2 직접 업로드 경로가 새 작업 폴더를 만들 때 사용.
_PROGRAM_NAME = "DoublePipeFuelLine"

# 최대 실행 시간(초) — Abaqus 반복 해석까지 고려. 필요 시 env 로 override.
_PSA_TIMEOUT = int(os.environ.get("DOUBLEPIPE_PSA_TIMEOUT", "7200"))

# jobId -> 작업 상태(인메모리). 서버 재시작 시 소실(다른 앱과 동일한 구조적 한계).
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()

# ── Abaqus 라이센스 락 ──────────────────────────────────────────────────
# Abaqus 는 서버(145) 1대 = 라이센스 1개다. 따라서 running 인 PSA 작업은 동시에 최대 1개만
# 허용한다. _active_job_id 가 그 단일 running 작업을 가리키며 반드시 _jobs_lock 하에서 읽고 쓴다.
# 이 값이 곧 "라이센스 점유" 상태다 — 다른 사용자는 이게 있으면 페이지 진입이 잠긴다.
# (앱 락은 best-effort UX 다. 서버 재시작 등으로 이 값이 사라져도 Abaqus 자체 라이센스 매니저가
#  2번째 solve 의 체크아웃을 거부하는 것이 최종 백스톱이다.)
_active_job_id: "str | None" = None

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


def _now_epoch() -> float:
    return datetime.now().timestamp()


def _get_active_job_locked() -> "dict | None":
    """_jobs_lock 보유 상태에서 호출. 현재 running 인(라이센스 점유) 작업을 반환하거나 None."""
    if _active_job_id is None:
        return None
    job = _jobs.get(_active_job_id)
    if job and job.get("status") == "running":
        return job
    return None  # 이미 종료됨(정합성 안전장치)


def _raise_license_busy(active: dict):
    """라이센스 점유 중임을 알리는 409 를 던진다(프론트가 elapsed 표시에 사용)."""
    now = _now_epoch()
    raise HTTPException(
        status_code=409,
        detail={
            "code": "license_busy",
            "message": "All licenses are currently occupied. Please try again later",
            "startedAtEpoch": active.get("startedAtEpoch"),
            "elapsedSec": int(max(0, now - (active.get("startedAtEpoch") or now))),
        },
    )


def _ensure_license_available():
    """running 작업이 있으면 409 로 실패(파일 저장/폴더 생성 전 fail-fast)."""
    with _jobs_lock:
        active = _get_active_job_locked()
        if active is not None:
            _raise_license_busy(active)


def _normalize_load_cases(raw) -> "list[str] | None":
    """요청의 load_cases(리스트 또는 콤마/공백 문자열)를 'L<n>'(1~29) 태그 리스트로 정규화한다.

    None/빈 값이면 None(전체 해석)을 돌려준다. 잘못된 토큰은 400 으로 거른다(엔진도 재검증하지만
    서버 진입에서 fail-fast). 중복은 제거하되 입력 순서를 보존한다(엔진이 어차피 L번호로 정렬).
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        items = [raw]
    else:
        items = list(raw)

    tokens = []
    for item in items:
        tokens += [t for t in re.split(r"[\s,]+", str(item)) if t]

    normalized: list[str] = []
    seen = set()
    for tok in tokens:
        m = re.fullmatch(r"[Ll]?(\d{1,2})", tok.strip())
        if not m:
            raise HTTPException(status_code=400, detail=f"올바르지 않은 Load Case 입력: '{tok}' (예: L18)")
        n = int(m.group(1))
        if not (1 <= n <= 29):
            raise HTTPException(status_code=400, detail=f"Load Case 범위 초과: 'L{n}' (허용: L1~L29)")
        tag = f"L{n}"
        if tag not in seen:
            seen.add(tag)
            normalized.append(tag)
    return normalized or None


def start_psa_job(work_dir: str, result_csv: str, employee_id: str, load_cases=None) -> dict:
    """Tab1 작업 폴더에 이미 저장된 결과 CSV 로 PSA 해석을 백그라운드로 시작한다.

    load_cases 가 None/빈 값이면 전체 29개, 지정되면 그 Load Case(+엔진이 L17 자동 포함)만 해석한다.
    """
    _ensure_license_available()  # 라이센스 점유 중이면 조기 409
    lcs = _normalize_load_cases(load_cases)  # 잘못된 LC 면 파일 확인 전 400

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

    return _launch_job(csv_path, employee_id, lcs)


def start_psa_job_from_upload(csv_bytes: bytes, csv_name: str, employee_id: str, load_cases=None) -> dict:
    """Tab2 에서 직접 업로드한 내관 포함 배관 CSV 로 PSA 해석을 시작한다.

    Tab1(inner-pipe-preview)을 거치지 않는 독립 실행 경로다. Tab1 과 동일하게
    {timestamp}_{employee_id}_DoublePipeFuelLine 작업 폴더를 새로 만들어 업로드 CSV 를 저장하고,
    그 폴더를 cwd 로 삼아 exe 를 돌린다(산출물 Report/txt 등이 이 폴더에 모임). 반환에는 jobId 와
    함께 이후 단계(Tab3 리포트)가 참조할 workDir/resultCsv 를 포함한다.
    load_cases 가 None/빈 값이면 전체 29개, 지정되면 그 Load Case(+L17 자동)만 해석한다.
    """
    if not csv_bytes:
        raise HTTPException(status_code=400, detail="업로드된 CSV 파일이 비어 있습니다.")

    _ensure_license_available()  # 업로드 파일 저장/폴더 생성 전 fail-fast
    lcs = _normalize_load_cases(load_cases)  # 잘못된 LC 면 파일 저장 전 400

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

    result = _launch_job(csv_path, employee_id, lcs)
    result["workDir"] = folder_name
    result["resultCsv"] = safe_name
    return result


def _launch_job(csv_path: str, employee_id: str, load_cases=None) -> dict:
    """userConnection 하위 절대경로 csv_path 를 입력으로 PSA exe 를 백그라운드 스레드로 실행한다.

    Tab1 결과 CSV(start_psa_job)와 Tab2 직접 업로드(start_psa_job_from_upload)가 공유하는
    실행 로직 — exe 존재 확인 → (라이센스 원자적 점유) job 등록 → 스레드 기동.
    load_cases 가 지정되면 `--load-cases L18,L20,...` 인자를 붙여 선택 해석, 없으면 전체 29개.
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
    # 선택 Load Case 지정 시에만 --load-cases 를 붙인다(미지정=엔진 기본 전체 29개).
    if load_cases:
        command += ["--load-cases", ",".join(load_cases)]

    job_id = uuid.uuid4().hex[:12]
    now_epoch = _now_epoch()
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
        "employeeId": employee_id or "unknown",
        "loadCases": list(load_cases) if load_cases else None,  # None=전체 / 리스트=선택(로그·표시용)
        "startedAt": now,
        "startedAtEpoch": now_epoch,
        "finishedAt": None,
        "pid": None,                   # Popen 성공 후 채워짐(해석 중단 시 트리 종료용)
    }
    # 라이센스 원자적 점유: 여기서 running 작업이 이미 있으면 등록하지 않고 409.
    # (진입점의 _ensure_license_available 는 fail-fast 이고, 이 블록이 레이스 최종 관문이다.)
    global _active_job_id
    with _jobs_lock:
        active = _get_active_job_locked()
        if active is not None:
            _raise_license_busy(active)
        _jobs[job_id] = job
        _active_job_id = job_id

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


def _stage_report_template(cwd: str, job_id: str):
    """서식 템플릿(Report for PSA.xlsx)을 job 폴더(cwd)로 복사한다.

    make_report() 는 이 파일을 cwd 상대경로("Report for PSA.xlsx")로 열어 결과 셀만 채우고
    나머지 서식·이미지(LC 시트당 도형/그림 31개)를 보존한다. job 폴더에 템플릿이 없으면
    openpyxl.Workbook() 빈 워크북으로 폴백해 서식·이미지가 전부 사라진 보고서가 나온다
    (cwd 를 _PSA_DIR→job_dir 로 옮긴 뒤 이 복사가 빠져 발생한 회귀). 항상 원본을 새로 덮어써
    이전 실행의 채워진 보고서가 아니라 깨끗한 템플릿에서 시작하게 한다.

    회사 DRM 은 '읽기' 시점에 복호화하므로 read()->write()(copyfileobj) 로 복호화본을 job 폴더에
    둔다(analysis.py 의 DRM 입력 복사와 동일 패턴). 복사에 실패해도 해석 자체는 진행하되,
    보고서가 빈 서식으로 나올 수 있음을 로그로 남긴다.
    """
    dst = os.path.join(cwd, _REPORT_NAME)
    try:
        with open(_REPORT_TEMPLATE_SRC, "rb") as src, open(dst, "wb") as out:
            shutil.copyfileobj(src, out)
    except FileNotFoundError:
        _append_log(
            job_id,
            f"[서식경고] 보고서 서식 템플릿을 찾지 못했습니다({_REPORT_TEMPLATE_SRC}). "
            "보고서가 서식 없이(빈 워크북) 생성될 수 있습니다 — 서버 관리자에게 문의하세요.",
        )
    except Exception as exc:  # noqa: BLE001
        _append_log(
            job_id,
            f"[서식경고] 보고서 서식 템플릿 복사에 실패했습니다: {exc}. "
            "보고서가 서식 없이 생성될 수 있습니다.",
        )


def _run_pipeline(job_id: str, command: list, cwd: str):
    """subprocess 로 Main.py 를 실행하며 stdout 을 라인 단위로 누적한다."""
    # ⚠️ exe 가 파이프라인 끝에서 make_report() 로 이 템플릿을 cwd 상대경로로 읽으므로,
    # Abaqus 해석 시작 전에 미리 job 폴더로 복사해 둔다.
    _stage_report_template(cwd, job_id)
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

    # pid 저장 — 해석 중단(cancel) 시 exe→abaqus 프로세스 트리를 종료하는 데 쓴다.
    with _jobs_lock:
        running = _jobs.get(job_id)
        if running is not None:
            running["pid"] = proc.pid

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
    global _active_job_id
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        # 이미 종료 처리된 작업이면(예: cancel_psa_job 이 먼저 failed 로 전이) 덮어쓰지 않는다 —
        # kill 이후 _run_pipeline 이 다시 _finish 를 부르더라도 'cancelled' 진단과 상태를 보존한다.
        if job.get("status") != "running":
            return
        # 라이센스 해제 — 이 작업이 점유 중이던 running 작업이면 슬롯을 비운다.
        if _active_job_id == job_id:
            _active_job_id = None
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
        return {k: v for k, v in job.items() if k != "pid"}  # 내부 pid 는 노출하지 않는다


def get_active_status() -> dict:
    """현재 라이센스를 점유(running)한 PSA 작업 상태. 페이지 락 판정·재연결·전역 위젯의 단일 진실원.

    employeeId 는 프론트가 "내 작업인가"를 분기하는 데만 쓰며 화면에는 경과시간(elapsedSec)만 노출한다.
    serverNowEpoch 를 함께 주어 클라이언트가 시계 오차를 보정해 로컬 타이머를 돌릴 수 있게 한다.
    """
    now = _now_epoch()
    with _jobs_lock:
        job = _get_active_job_locked()
        if job is None:
            return {"active": False, "serverNowEpoch": now}
        started = job.get("startedAtEpoch") or now
        return {
            "active": True,
            "jobId": job["jobId"],
            "employeeId": job.get("employeeId"),
            "startedAtEpoch": started,
            "serverNowEpoch": now,
            "elapsedSec": int(max(0, now - started)),
            "status": job.get("status"),
            "lastLog": job["logs"][-1] if job.get("logs") else "",
        }


def _kill_process_tree(pid: int, job_id: str):
    """exe→abaqus 자식까지 프로세스 트리를 종료한다(Windows taskkill /T)."""
    if not pid:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True, timeout=30, creationflags=_SUBPROC_FLAGS,
            )
        else:
            os.kill(pid, signal.SIGKILL)
    except Exception as exc:  # noqa: BLE001
        _append_log(job_id, f"[중단경고] 프로세스 종료 중 문제가 있었습니다: {exc}")


def cancel_psa_job(job_id: str, employee_id: str) -> dict:
    """실행 중인 PSA 해석을 소유자가 중단한다 — 프로세스 트리 종료 + 라이센스 즉시 해제."""
    global _active_job_id
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="해당 해석 작업을 찾을 수 없습니다(서버 재시작으로 소실되었을 수 있음).")
        if job.get("status") != "running":
            return {"cancelled": False, "status": job.get("status"), "message": "이미 종료된 작업입니다."}
        owner = job.get("employeeId")
        # 본인이 시작한 해석만 중단 가능(사번 일치). owner 가 unknown 이면 소유자 확인을 생략한다.
        if owner and owner != "unknown" and employee_id and employee_id != owner:
            raise HTTPException(status_code=403, detail="본인이 시작한 해석만 중단할 수 있습니다.")
        pid = job.get("pid")

    # kill 은 lock 밖에서(타임아웃 동안 다른 요청 차단 방지).
    _kill_process_tree(pid, job_id)

    # 상태를 직접 failed(cancelled)로 전이 → 라이센스 해제. 이후 _run_pipeline 의 _finish 는
    # status!='running' 가드로 이 상태를 덮어쓰지 않는다.
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job and job.get("status") == "running":
            job["status"] = "failed"
            job["returncode"] = -3
            job["diagnostic"] = "cancelled"
            job["finishedAt"] = datetime.now().isoformat(timespec="seconds")
            job["logs"].append("[중단] 사용자 요청으로 해석을 중단했습니다. (라이센스가 해제되었습니다)")
            if _active_job_id == job_id:
                _active_job_id = None
    return {"cancelled": True}
