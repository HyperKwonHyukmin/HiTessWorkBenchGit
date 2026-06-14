"""뉴스레터(PDF) 아카이브 — 공유 폴더 직접 열람 라우터.

설계 원칙(폴더 = 단일 진실 원천):
  - HPC 공유 스토리지의 `NewsLetter/` 폴더를 그대로 노출한다. DB·시드·업로드 없이,
    폴더에 '호(issue) 단위 하위 폴더'를 두면 즉시 목록에 반영된다.
  - 내 컴퓨터·서버 컴퓨터가 같은 UNC 경로를 참조하므로, 어느 쪽 백엔드를 보든 목록이 동일하다.
  - 서버 재시작·DB 시드 타이밍에 의존하지 않는다(폴더를 매 요청마다 실시간으로 읽음).

호 폴더 구조(예):
    NewsLetter/
      26년_5월/
        1.png 2.png 3.png                       # 미리보기용 페이지 이미지(우선 사용)
        HiTESS_Workbench_26년_5월_뉴스레터.pdf   # 원본 PDF(다운로드)

식별자(id)는 '호 폴더명'이다(프론트는 URL 에 encodeURIComponent 로 부착).
"""
import os
import re
from datetime import datetime
from urllib.parse import quote

import fitz  # PyMuPDF — 폴더에 PNG 가 없을 때만 PDF 페이지를 즉석 렌더(폴백)
from fastapi import APIRouter, HTTPException, Response

router = APIRouter(prefix="/api/newsletters", tags=["newsletters"])

# 공유 폴더 경로 — 환경변수 NEWSLETTER_DIR 로 오버라이드 가능.
# 기본값은 팀 공유 HPC 스토리지(내 컴퓨터·서버 컴퓨터가 공통으로 참조하는 UNC 경로).
NEWSLETTER_DIR = os.getenv(
    "NEWSLETTER_DIR",
    r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\NewsLetter",
)
_NOT_FOUND = "뉴스레터를 찾을 수 없습니다."
_PAGE_RENDER_ZOOM = 2.0  # 폴백 렌더 선명도(72dpi*2 = 144dpi)
_PAGE_FILE_RE = re.compile(r"^(\d+)\.png$", re.IGNORECASE)

# 폴백 렌더 PNG 인메모리 캐시: (pdf_path, mtime, page_no) -> png bytes
# (디스크에 캐시하면 DRM 이 재암호화하므로 메모리에만 둔다.)
_PAGE_CACHE: dict = {}


def _safe_issue_dir(issue_id: str) -> str:
    """issue_id 가 NEWSLETTER_DIR 의 '직속 하위 폴더'인지 검사하고 절대경로를 반환한다.

    상위 탈출('..')·중첩 경로·구분자 주입을 차단한다.
    """
    base = os.path.abspath(NEWSLETTER_DIR)
    full = os.path.abspath(os.path.join(NEWSLETTER_DIR, issue_id or ""))
    if os.path.dirname(full) != base:
        raise HTTPException(status_code=400, detail="잘못된 뉴스레터 경로입니다.")
    if not os.path.isdir(full):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return full


def _find_pdf(issue_dir: str):
    """호 폴더 내 첫 PDF 파일명을 반환(없으면 None)."""
    for name in sorted(os.listdir(issue_dir)):
        if name.lower().endswith(".pdf") and os.path.isfile(os.path.join(issue_dir, name)):
            return name
    return None


def _list_page_pngs(issue_dir: str):
    """호 폴더 내 'N.png' 파일을 페이지 번호 오름차순으로 [(번호, 파일명)] 반환."""
    pages = []
    for name in os.listdir(issue_dir):
        m = _PAGE_FILE_RE.match(name)
        if m and os.path.isfile(os.path.join(issue_dir, name)):
            pages.append((int(m.group(1)), name))
    pages.sort(key=lambda t: t[0])
    return pages


def _parse_issue_date(text: str, path: str):
    """'YY년 M월' 패턴으로 발행일을 추정. 실패 시 폴더 수정시각으로 대체."""
    m = re.search(r"(\d{2})\s*년[_\s]*(\d{1,2})\s*월", text)
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


def _read_bytes(path: str) -> bytes:
    """파일을 메모리로 읽는다. (회사 DRM 은 '읽기' 시점에 복호화하므로 실제 바이트를 얻는다.)"""
    with open(path, "rb") as fp:
        return fp.read()


@router.get("")
def list_newsletters():
    """공유 폴더의 호(issue) 하위 폴더를 발행일 내림차순으로 나열한다.

    공유 경로에 접근할 수 없거나(권한/미마운트) 폴더가 없으면 빈 목록을 반환한다.
    """
    base = NEWSLETTER_DIR
    if not os.path.isdir(base):
        return []
    items = []
    for name in os.listdir(base):
        issue_dir = os.path.join(base, name)
        if not os.path.isdir(issue_dir):
            continue
        pdf = _find_pdf(issue_dir)
        # PDF 도 PNG 도 없는 폴더는 뉴스레터가 아니므로 건너뜀.
        if not pdf and not _list_page_pngs(issue_dir):
            continue
        stem = os.path.splitext(pdf)[0] if pdf else name
        issue_date = _parse_issue_date(name, issue_dir) or _parse_issue_date(stem, issue_dir)
        items.append({
            "id": name,                              # 호 폴더명 = 식별자
            "title": stem.replace("_", " ").strip(),
            "issue_date": issue_date.isoformat() if issue_date else None,
            "description": None,
            "file_name": pdf or f"{name}.pdf",       # 다운로드 시 표시 파일명
        })
    # 발행일 내림차순(ISO 문자열 = 시간순). 없으면 마지막, 동률은 폴더명 역순.
    items.sort(key=lambda x: (x["issue_date"] or "", x["id"]), reverse=True)
    return items


@router.get("/{issue_id}/pages")
def get_newsletter_page_count(issue_id: str):
    """미리보기 페이지 수. 폴더의 N.png 개수를 우선 사용, 없으면 PDF 페이지 수(폴백)."""
    issue_dir = _safe_issue_dir(issue_id)
    pngs = _list_page_pngs(issue_dir)
    if pngs:
        return {"pageCount": len(pngs)}
    pdf = _find_pdf(issue_dir)
    if not pdf:
        return {"pageCount": 0}
    doc = fitz.open(stream=_read_bytes(os.path.join(issue_dir, pdf)), filetype="pdf")
    try:
        return {"pageCount": doc.page_count}
    finally:
        doc.close()


@router.get("/{issue_id}/page/{page_no}")
def get_newsletter_page_image(issue_id: str, page_no: int):
    """특정 페이지(1-기반) PNG. 폴더의 N.png 를 그대로 서빙, 없으면 PDF 에서 즉석 렌더(폴백)."""
    issue_dir = _safe_issue_dir(issue_id)
    pngs = dict(_list_page_pngs(issue_dir))  # {번호: 파일명}
    if pngs:
        name = pngs.get(page_no)
        if not name:
            raise HTTPException(status_code=404, detail="해당 페이지가 없습니다.")
        # DRM 복호화된 실제 바이트를 메모리로 읽어 Content-Length 정합 보장.
        data = _read_bytes(os.path.join(issue_dir, name))
        return Response(content=data, media_type="image/png")

    # 폴백: PNG 가 없으면 PDF 페이지를 즉석 렌더한다.
    pdf = _find_pdf(issue_dir)
    if not pdf:
        raise HTTPException(status_code=404, detail="미리보기 이미지가 없습니다.")
    pdf_path = os.path.join(issue_dir, pdf)
    key = (pdf_path, os.path.getmtime(pdf_path), page_no)
    png = _PAGE_CACHE.get(key)
    if png is None:
        doc = fitz.open(stream=_read_bytes(pdf_path), filetype="pdf")
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


@router.get("/{issue_id}/file")
def get_newsletter_file(issue_id: str, download: bool = False):
    """호 폴더의 PDF 를 반환한다.

    회사 DRM 이 디스크 파일을 자동 재암호화하므로 stat 크기와 실제 복호화 바이트 수가 어긋난다.
    FileResponse 는 stat 크기를 Content-Length 로 보내 ERR_CONTENT_LENGTH_MISMATCH 를 유발하므로,
    파일을 메모리로 읽어(=DRM 복호화된 실제 바이트) 그 길이를 Content-Length 로 직접 지정해 반환한다.

    - download=false(기본): inline.
    - download=true: attachment(한글 파일명 RFC 5987 인코딩).
    """
    issue_dir = _safe_issue_dir(issue_id)
    pdf = _find_pdf(issue_dir)
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF 파일이 폴더에 없습니다.")
    data = _read_bytes(os.path.join(issue_dir, pdf))
    if download:
        disposition = f"attachment; filename*=UTF-8''{quote(pdf)}"
    else:
        disposition = "inline"
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": disposition})
