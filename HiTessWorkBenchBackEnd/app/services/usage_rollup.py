"""사용 통계용 프로그램 합산(roll-up) 규칙.

권상 해석 App(GroupModuleUnit · SidePassage)은 Studio 안에서 여러 세부 검토를 돌리고,
각 검토는 자기 program_name 으로 Analysis 레코드를 따로 남긴다.

    ModuleStability        자세안정성 평가
    ModuleHoistOptimize    권상 위치 최적화
    UnitStructuralAnalysis Unit 구조 해석

레코드는 감사·디버깅용으로 그대로 두고, 통계에서만 **부모 App 한 줄로 합산**하고
세부 검토별 건수는 그 행의 `steps` 로 보여 준다(사용자 요청, 2026-09-30).

⚠ 세부 검토는 GroupModuleUnit 과 SidePassage 양쪽에서 생긴다(Studio 가 보내는 source 는
둘 다 "ModuleUnitStudio" 라 구분에 못 쓴다). 그래서 레코드마다 부모를 찾는다.
  - UnitStructuralAnalysis : input_info.parent_analysis_id → 부모 레코드의 program_name
  - ModuleStability/HoistOptimize : input_info.posture 경로의 작업 폴더명
    (`<yyyyMMdd_HHmmss>_<사번>_<부모 program_name>`, `_intake.make_work_dir` 규약)
부모를 못 찾는 레코드는 자기 이름 그대로 남긴다 — 엉뚱한 App 에 붙이는 것보다 낫다.
"""
from __future__ import annotations

import re
from typing import Iterable, Mapping, Optional

# 합산 대상 부모 App (program_name 원문)
ROLLUP_PARENTS: tuple[str, ...] = ("GroupModuleUnit", "SidePassage")

# 세부 검토 program_name → 화면 표기
SUBSTEP_LABELS: Mapping[str, str] = {
    "ModuleStability": "자세안정성 평가",
    "ModuleHoistOptimize": "권상 위치 최적화",
    "UnitStructuralAnalysis": "Unit 구조 해석",
}
SUBSTEP_PROGRAMS: tuple[str, ...] = tuple(SUBSTEP_LABELS)

# 부모 레코드 자신(Step 1 BDF 입력·검증)의 표기
PARENT_STEP_LABEL = "모델 입력·검증"

# 세부 검토 표시 순서(작업 흐름 순)
_STEP_ORDER = (PARENT_STEP_LABEL, *SUBSTEP_LABELS.values())

_PARENT_FOLDER_RE = re.compile(
    r"\d{8}_\d{6}_[^\\/]+?_(" + "|".join(ROLLUP_PARENTS) + r")(?=[\\/]|$)"
)


def is_substep(program_name: Optional[str]) -> bool:
    return program_name in SUBSTEP_LABELS


def step_label(program_name: Optional[str]) -> Optional[str]:
    """세부 검토 표기. 부모 App 자신은 PARENT_STEP_LABEL, 그 밖의 App 은 None."""
    if program_name in SUBSTEP_LABELS:
        return SUBSTEP_LABELS[program_name]
    if program_name in ROLLUP_PARENTS:
        return PARENT_STEP_LABEL
    return None


def parent_ids_of(records: Iterable) -> set[int]:
    """UnitStructuralAnalysis 레코드들이 가리키는 부모 레코드 id 모음."""
    ids: set[int] = set()
    for r in records:
        if r.program_name != "UnitStructuralAnalysis":
            continue
        raw = (r.input_info or {}).get("parent_analysis_id") if isinstance(r.input_info, dict) else None
        try:
            ids.add(int(raw))
        except (TypeError, ValueError):
            continue
    return ids


def load_parent_programs(db, records: Iterable) -> dict[int, str]:
    """부모 레코드 id → program_name (한 번의 IN 쿼리)."""
    ids = parent_ids_of(records)
    if not ids:
        return {}
    from app import models  # 순환 import 방지
    rows = (
        db.query(models.Analysis.id, models.Analysis.program_name)
        .filter(models.Analysis.id.in_(ids))
        .all()
    )
    return {rid: name for rid, name in rows if name}


def rollup_program(record, parent_programs: Mapping[int, str]) -> str:
    """통계에서 이 레코드를 셀 App 이름."""
    name = record.program_name or "Unknown"
    if name not in SUBSTEP_LABELS:
        return name
    info = record.input_info if isinstance(record.input_info, dict) else {}

    if name == "UnitStructuralAnalysis":
        try:
            parent = parent_programs.get(int(info.get("parent_analysis_id")))
        except (TypeError, ValueError):
            parent = None
        return parent if parent in ROLLUP_PARENTS else name

    match = _PARENT_FOLDER_RE.search(str(info.get("posture") or ""))
    return match.group(1) if match else name


def add_step(steps: dict, program_name: Optional[str], *, success: bool = False, employee_id: str = "") -> None:
    """steps(dict: label → 집계)에 레코드 1건을 더한다. 합산 대상이 아니면 무시."""
    label = step_label(program_name)
    if label is None:
        return
    s = steps.setdefault(label, {"label": label, "program": program_name, "count": 0, "success": 0, "_users": set()})
    s["count"] += 1
    if success:
        s["success"] += 1
    if employee_id:
        s["_users"].add(employee_id)


def serialize_steps(steps: dict, total: Optional[int] = None) -> list[dict]:
    """집계 dict → 작업 흐름 순 리스트. 세부 검토가 하나도 없으면 빈 리스트."""
    if not any(label in SUBSTEP_LABELS.values() for label in steps):
        return []
    out = []
    for label in sorted(steps, key=lambda k: _STEP_ORDER.index(k) if k in _STEP_ORDER else len(_STEP_ORDER)):
        s = steps[label]
        row = {
            "label": s["label"],
            "program": s["program"],
            "count": s["count"],
            "success": s["success"],
            "userCount": len(s["_users"]),
        }
        if total:
            row["share"] = round(s["count"] * 100 / total)
        out.append(row)
    return out
