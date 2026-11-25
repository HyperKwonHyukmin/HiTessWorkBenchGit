"""Independent Tank 는 HTTPS(자체 서명 인증서)로만 받는다 — 프록시가 그 인증서 하나만 믿는지 확인."""

import ssl

from app.routers import external_apps
from app.services import app_settings as app_settings_service


def test_upstream_is_https_loopback():
    assert external_apps.INDEPENDENT_TANK_UPSTREAM == "https://127.0.0.1:31870/"


def test_ssl_context_pins_app_certificate_only():
    context = external_apps.independent_tank_ssl_context()
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is False
    # 시스템 인증서 목록은 싣지 않고 앱 인증서 하나만(자체 서명 단말 인증서라 get_ca_certs 에는 안 나온다).
    assert context.cert_store_stats()["x509"] == 1


def test_admin_host_override_keeps_https_scheme():
    upstream = app_settings_service.effective_external_upstream(
        external_apps.INDEPENDENT_TANK_UPSTREAM,
        {"external_host": "10.14.42.114", "external_port": None},
    )
    assert upstream == "https://10.14.42.114:31870/"
