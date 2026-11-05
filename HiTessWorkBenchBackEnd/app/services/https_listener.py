"""HTTPS 병행 수신 — 같은 프로세스에서 9091(HTTP) 옆에 HTTPS 포트를 하나 더 연다 (2026-11-05).

왜: 9091 은 평문 HTTP 라 세션 토큰·데이터가 망에 그대로 흐른다. 보안팀·사내 CA 없이 **자체 인증서**로
HTTPS 를 열고, 앱이 그 인증서 공개키 지문을 고정(pinning)해 가짜 서버를 거른다.
계획·0단계 시험: RecordMD/2026-11-05-https-certificate-pinning-plan.md (2단계).

설계
----
- **같은 프로세스.** uvicorn 을 하나 더 띄우면 작업 상태(job_status_store)·로그인 시도 횟수 같은 메모리 상태가
  두 프로세스로 갈라진다. 그래서 앱 lifespan 이 같은 app 으로 두 번째 uvicorn Server(lifespan 끔)를 돌린다.
  서버 관리자(server_manager.py)의 실행 명령은 그대로다.
- **켜는 법**: ``.env`` ``HTTPS_PORT=9443``. 인증서·키는 기본 ``<백엔드>/.secrets/tls/server.crt|server.key``
  (``scripts/make_tls_cert.py`` 로 145 에서 만든다 — 개인 키는 145 밖으로 나가지 않는다).
  ``TLS_CERT_FILE``·``TLS_KEY_FILE`` 로 바꿀 수 있다. 비우면 지금과 똑같다(HTTP 만).
- **HTTPS 가 실패해도 9091 은 산다.** 인증서가 없거나·깨졌거나·포트가 쓰이고 있으면 시작 전에 걸러 로그만 남긴다.
  uvicorn 이 바인드 실패 때 부르는 sys.exit 도 이 안에서 막는다(안 막으면 프로세스 전체가 죽는다).
- 로그 설정은 다시 하지 않는다(log_config=None) — 진단용 파일 로깅(diagnostics.py)을 덮어쓰지 않게.
- ⚠ uvicorn ``--workers N`` 으로 바꾸면 워커마다 같은 포트를 열려다 실패한다(지금 145 는 워커 1개).
"""
from __future__ import annotations

import asyncio
import logging
import os
import socket
import ssl
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_TLS_DIR = Path(__file__).resolve().parents[2] / ".secrets" / "tls"
_STOP_TIMEOUT_SEC = 10


@dataclass(frozen=True)
class TlsSettings:
    port: int
    cert: Path
    key: Path


def tls_settings() -> Optional[TlsSettings]:
    """``HTTPS_PORT`` 가 없으면 None(HTTPS 끔)."""
    raw = (os.getenv("HTTPS_PORT") or "").strip()
    if not raw:
        return None
    try:
        port = int(raw)
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        logger.error("[https] HTTPS_PORT=%r 가 포트 번호가 아니라 HTTPS 를 열지 않습니다", raw)
        return None
    cert = Path((os.getenv("TLS_CERT_FILE") or "").strip() or DEFAULT_TLS_DIR / "server.crt")
    key = Path((os.getenv("TLS_KEY_FILE") or "").strip() or DEFAULT_TLS_DIR / "server.key")
    return TlsSettings(port=port, cert=cert, key=key)


def preflight(settings: TlsSettings, host: str = "0.0.0.0") -> Optional[str]:
    """열기 전에 확인한다. 문제가 있으면 사유 문자열, 없으면 None."""
    for label, path in (("인증서", settings.cert), ("개인 키", settings.key)):
        if not path.is_file():
            return f"{label} 파일이 없습니다: {path}"
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(str(settings.cert), str(settings.key))
    except (ssl.SSLError, OSError, ValueError) as exc:
        return f"인증서·키를 읽지 못했습니다({exc})"
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((host, settings.port))
    except OSError as exc:
        return f"포트 {settings.port} 를 열 수 없습니다({exc})"
    finally:
        probe.close()
    return None


def _quiet_server_class():
    import contextlib

    import uvicorn

    class QuietServer(uvicorn.Server):
        """신호(Ctrl+C)를 가로채지 않는 uvicorn Server — 종료는 HTTP 쪽 lifespan 의 stop() 한 곳에서 한다.
        기본 Server 는 시작할 때 SIGINT 처리기를 자기 것으로 바꿔 끼워, HTTPS 가 먼저 다 끝나야 9091 이 내려갔다."""

        @contextlib.contextmanager
        def capture_signals(self):
            yield

    return QuietServer


def _QuietServer(config):  # noqa: N802 — uvicorn 을 import 시점에 부르지 않으려고 함수로 감쌌다
    return _quiet_server_class()(config)


class HttpsListener:
    def __init__(self):
        self._server = None
        self._task: Optional[asyncio.Task] = None
        self.port: Optional[int] = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self, app, settings: Optional[TlsSettings] = None, host: str = "0.0.0.0") -> bool:
        settings = settings or tls_settings()
        if settings is None:
            return False
        problem = preflight(settings, host)
        if problem:
            logger.error("[https] HTTPS 를 열지 않습니다 — %s (HTTP 9091 은 그대로 동작)", problem)
            return False

        import uvicorn

        config = uvicorn.Config(
            app,
            host=host,
            port=settings.port,
            ssl_certfile=str(settings.cert),
            ssl_keyfile=str(settings.key),
            lifespan="off",       # 시작·종료 작업은 HTTP 쪽 lifespan 이 한 번만 한다
            log_config=None,      # 기존 로그 설정 유지
        )
        self._server = _QuietServer(config)
        self.port = settings.port
        self._task = asyncio.create_task(self._run(), name="https-listener")
        logger.info("[https] HTTPS 수신 시작 — 포트 %s", settings.port)
        return True

    async def _run(self) -> None:
        try:
            await self._server.serve()
        except SystemExit:
            # uvicorn 은 바인드 실패 때 sys.exit(1) 을 부른다 — 여기서 막아 HTTP 서버는 살린다.
            logger.error("[https] HTTPS 수신이 시작 중 멈췄습니다(HTTP 9091 은 그대로 동작)")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[https] HTTPS 수신 오류")

    async def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        task, self._task = self._task, None
        if task is not None:
            try:
                await asyncio.wait_for(task, _STOP_TIMEOUT_SEC)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                task.cancel()
        self._server = None


https_listener = HttpsListener()
