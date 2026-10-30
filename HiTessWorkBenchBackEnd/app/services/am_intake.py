"""Aveva Marine(AM) 연동 — 클라이언트가 보낸 CSV 의 접수 검사.

AM 안의 `HiTessMB.exe` 가 사번·호선·CSV(구조/배관/장비)를 보내면 서버가 받아 저장하고,
Model Builder 엔진이 읽을 수 있는 모양인지 여기서 검사해 결과를 돌려준다(1단계, 빌드는 아직 안 함).
계획: docs/plans/2026-10-30-am-client-implementation-plan.md

종류 판별 기준은 WorkBench Model Builder 페이지(`HiTessModelBuilder.jsx` CSV_REQUIRED_COLS)와 같다 —
구조 = `ori`, 배관 = `outdia`, 장비 = `cog` 열이 헤더에 있어야 한다(부분 일치, 대소문자 무시).
"""
from __future__ import annotations

import csv
import hashlib
import io
from typing import Optional

CSV_KINDS: tuple[str, ...] = ("stru", "pipe", "equip")
KIND_LABELS = {"stru": "구조", "pipe": "배관", "equip": "장비"}
# 프론트 CSV_REQUIRED_COLS 와 같은 순서·같은 열. 한쪽을 고치면 양쪽 다.
REQUIRED_COLUMNS: dict[str, tuple[str, ...]] = {
    "stru": ("ori",),
    "pipe": ("outdia",),
    "equip": ("cog",),
}


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode_csv(data: bytes) -> tuple[Optional[str], Optional[str]]:
    """(본문, 인코딩 이름). UTF-8(BOM 포함) → CP949 순으로 시도하고 둘 다 안 되면 (None, None)."""
    if data.startswith(b"\xef\xbb\xbf"):
        try:
            return data[3:].decode("utf-8"), "utf-8-sig"
        except UnicodeDecodeError:
            return None, None
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        pass
    try:
        return data.decode("cp949"), "cp949"
    except UnicodeDecodeError:
        return None, None


def detect_kind(columns: list[str]) -> Optional[str]:
    """헤더 열 목록으로 CSV 종류를 고른다. 프론트 detectCsvType 과 같은 규칙(먼저 맞는 종류)."""
    for kind in CSV_KINDS:
        if all(any(req in col for col in columns) for req in REQUIRED_COLUMNS[kind]):
            return kind
    return None


def inspect_csv(kind: str, data: bytes, client_sha256: Optional[str] = None) -> dict:
    """받은 CSV 한 개를 검사한다. issues 가 비어 있으면 정상.

    - sha256: 클라이언트가 보낸 값이 있으면 대조(전송 손상 확인)
    - 인코딩: UTF-8/CP949 로 읽히는지
    - 헤더: 지정한 종류의 필수 열이 있는지, 다른 종류로 보이지 않는지
    - 행 수: 헤더 아래 데이터 행이 하나 이상인지
    """
    issues: list[str] = []
    digest = sha256_hex(data)
    result = {
        "kind": kind,
        "size": len(data),
        "sha256": digest,
        "sha256_match": None,
        "encoding": None,
        "columns": 0,
        "rows": 0,
        "detected_kind": None,
        "header_ok": False,
        "issues": issues,
    }

    if client_sha256:
        match = client_sha256.strip().lower() == digest
        result["sha256_match"] = match
        if not match:
            issues.append("전송 중 파일이 바뀌었습니다(sha256 불일치). 다시 보내 주세요.")

    if not data.strip():
        issues.append("빈 파일입니다.")
        return result

    text, encoding = decode_csv(data)
    result["encoding"] = encoding
    if text is None:
        issues.append("UTF-8 또는 CP949 로 읽을 수 없는 파일입니다.")
        return result

    rows = [row for row in csv.reader(io.StringIO(text)) if any(cell.strip() for cell in row)]
    if not rows:
        issues.append("빈 파일입니다.")
        return result

    columns = [cell.strip().strip('"').lower() for cell in rows[0]]
    result["columns"] = len(columns)
    result["rows"] = len(rows) - 1
    detected = detect_kind(columns)
    result["detected_kind"] = detected
    required = REQUIRED_COLUMNS[kind]
    result["header_ok"] = all(any(req in col for col in columns) for req in required)

    label = KIND_LABELS[kind]
    if not result["header_ok"]:
        if detected and detected != kind:
            issues.append(
                f"{label} CSV 로 보냈지만 {KIND_LABELS[detected]} CSV 로 보입니다. 옵션(--{kind})을 확인해 주세요."
            )
        else:
            issues.append(f"{label} CSV 의 필수 열({', '.join(required)})이 헤더에 없습니다.")
    if result["rows"] == 0:
        issues.append("헤더만 있고 데이터 행이 없습니다.")
    return result
