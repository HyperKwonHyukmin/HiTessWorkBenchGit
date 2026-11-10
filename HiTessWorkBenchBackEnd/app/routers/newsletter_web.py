"""웹 뉴스레터(HTML) — 사내 누구나 로그인 없이 브라우저로 여는 공개 페이지.

주소
  GET /newsletter                 → 최신 호로 이동(307)
  GET /newsletter/issues.json     → 호 목록(최신이 앞) — 나중에 페이지 왼쪽 '지난 호' 목록이 쓴다
  GET /newsletter/{호}/           → 그 호의 index.html
  GET /newsletter/{호}/{파일}     → 그 호의 그림·글꼴
  POST /newsletter/{호}/beacon    → 페이지 측정 스크립트가 보내는 읽은 깊이·머문 시간(로그인 없음)
  GET /api/admin/newsletter-stats → 호별 조회 통계(지정한 사번만 — services/newsletter_stats.py)

호 폴더 = `NewsLetterWeb/<YYYY-MM>[-n]/` (git 추적 — 145 는 git pull 로 반영)
  index.html · issue.json(title·number·date·summary) · img/ · fonts/
새 호를 내려면 폴더 하나를 더하면 된다. 가장 큰 호 id 가 최신이다.

대시보드 '자료 › News Letter'(PDF·PNG, routers/newsletters.py) 와는 별개다 — 그쪽은 앱 안 아카이브.
⚠ 파일은 read() 바이트로 보내고 Content-Length 를 약속하지 않는다(회사 DRM 이 감싼 파일의 크기 불일치 함정).
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
from app.services import newsletter_stats

router = APIRouter(tags=["newsletter-web"])

NEWSLETTER_WEB_DIR = Path(__file__).resolve().parent.parent.parent / "NewsLetterWeb"

_ISSUE_RE = re.compile(r"^\d{4}-\d{2}(-[0-9a-z]+)?$")
# 공개 경로라 내줄 형식을 좁힌다(스크립트·실행 파일 등은 404). mimetypes 는 Windows 레지스트리에 따라 woff2 를 몰라 표로 둔다.
_ASSET_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".gif": "image/gif",
    ".woff2": "font/woff2", ".woff": "font/woff", ".css": "text/css; charset=utf-8",
}
_DRM_MAGIC = b"HHIDRMC"
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NOT_FOUND = "뉴스레터를 찾을 수 없습니다."


def _issue_dir(issue: str) -> Path:
    if not _ISSUE_RE.match(issue or ""):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    folder = NEWSLETTER_WEB_DIR / issue
    if not (folder / "index.html").is_file():
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return folder


def _issue_sort_key(issue_id: str) -> tuple:
    """'2026-11-10' 이 '2026-11-9' 보다 나중이 되게 접미사를 숫자로 비교한다(글자 비교면 9 가 더 크다)."""
    parts = issue_id.split("-", 2)
    suffix = parts[2] if len(parts) > 2 else ""
    return (parts[0], parts[1], int(suffix) if suffix.isdigit() else -1, suffix)


def _read(path: Path) -> bytes:
    data = path.read_bytes()
    if data.startswith(_DRM_MAGIC):
        # 서버에서 DRM 에 감싸였으면 깨진 파일을 내보내지 말고 원인을 알린다.
        raise HTTPException(status_code=500, detail=f"뉴스레터 파일이 DRM 에 감싸져 있습니다: {path.name}")
    return data


def list_issues() -> list[dict]:
    """호 목록(최신이 앞). index.html 이 있는 호 폴더만."""
    if not NEWSLETTER_WEB_DIR.is_dir():
        return []
    issues = []
    for folder in NEWSLETTER_WEB_DIR.iterdir():
        if not (folder.is_dir() and _ISSUE_RE.match(folder.name) and (folder / "index.html").is_file()):
            continue
        meta = {}
        meta_path = folder / "issue.json"
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                meta = {}
            if not isinstance(meta, dict):  # 올바른 JSON 이라도 객체가 아니면 무시(목록 전체 500 방지)
                meta = {}
        issues.append({
            "id": folder.name,
            "title": meta.get("title") or folder.name,
            "number": meta.get("number"),
            "date": meta.get("date") or folder.name[:7],
            "summary": meta.get("summary"),
            "sentDate": meta.get("sentDate") if _DAY_RE.match(str(meta.get("sentDate") or "")) else None,
            "url": f"/newsletter/{folder.name}/",
        })
    issues.sort(key=lambda item: _issue_sort_key(item["id"]), reverse=True)
    return issues


_NO_CACHE = {"Cache-Control": "no-cache"}


@router.api_route("/newsletter", methods=["GET", "HEAD"], include_in_schema=False)
@router.api_route("/newsletter/", methods=["GET", "HEAD"], include_in_schema=False)
def latest_issue():
    issues = list_issues()
    if not issues:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return RedirectResponse(issues[0]["url"], status_code=307, headers=_NO_CACHE)


@router.api_route("/newsletter/issues.json", methods=["GET", "HEAD"], include_in_schema=False)
def issues_json():
    return JSONResponse({"issues": list_issues()}, headers=_NO_CACHE)


@router.api_route("/newsletter/{issue}", methods=["GET", "HEAD"], include_in_schema=False)
def issue_without_slash(issue: str):
    # 그림 경로가 상대 경로(img/…)라 끝에 / 가 있어야 같은 호 폴더를 가리킨다.
    _issue_dir(issue)
    return RedirectResponse(f"/newsletter/{issue}/", status_code=307)


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.api_route("/newsletter/{issue}/", methods=["GET", "HEAD"], include_in_schema=False)
def issue_page(issue: str, request: Request, db: Session = Depends(database.get_db)):
    folder = _issue_dir(issue)
    html = _read(folder / "index.html")
    if request.method == "GET":
        # 조회 기록 + 측정 스크립트(2026-11-10). 기록이 실패해도 페이지는 그대로 나간다.
        newsletter_stats.record_view(db, issue, _client_ip(request))
        html = newsletter_stats.inject_tracker(html)
    return HTMLResponse(html, headers=_NO_CACHE)


@router.post("/newsletter/{issue}/beacon", include_in_schema=False)
async def issue_beacon(issue: str, request: Request, db: Session = Depends(database.get_db)):
    _issue_dir(issue)
    try:
        body = await request.body()
        payload = json.loads(body[:4096] or b"{}")
    except (ValueError, UnicodeDecodeError):
        payload = {}
    # 동기 DB 작업은 스레드에서 — async 함수 안에서 바로 부르면 DB 가 느릴 때 9091 전체가 멈춘다(리뷰 반영).
    await run_in_threadpool(newsletter_stats.record_beacon, db, issue, _client_ip(request), payload)
    return Response(status_code=204)


@router.get("/api/admin/newsletter-stats", include_in_schema=False)
def newsletter_stats_view(employee_id: str = Depends(require_auth), db: Session = Depends(database.get_db)):
    """호별 조회 통계 — 사용자 지시로 지정한 사번만(NEWSLETTER_STATS_VIEWERS, 기본 A476854).
    다른 사람에게는 403 대신 200 {allowed:false} — 화면 네트워크 진단이 403 을 '권한 없음' 경고로 쌓지 않게(리뷰 반영)."""
    if (employee_id or "").upper() not in newsletter_stats.stats_viewers():
        return {"allowed": False}
    issues_meta = list_issues()
    data = newsletter_stats.build_stats(db, {i["id"]: i["sentDate"] for i in issues_meta if i.get("sentDate")})
    data["allowed"] = True
    titles = {i["id"]: i["title"] for i in issues_meta}
    for item in data["issues"]:
        item["title"] = titles.get(item["issue"], item["issue"])
    return data


@router.api_route("/newsletter/{issue}/{asset_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def issue_asset(issue: str, asset_path: str):
    folder = _issue_dir(issue).resolve()
    target = (folder / asset_path).resolve()
    if folder not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    media_type = _ASSET_TYPES.get(target.suffix.lower())
    if media_type is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return Response(_read(target), media_type=media_type, headers={"Cache-Control": "public, max-age=86400"})

