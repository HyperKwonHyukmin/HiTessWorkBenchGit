"""해석 리포트 생성 엔진.

Analysis 레코드 하나를 표준 XLSX 계산서로 바꾼다. 어댑터(데이터 정규화)와
렌더러(서식)를 분리해, 신규 App 추가 비용이 어댑터 함수 하나가 되게 한다.
"""
from .service import ReportNotAvailable, build_report_xlsx, report_capabilities  # noqa: E402,F401

__all__ = ["ReportNotAvailable", "build_report_xlsx", "report_capabilities"]
