"""공지사항, 기능 요청, 사용자 가이드 CRUD API 라우터."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, schemas, database
from ..dependencies import require_auth, require_admin

router = APIRouter(prefix="/api", tags=["support"])


# ==================== Notice (공지사항) ====================

@router.get("/notices", response_model=list[schemas.NoticeResponse])
def get_notices(db: Session = Depends(database.get_db)):
  return db.query(models.Notice).order_by(models.Notice.is_pinned.desc(), models.Notice.created_at.desc()).all()


@router.post("/notices", response_model=schemas.NoticeResponse)
def create_notice(notice: schemas.NoticeCreate, db: Session = Depends(database.get_db),
                  current_admin: str = Depends(require_admin)):
  new_notice = models.Notice(**notice.dict())
  db.add(new_notice)
  db.commit()
  db.refresh(new_notice)
  return new_notice


@router.put("/notices/{notice_id}", response_model=schemas.NoticeResponse)
def update_notice(notice_id: int, notice: schemas.NoticeCreate, db: Session = Depends(database.get_db),
                  current_admin: str = Depends(require_admin)):
  db_notice = db.query(models.Notice).filter(models.Notice.id == notice_id).first()
  if not db_notice:
    raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")
  for key, value in notice.dict().items():
    setattr(db_notice, key, value)
  db.commit()
  db.refresh(db_notice)
  return db_notice


@router.delete("/notices/{notice_id}")
def delete_notice(notice_id: int, db: Session = Depends(database.get_db),
                  current_admin: str = Depends(require_admin)):
  db_notice = db.query(models.Notice).filter(models.Notice.id == notice_id).first()
  if not db_notice:
    raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")
  db.delete(db_notice)
  db.commit()
  return {"message": "Deleted"}


# ==================== Feature Request (기능 요청) ====================

@router.get("/feature-requests", response_model=list[schemas.FeatureRequestResponse])
def get_feature_requests(db: Session = Depends(database.get_db)):
  return db.query(models.FeatureRequest).order_by(models.FeatureRequest.upvotes.desc(),
                                                  models.FeatureRequest.created_at.desc()).all()


@router.post("/feature-requests", response_model=schemas.FeatureRequestResponse)
def create_feature_request(req: schemas.FeatureRequestCreate, db: Session = Depends(database.get_db),
                            current_user: str = Depends(require_auth)):
  new_req = models.FeatureRequest(**req.dict())
  db.add(new_req)
  db.commit()
  db.refresh(new_req)
  return new_req


@router.put("/feature-requests/{req_id}/upvote")
def upvote_feature_request(req_id: int, db: Session = Depends(database.get_db),
                            current_user: str = Depends(require_auth)):
  req = db.query(models.FeatureRequest).filter(models.FeatureRequest.id == req_id).first()
  if not req:
    raise HTTPException(status_code=404, detail="기능 요청을 찾을 수 없습니다.")
  req.upvotes += 1
  db.commit()
  return {"message": "Upvoted"}


@router.put("/feature-requests/{req_id}/comment")
def comment_feature_request(req_id: int, comment_data: schemas.FeatureRequestComment,
                            db: Session = Depends(database.get_db),
                            current_admin: str = Depends(require_admin)):
  req = db.query(models.FeatureRequest).filter(models.FeatureRequest.id == req_id).first()
  if not req:
    raise HTTPException(status_code=404, detail="기능 요청을 찾을 수 없습니다.")
  req.status = comment_data.status
  req.admin_comment = comment_data.admin_comment
  req.comments_count = (req.comments_count or 0) + 1 if comment_data.admin_comment else (req.comments_count or 0)
  db.commit()
  db.refresh(req)
  return req


@router.delete("/feature-requests/{req_id}")
def delete_feature_request(req_id: int, db: Session = Depends(database.get_db),
                            current_admin: str = Depends(require_admin)):
  req = db.query(models.FeatureRequest).filter(models.FeatureRequest.id == req_id).first()
  if not req:
    raise HTTPException(status_code=404, detail="기능 요청을 찾을 수 없습니다.")
  db.delete(req)
  db.commit()
  return {"message": "Deleted"}


# ==================== User Guide (사용자 가이드) ====================

@router.get("/user-guides", response_model=list[schemas.UserGuideResponse])
def get_user_guides(db: Session = Depends(database.get_db)):
  return db.query(models.UserGuide).order_by(models.UserGuide.category, models.UserGuide.created_at).all()


@router.post("/user-guides", response_model=schemas.UserGuideResponse)
def create_user_guide(guide: schemas.UserGuideCreate, db: Session = Depends(database.get_db),
                      current_admin: str = Depends(require_admin)):
  new_guide = models.UserGuide(**guide.dict())
  db.add(new_guide)
  db.commit()
  db.refresh(new_guide)
  return new_guide


@router.put("/user-guides/{guide_id}")
def update_user_guide(guide_id: int, guide: schemas.UserGuideCreate, db: Session = Depends(database.get_db),
                      current_admin: str = Depends(require_admin)):
  db_guide = db.query(models.UserGuide).filter(models.UserGuide.id == guide_id).first()
  if not db_guide:
    raise HTTPException(status_code=404, detail="사용자 가이드를 찾을 수 없습니다.")
  for key, value in guide.dict().items():
    setattr(db_guide, key, value)
  db.commit()
  db.refresh(db_guide)
  return db_guide


@router.delete("/user-guides/{guide_id}")
def delete_user_guide(guide_id: int, db: Session = Depends(database.get_db),
                      current_admin: str = Depends(require_admin)):
  db_guide = db.query(models.UserGuide).filter(models.UserGuide.id == guide_id).first()
  if not db_guide:
    raise HTTPException(status_code=404, detail="사용자 가이드를 찾을 수 없습니다.")
  db.delete(db_guide)
  db.commit()
  return {"message": "Deleted"}
