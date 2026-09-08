"""Unit 권상 구조 검토 보고서 — 공개 진입점.

결과 폴더의 JSON(구조 해석 결과·자세안정성·lifting meta·posture·최적화·검증·편집 모델)만으로
표지·요약·목차·1~6장·부록·데이터 시트를 갖춘 xlsx 를 메모리에서 만든다. Studio 캡처는 쓰지 않는다.
"""
from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any

from .builder import build_workbook
from .collector import ReportOptions, collect
from .figures import render_all_safe
from .result_report import generate_result_report  # noqa: F401  사내 서식 기반 '결과 레포트'

__all__ = ["generate_unit_lifting_report", "generate_result_report", "ReportOptions"]


def generate_unit_lifting_report(
    result_info: dict[str, Any],
    options: dict[str, Any] | None = None,
    *,
    generated_by: str = "",
) -> tuple[str, bytes, list[str], dict[str, Any]]:
    """``(파일명, xlsx 바이트, 경고, 요약)`` 을 돌려준다. 디스크에 쓰지 않는다."""
    opts = ReportOptions.from_payload(options)
    if not opts.author:
        opts.author = generated_by or "-"
    now = datetime.now()
    data = collect(result_info, opts, generated_at=now.strftime("%Y-%m-%d %H:%M"))
    figs, errors = render_all_safe(data)
    for key, why in errors.items():
        data.warnings.append(f"그림 '{key}' 렌더 실패: {why}")
    wb = build_workbook(data, figs, errors)
    buf = io.BytesIO()
    wb.save(buf)

    i = data.identity
    name = (f"{_safe(i.hull_no)}-{_safe(i.unit_no)}_{_safe(i.lifting_method)}_{_safe(i.title_prefix)}"
            f"_권상_구조_검토_보고서_Rev{_safe(i.revision)}_{now:%Y%m%d}.xlsx")
    summary = {
        "totalMassTon": data.model.total_mass_ton,
        "yieldStrengthMPa": data.results.yield_mpa,
        "allowableMPa": data.results.allowable_mpa,
        "maxDisplacementMm": data.results.max_displacement_mm,
        "maxStressMPa": data.results.max_stress_mpa,
        "structure": data.verdicts.structure,
        "stability": data.verdicts.stability,
        "jigRequired": data.verdicts.jig_required,
        "figureCount": len(figs),
        "warningCount": len(data.warnings),
    }
    return name, buf.getvalue(), list(data.warnings), summary


def _safe(v) -> str:
    return re.sub(r'[<>:"/\\|?*\s]+', "_", str(v or "unknown")).strip("_.") or "unknown"
