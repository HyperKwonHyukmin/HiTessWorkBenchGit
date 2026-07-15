"""공지사항, App별 공지·게시판, 사용자 가이드 CRUD API 라우터."""

from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import or_
from sqlalchemy.orm import Query, Session

from .. import database, models, schemas
from ..dependencies import require_admin, require_auth
from ..services.activity_service import log_activity
from ..sessions import session_store
from ._crud_helpers import create_record, delete_record, get_or_404, update_record

router = APIRouter(prefix="/api", tags=["support"])


def _is_admin_employee(employee_id: str, db: Session) -> bool:
  user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
  return bool(user and user.is_admin)


def _is_admin_request(authorization: str | None, db: Session) -> bool:
  if not authorization or not authorization.startswith("Bearer "):
    return False
  employee_id = session_store.get_employee_id(authorization.removeprefix("Bearer ").strip())
  return bool(employee_id and _is_admin_employee(employee_id, db))


def _get_app_space(app_key: str, db: Session) -> models.AppSpace:
  app_space = (
      db.query(models.AppSpace)
      .filter(
          models.AppSpace.app_key == app_key,
          models.AppSpace.is_active == True,  # noqa: E712
      )
      .first()
  )
  if not app_space:
    raise HTTPException(status_code=404, detail="등록되지 않은 App입니다.")
  return app_space


def _notice_payload(
    notice: schemas.NoticeCreate,
    employee_id: str,
    db: Session,
) -> dict:
  payload = notice.model_dump()
  user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
  payload["author_id"] = employee_id
  payload["author_name"] = user.name if user else employee_id
  if payload.get("app_key"):
    app_space = _get_app_space(payload["app_key"], db)
    if not app_space.notice_enabled:
      raise HTTPException(status_code=404, detail="이 App의 공지 기능이 비활성화되어 있습니다.")
  return payload


def _request_payload(
    request_data: schemas.FeatureRequestCreate,
    employee_id: str,
    db: Session,
) -> dict:
  payload = request_data.model_dump()
  user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
  payload["author_id"] = employee_id
  payload["author_name"] = user.name if user else employee_id
  if payload.get("app_key"):
    app_space = _get_app_space(payload["app_key"], db)
    if not app_space.board_enabled:
      raise HTTPException(status_code=404, detail="이 App의 요청 게시판이 비활성화되어 있습니다.")
  return payload


def _hydrate_notice_authors(notices: list[models.Notice], db: Session) -> list[models.Notice]:
  missing_author_ids = {
      notice.author_id for notice in notices
      if notice.author_id and not notice.author_name
  }
  if not missing_author_ids:
    return notices
  users = db.query(models.User).filter(models.User.employee_id.in_(missing_author_ids)).all()
  name_by_id = {user.employee_id: user.name for user in users}
  for notice in notices:
    if notice.author_id and not notice.author_name:
      notice.author_name = name_by_id.get(notice.author_id)
  return notices


def _filter_published_notices(query: Query) -> Query:
  now = datetime.now()
  return query.filter(
      models.Notice.is_private == False,  # noqa: E712
      models.Notice.publish_status == "published",
      or_(models.Notice.starts_at.is_(None), models.Notice.starts_at <= now),
      or_(models.Notice.ends_at.is_(None), models.Notice.ends_at >= now),
  )


_NOTICE_NOT_FOUND = "공지사항을 찾을 수 없습니다."


@router.get("/notices", response_model=list[schemas.NoticeResponse])
def get_notices(
  db: Session = Depends(database.get_db),
  authorization: str | None = Header(default=None),
):
  query = db.query(models.Notice).filter(models.Notice.app_key.is_(None))
  if not _is_admin_request(authorization, db):
    query = _filter_published_notices(query)
  notices = query.order_by(models.Notice.is_pinned.desc(), models.Notice.created_at.desc()).all()
  return _hydrate_notice_authors(notices, db)


@router.get("/apps/{app_key}/community", response_model=schemas.AppSpaceResponse)
def get_app_community(
    app_key: str,
    db: Session = Depends(database.get_db),
    _: str = Depends(require_auth),
):
  return _get_app_space(app_key, db)


@router.get("/apps/{app_key}/notices", response_model=list[schemas.NoticeResponse])
def get_app_notices(
    app_key: str,
    include_global: bool = False,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
  app_space = _get_app_space(app_key, db)
  if not app_space.notice_enabled:
    return []

  query = db.query(models.Notice)
  if include_global:
    query = query.filter(
        or_(models.Notice.app_key == app_key, models.Notice.app_key.is_(None))
    )
  else:
    query = query.filter(models.Notice.app_key == app_key)
  if not _is_admin_employee(current_user, db):
    query = _filter_published_notices(query)
  notices = query.order_by(models.Notice.is_pinned.desc(), models.Notice.created_at.desc()).all()
  return _hydrate_notice_authors(notices, db)


@router.get("/apps/{app_key}/entry-notices", response_model=list[schemas.NoticeResponse])
def get_entry_notices(
    app_key: str,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
  app_space = _get_app_space(app_key, db)
  if not app_space.notice_enabled:
    return []

  acknowledged = db.query(models.AppNoticeRead.id).filter(
      models.AppNoticeRead.notice_id == models.Notice.id,
      models.AppNoticeRead.employee_id == current_user,
      models.AppNoticeRead.notice_revision == models.Notice.revision,
  ).exists()
  query = db.query(models.Notice).filter(
      models.Notice.app_key == app_key,
      models.Notice.show_on_entry == True,  # noqa: E712
      ~acknowledged,
  )
  query = _filter_published_notices(query)
  notices = query.order_by(models.Notice.is_pinned.desc(), models.Notice.created_at.asc()).all()
  return _hydrate_notice_authors(notices, db)


@router.post("/apps/{app_key}/notices/{notice_id}/acknowledge")
def acknowledge_entry_notice(
    app_key: str,
    notice_id: int,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
  _get_app_space(app_key, db)
  notice = (
      db.query(models.Notice)
      .filter(
          models.Notice.id == notice_id,
          models.Notice.app_key == app_key,
          models.Notice.show_on_entry == True,  # noqa: E712
      )
      .first()
  )
  if not notice:
    raise HTTPException(status_code=404, detail=_NOTICE_NOT_FOUND)

  existing = db.query(models.AppNoticeRead).filter(
      models.AppNoticeRead.notice_id == notice.id,
      models.AppNoticeRead.employee_id == current_user,
      models.AppNoticeRead.notice_revision == notice.revision,
  ).first()
  if not existing:
    db.add(models.AppNoticeRead(
        notice_id=notice.id,
        employee_id=current_user,
        notice_revision=notice.revision,
    ))
    db.commit()
  return {"message": "Acknowledged"}


@router.post("/notices", response_model=schemas.NoticeResponse)
def create_notice(
    notice: schemas.NoticeCreate,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
  created = create_record(db, models.Notice(**_notice_payload(notice, current_admin, db)))
  log_activity(
      db,
      "NOTICE_EDIT",
      employee_id=current_admin,
      action_detail={"operation": "create", "notice_id": created.id, "title": created.title},
      status="success",
      ip_address=request.client.host if request.client else None,
  )
  return created


@router.put("/notices/{notice_id}", response_model=schemas.NoticeResponse)
def update_notice(
    notice_id: int,
    notice: schemas.NoticeCreate,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
  db_notice = get_or_404(db, models.Notice, notice_id, _NOTICE_NOT_FOUND)
  payload = _notice_payload(notice, current_admin, db)
  # 공지 내용이 수정되면 revision을 올려, 이전에 "앞으로 보지 않기"로 확인 처리한
  # 사용자에게도 진입 공지가 다시 노출되도록 한다(AppNoticeRead가 revision 단위 매칭).
  payload["revision"] = (db_notice.revision or 1) + 1
  updated = update_record(db, db_notice, payload)
  log_activity(
      db,
      "NOTICE_EDIT",
      employee_id=current_admin,
      action_detail={"operation": "update", "notice_id": notice_id, "title": updated.title},
      status="success",
      ip_address=request.client.host if request.client else None,
  )
  return updated


@router.delete("/notices/{notice_id}")
def delete_notice(
    notice_id: int,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
  db_notice = get_or_404(db, models.Notice, notice_id, _NOTICE_NOT_FOUND)
  title = db_notice.title
  result = delete_record(db, db_notice)
  log_activity(
      db,
      "NOTICE_EDIT",
      employee_id=current_admin,
      action_detail={"operation": "delete", "notice_id": notice_id, "title": title},
      status="success",
      ip_address=request.client.host if request.client else None,
  )
  return result


_FEATURE_NOT_FOUND = "기능 요청을 찾을 수 없습니다."


@router.get("/feature-requests", response_model=list[schemas.FeatureRequestResponse])
def get_feature_requests(db: Session = Depends(database.get_db)):
  return (
      db.query(models.FeatureRequest)
      .filter(models.FeatureRequest.app_key.is_(None))
      .order_by(models.FeatureRequest.upvotes.desc(), models.FeatureRequest.created_at.desc())
      .all()
  )


@router.get("/apps/{app_key}/feature-requests", response_model=list[schemas.FeatureRequestResponse])
def get_app_feature_requests(
    app_key: str,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
  app_space = _get_app_space(app_key, db)
  if not app_space.board_enabled:
    return []
  requests = (
      db.query(models.FeatureRequest)
      .filter(models.FeatureRequest.app_key == app_key)
      .order_by(models.FeatureRequest.upvotes.desc(), models.FeatureRequest.created_at.desc())
      .all()
  )
  if requests:
    my_upvoted = {
        row.request_id
        for row in db.query(models.FeatureRequestUpvote.request_id).filter(
            models.FeatureRequestUpvote.employee_id == current_user,
            models.FeatureRequestUpvote.request_id.in_([req.id for req in requests]),
        )
    }
    for req in requests:
      req.upvoted_by_me = req.id in my_upvoted
  return requests


@router.post("/feature-requests", response_model=schemas.FeatureRequestResponse)
def create_feature_request(
    req: schemas.FeatureRequestCreate,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
  return create_record(db, models.FeatureRequest(**_request_payload(req, current_user, db)))


@router.put("/feature-requests/{req_id}", response_model=schemas.FeatureRequestResponse)
def update_feature_request(
    req_id: int,
    payload: schemas.FeatureRequestUpdate,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
  req = get_or_404(db, models.FeatureRequest, req_id, _FEATURE_NOT_FOUND)
  # 작성자 본인 또는 관리자만 수정할 수 있다.
  if req.author_id != current_user and not _is_admin_employee(current_user, db):
    raise HTTPException(status_code=403, detail="본인이 작성한 게시글만 수정할 수 있습니다.")
  req.title = payload.title
  req.content = payload.content
  db.commit()
  db.refresh(req)
  return req


@router.put("/feature-requests/{req_id}/upvote")
def upvote_feature_request(
    req_id: int,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
  req = get_or_404(db, models.FeatureRequest, req_id, _FEATURE_NOT_FOUND)
  existing = (
      db.query(models.FeatureRequestUpvote)
      .filter(
          models.FeatureRequestUpvote.request_id == req_id,
          models.FeatureRequestUpvote.employee_id == current_user,
      )
      .first()
  )
  # 이미 추천한 사용자는 카운트를 다시 올리지 않고 멱등하게 현재 값을 반환한다.
  if not existing:
    db.add(models.FeatureRequestUpvote(request_id=req_id, employee_id=current_user))
    req.upvotes += 1
    db.commit()
    db.refresh(req)
  return {"upvotes": req.upvotes, "upvoted": True}


@router.put("/feature-requests/{req_id}/comment")
def comment_feature_request(
    req_id: int,
    comment_data: schemas.FeatureRequestComment,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
  req = get_or_404(db, models.FeatureRequest, req_id, _FEATURE_NOT_FOUND)
  req.status = comment_data.status
  req.admin_comment = comment_data.admin_comment
  req.comments_count = 1 if comment_data.admin_comment else 0
  db.commit()
  db.refresh(req)
  log_activity(
      db,
      "REQUEST_STATUS_CHANGE",
      employee_id=current_admin,
      action_detail={
          "request_id": req_id,
          "status": req.status,
          "has_admin_comment": bool(req.admin_comment),
      },
      status="success",
      ip_address=request.client.host if request.client else None,
  )
  return req


@router.delete("/feature-requests/{req_id}")
def delete_feature_request(
    req_id: int,
    request: Request,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
  req = get_or_404(db, models.FeatureRequest, req_id, _FEATURE_NOT_FOUND)
  # 작성자 본인 또는 관리자만 삭제할 수 있다.
  if req.author_id != current_user and not _is_admin_employee(current_user, db):
    raise HTTPException(status_code=403, detail="본인이 작성한 게시글만 삭제할 수 있습니다.")
  title = req.title
  result = delete_record(db, req)
  log_activity(
      db,
      "REQUEST_STATUS_CHANGE",
      employee_id=current_user,
      action_detail={"operation": "delete", "request_id": req_id, "title": title},
      status="success",
      ip_address=request.client.host if request.client else None,
  )
  return result


_GUIDE_NOT_FOUND = "사용자 가이드를 찾을 수 없습니다."


@router.get("/user-guides", response_model=list[schemas.UserGuideResponse])
def get_user_guides(db: Session = Depends(database.get_db)):
  return db.query(models.UserGuide).order_by(
      models.UserGuide.category,
      models.UserGuide.created_at,
  ).all()


@router.post("/user-guides", response_model=schemas.UserGuideResponse)
def create_user_guide(
    guide: schemas.UserGuideCreate,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
  created = create_record(db, models.UserGuide(**guide.model_dump()))
  log_activity(
      db,
      "GUIDE_EDIT",
      employee_id=current_admin,
      action_detail={"operation": "create", "guide_id": created.id, "title": created.title},
      status="success",
      ip_address=request.client.host if request.client else None,
  )
  return created


@router.put("/user-guides/{guide_id}")
def update_user_guide(
    guide_id: int,
    guide: schemas.UserGuideCreate,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
  db_guide = get_or_404(db, models.UserGuide, guide_id, _GUIDE_NOT_FOUND)
  updated = update_record(db, db_guide, guide.model_dump())
  log_activity(
      db,
      "GUIDE_EDIT",
      employee_id=current_admin,
      action_detail={"operation": "update", "guide_id": guide_id, "title": updated.title},
      status="success",
      ip_address=request.client.host if request.client else None,
  )
  return updated


@router.delete("/user-guides/{guide_id}")
def delete_user_guide(
    guide_id: int,
    request: Request,
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
  db_guide = get_or_404(db, models.UserGuide, guide_id, _GUIDE_NOT_FOUND)
  title = db_guide.title
  result = delete_record(db, db_guide)
  log_activity(
      db,
      "GUIDE_EDIT",
      employee_id=current_admin,
      action_detail={"operation": "delete", "guide_id": guide_id, "title": title},
      status="success",
      ip_address=request.client.host if request.client else None,
  )
  return result
