"""HTTPS 병행 수신(2026-11-05) — 켜는 조건·실패해도 HTTP 를 살리는지·실제 TLS 응답·인증서 스크립트.

지키는 것
- HTTPS_PORT 가 없으면 아무것도 하지 않는다(지금 145 와 똑같다).
- 인증서가 없거나·깨졌거나·포트가 쓰이고 있으면 열지 않고 False(예외로 앱을 죽이지 않는다).
- 열면 같은 app 을 TLS 로 응답하고, 그 인증서의 고정값(SPKI sha256)이 스크립트가 출력한 값과 같다.
- 키가 있으면 스크립트가 덮어쓰지 않는다(덮어쓰면 앱 고정값이 깨진다).
"""
import asyncio
import base64
import hashlib
import socket
import ssl
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI

from app.services import https_listener as hl

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import make_tls_cert  # noqa: E402


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def tls_dir(tmp_path):
    assert make_tls_cert.main(["--out", str(tmp_path), "--ip", "127.0.0.1", "--dns", "localhost"]) == 0
    return tmp_path


def test_off_without_https_port(monkeypatch):
    monkeypatch.delenv("HTTPS_PORT", raising=False)
    assert hl.tls_settings() is None


def test_bad_port_is_ignored(monkeypatch):
    monkeypatch.setenv("HTTPS_PORT", "abc")
    assert hl.tls_settings() is None


def test_settings_default_paths(monkeypatch):
    monkeypatch.setenv("HTTPS_PORT", "9443")
    monkeypatch.delenv("TLS_CERT_FILE", raising=False)
    s = hl.tls_settings()
    assert s.port == 9443 and s.cert == hl.DEFAULT_TLS_DIR / "server.crt"


def test_preflight_reports_problems(tmp_path, tls_dir):
    missing = hl.TlsSettings(port=_free_port(), cert=tmp_path / "x.crt", key=tmp_path / "x.key")
    assert "없습니다" in hl.preflight(missing, "127.0.0.1")

    (tmp_path / "bad.crt").write_text("not a cert")
    broken = hl.TlsSettings(port=_free_port(), cert=tmp_path / "bad.crt", key=tls_dir / "server.key")
    assert "읽지 못했습니다" in hl.preflight(broken, "127.0.0.1")

    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        taken = hl.TlsSettings(port=busy.getsockname()[1], cert=tls_dir / "server.crt", key=tls_dir / "server.key")
        assert "열 수 없습니다" in hl.preflight(taken, "127.0.0.1")

    ok = hl.TlsSettings(port=_free_port(), cert=tls_dir / "server.crt", key=tls_dir / "server.key")
    assert hl.preflight(ok, "127.0.0.1") is None


def test_start_returns_false_on_problem(tmp_path):
    listener = hl.HttpsListener()
    bad = hl.TlsSettings(port=_free_port(), cert=tmp_path / "none.crt", key=tmp_path / "none.key")
    assert asyncio.run(listener.start(FastAPI(), bad, host="127.0.0.1")) is False
    assert listener.running is False


def _fetch_over_tls(port: int):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # 고정값으로 직접 비교한다(앱이 하는 방식)
    with socket.create_connection(("127.0.0.1", port), timeout=5) as raw, ctx.wrap_socket(raw) as tls:
        der = tls.getpeercert(binary_form=True)
        tls.sendall(b"GET /ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        body = b""
        while chunk := tls.recv(4096):
            body += chunk
    return der, body


def test_serves_same_app_over_tls_and_pin_matches(tls_dir):
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return {"pong": True}

    port = _free_port()
    settings = hl.TlsSettings(port=port, cert=tls_dir / "server.crt", key=tls_dir / "server.key")

    async def scenario():
        listener = hl.HttpsListener()
        assert await listener.start(app, settings, host="127.0.0.1") is True
        for _ in range(50):  # 열릴 때까지 최대 5초
            try:
                result = await asyncio.to_thread(_fetch_over_tls, port)
                break
            except OSError:
                await asyncio.sleep(0.1)
        else:
            raise AssertionError("HTTPS 가 열리지 않음")
        await listener.stop()
        assert listener.running is False
        return result

    der, body = asyncio.run(scenario())
    assert b"200 OK" in body and b'"pong":true' in body

    from cryptography import x509
    cert = x509.load_der_x509_certificate(der)
    assert make_tls_cert.spki_pin(cert.public_key()) == make_tls_cert.spki_pin(
        make_tls_cert._load_key(tls_dir / "server.key").public_key())


def test_script_does_not_overwrite_and_backup_differs(tls_dir, capsys):
    before = (tls_dir / "server.key").read_bytes()
    assert make_tls_cert.main(["--out", str(tls_dir)]) == 1  # 이미 있음
    assert (tls_dir / "server.key").read_bytes() == before
    cur = make_tls_cert.spki_pin(make_tls_cert._load_key(tls_dir / "server.key").public_key())
    bak = make_tls_cert.spki_pin(make_tls_cert._load_key(tls_dir / "backup.key").public_key())
    assert cur != bak
    assert len(base64.b64decode(cur)) == hashlib.sha256().digest_size


def test_promote_backup(tls_dir):
    old_backup = make_tls_cert.spki_pin(make_tls_cert._load_key(tls_dir / "backup.key").public_key())
    assert make_tls_cert.main(["--out", str(tls_dir), "--from-backup", "--ip", "127.0.0.1"]) == 0
    now_current = make_tls_cert.spki_pin(make_tls_cert._load_key(tls_dir / "server.key").public_key())
    assert now_current == old_backup
    assert list(tls_dir.glob("server.key.retired_*"))


def _pin(path):
    return make_tls_cert.spki_pin(make_tls_cert._load_key(path).public_key())


def test_renew_cert_keeps_pins(tls_dir):
    """5년 뒤 인증서 갱신·주소 추가 — 키를 바꾸지 않아 앱 고정값이 그대로다."""
    before = _pin(tls_dir / "server.key"), _pin(tls_dir / "backup.key")
    old_crt = (tls_dir / "server.crt").read_bytes()
    assert make_tls_cert.main(["--out", str(tls_dir), "--renew-cert", "--ip", "127.0.0.1", "--ip", "10.0.0.5"]) == 0
    assert (_pin(tls_dir / "server.key"), _pin(tls_dir / "backup.key")) == before
    assert (tls_dir / "server.crt").read_bytes() != old_crt


def test_force_keeps_backup_key(tls_dir):
    backup = _pin(tls_dir / "backup.key")
    current = _pin(tls_dir / "server.key")
    assert make_tls_cert.main(["--out", str(tls_dir), "--force", "--ip", "127.0.0.1"]) == 0
    assert _pin(tls_dir / "backup.key") == backup
    assert _pin(tls_dir / "server.key") != current


def test_ip_only_does_not_add_145_hostname(tmp_path):
    from cryptography import x509
    assert make_tls_cert.main(["--out", str(tmp_path), "--ip", "10.133.122.70"]) == 0
    cert = x509.load_pem_x509_certificate((tmp_path / "server.crt").read_bytes())
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert san.get_values_for_type(x509.DNSName) == []