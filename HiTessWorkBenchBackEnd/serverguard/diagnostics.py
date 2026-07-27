"""재시작 직전 진단 스냅샷 — 죽이면 사라지는 증거를 먼저 남긴다.

강제 재시작은 원인을 지운다. 그래서 프로세스를 죽이기 '전에' 호출해야 하며,
수집 자체가 실패하더라도 재시작을 막아서는 안 된다(모든 예외를 삼킨다) —
이건 pidfile 과 반대 원칙이다: pidfile 은 판정을 좌우하는 유일한 데이터라
실패를 전파해야 하지만, 진단은 관측일 뿐이라 실패해도 주작업(재시작)을
막으면 안 된다.
"""
from pathlib import Path

import psutil

# psutil.disk_usage("/") 는 Windows 에서 고정 드라이브가 아니라 "호출 시점의
# 프로세스 cwd 가 있는 드라이브" 를 본다(실측: cwd=C:\... 일 때 사용률 80%대,
# cwd=D:\ 일 때 사용률 1%대 — 완전히 다른 디스크). L1/L2 는 cwd 가 보장되지
# 않는 환경(Task Scheduler 등)에서 돌 수 있어 이 모듈 자신이 위치한 드라이브
# (HiTessWorkBenchBackEnd 가 실제로 체크아웃된 드라이브)를 고정 앵커로 쓴다.
DISK_ANCHOR = str(Path(__file__).resolve().anchor)


def collect(uvicorn_pid=None):
    """호스트·프로세스 지표를 dict 로 반환한다. 실패한 항목은 키가 없다."""
    snapshot = {}

    try:
        snapshot["cpu"] = psutil.cpu_percent(interval=0.1)
        snapshot["mem_pct"] = psutil.virtual_memory().percent
        # 증거가 스스로를 설명해야 한다 — disk_free_gb 만 남으면 나중에 이
        # 로그를 읽는 사람이 어느 드라이브 얘기인지 알 수 없다.
        snapshot["disk_path"] = DISK_ANCHOR
        snapshot["disk_free_gb"] = round(psutil.disk_usage(DISK_ANCHOR).free / (1024 ** 3), 1)
    except Exception:
        pass

    if uvicorn_pid is None:
        return snapshot

    snapshot["uvicorn_pid"] = uvicorn_pid
    try:
        proc = psutil.Process(uvicorn_pid)
        snapshot["threads"] = proc.num_threads()
        snapshot["proc_mem_mb"] = round(proc.memory_info().rss / (1024 ** 2), 1)
    except Exception:
        pass

    return snapshot
