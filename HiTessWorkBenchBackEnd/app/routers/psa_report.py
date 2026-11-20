"""PSA 평가보고서 자동화 프로그램 — 결과 폴더 업로드 (2026-11-17).

화면에서 Line 마다 고른 폴더를 그대로(하위 구조 유지) 작업 폴더에 올린다.
    userConnection/<ts>_<사번>_PsaReport/<Line No.>/<고른 폴더 안의 상대 경로>
    userConnection/<ts>_<사번>_PsaReport/Figures/...            (보고서 그림 폴더)

작업 폴더는 화면의 입력 한 벌에 하나다. 화면은 폴더 이름(workspace)만 들고 있고, 서버는
그 이름이 '이 사용자의 PsaReport 폴더'인지 확인한 뒤에만 쓴다(절대 경로를 받지 않는다).
계획: docs/plans/2026-11-17-psa-report-automation-plan.md
"""
from __future__ import annotations

import json
import os
import re
import shutil
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import require_auth
from ._access_control import assert_current_user_can_access_path
from . import _intake
from ._intake import MAX_UPLOAD_PATH_CHARS, make_work_dir

router = APIRouter(prefix="/api/analysis/psa-report", tags=["PSA Report"])

PROGRAM_NAME = "PsaReport"
_WORKSPACE_RE = re.compile(r"^\d{8}_\d{6}_[^_\\/]+_" + PROGRAM_NAME + r"$")
# 대상 칸 이름 = Line No.(TD01, COMP.RM …) 또는 Figures. 폴더 이름으로 그대로 쓴다.
_TARGET_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()\-]{0,39}$")
_WIN_RESERVED = re.compile(r"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$", re.IGNORECASE)
_BAD_CHARS = set('<>:"|?*')
_CHUNK = 1024 * 1024
_DRM_MAGIC = b"HHIDRMC"
# 화면의 입력값 전체. 보고서 생성은 이 파일 하나만 읽는다(화면 JSON 저장과 같은 내용).
INPUT_FILE_NAME = "psa_input.json"
_INPUT_MAX_BYTES = 2 * 1024 * 1024


def _workspace_dir(workspace: str, current_user: str, db: Session) -> str:
    name = (workspace or "").strip()
    if not _WORKSPACE_RE.match(name):
        raise HTTPException(status_code=400, detail="작업 폴더 이름이 올바르지 않습니다.")
    path = os.path.join(_intake.USER_CONNECTION_DIR, name)
    assert_current_user_can_access_path(path, current_user, db, _intake.USER_CONNECTION_DIR)
    if not os.path.isdir(path):
        # 30일 정리로 지워졌거나 다른 서버의 이름 — 화면이 새 작업 폴더를 만들게 한다.
        raise HTTPException(status_code=404, detail="workspace_missing")
    return path


def _check_target(target: str) -> str:
    t = (target or "").strip()
    if not _TARGET_RE.match(t) or t.rstrip(". ") != t or _WIN_RESERVED.match(t):
        raise HTTPException(
            status_code=400,
            detail=f"폴더 이름으로 쓸 수 없는 Line No. 입니다: '{target}' (영문, 숫자, 공백 . _ ( ) - 만, 40자 이내)",
        )
    return t


def _safe_rel_parts(rel: str) -> list[str]:
    """고른 폴더 안의 상대 경로 → 안전한 조각들. 빠져나가는 경로는 400."""
    parts = [p for p in re.split(r"[\\/]+", rel or "") if p != ""]
    if not parts:
        raise HTTPException(status_code=400, detail="빈 파일 경로가 있습니다.")
    for p in parts:
        if p in (".", "..") or any(c in _BAD_CHARS or ord(c) < 32 for c in p) or _WIN_RESERVED.match(p):
            raise HTTPException(status_code=400, detail=f"쓸 수 없는 파일 경로입니다: {rel}")
    return parts


@router.post("/workspace")
def create_workspace(current_user: str = Depends(require_auth)):
    """입력 한 벌의 작업 폴더를 만든다. 화면은 이름만 기억한다."""
    work_dir, _ts = make_work_dir(current_user, PROGRAM_NAME)
    return {"workspace": os.path.basename(str(work_dir))}


@router.get("/workspace")
def describe_workspace(workspace: str, current_user: str = Depends(require_auth), db: Session = Depends(get_db)):
    """작업 폴더에 남아 있는 대상 폴더별 파일 수와 크기(화면을 다시 열 때 맞춰 보기용)."""
    base = _workspace_dir(workspace, current_user, db)
    targets = {}
    for entry in sorted(os.listdir(base)):
        top = os.path.join(base, entry)
        if not os.path.isdir(top):
            continue
        count = 0
        total = 0
        for root, _dirs, files in os.walk(top):
            for f in files:
                count += 1
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
        targets[entry] = {"fileCount": count, "totalBytes": total}
    return {"workspace": os.path.basename(base), "targets": targets}


@router.post("/folder-upload")
async def upload_folder_batch(
        workspace: str = Form(...),
        target: str = Form(...),
        reset: bool = Form(False),
        paths: List[str] = Form(...),
        files: List[UploadFile] = File(...),
        current_user: str = Depends(require_auth),
        db: Session = Depends(get_db),
):
    """고른 폴더의 파일 묶음 하나를 올린다. 화면은 폴더를 여러 묶음으로 나눠 차례로 부른다.

    paths[i] = files[i] 의 '고른 폴더 안' 상대 경로(맨 앞 폴더 이름 제외).
    reset = 첫 묶음이면 참 → 그 대상 폴더를 비우고 시작한다(같은 칸에서 다시 고른 경우).
    """
    base = _workspace_dir(workspace, current_user, db)
    tname = _check_target(target)
    if len(paths) != len(files):
        raise HTTPException(status_code=400, detail="파일과 경로 수가 맞지 않습니다.")

    target_dir = os.path.join(base, tname)
    # 쓰기 전에 모든 경로를 먼저 검사한다(중간에 실패해 반쯤 올라간 묶음을 남기지 않게).
    plan = []
    too_long = []
    for rel, up in zip(paths, files):
        dest = os.path.abspath(os.path.join(target_dir, *_safe_rel_parts(rel)))
        if os.path.commonpath([os.path.normcase(target_dir), os.path.normcase(dest)]) != os.path.normcase(os.path.abspath(target_dir)):
            raise HTTPException(status_code=400, detail=f"쓸 수 없는 파일 경로입니다: {rel}")
        if len(dest) > MAX_UPLOAD_PATH_CHARS:
            too_long.append(rel)
        plan.append((dest, up))
    if too_long:
        shown = ", ".join(too_long[:3]) + (f" 외 {len(too_long) - 3}개" if len(too_long) > 3 else "")
        raise HTTPException(
            status_code=400,
            detail=f"서버 저장 경로가 너무 깁니다({MAX_UPLOAD_PATH_CHARS}자 초과). 폴더나 파일 이름을 줄여 주세요: {shown}",
        )

    if reset and os.path.isdir(target_dir):
        shutil.rmtree(target_dir)
    written = 0
    drm_files = []
    for dest, up in plan:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        head = b""
        try:
            with open(dest, "wb") as out:
                while True:
                    chunk = await up.read(_CHUNK)
                    if not chunk:
                        break
                    if len(head) < len(_DRM_MAGIC):
                        head += chunk[: len(_DRM_MAGIC)]
                    out.write(chunk)
                    written += len(chunk)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"파일 저장 오류: {os.path.basename(dest)} ({exc.strerror or exc})") from exc
        if head.startswith(_DRM_MAGIC):
            drm_files.append(os.path.relpath(dest, target_dir).replace(os.sep, "/"))
    return {"saved": len(plan), "bytes": written, "drmFiles": drm_files}


@router.post("/folder-remove")
def remove_folder(
        workspace: str = Form(...),
        target: str = Form(...),
        current_user: str = Depends(require_auth),
        db: Session = Depends(get_db),
):
    """대상 폴더를 지운다(화면에서 폴더 지우기, Line 삭제). 없으면 그냥 성공."""
    try:
        base = _workspace_dir(workspace, current_user, db)
    except HTTPException as exc:
        if exc.status_code == 404:
            return {"removed": False}
        raise
    target_dir = os.path.join(base, _check_target(target))
    if os.path.isdir(target_dir):
        shutil.rmtree(target_dir)
        return {"removed": True}
    return {"removed": False}


@router.put("/input")
def save_input(
        workspace: str = Body(...),
        input: Dict[str, Any] = Body(...),
        current_user: str = Depends(require_auth),
        db: Session = Depends(get_db),
):
    """화면 입력값 전체를 작업 폴더의 psa_input.json 으로 저장한다(덮어쓰기)."""
    base = _workspace_dir(workspace, current_user, db)
    if not isinstance(input.get("lines"), list):
        raise HTTPException(status_code=400, detail="PSA 입력이 아닙니다(Line 목록이 없음).")
    text = json.dumps(input, ensure_ascii=False, indent=2)
    if len(text.encode("utf-8")) > _INPUT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="입력값이 너무 큽니다(2MB 초과).")
    dest = os.path.join(base, INPUT_FILE_NAME)
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, dest)  # 쓰다 끊겨도 이전 파일이 남게
    return {"saved": True, "file": INPUT_FILE_NAME}


@router.get("/input")
def load_input(workspace: str, current_user: str = Depends(require_auth), db: Session = Depends(get_db)):
    """저장된 psa_input.json 을 돌려준다. 없으면 404."""
    base = _workspace_dir(workspace, current_user, db)
    path = os.path.join(base, INPUT_FILE_NAME)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="저장된 입력이 없습니다.")
    with open(path, "rb") as f:
        raw = f.read()
    if raw.startswith(_DRM_MAGIC):
        raise HTTPException(status_code=500, detail="저장된 입력 파일이 회사 DRM 으로 암호화되어 읽을 수 없습니다.")
    return json.loads(raw.decode("utf-8"))


@router.get("/checklist")
def checklist(workspace: str, current_user: str = Depends(require_auth), db: Session = Depends(get_db)):
    """작업 폴더의 Line 폴더마다 보고서에 필요한 파일 후보를 찾아 돌려준다(Figures, Others 제외)."""
    from ..services.psa_report_files import scan_target
    base = _workspace_dir(workspace, current_user, db)
    targets = {}
    for entry in sorted(os.listdir(base)):
        top = os.path.join(base, entry)
        if not os.path.isdir(top) or entry.lower() in ("figures", "others"):
            continue
        targets[entry] = scan_target(top)
    return {"workspace": os.path.basename(base), "targets": targets}


@router.get("/figures")
def figure_status(
        workspace: str,
        current_user: str = Depends(require_auth),
        db: Session = Depends(get_db),
):
    """보고서에 들어가는 그림 자리와, 올린 그림 폴더(Figures)에서 이름으로 찾은 파일.

    자리는 저장된 입력(psa_input.json)의 Line 과 해석 모델 수로 정한다. 입력이 아직 없으면 고정 그림 자리만.
    """
    from ..services.psa_report_docx import figure_slots, scan_figures

    base = _workspace_dir(workspace, current_user, db)
    data: dict = {}
    path = os.path.join(base, INPUT_FILE_NAME)
    if os.path.isfile(path):
        with open(path, "rb") as f:
            raw = f.read()
        if not raw.startswith(_DRM_MAGIC):
            try:
                data = json.loads(raw.decode("utf-8"))
            except ValueError:
                data = {}
    matched, unmatched = scan_figures(base, data)
    return {"slots": [{**s, "file": matched.get(s["slot"], "")} for s in figure_slots(data)], "unmatched": unmatched}


def _load_report_input(base: str) -> dict:
    path = os.path.join(base, INPUT_FILE_NAME)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="저장된 입력이 없습니다. 화면에서 값을 고치면 자동 저장됩니다.")
    with open(path, "rb") as f:
        raw = f.read()
    if raw.startswith(_DRM_MAGIC):
        raise HTTPException(status_code=500, detail="저장된 입력 파일이 회사 DRM 으로 암호화되어 읽을 수 없습니다.")
    data = json.loads(raw.decode("utf-8"))
    if not data.get("lines"):
        raise HTTPException(status_code=400, detail="Piping line 이 없습니다.")
    return data


def _pending_set(pending: List[Dict[str, Any]] | None) -> set:
    """화면이 보낸 '아직 고르지 않은 파일 칸' → {(lineNo, kind, model)}."""
    out = set()
    for p in pending or []:
        try:
            out.add((str(p.get("lineNo") or ""), str(p.get("kind") or ""), int(p.get("model") or 0)))
        except (TypeError, ValueError, AttributeError):
            continue
    return out


def _report_filename(data: dict, review: bool) -> str:
    from ..services.psa_report_docx import hull_of
    # 파일 이름의 호선: 보고서 정보의 호선 표기(예 3441s) → 없으면 최상위 폴더 이름의 네 자리
    label = re.sub(r"[^A-Za-z0-9\-]", "", str((data.get("docInfo") or {}).get("hullLabel") or "")) or hull_of(data)
    return (f"H{label}_Pipe Stress Analysis" if label else "Pipe Stress Analysis") + ("_검토용" if review else "") + ".docx"


@router.post("/review")
def report_review(
        workspace: str = Body(..., embed=True),
        pending: List[Dict[str, Any]] = Body(default_factory=list, embed=True),
        current_user: str = Depends(require_auth),
        db: Session = Depends(get_db),
):
    """지금 입력으로 보고서를 메모리에서 만들어 '채운 자리 기록'만 돌려준다(화면 '검토 결과' 창).

    보고서와 같은 생성기라 창의 내용 = 실제 보고서 내용. 파일은 쓰지도 내려주지도 않는다.
    pending = 아직 고르지 않은 파일 칸(막지 않고 '자료 없음'에 이유를 적는다).
    """
    from datetime import datetime
    from ..services.psa_report_docx import build_report, load_figures, make_resolver

    base = _workspace_dir(workspace, current_user, db)
    data = _load_report_input(base)
    summary: dict = {}
    try:
        _, warnings = build_report(data, make_resolver(base), figures=load_figures(base, data), summary=summary,
                                   update_fields=False, pending=_pending_set(pending))
    except Exception as e:  # noqa: BLE001 — 실패 사유를 화면에 그대로
        raise HTTPException(status_code=500, detail=f"검토 결과를 만들지 못했습니다: {e}")
    return {"generated": datetime.now().strftime("%Y-%m-%d %H:%M"), "filename": _report_filename(data, False),
            "filled": summary.get("filled", 0), "missing": summary.get("missing", []), "items": summary.get("items", []),
            "templateFixed": summary.get("templateFixed", []), "kinds": summary.get("kinds", {}), "warnings": warnings}


@router.post("/report")
def generate_report(
        workspace: str = Body(..., embed=True),
        review: bool = Body(False, embed=True),
        pending: List[Dict[str, Any]] = Body(default_factory=list, embed=True),
        current_user: str = Depends(require_auth),
        db: Session = Depends(get_db),
):
    """작업 폴더의 psa_input.json + 고른 결과 파일로 보고서(docx)를 만들어 바로 내려준다.

    서식 = 사내 R2 보고서를 손질한 견본(app/templates/psa_report/report_template.bin).
    review=true 면 '검토용': 채운 자리에 색과 출처를 표시하고 맨 끝에 점검표를 붙인다.
    pending 은 검토용에서만 쓴다(아직 고르지 않은 파일 칸의 이유 표시). 최종본은 화면이 '고르기'를 막는다.
    디스크에 쓰지 않는다(회사 DRM 이 로컬에 쓴 docx 를 감싸므로 메모리 바이트로 응답).
    """
    import io
    from urllib.parse import quote
    from fastapi.responses import StreamingResponse
    from ..services.psa_report_docx import build_report, load_figures, make_resolver
    from ..services.analysis_runner import record_analysis

    base = _workspace_dir(workspace, current_user, db)
    data = _load_report_input(base)

    try:
        summary: dict = {}
        docx, warnings = build_report(data, make_resolver(base), review=review, figures=load_figures(base, data),
                                      meta={"workspace": os.path.basename(base)}, summary=summary,
                                      pending=_pending_set(pending) if review else None)
    except Exception as e:  # noqa: BLE001 — 실패 사유를 화면에 그대로
        record_analysis(project_name=str(data.get("sourceFolder") or os.path.basename(base)), program_name=PROGRAM_NAME,
                        employee_id=current_user, status="Failed", input_info={"workspace": os.path.basename(base)},
                        result_info={"error": str(e)}, source="WorkBench")
        raise HTTPException(status_code=500, detail=f"보고서를 만들지 못했습니다: {e}")

    record_analysis(
        project_name=str(data.get("sourceFolder") or os.path.basename(base)), program_name=PROGRAM_NAME,
        employee_id=current_user, status="Success",
        input_info={"workspace": os.path.basename(base), "lines": [l.get("lineNo") for l in data.get("lines", [])],
                    "reportExclusions": data.get("reportExclusions") or [], "review": review},
        result_info={"workspace": os.path.basename(base), "warnings": warnings,
                     "filled": summary.get("filled", 0), "missing": summary.get("missing", [])}, source="WorkBench",
    )
    fname = _report_filename(data, review)
    return StreamingResponse(
        io.BytesIO(docx),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}",
            "X-Report-Warnings": quote(json.dumps(warnings, ensure_ascii=False)),
            "X-Report-Missing": str(len(summary.get("missing", []))),
            "Access-Control-Expose-Headers": "Content-Disposition, X-Report-Warnings, X-Report-Missing",
        },
    )
