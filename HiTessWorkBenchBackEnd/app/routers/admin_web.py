"""관리자 웹 콘솔 — WorkBench.exe 없이 크롬에서 관리 화면을 쓰는 페이지 + 스트림덱용 숫자 API.

계획: docs/plans/2026-11-18-admin-web-console-plan.md

주소
  GET /admin                          → /admin/ 로 이동(307). 자원 경로가 상대 경로(vite base './')라 끝에 / 가 있어야 한다.
  GET /admin/                         → AdminWeb/admin.html
  GET /admin/{파일}                   → 빌드 자원(assets/*.js·css·글꼴·그림)
  GET /api/admin-console/access       → 이 사람이 콘솔을 써도 되는지(입구 검사). 안 되면 200 {allowed:false}
  GET /api/admin-console/pending-count→ 가입 승인 대기 수. Bearer(콘솔 사용자) 또는 스트림덱 열쇠 헤더

폴더 = `AdminWeb/` (git 추적 — 70 에서 scripts/build-admin-web.ps1 로 만들고 커밋, 145 는 git pull)
페이지와 자원은 로그인 없이 내준다 — exe 에 실리는 것과 같은 화면 코드라 비밀이 없고, 데이터는 API 가 지킨다.

'나만' 규칙(사용자 결정 2026-11-18): 입구와 스트림덱 API 만 `ADMIN_CONSOLE_VIEWERS`(기본 A476854) 로 좁힌다.
관리 API 자체는 exe 와 같아 `is_admin` 만 본다 — 여기에 사번 검사를 덧대면 exe 를 쓰는 다른 관리자가 막힌다.

스트림덱 열쇠: `.env ADMIN_CONSOLE_STREAMDECK_KEY_SHA256`(원문의 sha256 hex). 원문은 스트림덱 설정 칸에만 있다.
비면 열쇠 경로는 꺼진다. 이 열쇠로는 가입 대기 숫자 말고 아무것도 못 한다.

⚠ 파일은 read() 바이트로 보내고 Content-Length 를 약속하지 않는다(회사 DRM 이 감싼 파일의 크기 불일치 함정).
"""
import hashlib
import hmac
import os
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import database, models
from app.sessions import session_store

router = APIRouter(tags=["admin-web"])

ADMIN_WEB_DIR = Path(__file__).resolve().parent.parent.parent / "AdminWeb"
PAGE_NAME = "admin.html"
DEFAULT_VIEWERS = "A476854"
STREAMDECK_KEY_HEADER = "X-Admin-Console-Key"

_ASSET_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
}
# 이름 글자와 / 만 받는다 — `//호스트/공유/x.js` 같은 UNC 경로를 resolve() 전에 막는다(history_web 과 같은 이유).
_SAFE_ASSET_RE = re.compile(r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$")
_DRM_MAGIC = b"HHIDRMC"
_NOT_FOUND = "관리자 콘솔 파일을 찾을 수 없습니다."
_NO_CACHE = {"Cache-Control": "no-cache"}
# vite 빌드 자원은 이름에 내용 해시가 붙어 오래 캐시해도 된다.
_LONG_CACHE = {"Cache-Control": "public, max-age=31536000, immutable"}


def console_viewers() -> set[str]:
    raw = os.getenv("ADMIN_CONSOLE_VIEWERS")
    raw = DEFAULT_VIEWERS if raw is None else raw
    return {v.strip().upper() for v in raw.split(",") if v.strip()}


def _streamdeck_key_hash() -> str:
    return (os.getenv("ADMIN_CONSOLE_STREAMDECK_KEY_SHA256") or "").strip().lower()


def _read(path: Path) -> bytes:
    data = path.read_bytes()
    if data.startswith(_DRM_MAGIC):
        raise HTTPException(status_code=500, detail=f"관리자 콘솔 파일이 DRM 에 감싸져 있습니다: {path.name}")
    return data


# ── 페이지 ─────────────────────────────────────────────────────────────

@router.api_route("/admin", methods=["GET", "HEAD"], include_in_schema=False)
def admin_without_slash():
    return RedirectResponse("/admin/", status_code=307, headers=_NO_CACHE)


@router.api_route("/admin/", methods=["GET", "HEAD"], include_in_schema=False)
def admin_page():
    page = ADMIN_WEB_DIR / PAGE_NAME
    if not page.is_file():
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return HTMLResponse(_read(page), headers=_NO_CACHE)


@router.api_route("/admin/{asset_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def admin_asset(asset_path: str):
    if not _SAFE_ASSET_RE.match(asset_path or ""):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    folder = ADMIN_WEB_DIR.resolve()
    target = (folder / asset_path).resolve()
    if folder not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    media_type = _ASSET_TYPES.get(target.suffix.lower())
    if media_type is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    headers = _LONG_CACHE if target.parent.name == "assets" else _NO_CACHE
    return Response(_read(target), media_type=media_type, headers=headers)


# ── API ────────────────────────────────────────────────────────────────

def _bearer_employee_id(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    return session_store.get_employee_id(token) if token else None


def _is_console_user(db: Session, employee_id: str | None) -> bool:
    if not employee_id or employee_id.upper() not in console_viewers():
        return False
    user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    return bool(user and user.is_admin and user.is_active)


@router.get("/api/admin-console/access")
def console_access(
    authorization: str | None = Header(default=None),
    db: Session = Depends(database.get_db),
):
    """입구 검사. 로그인 안 됨 = 401(화면이 로그인으로), 로그인했지만 대상 아님 = 200 {allowed:false}.

    403 이 아니라 200 을 주는 것은 화면 네트워크 진단이 경고를 쌓지 않게 하려는 것(뉴스레터 통계와 같음).
    """
    employee_id = _bearer_employee_id(authorization)
    if not employee_id:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    return {"allowed": _is_console_user(db, employee_id), "employee_id": employee_id}


@router.post("/api/admin-console/logout")
def console_logout(authorization: str | None = Header(default=None)):
    """콘솔 로그아웃 — 이 토큰 하나만 없앤다.

    /api/logout 은 그 사람의 외부 App 세션·접속 표시·접속 이력까지 닫아서, 콘솔에서 로그아웃하면
    exe 로 쓰던 외부 App 이 끊긴다(커밋 전 리뷰 2026-11-18). 토큰이 없거나 이미 만료여도 200.
    """
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        if token:
            session_store.revoke(token)
    return {"ok": True}


@router.get("/api/admin-console/pending-count")
def pending_count(
    authorization: str | None = Header(default=None),
    admin_console_key: str | None = Header(default=None, alias=STREAMDECK_KEY_HEADER),
    db: Session = Depends(database.get_db),
):
    """가입 승인 대기(is_active = false) 수. 기존 화면(App.jsx 배지)과 같은 기준이다."""
    allowed = False
    if admin_console_key:
        expected = _streamdeck_key_hash()
        given = hashlib.sha256(admin_console_key.strip().encode("utf-8")).hexdigest()
        allowed = bool(expected) and hmac.compare_digest(given, expected)
        if not allowed:
            raise HTTPException(status_code=401, detail="스트림덱 열쇠가 맞지 않습니다.")
    else:
        employee_id = _bearer_employee_id(authorization)
        if not employee_id:
            raise HTTPException(status_code=401, detail="인증이 필요합니다.")
        allowed = _is_console_user(db, employee_id)
        if not allowed:
            raise HTTPException(status_code=403, detail="관리자 콘솔 사용자가 아닙니다.")

    # 화면은 `!u.is_active` 로 세므로 NULL 도 대기로 친다.
    count = db.query(models.User).filter(
        or_(models.User.is_active.is_(False), models.User.is_active.is_(None))
    ).count()
    return {"pending": count, "checked_at": datetime.now().isoformat(timespec="seconds")}
