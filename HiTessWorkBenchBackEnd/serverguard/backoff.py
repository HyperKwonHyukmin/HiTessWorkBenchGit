"""재시작 예산과 지수 백오프.

기존 동작(60초 내 5회 실패 후 자동 재시작 영구 포기, server_manager.py 의
_schedule_auto_restart)을 대체한다. 영구 정지는 무인 복구를 깨뜨린다 —
그 상태에서도 L1 프로세스는 살아 있어서 L2 가 개입하지 않기 때문에,
서버가 죽은 채로 아무도 살리지 않는 상태가 된다.

예산을 소진하면 멈추는 대신 점점 긴 간격으로 재시도한다. 무한 재시작 방지라는
원래 목적은 백오프가 대신 담당하고, 일시적 원인(DB 재기동, 디스크 일시 부족,
네트워크 드라이브 끊김)이 해소되면 사람 없이 스스로 복귀한다.
"""

RESTART_WINDOW_SEC = 60
MAX_RESTARTS_IN_WINDOW = 5
BACKOFF_STEPS_SEC = (600, 1200, 2400, 3600)      # 10 / 20 / 40 / 60분


class RestartPolicy:
    """지금 재시작해도 되는지 판단한다. 시계는 호출자가 주입한다(테스트 가능).

    사용 계약: `on_crash()` 는 크래시 1건당 정확히 한 번만 호출한다
    (server_manager.py 의 _schedule_auto_restart 가 이렇게 쓴다). `"go"` 를
    반환할 때는 그 자리에서 스스로 `record_attempt()` 를 호출해 시도를
    기록한다 — 실제 호출부에서도 "go" 직후 조건 없이 항상 기록이 뒤따르므로,
    그 관계를 호출자에게 맡겨두면 잊었을 때 history 가 영원히 비어 있어
    예산 판정이 조용히 무력화된다("go" 만 계속 반환) — 이 모듈이 없애려던
    무한 재시작을 그대로 되살리는 실패 모드다. `"wait"` 를 반환할 때는
    아무것도 기록하지 않는다(대기 중에는 재시작을 시도하지 않았으므로).
    `record_attempt()` 자체는 여전히 공개 메서드로 남아 있다 — 테스트가
    시나리오를 미리 세팅하는 독립된 원시 연산으로 쓴다.
    """

    def __init__(self, window_sec=RESTART_WINDOW_SEC,
                 max_in_window=MAX_RESTARTS_IN_WINDOW,
                 backoff_steps=BACKOFF_STEPS_SEC):
        self.window_sec = window_sec
        self.max_in_window = max_in_window
        self.backoff_steps = tuple(backoff_steps)
        self.history = []
        self.backoff_level = 0
        self.wait_until = 0.0

    def on_crash(self, now):
        """크래시 발생 시 호출한다. ("go", 0) 또는 ("wait", 남은초) 를 반환한다.

        예산 소진을 판정하는 순간 백오프 단계를 올리고 대기 종료 시각을 확정한다.
        "go" 를 반환하기 직전에는 이 시도를 스스로 기록한다 — 분리해뒀을 때의
        실패 모드(호출자가 기록을 잊으면 예산 판정이 조용히 무력화된다)를
        원천적으로 없앤다.
        """
        if now < self.wait_until:
            return ("wait", self.wait_until - now)

        self.history = [t for t in self.history if now - t < self.window_sec]

        if len(self.history) >= self.max_in_window:
            step = min(self.backoff_level, len(self.backoff_steps) - 1)
            delay = self.backoff_steps[step]
            self.backoff_level += 1
            self.wait_until = now + delay
            self.history = []            # 대기 후에는 깨끗한 예산으로 재개한다.
            return ("wait", delay)

        self.record_attempt(now)
        return ("go", 0)

    def record_attempt(self, now):
        """재시작을 실제로 시도했음을 기록한다."""
        self.history.append(now)

    def record_success(self):
        """서버가 정상 응답을 회복했을 때 호출한다 — 백오프 단계를 초기화한다."""
        self.reset()

    def reset(self):
        """사용자가 GUI 에서 직접 Start 를 눌렀을 때처럼 완전 초기화한다."""
        self.history = []
        self.backoff_level = 0
        self.wait_until = 0.0
