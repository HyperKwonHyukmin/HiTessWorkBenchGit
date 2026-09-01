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

결과 JSON 자동 로드
-------------------
뷰어는 `sys.argv[1:]` 의 첫 인자를 결과 JSON 경로로 받는다(`ModeShapeViewer._cli_json_path`).
사이드바 파일 업로더에 사람이 끌어다 놓지 않아도, **기동 인자로 넘기면 그 결과가 자동으로 열린다.**

한계: Streamlit 서버는 프로세스 하나가 계속 살아 있고 인자는 기동 시점에만 정해진다. 그래서
"다른 결과를 보려면 다른 인자로 다시 띄우는" 수밖에 없다 — 요청된 JSON 이 지금 떠 있는 것과
다르면 뷰어를 재기동한다(약 10~30초). URL 쿼리(`?json=`)로 매 요청 다른 결과를 여는 방식은
엔진이 `st.query_params` 를 읽지 않아 지금은 불가능하다.
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
_loaded_json = None      # 지금 떠 있는 인스턴스를 어떤 JSON 인자로 띄웠는가 (없으면 None)
_current_port = _DEFAULT_PORT   # 마지막으로 확인한 뷰어 포트 (_stop_running_viewer 의 해제 대기용)


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


def _normalize_json_path(json_path) -> "str | None":
    """요청된 결과 JSON 경로를 검증해 절대경로로 정규화한다.

    뷰어에 넘길 인자이므로 userConnection 하위의 실제 파일만 허용한다(임의 경로 노출 차단).
    """
    if not json_path:
        return None
    candidate = os.path.abspath(str(json_path))
    root = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))
    if not candidate.startswith(root + os.sep):
        raise HTTPException(status_code=400, detail="결과 JSON 경로가 올바르지 않습니다.")
    if not os.path.isfile(candidate):
        raise HTTPException(status_code=404, detail="결과 JSON 파일을 찾을 수 없습니다.")
    return candidate


def get_status(json_path=None) -> dict:
    """뷰어 가용/기동 상태. 프론트가 모달을 열 때와 폴링에 쓴다.

    json_path 를 주면 '그 결과가 이미 열려 있는가'(matches)까지 알려준다 — 프론트는 이게
    true 일 때만 iframe 으로 전환해, 이전 결과가 잠깐 보이는 일을 막는다.
    """
    resolved = _resolve_viewer()
    if resolved is None:
        return {
            "available": False,
            "running": False,
            "starting": False,
            "matches": False,
            "port": _DEFAULT_PORT,
            "detail": f"{_VIEWER_EXE_NAME} 를 서버에서 찾을 수 없습니다.",
        }

    _exe_path, viewer_dir = resolved
    port = _configured_port(viewer_dir)
    running = _port_is_open(port)

    with _lock:
        proc = _process
        launched_at = _last_start_at
        loaded = _loaded_json
    # 기동 직후 포트가 아직 안 열린 구간을 'starting' 으로 알려 프론트가 계속 폴링하게 한다.
    starting = (
        not running
        and proc is not None
        and proc.poll() is None
        and (time.monotonic() - launched_at) < _START_GRACE_SEC
    )

    wanted = os.path.abspath(str(json_path)) if json_path else None
    return {
        "available": True,
        "running": running,
        "starting": starting,
        # 요청한 결과를 열고 있는가. json 을 안 물어봤으면 '떠 있으면 OK'.
        "matches": bool(running and (wanted is None or loaded == wanted)),
        "loadedJson": loaded,
        "port": port,
    }


def _stop_running_viewer(exe_path: str) -> None:
    """떠 있는 뷰어를 종료한다(_lock 보유 상태에서 호출).

    다른 결과 JSON 을 열려면 인자를 바꿔 다시 띄우는 수밖에 없다. 우리가 띄운 것뿐 아니라
    사람이 손으로 띄워 둔 인스턴스도 정리해야 포트가 비므로, 같은 exe 경로를 실행 중인
    프로세스를 모두 대상으로 한다.
    """
    global _process, _loaded_json

    proc = _process
    _process = None
    _loaded_json = None
    if proc is not None and proc.poll() is None:
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            logger.warning("ModeShapeViewer kill failed", exc_info=True)

    # onefile 은 부모/자식 2개 프로세스로 뜬다 — 경로가 같은 것을 모두 정리한다.
    try:
        import psutil
    except ImportError:
        return
    target = os.path.normcase(os.path.abspath(exe_path))
    for candidate in psutil.process_iter(["pid", "exe"]):
        try:
            exe = candidate.info.get("exe")
            if exe and os.path.normcase(os.path.abspath(exe)) == target:
                candidate.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        except Exception:  # noqa: BLE001
            continue

    # 포트가 실제로 풀릴 때까지 잠깐 기다린다(바로 재기동하면 'Port is already in use').
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if not _port_is_open(_current_port):
            return
        time.sleep(0.3)


def start_viewer(json_path=None) -> dict:
    """뷰어를 요청된 결과 JSON 과 함께 띄운다.

    - 이미 그 JSON 으로 떠 있으면 아무것도 하지 않는다.
    - 다른 JSON 으로 떠 있으면 재기동한다(인자는 기동 시점에만 정해지므로 다른 방법이 없다).
    - 꺼져 있으면 새로 띄운다.

    기동에는 수십 초가 걸리므로 여기서 기다리지 않고 즉시 반환한다 — 완료 판정은
    프론트가 get_status 폴링으로 한다.
    """
    global _process, _last_start_at, _loaded_json, _current_port

    wanted = _normalize_json_path(json_path)
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
    _current_port = port

    with _lock:
        already_up = _port_is_open(port)
        if already_up and _loaded_json == wanted:
            # 원하는 결과가 이미 열려 있다 — 건드리지 않는다.
            return {
                "available": True, "running": True, "starting": False,
                "matches": True, "loadedJson": _loaded_json, "port": port,
            }
        if (
            not already_up
            and _process is not None
            and _process.poll() is None
            and _loaded_json == wanted
            and (time.monotonic() - _last_start_at) < _START_GRACE_SEC
        ):
            # 같은 결과로 이미 기동 중 — 중복 실행하면 "Port is already in use" 로 죽는다.
            return {
                "available": True, "running": False, "starting": True,
                "matches": False, "loadedJson": _loaded_json, "port": port,
            }
        if already_up or (_process is not None and _process.poll() is None):
            # 다른 결과가 열려 있거나 기동 중 — 인자를 바꾸려면 재기동뿐이다.
            logger.info(
                "ModeShapeViewer restart for a different result (%s -> %s)", _loaded_json, wanted
            )
            _stop_running_viewer(exe_path)

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

        # ★ 결과 JSON 을 기동 인자로 넘긴다 — 뷰어의 _cli_json_path() 가 sys.argv[1] 을 읽어
        #    사이드바 업로드 없이 그 결과를 바로 연다.
        command = [exe_path] + ([wanted] if wanted else [])
        try:
            _process = subprocess.Popen(
                command,
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
        _loaded_json = wanted
        logger.info(
            "ModeShapeViewer started (pid=%s, port=%s, json=%s)", _process.pid, port, wanted
        )

    return {
        "available": True, "running": False, "starting": True,
        "matches": False, "loadedJson": wanted, "port": port,
    }
