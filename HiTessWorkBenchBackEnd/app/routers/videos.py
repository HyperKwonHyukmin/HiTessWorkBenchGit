"""HiTESS 소개 영상 — 로그인 사용자에게만 스트리밍한다(2026-10-26).

예전에는 `Videos/` 폴더를 `/static/videos` 로 그대로 공개해, 사내망 누구나 주소만 알면
mp4 를 통째로 받을 수 있었다. 이제는:

1. `GET /api/videos` — 목록(로그인 필요).
2. `POST /api/videos/{id}/ticket` — 로그인 사용자에게 **짧게 유효한 재생 주소**를 준다.
   `<video src>` 는 Authorization 헤더를 못 붙이므로, 사번·만료시각에 서버 비밀값으로 서명한
   표(ticket)를 주소에 싣는다. 비밀값은 프로세스마다 새로 만들어 재시작하면 옛 표는 무효다.
3. `GET /api/videos/stream/{id}?t=…` — 표를 확인하고 Range 요청(구간 재생·탐색)으로 보낸다.

녹화 방지·다운로드 차단·워터마크는 WorkBench(Electron) 영상 전용 창이 맡는다(`electron/video-window.js`).
이 라우터는 '주소를 알아도 로그인 없이는 못 받는다' 까지만 책임진다.

영상 추가: 서버의 `Videos/` 폴더에 mp4 를 넣고, 제목을 바꾸려면 같은 폴더 `videos.json` 에
`[{"file": "...mp4", "title": "...", "subtitle": "...", "category": "..."}]` 를 적는다(목록 순서도 이 순서). 재시작 불필요.
화면은 category 별로 묶어 보인다(category 순서 = 처음 나온 순서). 없으면 '기타 영상'.
videos.json 이 없는 영상은 파일명에서 'HiTESS-'·'_' 를 걷어 제목으로 쓴다.
"""

import hashlib
import hmac
import json
import logging
import re
import secrets
import struct
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app import database, models
from app.dependencies import require_auth
from app.services.activity_service import log_activity

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/videos", tags=["videos"])

VIDEO_DIR = Path(__file__).resolve().parent.parent.parent / "Videos"
MANIFEST_NAME = "videos.json"
TICKET_TTL_SECONDS = 3 * 60 * 60  # 긴 영상 + 일시정지 여유. 만료 뒤에는 창을 다시 열면 된다.
CHUNK_SIZE = 1024 * 1024
# 회사 DRM 이 감싼 파일 머리 — 감지되면 경고 로그만 남긴다.
DRM_MAGIC = b"HHIDRMC"

_SECRET = secrets.token_bytes(32)
_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _video_id(filename: str) -> str:
    return hashlib.sha1(filename.encode("utf-8")).hexdigest()[:12]


_FILE_PREFIX_RE = re.compile(r"^HiTESS[\s_-]+", re.IGNORECASE)
_duration_cache: dict[tuple[str, int, int], float | None] = {}


def _title_from_filename(name: str) -> str:
    """videos.json 에 없는 영상의 제목 — 'HiTESS_ModuleUnit.mp4' → 'ModuleUnit'."""
    stem = _FILE_PREFIX_RE.sub("", Path(name).stem).replace("_", " ").strip()
    return stem or Path(name).stem


def _iter_boxes(f, start: int, end: int):
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        head = f.read(8)
        if len(head) < 8:
            return
        size, kind = struct.unpack(">I4s", head)
        header = 8
        if size == 1:
            size = struct.unpack(">Q", f.read(8))[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header:
            return
        yield kind, pos + header, pos + size
        pos += size


def _mp4_duration(path: Path) -> float | None:
    """mp4 의 moov/mvhd 에서 재생 시간(초)을 읽는다. 못 읽으면 None(DRM 에 감싸진 파일 등)."""
    try:
        stat = path.stat()
        key = (str(path), stat.st_size, stat.st_mtime_ns)
        if key in _duration_cache:
            return _duration_cache[key]
        duration = None
        with path.open("rb") as f:
            for kind, body, end in _iter_boxes(f, 0, stat.st_size):
                if kind != b"moov":
                    continue
                for sub, sbody, _send in _iter_boxes(f, body, end):
                    if sub != b"mvhd":
                        continue
                    f.seek(sbody)
                    version = f.read(1)[0]
                    f.read(3)
                    if version == 1:
                        _c, _m, scale, length = struct.unpack(">QQIQ", f.read(28))
                    else:
                        _c, _m, scale, length = struct.unpack(">IIII", f.read(16))
                    if scale:
                        duration = round(length / scale, 1)
                    break
                break
        _duration_cache[key] = duration
        return duration
    except (OSError, struct.error, IndexError):
        return None


def _load_manifest() -> list[dict]:
    path = VIDEO_DIR / MANIFEST_NAME
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, ValueError):
        logger.warning("영상 목록 파일을 읽지 못했습니다: %s", path)
        return []
    return [item for item in data if isinstance(item, dict) and isinstance(item.get("file"), str)] if isinstance(data, list) else []


def list_videos() -> list[dict]:
    """폴더의 mp4 를 목록으로. videos.json 에 적힌 것이 먼저(그 순서·제목), 나머지는 파일명 순."""
    try:
        files = sorted(p.name for p in VIDEO_DIR.iterdir() if p.is_file() and p.suffix.lower() == ".mp4")
    except FileNotFoundError:
        return []
    present = set(files)
    items: list[dict] = []
    seen: set[str] = set()
    for entry in _load_manifest():
        name = entry["file"]
        if name not in present or name in seen:
            continue
        seen.add(name)
        items.append({
            "id": _video_id(name),
            "file": name,
            "title": str(entry.get("title") or _title_from_filename(name)),
            "subtitle": str(entry.get("subtitle") or ""),
            "category": str(entry.get("category") or ""),
        })
    for name in files:
        if name not in seen:
            items.append({"id": _video_id(name), "file": name, "title": _title_from_filename(name), "subtitle": "", "category": ""})
    return items


def _find_video(video_id: str) -> dict:
    for item in list_videos():
        if item["id"] == video_id:
            return item
    raise HTTPException(status_code=404, detail="영상을 찾을 수 없습니다.")


def _sign(video_id: str, employee_id: str, expires: int) -> str:
    message = f"{video_id}.{employee_id}.{expires}".encode("utf-8")
    return hmac.new(_SECRET, message, hashlib.sha256).hexdigest()


def make_ticket(video_id: str, employee_id: str, now: float | None = None) -> str:
    expires = int((now if now is not None else time.time()) + TICKET_TTL_SECONDS)
    return f"{employee_id}.{expires}.{_sign(video_id, employee_id, expires)}"


def verify_ticket(video_id: str, ticket: str, now: float | None = None) -> str:
    """유효하면 사번을 돌려준다. 사번에 '.' 이 있어도 되게 뒤에서부터 나눈다."""
    try:
        employee_id, expires_text, signature = ticket.rsplit(".", 2)
        expires = int(expires_text)
    except (AttributeError, ValueError):
        raise HTTPException(status_code=403, detail="재생 권한이 없습니다.")
    if not employee_id or not hmac.compare_digest(signature, _sign(video_id, employee_id, expires)):
        raise HTTPException(status_code=403, detail="재생 권한이 없습니다.")
    if (now if now is not None else time.time()) > expires:
        raise HTTPException(status_code=403, detail="재생 시간이 지났습니다. 영상 창을 다시 열어 주세요.")
    return employee_id


def _parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """Range 헤더 → (start, end) 포함 구간. 없으면 None, 잘못되면 416."""
    if not header:
        return None
    match = _RANGE_RE.match(header.strip())
    if not match or (not match.group(1) and not match.group(2)):
        raise HTTPException(status_code=416, detail="잘못된 구간 요청입니다.", headers={"Content-Range": f"bytes */{size}"})
    if match.group(1):
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else size - 1
    else:  # bytes=-N (끝에서 N 바이트)
        start = max(0, size - int(match.group(2)))
        end = size - 1
    end = min(end, size - 1)
    if start > end or start >= size:
        raise HTTPException(status_code=416, detail="잘못된 구간 요청입니다.", headers={"Content-Range": f"bytes */{size}"})
    return start, end


def _iter_file(path: Path, start: int, end: int):
    with open(path, "rb") as handle:
        handle.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = handle.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@router.get("")
def get_videos(_employee_id: str = Depends(require_auth)):
    return [
        {
            "id": v["id"],
            "title": v["title"],
            "subtitle": v["subtitle"],
            "category": v["category"],
            "durationSeconds": _mp4_duration(VIDEO_DIR / v["file"]),
        }
        for v in list_videos()
    ]


@router.post("/{video_id}/ticket")
def issue_ticket(
    video_id: str,
    request: Request,
    employee_id: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    video = _find_video(video_id)
    user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
    name = (getattr(user, "name", None) or "").strip()
    log_activity(
        db, "VIDEO_PLAY", employee_id,
        {"video": video["title"], "file": video["file"]},
        ip_address=request.client.host if request.client else None,
    )
    return {
        "id": video["id"],
        "title": video["title"],
        "subtitle": video["subtitle"],
        "streamPath": f"/api/videos/stream/{video['id']}?t={make_ticket(video['id'], employee_id)}",
        "expiresIn": TICKET_TTL_SECONDS,
        # 워터마크는 서버가 정한다 — 화면을 휴대폰으로 찍어도 누구 화면인지 남게 한다.
        "watermark": f"{name} {employee_id}".strip(),
    }


@router.get("/stream/{video_id}")
def stream_video(video_id: str, request: Request, t: str = ""):
    verify_ticket(video_id, t)
    path = VIDEO_DIR / _find_video(video_id)["file"]
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
    }
    try:
        with open(path, "rb") as handle:
            head = handle.read(len(DRM_MAGIC))
        size = path.stat().st_size
    except OSError:
        raise HTTPException(status_code=404, detail="영상을 찾을 수 없습니다.")
    if head == DRM_MAGIC:
        # mp4 는 보통 DRM 대상이 아니다(70 실측 10개 모두 평문). 감싸졌다면 재생이 안 되니 원인을 로그로 남긴다.
        logger.warning("영상 파일이 DRM 에 감싸져 있습니다(재생 불가 가능): %s", path)

    # Content-Length 는 싣지 않는다(chunked) — DRM 등으로 stat 과 실제 읽은 바이트가 다르면
    # Chromium 이 ERR_CONTENT_LENGTH_MISMATCH 로 끊는다(/api/download 095ce51 과 같은 이유).
    span = _parse_range(request.headers.get("range"), size)
    start, end = span or (0, size - 1)
    if span:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(_iter_file(path, start, end), status_code=206 if span else 200, media_type="video/mp4", headers=headers)
