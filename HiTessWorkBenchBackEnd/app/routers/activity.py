"""사용자 활동 로그 조회 및 버전 업데이트 이벤트 API."""
import csv
import io
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from .. import database
from ..dependencies import require_admin, require_auth
from ..services.activity_service import build_activity_query, log_activity
from ..sessions import session_store

router = APIRouter(prefix="/api/activity", tags=["activity"])
MAX_LOG_LOOKBACK_DAYS = 30


class VersionUpdateRequest(BaseModel):
    employee_id: Optional[str] = None
    old_version: str
    new_version: str


class ActivityLogRequest(BaseModel):
    action_type: str
    action_detail: Optional[dict] = None
    status: Optional[str] = "success"


def _bounded_date_range(date_from: Optional[str], date_to: Optional[str]) -> tuple[str, str]:
    """활동 로그 조회 범위를 최대 30일로 제한합니다."""
    now = datetime.now()
    max_from = now - timedelta(days=MAX_LOG_LOOKBACK_DAYS)

    try:
        dt_to = datetime.fromisoformat(date_to) if date_to else now
    except ValueError:
        dt_to = now
    if dt_to > now:
        dt_to = now
    if dt_to < max_from:
        dt_to = max_from

    try:
        dt_from = datetime.fromisoformat(date_from) if date_from else dt_to - timedelta(days=MAX_LOG_LOOKBACK_DAYS)
    except ValueError:
        dt_from = dt_to - timedelta(days=MAX_LOG_LOOKBACK_DAYS)

    lower_bound = max(max_from, dt_to - timedelta(days=MAX_LOG_LOOKBACK_DAYS))
    if dt_from < lower_bound:
        dt_from = lower_bound
    if dt_from > dt_to:
        dt_from = dt_to

    return dt_from.date().isoformat(), dt_to.date().isoformat()


@router.post("/version-update")
def report_version_update(
    req: VersionUpdateRequest,
    db: Session = Depends(database.get_db),
):
    """클라이언트가 새 버전을 감지했을 때 이벤트를 기록합니다."""
    log_activity(
        db,
        action_type="VERSION_UPDATE",
        employee_id=req.employee_id,
        action_detail={"old_version": req.old_version, "new_version": req.new_version},
    )
    return {"ok": True}


class ClientErrorRequest(BaseModel):
    # window-error | unhandled-rejection | render-process-gone | child-process-gone | main-exception
    kind: str
    message: Optional[str] = None
    source: Optional[str] = None
    stack: Optional[str] = None
    page: Optional[str] = None
    app_version: Optional[str] = None
    # Electron 이 알려 준 PC 정보·크래시 세부(reason, exitCode, 창 종류 등)
    extra: Optional[dict] = None
    occurred_at: Optional[str] = None


# 같은 IP 에서 1분에 이보다 많이 오면 버린다 — 오류 루프에 빠진 화면이 DB 를 채우지 않게.
CLIENT_ERROR_LIMIT_PER_MINUTE = 20
_client_error_hits: dict[str, deque] = {}
_client_error_lock = threading.Lock()


def _client_error_allowed(key: str) -> bool:
    now = time.monotonic()
    with _client_error_lock:
        hits = _client_error_hits.setdefault(key, deque())
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= CLIENT_ERROR_LIMIT_PER_MINUTE:
            return False
        hits.append(now)
        if len(_client_error_hits) > 1000:
            _client_error_hits.clear()
        return True


def _employee_from_header(authorization: Optional[str]) -> Optional[str]:
    """토큰이 있고 유효하면 사번, 아니면 None. 오류 보고는 로그인 전·세션 만료 뒤에도 받는다."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return session_store.get_employee_id(authorization.removeprefix("Bearer ").strip())


def _clip_text(value: Optional[str], size: int) -> Optional[str]:
    text = (value or "").strip()
    return text[:size] or None


@router.post("/client-error")
def report_client_error(
    payload: ClientErrorRequest,
    req: Request,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(database.get_db),
):
    """화면(React) 오류·Electron 크래시를 CLIENT_ERROR 로 기록합니다(30일 보관).

    로그인 화면에서 난 오류도 받아야 해서 인증을 요구하지 않는다. 유효한 토큰이 있으면 그 사번을,
    없으면 사번 없이 IP 만 남긴다(본문의 사번은 받지 않는다 — 위조 방지).
    """
    ip = req.client.host if req.client else None
    if not _client_error_allowed(ip or "-"):
        return {"ok": False, "reason": "rate_limited"}
    extra = payload.extra if isinstance(payload.extra, dict) else {}
    # extra 는 클라이언트가 채우는 자유 형식이라 키·값 크기를 제한한다.
    safe_extra = {
        str(k)[:40]: (v if isinstance(v, (int, float, bool)) or v is None else str(v)[:300])
        for k, v in list(extra.items())[:20]
    }
    log_activity(
        db,
        action_type="CLIENT_ERROR",
        employee_id=_employee_from_header(authorization),
        action_detail={
            "kind": _clip_text(payload.kind, 40) or "unknown",
            "message": _clip_text(payload.message, 1000),
            "source": _clip_text(payload.source, 300),
            "stack": _clip_text(payload.stack, 4000),
            "page": _clip_text(payload.page, 200),
            "app_version": _clip_text(payload.app_version, 30),
            "occurred_at": _clip_text(payload.occurred_at, 40),
            "extra": safe_extra,
        },
        status="failure",
        ip_address=ip,
    )
    return {"ok": True}


@router.post("/log")
def create_activity_log(
    payload: ActivityLogRequest,
    req: Request,
    db: Session = Depends(database.get_db),
    employee_id: str = Depends(require_auth),
):
    """클라이언트에서 발생한 감사 대상 이벤트를 현재 인증 사용자 기준으로 기록합니다."""
    action_type = (payload.action_type or "").strip().upper()
    if not action_type:
        return {"ok": False}
    log_activity(
        db,
        action_type=action_type[:50],
        employee_id=employee_id,
        action_detail=payload.action_detail,
        status=(payload.status or "success")[:20],
        ip_address=req.client.host if req.client else None,
    )
    return {"ok": True}


@router.get("/logs")
def get_activity_logs(
    employee_id: Optional[str] = Query(None),
    action_type: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(database.get_db),
    _: str = Depends(require_admin),
):
    """관리자용 활동 로그 조회. 날짜·사번·이벤트 유형 필터 지원. 조회 범위는 최대 30일."""
    date_from, date_to = _bounded_date_range(date_from, date_to)
    q = build_activity_query(db, employee_id, action_type, date_from, date_to)
    # 필터 적용된 결과의 총 개수 — outerjoin/order 가 들어가도 count() 결과는 동일.
    total = q.count()
    rows = q.offset(skip).limit(limit).all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "id": r.ActivityLog.id,
                "employee_id": r.ActivityLog.employee_id,
                "name": r.name,
                "action_type": r.ActivityLog.action_type,
                "action_detail": r.ActivityLog.action_detail,
                "status": r.ActivityLog.status,
                "ip_address": r.ActivityLog.ip_address,
                "created_at": r.ActivityLog.created_at.isoformat() if r.ActivityLog.created_at else None,
            }
            for r in rows
        ],
    }


@router.get("/logs/export")
def export_activity_logs_csv(
    employee_id: Optional[str] = Query(None),
    action_type: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(database.get_db),
    _: str = Depends(require_admin),
):
    """활동 로그를 CSV로 내보냅니다. 조회 범위는 최대 30일."""
    date_from, date_to = _bounded_date_range(date_from, date_to)
    rows = build_activity_query(db, employee_id, action_type, date_from, date_to).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "사번", "이름", "이벤트", "상태", "세부정보", "IP", "시간"])
    for r in rows:
        detail_str = str(r.ActivityLog.action_detail) if r.ActivityLog.action_detail else ""
        created = r.ActivityLog.created_at.isoformat() if r.ActivityLog.created_at else ""
        writer.writerow([r.ActivityLog.id, r.ActivityLog.employee_id or "", r.name or "", r.ActivityLog.action_type, r.ActivityLog.status or "", detail_str, r.ActivityLog.ip_address or "", created])

    output.seek(0)
    filename = f"activity_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
