"""BDF deck 구조(Executive / Case Control / Bulk 구간) 검사와 자동 수정.

카드 내용 검증(GRID·요소·물성)은 nastran_bridge 가 하고, 여기서는 그보다 앞단의 '구간 경계'만 본다.
구간 경계가 틀리면 nastran_bridge 가 모델은 멀쩡히 읽어도(알 수 없는 줄은 건너뛴다) 뒤에서 BDF 를
다시 쓰는 단계(Wire 포함 lifting BDF·편집 적용)와 Nastran 이 깨진다.
실례(2026-10-02, 3542_m09.bdf): BEGIN BULK 줄이 없어 lifting BDF 의 bulk 에 SOL·CEND·SUBCASE 가
다시 들어가 Nastran FATAL 9994/300 — Studio 에는 '실행 실패' 만 떴다.

검사 결과는 GMU 권상 검증(step1 JSON 의 `deckIssues`)에 실리고, 페이지가 사용자 확인을 받은 뒤
`apply_deck_fixes` 로 **수정본을 새로 만든다**(원본은 건드리지 않는다).

줄 단위로만 넣고 빼므로 나머지 줄은 바이트 그대로다 — latin-1 로 읽고 써서 cp949 주석도 보존한다.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

# Case Control 에서 '=' 없이 쓰이는 키워드(nastran_bridge.bulk_start_index 와 같은 집합).
_CASE_CONTROL_BARE = {
    "SUBCASE", "SUBCOM", "SUBSEQ", "SYM", "SYMCOM", "SYMSEQ", "REPCASE",
    "OUTPUT", "ECHOON", "ECHOOFF", "BEGIN",
}
# Bulk 안에 있으면 안 되는 Executive / Case Control 줄의 첫 토큰.
_NOT_BULK_TOKENS = {"SOL", "CEND", "SUBCASE", "SUBCOM", "SUBSEQ", "ECHOON", "ECHOOFF", "BEGIN"}
# 'KEY = 값', 'KEY(옵션) = 값' 모양 — Case Control 문장. bulk 카드는 이렇게 시작하지 않는다
# (free-field 복제 기호 '=' 는 줄 맨 앞이거나 콤마 뒤라 이 패턴에 걸리지 않는다).
_CASE_STATEMENT = re.compile(r"^\s*[A-Za-z][A-Za-z0-9]*\s*(\([^)]*\))?\s*=")

_EOL_STRIP = "\r\n"


def _first_token(stripped: str) -> str:
    return re.split(r"[\s,(]", stripped, maxsplit=1)[0].rstrip("*").upper()


def _is_case_control_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped or stripped.startswith("$"):
        return False
    if _CASE_STATEMENT.match(stripped):
        return True
    return _first_token(stripped) in _NOT_BULK_TOKENS


def _sections(lines: List[str]) -> Dict[str, Any]:
    """BEGIN BULK / CEND 위치와 bulk 시작 줄을 찾는다(줄 끝 개행은 무시)."""
    begin = cend = None
    for index, raw in enumerate(lines):
        upper = raw.rstrip(_EOL_STRIP).strip().upper()
        if begin is None and upper.startswith("BEGIN BULK"):
            begin = index
        if cend is None and upper == "CEND":
            cend = index
    bulk_start = None
    if begin is not None:
        bulk_start = begin + 1
    elif cend is not None:
        for index in range(cend + 1, len(lines)):
            stripped = lines[index].strip()
            if not stripped or stripped.startswith("$") or "=" in stripped:
                continue
            token = _first_token(stripped)
            if token in _CASE_CONTROL_BARE or not token[:1].isalpha():
                continue
            bulk_start = index
            break
    return {"begin": begin, "cend": cend, "bulkStart": bulk_start}


def _bulk_case_control_lines(lines: List[str], bulk_start: int) -> List[int]:
    found = []
    for index in range(bulk_start, len(lines)):
        if lines[index].strip().upper().startswith("ENDDATA"):
            break
        if _is_case_control_line(lines[index]):
            found.append(index)
    return found


def _line_numbers_text(indexes: List[int], limit: int = 5) -> str:
    shown = ", ".join(str(i + 1) for i in indexes[:limit])
    return shown + (f" 외 {len(indexes) - limit}줄" if len(indexes) > limit else "")


def inspect_deck_lines(lines: List[str]) -> List[Dict[str, Any]]:
    """구간 경계 문제 목록. 각 항목은 자동 수정 가능(fixable) 여부와 무엇을 고치는지(fix)를 함께 준다."""
    issues: List[Dict[str, Any]] = []
    sec = _sections(lines)

    if sec["begin"] is None and sec["cend"] is not None and sec["bulkStart"] is not None:
        line_no = sec["bulkStart"] + 1
        issues.append({
            "code": "missing_begin_bulk",
            "severity": "warning",
            "title": "BEGIN BULK 줄 없음",
            "detail": (f"CEND 뒤 Case Control 다음({line_no}번째 줄)부터 모델 카드가 시작되는데 "
                       "BEGIN BULK 줄이 없습니다. 구간을 잘못 읽는 도구에서는 해석이 깨집니다."),
            "lines": [line_no],
            "fixable": True,
            "fix": f"{line_no}번째 줄 앞에 BEGIN BULK 를 넣습니다.",
        })

    if sec["bulkStart"] is not None and (sec["begin"] is not None or sec["cend"] is not None):
        misplaced = _bulk_case_control_lines(lines, sec["bulkStart"])
        if misplaced:
            issues.append({
                "code": "case_control_in_bulk",
                "severity": "error",
                "title": "Bulk 구간에 해석 설정 줄",
                "detail": (f"모델 카드 구간에 SOL·CEND·SUBCASE·'키 = 값' 같은 해석 설정 줄 {len(misplaced)}개가 "
                           f"있습니다({_line_numbers_text(misplaced)}번째 줄). Nastran 이 FATAL 9994/300 으로 멈춥니다."),
                "lines": [i + 1 for i in misplaced],
                "fixable": True,
                "fix": f"해당 {len(misplaced)}줄을 지웁니다(앞쪽 해석 설정 구간은 그대로 둡니다).",
            })
    return issues


def read_deck_lines(path: str) -> List[str]:
    with open(path, "r", encoding="latin-1", newline="") as f:
        return f.read().splitlines(keepends=True)


def inspect_deck(path: str) -> List[Dict[str, Any]]:
    return inspect_deck_lines(read_deck_lines(path))


def apply_deck_fixes_lines(lines: List[str], codes: List[str] | None = None) -> Tuple[List[str], List[Dict[str, Any]]]:
    """고칠 수 있는 문제를 고친 줄 목록과 실제로 적용한 항목을 돌려준다. codes 가 None 이면 전부."""
    issues = [i for i in inspect_deck_lines(lines) if i["fixable"] and (codes is None or i["code"] in codes)]
    if not issues:
        return lines, []
    eol = "\r\n" if any(line.endswith("\r\n") for line in lines[:50]) else "\n"
    by_code = {i["code"]: i for i in issues}
    sec = _sections(lines)
    remove: set = set()
    if "case_control_in_bulk" in by_code:
        remove = {n - 1 for n in by_code["case_control_in_bulk"]["lines"]}
    insert_at = sec["bulkStart"] if "missing_begin_bulk" in by_code else None

    fixed: List[str] = []
    for index, line in enumerate(lines):
        if index == insert_at:
            fixed.append("BEGIN BULK" + eol)
        if index in remove:
            continue
        fixed.append(line)
    applied = [{"code": i["code"], "title": i["title"], "fix": i["fix"]} for i in issues]
    return fixed, applied


def apply_deck_fixes(src_path: str, dst_path: str, codes: List[str] | None = None) -> List[Dict[str, Any]]:
    fixed, applied = apply_deck_fixes_lines(read_deck_lines(src_path), codes)
    if applied:
        with open(dst_path, "w", encoding="latin-1", newline="") as f:
            f.write("".join(fixed))
    return applied


def merge_into_step1(step1: Dict[str, Any], issues: List[Dict[str, Any]]) -> Dict[str, Any]:
    """step1 검증 JSON 에 deck 문제를 싣는다 — 목록(deckIssues) + 검증 결과 행 + 오류/경고 수·상태."""
    step1["deckIssues"] = issues
    if not issues:
        return step1
    summary = step1.setdefault("summary", {})
    results = step1.setdefault("validationResults", [])
    for issue in issues:
        results.insert(0, {
            "severity": issue["severity"],
            "cardType": "DECK",
            "cardId": issue["title"],
            "fieldName": issue["code"],
            "message": issue["detail"] + (" 자동 수정할 수 있습니다." if issue.get("fixable") else ""),
        })
        key = "totalErrors" if issue["severity"] == "error" else "totalWarnings"
        summary[key] = int(summary.get(key) or 0) + 1
    if int(summary.get("totalErrors") or 0) > 0:
        step1["status"] = "error"
    elif step1.get("status") == "pass" and int(summary.get("totalWarnings") or 0) > 0:
        step1["status"] = "warning"
    return step1
