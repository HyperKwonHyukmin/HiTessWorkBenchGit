"""이중관 고유진동 — Mode Shape 뷰어(Streamlit) 온디맨드 기동 서비스.

ModeShapeViewer.exe 는 Streamlit 서버를 띄우는 상시 프로세스다. 사람이 서버에 로그인해
직접 실행해 두지 않으면 꺼져 있는 것이 보통이라, WorkBench 가 필요할 때 대신 띄운다.

설계 메모
---------
* **왜 백엔드인가**: 뷰어가 읽을 결과 JSON(`*_ModeShapeData.json`)은 백엔드의
  `userConnection/` 에 있다. 뷰어는 그 파일이 있는 컴퓨터에서 돌아야 하므로 기동 주체도
  백엔드가 맞다.
* **cwd 가 중요하다**: Streamlit 은 `.streamlit/config.toml` 을 **현재 작업 폴더** 기준으로
  읽는다. 뷰어 폴더를 cwd 로 주지 않으면 0.0.0.0 바인드·포트 설정이 통째로 무시되어
  localhost 에만 붙고, 다른 PC 에서 접속이 안 된다.
* **분리 기동**: 이 프로세스는 요청보다 오래 산다. stdout 을 파이프로 물면 버퍼가 차서
  뷰어가 멈추므로 로그 파일로 돌리고, DETACHED_PROCESS 로 콘솔을 분리해 자식의 콘솔
  신호가 uvicorn 까지 전파되지 않게 한다(PSA 에서 Abaqus 로 겪은 무-로그 급사와 같은 계열).
* **기동 완료 판정은 포트로 한다**: PyInstaller onefile 압축 해제(약 91MB) + Streamlit 부팅
  때문에 수십 초가 걸린다. start 는 즉시 반환하고, 프론트가 status 를 폴링한다.
"""
import logging
import os
import re
import socket
import subprocess
import threading
import time

from fastapi import HTTPException

logger = logging.getLogger(__name__)

_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(os.path.dirname(_SERVICES_DIR))
_DOUBLEPIPE_DIR = os.path.join(_BACKEND_DIR, "InHouseProgram", "DoublePipe")

# 탐색 순서는 doublepipe_psa_service._resolve_modal_exe 와 같다 —
# 어댑터 폴더가 1순위, 연구원 엔진 폴더가 폴백.
_VIEWER_DIRS = (
    os.path.join(_DOUBLEPIPE_DIR, "HiTessAdapter"),
    os.path.join(_DOUBLEPIPE_DIR, "Piping Normal Mode Analysis"),
)
_VIEWER_EXE_NAME = "ModeShapeViewer.exe"
_DEFAULT_PORT = 8501
_LOG_NAME = "viewer_server.log"

# 기동 시도 직후에는 아직 포트가 안 열려 있다. 이 시간 안에 다시 start 가 와도 중복 기동하지 않는다.
_START_GRACE_SEC = 180.0
_PORT_PROBE_TIMEOUT = 0.4

_lock = threading.Lock()
_process = None          # 우리가 띄운 Popen (외부에서 띄운 인스턴스는 추적하지 않는다)
_last_start_at = 0.0


def _resolve_viewer() -> "tuple[str, str] | None":
    """(exe 절대경로, 그 exe 가 있는 폴더). 없으면 None."""
    for directory in _VIEWER_DIRS:
        candidate = os.path.join(directory, _VIEWER_EXE_NAME)
        if os.path.isfile(candidate):
            return candidate, directory
    return None


def _configured_port(viewer_dir: str) -> int:
    """뷰어 폴더의 .streamlit/config.toml 에 적힌 server.port (없으면 8501).

    엔진의 ModeShapeViewer._configured_port 와 같은 규칙이라, 연구원이 포트를 바꿔도
    백엔드/프론트가 따라간다.
    """
    config_path = os.path.join(viewer_dir, ".streamlit", "config.toml")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return _DEFAULT_PORT
    match = re.search(r"^\s*port\s*=\s*(\d+)", text, re.MULTILINE)
    if not match:
        return _DEFAULT_PORT
    try:
        port = int(match.group(1))
    except ValueError:
        return _DEFAULT_PORT
    return port if 1 <= port <= 65535 else _DEFAULT_PORT


def _port_is_open(port: int) -> bool:
    """뷰어가 실제로 접속을 받는 상태인가. 프로세스 존재보다 이쪽이 진짜 판정이다.

    (사람이 손으로 띄워 둔 인스턴스도 이 검사로 함께 인식된다 — 중복 기동을 막는다.)
    """
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=_PORT_PROBE_TIMEOUT):
            return True
    except OSError:
        return False


def get_status() -> dict:
    """뷰어 가용/기동 상태. 프론트가 모달을 열 때와 폴링에 쓴다."""
    resolved = _resolve_viewer()
    if resolved is None:
        return {
            "available": False,
            "running": False,
            "starting": False,
            "port": _DEFAULT_PORT,
            "detail": f"{_VIEWER_EXE_NAME} 를 서버에서 찾을 수 없습니다.",
        }

    _exe_path, viewer_dir = resolved
    port = _configured_port(viewer_dir)
    running = _port_is_open(port)

    with _lock:
        proc = _process
        launched_at = _last_start_at
    # 기동 직후 포트가 아직 안 열린 구간을 'starting' 으로 알려 프론트가 계속 폴링하게 한다.
    starting = (
        not running
        and proc is not None
        and proc.poll() is None
        and (time.monotonic() - launched_at) < _START_GRACE_SEC
    )

    return {
        "available": True,
        "running": running,
        "starting": starting,
        "port": port,
    }


def start_viewer() -> dict:
    """뷰어가 꺼져 있으면 띄운다. 이미 떠 있거나 기동 중이면 아무것도 하지 않는다.

    기동에는 수십 초가 걸리므로 여기서 기다리지 않고 즉시 반환한다 — 완료 판정은
    프론트가 get_status 폴링으로 한다.
    """
    global _process, _last_start_at

    resolved = _resolve_viewer()
    if resolved is None:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Mode Shape 뷰어({_VIEWER_EXE_NAME})를 서버에서 찾을 수 없습니다. "
                "서버 관리자에게 문의하세요."
            ),
        )

    exe_path, viewer_dir = resolved
    port = _configured_port(viewer_dir)

    with _lock:
        if _port_is_open(port):
            return {"available": True, "running": True, "starting": False, "port": port}
        if (
            _process is not None
            and _process.poll() is None
            and (time.monotonic() - _last_start_at) < _START_GRACE_SEC
        ):
            # 이미 기동 중 — 중복 실행하면 Streamlit 이 "Port is already in use" 로 죽는다.
            return {"available": True, "running": False, "starting": True, "port": port}

        # stdout 을 파이프로 물면 버퍼가 차서 뷰어가 멈춘다. 로그 파일로 돌린다.
        log_path = os.path.join(viewer_dir, _LOG_NAME)
        try:
            log_file = open(log_path, "ab", buffering=0)
        except OSError as exc:
            logger.warning("ModeShapeViewer log open failed (%s): %s", log_path, exc)
            log_file = subprocess.DEVNULL

        creationflags = 0
        if os.name == "nt":
            # 콘솔을 분리해 자식의 콘솔 신호가 부모(uvicorn)로 전파되지 않게 한다.
            creationflags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
                subprocess, "CREATE_NEW_PROCESS_GROUP", 0
            )

        try:
            _process = subprocess.Popen(
                [exe_path],
                cwd=viewer_dir,          # ★ .streamlit/config.toml 은 cwd 기준으로 읽힌다
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
                close_fds=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("ModeShapeViewer start failed")
            raise HTTPException(
                status_code=503,
                detail=f"Mode Shape 뷰어를 시작하지 못했습니다: {exc}",
            ) from exc
        finally:
            if log_file is not subprocess.DEVNULL:
                # Popen 이 핸들을 상속했으므로 부모 쪽 핸들은 닫아도 된다.
                try:
                    log_file.close()
                except OSError:
                    pass

        _last_start_at = time.monotonic()
        logger.info("ModeShapeViewer started (pid=%s, port=%s)", _process.pid, port)

    return {"available": True, "running": False, "starting": True, "port": port}
