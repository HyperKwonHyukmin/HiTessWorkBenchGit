"""어댑터 레지스트리.

program_registry 의 ProgramSpec.report_adapter 값이 이 map 의 키다.
등록되지 않은 키(또는 None)는 generic_adapter 로 떨어진다 — 신규 App 이
아무 등록 없이도 리포트가 나오는 이유다.
"""
from __future__ import annotations

from typing import Callable

from ..models import ReportDoc, ReportMeta
from .generic import generic_adapter
from .truss_assessment import truss_assessment_adapter

Adapter = Callable[[dict, ReportMeta], ReportDoc]

ADAPTERS: dict[str, Adapter] = {
    "truss-assessment": truss_assessment_adapter,
}


def get_adapter(key: str | None) -> Adapter:
    if not key:
        return generic_adapter
    return ADAPTERS.get(key, generic_adapter)
