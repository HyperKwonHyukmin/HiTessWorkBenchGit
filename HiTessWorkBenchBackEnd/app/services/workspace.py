"""해석 작업 디렉터리 생성 공통 헬퍼.

기존 ``YYYYMMDD_HHMMSS_{employee_id}_{program_name}`` 명명 계약을 유지하면서,
같은 초에 여러 요청이 들어와도 서로의 파일을 덮어쓰지 않도록 최종 디렉터리를
``exist_ok=False`` 로 원자적으로 생성한다.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta


def create_analysis_workspace(
    root_dir: str,
    employee_id: str,
    program_name: str,
    *,
    now: datetime | None = None,
    max_attempts: int = 3600,
) -> tuple[str, str]:
    """고유한 작업 디렉터리를 만들고 ``(절대경로, timestamp)`` 를 반환한다.

    충돌 시 폴더명에 임의 suffix를 붙이지 않고 다음 초의 timestamp를 사용한다.
    따라서 기존 폴더 소유자 파서와 결과 파일명 계약이 그대로 유지된다.
    """
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")

    root = os.path.abspath(root_dir)
    os.makedirs(root, exist_ok=True)
    base_time = (now or datetime.now()).replace(microsecond=0)

    for offset in range(max_attempts):
        timestamp = (base_time + timedelta(seconds=offset)).strftime("%Y%m%d_%H%M%S")
        folder_name = f"{timestamp}_{employee_id}_{program_name}"
        work_dir = os.path.abspath(os.path.join(root, folder_name))
        try:
            os.makedirs(work_dir, exist_ok=False)
        except FileExistsError:
            continue
        return work_dir, timestamp

    raise FileExistsError(
        f"작업 디렉터리를 생성할 수 없습니다. {max_attempts}개의 timestamp 후보가 이미 존재합니다."
    )
