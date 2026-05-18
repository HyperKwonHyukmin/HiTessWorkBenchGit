"""개발자 전용 런북(DevRunbook) CRUD API.

ADMINISTRATION → Developer Runbooks 페이지에서 사용.
모든 엔드포인트는 관리자 권한(`require_admin`)이 필요하다.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import database, models, schemas
from ..dependencies import require_admin
from ._crud_helpers import create_record, delete_record, get_or_404, update_record

router = APIRouter(prefix="/api/dev-runbooks", tags=["dev-runbooks"])

_RUNBOOK_NOT_FOUND = "Runbook 을 찾을 수 없습니다."


@router.get("", response_model=list[schemas.DevRunbookResponse])
def list_runbooks(
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    return (
        db.query(models.DevRunbook)
        .order_by(models.DevRunbook.category, models.DevRunbook.title)
        .all()
    )


@router.post("", response_model=schemas.DevRunbookResponse)
def create_runbook(
    payload: schemas.DevRunbookCreate,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    return create_record(db, models.DevRunbook(**payload.model_dump()))


@router.put("/{runbook_id}", response_model=schemas.DevRunbookResponse)
def update_runbook(
    runbook_id: int,
    payload: schemas.DevRunbookCreate,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    runbook = get_or_404(db, models.DevRunbook, runbook_id, _RUNBOOK_NOT_FOUND)
    return update_record(db, runbook, payload.model_dump())


@router.delete("/{runbook_id}")
def delete_runbook(
    runbook_id: int,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    runbook = get_or_404(db, models.DevRunbook, runbook_id, _RUNBOOK_NOT_FOUND)
    return delete_record(db, runbook)
