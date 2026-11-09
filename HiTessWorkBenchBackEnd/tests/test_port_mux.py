"""9091 한 포트에서 평문·HTTPS 함께 받기(2026-11-10) — 실제 uvicorn 서버에 실제 소켓으로 붙어 확인한다.

지키는 것
- 평문 HTTP 는 예전과 똑같이 동작한다(scheme=http).
- TLS 로 붙으면 같은 포트에서 HTTPS 로 응답하고, scheme=https · 접속 IP 가 그대로 보이며, 인증서 고정값이 같다.
- 한 연결에서 여러 요청(keep-alive)·큰 본문 업로드가 TLS 로 된다.
- HTTP_PORT_TLS=0 이거나 HTTPS_PORT 가 없으면 TLS 는 받지 않고, 평문은 그대로 된다.
- 깨진 TLS 연결이 와도 서버는 계속 평문·TLS 를 받는다.
"""
import asyncio
import socket
import ssl
import sys
from pathlib import Path

import pytest
import uvicorn
from fastapi import FastAPI, Request

from app.services import port_mux

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import make_tls_cert  # noqa: E402


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def tls_env(tmp_path, monkeypatch):
    assert make_tls_cert.main(["--out", str(tmp_path), "--ip", "127.0.0.1", "--dns", "localhost"]) == 0
    monkeypatch.setenv("HTTPS_PORT", "9443")  # 값은 TLS 켜짐 표시로만 쓰인다(이 시험은 9443 을 열지 않는다)
    monkeypatch.setenv("TLS_CERT_FILE", str(tmp_path / "server.crt"))
    monkeypatch.setenv("TLS_KEY_FILE", str(tmp_path / "server.key"))
    monkeypatch.delenv("HTTP_PORT_TLS", raising=False)
    port_mux.reset_tls_context()
    yield tmp_path
    port_mux.reset_tls_context()


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/who")
    def who(request: Request):
        return {"scheme": request.url.scheme, "client": request.client.host}

    @app.post("/size")
    async def size(request: Request):
        return {"size": len(await request.body())}

    return app


def _read_response(sock) -> bytes:
    """Content-Length 만큼 응답 하나를 읽는다(keep-alive 연결용)."""
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            return data
        data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    length = 0
    for line in head.split(b"\r\n"):
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":", 1)[1])
    while len(body) < length:
        body += sock.recv(4096)
    return head + b"\r\n\r\n" + body


def _plain_get(port: int) -> bytes:
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(b"GET /who HTTP/1.1\r\nHost: x\r\n\r\n")
        return _read_response(s)


def _tls_socket(port: int):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # 앱처럼 고정값으로 직접 비교한다
    raw = socket.create_connection(("127.0.0.1", port), timeout=5)
    return ctx.wrap_socket(raw)


def _tls_session(port: int):
    """한 TLS 연결에서 GET 두 번 + 큰 POST 한 번."""
    with _tls_socket(port) as tls:
        der = tls.getpeercert(binary_form=True)
        first = (tls.sendall(b"GET /who HTTP/1.1\r\nHost: x\r\n\r\n"), _read_response(tls))[1]
        second = (tls.sendall(b"GET /who HTTP/1.1\r\nHost: x\r\n\r\n"), _read_response(tls))[1]
        body = b"a" * (3 * 1024 * 1024)
        tls.sendall(b"POST /size HTTP/1.1\r\nHost: x\r\nContent-Length: %d\r\n\r\n" % len(body) + body)
        third = _read_response(tls)
    return der, first, second, third


def _broken_tls(port: int) -> None:
    """0x16 으로 시작하지만 TLS 가 아닌 바이트 — 서버가 연결을 닫아야 한다."""
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(b"\x16\x03\x01\x00\x05garbage-not-a-client-hello")
        try:
            while s.recv(4096):
                pass
        except OSError:
            pass


def _run(scenario):
    port = _free_port()
    # timeout_graceful_shutdown: 평문 포트에 TLS 가 들어와 400 후 상대가 끊으면(끔 시험) uvicorn 이 그 연결을
    # 끝내 기다리는 경우가 있다(Proactor, 우리 코드와 무관한 기본 동작) — 시험 종료만 묶어 둔다.
    config = uvicorn.Config(_app(), host="127.0.0.1", port=port, http=port_mux.MuxHTTPProtocol,
                            lifespan="off", log_config=None, timeout_graceful_shutdown=2)
    server = uvicorn.Server(config)

    async def main():
        task = asyncio.create_task(server.serve())
        try:
            for _ in range(50):
                if server.started:
                    break
                await asyncio.sleep(0.1)
            assert server.started, "서버가 열리지 않음"
            return await asyncio.to_thread(scenario, port)
        finally:
            server.should_exit = True
            await asyncio.wait_for(task, 10)

    return asyncio.run(main())


def test_plain_and_tls_on_same_port(tls_env):
    def scenario(port):
        plain = _plain_get(port)
        tls = _tls_session(port)
        _broken_tls(port)
        after = (_plain_get(port), _tls_session(port)[1])  # 깨진 연결 뒤에도 둘 다 된다
        return plain, tls, after

    plain, (der, first, second, third), (plain_after, tls_after) = _run(scenario)

    assert b"200 OK" in plain and b'"scheme":"http"' in plain
    for resp in (first, second, tls_after):
        assert b"200 OK" in resp and b'"scheme":"https"' in resp and b'"client":"127.0.0.1"' in resp
    assert b'"size":3145728' in third
    assert b"200 OK" in plain_after

    from cryptography import x509
    cert = x509.load_der_x509_certificate(der)
    assert make_tls_cert.spki_pin(cert.public_key()) == make_tls_cert.spki_pin(
        make_tls_cert._load_key(tls_env / "server.key").public_key())


@pytest.mark.parametrize("switch", ["off", "no_https_port"])
def test_tls_refused_when_switched_off(tls_env, monkeypatch, switch):
    if switch == "off":
        monkeypatch.setenv("HTTP_PORT_TLS", "0")
    else:
        monkeypatch.delenv("HTTPS_PORT")

    def scenario(port):
        with pytest.raises((ssl.SSLError, OSError)):
            with _tls_socket(port):
                pass
        return _plain_get(port)

    assert b"200 OK" in _run(scenario)


def test_server_manager_starts_uvicorn_with_mux_protocol():
    import server_manager
    cmd = server_manager.SERVER_CMD
    assert "--http" in cmd and cmd[cmd.index("--http") + 1] == "app.services.port_mux:MuxHTTPProtocol"
    assert cmd[cmd.index("--port") + 1] == "9091"
