"""Module Unit 권상 보고서 — 패키지 위임 껍데기.

두 종류를 낸다.
  generate_result_report        사내 표준 서식(ver2609) 2~3페이지 — 결과 레포트
  generate_unit_lifting_report  다장 기술보고서 — 상세 레포트

구현은 app/services/unit_lifting_report/ (collector·figures·figures3d·solid3d·sheet·builder·result_report).
"""
from .unit_lifting_report import generate_result_report, generate_unit_lifting_report  # noqa: F401

__all__ = ["generate_result_report", "generate_unit_lifting_report"]
