"""공지사항, 기능 요청, 사용자 가이드 CRUD API 라우터."""
from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session
from .. import models, schemas, database
from ..dependencies import require_auth, require_admin
from ..sessions import session_store
from ._crud_helpers import create_record, delete_record, get_or_404, update_record

router = APIRouter(prefix="/api", tags=["support"])


def _is_admin_request(authorization: str | None, db: Session) -> bool:
  if not authorization or not authorization.startswith("Bearer "):
    return False
  employee_id = session_store.get_employee_id(authorization.removeprefix("Bearer ").strip())
  if not employee_id:
    return False
  user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
  return bool(user and user.is_admin)


def _notice_payload(notice: schemas.NoticeCreate, db: Session) -> dict:
  payload = notice.model_dump()
  if not payload.get("author_name") and payload.get("author_id"):
    user = db.query(models.User).filter(models.User.employee_id == payload["author_id"]).first()
    if user:
      payload["author_name"] = user.name
  return payload


def _hydrate_notice_authors(notices: list[models.Notice], db: Session) -> list[models.Notice]:
  missing_author_ids = {
    notice.author_id for notice in notices
    if notice.author_id and not notice.author_name
  }
  if not missing_author_ids:
    return notices
  users = (
    db.query(models.User)
    .filter(models.User.employee_id.in_(missing_author_ids))
    .all()
  )
  name_by_id = {user.employee_id: user.name for user in users}
  for notice in notices:
    if notice.author_id and not notice.author_name:
      notice.author_name = name_by_id.get(notice.author_id)
  return notices


# ==================== Notice (공지사항) ====================

_NOTICE_NOT_FOUND = "공지사항을 찾을 수 없습니다."


@router.get("/notices", response_model=list[schemas.NoticeResponse])
def get_notices(
  db: Session = Depends(database.get_db),
  authorization: str | None = Header(default=None),
):
  query = db.query(models.Notice)
  if not _is_admin_request(authorization, db):
    query = query.filter(models.Notice.is_private == False)  # noqa: E712
  notices = query.order_by(models.Notice.is_pinned.desc(), models.Notice.created_at.desc()).all()
  return _hydrate_notice_authors(notices, db)


@router.post("/notices", response_model=schemas.NoticeResponse)
def create_notice(notice: schemas.NoticeCreate, db: Session = Depends(database.get_db),
                  current_admin: str = Depends(require_admin)):
  return create_record(db, models.Notice(**_notice_payload(notice, db)))


@router.put("/notices/{notice_id}", response_model=schemas.NoticeResponse)
def update_notice(notice_id: int, notice: schemas.NoticeCreate, db: Session = Depends(database.get_db),
                  current_admin: str = Depends(require_admin)):
  db_notice = get_or_404(db, models.Notice, notice_id, _NOTICE_NOT_FOUND)
  return update_record(db, db_notice, _notice_payload(notice, db))


@router.delete("/notices/{notice_id}")
def delete_notice(notice_id: int, db: Session = Depends(database.get_db),
                  current_admin: str = Depends(require_admin)):
  db_notice = get_or_404(db, models.Notice, notice_id, _NOTICE_NOT_FOUND)
  return delete_record(db, db_notice)


# ==================== Feature Request (기능 요청) ====================

_FEATURE_NOT_FOUND = "기능 요청을 찾을 수 없습니다."


@router.get("/feature-requests", response_model=list[schemas.FeatureRequestResponse])
def get_feature_requests(db: Session = Depends(database.get_db)):
  return db.query(models.FeatureRequest).order_by(models.FeatureRequest.upvotes.desc(),
                                                  models.FeatureRequest.created_at.desc()).all()


@router.post("/feature-requests", response_model=schemas.FeatureRequestResponse)
def create_feature_request(req: schemas.FeatureRequestCreate, db: Session = Depends(database.get_db),
                            current_user: str = Depends(require_auth)):
  return create_record(db, models.FeatureRequest(**req.model_dump()))


@router.put("/feature-requests/{req_id}/upvote")
def upvote_feature_request(req_id: int, db: Session = Depends(database.get_db),
                            current_user: str = Depends(require_auth)):
  req = get_or_404(db, models.FeatureRequest, req_id, _FEATURE_NOT_FOUND)
  req.upvotes += 1
  db.commit()
  return {"message": "Upvoted"}


@router.put("/feature-requests/{req_id}/comment")
def comment_feature_request(req_id: int, comment_data: schemas.FeatureRequestComment,
                            db: Session = Depends(database.get_db),
                            current_admin: str = Depends(require_admin)):
  req = get_or_404(db, models.FeatureRequest, req_id, _FEATURE_NOT_FOUND)
  req.status = comment_data.status
  req.admin_comment = comment_data.admin_comment
  req.comments_count = 1 if comment_data.admin_comment else 0
  db.commit()
  db.refresh(req)
  return req


@router.delete("/feature-requests/{req_id}")
def delete_feature_request(req_id: int, db: Session = Depends(database.get_db),
                            current_admin: str = Depends(require_admin)):
  req = get_or_404(db, models.FeatureRequest, req_id, _FEATURE_NOT_FOUND)
  return delete_record(db, req)


# ==================== User Guide (사용자 가이드) ====================

_GUIDE_NOT_FOUND = "사용자 가이드를 찾을 수 없습니다."


@router.get("/user-guides", response_model=list[schemas.UserGuideResponse])
def get_user_guides(db: Session = Depends(database.get_db)):
  return db.query(models.UserGuide).order_by(models.UserGuide.category, models.UserGuide.created_at).all()


@router.post("/user-guides", response_model=schemas.UserGuideResponse)
def create_user_guide(guide: schemas.UserGuideCreate, db: Session = Depends(database.get_db),
                      current_admin: str = Depends(require_admin)):
  return create_record(db, models.UserGuide(**guide.model_dump()))


@router.put("/user-guides/{guide_id}")
def update_user_guide(guide_id: int, guide: schemas.UserGuideCreate, db: Session = Depends(database.get_db),
                      current_admin: str = Depends(require_admin)):
  db_guide = get_or_404(db, models.UserGuide, guide_id, _GUIDE_NOT_FOUND)
  return update_record(db, db_guide, guide.model_dump())


@router.delete("/user-guides/{guide_id}")
def delete_user_guide(guide_id: int, db: Session = Depends(database.get_db),
                      current_admin: str = Depends(require_admin)):
  db_guide = get_or_404(db, models.UserGuide, guide_id, _GUIDE_NOT_FOUND)
  return delete_record(db, db_guide)
