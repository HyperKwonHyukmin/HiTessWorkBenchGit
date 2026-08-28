"""WorkBench 전용 런타임 shim 모음.

엔진(연구원 원본) 소스를 한 줄도 고치지 않고, 실행 환경 차이를 바깥에서 주입한다.
`install_all()` 은 **엔진 모듈을 import 하기 전에** 호출해야 한다.

각 shim 은 멱등(idempotent)하며, 이미 설치된 경우 조용히 통과한다.
"""
from . import abaqus_subprocess, console, openpyxl_drm, openpyxl_merged

__all__ = ["install_all", "abaqus_subprocess", "console", "openpyxl_drm", "openpyxl_merged"]


def install_all():
    """모든 shim 을 설치한다. console 은 이후 shim 의 로그가 깨지지 않도록 가장 먼저."""
    console.install()
    openpyxl_merged.install()
    openpyxl_drm.install()
    abaqus_subprocess.install()
