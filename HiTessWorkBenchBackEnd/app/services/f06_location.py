"""F06 에서 해석 실패 위치 후보를 찾는다.

FATAL 9050(mechanism) 본문에는 번호가 없고, 바로 앞 경고 4698 의 표가 문제 절점을 말한다:
    GRID POINT ID   DEGREE OF FREEDOM   MATRIX/FACTOR DIAGONAL RATIO   MATRIX DIAGONAL
Studio 는 실패 문구의 `위치 후보 절점: 2108, 2093` 을 읽어 3D 로 안내한다(data/structuralFailure.js).
사람이 읽어도 뜻이 통하게 문구에 싣는다 — 별도 필드를 만들면 Electron(exe)까지 바꿔야 한다.
"""
from __future__ import annotations

import re

LOCATION_LABEL = "위치 후보 절점"
MAX_NODES = 30
_TABLE_HEADER = re.compile(r"GRID POINT ID\s+DEGREE OF FREEDOM\s+MATRIX/FACTOR DIAGONAL RATIO")
_TABLE_ROW = re.compile(r"^\s*(\d+)\s+(T1|T2|T3|R1|R2|R3)\s+(-?\d\.\d+E[+-]\d+)\s+(-?\d\.\d+E[+-]\d+)\s*$")
_SECTION_END = re.compile(r"\*\*\*\s")


def problem_nodes(lines) -> list[int]:
    """4698 표의 절점 번호 — 피벗비가 큰 순서, 중복 제거, 최대 MAX_NODES 개."""
    worst: dict[int, float] = {}
    in_table = False
    for line in lines:
        if _TABLE_HEADER.search(line):
            in_table = True
            continue
        if not in_table:
            continue
        if _SECTION_END.search(line):
            in_table = False
            continue
        row = _TABLE_ROW.match(line)
        if row:
            node = int(row.group(1))
            worst[node] = max(worst.get(node, 0.0), abs(float(row.group(3))))
    return sorted(worst, key=lambda node: worst[node], reverse=True)[:MAX_NODES]


def describe_problem_nodes(f06_path: str) -> str:
    """실패 문구에 덧붙일 한 토막. 표가 없거나 못 읽으면 빈 문자열(실패 처리는 그대로 간다)."""
    try:
        with open(f06_path, encoding="latin-1", errors="replace") as handle:
            nodes = problem_nodes(handle)
    except OSError:
        return ""
    return f" {LOCATION_LABEL}: {', '.join(map(str, nodes))}" if nodes else ""
