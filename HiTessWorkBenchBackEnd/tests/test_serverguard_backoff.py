from serverguard.backoff import RestartPolicy


def test_first_restart_is_allowed_immediately():
    policy = RestartPolicy()

    assert policy.decide(now=1000.0) == ("go", 0)


def test_budget_allows_up_to_max_attempts_in_window():
    policy = RestartPolicy(window_sec=60, max_in_window=3)

    for index in range(3):
        assert policy.decide(now=1000.0 + index) == ("go", 0)
        policy.record_attempt(now=1000.0 + index)

    action, delay = policy.decide(now=1003.0)
    assert action == "wait"
    assert delay == 600


def test_attempts_outside_window_do_not_count():
    policy = RestartPolicy(window_sec=60, max_in_window=3)
    for index in range(3):
        policy.record_attempt(now=1000.0 + index)

    # 창(60초) 을 벗어난 시각 — 예산이 회복되어야 한다.
    assert policy.decide(now=1100.0) == ("go", 0)


def test_backoff_delay_grows_then_caps():
    policy = RestartPolicy(window_sec=60, max_in_window=1, backoff_steps=(600, 1200, 2400, 3600))
    observed = []
    now = 0.0

    for _ in range(5):
        policy.record_attempt(now=now)
        action, delay = policy.decide(now=now)
        assert action == "wait"
        observed.append(delay)
        now += delay          # 대기가 끝난 시점으로 시계를 옮긴다.

    assert observed == [600, 1200, 2400, 3600, 3600]


def test_waiting_period_blocks_further_restarts():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.decide(now=1000.0)                       # 백오프 진입 (600초)

    action, delay = policy.decide(now=1100.0)       # 아직 대기 중

    assert action == "wait"
    assert delay == 500


def test_restart_is_allowed_again_after_wait_expires():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.decide(now=1000.0)

    # 이것이 이 설계의 핵심이다 — 기존 동작은 여기서 영구 정지했다.
    assert policy.decide(now=1601.0) == ("go", 0)


def test_record_success_clears_backoff_level():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.decide(now=1000.0)

    policy.record_success()

    assert policy.backoff_level == 0
    assert policy.decide(now=1000.0) == ("go", 0)


def test_reset_restores_initial_state():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.decide(now=1000.0)

    policy.reset()

    assert policy.decide(now=1000.0) == ("go", 0)
    assert policy.history == []
