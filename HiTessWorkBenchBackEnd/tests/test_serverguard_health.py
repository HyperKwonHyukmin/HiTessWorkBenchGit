import http.server
import socket
import threading

import pytest

from serverguard import health


def test_classify_zero_failures_is_healthy():
    assert health.classify(0) == health.HEALTHY


def test_classify_partial_failures_is_suspect():
    assert health.classify(1) == health.SUSPECT
    assert health.classify(11) == health.SUSPECT


def test_classify_at_threshold_is_zombie():
    assert health.classify(12) == health.ZOMBIE
    assert health.classify(99) == health.ZOMBIE


def test_default_threshold_is_three_minutes():
    # 15초 주기 × 12회 = 180초. 재시작은 되돌릴 수 없으므로 넉넉한 유예를 둔다.
    assert health.CHECK_INTERVAL_SEC * health.ZOMBIE_THRESHOLD == 180


def test_tracker_reports_transition_only_once():
    tracker = health.HealthTracker(zombie_threshold=3)

    assert tracker.record(False) == (health.SUSPECT, True)
    assert tracker.record(False) == (health.SUSPECT, False)
    assert tracker.record(False) == (health.ZOMBIE, True)
    # 이미 zombie 인 상태의 추가 실패는 전이가 아니다 — 재시작이 반복 발동하면 안 된다.
    assert tracker.record(False) == (health.ZOMBIE, False)


def test_tracker_success_resets_streak_and_reports_recovery():
    tracker = health.HealthTracker(zombie_threshold=3)
    tracker.record(False)

    state, changed = tracker.record(True, now=1234.5)

    assert (state, changed) == (health.HEALTHY, True)
    assert tracker.fail_streak == 0
    assert tracker.last_ok_at == 1234.5


def test_tracker_reset_returns_to_healthy():
    tracker = health.HealthTracker(zombie_threshold=3)
    tracker.record(True, now=999)
    tracker.record(False)
    tracker.record(False)
    tracker.record(False)
    assert tracker.state == health.ZOMBIE
    assert tracker.last_ok_at == 999

    tracker.reset()

    assert tracker.state == health.HEALTHY
    assert tracker.fail_streak == 0
    # 재시작된 새 프로세스는 아직 한 번도 응답하지 않았다 — 죽은 이전
    # 프로세스의 마지막 정상 시각이 새 프로세스 기록처럼 남으면 안 된다.
    assert tracker.last_ok_at is None


class _StatusHandler(http.server.BaseHTTPRequestHandler):
    """고정된 상태 코드만 응답하는 최소 핸들러."""

    status_code = 200

    def do_GET(self):
        self.send_response(self.status_code)
        self.end_headers()

    def log_message(self, format, *args):
        pass  # 기본 접근 로그를 무음 처리 — pytest 출력이 지저분해지는 것을 막는다.


@pytest.fixture
def http_server():
    """지정한 상태 코드로 응답하는 임시 HTTP 서버를 띄운다(실제 소켓 왕복, mock 없음)."""
    servers = []

    def _make(status_code):
        handler_cls = type(f"_Handler{status_code}", (_StatusHandler,), {"status_code": status_code})
        server = http.server.HTTPServer(("127.0.0.1", 0), handler_cls)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        servers.append(server)
        return server

    yield _make

    for server in servers:
        server.shutdown()
        server.server_close()


def test_probe_returns_true_for_200_response(http_server):
    server = http_server(200)
    port = server.server_address[1]

    assert health.probe(f"http://127.0.0.1:{port}/api/version", timeout=1) is True


def test_probe_returns_false_for_500_response(http_server):
    # urlopen 은 500 에서 status==200 비교에 도달하지 못하고 HTTPError 를
    # 던진다 — "응답은 하지만 500 이면 unhealthy" 라는 다른 코드 경로다.
    server = http_server(500)
    port = server.server_address[1]

    assert health.probe(f"http://127.0.0.1:{port}/api/version", timeout=1) is False


def test_probe_returns_false_for_closed_port():
    # 열려 있지 않은 포트를 골라 실제 연결 실패 경로를 검증한다.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        free_port = sock.getsockname()[1]

    assert health.probe(f"http://127.0.0.1:{free_port}/api/version", timeout=1) is False


def test_probe_returns_false_on_malformed_url():
    assert health.probe("not-a-url", timeout=1) is False
