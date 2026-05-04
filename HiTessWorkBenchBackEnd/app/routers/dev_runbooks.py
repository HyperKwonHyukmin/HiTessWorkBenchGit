"""개발자 전용 런북(DevRunbook) CRUD API.

ADMINISTRATION → Developer Runbooks 페이지에서 사용.
모든 엔드포인트는 관리자 권한(`require_admin`)이 필요하다.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import database, models, schemas
from ..dependencies import require_admin

router = APIRouter(prefix="/api/dev-runbooks", tags=["dev-runbooks"])


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
    runbook = models.DevRunbook(**payload.dict())
    db.add(runbook)
    db.commit()
    db.refresh(runbook)
    return runbook


@router.put("/{runbook_id}", response_model=schemas.DevRunbookResponse)
def update_runbook(
    runbook_id: int,
    payload: schemas.DevRunbookCreate,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    runbook = db.query(models.DevRunbook).filter(models.DevRunbook.id == runbook_id).first()
    if not runbook:
        raise HTTPException(status_code=404, detail="Runbook 을 찾을 수 없습니다.")
    for key, value in payload.dict().items():
        setattr(runbook, key, value)
    db.commit()
    db.refresh(runbook)
    return runbook


@router.delete("/{runbook_id}")
def delete_runbook(
    runbook_id: int,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    runbook = db.query(models.DevRunbook).filter(models.DevRunbook.id == runbook_id).first()
    if not runbook:
        raise HTTPException(status_code=404, detail="Runbook 을 찾을 수 없습니다.")
    db.delete(runbook)
    db.commit()
    return {"message": "Deleted"}
