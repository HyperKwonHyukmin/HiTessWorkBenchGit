"""uvicorn 자손 프로세스 수집과 정리.

uvicorn 을 죽여도 그 아래에서 돌던 해석 exe(nastran.exe, Cmb.Cli.exe,
MooringFitting.exe 등)는 살아남는다. 실제로 MooringFitting 손자 프로세스가
좀비로 남아 MSC 라이선스를 물고 있던 사례가 있었다. 정리하지 않으면 재시작에는
성공해도 다음 해석이 라이선스를 잡지 못한다.

수집은 죽이기 전에, 정리는 죽인 후에 해야 한다 — 부모가 사라진 뒤에는
자손 관계를 더 이상 조회할 수 없기 때문이다.

알려진 한계: `snapshot_tree` 호출과 `kill_survivors` 호출 사이(또는 uvicorn
재시작 이후)에 새로 생긴 손자 프로세스는 이 스냅샷에 없어 정리되지 않는다.
그 프로세스는 새 uvicorn 프로세스 트리에 속하지 않으므로 다음 크래시 때도
영원히 안 잡힐 수 있다. 실무 발생 확률이 낮고 완전한 해결(예: Windows Job
Object 로 트리 전체를 원자적으로 묶는 것)은 이 모듈의 범위를 넘으므로 고치지
않았다 — 라이선스 누수를 나중에 디버깅할 사람을 위한 기록으로 남긴다.
"""
import os
import time

import psutil

KILL_CONFIRM_TIMEOUT_SEC = 3


def snapshot_tree(pid):
    """pid 의 모든 자손 프로세스 정보를 수집한다. uvicorn 을 죽이기 전에 호출한다.

    create_time 을 함께 담는 이유는 나중에 PID 재사용을 판별하기 위함이다.

    실패 시(대상이 이미 없음·권한 없음·잘못된 pid 등) 조용히 빈 목록을 반환한다.
    "자손 없음"과 "조회 실패"를 반환값만으로는 구분하지 못하지만, 이는 events.py·
    health.py 와 같은 원칙이다 — 관측 실패가 상위 동작(uvicorn 강제 재시작)을
    막아서는 안 된다. 다만 코딩 실수(오타 등)까지 "자손 없음"으로 위장시키지
    않도록, psutil 의 정상적인 프로세스 생명주기 예외(psutil.Error)와 잘못된
    pid 입력(ValueError — 예: psutil.Process(-1))만 잡고 그 외 예외는 그대로
    전파한다.
    """
    try:
        parent = psutil.Process(pid)
        children = parent.children(recursive=True)
    except (psutil.Error, ValueError):
        return []

    entries = []
    for child in children:
        try:
            entries.append({
                "pid": child.pid,
                "name": child.name(),
                "create_time": child.create_time(),
            })
        except psutil.Error:
            continue          # 열거와 조회 사이에 자식이 사라짐 — 흔한 TOCTOU.
    return entries


def kill_survivors(snapshot, *, proc_factory=psutil.Process, timeout=KILL_CONFIRM_TIMEOUT_SEC):
    """snapshot 중 아직 살아있는 프로세스에 종료를 시도하고, 시도한 항목 전체를
    "terminated" 플래그와 함께 반환한다.

    반환값은 확인된 사실이 아니라 *시도 결과* 다. 각 항목의 "terminated" 는
    kill() 요청 후 실제 종료를 확인했는지를 나타낸다. `terminated=False` 는
    kill() 은 보냈지만 timeout 안에 종료를 확인하지 못했다는 뜻이며, 그
    프로세스가 여전히 자원(예: MSC Nastran 라이선스)을 물고 있을 수 있다는
    신호다 — 조용히 목록에서 빼면 사후 분석에 가장 중요한 이 정보가 사라진다.

    create_time 이 일치할 때만 죽인다. Windows 는 PID 를 재활용하므로, 이 확인이
    없으면 그사이 같은 PID 를 받은 무관한 프로세스를 죽이는 사고가 난다.

    자기 자신의 PID(os.getpid())는 절대 건드리지 않는다 — 호출부 실수로 감시
    주체 자신이 snapshot 에 섞여 들어와도 자살하지 않기 위한 최소 방어다. 이
    함수는 `snapshot_tree(uvicorn_pid)` 의 결과만 받는다는 전제다 — 그 결과는
    정의상 uvicorn 자신이나 그 조상을 포함하지 않으므로, 조상 전체를 막는
    방어는 이 함수의 책임이 아니다.

    kill() 은 전부 먼저 보내고, 종료 확인은 하나의 공유 데드라인으로 처리한다.
    프로세스마다 timeout 을 통째로 기다리면 총 대기시간이 프로세스 수에 비례해
    늘어나 호출부(GUI 메인 스레드)를 오래 얼릴 수 있다.

    예외 처리는 snapshot_tree 와 같은 원칙을 따른다 — psutil 의 정상적인
    프로세스 생명주기 예외만 잡고, 그 외(예: entry 에 "pid" 가 없는 KeyError)는
    코딩 버그이므로 그대로 전파한다. 조용히 삼키면 "고아가 정리되지 않은 채
    자원을 물고 있는데 아무도 모르는" 상태가 되어, 이 모듈이 막으려는 실패를
    그대로 재현한다. kill 단계는 psutil.Error(NoSuchProcess/AccessDenied 등),
    wait 단계는 psutil.TimeoutExpired 만 잡는다 — psutil 7.2.2 기준 이미 종료된
    프로세스의 wait() 는 예외 없이 즉시 종료코드를 반환하므로(NoSuchProcess 를
    던지지 않음), 실무에서 wait() 가 던지는 건 TimeoutExpired 뿐이다.
    """
    own_pid = os.getpid()
    attempted = []
    for entry in snapshot:
        if entry.get("pid") == own_pid:
            continue
        try:
            proc = proc_factory(entry["pid"])
            if proc.create_time() != entry["create_time"]:
                continue
            proc.kill()
        except psutil.Error:
            continue          # 이미 종료됨·권한 없음 — 나머지 정리를 계속한다.
        attempted.append((entry, proc))

    deadline = time.monotonic() + timeout
    results = []
    for entry, proc in attempted:
        remaining = max(0.0, deadline - time.monotonic())
        try:
            proc.wait(timeout=remaining)
            terminated = True
        except psutil.TimeoutExpired:
            terminated = False
        results.append({**entry, "terminated": terminated})
    return results
