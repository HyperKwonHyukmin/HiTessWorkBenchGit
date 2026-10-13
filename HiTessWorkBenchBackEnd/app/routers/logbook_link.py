"""Hi-TESS LogBook 연동 라우터 (`/api/logbook/*`).

- `POST /launch`  — WB 로그인 사용자에게 LogBook 자동 로그인용 일회 코드 URL 을 준다.
- `POST /redeem`  — LogBook 서버가 공유 비밀키로 코드를 사번으로 바꾼다(1회용).
- `POST /import`  — LogBook 의 BDF 를 서버끼리 받아 `userConnection/<ts>_<사번>_LogBookImport/` 에 둔다.
  이 폴더명은 `_access_control.WORK_FOLDER_RE` 를 통과하므로 GMU `request-from-path` 가 그대로 받는다.
  LB 에는 `&target=<gmu|truss>` 를 함께 보낸다 — LB 가 대상별 분류 규칙으로 거절하면 409 `target_not_allowed`.

App Settings 게이트(`GUARDED_ROUTES`)에는 넣지 않는다 — LogBook 은 ANALYSIS_DATA 의 App 이 아니고,
가져온 뒤 시작하는 BDF 검증(`/api/analysis/groupmoduleunit/`)이 이미 GMU 게이트에 걸린다.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
from datetime import datetime
from typing import Optional
from urllib.parse import unquote, urlencode

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth
from ..services import logbook_integration as lb
from ..services.workspace import create_analysis_workspace
from ._access_control import assert_current_user_can_access_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/logbook", tags=["logbook"])

_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))
USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))

IMPORT_PROGRAM_NAME = "LogBookImport"
IMPORT_TIMEOUT_SECONDS = 120.0
IMPORT_CHUNK_SIZE = 1024 * 1024
SOURCE_FILE_NAME = "logbook_source.json"
VALID_TARGETS = {"gmu", "truss"}
VALID_NEXT = {"inbox"}
VALID_IMPORT_TARGETS = {"GroupModuleUnit", "TrussAssessment"}
# import target(WB App 이름) → LB content 요청의 target(=launch/sso 의 target 과 같은 짧은 이름).
LB_TARGET_OF_IMPORT = {"GroupModuleUnit": "gmu", "TrussAssessment": "truss"}

# 테스트가 httpx.MockTransport 를 끼워 넣는 자리(운영에서는 None = 실제 네트워크).
_http_transport: Optional[httpx.BaseTransport] = None


def _require_enabled() -> str:
    secret = lb.integration_secret()
    if not secret:
        raise HTTPException(status_code=503, detail="logbook_integration_disabled")
    return secret


def _bearer_token(request: Request) -> str:
    return request.headers.get("Authorization", "").removeprefix("Bearer ").strip()


# ── launch ─────────────────────────────────────────────────────────────────────

class LaunchRequest(BaseModel):
    target: Optional[str] = None
    slot: Optional[int] = None
    # 자동 로그인 뒤 열 LogBook 화면 — 'inbox'(정리 대기, All Projects 보내기 후)만. LogBook 도 같은 허용 목록이다.
    next: Optional[str] = None


@router.post("/launch")
def launch_logbook(
    payload: LaunchRequest,
    request: Request,
    db: Session = Depends(database.get_db),
    employee_id: str = Depends(require_auth),
):
    _require_enabled()
    token = _bearer_token(request)
    session_row = None
    if token:
        session_row = db.query(models.UserSession).filter(models.UserSession.token == token).first()
    try:
        code = lb.launch_code_store.issue(
            employee_id,
            lb.wb_ref_of(token),
            session_row.expires_at if session_row else None,
        )
    except lb.RateLimited:
        raise HTTPException(status_code=429, detail="logbook_launch_rate_limited")

    params = {"code": code}
    target = (payload.target or "").strip().lower()
    if target in VALID_TARGETS:
        params["target"] = target
        if target == "truss":
            # Truss Structural Assessment 는 작업 탭이 없는 단일 화면 — 작업 번호는 항상 1.
            params["slot"] = "1"
        elif isinstance(payload.slot, int) and 1 <= payload.slot <= 4:
            params["slot"] = str(payload.slot)
    if (payload.next or "").strip().lower() in VALID_NEXT:
        params["next"] = payload.next.strip().lower()
    url = f"{lb.public_base_url(request.url.hostname)}/sso?{urlencode(params)}"
    return {"url": url, "windowKey": lb.WINDOW_KEY}


# ── redeem (서버 간) ──────────────────────────────────────────────────────────

class RedeemRequest(BaseModel):
    code: str = ""


@router.post("/redeem")
def redeem_code(
    payload: RedeemRequest,
    x_hitess_integration: Optional[str] = Header(default=None),
):
    # 비밀키가 없거나 틀리면 경로 자체를 숨긴다(404).
    if not lb.secret_matches(x_hitess_integration):
        raise HTTPException(status_code=404, detail="Not Found")
    grant = lb.launch_code_store.redeem((payload.code or "").strip())
    if grant is None:
        raise HTTPException(status_code=404, detail="code_invalid")
    return {
        "employee_id": grant.employee_id,
        "wb_ref": grant.wb_ref,
        "wb_expires_at": grant.wb_expires_at.isoformat() if grant.wb_expires_at else None,
    }


# ── import ─────────────────────────────────────────────────────────────────────

class ImportRequest(BaseModel):
    file_id: int
    target: str = "GroupModuleUnit"


_UNSAFE_NAME_CHARS = re.compile(r'[\x00-\x1f<>:"/\\|?*]')


def sanitize_file_name(raw: str | None, file_id: int) -> str:
    """LogBook 이 준 원본 파일명을 폴더 밖으로 못 나가는 안전한 이름으로 만든다."""
    fallback = f"logbook_{file_id}.bdf"
    name = unquote(raw or "").strip()
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = _UNSAFE_NAME_CHARS.sub("_", name).strip(" .")
    if not name or name in {".", ".."}:
        return fallback
    if name.casefold() == SOURCE_FILE_NAME:
        return fallback
    if len(name) > 180:
        stem, ext = os.path.splitext(name)
        name = stem[: 180 - len(ext)] + ext
    return name


class LogbookFetchError(Exception):
    def __init__(self, status_code: int, detail: str, message: str | None = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.message = message  # LB 가 준 사람용 설명(있을 때만 응답 `message` 로 그대로 전달)


_STATUS_MAP = {
    404: (404, "logbook_file_not_found"),
    409: (409, "logbook_has_includes"),
    415: (415, "logbook_not_bdf"),
}
# LB 409 중 '이 대상(gmu/truss)에 보내도록 분류되지 않은 모델' — has_includes 와 같은 409 라 본문으로 가른다.
LB_TARGET_NOT_ALLOWED = "target_not_allowed"
MESSAGE_MAX = 300


def _lb_error_body(resp: httpx.Response) -> tuple[str | None, str | None]:
    """LB 오류 응답 본문에서 (detail 코드, message) 를 꺼낸다. 형식이 달라도 예외 없이 (None, None)."""
    try:
        resp.read()
        body = resp.json()
    except Exception:  # noqa: BLE001 — 본문이 JSON 이 아니어도 상태 코드로 처리한다
        return None, None
    if not isinstance(body, dict):
        return None, None
    detail = body.get("detail")
    message = body.get("message")
    if isinstance(detail, dict):  # {"detail": {"code"|"detail": …, "message": …}} 형식도 받는다
        message = message or detail.get("message")
        detail = detail.get("code") or detail.get("detail")
    detail = detail if isinstance(detail, str) else None
    message = message.strip()[:MESSAGE_MAX] if isinstance(message, str) and message.strip() else None
    return detail, message


def fetch_logbook_file(
    file_id: int, employee_id: str, work_dir: str, secret: str, target: str | None = None,
) -> dict:
    """LogBook 통합 API 에서 BDF 를 1MB 단위로 받아 work_dir 에 쓴다. 실패는 LogbookFetchError.

    target(gmu|truss)은 LB 가 대상별 분류 규칙을 검사하는 데 쓴다(LB 가 아직 모르면 무시한다).
    """
    url = f"{lb.internal_url()}/api/integration/files/{int(file_id)}/content"
    headers = {lb.INTEGRATION_HEADER: secret}
    params = {"as": employee_id}
    if target:
        params["target"] = target
    try:
        with httpx.Client(timeout=IMPORT_TIMEOUT_SECONDS, transport=_http_transport) as client:
            with client.stream("GET", url, params=params, headers=headers) as resp:
                if resp.status_code != 200:
                    if resp.status_code == 409:
                        detail, message = _lb_error_body(resp)
                        if detail == LB_TARGET_NOT_ALLOWED:
                            raise LogbookFetchError(409, "logbook_target_not_allowed", message)
                    if resp.status_code in _STATUS_MAP:
                        raise LogbookFetchError(*_STATUS_MAP[resp.status_code])
                    logger.warning("LogBook 파일 받기 실패: HTTP %s (file %s)", resp.status_code, file_id)
                    raise LogbookFetchError(502, "logbook_unreachable")
                file_name = sanitize_file_name(resp.headers.get("X-LogBook-File-Name"), file_id)
                entry_id = (resp.headers.get("X-LogBook-Entry") or "").strip() or None
                dest = os.path.join(work_dir, file_name)
                digest = hashlib.sha256()
                size = 0
                with open(dest, "wb") as fh:
                    for chunk in resp.iter_bytes(IMPORT_CHUNK_SIZE):
                        if not chunk:
                            continue
                        fh.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
    except LogbookFetchError:
        raise
    except (httpx.HTTPError, OSError) as exc:
        logger.warning("LogBook 연결 실패 (file %s): %s", file_id, exc)
        raise LogbookFetchError(502, "logbook_unreachable") from exc
    return {
        "path": dest,
        "fileName": file_name,
        "entryId": entry_id,
        "sha256": digest.hexdigest(),
        "size": size,
    }


@router.post("/import")
def import_from_logbook(
    payload: ImportRequest,
    db: Session = Depends(database.get_db),
    employee_id: str = Depends(require_auth),
):
    secret = _require_enabled()
    if payload.target not in VALID_IMPORT_TARGETS:
        raise HTTPException(status_code=400, detail="logbook_invalid_target")
    if payload.file_id <= 0:
        raise HTTPException(status_code=400, detail="logbook_invalid_file_id")

    work_dir, _timestamp = create_analysis_workspace(
        USER_CONNECTION_DIR, employee_id, IMPORT_PROGRAM_NAME,
    )
    try:
        meta = fetch_logbook_file(
            payload.file_id, employee_id, work_dir, secret, LB_TARGET_OF_IMPORT[payload.target],
        )
        source = {
            "entryId": meta["entryId"],
            "fileId": payload.file_id,
            "fileName": meta["fileName"],
            "sha256": meta["sha256"],
            "size": meta["size"],
            "importedAt": datetime.now().isoformat(timespec="seconds"),
            "employee_id": employee_id,
            "target": payload.target,
        }
        with open(os.path.join(work_dir, SOURCE_FILE_NAME), "w", encoding="utf-8") as fh:
            json.dump(source, fh, ensure_ascii=False, indent=2)
        # 이후 GMU request-from-path 가 같은 검사를 하므로 여기서 미리 확인해 둔다.
        assert_current_user_can_access_path(meta["path"], employee_id, db, USER_CONNECTION_DIR)
    except LogbookFetchError as exc:
        shutil.rmtree(work_dir, ignore_errors=True)
        if exc.message:
            # LB 가 준 사유를 그대로 싣는다(detail 은 다른 오류와 같은 코드 문자열 유지).
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "message": exc.message},
            )
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise

    return {
        "bdfServerPath": meta["path"],
        "fileName": meta["fileName"],
        "entryId": meta["entryId"],
        "fileId": payload.file_id,
    }
