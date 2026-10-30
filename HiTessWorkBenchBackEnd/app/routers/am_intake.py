"""Aveva Marine(AM) 연동 전용 API — AM 클라이언트(`HiTessMB.exe`)가 부른다.

접수 → CSV 검사 → 통과하면 Model Builder 빌드(`task_execute_modelflow`)를 띄우고 job_id 를 돌려준다.
AM 호출 1번 = `analysis` 기록 1건(program_name·source `AmToModelBuilder`)이라 사용량 통계에서 이중으로 세지 않는다:
검사를 통과하면 빌드 작업이 그 기록을 남기고, 검사에서 막히면 여기서 Failed 기록을 남긴다
(누가 언제 보냈는지가 남아야 AM 쪽 CSV 문제를 추적할 수 있다).
계획: docs/plans/2026-10-30-am-client-implementation-plan.md
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth
from ..services import am_intake
from ..services.hitess_modelflow_service import task_execute_modelflow
from ..services.hull_no import normalize_hull_no
from ..services.job_manager import JobMetadata
from ._intake import _BACKEND_DIR, _check_upload_path_length, make_work_dir, submit_analysis_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/am", tags=["aveva-marine"])
# 미가입 사번용 가입 페이지(GET /signup). AM 클라이언트가 로그인 404 때 브라우저로 연다.
page_router = APIRouter(tags=["aveva-marine"])
_SIGNUP_HTML = Path(__file__).resolve().parent.parent / "static" / "signup" / "signup.html"

PROGRAM_NAME = "AmToModelBuilder"
SOURCE = "AmToModelBuilder"
WORK_DIR_PROGRAM = "AmToModelBuilder"  # userConnection/<ts>_<사번>_AmToModelBuilder/
# 실모델 CSV 는 수 MB 이하다. 메모리에 올려 sha256 을 계산하므로 상한을 둔다.
MAX_CSV_BYTES = 50 * 1024 * 1024
_EMPLOYEE_ID_RE = re.compile(r"^[A-Z]\d{5,7}$")


async def _read_upload(upload: UploadFile, kind: str) -> bytes:
    name = os.path.basename(upload.filename or "")
    if os.path.splitext(name)[1].lower() != ".csv":
        raise HTTPException(status_code=400, detail=f"{am_intake.KIND_LABELS[kind]} 파일이 CSV 가 아닙니다: {name}")
    data = await upload.read(MAX_CSV_BYTES + 1)
    if len(data) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail=f"{name}: 파일 크기가 제한(50MB)을 넘었습니다.")
    return data


def _parse_client(raw: Optional[str]) -> dict:
    """클라이언트 정보(버전·PC 이름·Windows 계정·원본 경로). 깨진 값은 버리고 접수는 계속한다."""
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {"raw": raw[:500]}
    return value if isinstance(value, dict) else {"raw": str(value)[:500]}


@page_router.get("/signup", response_class=HTMLResponse)
def signup_page() -> HTMLResponse:
    """가입 페이지 한 장. 가입 처리는 페이지가 같은 서버의 POST /api/register 로 한다(관리자 승인 유지)."""
    try:
        html = _SIGNUP_HTML.read_text(encoding="utf-8")
    except OSError:
        logger.exception("가입 페이지를 읽지 못했습니다: %s", _SIGNUP_HTML)
        raise HTTPException(status_code=500, detail="가입 페이지를 읽을 수 없습니다.")
    return HTMLResponse(content=html, headers={"Cache-Control": "no-store"})


@router.post("/submissions")
async def submit_csv(
    employee_id: str = Form(...),
    hull_no: str = Form(...),
    stru_file: Optional[UploadFile] = File(None),
    pipe_file: Optional[UploadFile] = File(None),
    equip_file: Optional[UploadFile] = File(None),
    stru_sha256: Optional[str] = Form(None),
    pipe_sha256: Optional[str] = Form(None),
    equip_sha256: Optional[str] = Form(None),
    client: Optional[str] = Form(None),
    current_user: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """AM 이 보낸 CSV 를 저장하고 검사 결과를 돌려준다.

    요청 자체가 잘못되면(사번 불일치·호선 형식·CSV 없음) 4xx, 받은 CSV 의 내용 문제는 200 + `ok: false` + 파일별 `issues`.
    """
    employee_id = (employee_id or "").strip().upper()
    if not _EMPLOYEE_ID_RE.match(employee_id):
        raise HTTPException(status_code=400, detail="사번 형식이 올바르지 않습니다(예: A123456).")
    if employee_id != current_user:
        raise HTTPException(status_code=403, detail="employee_id 가 로그인한 사번과 일치하지 않습니다.")

    hull = normalize_hull_no(hull_no)
    if not hull:
        raise HTTPException(status_code=400, detail="호선 형식이 올바르지 않습니다(영문·숫자·-·_ 20자 이내).")

    uploads = {"stru": stru_file, "pipe": pipe_file, "equip": equip_file}
    uploads = {k: f for k, f in uploads.items() if f is not None and f.filename}
    if "stru" not in uploads and "pipe" not in uploads:
        raise HTTPException(status_code=400, detail="구조 또는 배관 CSV 중 하나 이상이 필요합니다.")

    client_sha = {"stru": stru_sha256, "pipe": pipe_sha256, "equip": equip_sha256}
    received = {kind: await _read_upload(f, kind) for kind, f in uploads.items()}

    work_dir, timestamp = make_work_dir(employee_id, WORK_DIR_PROGRAM)
    files: list[dict] = []
    input_info: dict = {"hull_no": hull}
    used_names: set[str] = set()
    for kind in am_intake.CSV_KINDS:
        if kind not in received:
            continue
        name = os.path.basename(uploads[kind].filename)
        # 다른 폴더의 같은 이름 CSV(…\stru\a.csv · …\pipe\a.csv)가 서로를 덮어쓰면 틀린 모델이 오류 없이 만들어진다.
        stored = name if name.casefold() not in used_names else f"{kind}_{name}"
        used_names.add(stored.casefold())
        dest = os.path.join(work_dir, stored)
        _check_upload_path_length(dest, stored)
        with open(dest, "wb") as fh:
            fh.write(received[kind])
        report = am_intake.inspect_csv(kind, received[kind], client_sha[kind])
        report["name"] = name
        files.append(report)
        input_info[f"{kind}_csv"] = dest

    ok = all(not f["issues"] for f in files)
    client_info = _parse_client(client)
    submission = {
        "received_at": datetime.now().isoformat(timespec="seconds"),
        "employee_id": employee_id,
        "hull_no": hull,
        "ok": ok,
        "files": files,
        "client": client_info,
    }
    with open(os.path.join(work_dir, "submission.json"), "w", encoding="utf-8") as fh:
        json.dump(submission, fh, ensure_ascii=False, indent=2)
    input_info["client"] = client_info

    job_id = None
    if ok:
        # 빌드 작업이 analysis 기록(Pending → Success/Failed)을 남긴다. 옵션은 WorkBench MB 기본값.
        exe_path = os.path.abspath(os.path.join(
            _BACKEND_DIR, "InHouseProgram", "HiTessModeBuilder", "Cmb.Cli.exe"
        ))
        job_id = submit_analysis_job(
            task_execute_modelflow,
            input_info.get("stru_csv"), input_info.get("pipe_csv"), input_info.get("equip_csv"),
            work_dir, exe_path, employee_id, timestamp, SOURCE,
            500.0, False, False, None, None, None, None, hull, PROGRAM_NAME,
            queue_message="모델 생성 대기 중...",
            metadata=JobMetadata(employee_id=employee_id, program_name=PROGRAM_NAME),
            owned_work_dir=work_dir,
        )
        record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
    else:
        now = datetime.now()
        record = models.Analysis(
            project_name=f"{PROGRAM_NAME}_{timestamp}",
            program_name=PROGRAM_NAME,
            employee_id=employee_id,
            status="Failed",
            job_status="Failed",
            progress=100,
            job_message="CSV 접수 검사 실패",
            input_info=input_info,
            result_info={"submission_json": os.path.join(work_dir, "submission.json"), "ok": False},
            source=SOURCE,
            started_at=now,
            updated_at=now,
            finished_at=now,
        )
        db.add(record)
    db.add(models.ActivityLog(
        employee_id=employee_id,
        action_type="AM_SUBMIT",
        action_detail={"hull_no": hull, "kinds": [f["kind"] for f in files], "ok": ok, "job_id": job_id},
        status="success" if ok else "failure",
    ))
    db.commit()
    submission_id = record.id if record is not None else None

    logger.info("[AM] 접수 #%s %s 호선=%s ok=%s job=%s", submission_id, employee_id, hull, ok, job_id)
    return {
        "submission_id": submission_id,
        "job_id": job_id,
        "received_at": submission["received_at"],
        "hull_no": hull,
        "ok": ok,
        "files": files,
    }
