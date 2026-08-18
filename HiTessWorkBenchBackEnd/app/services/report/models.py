"""리포트 중간표현 — 어댑터와 렌더러가 주고받는 유일한 계약.

program_registry.ProgramSpec 과 같은 frozen dataclass 스타일을 따른다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# 어느 App 의 리포트를 열어도 같은 자리에 같은 정보가 있어야 결재자가 읽는다.
STANDARD_SECTION_ORDER: tuple[str, ...] = (
    "overview",
    "input",
    "result",
    "verdict",
    "provenance",
)


@dataclass(frozen=True, slots=True)
class ReportField:
    label: str
    value: Any
    unit: str | None = None
    note: str | None = None


@dataclass(frozen=True, slots=True)
class ReportTable:
    title: str
    columns: tuple[str, ...]
    rows: tuple[tuple[Any, ...], ...]
    note: str | None = None


@dataclass(frozen=True, slots=True)
class ReportSection:
    key: str
    title: str
    fields: tuple[ReportField, ...] = ()
    tables: tuple[ReportTable, ...] = ()


@dataclass(frozen=True, slots=True)
class ReportMeta:
    program_id: str
    display_name: str
    analysis_id: int | None
    project_name: str | None
    employee_id: str
    created_at: datetime | None
    status: str | None


@dataclass(frozen=True, slots=True)
class ReportDoc:
    meta: ReportMeta
    verdict: str | None
    sections: tuple[ReportSection, ...]
    provenance: dict | None = None
    template_applied: bool = False
    notices: tuple[str, ...] = field(default_factory=tuple)

    def ordered_sections(self) -> tuple[ReportSection, ...]:
        """표준 섹션을 약속된 순서로 앞세우고, 그 외는 원래 순서로 뒤에 붙인다."""
        rank = {key: index for index, key in enumerate(STANDARD_SECTION_ORDER)}
        known = sorted(
            (s for s in self.sections if s.key in rank),
            key=lambda s: rank[s.key],
        )
        unknown = [s for s in self.sections if s.key not in rank]
        return (*known, *unknown)
