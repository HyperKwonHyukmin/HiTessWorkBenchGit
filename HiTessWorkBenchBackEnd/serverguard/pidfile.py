"""L1 PID 파일 — L1(server_manager.py) 과 L2(server_watchdog.py) 의 유일한 통신 수단.

L1 이 기동 시 자기 PID 를 쓰고 정상 종료 시 지운다. L2 는 이 파일을 읽어
L1 의 생존을 1차 판정하고, HTTP 헬스체크로 2차 확인한다(server_watchdog.py,
Task 11). 소켓·IPC 없이 파일만 쓰므로 두 계층이 서로의 내부 구현을 몰라도 된다.

PID 파일이 없다 = L1 이 정상 종료했거나 급사했다 — L2 가 재기동을 판단하는
근거 중 하나가 된다.
"""
from pathlib import Path

PID_FILENAME = "server_manager.pid"


def write(log_dir, pid):
    """PID 를 기록한다.

    이 함수는 실패를 전파한다 — 삼키면 L2 는 PID 파일을 영원히 "없음"으로
    보고, 이미 살아있는 L1 위에 5분마다 중복 기동을 시도하게 된다(이 모듈은
    L2 판정의 유일한 데이터 소스라 실패를 조용히 지우면 존재 목적이
    무력화된다). 호출자(server_manager.py 기동 경로, Task 7)는 반드시 이
    예외를 잡아 이벤트로 기록하되, 그 실패로 L1 자체의 기동을 막지 말 것.
    """
    path = Path(log_dir)
    path.mkdir(parents=True, exist_ok=True)
    (path / PID_FILENAME).write_text(str(pid), encoding="utf-8")


def read(log_dir):
    """기록된 PID 를 int 로 반환한다.

    파일이 없거나(FileNotFoundError) 내용이 PID 로 파싱되지 않으면
    (ValueError) "유효한 기록 없음"이 확정된 상태이므로 None 을 반환한다.
    그 외(PermissionError 등 OSError, 코딩 버그)는 "L1 이 죽었는지 알 수
    없음"이라는 다른 상태이므로 None 으로 뭉개지 않고 그대로 전파한다 —
    호출자가 "확정된 죽음"과 "판독 불가"를 구분해서 처리해야 한다
    (proctree.snapshot_tree 와 같은 원칙).
    """
    try:
        raw = (Path(log_dir) / PID_FILENAME).read_text(encoding="utf-8").strip()
        return int(raw)
    except (FileNotFoundError, ValueError):
        return None


def clear(log_dir):
    """PID 파일을 삭제한다. 없어도 조용히 넘어간다.

    정상 종료 경로에서 호출되며, 실패해도 다음 기동 시 write() 가 새 PID 로
    덮어써 자연히 회복된다 — read()/write() 와 달리 위험이 낮아 조용히
    삼킨다.
    """
    try:
        (Path(log_dir) / PID_FILENAME).unlink()
    except FileNotFoundError:
        pass
