"""해석 리포트 생성 API.

생성이 POST 인 이유: App 가용성 게이트(services/app_settings_gate.py)는
POST/PUT/PATCH/DELETE 만 검사한다. GET 으로 두면 관리자가 이 App 을 점검 중으로
내려도 API 는 열린 채 남는다.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth
from ..services.activity_service import log_activity
from ..services.report import ReportNotAvailable, build_report_xlsx, report_capabilities
from ._access_control import assert_current_user_can_access_owner

router = APIRouter(prefix="/api/reports", tags=["reports"])

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ReportRequest(BaseModel):
    analysis_id: int = Field(..., description="리포트를 만들 해석 이력 id")


@router.get("/capabilities")
def get_capabilities(_employee_id: str = Depends(require_auth)) -> dict:
    """program_id 별 리포트 가능 여부. 카탈로그 표시용 읽기 전용."""
    return report_capabilities()


@router.post("/generate")
def generate_report(
    body: ReportRequest,
    req: Request,
    db: Session = Depends(database.get_db),
    employee_id: str = Depends(require_auth),
) -> Response:
    record = db.query(models.Analysis).filter(models.Analysis.id == body.analysis_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="해석 이력을 찾을 수 없습니다.")

    assert_current_user_can_access_owner(record.employee_id, employee_id, db)

    try:
        filename, data = build_report_xlsx(record, user_connection_base=_USER_CONNECTION_DIR)
    except ReportNotAvailable as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    log_activity(
        db,
        "EXPORT_REPORT",
        employee_id=employee_id,
        action_detail={"analysis_id": record.id, "program_name": record.program_name},
        ip_address=req.client.host if req.client else None,
    )

    return Response(
        content=data,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
