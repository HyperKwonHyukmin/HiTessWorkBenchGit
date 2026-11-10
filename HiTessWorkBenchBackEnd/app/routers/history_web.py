"""Hi-TESS 개발 연대기 — 사내 누구나 로그인 없이 브라우저로 여는 공개 페이지(웹 뉴스레터와 같은 방식).

주소
  GET /history          → /history/ 로 이동(307). 자료 파일 경로가 상대 경로라 끝에 / 가 있어야 한다.
  GET /history/         → index.html
  GET /history/{파일}   → 같은 폴더의 자료(data.auto.js · data.events.js)·글꼴

폴더 = `HistoryWeb/` (git 추적 — 145 는 git pull 로 반영, 재시작 불필요)
  index.html       그리기만 한다
  data.events.js   사람이 쓰는 내용(시기·앱 등장·주요 변화) — 새 일이 생기면 여기에 한 줄
  data.auto.js     scripts/history_build.py 가 git 기록에서 뽑은 숫자(주간 작업량·버전) — 70 에서 실행 후 커밋
WorkBench 앱 안에서는 Administration > Development History 가 이 페이지를 그대로 보여 준다.

⚠ 파일은 read() 바이트로 보내고 Content-Length 를 약속하지 않는다(회사 DRM 이 감싼 파일의 크기 불일치 함정).
"""
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, Response

router = APIRouter(tags=["history-web"])

HISTORY_WEB_DIR = Path(__file__).resolve().parent.parent.parent / "HistoryWeb"

# 공개 경로라 내줄 형식을 좁힌다(그 밖은 404). 자료(.js)는 고치면 바로 보이게 캐시하지 않는다.
_ASSET_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".woff2": "font/woff2",
    ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
}
# 파일 경로는 이름 글자와 / 만 받는다. 앞의 /·역슬래시·콜론을 막지 않으면 `//호스트/공유/x.js` 같은 UNC 경로가
# resolve() 단계에서 서버를 그 호스트로 접속시킨다(로그인 없는 경로라 누구나 보낼 수 있다 — 커밋 전 리뷰).
_SAFE_ASSET_RE = re.compile(r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$")
_DRM_MAGIC = b"HHIDRMC"
_NOT_FOUND = "개발 연대기를 찾을 수 없습니다."
_NO_CACHE = {"Cache-Control": "no-cache"}


def _read(path: Path) -> bytes:
    data = path.read_bytes()
    if data.startswith(_DRM_MAGIC):
        # 서버에서 DRM 에 감싸였으면 깨진 파일을 내보내지 말고 원인을 알린다.
        raise HTTPException(status_code=500, detail=f"개발 연대기 파일이 DRM 에 감싸져 있습니다: {path.name}")
    return data


@router.api_route("/history", methods=["GET", "HEAD"], include_in_schema=False)
def history_without_slash():
    return RedirectResponse("/history/", status_code=307, headers=_NO_CACHE)


@router.api_route("/history/", methods=["GET", "HEAD"], include_in_schema=False)
def history_page():
    page = HISTORY_WEB_DIR / "index.html"
    if not page.is_file():
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return HTMLResponse(_read(page), headers=_NO_CACHE)


@router.api_route("/history/{asset_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def history_asset(asset_path: str):
    if not _SAFE_ASSET_RE.match(asset_path or ""):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    folder = HISTORY_WEB_DIR.resolve()
    target = (folder / asset_path).resolve()
    if folder not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    media_type = _ASSET_TYPES.get(target.suffix.lower())
    if media_type is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    headers = _NO_CACHE if target.suffix.lower() == ".js" else {"Cache-Control": "public, max-age=86400"}
    return Response(_read(target), media_type=media_type, headers=headers)
