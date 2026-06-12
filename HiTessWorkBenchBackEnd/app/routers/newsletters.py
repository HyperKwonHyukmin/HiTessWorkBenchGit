"""뉴스레터(PDF) 아카이브 CRUD 및 파일 제공 라우터.

설계 원칙:
  - PDF 원본은 백엔드 `NewsLetter/` 폴더에만 저장한다. 배포 exe 에는 번들하지 않으므로
    발행 호수가 매달 늘어도 클라이언트(프론트엔드) 용량은 불변이다.
  - 메타데이터(제목/발행일/설명)는 DB `newsletters` 테이블에 기록한다.
  - 신규 발행은 관리자 업로드(POST, multipart)로 등록하고,
    이미 폴더에 들어있는 PDF 는 서버 시작 시 1회 자동 시드한다(`seed_existing_newsletters`).
"""
import os
import re
import uuid
from datetime import datetime
from urllib.parse import quote

import fitz  # PyMuPDF — PDF 페이지를 PNG 로 렌더링(미리보기용)
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy.orm import Session

from .. import database, models, schemas
from ..dependencies import require_admin
from ..services.activity_service import log_activity
from ._crud_helpers import create_record, delete_record, get_or_404

router = APIRouter(prefix="/api/newsletters", tags=["newsletters"])

# 서버 실행 디렉토리(HiTessWorkBenchBackEnd/) 기준 상대 경로 — Videos 마운트와 동일한 규칙.
NEWSLETTER_DIR = "NewsLetter"
_NOT_FOUND = "뉴스레터를 찾을 수 없습니다."
_MAX_BYTES = 50 * 1024 * 1024  # PDF 업로드 상한 50MB

# 렌더링한 페이지 PNG 인메모리 캐시: (stored_name, mtime, page_no) -> png bytes
# (디스크에 캐시하면 DRM 이 재암호화하므로 메모리에만 둔다.)
_PAGE_CACHE: dict = {}
_PAGE_RENDER_ZOOM = 2.0  # 72dpi * 2 = 144dpi — 화면 미리보기에 충분한 선명도


def _safe_full_path(stored_name: str) -> str:
    """stored_name 이 NewsLetter/ 폴더를 벗어나지 않는지 검사하고 절대경로를 반환한다."""
    base = os.path.abspath(NEWSLETTER_DIR)
    full = os.path.abspath(os.path.join(NEWSLETTER_DIR, stored_name or ""))
    if full != base and not full.startswith(base + os.sep):
        raise HTTPException(status_code=400, detail="잘못된 파일 경로입니다.")
    return full


def _parse_issue_date(stem: str, path: str):
    """파일명에서 'YY년 M월' 패턴으로 발행일을 추정한다. 실패 시 파일 수정시각으로 대체."""
    m = re.search(r"(\d{2})\s*년[_\s]*(\d{1,2})\s*월", stem)
    if m:
        yy, mm = int(m.group(1)), int(m.group(2))
        try:
            return datetime(2000 + yy, mm, 1)
        except ValueError:
            pass
    try:
        return datetime.fromtimestamp(os.path.getmtime(path))
    except OSError:
        return None


def seed_existing_newsletters(db: Session) -> None:
    """NewsLetter/ 폴더에 이미 존재하지만 DB 에 없는 PDF 를 1회 시드한다(멱등).

    제목은 파일명에서, 발행일은 파일명의 'YY년 M월' 패턴(또는 수정시각)에서 추정한다.
    이후 신규 발행은 관리자 업로드 UI 로 등록한다.
    """
    if not os.path.isdir(NEWSLETTER_DIR):
        return
    existing = {n.stored_name for n in db.query(models.Newsletter).all()}
    added = False
    for fname in sorted(os.listdir(NEWSLETTER_DIR)):
        if not fname.lower().endswith(".pdf") or fname in existing:
            continue
        path = os.path.join(NEWSLETTER_DIR, fname)
        if not os.path.isfile(path):
            continue
        stem = os.path.splitext(fname)[0]
        db.add(models.Newsletter(
            title=stem.replace("_", " ").strip(),
            issue_date=_parse_issue_date(stem, path),
            description=None,
            file_name=fname,
            stored_name=fname,
            author_id="system",
        ))
        added = True
    if added:
        db.commit()


@router.get("", response_model=list[schemas.NewsletterResponse])
def list_newsletters(db: Session = Depends(database.get_db)):
    """발행일(없으면 등록일) 내림차순으로 전체 뉴스레터 목록을 반환한다."""
    # MySQL 은 DESC 정렬 시 NULL 을 자동으로 마지막에 둔다(별도 NULLS LAST 구문 불필요).
    return (
        db.query(models.Newsletter)
        .order_by(models.Newsletter.issue_date.desc(),
                  models.Newsletter.created_at.desc())
        .all()
    )


@router.post("", response_model=schemas.NewsletterResponse)
async def create_newsletter(
    request: Request,
    title: str = Form(...),
    issue_date: str | None = Form(None),   # ISO 날짜 문자열 (예: 2026-06-01)
    description: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    current_admin: str = Depends(require_admin),
):
    """관리자: PDF + 메타데이터를 업로드해 뉴스레터를 등록한다."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드할 수 있습니다.")

    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="파일이 너무 큽니다(최대 50MB).")
    if content[:5] != b"%PDF-":
        raise HTTPException(status_code=400, detail="유효한 PDF 파일이 아닙니다.")

    os.makedirs(NEWSLETTER_DIR, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.pdf"
    with open(_safe_full_path(stored_name), "wb") as fp:
        fp.write(content)

    parsed_date = None
    if issue_date:
        try:
            parsed_date = datetime.fromisoformat(issue_date)
        except ValueError:
            parsed_date = None

    created = create_record(db, models.Newsletter(
        title=title.strip() or os.path.splitext(file.filename)[0],
        issue_date=parsed_date,
        description=(description or None),
        file_name=file.filename,
        stored_name=stored_name,
        author_id=current_admin,
    ))
    log_activity(db, "NEWSLETTER_EDIT", employee_id=current_admin,
                 action_detail={"operation": "create", "newsletter_id": created.id, "title": created.title},
                 status="success", ip_address=request.client.host if request.client else None)
    return created


@router.delete("/{newsletter_id}")
def delete_newsletter(newsletter_id: int, request: Request,
                      db: Session = Depends(database.get_db),
                      current_admin: str = Depends(require_admin)):
    """관리자: 뉴스레터 DB 레코드와 PDF 파일을 함께 삭제한다."""
    nl = get_or_404(db, models.Newsletter, newsletter_id, _NOT_FOUND)
    title, stored_name = nl.title, nl.stored_name
    result = delete_record(db, nl)
    # 시드 항목(폴더 원본)도 사용자가 삭제를 원한 것이므로 파일까지 제거한다.
    try:
        full = _safe_full_path(stored_name)
        if os.path.isfile(full):
            os.remove(full)
    except (OSError, HTTPException):
        pass  # 파일 삭제 실패는 치명적이지 않음(DB 레코드는 이미 삭제됨)
    log_activity(db, "NEWSLETTER_EDIT", employee_id=current_admin,
                 action_detail={"operation": "delete", "newsletter_id": newsletter_id, "title": title},
                 status="success", ip_address=request.client.host if request.client else None)
    return result


@router.get("/{newsletter_id}/file")
def get_newsletter_file(newsletter_id: int, download: bool = False,
                        db: Session = Depends(database.get_db)):
    """뉴스레터 PDF 를 반환한다.

    회사 DRM 이 디스크 파일을 자동 재암호화하므로, 디스크 stat 크기와 읽기 시 복호화된 실제
    바이트 수가 달라진다. FileResponse 는 stat 크기를 Content-Length 로 보내므로 실제 전송
    바이트와 어긋나 브라우저가 ERR_CONTENT_LENGTH_MISMATCH 로 거부한다(미리보기 실패).
    → 파일을 메모리로 읽어(=DRM 복호화된 실제 바이트) 그 길이를 Content-Length 로 직접 지정해
      반환한다. (CLAUDE.md 의 Excel 내보내기와 동일한 DRM 우회 방식.)

    - download=false(기본): inline → iframe 미리보기.
    - download=true: attachment → 원본 파일명으로 저장(한글 파일명 RFC 5987 인코딩).
    """
    nl = get_or_404(db, models.Newsletter, newsletter_id, _NOT_FOUND)
    full = _safe_full_path(nl.stored_name)
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="PDF 파일이 서버에 존재하지 않습니다.")

    with open(full, "rb") as fp:
        data = fp.read()  # DRM 에이전트가 읽기 시점에 복호화 → 실제 PDF 바이트

    if download:
        # 한글 파일명은 RFC 5987(filename*) 로 인코딩
        disposition = f"attachment; filename*=UTF-8''{quote(nl.file_name)}"
    else:
        disposition = "inline"
    # Response 가 len(data) 를 Content-Length 로 자동 설정 → 실제 전송 바이트와 정확히 일치.
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": disposition})


def _open_pdf(full: str) -> fitz.Document:
    """디스크의 PDF 를 메모리로 읽어(=DRM 복호화된 바이트) fitz 문서로 연다."""
    with open(full, "rb") as fp:
        data = fp.read()
    return fitz.open(stream=data, filetype="pdf")


@router.get("/{newsletter_id}/pages")
def get_newsletter_page_count(newsletter_id: int, db: Session = Depends(database.get_db)):
    """뉴스레터 PDF 의 총 페이지 수를 반환한다. (프론트가 페이지별 PNG 를 요청하기 위해 사용)"""
    nl = get_or_404(db, models.Newsletter, newsletter_id, _NOT_FOUND)
    full = _safe_full_path(nl.stored_name)
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="PDF 파일이 서버에 존재하지 않습니다.")
    doc = _open_pdf(full)
    try:
        return {"pageCount": doc.page_count}
    finally:
        doc.close()


@router.get("/{newsletter_id}/page/{page_no}")
def get_newsletter_page_image(newsletter_id: int, page_no: int,
                              db: Session = Depends(database.get_db)):
    """뉴스레터 PDF 의 특정 페이지(1-기반)를 PNG 로 렌더링해 반환한다.

    PDF iframe 은 Electron 내장 PDF 뷰어 의존성 때문에 환경에 따라 빈 화면이 되므로,
    미리보기는 페이지를 PNG 로 렌더해 <img> 로 표시한다(브라우저·Electron 어디서나 안정 렌더).
    렌더링은 비용이 있으므로 (stored_name, mtime, page) 키로 인메모리 캐시한다.
    """
    nl = get_or_404(db, models.Newsletter, newsletter_id, _NOT_FOUND)
    full = _safe_full_path(nl.stored_name)
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="PDF 파일이 서버에 존재하지 않습니다.")

    key = (nl.stored_name, os.path.getmtime(full), page_no)
    png = _PAGE_CACHE.get(key)
    if png is None:
        doc = _open_pdf(full)
        try:
            if page_no < 1 or page_no > doc.page_count:
                raise HTTPException(status_code=404, detail="해당 페이지가 없습니다.")
            pix = doc.load_page(page_no - 1).get_pixmap(
                matrix=fitz.Matrix(_PAGE_RENDER_ZOOM, _PAGE_RENDER_ZOOM), alpha=False)
            png = pix.tobytes("png")
        finally:
            doc.close()
        if len(_PAGE_CACHE) > 200:  # 캐시 무한 증가 방지
            _PAGE_CACHE.clear()
        _PAGE_CACHE[key] = png
    return Response(content=png, media_type="image/png")
