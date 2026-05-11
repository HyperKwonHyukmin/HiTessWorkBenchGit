"""subprocess stdout/stderr 의 안전 디코딩 헬퍼.

MSC Nastran / 한글 Windows 환경의 외부 도구들은 stderr 를 cp949(EUC-KR) 로 출력하는 경우가 많다.
기존 코드들은 일괄 utf-8 + errors='replace' 로 디코딩해 한글 메시지가 '?' 로 깨졌다.

본 헬퍼는 utf-8 → cp949 → euc-kr 순서로 strict 디코딩을 시도하고, 모두 실패하면
원래 동작과 동일한 utf-8 + errors='replace' 로 떨어진다. 즉 기존 호출자 의미는 보존하면서
한글 메시지 보존만 추가된다.
"""

from __future__ import annotations

import subprocess
from typing import Iterable

_FALLBACK_ENCODINGS: tuple[str, ...] = ("utf-8", "cp949", "euc-kr")


def safe_decode(data: bytes | None, extra: Iterable[str] = ()) -> str:
    """bytes 를 다중 인코딩 fallback 으로 디코딩한다.

    - data 가 None / 빈 bytes 면 "" 반환 (기존 호출자 의미와 동일).
    - utf-8 → cp949 → euc-kr 순 strict 시도. 모두 실패 시 utf-8 errors='replace'.
    - extra 로 추가 인코딩(예: 'shift_jis')을 줄 수 있다.
    """
    if not data:
        return ""
    if not isinstance(data, (bytes, bytearray)):
        # 이미 str 인 경우 그대로 통과시켜 호환성 유지.
        return str(data)
    encodings = (*_FALLBACK_ENCODINGS, *extra)
    for enc in encodings:
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    # 최후 fallback — 기존 동작과 동일.
    return data.decode("utf-8", errors="replace")


def decode_completed(proc: subprocess.CompletedProcess) -> str:
    """CompletedProcess 의 stdout + stderr 를 '[stdout] / [stderr]' 블록으로 합쳐 반환."""
    out = safe_decode(proc.stdout)
    err = safe_decode(proc.stderr)
    parts = []
    if out:
        parts.append(f"[stdout]\n{out}")
    if err:
        parts.append(f"[stderr]\n{err}")
    return "\n".join(parts)
