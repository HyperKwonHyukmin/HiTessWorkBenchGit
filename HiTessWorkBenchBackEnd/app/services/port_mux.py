"""9091 한 포트에서 평문 HTTP 와 HTTPS 를 함께 받는다 (2026-11-10).

왜: 계열사 다른 위치는 보안 정책으로 145 의 **9091 만** 방화벽이 열려 있다. 1.7.2 부터 앱이 HTTPS(9443)로
옮겨 가면서 그쪽에서는 접속 자체가 안 됐다. 포트를 더 열 수 없으니 9091 이 HTTPS 도 받게 한다.
앱은 ``https://10.14.42.145:9091`` 로 붙고 인증서 지문 고정(electron/server-pins.js)도 그대로다.

어떻게: TLS 연결의 첫 바이트는 항상 0x16(Handshake 레코드)이고, 평문 HTTP 요청은 메서드 글자(G·P·D·O·H…)로
시작한다. 연결의 첫 데이터를 보고
- 평문이면 → uvicorn 프로토콜(부모 클래스)이 하던 그대로 처리한다(동작 변화 없음).
- 0x16 이면 → 그 자리에서 asyncio ``SSLProtocol`` 을 끼워 TLS 로 바꾸고, 이미 받은 첫 바이트를 그대로 넘긴다.
  ``loop.start_tls()`` 와 같은 절차인데, start_tls 는 이미 읽은 바이트를 넘겨받지 못해 직접 했다.
  안쪽 HTTP 처리는 같은 클래스 새 인스턴스라 scheme=https · 접속 IP · 연결 목록이 9443 과 똑같다.

켜는 법: 서버 관리자(server_manager.py)가 uvicorn 을 ``--http app.services.port_mux:MuxHTTPProtocol`` 로 띄운다.
TLS 쪽은 ``.env HTTPS_PORT`` 가 있고 인증서를 읽을 수 있을 때만 켜진다(9443 과 같은 인증서).
``.env HTTP_PORT_TLS=0`` 이면 끈다 — 그때 TLS 로 들어온 연결은 예전처럼 400 으로 끝난다.

⚠ ``asyncio.sslproto.SSLProtocol`` 은 내부 API 다(Python 3.11~3.14 에서 같은 모양 확인).
  파이썬을 올리면 tests/test_port_mux.py 가 실제 TLS 연결로 잡는다.
"""
from __future__ import annotations

import logging
import os
import ssl
from asyncio import sslproto

from uvicorn.protocols.http.auto import AutoHTTPProtocol
from uvicorn.protocols.utils import is_ssl

from .https_listener import tls_settings

logger = logging.getLogger(__name__)

TLS_HANDSHAKE_RECORD = 0x16
HANDSHAKE_TIMEOUT_SEC = 15

_UNSET = object()
_context_cache: object = _UNSET


def tls_context() -> ssl.SSLContext | None:
    """9091 에서 쓸 TLS 설정. 처음 TLS 연결이 올 때 한 번 만든다(.env 는 그때 이미 읽혀 있다)."""
    global _context_cache
    if _context_cache is _UNSET:
        _context_cache = _load_context()
    return _context_cache  # type: ignore[return-value]


def reset_tls_context() -> None:
    """시험용 — 다음 연결에서 설정을 다시 읽게 한다."""
    global _context_cache
    _context_cache = _UNSET


def _load_context() -> ssl.SSLContext | None:
    if (os.getenv("HTTP_PORT_TLS") or "").strip() == "0":
        logger.info("[port-mux] HTTP_PORT_TLS=0 — 9091 은 평문만 받습니다")
        return None
    settings = tls_settings()
    if settings is None:
        return None
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(str(settings.cert), str(settings.key))
    except (OSError, ssl.SSLError, ValueError) as exc:
        logger.error("[port-mux] 인증서를 읽지 못해 9091 은 평문만 받습니다(%s)", exc)
        return None
    logger.info("[port-mux] 9091 이 HTTPS 연결도 받습니다(인증서 %s)", settings.cert)
    return ctx


def _consume_waiter(fut) -> None:
    # 핸드셰이크 실패(엉뚱한 클라이언트·스캐너)는 SSLProtocol 이 연결을 닫는다. 결과만 거둬 경고를 막는다.
    if not fut.cancelled():
        fut.exception()


def _feed(proto: sslproto.SSLProtocol, data: bytes) -> None:
    """이미 받은 바이트를 BufferedProtocol 방식으로 넘긴다(transport 가 다음부터 하는 일과 같다)."""
    view = memoryview(data)
    while view:
        buf = proto.get_buffer(len(view))
        n = min(len(buf), len(view))
        buf[:n] = view[:n]
        proto.buffer_updated(n)
        view = view[n:]


class MuxHTTPProtocol(AutoHTTPProtocol):  # type: ignore[misc, valid-type]
    """첫 바이트가 TLS 면 HTTPS 로 바꾸고, 아니면 부모(uvicorn 기본 HTTP 처리) 그대로."""

    _mux_checked = False

    def data_received(self, data: bytes) -> None:
        if not self._mux_checked:
            self._mux_checked = True
            if data and data[0] == TLS_HANDSHAKE_RECORD and not is_ssl(self.transport):
                ctx = tls_context()
                if ctx is not None:
                    self._switch_to_tls(ctx, data)
                    return
        super().data_received(data)

    def _switch_to_tls(self, ctx: ssl.SSLContext, first: bytes) -> None:
        transport = self.transport
        try:
            # 이 객체는 평문 HTTP 처리를 그만둔다 — 연결 목록에서 빼고(종료 때 기다리지 않게) 안쪽에 넘긴다.
            self.connections.discard(self)
            self._unset_keepalive_if_required()
            inner = type(self)(
                config=self.config,
                server_state=self.server_state,
                app_state=self.app_state,
                _loop=self.loop,
            )
            inner._mux_checked = True
            waiter = self.loop.create_future()
            waiter.add_done_callback(_consume_waiter)
            tls = sslproto.SSLProtocol(
                self.loop, inner, ctx, waiter,
                server_side=True,
                ssl_handshake_timeout=HANDSHAKE_TIMEOUT_SEC,
            )
            # 핸드셰이크가 끝나면 SSLProtocol 이 inner.connection_made(TLS transport) 를 부른다.
            transport.set_protocol(tls)
            tls.connection_made(transport)
            _feed(tls, first)
        except Exception:
            logger.exception("[port-mux] TLS 전환 실패 — 연결을 닫습니다")
            transport.close()
