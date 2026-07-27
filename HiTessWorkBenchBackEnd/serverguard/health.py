"""uvicorn HTTP 헬스 판정 — 프로브와 상태 머신.

프로세스 생존(poll) 과 별개로 'HTTP 가 응답하는가' 만 본다. 프로세스는 살아
있는데 응답만 없는 좀비 상태(DB 커넥션 고갈, ThreadPool 데드락, 디스크 풀)를
잡아내는 것이 목적이다.
"""
import urllib.request

HEALTHY = "healthy"
SUSPECT = "suspect"
ZOMBIE = "zombie"

CHECK_INTERVAL_SEC = 15
ZOMBIE_THRESHOLD = 12          # 15초 × 12 = 3분
PROBE_TIMEOUT_SEC = 5

HEALTH_URL = "http://127.0.0.1:9091/api/version"


def probe(url=HEALTH_URL, timeout=PROBE_TIMEOUT_SEC):
    """헬스 엔드포인트가 200 을 반환하면 True.

    /api/version 은 인증도 DB 도 디스크도 타지 않는 상수 반환이라
    (app/routers/system.py 의 check_version) 부하가 사실상 0 이다.
    """
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False


def classify(fail_streak, *, zombie_threshold=ZOMBIE_THRESHOLD):
    """연속 실패 횟수를 상태로 환산한다."""
    if fail_streak <= 0:
        return HEALTHY
    if fail_streak >= zombie_threshold:
        return ZOMBIE
    return SUSPECT


class HealthTracker:
    """연속 실패를 세고 '상태가 바뀐 순간'만 알려준다.

    전이 시에만 알리는 이유는 두 가지다. 로그가 15초마다 쌓여 사고 기록을
    묻어버리지 않게 하고, ZOMBIE 상태가 지속되는 동안 강제 재시작이 반복
    발동하지 않게 한다.
    """

    def __init__(self, zombie_threshold=ZOMBIE_THRESHOLD):
        self.zombie_threshold = zombie_threshold
        self.fail_streak = 0
        self.state = HEALTHY
        self.last_ok_at = None

    def record(self, ok, *, now=None):
        """관측 1회를 기록하고 (상태, 전이여부) 를 반환한다."""
        if ok:
            self.fail_streak = 0
            self.last_ok_at = now
        else:
            self.fail_streak += 1

        new_state = classify(self.fail_streak, zombie_threshold=self.zombie_threshold)
        changed = new_state != self.state
        self.state = new_state
        return new_state, changed

    def reset(self):
        """재시작 직후처럼 판정을 처음부터 다시 시작해야 할 때 호출한다."""
        self.fail_streak = 0
        self.state = HEALTHY
