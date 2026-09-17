"""xlsx 바이트 → PDF 바이트 변환 (Windows + MS Excel COM).

Unit 권상 보고서(`unit_lifting_report`)는 openpyxl 로 **메모리에서** xlsx 를 만들어 그대로
내려준다. PDF 는 그 xlsx 를 Excel 로 열어 인쇄하는 방식이다 — 보고서가 이미
`fitToPage=False + scale=100 + 수동 페이지 나누기`로 인쇄를 확정해 두었기 때문에
Excel 이 그리는 페이지가 곧 설계한 프레임(57행 = 1페이지)과 일치한다.

## 이 파일이 존재하는 이유 — 함정 3가지

1. ⚠ **워크북째 내보내면 안 된다.** 상세 레포트 워크북에는 Report 외에
   `Members`/`Displacements`/`Wires` 데이터 시트가 붙어 있어, `Workbook.ExportAsFixedFormat`
   은 그 시트들까지 인쇄해 21p 짜리가 29p 로 나온다(프레임 바닥글의 "Page n / 21" 과 불일치).
   → 항상 `Worksheets(sheet_name).ExportAsFixedFormat` 로 **Report 시트만** 내보낸다.

2. ⚠ **회사 DRM.** 디스크에 쓴 파일은 at-rest 로 `HHIDRMC` + 4096 byte 로 감싸진다.
   평범한 python 프로세스가 읽으면 **암호문이 그대로 나온다**(PDF 파서가 열지 못함).
   그런데 **Excel COM 인스턴스를 띄운 프로세스**는 DRM 훅이 붙어 `read()` 가 평문을 돌려준다
   (실측: stat 466,080 / read 461,984 = `%PDF-1.7`). 그래서 PDF 되읽기를 **Excel 을 띄운
   이 함수 안에서** 끝내야 한다. 밖으로 경로만 넘기면 호출자가 암호문을 읽는다.
   안전장치로 `%PDF` 매직을 확인하고, 아니면 깨진 파일을 서빙하는 대신 예외를 던진다.

3. ⚠ **Excel 은 동시 실행에 안전하지 않다.** 해석 작업 큐가 동시 5개라 변환이 겹칠 수 있어
   모듈 락으로 직렬화한다. 인스턴스는 호출마다 띄우고 닫는다 — 서버에 상주시키면 대화상자
   하나에 프로세스가 영구히 멈춘다. 기동 비용은 실측 2.6s.

실측 소요(dev PC, Excel 16.0): 결과 레포트 2p ≈ 4s, 상세 레포트 21p ≈ 12s (+ 기동 2.6s).
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading

logger = logging.getLogger(__name__)

# Excel COM 은 동시 호출에 안전하지 않다 — 변환 전체를 직렬화한다.
_EXCEL_LOCK = threading.Lock()

# ExportAsFixedFormat 의 Type 인자. 0 = xlTypePDF.
_XL_TYPE_PDF = 0


class PdfConversionError(RuntimeError):
    """Excel 미설치·COM 실패·DRM 등으로 PDF 변환이 불가능할 때."""


def convert_xlsx_to_pdf(xlsx_bytes: bytes, sheet_name: str = "Report") -> bytes:
    """xlsx 바이트를 PDF 바이트로 변환해 돌려준다.

    :param xlsx_bytes: openpyxl 이 만든 워크북 바이트
    :param sheet_name: 인쇄할 시트. 없으면 워크북 전체를 내보낸다(데이터 시트까지 붙음).
    :raises PdfConversionError: pywin32 부재 · Excel 미설치 · 변환 실패 · DRM 암호문
    """
    if not xlsx_bytes:
        raise PdfConversionError("변환할 xlsx 내용이 비어 있습니다.")

    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:  # Windows 아님 / pywin32 미설치
        raise PdfConversionError(
            "PDF 변환에는 Windows + pywin32 가 필요합니다 (pip install pywin32)."
        ) from exc

    with _EXCEL_LOCK:
        work_dir = tempfile.mkdtemp(prefix="hitess_pdf_")
        src = os.path.join(work_dir, "report.xlsx")
        # ⚠ 확장자는 반드시 .pdf — Excel 은 다른 확장자를 주면 아무 파일도 쓰지 않는다(실측).
        dst = os.path.join(work_dir, "report.pdf")
        with open(src, "wb") as fh:
            fh.write(xlsx_bytes)

        pythoncom.CoInitialize()
        excel = None
        try:
            try:
                excel = win32com.client.DispatchEx("Excel.Application")
            except Exception as exc:
                raise PdfConversionError(
                    f"Excel 을 실행할 수 없습니다 (서버에 MS Excel 설치 필요): {exc}"
                ) from exc

            excel.Visible = False
            excel.DisplayAlerts = False
            excel.AskToUpdateLinks = False
            excel.ScreenUpdating = False

            wb = None
            try:
                # UpdateLinks=0 — 외부 참조 갱신 대화상자로 멈추지 않게.
                wb = excel.Workbooks.Open(src, ReadOnly=True, UpdateLinks=0)
                target = _printable(wb, sheet_name)
                target.ExportAsFixedFormat(_XL_TYPE_PDF, dst)
            except Exception as exc:
                raise PdfConversionError(f"Excel PDF 내보내기 실패: {exc}") from exc
            finally:
                if wb is not None:
                    try:
                        wb.Close(False)
                    except Exception:
                        logger.warning("PDF 변환: 워크북 닫기 실패", exc_info=True)

            if not os.path.isfile(dst):
                raise PdfConversionError("Excel 이 PDF 를 생성하지 않았습니다.")

            # ★ 되읽기는 반드시 여기서 — Excel COM 이 붙은 이 프로세스만 DRM 을 복호화해 읽는다.
            with open(dst, "rb") as fh:
                data = fh.read()
            if not data.startswith(b"%PDF"):
                raise PdfConversionError(
                    "생성된 PDF 를 평문으로 읽지 못했습니다 (DRM 암호문). "
                    "변환 프로세스의 DRM 화이트리스트를 확인하세요."
                )
            return data
        finally:
            if excel is not None:
                try:
                    excel.Quit()
                except Exception:
                    logger.warning("PDF 변환: Excel 종료 실패", exc_info=True)
            pythoncom.CoUninitialize()
            _cleanup(work_dir)


def _printable(wb, sheet_name: str):
    """인쇄 대상 선택 — 지정 시트가 있으면 그 시트만, 없으면 워크북 전체."""
    if sheet_name:
        for ws in wb.Worksheets:
            if ws.Name == sheet_name:
                return ws
        logger.warning("PDF 변환: 시트 '%s' 가 없어 워크북 전체를 내보냅니다.", sheet_name)
    return wb


def _cleanup(work_dir: str) -> None:
    import shutil

    try:
        shutil.rmtree(work_dir, ignore_errors=True)
    except Exception:
        logger.warning("PDF 변환: 임시 폴더 정리 실패 (%s)", work_dir, exc_info=True)
