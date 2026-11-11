"""치공구표준집 찾기 — 색인·도면집 PDF·쪽 썸네일·한 쪽 잘라 내기.

계획: docs/plans/2026-11-11-drawing-catalogue-search.md (1단계).
- 색인 `DrawingBook/book_index.json` (git 추적, scripts/drawing_book_index.py 가 만든다)
- 도면집 PDF(색인 book.sha256 과 같은 판이어야 함) `InHouseProgram/DrawingToAnalysis/PdfCatalogue/Book/ToolStandard_2018_FINAL.pdf` (git 미추적, 서버 수동 복사)
  회사 DRM 이 감싼 파일이면 `%PDF` 머리가 아니다 → 원인을 말하는 오류로 실패한다(깨진 그림·빈 변환 대신).
- 썸네일은 파일로 두지 않고 그때 그려 메모리에 둔다(쪽 155 × 두 크기, 작다).
"""
from __future__ import annotations

import json
import os
import threading
from collections import OrderedDict
from typing import Optional

from .analysis_runner import get_backend_dir

BOOK_FILENAME = "ToolStandard_2018_FINAL.pdf"
THUMB_SIZES = {"small": 0.55, "large": 1.6}   # 배율(72dpi 기준) — small ≈ 330×460px, large ≈ 950×1350px
_THUMB_CACHE_MAX = 400

_lock = threading.Lock()
# PyMuPDF 는 여러 스레드에서 동시에 쓰는 것을 보장하지 않는다(문서) — 렌더·잘라 내기를 한 줄로 세운다
_fitz_lock = threading.Lock()
_index_cache: dict = {}
_pdf_cache: dict = {}
_thumb_cache: "OrderedDict[tuple, bytes]" = OrderedDict()


class BookUnavailable(RuntimeError):
    """도면집 PDF 가 없거나 읽을 수 없음 (사용자에게 보일 문구)."""


def index_path() -> str:
    return os.path.join(get_backend_dir(), "DrawingBook", "book_index.json")


def book_path() -> str:
    return os.path.join(get_backend_dir(), "InHouseProgram", "DrawingToAnalysis", "PdfCatalogue", "Book", BOOK_FILENAME)


def load_index() -> dict:
    """색인 — 파일 수정 시각이 바뀌면 다시 읽는다(git pull 로 갱신되면 재시작 없이 반영)."""
    p = index_path()
    mtime = os.path.getmtime(p)
    with _lock:
        if _index_cache.get("mtime") != mtime:
            with open(p, "r", encoding="utf-8") as fh:
                _index_cache.update(mtime=mtime, data=json.load(fh))
        return _index_cache["data"]


def find_item(pdf_page: int) -> Optional[dict]:
    return next((i for i in load_index()["items"] if i["pdfPage"] == pdf_page), None)


def book_status() -> dict:
    """화면 안내용 — 도면집 파일이 있고 평문인가, 색인과 같은 판인가."""
    p = book_path()
    if not os.path.isfile(p):
        return {"available": False, "reason": "서버에 치공구표준집 PDF 가 없습니다. 관리자에게 알려 주세요."}
    try:
        _book_bytes()
    except BookUnavailable as e:
        return {"available": False, "reason": str(e)}
    return {"available": True, "reason": None}


def book_bytes_problem(raw: bytes) -> Optional[str]:
    """읽은 바이트가 쓸 수 있는 PDF 인가 — 아니면 사용자 문구. (개발 PC 는 DRM 에이전트가 감싼 파일을 0바이트로 돌려주기도 한다)"""
    if raw.startswith(b"%PDF"):
        return None
    if not raw:
        why = "을 읽지 못했습니다(비어 있음 — 회사 DRM 이 막았을 수 있습니다)"
    elif raw.startswith(b"HHIDRMC") or b"DRM" in raw[:64]:
        why = "이 회사 DRM 에 감싸져 있습니다"
    else:
        why = "이 PDF 가 아닙니다"
    return f"서버의 치공구표준집 파일{why}. 평문 사본으로 바꿔 주세요(관리자)."


def edition_problem(raw: bytes) -> Optional[str]:
    """서버 도면집이 색인을 만든 판과 같은가 — 다르면 쪽 번호가 어긋나 엉뚱한 도면을 변환한다."""
    import hashlib

    want = (load_index().get("book") or {}).get("sha256")
    if want and hashlib.sha256(raw).hexdigest() != want:
        return ("서버의 치공구표준집 파일이 색인을 만든 판과 다릅니다(쪽 번호가 어긋날 수 있음). "
                "관리자가 색인을 다시 만들거나 같은 판으로 바꿔 주세요.")
    return None


def _book_bytes() -> bytes:
    p = book_path()
    if not os.path.isfile(p):
        raise BookUnavailable("서버에 치공구표준집 PDF 가 없습니다. 관리자에게 알려 주세요.")
    mtime = os.path.getmtime(p)
    with _lock:
        if _pdf_cache.get("mtime") == mtime:
            return _pdf_cache["data"]
    with open(p, "rb") as fh:   # read() 바이트 기준(DRM 이 stat 크기를 바꾸는 함정)
        raw = fh.read()
    problem = book_bytes_problem(raw)
    if problem:
        raise BookUnavailable(problem)
    problem = edition_problem(raw)
    if problem:
        raise BookUnavailable(problem)
    with _lock:
        _pdf_cache.update(mtime=mtime, data=raw)
    return raw


def _open_doc():
    import fitz  # PyMuPDF
    return fitz.open(stream=_book_bytes(), filetype="pdf")


def render_thumb(pdf_page: int, size: str = "small") -> bytes:
    """쪽 PNG. size = small(목록) | large(미리보기)."""
    if size not in THUMB_SIZES:
        raise ValueError(f"size 는 {', '.join(THUMB_SIZES)} 중 하나")
    _book_bytes()   # 먼저 읽어 mtime 을 확정한다(재읽기 전 값으로 캐시 키를 만들지 않게)
    key = (pdf_page, size, _pdf_cache.get("mtime"))
    with _lock:
        if key in _thumb_cache:
            _thumb_cache.move_to_end(key)
            return _thumb_cache[key]
    import fitz
    with _fitz_lock, _open_doc() as doc:
        if not 1 <= pdf_page <= doc.page_count:
            raise ValueError(f"쪽 번호 범위 밖: {pdf_page}")
        z = THUMB_SIZES[size]
        page = doc.load_page(pdf_page - 1)
        clip = None
        if size == "small":
            # 목록 카드는 머리(품명·기호) + 도면 영역만 — 아래 절반(BOM·표제란)은 모든 쪽이 같아 구별에 도움이 안 된다
            r = page.rect
            clip = fitz.Rect(r.x0, r.y0 + r.height * 0.02, r.x1, r.y0 + r.height * 0.54)
        png = page.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False, colorspace=fitz.csRGB,
                              clip=clip).tobytes("png")
    with _lock:
        _thumb_cache[key] = png
        while len(_thumb_cache) > _THUMB_CACHE_MAX:
            _thumb_cache.popitem(last=False)
    return png


def extract_page_pdf(pdf_page: int, dst_path: str) -> None:
    """도면집에서 한 쪽만 잘라 새 PDF 로 쓴다 — 작업 폴더에 '무엇을 변환했나' 를 남기고 엔진은 1쪽짜리를 읽는다."""
    import fitz
    with _fitz_lock, _open_doc() as doc:
        if not 1 <= pdf_page <= doc.page_count:
            raise ValueError(f"쪽 번호 범위 밖: {pdf_page}")
        one = fitz.open()
        one.insert_pdf(doc, from_page=pdf_page - 1, to_page=pdf_page - 1)
        data = one.tobytes(garbage=3, deflate=True)
        one.close()
    with open(dst_path, "wb") as fh:
        fh.write(data)


# 옛 support 엔진이 실제로 맞는 도면 — 이 엔진은 도면을 읽지 않고 SU-145 값으로 모델을 만든다
# (2026-11-11 실측: SU-A1 도면을 넣어도 '성공' + SU-145 와 같은 파이프 267·길이 1276 → 조용히 틀린 모델)
SUPPORT_ENGINE_CODES = {"SU-145"}


def _name_key(s: str) -> str:
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


def support_engine_allowed_for_name(name: str) -> bool:
    """올린 파일·카탈로그 이름이 옛 support 엔진에 맞는 도면(SU-145)인가 — 'SU-145'·'SU_145'·'su145' 모두 같다.

    이름에 'support' 만 있는 다른 도면을 옛 엔진에 넣으면 SU-145 모델이 조용히 나오므로(2026-11-11 실측),
    support 경로는 이 규칙을 통과한 이름만 탄다. 프론트 `utils/drawingMode.js` 가 같은 규칙의 사본이다.
    """
    import re

    key = _name_key(name)
    return any(re.search(re.escape(_name_key(code)) + r"(?!\d)", key) for code in SUPPORT_ENGINE_CODES)


def engine_mode_for(item: dict) -> str:
    """변환 엔진 모드 — SU-145 만 옛 support 경로, 나머지는 새 러그 엔진(모르는 도면이면 '지원 안 함' 으로 정직하게 끝난다)."""
    return "support" if (item.get("aliases") or [""])[0] in SUPPORT_ENGINE_CODES else "lug"


def safe_stem(item: dict) -> str:
    """작업 폴더에 남길 파일 이름 — 'Book_b022_L-25'. 파일 이름에 'support' 가 들어가면 옛 화면이 모드를 바꾸므로 넣지 않는다."""
    code = (item.get("aliases") or ["page"])[0]
    code = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in code)
    return f"Book_b{item['bookPage']:03d}_{code}"
