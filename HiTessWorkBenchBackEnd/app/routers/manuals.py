"""Studio 사용 설명서 — WorkBench 화면(GMU 권상 페이지 등)이 보기·PDF 받기에 쓴다.

자료는 git 추적 폴더 `Manuals/<id>/` 에 있다(145 는 git pull 로 받는다):
- manual.json   : 제목·문서 버전·기준 Studio·날짜·PDF 파일 이름
- manual.html   : 그림·글꼴까지 넣은 한 파일 웹판(화면은 iframe srcdoc 으로 띄운다 — 인증 헤더 문제 없음)
- manual.pdf.gz : PDF 를 gzip 한 것. C: 의 PDF 는 회사 DRM 이 감싸 git 이 암호문을 커밋한다. 이름을 바꿔도 DRM 이
                  내용(PDF)을 보고 1분 안에 다시 감싸므로(2026-11-09 실측) 압축해 PDF 모양이 아니게 둔다.
만드는 곳: outputs/manual-tools (make.mjs → publish.py).

⚠ 응답은 read() 한 바이트를 길이 없는 스트림으로 보낸다(DRM 이 다시 감싼 파일이면 stat 크기와 실제 바이트가 달라
  Content-Length 불일치로 받기가 실패한 사례 — viewers.py·/api/download 와 같은 이유).
"""
import gzip
import json
import re
import zlib
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse

from app.dependencies import require_auth

router = APIRouter(prefix="/api/manuals", tags=["manuals"])

MANUALS_DIR = Path(__file__).resolve().parents[2] / "Manuals"
_ID = re.compile(r"^[a-z0-9-]+$")
_PDF_MAGIC = b"%PDF"


def _folder(manual_id: str) -> Path:
    if not _ID.match(manual_id or ""):
        raise HTTPException(status_code=404, detail="설명서가 없습니다.")
    folder = MANUALS_DIR / manual_id
    if not (folder / "manual.json").is_file():
        raise HTTPException(status_code=404, detail="설명서가 없습니다.")
    return folder


def _meta(folder: Path) -> dict:
    try:
        return json.loads((folder / "manual.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"설명서 정보를 읽지 못했습니다: {exc}") from exc


def _read(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=404, detail="설명서 파일이 없습니다.") from exc


@router.get("/{manual_id}")
def manual_info(manual_id: str, _employee_id: str = Depends(require_auth)):
    """제목·문서 버전·기준 Studio·날짜. 화면이 버튼 말풍선과 모달 머리에 쓴다."""
    folder = _folder(manual_id)
    meta = _meta(folder)
    return {**meta, "hasPdf": (folder / "manual.pdf.gz").is_file(), "hasWeb": (folder / "manual.html").is_file()}


@router.get("/{manual_id}/web")
def manual_web(manual_id: str, _employee_id: str = Depends(require_auth)):
    """한 파일 웹판 HTML."""
    body = _read(_folder(manual_id) / "manual.html")
    return Response(content=body, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-cache"})


@router.get("/{manual_id}/pdf")
def manual_pdf(manual_id: str, _employee_id: str = Depends(require_auth)):
    """PDF 받기 — 파일 이름은 manual.json 의 pdfFileName(한글, RFC 5987)."""
    folder = _folder(manual_id)
    try:
        body = gzip.decompress(_read(folder / "manual.pdf.gz"))
    except (OSError, EOFError, zlib.error) as exc:   # gzip 이 아니거나 본문이 깨짐 — DRM 암호문이 커밋된 경우 등
        raise HTTPException(status_code=500, detail="설명서 PDF 가 손상되었습니다(DRM 암호화 상태일 수 있음). 관리자에게 알려 주세요.") from exc
    if not body.startswith(_PDF_MAGIC):
        # DRM 암호문이 커밋된 경우 — 깨진 파일을 내려주지 않는다
        raise HTTPException(status_code=500, detail="설명서 PDF 가 손상되었습니다(DRM 암호화 상태). 관리자에게 알려 주세요.")
    name = _meta(folder).get("pdfFileName") or f"{manual_id}.pdf"
    headers = {"Content-Disposition": f"attachment; filename=\"{manual_id}.pdf\"; filename*=UTF-8''{quote(name, safe='')}"}
    return StreamingResponse(iter([body]), media_type="application/pdf", headers=headers)
