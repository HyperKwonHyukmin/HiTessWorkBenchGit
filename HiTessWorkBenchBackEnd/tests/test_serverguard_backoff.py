from serverguard.backoff import RestartPolicy


def test_first_restart_is_allowed_immediately():
    policy = RestartPolicy()

    assert policy.on_crash(now=1000.0) == ("go", 0)


def test_on_crash_go_records_attempt_automatically():
    # 이 자동 기록이 이번 API 변경의 핵심이다 — 호출자가 별도로
    # record_attempt() 를 호출하는 걸 잊어도 예산 판정이 무력화되지 않는다.
    policy = RestartPolicy(window_sec=60, max_in_window=3)

    action, delay = policy.on_crash(now=1000.0)

    assert (action, delay) == ("go", 0)
    assert policy.history == [1000.0]


def test_budget_allows_up_to_max_attempts_in_window():
    policy = RestartPolicy(window_sec=60, max_in_window=3)

    for index in range(3):
        assert policy.on_crash(now=1000.0 + index) == ("go", 0)

    action, delay = policy.on_crash(now=1003.0)
    assert action == "wait"
    assert delay == 600


def test_default_budget_blocks_after_five_restarts_in_one_minute():
    # 커스텀 파라미터가 아니라 실제 운영 기본값(MAX_RESTARTS_IN_WINDOW=5,
    # 첫 백오프 600초)으로 전체 사이클을 돈다 — 상수가 뒤바뀌는 실수를 잡는다.
    policy = RestartPolicy()

    for index in range(5):
        assert policy.on_crash(now=1000.0 + index) == ("go", 0)

    action, delay = policy.on_crash(now=1005.0)
    assert action == "wait"
    assert delay == 600


def test_attempts_outside_window_do_not_count():
    policy = RestartPolicy(window_sec=60, max_in_window=3)
    for index in range(3):
        policy.record_attempt(now=1000.0 + index)

    # 창(60초) 을 벗어난 시각 — 예산이 회복되어야 한다.
    assert policy.on_crash(now=1100.0) == ("go", 0)


def test_backoff_delay_grows_then_caps():
    policy = RestartPolicy(window_sec=60, max_in_window=1, backoff_steps=(600, 1200, 2400, 3600))
    observed = []
    now = 0.0

    for _ in range(5):
        # max_in_window=1 이라 매 반복에서 반드시 "wait" 분기로 빠진다 —
        # on_crash 의 자동 기록은 "go" 분기에서만 일어나므로 여기서 실제로
        # 예산을 채우는 이 명시적 record_attempt 는 중복이 아니다.
        policy.record_attempt(now=now)
        action, delay = policy.on_crash(now=now)
        assert action == "wait"
        observed.append(delay)
        now += delay          # 대기가 끝난 시점으로 시계를 옮긴다.

    assert observed == [600, 1200, 2400, 3600, 3600]


def test_waiting_period_blocks_further_restarts():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.on_crash(now=1000.0)                     # 백오프 진입 (600초)

    action, delay = policy.on_crash(now=1100.0)     # 아직 대기 중

    assert action == "wait"
    assert delay == 500


def test_restart_is_allowed_again_after_wait_expires():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.on_crash(now=1000.0)

    # 이것이 이 설계의 핵심이다 — 기존 동작은 여기서 영구 정지했다.
    assert policy.on_crash(now=1601.0) == ("go", 0)


def test_record_success_clears_backoff_level():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.on_crash(now=1000.0)

    policy.record_success()

    assert policy.backoff_level == 0
    assert policy.on_crash(now=1000.0) == ("go", 0)


def test_reset_restores_initial_state():
    policy = RestartPolicy(window_sec=60, max_in_window=1)
    policy.record_attempt(now=1000.0)
    policy.on_crash(now=1000.0)

    policy.reset()

    # on_crash 는 "go" 분기에서 history 를 다시 채우므로, reset() 이 실제로
    # 비웠는지는 그 호출 *직전* 에 확인해야 한다 — 이후로 미루면 자동 기록과
    # 뒤섞여 이 검증이 무의미해진다.
    assert policy.history == []
    assert policy.on_crash(now=1000.0) == ("go", 0)
