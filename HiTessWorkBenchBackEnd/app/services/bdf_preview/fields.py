"""BDF 필드 값 해석 — WorkBench nastran_bridge.parse_int/parse_float 이식."""
import math
import re

_INT = re.compile(r"^[+-]?\d+")
_SHORT_EXP = re.compile(r"^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([+-]\d+)$")  # 1.-3 → 1.e-3


def _token(value: str | None) -> str:
    if value is None:
        return ""
    value = value.strip()
    return "" if value in ("+", "*") else value


def parse_int(value: str | None) -> int | None:
    token = _token(value)
    m = _INT.match(token) if token else None
    return int(m.group(0)) if m else None


def parse_float(value: str | None) -> float | None:
    token = _token(value)
    if not token:
        return None
    token = token.replace("D", "E").replace("d", "e")
    if "e" not in token.lower():
        token = _SHORT_EXP.sub(r"\1e\2", token)
    try:
        v = float(token)
    except ValueError:
        return None
    # nan·inf·넘침(1.E999) 은 값이 없는 것으로 본다 — 좌표·JSON 머리에 들어가면 뷰어가 깨진다
    return v if math.isfinite(v) else None


def is_real(value: str | None) -> bool:
    """실수 표기인가(소수점·지수 포함) — RBE3 의 가중치와 정수(성분·절점)를 가른다."""
    token = _token(value)
    return bool(token) and ("." in token or "e" in token.lower()) and parse_float(token) is not None
