import socket

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
    tracker.record(False)
    tracker.record(False)
    tracker.record(False)
    assert tracker.state == health.ZOMBIE

    tracker.reset()

    assert tracker.state == health.HEALTHY
    assert tracker.fail_streak == 0


def test_probe_returns_false_for_closed_port():
    # 열려 있지 않은 포트를 골라 실제 연결 실패 경로를 검증한다.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        free_port = sock.getsockname()[1]

    assert health.probe(f"http://127.0.0.1:{free_port}/api/version", timeout=1) is False


def test_probe_returns_false_on_malformed_url():
    assert health.probe("not-a-url", timeout=1) is False
