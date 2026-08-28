"""stdout/stderr 인코딩 고정 shim.

Abaqus 미설치/미탐지 등으로 cmd.exe 가 콘솔 코드페이지(한국어 Windows 는 cp949)로 에러
메시지를 내보내면, 그 문자열을 다시 print() 할 때 콘솔 코드페이지가 인코딩하지 못해
UnicodeEncodeError 로 파이프라인 전체가 죽는다. 표준 스트림을 UTF-8+replace 로 고정해
print() 가 어떤 바이트를 받아도 죽지 않게 한다.

(엔진 Main.py 상단에 직접 넣어 두었던 reconfigure 개조를 대체한다.)
"""
import sys

_installed = False


def install():
    global _installed
    if _installed:
        return
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            # 이미 detach 됐거나 재설정 불가한 스트림 — 무시하고 진행한다.
            pass
    _installed = True
