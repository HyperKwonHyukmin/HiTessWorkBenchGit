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
import logging
import os
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime

from fastapi import HTTPException

# 다른 해석 앱(truss_service 등)과 동일하게 완료 시 Analysis DB 레코드를 남겨 MyProjects·이력에
# 노출되게 한다. 이 서비스는 job_manager 를 거치지 않고 자체 _jobs 스토어로 동작하므로,
# 완료·중단 시점에 직접 record_analysis 를 호출해야 DB 에 저장된다.
from .analysis_runner import record_analysis
from .workspace import create_analysis_workspace

logger = logging.getLogger(__name__)

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
#
# ⚠️ DRM 함정: 회사 DRM 은 .xlsx 를 at-rest 로 암호화(HHIDRMC, +4096B)하고 로컬 프로세스는 복호화
# 못 한다. 소스가 .xlsx 면 145 에서 이 원본이 암호화돼 있을 때 백엔드가 '암호화된 쓰레기'를 job 폴더로
# 복사 → exe preload 가 BadZipFile → 빈 워크북(≈288KB) 보고서가 된다. 그래서 DRM 이 건드리지 않는
# 비-Office 확장자 .bin 으로 템플릿을 보관하고(항상 PK 로 읽힘) 이걸 1순위 소스로 쓴다.
# _REPORT_TEMPLATE_BIN 이 없거나 PK 가 아니면 기존 .xlsx 로 폴백한다.
_REPORT_TEMPLATE_BIN = os.path.join(_PSA_DIR, "report_template.bin")
_REPORT_TEMPLATE_SRC = os.path.join(_PSA_DIR, _REPORT_NAME)
_ZIP_MAGIC = b"PK\x03\x04"

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
_OUTPUT_READER_JOIN_TIMEOUT = 5.0
_PROCESS_REAP_TIMEOUT = 5.0
_PROCESS_PUBLISH_TIMEOUT = 35.0

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
    work_dir, _timestamp = create_analysis_workspace(
        _USER_CONNECTION_DIR,
        safe_employee,
        _PROGRAM_NAME,
    )
    folder_name = os.path.basename(work_dir)

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
        "_process": None,
        "_processReady": threading.Event(),
        "_terminationLock": threading.Lock(),
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
    try:
        thread.start()
    except Exception as exc:
        # 등록/라이센스 점유 뒤 스레드 기동이 실패하면 영구 busy가 되지 않도록 즉시 terminal
        # 상태로 전이한다. 프로세스는 아직 생성되지 않았으므로 슬롯 해제가 안전하다.
        with _jobs_lock:
            failed_job = _jobs.get(job_id)
            if failed_job is not None:
                failed_job["status"] = "failed"
                failed_job["returncode"] = -1
                failed_job["diagnostic"] = "thread_start_failed"
                failed_job["finishedAt"] = datetime.now().isoformat(timespec="seconds")
                failed_job["logs"].append(f"[치명] 해석 작업 스레드 시작 실패: {exc}")
                failed_job["_processReady"].set()
                if _active_job_id == job_id:
                    _active_job_id = None
        logger.exception("PSA job thread start failed (job_id=%s)", job_id)
        _record_psa_analysis(job)
        raise HTTPException(
            status_code=503,
            detail="PSA 해석 작업을 시작하지 못했습니다. 잠시 후 다시 시도하세요.",
        ) from exc
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


def _read_template_bytes(job_id: str):
    """서식 템플릿을 PK(zip) 바이트로 읽어 반환한다. 실패 시 None.

    1순위: report_template.bin (DRM 비-대상 확장자 → 항상 PK 로 읽힘, 145 에서도 안 깨짐)
    2순위: Report for PSA.xlsx (폴백 — 단 DRM 암호화 시 HHIDRMC 라 PK 검사에서 걸러짐)
    각 후보를 read() 한 뒤 첫 4바이트가 PK 매직인지 확인해 '암호화된 소스'를 조기에 잡아낸다.
    """
    candidates = [
        (_REPORT_TEMPLATE_BIN, "report_template.bin"),
        (_REPORT_TEMPLATE_SRC, _REPORT_NAME),
    ]
    for path, label in candidates:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "rb") as f:
                data = f.read()
        except Exception as exc:  # noqa: BLE001
            _append_log(job_id, f"[서식경고] 템플릿 소스 읽기 실패({label}): {exc}")
            continue
        if data[:4] == _ZIP_MAGIC:
            _append_log(
                job_id,
                f"[서식] 템플릿 소스 확보: {label} (PK 정상, {len(data):,} bytes)",
            )
            return data
        head = data[:7]
        drm = " — DRM 암호화(HHIDRMC)로 추정" if head == b"HHIDRMC" else ""
        _append_log(
            job_id,
            f"[서식경고] 템플릿 소스 {label} 가 PK(zip) 가 아님(첫바이트 {head.hex()}){drm}. 다음 후보로.",
        )
    return None


def _stage_report_template(cwd: str, job_id: str):
    """서식 템플릿을 PK 바이트로 job 폴더(cwd)에 'Report for PSA.xlsx' 로 새로 쓴다.

    make_report() 는 이 파일을 cwd 상대경로("Report for PSA.xlsx")로 열어 결과 셀만 채우고
    나머지 서식·이미지(LC 시트당 도형/그림 31개)를 보존한다. job 폴더에 유효한 PK 템플릿이 없으면
    exe 의 preload 가 실패해 openpyxl.Workbook() 빈 워크북으로 폴백 → 서식·이미지가 전부 사라진
    ≈288KB 보고서가 나온다. 항상 깨끗한 템플릿을 새로 덮어써 이전 실행 결과가 섞이지 않게 한다.

    ★ DRM 대응: 소스를 .bin(비-Office 확장자)로 두면 회사 DRM 이 암호화하지 않아 로컬 프로세스가
    항상 PK 로 읽는다. 여기서 PK 를 확인한 바이트만 job 폴더에 쓰므로, exe 가 파이프라인 시작 시
    (DRM 이 갓 쓴 사본을 암호화하기 전, 수초 내) preload 로 이 PK 파일을 메모리에 올릴 수 있다.
    복사가 실패해도 해석 자체는 진행하되, 보고서가 빈 서식일 수 있음을 로그로 분명히 남긴다.
    """
    dst = os.path.join(cwd, _REPORT_NAME)
    data = _read_template_bytes(job_id)
    if data is None:
        _append_log(
            job_id,
            "[서식경고] 유효한(PK) 서식 템플릿 소스를 찾지 못했습니다 "
            f"(.bin={_REPORT_TEMPLATE_BIN}, .xlsx={_REPORT_TEMPLATE_SRC}). "
            "보고서가 서식·이미지 없이(빈 워크북, ≈288KB) 생성될 수 있습니다 — "
            "서버 관리자: report_template.bin 을 프로그램 폴더에 두세요.",
        )
        return
    try:
        with open(dst, "wb") as out:
            out.write(data)
    except Exception as exc:  # noqa: BLE001
        _append_log(
            job_id,
            f"[서식경고] 서식 템플릿을 job 폴더에 쓰지 못했습니다: {exc}. "
            "보고서가 서식 없이 생성될 수 있습니다.",
        )
        return
    # 방금 쓴 job 폴더 사본이 PK 인지 즉시 재확인(쓰기 직후엔 아직 DRM 암호화 전이어야 정상).
    try:
        with open(dst, "rb") as f:
            head = f.read(4)
    except Exception:  # noqa: BLE001
        head = b""
    if head == _ZIP_MAGIC:
        _append_log(job_id, f"[서식] 템플릿을 job 폴더로 스테이징 완료(PK 확인): {dst}")
    else:
        _append_log(
            job_id,
            f"[서식경고] 스테이징 직후 job 폴더 사본이 PK 가 아닙니다(첫바이트 {head.hex()}). "
            "DRM 이 즉시 암호화했을 수 있어 보고서 서식이 비어 나올 수 있습니다.",
        )


def _read_process_output(job_id: str, stream):
    """프로세스 stdout 을 별도 스레드에서 끝까지 읽어 작업 로그에 누적한다.

    stdout 읽기는 자식이 EOF 를 닫을 때까지 블로킹될 수 있으므로 메인 파이프라인 스레드에서
    수행하면 ``proc.wait(timeout=...)`` 에 도달하지 못한다. 이 함수는 daemon reader 전용이며,
    종료/취소 시 다른 스레드가 pipe 를 닫아 발생하는 예외는 정상 정리 과정으로 간주한다.
    """
    if stream is None:
        return
    try:
        for line in stream:
            line = line.rstrip("\r\n")
            if line:
                _append_log(job_id, line)
    except (OSError, ValueError):
        # timeout/cancel 정리 중 pipe close 로 reader 가 풀리는 정상 경로.
        return
    except Exception as exc:  # noqa: BLE001
        _append_log(job_id, f"[로그경고] 해석 프로세스 출력 읽기 실패: {exc}")


def _close_process_output(proc, reader: threading.Thread):
    """reader 를 회수하고 stdout pipe 를 닫아 핸들/스레드 누수를 방지한다."""
    stream = getattr(proc, "stdout", None)
    reader.join(timeout=_OUTPUT_READER_JOIN_TIMEOUT)
    if reader.is_alive() and stream is not None:
        # 자식이 비정상적으로 pipe 를 열어둔 경우 close 로 blocking read 를 깨운다.
        try:
            stream.close()
        except Exception:  # noqa: BLE001
            pass
        reader.join(timeout=1.0)
    elif stream is not None:
        try:
            stream.close()
        except Exception:  # noqa: BLE001
            pass


def _reap_after_tree_kill(proc) -> bool:
    """트리 종료 뒤 직계 자식을 회수한다.

    전체 트리 소멸이 먼저 검증된 뒤에만 호출된다. 직계 Popen이 아직 회수되지 않으면
    ``kill``로 폴백하고, 실제 ``wait`` 성공 여부를 반환한다.
    """
    try:
        proc.wait(timeout=_PROCESS_REAP_TIMEOUT)
        return True
    except subprocess.TimeoutExpired:
        pass
    except Exception:  # noqa: BLE001
        pass

    try:
        proc.kill()
    except Exception:  # noqa: BLE001
        return False
    try:
        proc.wait(timeout=_PROCESS_REAP_TIMEOUT)
        return True
    except Exception:  # noqa: BLE001
        return False


def _terminate_process_tree(proc, job_id: str) -> bool:
    """OS 프로세스 트리 종료와 Popen 회수를 모두 확인한 경우에만 True."""
    tree_stopped = _kill_process_tree(getattr(proc, "pid", None), job_id)
    if tree_stopped:
        parent_reaped = _reap_after_tree_kill(proc)
    else:
        # 트리 소멸을 확인하지 못한 상태에서 직계 parent만 kill하면 descendant를 남긴 채
        # pipeline 완료처럼 보일 수 있다. 이미 끝난 parent의 비차단 reap만 허용한다.
        try:
            parent_reaped = proc.poll() is not None
        except Exception:  # noqa: BLE001
            parent_reaped = False
    if not tree_stopped:
        _append_log(job_id, "[중단경고] 자식 프로세스 트리 소멸을 확인하지 못했습니다.")
    if not parent_reaped:
        _append_log(job_id, "[중단경고] 해석 프로세스 회수를 확인하지 못했습니다.")
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            if parent_reaped:
                job.pop("_terminationReapPending", None)
            else:
                job["_terminationReapPending"] = True
            if tree_stopped and parent_reaped:
                job.pop("_terminationVerificationPending", None)
                job.pop("_terminationProcesses", None)
                if job.get("diagnostic") == "termination_pending":
                    job.pop("diagnostic", None)
            else:
                job["_terminationVerificationPending"] = True
    return bool(tree_stopped and parent_reaped)


def _mark_termination_pending(job_id: str, terminal_status: str, returncode: int) -> None:
    """종료 확인 실패를 기존 status 계약(running) 안에서 보존하고 슬롯을 유지한다."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job.get("status") != "running":
            return
        job["diagnostic"] = "termination_pending"
        job["_pendingTerminal"] = {
            "status": terminal_status,
            "returncode": returncode,
        }
        job["logs"].append(
            "[중단경고] 프로세스 종료 확인 전에는 라이센스 슬롯을 해제하지 않습니다. "
            "중단을 다시 요청해 정리를 재시도하세요."
        )


def _run_pipeline(job_id: str, command: list, cwd: str):
    """subprocess 로 PSA 를 실행하고 stdout 스트리밍과 실행 제한 시간을 함께 보장한다."""
    # ⚠️ exe 가 파이프라인 끝에서 make_report() 로 이 템플릿을 cwd 상대경로로 읽으므로,
    # Abaqus 해석 시작 전에 미리 job 폴더로 복사해 둔다.
    _stage_report_template(cwd, job_id)
    env = _build_subprocess_env(job_id)
    # 취소가 thread.start 직후, Popen 직전에 도착한 경우 프로세스를 만들지 않는다.
    with _jobs_lock:
        starting = _jobs.get(job_id)
        if starting is None:
            return
        process_ready = starting.setdefault("_processReady", threading.Event())
        starting.setdefault("_terminationLock", threading.Lock())
        cancel_before_popen = bool(starting.get("_cancelRequested"))
        if cancel_before_popen:
            process_ready.set()
    if cancel_before_popen:
        _cancel_running_process(job_id)
        return

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
        with _jobs_lock:
            starting = _jobs.get(job_id)
            if starting is not None:
                starting.setdefault("_processReady", threading.Event()).set()
                cancel_requested = bool(starting.get("_cancelRequested"))
            else:
                cancel_requested = False
        if cancel_requested:
            _cancel_running_process(job_id)
            return
        _append_log(job_id, f"[치명] 해석 프로세스 실행 실패: {exc}")
        _finish(job_id, status="failed", returncode=-1)
        return

    # process object + pid 를 한 lock 구간에서 publish한 뒤 ready를 set한다. cancel은 이
    # handshake를 기다리므로 PID publish 이전 취소가 프로세스를 놓치고 슬롯을 먼저 푸는 일이 없다.
    with _jobs_lock:
        running = _jobs.get(job_id)
        if running is not None:
            running["_process"] = proc
            running["pid"] = proc.pid
            cancel_after_popen = bool(running.get("_cancelRequested"))
            running.setdefault("_processReady", threading.Event()).set()
        else:
            cancel_after_popen = False

    if cancel_after_popen:
        _cancel_running_process(job_id)
        stream = getattr(proc, "stdout", None)
        if stream is not None:
            try:
                stream.close()
            except Exception:  # noqa: BLE001
                pass
        return

    # stdout 은 EOF 가 올 때까지 블로킹될 수 있다. 별도 daemon reader 에서 스트리밍하고,
    # 현재 파이프라인 스레드는 즉시 wait(timeout) 으로 진입해야 제한 시간이 실제로 동작한다.
    output_reader = threading.Thread(
        target=_read_process_output,
        args=(job_id, proc.stdout),
        name=f"doublepipe-psa-output-{job_id}",
        daemon=True,
    )
    output_reader.start()

    outcome = "completed"
    returncode = None
    try:
        returncode = proc.wait(timeout=_PSA_TIMEOUT)
    except subprocess.TimeoutExpired:
        outcome = "timeout"
        terminated = _terminate_process_tree(proc, job_id)
        if terminated:
            _append_log(job_id, f"[치명] 해석 시간 초과({_PSA_TIMEOUT}s) — 프로세스를 종료했습니다.")
        else:
            _append_log(job_id, f"[치명] 해석 시간 초과({_PSA_TIMEOUT}s) — 프로세스 종료 확인 대기 중입니다.")
    except Exception as exc:  # noqa: BLE001
        outcome = "error"
        terminated = _terminate_process_tree(proc, job_id)
        _append_log(job_id, f"[치명] 해석 중 예외: {exc}")
    finally:
        _close_process_output(proc, output_reader)

    if outcome == "timeout":
        if not terminated:
            _mark_termination_pending(job_id, "failed", -2)
            return
        _finish(job_id, status="failed", returncode=-2)
        return
    if outcome == "error":
        if not terminated:
            _mark_termination_pending(job_id, "failed", -1)
            return
        _finish(job_id, status="failed", returncode=-1)
        return

    # Popen.wait() 의 반환값을 우선 사용하되, 일부 테스트/래퍼 구현과의 호환을 위해
    # None 인 경우 기존처럼 proc.returncode 를 읽는다.
    rc = returncode if returncode is not None else proc.returncode
    report_ready = os.path.isfile(os.path.join(cwd, _REPORT_NAME))
    _finish(job_id, status="done" if rc == 0 else "failed", returncode=rc, report_ready=report_ready)


def _record_psa_analysis(job: dict):
    """완료/중단된 PSA 작업을 Analysis DB 에 기록한다 — 다른 해석 앱과 동일하게 MyProjects·이력에 노출.

    반드시 _jobs_lock 을 놓은 뒤 호출한다(DB I/O 로 상태 폴링을 막지 않도록). 실패해도 해석 결과에는
    영향이 없어야 하므로 모든 예외를 삼키고 로그만 남긴다. status='done' → Success, 그 외 → Failed.
    """
    try:
        status_msg = "Success" if job.get("status") == "done" else "Failed"
        csv_path = job.get("csvPath") or ""
        work_dir = os.path.dirname(csv_path) if csv_path else None
        load_cases = job.get("loadCases")
        input_info = {
            "input_csv": csv_path,
            "load_cases": load_cases if load_cases else "ALL(29)",
        }
        result_info = None
        if status_msg == "Success":
            result_info = {"work_dir": work_dir}
            report_path = job.get("reportPath")
            if job.get("reportReady") and report_path and os.path.isfile(report_path):
                result_info["report"] = report_path
        project_name = f"이중관 연료배관 해석_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        _project, db_err = record_analysis(
            job_id=job.get("jobId"),
            project_name=project_name,
            program_name=_PROGRAM_NAME,       # "DoublePipeFuelLine" — 프론트가 한글 타이틀로 매핑
            employee_id=job.get("employeeId") or "unknown",
            status=status_msg,
            input_info=input_info,
            result_info=result_info,
            source="Workbench",
        )
        if db_err:
            _append_log(job.get("jobId"), f"[DB경고] 해석 이력 저장에 실패했습니다: {db_err}")
    except Exception as exc:  # noqa: BLE001
        logger.error("PSA analysis DB record failed: %s", exc, exc_info=True)


def _finish(job_id: str, status: str, returncode: int, report_ready: bool = False):
    global _active_job_id
    job_to_record = None
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        # 이미 종료 처리된 작업이면(예: cancel_psa_job 이 먼저 failed 로 전이) 덮어쓰지 않는다 —
        # kill 이후 _run_pipeline 이 다시 _finish 를 부르더라도 'cancelled' 진단과 상태를 보존한다.
        if job.get("status") != "running":
            return
        # cancel 은 느릴 수 있는 process-tree kill 을 lock 밖에서 수행한다. 그 사이 wait() 가
        # 풀려 파이프라인이 먼저 완료 상태를 쓰지 않도록, 취소 요청 표식을 최종 상태보다 우선한다.
        # cancel_psa_job 이 이어서 failed/-3 상태와 라이센스 해제를 원자적으로 기록한다.
        termination_pending = bool(
            job.get("_terminationProcesses")
            or job.get("_terminationTrackedProcesses")
            or job.get("_terminationSnapshotVerified")
            or job.get("_terminationReapPending")
            or job.get("_terminationVerificationPending")
            or job.get("diagnostic") == "termination_pending"
        )
        if job.get("_cancelRequested") or termination_pending:
            job["_deferredFinish"] = {
                "status": status,
                "returncode": returncode,
                "report_ready": report_ready,
            }
            if termination_pending:
                job["diagnostic"] = "termination_pending"
            return
        # 라이센스 해제 — 이 작업이 점유 중이던 running 작업이면 슬롯을 비운다.
        if _active_job_id == job_id:
            _active_job_id = None
        if job.get("diagnostic") == "termination_pending":
            job.pop("diagnostic", None)
        job.pop("_pendingTerminal", None)
        job.pop("_terminationReapPending", None)
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
        job_to_record = job
    # DB 기록은 lock 밖에서 — 완료 시점에 Analysis 레코드를 남겨 MyProjects 에 노출한다.
    if job_to_record is not None:
        _record_psa_analysis(job_to_record)


def get_psa_job(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="해당 해석 작업을 찾을 수 없습니다(서버 재시작으로 소실되었을 수 있음).")
        # 내부 pid/process/synchronization 표식은 API 응답에 노출하지 않는다.
        return {
            k: v for k, v in job.items()
            if k != "pid" and not k.startswith("_")
        }


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


def _capture_process_identity(process) -> dict:
    """재시도 중 PID 재사용을 구분할 수 있는 psutil Process identity를 보존한다."""
    create_time = None
    get_create_time = getattr(process, "create_time", None)
    if callable(get_create_time):
        try:
            create_time = get_create_time()
        except Exception:  # noqa: BLE001
            # psutil.Process 자체도 생성 시각을 포함한 identity를 내부에 보존한다. 생성 시각을
            # 직접 읽지 못한 경우에는 동일 Process 객체만 재사용하는 보수적 폴백을 쓴다.
            create_time = None
    return {
        "process": process,
        "pid": process.pid,
        "createTime": create_time,
    }


def _same_tracked_identity(left: dict, right: dict) -> bool:
    if left["process"] is right["process"]:
        return True
    if left["pid"] != right["pid"]:
        return False
    left_created = left.get("createTime")
    right_created = right.get("createTime")
    return (
        left_created is not None
        and right_created is not None
        and left_created == right_created
    )


def _tracked_process_state(tracked: dict, psutil) -> str:
    """tracked identity 상태를 gone/alive/unknown/mismatch 중 하나로 판정한다."""
    process = tracked["process"]
    expected_created = tracked.get("createTime")
    if expected_created is not None:
        get_create_time = getattr(process, "create_time", None)
        if not callable(get_create_time):
            return "unknown"
        try:
            if get_create_time() != expected_created:
                return "mismatch"
        except psutil.NoSuchProcess:
            return "gone"
        except (psutil.AccessDenied, OSError):
            return "unknown"

    try:
        if not process.is_running():
            return "gone"
        if process.status() == psutil.STATUS_ZOMBIE:
            return "gone"
        return "alive"
    except psutil.NoSuchProcess:
        return "gone"
    except (psutil.AccessDenied, OSError):
        return "unknown"


def _kill_process_tree(pid: int, job_id: str) -> bool:
    """exe→abaqus 전체 트리의 terminate/kill 및 소멸을 psutil로 확인한다."""
    if not pid:
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["_terminationVerificationPending"] = True
        return False
    try:
        import psutil
    except ImportError:
        psutil = None

    with _jobs_lock:
        job = _jobs.get(job_id) or {}
        snapshot_verified_before = bool(job.get("_terminationSnapshotVerified"))
        tracked_processes = list(job.get("_terminationTrackedProcesses") or ())
        # 이 변경 전 형식으로 만들어진 in-memory 작업도 안전하게 이어서 정리한다.
        if not tracked_processes:
            tracked_processes = [
                _capture_process_identity(process)
                for process in (job.get("_terminationProcesses") or ())
            ]

    snapshot_verified = False
    victims = []
    if psutil is None:
        _append_log(job_id, "[중단경고] psutil이 없어 프로세스 트리 스냅샷을 만들 수 없습니다.")
    else:
        try:
            parent = psutil.Process(pid)
            victims = parent.children(recursive=True) + [parent]
            snapshot_verified = True
        except psutil.NoSuchProcess:
            # Windows taskkill /T 성공만 전체 트리 종료를 독립적으로 확인할 수 있다.
            _append_log(job_id, f"[중단경고] PID {pid} 프로세스 트리 스냅샷을 만들지 못했습니다.")
        except (psutil.AccessDenied, OSError) as exc:
            _append_log(job_id, f"[중단경고] 프로세스 트리 조회 실패: {exc}")

    # 최초 완전한 snapshot의 모든 identity를 보존한다. survivor만 남기면 parent가 먼저
    # 사라진 재시도에서 "무엇을 확인했는지" 증명할 수 없고, PID만 남기면 재사용 PID를
    # 잘못 종료할 수 있다.
    for process in victims:
        captured = _capture_process_identity(process)
        if not any(
            _same_tracked_identity(captured, known)
            for known in tracked_processes
        ):
            tracked_processes.append(captured)
    snapshot_ever_verified = snapshot_verified_before or snapshot_verified
    if snapshot_verified:
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["_terminationSnapshotVerified"] = True
                job["_terminationTrackedProcesses"] = list(tracked_processes)

    os_tree_kill_verified = False
    try:
        if os.name == "nt":
            result = subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True, timeout=30, creationflags=_SUBPROC_FLAGS,
            )
            os_tree_kill_verified = result.returncode == 0
            if not os_tree_kill_verified:
                _append_log(
                    job_id,
                    f"[중단경고] taskkill 비정상 반환({result.returncode}); "
                    "psutil로 전체 프로세스 트리 종료를 재시도합니다.",
                )
        else:
            # POSIX에서도 아래 psutil 경로가 descendants부터 종료하고 소멸을 검증한다.
            pass
    except Exception as exc:  # noqa: BLE001
        _append_log(job_id, f"[중단경고] OS 프로세스 트리 종료 요청 실패: {exc}")

    # taskkill 성공 여부와 무관하게 snapshot한 descendants+parent를 다시 확인한다.
    # descendants 먼저 정리하여 부모 종료 중 새 고아 프로세스가 남을 가능성을 줄인다.
    alive = []
    unresolved = []
    for tracked in tracked_processes:
        process = tracked["process"]
        if psutil is None:
            unresolved.append(tracked)
            continue
        state = _tracked_process_state(tracked, psutil)
        if state == "gone":
            continue
        if state != "alive":
            unresolved.append(tracked)
            continue
        try:
            process.terminate()
            alive.append(tracked)
        except psutil.NoSuchProcess:
            continue
        except (psutil.AccessDenied, OSError) as exc:
            _append_log(job_id, f"[중단경고] PID {process.pid} terminate 실패: {exc}")
            unresolved.append(tracked)

    if alive and psutil is not None:
        try:
            gone, still_alive = psutil.wait_procs(
                [tracked["process"] for tracked in alive],
                timeout=_PROCESS_REAP_TIMEOUT,
            )
            gone_ids = {id(process) for process in gone}
            alive = [
                tracked for tracked in alive
                if id(tracked["process"]) not in gone_ids
                and tracked["process"] in still_alive
            ]
        except (psutil.AccessDenied, OSError):
            pass
    for tracked in alive:
        process = tracked["process"]
        try:
            process.kill()
        except psutil.NoSuchProcess:
            continue
        except (psutil.AccessDenied, OSError) as exc:
            _append_log(job_id, f"[중단경고] PID {process.pid} kill 실패: {exc}")
    if alive and psutil is not None:
        try:
            gone, still_alive = psutil.wait_procs(
                [tracked["process"] for tracked in alive],
                timeout=_PROCESS_REAP_TIMEOUT,
            )
            gone_ids = {id(process) for process in gone}
            alive = [
                tracked for tracked in alive
                if id(tracked["process"]) not in gone_ids
                and tracked["process"] in still_alive
            ]
        except (psutil.AccessDenied, OSError):
            pass

    unresolved.extend(alive)
    # wait_procs의 결과와 별개로 identity를 한 번 더 확인한다. PID 재사용/AccessDenied는
    # "종료됨"으로 추정하지 않고 슬롯을 계속 잠근다.
    final_unresolved = []
    for tracked in unresolved:
        if psutil is None or _tracked_process_state(tracked, psutil) != "gone":
            final_unresolved.append(tracked)

    if final_unresolved:
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["_terminationTrackedProcesses"] = list(tracked_processes)
                job["_terminationProcesses"] = [
                    tracked["process"] for tracked in final_unresolved
                ]
                job["_terminationVerificationPending"] = True
        _append_log(
            job_id,
            f"[중단경고] 종료를 확인하지 못한 프로세스 PID: "
            f"{[tracked['pid'] for tracked in final_unresolved]}",
        )
        return False

    # 초기 psutil 스냅샷을 만들 수 없었다면 "확인할 대상이 없었다"는 사실만으로 성공할 수
    # 없다. Windows에서는 taskkill /T 성공만이 그 경우 전체 트리 종료를 확인하는 독립 증거다.
    # 특히 parent NoSuchProcess/AccessDenied + taskkill 128/5를 success로 오인하면 살아 있는
    # Abaqus descendant가 있는데도 라이센스 슬롯을 풀 수 있다.
    tree_verified = snapshot_ever_verified or os_tree_kill_verified
    if not tree_verified:
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["_terminationVerificationPending"] = True
        _append_log(job_id, "[중단경고] 전체 프로세스 트리 종료를 검증할 수 없습니다.")
        return False

    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.pop("_terminationProcesses", None)
            job.pop("_terminationTrackedProcesses", None)
            job.pop("_terminationSnapshotVerified", None)
            job.pop("_terminationVerificationPending", None)
    return True


def _clear_cancel_request_after_failure(job_id: str) -> None:
    """kill 실패 뒤 취소 표식만 제거하고 terminal 결과는 검증된 cleanup까지 보류한다."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job.get("status") != "running":
            return
        job.pop("_cancelRequested", None)
        job["diagnostic"] = "termination_pending"
        job["_terminationVerificationPending"] = True


def _replay_deferred_finish_after_verified_cleanup(job_id: str) -> bool:
    """종료 검증 성공 뒤 보류된 pipeline terminal 결과를 재생한다.

    반환값은 deferred terminal이 실제로 존재해 재생을 시도했는지 여부다. cancel 요청과
    termination 표식은 먼저 같은 lock 구간에서 제거하여 ``_finish``가 다시 보류되지 않게 한다.
    """
    deferred_finish = None
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job.get("status") != "running":
            return False
        job.pop("_cancelRequested", None)
        job.pop("_terminationProcesses", None)
        job.pop("_terminationTrackedProcesses", None)
        job.pop("_terminationSnapshotVerified", None)
        job.pop("_terminationReapPending", None)
        job.pop("_terminationVerificationPending", None)
        if job.get("diagnostic") == "termination_pending":
            job.pop("diagnostic", None)
        deferred_finish = job.pop("_deferredFinish", None)
        if deferred_finish is None:
            pending = job.pop("_pendingTerminal", None)
            if pending is not None:
                deferred_finish = {
                    "status": pending["status"],
                    "returncode": pending["returncode"],
                    "report_ready": False,
                }
        else:
            job.pop("_pendingTerminal", None)
    if deferred_finish is None:
        return False
    _finish(job_id, **deferred_finish)
    return True


def _cancel_running_process(job_id: str) -> bool:
    """Popen publish를 기다린 뒤 프로세스를 회수하고 cancelled terminal 상태로 전이한다."""
    global _active_job_id
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return False
        process_ready = job.setdefault("_processReady", threading.Event())
        termination_lock = job.setdefault("_terminationLock", threading.Lock())

    if not process_ready.wait(timeout=_PROCESS_PUBLISH_TIMEOUT):
        _append_log(
            job_id,
            "[중단경고] 해석 프로세스 시작 확인이 지연되어 라이센스 슬롯을 유지합니다. 잠시 후 다시 중단하세요.",
        )
        _clear_cancel_request_after_failure(job_id)
        return False

    # cancel API와 pipeline의 publish 직후 경로가 동시에 들어와도 kill/reap/상태 전이는 한 번만 한다.
    with termination_lock:
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is None:
                return False
            if job.get("status") != "running":
                return job.get("diagnostic") == "cancelled"
            proc = job.get("_process")
            cleanup_retry = bool(
                job.get("_terminationProcesses")
                or job.get("_terminationTrackedProcesses")
                or job.get("_terminationSnapshotVerified")
                or job.get("_terminationReapPending")
                or job.get("_terminationVerificationPending")
                or job.get("diagnostic") == "termination_pending"
            )

        if proc is not None:
            if not _terminate_process_tree(proc, job_id):
                _append_log(
                    job_id,
                    "[중단경고] 프로세스 종료를 확인하지 못해 라이센스 슬롯을 유지합니다.",
                )
                _clear_cancel_request_after_failure(job_id)
                return False

            # kill 실패와 pipeline 완료가 경합해 terminal 결과가 보류됐었다면, 실제 트리
            # 종료+reap 검증이 끝난 지금 그 결과를 먼저 재생한다. 이 경우 cancel 자체가
            # terminal을 만든 것은 아니므로 caller는 cancelled=False/status=<deferred>를 돌려준다.
            if cleanup_retry and _replay_deferred_finish_after_verified_cleanup(job_id):
                return False

        job_to_record = None
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is not None and job.get("status") == "running":
                job.pop("_cancelRequested", None)
                job.pop("_deferredFinish", None)
                job.pop("_pendingTerminal", None)
                job.pop("_terminationProcesses", None)
                job.pop("_terminationTrackedProcesses", None)
                job.pop("_terminationSnapshotVerified", None)
                job.pop("_terminationReapPending", None)
                job["status"] = "failed"
                job["returncode"] = -3
                job["diagnostic"] = "cancelled"
                job["finishedAt"] = datetime.now().isoformat(timespec="seconds")
                job["logs"].append("[중단] 사용자 요청으로 해석을 중단했습니다. (라이센스가 해제되었습니다)")
                if _active_job_id == job_id:
                    _active_job_id = None
                job_to_record = job
        if job_to_record is not None:
            _record_psa_analysis(job_to_record)
        return True


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
        # kill 은 lock 밖에서 수행되므로 파이프라인 완료와 경합할 수 있다. 먼저 취소 의사를
        # 기록해 _finish 가 done/timeout 으로 덮어쓰지 못하게 한다.
        job["_cancelRequested"] = True
        job.setdefault("_processReady", threading.Event())
        job.setdefault("_terminationLock", threading.Lock())

    # Popen 성공/미실행 결정과 process object publish를 기다린 뒤 실제 종료+reap 확인 시에만
    # terminal 상태와 라이센스 슬롯을 해제한다.
    if _cancel_running_process(job_id):
        return {"cancelled": True}
    with _jobs_lock:
        final_status = (_jobs.get(job_id) or {}).get("status")
    if final_status and final_status != "running":
        return {
            "cancelled": False,
            "status": final_status,
            "message": "중단 처리 중 해석 프로세스가 먼저 종료되었습니다.",
        }
    return {
        "cancelled": False,
        "status": "running",
        "message": "프로세스 종료를 아직 확인하지 못해 라이센스 슬롯을 유지합니다. 잠시 후 다시 시도하세요.",
    }
