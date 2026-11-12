"""기능 업데이트 안내(HTML) — 사내 누구나 로그인 없이 여는 공개 페이지 한 장(2026-11-12).

안내는 한 페이지에 쌓인다(누적). 페이지는 하나이고, 들어온 주소(/updates/<안내 id>)의 안내를 첫 화면으로 보인다.
왼쪽 목록에서 고르면 주소도 그 안내로 바뀐다(옛 방식 #<안내 id> 도 받는다).

주소
  GET  /updates                → /updates/ 로 이동(307, 그림 상대 경로 때문에)
  GET  /updates/               → index.html(공통 틀 — 내용은 updates.json 을 읽어 그린다), 첫 화면 = 최신 안내
  GET  /updates/<안내 id>      → 같은 index.html, 첫 화면 = 그 안내(없는 id 면 최신)
  GET  /updates/updates.json   → 안내 목록(최신이 앞)
  GET  /updates/{파일}         → 그림·글꼴
  POST /updates/beacon         → 브라우저에서 본 기록(로그인 없음, IP 해시)
  POST /api/updates/beacon     → 앱 안에서 본 기록(로그인, 사번)
  GET  /api/admin/update-stats → 안내별 조회 통계(뉴스레터 통계와 같은 사람만)

폴더 = `UpdateWeb/`(git 추적 — 145 는 git pull 로 반영). 새 안내 = updates.json 맨 앞에 한 항목 + img/ 그림.
⚠ 파일은 read() 바이트로 보내고 Content-Length 를 약속하지 않는다(회사 DRM 크기 불일치 함정).
"""
import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from sqlalchemy.orm import Session

from app import database
from app.dependencies import require_auth
from app.services import update_page_stats

router = APIRouter(tags=["updates-web"])

UPDATE_WEB_DIR = Path(__file__).resolve().parent.parent.parent / "UpdateWeb"

_ENTRY_RE = re.compile(r"^[0-9a-z][0-9a-z-]{0,63}$")
_SECTION_RE = re.compile(r"^[a-z][0-9a-z-]{0,31}$")
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ASSET_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".gif": "image/gif",
    ".woff2": "font/woff2", ".woff": "font/woff",
}
# 이름 글자와 / 만 — `//호스트/공유/x` 같은 UNC 경로가 resolve() 에서 서버를 그 호스트로 접속시키지 않게(뉴스레터와 같은 규칙).
_SAFE_ASSET_RE = re.compile(r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$")
_DRM_MAGIC = b"HHIDRMC"
_NOT_FOUND = "업데이트 안내를 찾을 수 없습니다."
_NO_CACHE = {"Cache-Control": "no-cache"}


def _read(path: Path) -> bytes:
    data = path.read_bytes()
    if data.startswith(_DRM_MAGIC):
        raise HTTPException(status_code=500, detail=f"안내 파일이 DRM 에 감싸져 있습니다: {path.name}")
    return data


def load_entries() -> list[dict]:
    """updates.json 의 안내 목록(최신이 앞). 모양이 틀린 항목은 빼고 나머지만 — 한 항목 실수로 페이지 전체가 깨지지 않게."""
    path = UPDATE_WEB_DIR / "updates.json"
    if not path.is_file():
        return []
    try:
        data = json.loads(_read(path).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return []
    items = data.get("entries") if isinstance(data, dict) else None
    out, seen = [], set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        entry_id = item.get("id")
        if not (isinstance(entry_id, str) and _ENTRY_RE.match(entry_id)) or entry_id in seen:
            continue
        if not _DAY_RE.match(str(item.get("date") or "")):
            continue
        sections = [s for s in item.get("sections") or []
                    if isinstance(s, dict) and isinstance(s.get("id"), str) and _SECTION_RE.match(s["id"])]
        seen.add(entry_id)
        out.append({**item, "sections": sections})
    out.sort(key=lambda e: e["date"], reverse=True)   # 같은 날은 파일 순서(안정 정렬)
    return out


def _entry_sections() -> dict:
    return {e["id"]: {s["id"] for s in e["sections"]} for e in load_entries()}


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


async def _payload(request: Request) -> dict:
    try:
        body = await request.body()
        data = json.loads(body[:4096] or b"{}")
    except (ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


@router.api_route("/updates", methods=["GET", "HEAD"], include_in_schema=False)
def updates_redirect():
    return RedirectResponse("/updates/", status_code=307, headers=_NO_CACHE)


@router.api_route("/updates/", methods=["GET", "HEAD"], include_in_schema=False)
def updates_page():
    page = UPDATE_WEB_DIR / "index.html"
    if not page.is_file():
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return HTMLResponse(_read(page), headers=_NO_CACHE)


@router.api_route("/updates/updates.json", methods=["GET", "HEAD"], include_in_schema=False)
def updates_json():
    return JSONResponse({"entries": load_entries()}, headers=_NO_CACHE)


@router.post("/updates/beacon", include_in_schema=False)
async def updates_beacon(request: Request, db: Session = Depends(database.get_db)):
    payload = await _payload(request)
    # 동기 DB 작업은 스레드에서 — async 안에서 바로 부르면 DB 가 느릴 때 9091 전체가 멈춘다.
    await run_in_threadpool(update_page_stats.record, db, _entry_sections(), payload, _client_ip(request), None)
    return Response(status_code=204)


@router.post("/api/updates/beacon", include_in_schema=False)
async def updates_beacon_signed_in(request: Request, employee_id: str = Depends(require_auth),
                                   db: Session = Depends(database.get_db)):
    """앱 안에서 본 기록 — 페이지(iframe)가 postMessage 로 넘긴 값을 앱이 로그인과 함께 보낸다."""
    payload = await _payload(request)
    await run_in_threadpool(update_page_stats.record, db, _entry_sections(), payload, None, employee_id)
    return Response(status_code=204)


@router.get("/api/admin/update-stats", include_in_schema=False)
def update_stats_view(employee_id: str = Depends(require_auth), db: Session = Depends(database.get_db)):
    """뉴스레터 통계와 같은 사람만. 다른 사람은 403 대신 200 {allowed:false}(화면 진단 경고가 쌓이지 않게)."""
    if (employee_id or "").upper() not in update_page_stats.stats_viewers():
        return {"allowed": False}
    data = update_page_stats.build_stats(db, load_entries())
    data["allowed"] = True
    return data


@router.api_route("/updates/{asset_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def updates_asset(asset_path: str):
    # 안내 주소(/updates/<안내 id>)도 같은 페이지 한 장을 준다 — 페이지가 주소를 읽어 그 안내를 첫 화면으로 보인다.
    # 그림·글꼴 상대 경로(img/…)가 /updates/img/… 로 풀리도록 끝에 / 가 붙은 주소는 / 없는 주소로 보낸다.
    # 없는 안내 id(지운 안내의 옛 링크 등)도 페이지를 준다 — 페이지가 최신 안내로 대신 보여 준다(죽은 링크 방지).
    entry_id = asset_path.rstrip("/")
    if _ENTRY_RE.match(entry_id):   # 안내 id 규칙에는 '.' 이 없어 그림·글꼴 파일과 겹치지 않는다
        if asset_path.endswith("/"):
            return RedirectResponse(f"/updates/{entry_id}", status_code=307, headers=_NO_CACHE)
        return updates_page()
    if not _SAFE_ASSET_RE.match(asset_path or ""):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    folder = UPDATE_WEB_DIR.resolve()
    target = (folder / asset_path).resolve()
    if folder not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    media_type = _ASSET_TYPES.get(target.suffix.lower())
    if media_type is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return Response(_read(target), media_type=media_type, headers={"Cache-Control": "public, max-age=86400"})
