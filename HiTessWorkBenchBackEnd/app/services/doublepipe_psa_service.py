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
import json
import locale
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
_DOUBLEPIPE_DIR = os.path.join(_BACKEND_DIR, "InHouseProgram", "DoublePipe")
# ★ 정본 프로그램 폴더 = 어댑터 배포 폴더. 연구원이 개발하는 엔진 폴더와 분리되어 있어,
#    새 엔진이 오면 엔진 폴더만 통째로 덮어써도 exe·서식 템플릿이 지워지지 않는다.
#    (설계: docs/superpowers/specs/2026-08-28-doublepipe-engine-adapter-design.md)
_PSA_DIR = os.path.join(_DOUBLEPIPE_DIR, "HiTessAdapter")
# 구 배치(엔진 폴더 안에 exe·템플릿이 있던 시절) 폴백 — 서버가 아직 이행 전이어도 무중단.
_PSA_LEGACY_DIR = os.path.join(_DOUBLEPIPE_DIR, "Piping Stress Analysis for all load cases")
_PSA_EXE_NAME = "PSA_AllLoadCases.exe"
# ── 고유진동(Normal Mode) 해석 프로그램 ───────────────────────────────────
# Run_ModalAnalysis.exe 는 같은 AbaqusModelCreatorPKG 로 *FREQUENCY 스텝 inp 를 만들고 Abaqus 를
# 1회 실행한 뒤 .dat 의 EIGENVALUE OUTPUT 표에서 고유진동수(Hz)를 뽑는다(마찰 반복 없음).
#   Run_ModalAnalysis.exe <csv_path> --no-viewer [--modes N] [--min-freq F]
# ⚠️ --no-viewer 필수: 빠지면 exe 가 해석 후 streamlit 뷰어를 foreground 로 띄워 프로세스가
#    영원히 끝나지 않는다(서버에서는 타임아웃까지 라이센스를 물고 있게 된다).
# PSA 와 동일하게 어댑터 폴더를 1순위로 보고, 현재 위치(엔진 폴더)를 폴백으로 둔다.
_MODAL_DIR = os.path.join(_DOUBLEPIPE_DIR, "Piping Normal Mode Analysis")
_MODAL_EXE_NAME = "Run_ModalAnalysis.exe"
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")
_REPORT_NAME = "Report for PSA.xlsx"
# 서식 템플릿 원본(프로그램 폴더). make_report() 가 cwd(job_dir) 상대경로로 이 이름을 읽으므로,
# 실행 직전 job_dir 로 복사해 둬야 이미지·서식이 살아있는 보고서가 나온다(복사 안 하면 빈 워크북).
#
# ⚠️ DRM 함정: 회사 DRM 은 .xlsx 를 at-rest 로 암호화(HHIDRMC, +4096B)하고 로컬 프로세스는 복호화
# 못 한다. 소스가 .xlsx 면 145 에서 이 원본이 암호화돼 있을 때 백엔드가 '암호화된 쓰레기'를 job 폴더로
# 복사 → 빈 워크북(≈288KB) 보고서가 된다. 그래서 DRM 이 건드리지 않는 비-Office 확장자 .bin 으로
# 템플릿을 보관하고(항상 PK 로 읽힘) 이걸 1순위 소스로 쓴다. .bin 이 없거나 PK 가 아니면 .xlsx 폴백.
_REPORT_TEMPLATE_BIN_NAME = "report_template.bin"
_ZIP_MAGIC = b"PK\x03\x04"


def _program_dirs() -> tuple:
    """프로그램 자산(exe·서식 템플릿) 탐색 폴더. 어댑터 폴더가 1순위, 구 배치가 폴백."""
    return (_PSA_DIR, _PSA_LEGACY_DIR)


def _resolve_psa_exe() -> "str | None":
    """실행할 PSA exe 의 절대경로. 없으면 None."""
    for directory in _program_dirs():
        candidate = os.path.join(directory, _PSA_EXE_NAME)
        if os.path.isfile(candidate):
            return candidate
    return None


def _resolve_modal_exe() -> "str | None":
    """실행할 고유진동 해석 exe 의 절대경로. 없으면 None.

    어댑터 폴더(_PSA_DIR)를 1순위로 보는 이유는 PSA 와 같다 — 연구원 엔진 폴더를 통째로
    덮어써도 배포본이 지워지지 않게 하려면 언젠가 이쪽으로 옮겨야 하고, 그때 코드 수정이
    필요 없도록 미리 후보에 넣어 둔다.
    """
    for directory in (_PSA_DIR, _MODAL_DIR):
        candidate = os.path.join(directory, _MODAL_EXE_NAME)
        if os.path.isfile(candidate):
            return candidate
    return None

# userConnection 폴더 명명에 쓰는 프로그램 이름 (doublepipe_service.py 와 동일 규칙:
# {timestamp}_{employee_id}_{ProgramName}). Tab2 직접 업로드 경로가 새 작업 폴더를 만들 때 사용.
_PROGRAM_NAME = "DoublePipeFuelLine"

# 최대 실행 시간(초) — Abaqus 반복 해석까지 고려. 필요 시 env 로 override.
_PSA_TIMEOUT = int(os.environ.get("DOUBLEPIPE_PSA_TIMEOUT", "7200"))
# 고유진동 해석은 마찰 반복이 없는 단일 Abaqus run 이라 훨씬 짧다.
_MODAL_TIMEOUT = int(os.environ.get("DOUBLEPIPE_MODAL_TIMEOUT", "3600"))

# 고유진동 해석 옵션 허용 범위 — 엔진 기본값(10 모드 / 1.0Hz)과 동일한 기본을 쓴다.
_MODAL_DEFAULT_MODES = 10
_MODAL_DEFAULT_MIN_FREQ = 1.0
_MODAL_MAX_MODES = 50

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


def _normalize_modal_options(modes, min_freq) -> tuple:
    """고유진동 해석 옵션(--modes / --min-freq)을 검증해 (int, float) 로 정규화한다."""
    if modes in (None, ""):
        n_modes = _MODAL_DEFAULT_MODES
    else:
        try:
            n_modes = int(modes)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"올바르지 않은 모드 개수: '{modes}'")
        if not (1 <= n_modes <= _MODAL_MAX_MODES):
            raise HTTPException(
                status_code=400,
                detail=f"모드 개수는 1~{_MODAL_MAX_MODES} 범위여야 합니다 (입력: {n_modes}).",
            )

    if min_freq in (None, ""):
        f_min = _MODAL_DEFAULT_MIN_FREQ
    else:
        try:
            f_min = float(min_freq)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"올바르지 않은 최소 진동수: '{min_freq}'")
        if not (0.0 <= f_min <= 10000.0):
            raise HTTPException(status_code=400, detail=f"최소 진동수는 0~10000Hz 범위여야 합니다 (입력: {f_min}).")

    return n_modes, f_min


def _resolve_workspace_csv(work_dir: str, result_csv: str) -> str:
    """userConnection 하위 작업 폴더의 CSV 절대경로를 검증해 돌려준다(디렉터리 탈출 차단)."""
    safe_dir = os.path.basename(work_dir or "")
    safe_csv = os.path.basename(result_csv or "")
    if not safe_dir or not safe_csv:
        raise HTTPException(status_code=400, detail="workDir 와 resultCsv 를 모두 지정하세요.")

    csv_path = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, safe_dir, safe_csv))
    if not csv_path.startswith(os.path.abspath(_USER_CONNECTION_DIR) + os.sep):
        raise HTTPException(status_code=400, detail="입력 CSV 경로가 올바르지 않습니다.")
    if not os.path.isfile(csv_path):
        raise HTTPException(status_code=404, detail=f"Tab1 결과 CSV 를 찾을 수 없습니다: {safe_dir}/{safe_csv}")
    return csv_path


def _save_upload_to_workspace(csv_bytes: bytes, csv_name: str, employee_id: str) -> tuple:
    """업로드 CSV 를 새 작업 폴더에 저장하고 (csv_path, folder_name, safe_name) 을 돌려준다."""
    # 폴더명에 들어가는 사번은 경로 조작 문자를 제거해 userConnection 밖으로 새지 않게 한다.
    safe_employee = re.sub(r"[^A-Za-z0-9_-]", "", employee_id or "") or "unknown"
    work_dir, _timestamp = create_analysis_workspace(
        _USER_CONNECTION_DIR,
        safe_employee,
        _PROGRAM_NAME,
    )
    safe_name = os.path.basename(csv_name or "") or "psa_input.csv"
    if not safe_name.lower().endswith(".csv"):
        safe_name += ".csv"
    csv_path = os.path.join(work_dir, safe_name)
    with open(csv_path, "wb") as f:
        f.write(csv_bytes)
    return csv_path, os.path.basename(work_dir), safe_name


def start_psa_job(work_dir: str, result_csv: str, employee_id: str, load_cases=None) -> dict:
    """Tab1 작업 폴더에 이미 저장된 결과 CSV 로 PSA 해석을 백그라운드로 시작한다.

    load_cases 가 None/빈 값이면 전체 29개, 지정되면 그 Load Case(+엔진이 L17 자동 포함)만 해석한다.
    """
    _ensure_license_available()  # 라이센스 점유 중이면 조기 409
    lcs = _normalize_load_cases(load_cases)  # 잘못된 LC 면 파일 확인 전 400
    csv_path = _resolve_workspace_csv(work_dir, result_csv)
    return _launch_job(csv_path, employee_id, load_cases=lcs)


def start_modal_job(work_dir: str, result_csv: str, employee_id: str, modes=None, min_freq=None) -> dict:
    """Tab1/Tab3 작업 폴더에 이미 저장된 CSV 로 고유진동(Normal Mode) 해석을 시작한다.

    PSA 와 같은 Abaqus 라이센스를 쓰므로 같은 단일 슬롯(_active_job_id)을 공유한다 —
    PSA 가 돌고 있으면 여기서도 409(license_busy)가 난다.
    """
    _ensure_license_available()
    modal_opts = _normalize_modal_options(modes, min_freq)
    csv_path = _resolve_workspace_csv(work_dir, result_csv)
    return _launch_job(csv_path, employee_id, kind="modal", modal_opts=modal_opts)


def start_modal_job_from_upload(csv_bytes: bytes, csv_name: str, employee_id: str, modes=None, min_freq=None) -> dict:
    """Tab3 에서 직접 업로드한 배관 CSV 로 고유진동 해석을 시작한다(Tab1 미경유 독립 경로)."""
    if not csv_bytes:
        raise HTTPException(status_code=400, detail="업로드된 CSV 파일이 비어 있습니다.")

    _ensure_license_available()  # 업로드 파일 저장/폴더 생성 전 fail-fast
    modal_opts = _normalize_modal_options(modes, min_freq)

    csv_path, folder_name, safe_name = _save_upload_to_workspace(csv_bytes, csv_name, employee_id)
    result = _launch_job(csv_path, employee_id, kind="modal", modal_opts=modal_opts)
    result["workDir"] = folder_name
    result["resultCsv"] = safe_name
    return result


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

    csv_path, folder_name, safe_name = _save_upload_to_workspace(csv_bytes, csv_name, employee_id)
    result = _launch_job(csv_path, employee_id, load_cases=lcs)
    result["workDir"] = folder_name
    result["resultCsv"] = safe_name
    return result


def _launch_job(csv_path: str, employee_id: str, kind: str = "psa", load_cases=None, modal_opts=None) -> dict:
    """userConnection 하위 절대경로 csv_path 를 입력으로 해석 exe 를 백그라운드 스레드로 실행한다.

    Tab1 결과 CSV / 직접 업로드, PSA / 고유진동 해석이 모두 공유하는 실행 로직 —
    exe 존재 확인 → (라이센스 원자적 점유) job 등록 → 스레드 기동.
    kind='psa' 면 load_cases 를, kind='modal' 이면 modal_opts=(모드수, 최소Hz) 를 인자로 붙인다.
    ★ 두 종류 모두 같은 Abaqus 라이센스 슬롯(_active_job_id)을 공유한다.
    """
    is_modal = kind == "modal"
    if is_modal:
        exe_path = _resolve_modal_exe()
        if exe_path is None:
            raise HTTPException(
                status_code=503,
                detail=f"고유진동 해석 프로그램({_MODAL_EXE_NAME})을 찾을 수 없습니다. 서버 관리자에게 문의하세요.",
            )
    else:
        exe_path = _resolve_psa_exe()
        if exe_path is None:
            raise HTTPException(status_code=503, detail=f"PSA 해석 프로그램({_PSA_EXE_NAME})을 찾을 수 없습니다. 서버 관리자에게 문의하세요.")

    # ⚠️ cwd 는 반드시 CSV 가 있는 폴더(job_dir)여야 한다 — Main.py 내부의 write_LC()/
    # make_report()/F06Format 이 "Report for PSA.xlsx", "Inforget_f06.txt", "L*_stress.txt" 등을
    # 전부 cwd 상대경로로 읽고 쓰기 때문(원본 이식 문서 §6-5·§9-3). exe 자체는 절대경로로
    # 지정해 cwd 와 무관하게 실행되게 하고, 하위 산출물만 job_dir 에 모이도록 한다. _PSA_DIR 를
    # cwd 로 쓰면 동시 작업 간 산출물이 서로 덮어써지고 make_report() 가 파일을 못 찾아
    # 빈 보고서가 나온다.
    # (고유진동 exe 는 frozen 일 때 스스로 exe 폴더로 chdir 하지만, 입력 CSV 를 절대경로로 받아
    #  work_dir=dirname(csv) 를 산출물·Abaqus cwd 로 쓰므로 결과는 동일하게 job_dir 에 모인다.)
    job_dir = os.path.dirname(csv_path)
    modal_modes = modal_min_freq = None
    if is_modal:
        modal_modes, modal_min_freq = modal_opts or (_MODAL_DEFAULT_MODES, _MODAL_DEFAULT_MIN_FREQ)
        # --no-viewer 는 필수(streamlit 뷰어가 뜨면 프로세스가 끝나지 않는다).
        command = [
            exe_path, csv_path, "--no-viewer",
            "--modes", str(modal_modes),
            "--min-freq", str(modal_min_freq),
        ]
    else:
        command = [exe_path, csv_path]
        # 선택 Load Case 지정 시에만 --load-cases 를 붙인다(미지정=엔진 기본 전체 29개).
        if load_cases:
            command += ["--load-cases", ",".join(load_cases)]

    job_id = uuid.uuid4().hex[:12]
    now_epoch = _now_epoch()
    now = datetime.now().isoformat(timespec="seconds")
    stamp = datetime.fromtimestamp(now_epoch).strftime("%Y%m%d_%H%M%S")
    project_name = (
        f"이중관 고유진동 해석_{stamp}" if is_modal else f"이중관 배관응력 해석_{stamp}"
    )
    job = {
        "jobId": job_id,
        "kind": kind,                  # psa | modal — 프론트가 완료 메시지/결과 표시를 분기한다.
        "status": "running",           # running | done | failed
        "returncode": None,
        "csvPath": csv_path,
        "command": " ".join(f'"{c}"' if " " in c else c for c in command),
        "logs": [],
        # 고유진동 해석은 xlsx 보고서를 만들지 않는다 — 결과는 NaturalFrequencies.txt 이며
        # _finish 가 파싱해 job["modes"] 로 실어 준다.
        "reportPath": None if is_modal else os.path.join(job_dir, _REPORT_NAME),
        "reportReady": False,
        "employeeId": employee_id or "unknown",
        "loadCases": list(load_cases) if load_cases and not is_modal else None,  # None=전체 / 리스트=선택
        "modalModes": modal_modes,         # 요청한 최대 모드 개수(표시용)
        "modalMinFreq": modal_min_freq,    # 요청한 최소 진동수 Hz(표시용)
        "modes": None,                     # 완료 후 [{modeNo, freqHz}, ...]
        "resultPath": None,                # 완료 후 *_NaturalFrequencies.txt 절대경로
        "projectName": project_name,       # 시작/완료 DB upsert에서 같은 이름을 유지한다.
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

    # WorkBench/PC를 바로 종료해도 My Projects에서 입력과 Running 상태를 찾을 수 있도록
    # solver thread를 시작하기 전에 DB 스냅샷을 먼저 만든다. 완료/실패 시 같은 job_id로 갱신된다.
    _record_psa_analysis(job)

    thread = threading.Thread(target=_run_pipeline, args=(job_id, command, job_dir, kind), daemon=True)
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


def _set_abaqus_resolved(job_id: str, resolved: bool) -> None:
    """실행 직전 abaqus 런처를 찾았는지 기록한다.

    고유진동 exe 는 abaqus 실패 메시지를 출력하다 인코딩 오류로 죽어 원인이 로그에서 지워지므로
    (_finish 의 modal_console_encoding 참조), '애초에 abaqus 가 없었다'는 사실을 여기서 남겨 둬야
    사용자에게 정확한 원인을 말해 줄 수 있다.
    """
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            job["_abaqusResolved"] = resolved


def _build_subprocess_env(job_id: str) -> dict:
    """자식(exe → abaqus)이 상속할 환경을 만든다.

    abaqus 가 현재 PATH 로 이미 잡히면 그대로 두고, 안 잡히면 런처 폴더를 찾아 PATH 앞에
    주입한다(찾으면 알림 로그, 못 찾으면 경고 로그). 이 env 를 exe 에 넘기면 exe 가 내부에서
    부르는 `abaqus` 도 같은 PATH 를 상속하므로 abaqus_not_found 를 방지한다.

    ⚠️ PYTHONIOENCODING 으로 자식 stdout 을 UTF-8 로 돌리려는 시도는 통하지 않는다 —
    PyInstaller 부트로더가 `python -E` 상당으로 PYTHON* 환경변수를 무시한다(실측 확인).
    대신 읽는 쪽 인코딩을 맞춘다(_child_output_encoding 참조).
    """
    env = os.environ.copy()
    if shutil.which("abaqus"):
        _set_abaqus_resolved(job_id, True)
        return env  # 이미 PATH 로 해석됨 — 주입 불필요
    abaqus_dir = _resolve_abaqus_commands_dir()
    _set_abaqus_resolved(job_id, bool(abaqus_dir))
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
    # 어댑터 폴더 → 구 배치 폴더 순으로, 각 폴더에서 .bin(1순위) → .xlsx(폴백).
    candidates = []
    for directory in _program_dirs():
        tag = os.path.basename(directory)
        for name in (_REPORT_TEMPLATE_BIN_NAME, _REPORT_NAME):
            candidates.append((os.path.join(directory, name), f"{tag}/{name}"))
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
            f"(탐색 폴더: {', '.join(_program_dirs())}). "
            "보고서가 서식·이미지 없이(빈 워크북, ≈288KB) 생성될 수 있습니다 — "
            f"서버 관리자: {_REPORT_TEMPLATE_BIN_NAME} 을 {_PSA_DIR} 에 두세요.",
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


def _child_output_encoding(kind: str) -> str:
    """자식 프로세스 stdout 을 디코딩할 인코딩.

    - PSA(`PSA_AllLoadCases.exe`): 어댑터 `shims/console.py` 가 stdout 을 UTF-8 로 고정하므로 utf-8.
    - 고유진동(`Run_ModalAnalysis.exe`): 어댑터를 거치지 않은 연구원 원본 빌드라 그 shim 이 없다.
      파이프로 실행하면 Python 이 콘솔 로케일(한국어 Windows = cp949)로 인코딩해 쓴다 —
      utf-8 로 읽으면 로그의 한글이 전부 깨진다(실측: raw 바이트를 cp949 로 디코딩해야 정상).
      환경변수로는 교정할 수 없어(PyInstaller 가 PYTHON* 무시) 읽는 쪽을 로케일에 맞춘다.
    """
    if kind != "modal":
        return "utf-8"
    return locale.getpreferredencoding(False) or "utf-8"


def _run_pipeline(job_id: str, command: list, cwd: str, kind: str = "psa"):
    """subprocess 로 해석을 실행하고 stdout 스트리밍과 실행 제한 시간을 함께 보장한다."""
    is_modal = kind == "modal"
    # ⚠️ exe 가 파이프라인 끝에서 make_report() 로 이 템플릿을 cwd 상대경로로 읽으므로,
    # Abaqus 해석 시작 전에 미리 job 폴더로 복사해 둔다.
    # (고유진동 해석은 xlsx 보고서를 만들지 않으므로 스테이징이 필요 없다.)
    if not is_modal:
        _stage_report_template(cwd, job_id)
    env = _build_subprocess_env(job_id)
    child_encoding = _child_output_encoding(kind)
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
            encoding=child_encoding,
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
    timeout_sec = _MODAL_TIMEOUT if is_modal else _PSA_TIMEOUT
    try:
        returncode = proc.wait(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        outcome = "timeout"
        terminated = _terminate_process_tree(proc, job_id)
        if terminated:
            _append_log(job_id, f"[치명] 해석 시간 초과({timeout_sec}s) — 프로세스를 종료했습니다.")
        else:
            _append_log(job_id, f"[치명] 해석 시간 초과({timeout_sec}s) — 프로세스 종료 확인 대기 중입니다.")
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
    if is_modal:
        # 고유진동 결과는 <csv-stem>_Modal_NaturalFrequencies.txt 다(Run_ModalAnalysis 규칙).
        modal_result = _collect_modal_result(cwd, command)
        _finish(
            job_id,
            status="done" if rc == 0 else "failed",
            returncode=rc,
            report_ready=bool(modal_result),
            modal_result=modal_result,
        )
        return
    report_ready = os.path.isfile(os.path.join(cwd, _REPORT_NAME))
    _finish(job_id, status="done" if rc == 0 else "failed", returncode=rc, report_ready=report_ready)


def _modal_result_txt_path(cwd: str, csv_path: str) -> str:
    """Run_ModalAnalysis 가 쓰는 고유진동수 결과 txt 의 절대경로."""
    base = os.path.splitext(os.path.basename(csv_path))[0]
    return os.path.join(cwd, f"{base}_Modal_NaturalFrequencies.txt")


def _parse_modal_result_txt(path: str) -> list:
    """*_NaturalFrequencies.txt 를 [{'modeNo': int, 'freqHz': float}, ...] 로 파싱한다.

    파일 형식(SaveNaturalFrequencies):
        Natural Frequency Result (>= 1.0 Hz, max 10 modes)
        MODE NO      FREQUENCY (Hz)
              1      12.3456
    """
    modes = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                tokens = line.split()
                if len(tokens) != 2 or not tokens[0].isdigit():
                    continue
                try:
                    modes.append({"modeNo": int(tokens[0]), "freqHz": float(tokens[1])})
                except ValueError:
                    continue
    except OSError as exc:
        logger.warning("modal result read failed (%s): %s", path, exc)
        return []
    return modes


def _collect_modal_result(cwd: str, command: list) -> "dict | None":
    """고유진동 해석 산출물(결과 txt·모드형상 이미지/JSON)을 수집한다. 없으면 None."""
    csv_path = command[1] if len(command) > 1 else ""
    txt_path = _modal_result_txt_path(cwd, csv_path)
    if not os.path.isfile(txt_path):
        return None
    base = os.path.splitext(os.path.basename(csv_path))[0]
    shape_json = os.path.join(cwd, f"{base}_Modal_ModeShapeData.json")
    shape_dir = os.path.join(cwd, f"{base}_Modal_ModeShapes")
    return {
        "resultPath": txt_path,
        "modes": _parse_modal_result_txt(txt_path),
        "shapeDataPath": shape_json if os.path.isfile(shape_json) else None,
        "shapeImageDir": shape_dir if os.path.isdir(shape_dir) else None,
    }


def _record_psa_analysis(job: dict):
    """PSA 작업 스냅샷을 Analysis DB 에 upsert하여 My Projects에서 영구 복원한다.

    시작 시 Running 레코드를 먼저 만들고 완료/실패/중단 시 같은 job_id 행을 갱신한다. 입력 CSV와
    Load Case뿐 아니라 Tab1의 inner_pipe_config.json, 실행 시간, 종료 코드, 진단, 콘솔 로그까지
    저장하므로 클라이언트 메모리/localStorage가 사라져도 상세 실행 근거를 다시 볼 수 있다.

    반드시 _jobs_lock 을 놓은 뒤 호출한다(DB I/O 로 상태 폴링을 막지 않도록). 실패해도 해석 결과에는
    영향이 없어야 하므로 모든 예외를 삼키고 로그만 남긴다.
    """
    try:
        raw_status = job.get("status")
        if raw_status == "running":
            status_msg = "Running"
        elif raw_status == "done":
            status_msg = "Success"
        else:
            status_msg = "Failed"

        csv_path = job.get("csvPath") or ""
        work_dir = os.path.dirname(csv_path) if csv_path else None
        is_modal = job.get("kind") == "modal"
        workflow_step = "modal" if is_modal else "psa"
        load_cases = job.get("loadCases")
        input_info = {
            "schema_version": 3,
            "workflow_step": workflow_step,
            "input_csv": csv_path,
            "input_filename": os.path.basename(csv_path) if csv_path else None,
        }
        if is_modal:
            input_info["modal_modes"] = job.get("modalModes")
            input_info["modal_min_freq_hz"] = job.get("modalMinFreq")
        else:
            input_info["load_case_mode"] = "selected" if load_cases else "all"
            input_info["load_cases"] = list(load_cases) if load_cases else None
            input_info["load_case_count"] = len(load_cases) if load_cases else 29

        # Tab1 경로는 변환 단계가 저장한 설정 JSON이 같은 폴더에 있다. 직접 업로드 경로에는
        # 설정 파일이 없으므로 input_mode만 구분해 두고 배관 CSV 자체를 원본 입력으로 보존한다.
        config_path = os.path.join(work_dir, "inner_pipe_config.json") if work_dir else None
        config = None
        if config_path and os.path.isfile(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as config_file:
                    loaded = json.load(config_file)
                if isinstance(loaded, dict):
                    config = loaded
            except (OSError, ValueError, TypeError) as exc:
                logger.warning("DoublePipe input config read failed (%s): %s", config_path, exc)
        input_info["input_mode"] = "inner_support" if config is not None else "direct_upload"
        if config is not None:
            input_info["config_file"] = config_path
            input_info["inner_support_config"] = config

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

        # 고유진동 해석의 '산출물 준비됨' 판정 기준은 xlsx 보고서가 아니라 결과 txt 다.
        report_path = job.get("resultPath") if is_modal else job.get("reportPath")
        report_ready = bool(
            job.get("reportReady") and report_path and os.path.isfile(report_path)
        )
        result_info = {
            "schema_version": 3,
            "workflow_step": workflow_step,
            "work_dir": work_dir,
            "status": status_msg,
            "started_at": started_at,
            "finished_at": finished_at,
            "duration_sec": duration_sec,
            "returncode": job.get("returncode"),
            "diagnostic": job.get("diagnostic"),
            "report_ready": report_ready,
            "logs": list(job.get("logs") or []),
        }
        if report_ready and not is_modal:
            result_info["report"] = report_path
        if is_modal:
            result_info["natural_frequencies"] = list(job.get("modes") or [])
            result_info["result_txt"] = job.get("resultPath")
            result_info["mode_shape_data"] = job.get("shapeDataPath")

        default_name = "이중관 고유진동 해석" if is_modal else "이중관 배관응력 해석"
        project_name = job.get("projectName") or (
            f"{default_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        )
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


def _finish(job_id: str, status: str, returncode: int, report_ready: bool = False, modal_result=None):
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
                "modal_result": modal_result,
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
        exe_label = _MODAL_EXE_NAME if job.get("kind") == "modal" else _PSA_EXE_NAME
        if status == "failed":
            joined = "\n".join(job["logs"])
            if "No module named" in joined:
                # exe 에 scipy/pyNastran/numpy/openpyxl 이 번들되어 있어 정상적으론 발생하지 않아야
                # 함 — 발생하면 exe 자체가 손상/구버전일 가능성이 높다.
                job["diagnostic"] = "solver_env_missing"
                job["logs"].append(
                    f"[안내] 해석 프로그램({exe_label}) 내부에 필요한 모듈이 빠져 있습니다. "
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
            elif job.get("kind") == "modal" and "UnicodeEncodeError" in joined:
                # Run_ModalAnalysis.exe 는 abaqus 출력을 utf-8/errors=replace 로 읽은 뒤 그대로
                # cp949 stdout 에 print 한다. abaqus 가 한글 메시지(예: "'abaqus'은(는) 내부 또는
                # 외부 명령이 아닙니다")를 내면 U+FFFD 가 섞여 print 자체가 UnicodeEncodeError 로
                # 죽는다 → 진짜 원인이 로그에서 지워진다. 실행 직전에 기록해 둔 abaqus 탐색 결과로
                # 원인을 되살린다(대개 abaqus 미설치).
                if job.get("_abaqusResolved") is False:
                    job["diagnostic"] = "abaqus_not_found"
                    job["logs"].append(
                        "[안내] 이 컴퓨터에서 'abaqus' 명령을 찾을 수 없습니다. Abaqus CAE(외부 솔버)가 "
                        "설치되어 있고 PATH 에 등록되어 있는지 확인하세요. (해석 프로그램이 그 오류 메시지를 "
                        "출력하다 콘솔 인코딩 오류로 함께 중단됐습니다.)"
                    )
                else:
                    job["diagnostic"] = "modal_console_encoding"
                    job["logs"].append(
                        "[안내] 고유진동 해석 프로그램이 콘솔 인코딩 오류(UnicodeEncodeError)로 중단됐습니다. "
                        "직전에 Abaqus 가 한글 메시지를 출력했을 가능성이 높습니다 — 위 로그의 Abaqus 메시지를 "
                        "확인하세요. (근본 해결: 엔진의 Run_ModalAnalysis.py 에 "
                        "sys.stdout.reconfigure(encoding='utf-8') 추가 요청)"
                    )
            elif "Abaqus/Analysis exited with errors" in joined or "Abaqus 해석" in joined:
                job["diagnostic"] = "abaqus_solve_failed"
                job["logs"].append(
                    "[안내] Abaqus 해석이 오류로 종료되었습니다. 위 로그의 Abaqus 메시지를 확인하세요."
                )
        job["status"] = status
        job["returncode"] = returncode
        job["reportReady"] = report_ready
        if modal_result:
            job["resultPath"] = modal_result.get("resultPath")
            job["modes"] = modal_result.get("modes") or []
            job["shapeDataPath"] = modal_result.get("shapeDataPath")
            job["shapeImageDir"] = modal_result.get("shapeImageDir")
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
            "kind": job.get("kind", "psa"),   # psa | modal — 프론트 재연결 시 어느 탭인지 판정
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
