"""해석 오류·경고 유형 조회(관리자) — services/nastran_diagnostics 가 쌓은 기록을 꺼낸다.

용도: 운영 서버(145)에 쌓인 오류 유형을 개발 PC(70)로 가져와 원인을 고치고, 고친 유형을
'handled' 로 표시한다(재발하면 수집기가 'regressed' 로 되돌린다). 가져오는 도구는
`scripts/pull_diagnostics.py`, 작업 절차는 저장소 `.claude/skills/nastran-triage/SKILL.md`.

플랫폼 공통 기능이라 app_settings.GUARDED_ROUTES 에 등록하지 않는다(관리자 전용).
"""
import io
import os
import zipfile
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_admin
from ..services import nastran_diagnostics

router = APIRouter(prefix="/api/admin/diagnostics", tags=["diagnostics"])

STATUSES = {"new", "handled", "ignored", "regressed"}


def _signature_dict(sig: models.DiagnosticSignature) -> dict:
    return {
        "fingerprint": sig.fingerprint,
        "level": sig.level,
        "code": sig.code,
        "template": sig.template,
        "sampleMessage": sig.sample_message,
        "programs": sig.programs or [],
        "occurrenceCount": sig.occurrence_count,
        "firstSeen": sig.first_seen.isoformat() if sig.first_seen else None,
        "lastSeen": sig.last_seen.isoformat() if sig.last_seen else None,
        "status": sig.status,
        "handledNote": sig.handled_note,
        "handledAt": sig.handled_at.isoformat() if sig.handled_at else None,
        "archiveDir": sig.archive_dir,
    }


def _occurrence_dict(occ: models.DiagnosticOccurrence) -> dict:
    return {
        "analysisId": occ.analysis_id,
        "jobId": occ.job_id,
        "programName": occ.program_name,
        "employeeId": occ.employee_id,
        "analysisStatus": occ.analysis_status,
        "sourceFile": occ.source_file,
        "message": occ.message,
        "archived": occ.archived,
        "createdAt": occ.created_at.isoformat() if occ.created_at else None,
    }


def _get(db: Session, fingerprint: str) -> models.DiagnosticSignature:
    sig = db.query(models.DiagnosticSignature).filter_by(fingerprint=fingerprint).first()
    if sig is None:
        raise HTTPException(status_code=404, detail="오류 유형을 찾을 수 없습니다.")
    return sig


@router.get("")
def list_signatures(
    status: Optional[str] = Query(None, description="new,regressed 처럼 쉼표로 여러 개"),
    level: Optional[str] = Query(None, description="fatal,engine,warning"),
    program: Optional[str] = None,
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    """오류 유형 목록 — 최근 발생 순. 미처리(new/regressed)만 보려면 status=new,regressed."""
    q = db.query(models.DiagnosticSignature)
    if status:
        q = q.filter(models.DiagnosticSignature.status.in_([s.strip() for s in status.split(",") if s.strip()]))
    if level:
        q = q.filter(models.DiagnosticSignature.level.in_([s.strip() for s in level.split(",") if s.strip()]))
    rows = q.order_by(models.DiagnosticSignature.last_seen.desc()).limit(limit).all()
    if program:
        rows = [r for r in rows if program in (r.programs or [])]  # JSON 컬럼 — DB 방언 무관하게 파이썬에서 거른다
    return {"items": [_signature_dict(r) for r in rows], "count": len(rows)}


@router.get("/{fingerprint}")
def get_signature(
    fingerprint: str,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    sig = _get(db, fingerprint)
    occ = (
        db.query(models.DiagnosticOccurrence)
        .filter(models.DiagnosticOccurrence.signature_id == sig.id)
        .order_by(models.DiagnosticOccurrence.created_at.desc())
        .limit(limit)
        .all()
    )
    return {**_signature_dict(sig), "occurrences": [_occurrence_dict(o) for o in occ]}


@router.get("/{fingerprint}/archive")
def download_archive(
    fingerprint: str,
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    """재현 자료 묶음(zip). 메모리에서 만들고 파일은 read() 로 읽는다(회사 DRM Content-Length 함정 회피)."""
    sig = _get(db, fingerprint)
    if not sig.archive_dir:
        raise HTTPException(status_code=404, detail="이 유형은 보관한 재현 자료가 없습니다(경고 등급이거나 보관 전).")
    root = nastran_diagnostics.ARCHIVE_ROOT  # 호출 시점 값(환경변수 DIAGNOSTICS_ARCHIVE_DIR 반영)
    case_dir = os.path.abspath(os.path.join(root, sig.archive_dir))
    if os.path.commonpath([root, case_dir]) != root or not os.path.isdir(case_dir):
        raise HTTPException(status_code=404, detail="재현 자료 폴더가 없습니다.")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(os.listdir(case_dir)):
            path = os.path.join(case_dir, name)
            if os.path.isfile(path):
                with open(path, "rb") as f:
                    zf.writestr(name, f.read())
    body = buf.getvalue()
    return Response(
        content=body,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="diagnostic_{fingerprint}.zip"'},
    )


class SignatureUpdate(BaseModel):
    status: str
    note: Optional[str] = None


@router.patch("/{fingerprint}")
def update_signature(
    fingerprint: str,
    payload: SignatureUpdate,
    db: Session = Depends(database.get_db),
    _admin: str = Depends(require_admin),
):
    """대응 결과 기록 — handled(코드로 막음, note 에 규칙·커밋) / ignored / new."""
    if payload.status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"status 는 {sorted(STATUSES)} 중 하나여야 합니다.")
    sig = _get(db, fingerprint)
    sig.status = payload.status
    if payload.note is not None:
        sig.handled_note = payload.note
    sig.handled_at = datetime.now() if payload.status in ("handled", "ignored") else None
    db.commit()
    return _signature_dict(sig)
