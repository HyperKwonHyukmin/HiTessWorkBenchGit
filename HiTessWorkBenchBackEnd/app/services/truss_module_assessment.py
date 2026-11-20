"""Truss 소모듈 권상 — 구조 해석 뒤 소모듈 평가 exe 실행 (2026-11-17, 계획 1단계 6~7번).

부모가 TrussModuleLifting 인 Unit 구조 해석이 Nastran 과 lift-result 를 마친 뒤 부른다.
InHouse `TrussModuleAssessment.exe` 는 기존 TrussAssessment 와 같은 판정 파일(허용값 표, UC 식)을 링크로 쓰는 exe 다.
이미 돌린 F06 을 재사용하므로(--f06) Nastran 을 다시 돌리지 않는다.

권상 폴더를 어지럽히지 않게 `<bdf 폴더>/truss_assessment/` 에 BDF 와 F06 사본을 두고 돌린다
(평가 exe 가 BDF 옆에 xlsx, json, log 를 쓴다 — Studio 는 결과 폴더의 .json 을 모델 후보로 읽으므로 섞이지 않게).
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import time
from typing import Any

from .exit_codes import crash_tolerated_note, outputs_complete_after_crash

logger = logging.getLogger(__name__)

_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_EXE = os.path.join(_BACKEND_ROOT, "InHouseProgram", "TrussModuleAssessment", "TrussModuleAssessment.exe")
SUBDIR = "truss_assessment"
TIMEOUT_SEC = 600


def resolve_exe() -> str | None:
    path = os.environ.get("TRUSS_MODULE_ASSESSMENT_EXE") or DEFAULT_EXE
    return path if os.path.isfile(path) else None


def _read_json(path: str) -> Any:
    with open(path, "rb") as fh:
        raw = fh.read()
    return json.loads(raw.decode("utf-8-sig"))


def run_truss_module_assessment(lifting_bdf: str, lifting_f06: str, case_kind: str = "lifting") -> dict:
    """평가 exe 를 돌려 결과를 dict 로 돌려준다.

    반환: { ok, error?, summary?(= <stem>_module.json), elements?(첫 하중 케이스 부재 평가 행), folder, exitCode }
    실패해도 예외를 던지지 않는다 — 호출자가 경고로 남기고 구조 해석 결과는 그대로 둔다.
    """
    try:
        return _run(lifting_bdf, lifting_f06, case_kind)
    except (OSError, ValueError) as error:
        # 옛 산출물이 잠김, 사본 복사 실패, 깨진 요약 JSON — 구조 해석까지 실패로 번지지 않게 경고로 돌린다.
        logger.warning("Truss 소모듈 평가 실패: %s", error)
        return {"ok": False, "error": f"Truss 소모듈 평가 실패: {error}"}


def _run(lifting_bdf: str, lifting_f06: str, case_kind: str) -> dict:
    exe = resolve_exe()
    if not exe:
        return {"ok": False, "error": f"평가 exe 를 찾을 수 없습니다: {DEFAULT_EXE} (InHouse 반영 확인)"}
    if not (os.path.isfile(lifting_bdf) and os.path.isfile(lifting_f06)):
        return {"ok": False, "error": "권상 BDF 또는 F06 이 없습니다."}

    folder = os.path.join(os.path.dirname(lifting_bdf), SUBDIR)
    os.makedirs(folder, exist_ok=True)
    stem = os.path.splitext(os.path.basename(lifting_bdf))[0]
    bdf_copy = os.path.join(folder, stem + ".bdf")
    f06_copy = os.path.join(folder, stem + ".f06")
    # 이전 실행 산출물을 지운다 — 같은 이름의 옛 결과를 읽지 않게
    for ext in (".json", "_module.json", ".xlsx", ".log"):
        p = os.path.join(folder, stem + ext)
        if os.path.exists(p):
            os.remove(p)
    shutil.copyfile(lifting_bdf, bdf_copy)
    shutil.copyfile(lifting_f06, f06_copy)

    args = [exe, bdf_copy, "--f06", f06_copy, "--case", case_kind]
    logger.info("[TrussModuleAssessment] cmd: %s", " ".join(args))
    started = time.time()
    try:
        run = subprocess.run(args, cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=TIMEOUT_SEC)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"평가 exe 가 {TIMEOUT_SEC}초 안에 끝나지 않았습니다.", "folder": folder}

    summary_path = os.path.join(folder, stem + "_module.json")
    report_path = os.path.join(folder, stem + ".json")
    # 종료 순간 DRM 에 끊겨도(0xC0000005) 요약을 이번에 끝까지 썼으면 그대로 쓴다 — GMU 검증, 구조 해석과 같은 규칙.
    crash_ok = run.returncode != 0 and outputs_complete_after_crash(run.returncode, [summary_path], started)
    if crash_ok:
        logger.warning(crash_tolerated_note(run.returncode, "Truss 소모듈 평가"))
    if (run.returncode != 0 and not crash_ok) or not os.path.isfile(summary_path):
        tail = (run.stdout or b"").decode("utf-8", "replace")[-800:]
        return {"ok": False, "error": f"평가 exe 종료 코드 {run.returncode} — {tail.strip()}", "folder": folder, "exitCode": run.returncode}

    summary = _read_json(summary_path)
    elements: list = []
    try:
        report = _read_json(report_path)
        cases = report.get("loadCases") or []
        if cases:
            elements = cases[0].get("elementAssessment") or []
    except (OSError, ValueError) as error:
        logger.warning("평가 보고서 JSON 읽기 실패: %s", error)
    return {
        "ok": True, "summary": summary, "elements": elements, "folder": folder, "exitCode": 0,
        "summaryJson": summary_path, "reportJson": report_path, "reportXlsx": os.path.join(folder, stem + ".xlsx"),
    }


def attach_to_result(result_json: str, result_payload: dict, assessment: dict) -> dict:
    """결과 JSON(Studio 가 받는 lift-result 산출물)에 trussAssessment 를 넣어 다시 쓴다."""
    block = {
        "ok": bool(assessment.get("ok")),
        "error": assessment.get("error"),
        "summary": assessment.get("summary"),
        "elements": assessment.get("elements") or [],
    }
    result_payload["trussAssessment"] = block
    try:
        with open(result_json, "w", encoding="utf-8") as fh:
            json.dump(result_payload, fh, ensure_ascii=False)
    except OSError as error:
        logger.warning("결과 JSON 에 Truss 평가를 넣지 못했습니다: %s", error)
    return block
