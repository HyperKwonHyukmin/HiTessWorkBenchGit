"""외부 프로그램 종료 코드 — 비정상 종료(Windows 예외)를 '모델 문제' 와 구분한다.

⚠ 지금은 파이썬 bridge 자식(실패 시 1 로만 끝남)에만 쓴다. C# 엔진(Cmb.Cli·MooringFitting 등)에 그대로 붙이지 말 것 —
   .NET 미처리 예외(0xE0434352)·exit(-1)(0xFFFFFFFF)도 이 범위에 들어 잘못된 입력으로 난 실패를 '실행 환경 문제' 로 안내하게 된다.
   넓히려면 범위(0xC0000000~0xCFFFFFFF)부터 좁히고 프론트 사본(utils/abnormalExit.js)과 함께 고친다.

Windows 에서 프로그램이 예외로 죽으면 종료 코드가 NTSTATUS(0xC0000000 이상)다. 가장 흔한 것은
0xC0000005(= 3221225477, 접근 위반). 이 PC 에서는 회사 DRM 모듈(HIDRMH.DLL)이 파이썬을 이 코드로 끊은 일이 있다
(2026-11-10, PyCharm 터미널에서 띄운 백엔드 — 같은 BDF 를 다른 셸에서 돌리면 정상).
그런데 화면에는 'BDF 형식을 확인하세요'·'_edited.json 을 BDF 로 변환할 수 없습니다' 처럼 입력 탓으로 나갔다.

화면 쪽 사본: frontend `utils/abnormalExit.js`(엔진 로그의 `[Exit code: N]`·`exit=N` 을 읽는다). 문구를 바꾸면 양쪽 다.
"""
from __future__ import annotations

_NTSTATUS_MIN = 0xC0000000

_KNOWN = {
    0xC0000005: "접근 위반",
    0xC00000FD: "스택 넘침",
    0xC0000409: "버퍼 검사 실패",
    0xC0000135: "필요한 DLL 없음",
    0xC0000142: "DLL 초기화 실패",
}


def is_abnormal_exit(returncode: int | None) -> bool:
    """Windows 예외로 죽은 종료 코드인가(음수로 온 값도 같은 32비트로 본다)."""
    if returncode is None:
        return False
    return (int(returncode) & 0xFFFFFFFF) >= _NTSTATUS_MIN


def abnormal_exit_message(returncode: int, what: str) -> str:
    """사용자에게 보일 한 문장. what = 무엇을 하다 죽었는지(예: 'BDF 검증 프로그램')."""
    code = int(returncode) & 0xFFFFFFFF
    kind = _KNOWN.get(code, "예외")
    return (
        f"{what}이 비정상 종료했습니다(Windows {kind} 0x{code:08X}). "
        "입력 모델 문제가 아니라 실행 환경 문제일 가능성이 큽니다 — 다시 시도하고, 계속되면 관리자에게 알려 주세요."
    )
