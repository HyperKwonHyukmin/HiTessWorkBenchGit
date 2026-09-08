# Module Unit 권상 구조 검토 보고서 전면 재구성 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unit 권상 구조 해석 결과 폴더의 JSON 7종만으로 표지·요약·목차·6장·부록·데이터 시트를 갖춘 한국어 기술보고서(xlsx)를 백엔드가 생성하고, Studio 와 WorkBench 페이지 양쪽에서 입력 모달을 거쳐 내려받게 한다.

**Architecture:** `app/services/unit_lifting_report/` 패키지 4모듈 — `collector`(JSON→dataclass), `figures`(matplotlib→PNG bytes), `sheet`(openpyxl 레이아웃 프리미티브·두 패스 목차), `builder`(장 조립). 기존 `unit_lifting_report_service.py` 는 패키지 위임 껍데기. 라우트는 `captures` 를 버리고 `options` 만 받는다. Studio 의 캡처 코드는 삭제한다.

**Tech Stack:** Python 3.14 / FastAPI / openpyxl 3.1.5 / matplotlib 3.10.7(신규 의존성) / Pillow 12 / pytest — React 18 (Studio: Zustand, lucide-react; WorkBench: axios, Tailwind) — Electron IPC.

**Spec:** `docs/superpowers/specs/2026-09-07-unit-lifting-report-redesign-design.md`

**규칙(사용자 지시):** 커밋은 사용자가 직접 한다 — 각 Task 의 Commit 단계는 **"커밋 준비 완료(사용자에게 파일 목록 보고)"** 로 대체한다. Studio zip 배포·핀 수정은 사용자 허락 후에만.

**실측 데이터(fixture 원본):** `HiTessWorkBenchBackEnd/userConnection/20260907_145643_A476854_GroupModuleUnit/`, stem = `3496-35210-A508372_20260108_edit`. 절점 2,555 · 요소 2,502(CBEAM) · RBE2 203 · 집중질량 40 · 그룹 3 · 와이어 7 · SF 1.2 · 중량 6.7399 t · 최대응력 145.7619 MPa @3857 · 최대변위 23.5248 mm @219.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `HiTessWorkBenchBackEnd/app/services/unit_lifting_report/__init__.py` | `generate_unit_lifting_report(result_info, options, generated_by)` 공개 진입점 |
| `.../unit_lifting_report/collector.py` | 결과 폴더 JSON → `ReportData` dataclass. 형제 파일 탐색, 판정 계산 |
| `.../unit_lifting_report/figures.py` | 투영·렌더. `render_all(data) -> dict[str, bytes]` |
| `.../unit_lifting_report/sheet.py` | `ReportSheet` — 표지/목차/장/절/문단/표/그림/쪽 추정 |
| `.../unit_lifting_report/builder.py` | `build_workbook(data, figures) -> Workbook` (두 패스) + 데이터 시트 |
| `HiTessWorkBenchBackEnd/app/services/unit_lifting_report_service.py` | 패키지 위임 껍데기(라우터 import 경로 보존) |
| `HiTessWorkBenchBackEnd/app/routers/analysis.py` | `/unit-structural/report` 계약 변경, `/groupmoduleunit/artifacts/{id}` 에 `unitStructuralAnalysisId` 추가 |
| `HiTessWorkBenchBackEnd/app/templates/hd_logo.png` | 표지 로고(기존 서식에서 1회 추출) |
| `HiTessWorkBenchBackEnd/tests/fixtures/unit_lifting_report/` | 축소 실측 fixture(JSON 7종 + 원본 json) |
| `HiTessWorkBenchBackEnd/tests/test_unit_lifting_report_{collector,figures,sheet,builder,service}.py` | 단위/통합 테스트 |
| `HiTessWorkBench/frontend/src/api/analysis.js` | `downloadUnitLiftingReport()` |
| `HiTessWorkBench/frontend/src/components/analysis/UnitLiftingReportDialog.jsx` | 입력 모달(WorkBench) |
| `HiTessWorkBench/frontend/src/components/analysis/ResultArtifactsCard.jsx` | "검토 보고서" 버튼 |
| `HiTessWorkBench/electron/index.js` | IPC 핸들러 `captures` 검증 제거 |
| `ModuleUnitStudio/apps/module-unit-studio/src/components/UnitStructuralReportDialog.jsx` | 입력 모달(Studio) |
| `ModuleUnitStudio/.../components/UnitStructuralReportButton.jsx` | 모달 연결, 캡처 제거 |
| `ModuleUnitStudio/.../{ThreeViewport,ViewportContainer}.jsx`, `store/useUnitStructuralStore.js`, `three/LiftingArrangementReport.js`, `three/DisplacementResultOverlay.js` | 캡처 경로 삭제 |

---

### Task 1: 의존성·로고·fixture 준비

**Files:**
- Modify: `HiTessWorkBenchBackEnd/requirements.txt:12-17`
- Create: `HiTessWorkBenchBackEnd/app/templates/hd_logo.png`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/unit_lifting_report/build_fixture.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/unit_lifting_report/<stem>_*.json` (스크립트 산출)

- [ ] **Step 1: requirements.txt 에 matplotlib 추가**

`numpy==2.4.3` 다음 줄에 추가하고, 14~17행의 "matplotlib 제외" 주석을 아래로 교체:

```text
matplotlib==3.10.7
# matplotlib 은 Unit 권상 검토 보고서(app/services/unit_lifting_report/figures.py)가 in-process 로
# 그림을 렌더하므로 서버 venv 에도 필요하다. (DoublePipe PDF 는 여전히 exe 번들 matplotlib 사용.)
```

- [ ] **Step 2: 로고 추출 (1회)**

```bash
cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -c "
import io
from openpyxl import load_workbook
data = open('app/templates/unit_lifting_report_template.bin', 'rb').read()
ws = load_workbook(io.BytesIO(data))['Report']
png = ws._images[2]._data()          # row=2 의 표지 로고 (218x36)
assert png[:4] == b'\x89PNG'
open('app/templates/hd_logo.png', 'wb').write(png)
print('logo', len(png), 'bytes')
"
```
Expected: `logo 5115 bytes`. `git check-ignore app/templates/hd_logo.png` 가 아무것도 출력하지 않아야 함(.png 는 ignore 대상 아님).

- [ ] **Step 3: fixture 빌더 작성**

`HiTessWorkBenchBackEnd/tests/fixtures/unit_lifting_report/build_fixture.py`:

```python
"""실측 결과 폴더를 테스트용으로 축소 복사한다. (1회 실행, 산출 JSON 을 커밋)

python tests/fixtures/unit_lifting_report/build_fixture.py <결과폴더> <stem>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP_MEMBERS, KEEP_DISP, KEEP_ELEMENTS = 60, 80, 300


def _load(folder, name):
    with open(os.path.join(folder, name), encoding="utf-8") as fh:
        return json.load(fh)


def _dump(name, obj):
    with open(os.path.join(HERE, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)


def _relativize(obj):
    """절대 경로 문자열을 basename 으로 바꾼다(fixture 는 폴더 위치와 무관해야 한다)."""
    if isinstance(obj, dict):
        return {k: _relativize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_relativize(v) for v in obj]
    if isinstance(obj, str) and ("\\userConnection\\" in obj or "/userConnection/" in obj):
        return os.path.basename(obj.replace("\\", "/"))
    return obj


def main(folder, stem):
    result = _load(folder, f"{stem}_lifting_nastranResult.json")
    edited = _load(folder, f"{stem}_edited.json")
    original = _load(folder, f"{stem}.json")

    members = sorted(result["members"], key=lambda m: -(m.get("utilization") or 0))[:KEEP_MEMBERS]
    keep_elem = {m["elementId"] for m in members}
    lug_nodes = {w["lugNodeId"] for w in result["wires"]}
    for el in edited["elements"]:
        if len(keep_elem) >= KEEP_ELEMENTS:
            break
        if el["startNode"] in lug_nodes or el["endNode"] in lug_nodes:
            keep_elem.add(el["id"])
    for el in edited["elements"]:
        if len(keep_elem) >= KEEP_ELEMENTS:
            break
        keep_elem.add(el["id"])
    elements = [el for el in edited["elements"] if el["id"] in keep_elem]
    keep_nodes = {n for el in elements for n in (el["startNode"], el["endNode"])} | lug_nodes
    nodes = [n for n in edited["nodes"] if n["id"] in keep_nodes]
    disp = sorted(result["displacements"], key=lambda d: -d["magnitude"])
    disp = [d for d in disp if d["nodeId"] in keep_nodes][:KEEP_DISP]

    result["members"] = members
    result["displacements"] = disp
    edited["elements"] = elements
    edited["nodes"] = nodes
    edited["rigids"] = [r for r in edited["rigids"] if r["independentNode"] in keep_nodes][:20]
    edited["pointMasses"] = [p for p in edited["pointMasses"] if p["nodeId"] in keep_nodes]
    # 원본은 편집 비교용: 축소본 요소 + '삭제됐다고 가정할' 요소 3개를 더 넣어 차이를 만든다.
    orig_extra = [el for el in original["elements"] if el["id"] not in keep_elem][:3]
    original["elements"] = elements + orig_extra
    original["nodes"] = nodes
    original["rigids"] = edited["rigids"] + [r for r in original["rigids"] if r["independentNode"] in keep_nodes][20:22]
    original["pointMasses"] = edited["pointMasses"]

    _dump(f"{stem}_lifting_nastranResult.json", _relativize(result))
    _dump(f"{stem}_edited.json", _relativize(edited))
    _dump(f"{stem}.json", _relativize(original))
    for name in ("_stability.json", "_lifting_meta.json", "_posture.json",
                 "_hoist_optimization.json", "_validation_step1.json"):
        _dump(f"{stem}{name}", _relativize(_load(folder, f"{stem}{name}")))
    print("fixture written:", HERE)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

- [ ] **Step 4: fixture 생성**

```bash
cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe tests/fixtures/unit_lifting_report/build_fixture.py \
  userConnection/20260907_145643_A476854_GroupModuleUnit 3496-35210-A508372_20260108_edit
ls -la tests/fixtures/unit_lifting_report/
```
Expected: JSON 8개(`*_lifting_nastranResult, *_edited, *.json, *_stability, *_lifting_meta, *_posture, *_hoist_optimization, *_validation_step1`), 각 500KB 미만.

- [ ] **Step 5: 커밋 준비 보고** — `requirements.txt`, `app/templates/hd_logo.png`, `tests/fixtures/unit_lifting_report/*`

---

### Task 2: collector — JSON → ReportData

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/unit_lifting_report/__init__.py` (빈 파일로 시작)
- Create: `HiTessWorkBenchBackEnd/app/services/unit_lifting_report/collector.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_unit_lifting_report_collector.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
"""collector — 실측 축소 fixture 로 데이터 모델 검증."""
import os
import pytest

from app.services.unit_lifting_report.collector import collect, ReportOptions

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"


def _result_info():
    return {
        "nastranResultJson": os.path.join(FIX, f"{STEM}_lifting_nastranResult.json"),
        "stabilityJson": os.path.join(FIX, f"{STEM}_stability.json"),
        "liftingMetaJson": os.path.join(FIX, f"{STEM}_lifting_meta.json"),
        "bdf": os.path.join(FIX, f"{STEM}.bdf"),
    }


@pytest.fixture()
def data():
    return collect(_result_info(), ReportOptions(author="A476854"))


def test_identity_from_filename_and_mode(data):
    assert data.identity.hull_no == "3496"
    assert data.identity.unit_no == "35210"
    assert data.identity.lifting_method == "Hydro Crane"
    assert data.identity.group_count == 3
    assert data.identity.wire_length_m == 8


def test_model_and_geometry(data):
    assert data.model.total_mass_ton == pytest.approx(6.73985, abs=1e-4)
    assert data.model.node_count == 2555            # validation 카드 수(원본 규모)
    assert len(data.geometry.nodes) > 0
    assert any(s.kind == "L" for s in data.model.sections)


def test_edit_history_detects_deleted_elements(data):
    assert data.edits is not None
    assert data.edits.deleted_element_count == 3    # build_fixture 가 원본에 3개 더 넣음
    assert data.edits.deleted_rigid_count == 2
    assert data.edits.support_beams == []
    assert data.edits.removed_spc_cards == 0


def test_hoist_and_stability(data):
    assert data.hoist.auto_selected is True
    assert data.hoist.evaluated_count == 21352
    assert [g.group_id for g in data.hoist.groups] == [1, 2, 3]
    rows = data.stability.stage_rows
    assert [r.stage for r in rows] == [0, 1, 2, 3, 4, 5, 6, 7]
    assert rows[5].status == "warn"
    assert "6" in rows[5].key_metric          # conflictCount 6
    assert data.stability.overall_status == "warn"
    assert data.stability.tipping.evaluation_mode == "ConvexPolygon"
    assert data.stability.tipping.margin_mm == pytest.approx(159.24)
    assert data.stability.min_sling_angle_deg == pytest.approx(65.54)


def test_loads(data):
    assert data.loads.safety_factor == pytest.approx(1.2)
    assert data.loads.total_load_ton == pytest.approx(6.73985 * 1.2, abs=1e-3)
    assert data.loads.anchor_node_id == 2874
    assert data.loads.wire_area_mm2 == pytest.approx(1257.0)


def test_results_and_verdicts(data):
    r = data.results
    assert r.max_stress_mpa == pytest.approx(145.7619)
    assert r.max_stress_element_id == 3857
    assert r.max_displacement_mm == pytest.approx(23.5248, abs=1e-3)
    assert r.exceeding == []
    assert len(r.governing) == 30
    assert r.governing[0].element_id == 3857
    assert r.governing[0].section_label.startswith("PBEAML")
    assert len(r.wires) == 7
    w = next(x for x in r.wires if x.lug_node_id == 34)
    assert w.tension_ton == pytest.approx(10198.65 / 9800, abs=1e-3)
    assert w.angle_deg == pytest.approx(77.91)
    assert w.needs_jig is False
    assert len(r.hook_totals) == 3
    assert r.hook_check_error_pct == pytest.approx(
        (sum(h.vertical_ton for h in r.hook_totals) / data.loads.total_load_ton - 1) * 100, abs=1e-6)
    assert data.verdicts.structure == "OK"
    assert data.verdicts.stability == "warn"
    assert data.verdicts.jig_required is False


def test_missing_optional_json_yields_none_and_warning(tmp_path):
    import shutil
    for name in ("_lifting_nastranResult.json", "_stability.json", "_lifting_meta.json", "_edited.json"):
        shutil.copy(os.path.join(FIX, f"{STEM}{name}"), tmp_path / f"{STEM}{name}")
    info = {
        "nastranResultJson": str(tmp_path / f"{STEM}_lifting_nastranResult.json"),
        "stabilityJson": str(tmp_path / f"{STEM}_stability.json"),
        "liftingMetaJson": str(tmp_path / f"{STEM}_lifting_meta.json"),
        "bdf": str(tmp_path / f"{STEM}.bdf"),
    }
    d = collect(info, ReportOptions())
    assert d.hoist is None
    assert d.edits is None
    assert any("hoist_optimization" in w for w in d.warnings)
```

- [ ] **Step 2: 실패 확인**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_lifting_report_collector.py -q --noconftest`
Expected: `ModuleNotFoundError: No module named 'app.services.unit_lifting_report'`

- [ ] **Step 3: collector.py 구현**

`app/services/unit_lifting_report/__init__.py` 는 우선 빈 파일. `collector.py`:

```python
"""Unit 권상 검토 보고서 — 결과 폴더 JSON 을 보고서 데이터 모델로 조립한다.

필수: nastranResult · stability. 나머지(lifting_meta·posture·hoist_optimization·validation·
edited·원본 json·f06)는 없으면 None 으로 두고 warnings 에 남긴다(과거 결과도 보고서가 나오게).
"""
from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from ..hitess_modelflow_service import scan_f06_diagnostics

TON_FORCE_N = 9800.0
GOVERNING_TOP_N = 30
DISPLACEMENT_TOP_N = 10
LIFTING_MODE_LABELS = {"hydro": "Hydro Crane", "goliat": "Goliat Crane", "goliath": "Goliat Crane", "ceiling": "Ceiling Crane"}
STAGE_LABELS = {
    0: "입력 검증·파싱", 1: "권상 형상 분류", 2: "형상 유효성", 3: "정점 좌표 산출",
    4: "슬링 각도", 5: "와이어-구조 간섭", 6: "자세 안정성(전도)", 7: "리깅 하중(SWL)",
}


# ── 옵션 ─────────────────────────────────────────────────────────────────────
@dataclass
class ReportOptions:
    hull_no: str = ""
    unit_no: str = ""
    drawing_no: str = ""
    revision: str = "0"
    author: str = ""
    department: str = ""
    jig_limit_ton: float = 6.2
    yield_strength_mpa: float = 275.0
    notes: str = ""

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "ReportOptions":
        p = payload or {}
        def num(key, default):
            try:
                v = float(p.get(key, default))
                return v if math.isfinite(v) and v > 0 else default
            except (TypeError, ValueError):
                return default
        return cls(
            hull_no=str(p.get("hullNo") or "").strip(), unit_no=str(p.get("unitNo") or "").strip(),
            drawing_no=str(p.get("drawingNo") or "").strip(), revision=str(p.get("revision") or "0").strip(),
            author=str(p.get("author") or "").strip(), department=str(p.get("department") or "").strip(),
            jig_limit_ton=num("jigLimitTon", 6.2), yield_strength_mpa=num("yieldStrengthMpa", 275.0),
            notes=str(p.get("notes") or "").strip(),
        )


# ── 데이터 모델 ───────────────────────────────────────────────────────────────
@dataclass
class Identity:
    title_prefix: str; hull_no: str; unit_no: str; drawing_no: str; revision: str
    author: str; department: str; lifting_method: str; equipment: str
    group_count: int; wire_length_m: float; source_bdf: str; edited_model: str
    generated_at: str; engine_version: str; notes: str

@dataclass
class Section:
    pid: int; card: str; kind: str; dims: list[float]; material_id: int; area_mm2: Optional[float]; label: str

@dataclass
class Material:
    mid: int; name: str; e_mpa: float; nu: float; rho: float

@dataclass
class ModelInfo:
    node_count: int; element_count: int; rigid_count: int; point_mass_count: int
    property_count: int; material_count: int
    bbox: dict[str, float]; size_mm: tuple[float, float, float]
    total_mass_ton: float; cog_mm: dict[str, float]; mass_source: str
    sections: list[Section]; materials: list[Material]; point_masses: list[dict]
    validation_status: Optional[str]; free_end_nodes: Optional[int]; disconnected_groups: Optional[int]

@dataclass
class SupportBeam:
    element_id: int; start_node: int; end_node: int; pid: int; length_mm: float; dims: list[float]

@dataclass
class EditInfo:
    deleted_element_count: int; deleted_rigid_count: int; deleted_node_count: int
    support_beams: list[SupportBeam]; removed_spc_cards: int; removed_suport_cards: int
    trace: list[dict]

@dataclass
class HoistGroup:
    group_id: int; node_ids: list[int]; nodes: list[dict]; centroid_mm: dict[str, float]

@dataclass
class HoistInfo:
    groups: list[HoistGroup]; auto_selected: bool; candidate_count: int; evaluated_count: int
    pass_count: int; warn_count: int; fail_count: int; elapsed_ms: int
    best_label: str; best_score: float; best_metrics: dict; current_metrics: dict

@dataclass
class StageRow:
    stage: int; label: str; status: str; key_metric: str; note: str

@dataclass
class WireGeom:
    group_id: int; lug_node_id: int; length_mm: float; angle_deg: float; safe: bool; status: str
    start_mm: dict; end_mm: dict

@dataclass
class Tipping:
    evaluation_mode: str; is_stable: bool; margin_mm: float; interior_margin_mm: float
    deviation_mm: float; threshold_mm: float; cog_inside: bool; tilt_deg: float; apex_to_cog_mm: float

@dataclass
class StabilityInfo:
    overall_status: str; overall_label: str; primary_message: str
    stage_rows: list[StageRow]; apexes: list[dict]; wires: list[WireGeom]
    min_sling_angle_deg: Optional[float]; interference_count: int; min_clearance_mm: Optional[float]
    tipping: Optional[Tipping]; strict_evaluation: bool; shape_gate_relaxed: bool
    warnings: list[dict]; critical: list[dict]

@dataclass
class LoadInfo:
    safety_factor: float; gravity_mm_s2: float; total_load_ton: float
    wire_pid: int; wire_mid: int; wire_area_mm2: float; wire_j_mm4: float; wire_e_mpa: float
    wire_pid_remapped: bool; wire_mid_remapped: bool
    spc_sid: int; spc_components: str; anchor_node_id: Optional[int]; anchor_components: str
    anchor_distance_mm: Optional[float]; stabilization_cards: list[str]; stabilization_reason: str
    grav_sid: int; load_sid: int; subcase_id: int
    f06: dict; solver: str

@dataclass
class MemberRow:
    element_id: int; pid: Optional[int]; section_label: str; stress_mpa: float; utilization: Optional[float]; exceeds: bool

@dataclass
class PidSummary:
    pid: int; section_label: str; count: int; max_stress_mpa: float; max_utilization: float; governing_element_id: int

@dataclass
class DispRow:
    node_id: int; t1: float; t2: float; t3: float; magnitude: float

@dataclass
class WireRow:
    wire_element_id: int; group_id: int; lug_node_id: int; axial_force_n: float; tension_ton: float
    angle_deg: Optional[float]; vertical_ton: Optional[float]; needs_jig: bool; is_compression: bool; is_slack: bool

@dataclass
class HookTotal:
    group_id: int; wire_count: int; tension_ton: float; vertical_ton: float

@dataclass
class ResultInfo:
    allowable_mpa: float; yield_mpa: float
    max_stress_mpa: float; max_stress_element_id: Optional[int]; member_count: int; exceed_count: int
    max_displacement_mm: float; max_displacement_node_id: Optional[int]; max_displacement_components: tuple
    governing: list[MemberRow]; exceeding: list[MemberRow]; all_members: list[MemberRow]
    pid_summary: list[PidSummary]; utilization_bins: list[tuple[float, float, int]]
    top_displacements: list[DispRow]; all_displacements: list[DispRow]
    wires: list[WireRow]; hook_totals: list[HookTotal]; hook_check_error_pct: Optional[float]
    wire_compression_count: int; wire_missing_count: int

@dataclass
class Verdicts:
    structure: str; stability: str; jig_required: bool; actions: list[str]

@dataclass
class Geometry:
    nodes: dict[int, tuple[float, float, float]]
    elements: list[tuple[int, int, int, Optional[int], str]]  # (id, n1, n2, pid, remark)
    center: tuple[float, float, float]

@dataclass
class ReportData:
    identity: Identity; model: ModelInfo; edits: Optional[EditInfo]; hoist: Optional[HoistInfo]
    stability: StabilityInfo; loads: LoadInfo; results: ResultInfo; verdicts: Verdicts
    geometry: Optional[Geometry]; options: ReportOptions; warnings: list[str] = field(default_factory=list)


# ── 진입점 ────────────────────────────────────────────────────────────────────
def collect(result_info: dict[str, Any], options: ReportOptions, generated_at: str = "") -> ReportData:
    warnings: list[str] = []
    result_path = _require(result_info.get("nastranResultJson"), "구조 해석 결과(nastranResultJson)")
    stability_path = _require(result_info.get("stabilityJson"), "자세안정성 결과(stabilityJson)")
    folder = os.path.dirname(result_path)
    stem = _stem_of(result_path)

    result = _load_json(result_path)
    stability = _load_json(stability_path)
    lifting_meta = _optional(result_info.get("liftingMetaJson") or _sib(folder, stem, "_lifting_meta.json"), "lifting_meta", warnings)
    posture = _optional(_sib(folder, stem, "_posture.json"), "posture", warnings)
    hoist_opt = _optional(_sib(folder, stem, "_hoist_optimization.json"), "hoist_optimization", warnings)
    validation = _optional(_sib(folder, stem, "_validation_step1.json"), "validation_step1", warnings)
    edited = _optional(_sib(folder, stem, "_edited.json"), "edited 모델", warnings)
    original = _optional(_sib(folder, stem, ".json"), "원본 모델 json", warnings, quiet=True)
    model_json = edited or original

    geometry = _geometry(model_json) if model_json else None
    identity = _identity(options, result_info, stability, posture, lifting_meta, generated_at)
    model = _model(model_json, stability, posture, validation)
    edits = _edits(original, edited, lifting_meta) if (edited and original) else None
    hoist = _hoist(posture, hoist_opt, stability) if hoist_opt else None
    stab = _stability(stability, posture)
    loads = _loads(lifting_meta, result, stability, folder, stem)
    results = _results(result, stability, options, geometry, model)
    verdicts = _verdicts(results, stab, options)
    return ReportData(identity, model, edits, hoist, stab, loads, results, verdicts, geometry, options, warnings)


# ── 파일 탐색 ─────────────────────────────────────────────────────────────────
def _require(path, label):
    if not path or not os.path.isfile(path):
        raise FileNotFoundError(f"{label} 파일을 찾을 수 없습니다: {path}")
    return os.path.abspath(path)

def _stem_of(result_path: str) -> str:
    name = os.path.basename(result_path)
    for suffix in ("_lifting_nastranResult.json", "_nastranResult.json", ".json"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return os.path.splitext(name)[0]

def _sib(folder: str, stem: str, suffix: str) -> str:
    return os.path.join(folder, f"{stem}{suffix}")

def _load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)

def _optional(path, label, warnings, quiet=False):
    if path and os.path.isfile(path):
        try:
            return _load_json(path)
        except Exception as exc:  # 깨진 파일은 없는 것으로 취급
            warnings.append(f"{label} 파일을 읽지 못했습니다({os.path.basename(path)}): {exc}")
            return None
    if not quiet:
        warnings.append(f"{label} 파일이 없어 해당 절은 '자료 없음'으로 기록했습니다.")
    return None


# ── 조립 ─────────────────────────────────────────────────────────────────────
def _identity(o: ReportOptions, info, stability, posture, meta, generated_at) -> Identity:
    src = info.get("bdf") or (meta or {}).get("meta", {}).get("sourceBdf") or ""
    hull, unit = _parse_ids(src)
    mode = (stability.get("input") or {}).get("liftingMode") or {}
    mode_id = str(mode.get("id") or "").lower()
    method = LIFTING_MODE_LABELS.get(mode_id) or str(mode.get("label") or "-")
    equipment = str(((posture or {}).get("hoisting") or {}).get("mode", {}).get("equipment") or "")
    prefix = "Group Unit" if str(info.get("analysisType") or "").lower().startswith("group") else "Module Unit"
    return Identity(
        title_prefix=prefix, hull_no=o.hull_no or hull or "-", unit_no=o.unit_no or unit or "-",
        drawing_no=o.drawing_no or "-", revision=o.revision or "0", author=o.author or "-",
        department=o.department or "-", lifting_method=method, equipment=equipment,
        group_count=int((stability.get("input") or {}).get("groupCount") or 0),
        wire_length_m=float((stability.get("input") or {}).get("wireLengthM") or 0),
        source_bdf=os.path.basename(src), edited_model=str((stability.get("meta") or {}).get("sourceFiles", {}).get("model") or ""),
        generated_at=generated_at, engine_version=str((stability.get("meta") or {}).get("engineVersion") or ""), notes=o.notes,
    )

def _parse_ids(path: str):
    m = re.search(r"(?<!\d)(\d{4})[-_](\d{5})(?!\d)", os.path.basename(path or ""))
    return (m.group(1), m.group(2)) if m else (None, None)

def _geometry(mj: dict) -> Geometry:
    nodes = {int(n["id"]): (float(n["x"]), float(n["y"]), float(n["z"])) for n in mj.get("nodes", [])}
    elements = [(int(e["id"]), int(e["startNode"]), int(e["endNode"]), e.get("propertyId"), str(e.get("remark") or ""))
                for e in mj.get("elements", []) if e.get("startNode") in nodes and e.get("endNode") in nodes]
    if nodes:
        xs, ys, zs = zip(*nodes.values())
        center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
    else:
        center = (0.0, 0.0, 0.0)
    return Geometry(nodes, elements, center)

def _section_label(p: dict) -> str:
    dims = ", ".join(_fmt(d) for d in (p.get("dims") or []))
    return f"{p.get('card', '')} {p.get('kind', '')} [{dims}]".strip()

def _section_area(p: dict) -> Optional[float]:
    try:
        from ..bdf_mass_properties import cross_section_area_mm2
        return cross_section_area_mm2(p)
    except Exception:
        return None

def _model(mj, stability, posture, validation) -> ModelInfo:
    inp = stability.get("input") or {}
    pm = (posture or {}).get("model") or {}
    ps = (validation or {}).get("parsingSummary") or {}
    counts = ps.get("cardCounts") or {}
    bbox = inp.get("modelBboxMm") or pm.get("bboxMm") or ps.get("boundingBox") or {}
    b = {k: float(bbox.get(k, bbox.get(k[0] + k[1:].lower(), 0)) or 0) for k in ("minX", "maxX", "minY", "maxY", "minZ", "maxZ")}
    if not any(b.values()) and ps.get("boundingBox"):
        bb = ps["boundingBox"]; b = {"minX": bb["xMin"], "maxX": bb["xMax"], "minY": bb["yMin"], "maxY": bb["yMax"], "minZ": bb["zMin"], "maxZ": bb["zMax"]}
    sections = [Section(int(p["id"]), p.get("card", ""), p.get("kind", ""), list(p.get("dims") or []), int(p.get("materialId") or 0),
                        _section_area(p), _section_label(p)) for p in (mj or {}).get("properties", [])]
    materials = [Material(int(m["id"]), str(m.get("name") or ""), float(m.get("E") or 0), float(m.get("nu") or 0), float(m.get("rho") or 0))
                 for m in (mj or {}).get("materials", [])]
    return ModelInfo(
        node_count=int(counts.get("grid") or pm.get("nodeCount") or len((mj or {}).get("nodes", []))),
        element_count=int(counts.get("element") or len((mj or {}).get("elements", []))),
        rigid_count=len((mj or {}).get("rigids", [])), point_mass_count=int(counts.get("pointMass") or len((mj or {}).get("pointMasses", []))),
        property_count=len(sections), material_count=len(materials), bbox=b,
        size_mm=(b["maxX"] - b["minX"], b["maxY"] - b["minY"], b["maxZ"] - b["minZ"]),
        total_mass_ton=float(inp.get("totalMassTon") or pm.get("totalMassTon") or 0),
        cog_mm=inp.get("centerOfGravityMm") or pm.get("centerOfGravityMm") or {}, mass_source=str(inp.get("massSource") or ""),
        sections=sections, materials=materials, point_masses=list((mj or {}).get("pointMasses", [])),
        validation_status=(validation or {}).get("status"), free_end_nodes=ps.get("freeEndNodes"), disconnected_groups=ps.get("disconnectedGroupCount"),
    )

def _edits(original, edited, meta) -> EditInfo:
    o_el = {int(e["id"]) for e in original.get("elements", [])}
    e_el = {int(e["id"]) for e in edited.get("elements", [])}
    o_rg = {int(r["id"]) for r in original.get("rigids", [])}
    e_rg = {int(r["id"]) for r in edited.get("rigids", [])}
    o_nd = {int(n["id"]) for n in original.get("nodes", [])}
    e_nd = {int(n["id"]) for n in edited.get("nodes", [])}
    nodes = {int(n["id"]): n for n in edited.get("nodes", [])}
    props = {int(p["id"]): p for p in edited.get("properties", [])}
    supports = []
    for e in edited.get("elements", []):
        if str(e.get("remark") or "") != "가서포트":
            continue
        a, b = nodes.get(e["startNode"]), nodes.get(e["endNode"])
        length = math.dist((a["x"], a["y"], a["z"]), (b["x"], b["y"], b["z"])) if a and b else float(e.get("lengthMm") or 0)
        supports.append(SupportBeam(int(e["id"]), int(e["startNode"]), int(e["endNode"]), int(e.get("propertyId") or 0), length,
                                    list((props.get(e.get("propertyId")) or {}).get("dims") or [])))
    support_ids = {s.element_id for s in supports}
    stripped = ((meta or {}).get("lifting") or {}).get("strippedOriginalConstraints") or {}
    return EditInfo(
        deleted_element_count=len(o_el - e_el), deleted_rigid_count=len(o_rg - e_rg), deleted_node_count=len(o_nd - e_nd),
        support_beams=supports, removed_spc_cards=int(stripped.get("spcCardCount") or 0),
        removed_suport_cards=int(stripped.get("suportCardCount") or 0), trace=list(edited.get("trace") or []),
    ) if True else None

def _hoist(posture, opt, stability) -> HoistInfo:
    groups = []
    for g in ((posture or {}).get("hoisting") or {}).get("groups") or []:
        groups.append(HoistGroup(int(g["id"]), [int(n["id"]) for n in g.get("nodes", [])], list(g.get("nodes", [])), g.get("centroidMm") or {}))
    if not groups:
        for g in (stability.get("input") or {}).get("groups") or []:
            groups.append(HoistGroup(int(g["groupId"]), [int(i) for i in g.get("nodeIds", [])], [], {}))
    best = opt.get("Best") or {}
    best_sets = sorted(sorted(int(i) for i in g.get("NodeIds", [])) for g in best.get("Groups", []))
    cur_sets = sorted(sorted(g.node_ids) for g in groups)
    trace = opt.get("SearchTrace") or {}
    return HoistInfo(
        groups=groups, auto_selected=bool(best_sets) and best_sets == cur_sets,
        candidate_count=int(opt.get("CandidateCount") or 0), evaluated_count=int(opt.get("EvaluatedCount") or 0),
        pass_count=int(trace.get("PassCount") or 0), warn_count=int(trace.get("WarnCount") or 0), fail_count=int(trace.get("FailCount") or 0),
        elapsed_ms=int(trace.get("ElapsedMs") or 0), best_label=str(best.get("Label") or ""), best_score=float(best.get("Score") or 0),
        best_metrics=dict(best.get("Metrics") or {}), current_metrics=dict((opt.get("Current") or {}).get("Metrics") or {}),
    )

def _stage_metric(stage: int, s: dict) -> str:
    if stage == 0: return f"그룹 {s.get('groupCount', '-')}개 · 와이어 {_fmt(s.get('wireLengthMm'))} mm · 경고 {s.get('warnings', 0)}"
    if stage in (1, 2): return f"{s.get('passed', '-')}/{s.get('totalGroups', '-')} 그룹 통과"
    if stage == 3: return f"정점 {s.get('finalApexCount', '-')}개" + (" · Trolley 분할" if s.get("trolleySplitApplied") else "")
    if stage == 4: return f"최소 슬링각 {_fmt(s.get('minAngleDeg'))}° (G{s.get('minAngleAtGroupId', '-')}/N{s.get('minAngleAtLugNodeId', '-')}) · 장력계수 최대 {_fmt(s.get('maxTensionFactor'))}"
    if stage == 5: return f"간섭 {s.get('conflictCount', 0)}건 / 검사 {s.get('totalElementChecks', '-')} · 최소 이격 {_fmt(s.get('minClearanceMm'))} mm"
    if stage == 6: return f"{s.get('evaluationMode', '-')} · 여유 {_fmt(s.get('marginMm'))} mm · COG 편차 {_fmt(s.get('deviationMm'))} mm · 경사 {_fmt(s.get('tiltAngleDeg'))}°"
    if stage == 7: return str(s.get("skipped") or "-")
    return "-"

def _stability(st: dict, posture) -> StabilityInfo:
    rows, relaxed = [], False
    for stg in st.get("stages") or []:
        s = stg.get("summary") or {}
        relaxed = relaxed or bool(s.get("shapeGateRelaxed"))
        note = ""
        if stg.get("stage") == 5 and s.get("conflictCount"):
            note = "와이어 경로 확인 필요"
        if stg.get("stage") in (1, 2) and s.get("shapeGateRelaxed"):
            note = "Strict OFF 로 완화 판정"
        rows.append(StageRow(int(stg.get("stage")), str(stg.get("displayLabel") or STAGE_LABELS.get(stg.get("stage"), "")),
                             str(stg.get("status") or "-"), _stage_metric(int(stg.get("stage")), s), note))
    viz = st.get("visualization") or {}
    wires = [WireGeom(int(w.get("groupId") or 0), int(w.get("lugNodeId") or 0), float(w.get("lengthMm") or 0), float(w.get("angleDeg") or 0),
                      bool(w.get("safe", True)), str(w.get("status") or ""), w.get("startMm") or {}, w.get("endMm") or {}) for w in viz.get("wires") or []]
    s4 = next((x.get("summary") or {} for x in st.get("stages", []) if x.get("stage") == 4), {})
    s5 = next((x.get("summary") or {} for x in st.get("stages", []) if x.get("stage") == 5), {})
    s6 = next((x.get("summary") or {} for x in st.get("stages", []) if x.get("stage") == 6), None)
    tipping = Tipping(str(s6.get("evaluationMode") or ""), bool(s6.get("isStable")), float(s6.get("marginMm") or 0), float(s6.get("interiorMarginMm") or 0),
                      float(s6.get("deviationMm") or 0), float(s6.get("thresholdMm") or 0), bool(s6.get("cogInsideHull")), float(s6.get("tiltAngleDeg") or 0),
                      float(s6.get("apexToCogHeightMm") or 0)) if s6 else None
    ov = st.get("overall") or {}; us = ov.get("userSummary") or {}
    return StabilityInfo(
        overall_status=str(ov.get("status") or "-"), overall_label=str(us.get("statusLabel") or ""), primary_message=str(us.get("primaryMessage") or ""),
        stage_rows=rows, apexes=list(viz.get("apexes") or []), wires=wires,
        min_sling_angle_deg=_num(s4.get("minAngleDeg")), interference_count=int(s5.get("conflictCount") or 0), min_clearance_mm=_num(s5.get("minClearanceMm")),
        tipping=tipping, strict_evaluation=bool((posture or {}).get("strictEvaluation", False)), shape_gate_relaxed=relaxed,
        warnings=list(us.get("warnings") or []), critical=list(us.get("criticalIssues") or []),
    )

def _loads(meta, result, stability, folder, stem) -> LoadInfo:
    lf = (meta or {}).get("lifting") or {}
    rl = result.get("lifting") or {}
    wp, wm = lf.get("wireProperty") or {}, lf.get("wireMaterial") or {}
    anchor = lf.get("antiRigidBodyAnchor") or {}
    stab = lf.get("stabilizationParams") or {}
    sf = float(lf.get("safetyFactor") or rl.get("safetyFactor") or 1.0)
    mass = float((stability.get("input") or {}).get("totalMassTon") or 0)
    f06_path = (result.get("meta") or {}).get("f06Path") or ""
    if not os.path.isfile(f06_path):
        cand = os.path.join(folder, f"{stem}_lifting.f06")
        f06_path = cand if os.path.isfile(cand) else _first_f06(folder)
    return LoadInfo(
        safety_factor=sf, gravity_mm_s2=float(lf.get("gravityMagMm") or 9800.0), total_load_ton=mass * sf,
        wire_pid=int(wp.get("propertyId") or rl.get("wirePropertyId") or 0), wire_mid=int(wm.get("materialId") or rl.get("wireMaterialId") or 0),
        wire_area_mm2=float(wp.get("areaMm2") or 0), wire_j_mm4=float(wp.get("jMm4") or 0), wire_e_mpa=float(wm.get("eMPa") or 0),
        wire_pid_remapped=bool(wp.get("remappedFromConflict")), wire_mid_remapped=bool(wm.get("remappedFromConflict")),
        spc_sid=int(lf.get("spcSid") or 0), spc_components=str(lf.get("spcComponents") or ""), anchor_node_id=anchor.get("nodeId"),
        anchor_components=str(anchor.get("components") or ""), anchor_distance_mm=_num(anchor.get("selectedDistanceMm")),
        stabilization_cards=list(stab.get("cards") or []), stabilization_reason=str(stab.get("reason") or ""),
        grav_sid=int(lf.get("gravSid") or 0), load_sid=int(lf.get("loadSid") or 0), subcase_id=int((result.get("summary") or {}).get("subcaseId") or 1),
        f06=scan_f06_diagnostics(f06_path) if f06_path else {"available": False}, solver="MSC Nastran SOL 101 (선형 정적)",
    )

def _first_f06(folder):
    try:
        return next((os.path.join(folder, f) for f in sorted(os.listdir(folder)) if f.lower().endswith("_lifting.f06")), "")
    except OSError:
        return ""

def _results(result, stability, o: ReportOptions, geom: Optional[Geometry], model: ModelInfo) -> ResultInfo:
    ev, sm = result.get("evaluation") or {}, result.get("summary") or {}
    allowable = _num(ev.get("structuralAllowableMPa")) or o.yield_strength_mpa * 0.8
    yield_mpa = allowable / 0.8 if _num(ev.get("structuralAllowableMPa")) else o.yield_strength_mpa
    pid_of = {e[0]: e[3] for e in (geom.elements if geom else [])}
    label_of = {s.pid: s.label for s in model.sections}
    members = []
    for m in result.get("members") or []:
        pid = pid_of.get(int(m["elementId"]))
        members.append(MemberRow(int(m["elementId"]), pid, label_of.get(pid, f"PID {pid}" if pid else "-"),
                                 float(m.get("maxStressMPa") or 0), _num(m.get("utilization")), bool(m.get("exceedsLimit"))))
    members.sort(key=lambda r: -(r.utilization if r.utilization is not None else -1))
    exceeding = [r for r in members if r.exceeds or (r.utilization or 0) > 1.0]
    by_pid: dict[int, list[MemberRow]] = {}
    for r in members:
        if r.pid is not None:
            by_pid.setdefault(r.pid, []).append(r)
    pid_summary = [PidSummary(pid, rows[0].section_label, len(rows), max(r.stress_mpa for r in rows),
                              max((r.utilization or 0) for r in rows), rows[0].element_id) for pid, rows in sorted(by_pid.items())]
    edges = [i * 0.1 for i in range(13)]
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        bins.append((lo, hi, sum(1 for r in members if r.utilization is not None and lo <= r.utilization < hi)))
    bins.append((1.2, math.inf, sum(1 for r in members if (r.utilization or 0) >= 1.2)))
    disp = [DispRow(int(d["nodeId"]), float(d.get("t1") or 0), float(d.get("t2") or 0), float(d.get("t3") or 0), float(d.get("magnitude") or 0))
            for d in result.get("displacements") or []]
    disp.sort(key=lambda d: -d.magnitude)
    max_disp = _num(sm.get("maxDisplacementMag")) if _num(sm.get("maxDisplacementMag")) is not None else (disp[0].magnitude if disp else 0.0)
    max_node = sm.get("maxDisplacementNodeId") or (disp[0].node_id if disp else None)
    top = next((d for d in disp if d.node_id == max_node), disp[0] if disp else None)
    angles = {(w.group_id, w.lug_node_id): w.angle_deg for w in _stability(stability, None).wires}
    wires: list[WireRow] = []
    for w in result.get("wires") or []:
        f = float(w.get("axialForceN") or 0)
        t = abs(f) / TON_FORCE_N
        ang = angles.get((int(w.get("groupId") or 0), int(w.get("lugNodeId") or 0)))
        vert = t * math.sin(math.radians(ang)) if ang is not None else None
        wires.append(WireRow(int(w.get("wireElementId") or 0), int(w.get("groupId") or 0), int(w.get("lugNodeId") or 0), f, t, ang, vert,
                             t > o.jig_limit_ton, bool(w.get("isCompression")), bool(w.get("isSlack"))))
    wires.sort(key=lambda w: (w.group_id, w.lug_node_id))
    totals = []
    for gid in sorted({w.group_id for w in wires}):
        ws = [w for w in wires if w.group_id == gid]
        totals.append(HookTotal(gid, len(ws), sum(w.tension_ton for w in ws), sum(w.vertical_ton or 0 for w in ws)))
    mass = float((stability.get("input") or {}).get("totalMassTon") or 0)
    sf = float((result.get("lifting") or {}).get("safetyFactor") or 1.0)
    total_load = mass * sf
    check = ((sum(h.vertical_ton for h in totals) / total_load) - 1) * 100 if total_load > 0 and totals else None
    return ResultInfo(
        allowable_mpa=allowable, yield_mpa=yield_mpa, max_stress_mpa=float(sm.get("memberMaxStressMPa") or (members[0].stress_mpa if members else 0)),
        max_stress_element_id=sm.get("memberMaxStressElementId") or (members[0].element_id if members else None),
        member_count=int(sm.get("memberElementCount") or len(members)), exceed_count=int(sm.get("memberExceedCount") or len(exceeding)),
        max_displacement_mm=float(max_disp or 0), max_displacement_node_id=max_node,
        max_displacement_components=(top.t1, top.t2, top.t3) if top else (0.0, 0.0, 0.0),
        governing=members[:GOVERNING_TOP_N], exceeding=exceeding, all_members=members, pid_summary=pid_summary, utilization_bins=bins,
        top_displacements=disp[:DISPLACEMENT_TOP_N], all_displacements=disp, wires=wires, hook_totals=totals, hook_check_error_pct=check,
        wire_compression_count=int(sm.get("wireCompressionCount") or 0), wire_missing_count=int(sm.get("wireMissingResultCount") or 0),
    )

def _verdicts(r: ResultInfo, s: StabilityInfo, o: ReportOptions) -> Verdicts:
    actions: list[str] = []
    if r.member_count == 0:
        structure = "판정 불가"; actions.append("부재 응력 결과가 없습니다 — 해석 로그(F06)를 확인하십시오.")
    elif r.exceeding:
        structure = "NG"; actions.append(f"허용응력 초과 부재 {len(r.exceeding)}개 — 단면 보강 또는 권상 위치 재검토가 필요합니다.")
    else:
        structure = "OK"
    jig = any(w.needs_jig for w in r.wires)
    if jig:
        actions.append(f"와이어 장력이 지그 기준 {o.jig_limit_ton:g} ton 을 초과하는 러그가 있습니다 — 국부 변형 방지 지그를 설치하십시오.")
    if r.wire_compression_count or any(w.is_slack for w in r.wires):
        actions.append("압축 또는 슬랙 상태의 와이어가 있습니다 — 권상 자세와 와이어 길이를 재검토하십시오.")
    if s.overall_status == "fail":
        actions.append("자세안정성 FAIL — 권상 위치를 변경하기 전에는 권상할 수 없습니다.")
    for w in s.warnings[:5]:
        actions.append(f"[{w.get('target', '')}] {w.get('headline', '')}")
    return Verdicts(structure, s.overall_status, jig, actions)


# ── 유틸 ─────────────────────────────────────────────────────────────────────
def _num(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None

def _fmt(v, nd=2) -> str:
    f = _num(v)
    if f is None:
        return "-"
    return f"{f:,.{nd}f}".rstrip("0").rstrip(".") if abs(f) >= 1e-9 else "0"
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_lifting_report_collector.py -q --noconftest`
Expected: `7 passed`. 실패 시 fixture 값(예: `deleted_element_count`)이 build_fixture 의 추가 개수와 맞는지 먼저 확인.

- [ ] **Step 5: 커밋 준비 보고** — `app/services/unit_lifting_report/{__init__,collector}.py`, `tests/test_unit_lifting_report_collector.py`

---

### Task 3: figures — matplotlib 2D 도면 렌더

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/unit_lifting_report/figures.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_unit_lifting_report_figures.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
import os
import pytest

from app.services.unit_lifting_report.collector import collect, ReportOptions
from app.services.unit_lifting_report import figures

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"
PNG = b"\x89PNG\r\n\x1a\n"


@pytest.fixture(scope="module")
def data():
    return collect({
        "nastranResultJson": os.path.join(FIX, f"{STEM}_lifting_nastranResult.json"),
        "stabilityJson": os.path.join(FIX, f"{STEM}_stability.json"),
        "liftingMetaJson": os.path.join(FIX, f"{STEM}_lifting_meta.json"),
        "bdf": os.path.join(FIX, f"{STEM}.bdf"),
    }, ReportOptions())


def test_render_all_returns_expected_keys(data):
    figs = figures.render_all(data)
    expected = {"model_plan", "model_side", "model_front", "model_iso", "hoist_plan", "hoist_side",
                "deformed_iso", "stress_plan", "stress_iso", "utilization_hist"}
    assert expected <= set(figs)
    assert "support_plan" not in figs                      # fixture 에는 가서포트 없음
    for key in expected:
        assert figs[key][:8] == PNG, key
        assert len(figs[key]) > 2000, key


def test_project_views_are_right_handed():
    p = figures.project((1000, 2000, 3000), "plan")
    assert p == (1000, 2000)
    assert figures.project((1000, 2000, 3000), "side") == (1000, 3000)
    assert figures.project((1000, 2000, 3000), "front") == (2000, 3000)
    ix, iy = figures.project((1000, 0, 0), "iso")
    assert ix > 0 and iy < 0                               # +X 는 오른쪽 아래로


def test_place_label_avoids_overlap():
    occupied = []
    a = figures.place_label(occupied, 100, 100, 40, 12)
    b = figures.place_label(occupied, 100, 100, 40, 12)
    assert a != b
    assert len(occupied) == 2


def test_render_failure_is_isolated(data, monkeypatch):
    monkeypatch.setattr(figures, "_render_histogram", lambda *_: (_ for _ in ()).throw(RuntimeError("boom")))
    figs, errors = figures.render_all_safe(data)
    assert "utilization_hist" not in figs
    assert errors["utilization_hist"].startswith("RuntimeError")
```

- [ ] **Step 2: 실패 확인**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_lifting_report_figures.py -q --noconftest`
Expected: `ImportError: cannot import name 'figures'`

- [ ] **Step 3: figures.py 구현**

```python
"""Unit 권상 검토 보고서 — 2D 도면 렌더(matplotlib Agg → PNG bytes).

모든 좌표는 모델 mm. 투영: plan(XY, 위에서), side(XZ), front(YZ), iso(등각).
그룹 색은 Studio 와 동일한 6색. 라벨은 codex 의 LiftingArrangementReport.js 회피 로직을 옮겼다.
"""
from __future__ import annotations

import io
import math
from typing import Iterable, Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import colors as mcolors  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402

from .collector import ReportData, Geometry  # noqa: E402

plt.rcParams["font.family"] = ["Malgun Gothic", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

GROUP_COLORS = ["#1769AA", "#D73A49", "#138A5B", "#E07A16", "#7653C6", "#008C99"]
STRUCTURE = "#B8C2CC"
SUPPORT = "#E07A16"
DPI = 150
# Studio stressColorRamp.js RAMP_STOPS 와 동일
RAMP = mcolors.LinearSegmentedColormap.from_list("util", [
    (0.00, "#1E5AA8"), (0.40, "#2BA6C4"), (0.70, "#37E08A"), (0.85, "#FFC447"), (1.00, "#FF8A3D")])
EXCEEDED = "#FF5566"
NO_RESULT = "#90A4B0"
_ISO_C, _ISO_S = math.cos(math.radians(30)), math.sin(math.radians(30))


def group_color(gid: int) -> str:
    return GROUP_COLORS[(max(1, int(gid)) - 1) % len(GROUP_COLORS)]


def project(p, view: str) -> tuple[float, float]:
    x, y, z = p
    if view == "plan": return (x, y)
    if view == "side": return (x, z)
    if view == "front": return (y, z)
    # iso: X 오른쪽-아래, Y 오른쪽-위, Z 위
    return ((x + y) * _ISO_C, (-x + y) * _ISO_S + z)


def place_label(occupied: list, px: float, py: float, w: float, h: float, gap: float = 6.0):
    """겹치지 않는 라벨 박스(x0, y0) 를 고른다. 6개 후보 중 첫 미충돌, 없으면 마지막 후보."""
    cands = [(px + gap, py + gap), (px + gap, py - h - gap), (px - w - gap, py + gap),
             (px - w - gap, py - h - gap), (px + gap * 2, py - h / 2), (px - w - gap * 2, py - h / 2)]
    for cx, cy in cands:
        box = (cx, cy, cx + w, cy + h)
        if not any(_overlap(box, o) for o in occupied):
            occupied.append(box)
            return (cx, cy)
    occupied.append((cands[-1][0], cands[-1][1], cands[-1][0] + w, cands[-1][1] + h))
    return cands[-1]


def _overlap(a, b, pad=2.0):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


# ── 공개 ──────────────────────────────────────────────────────────────────────
def render_all(data: ReportData) -> dict[str, bytes]:
    figs, errors = render_all_safe(data)
    if errors:
        raise RuntimeError("; ".join(f"{k}: {v}" for k, v in errors.items()))
    return figs


def render_all_safe(data: ReportData) -> tuple[dict[str, bytes], dict[str, str]]:
    """그림별로 실패를 격리한다. 반환 (성공 PNG, 실패 사유)."""
    figs: dict[str, bytes] = {}
    errors: dict[str, str] = {}
    g = data.geometry
    jobs = []
    if g and g.nodes:
        for view in ("plan", "side", "front", "iso"):
            jobs.append((f"model_{view}", lambda v=view: _render_model(g, v, data)))
        jobs += [("hoist_plan", lambda: _render_hoist(g, data, "plan")), ("hoist_side", lambda: _render_hoist(g, data, "side")),
                 ("deformed_iso", lambda: _render_deformed(g, data)),
                 ("stress_plan", lambda: _render_stress(g, data, "plan")), ("stress_iso", lambda: _render_stress(g, data, "iso"))]
        if data.edits and data.edits.support_beams:
            jobs += [("support_plan", lambda: _render_support(g, data, "plan")), ("support_iso", lambda: _render_support(g, data, "iso"))]
    jobs.append(("utilization_hist", lambda: _render_histogram(data)))
    for key, fn in jobs:
        try:
            figs[key] = fn()
        except Exception as exc:  # 한 그림 실패가 보고서를 막지 않게
            errors[key] = f"{type(exc).__name__}: {exc}"
    return figs, errors


# ── 공통 ──────────────────────────────────────────────────────────────────────
def _fig(w=7.2, h=4.6):
    fig, ax = plt.subplots(figsize=(w, h), dpi=DPI)
    ax.set_aspect("equal", adjustable="datalim")
    ax.set_facecolor("white"); fig.patch.set_facecolor("white")
    for s in ax.spines.values(): s.set_color("#AEB8C2")
    ax.tick_params(labelsize=7, colors="#5B6975")
    return fig, ax


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=DPI, facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _segments(g: Geometry, view: str, ids: Optional[set] = None, exclude_support=False):
    segs, keys = [], []
    for eid, n1, n2, _pid, remark in g.elements:
        if ids is not None and eid not in ids: continue
        if exclude_support and remark == "가서포트": continue
        segs.append([project(g.nodes[n1], view), project(g.nodes[n2], view)]); keys.append(eid)
    return segs, keys


def _draw_structure(ax, g: Geometry, view: str, color=STRUCTURE, lw=0.5, alpha=0.9):
    segs, _ = _segments(g, view, exclude_support=True)
    ax.add_collection(LineCollection(segs, colors=color, linewidths=lw, alpha=alpha, zorder=1))
    ax.autoscale_view()


def _axis_labels(ax, view: str):
    ax.set_xlabel({"plan": "X (mm)", "side": "X (mm)", "front": "Y (mm)", "iso": ""}[view], fontsize=8)
    ax.set_ylabel({"plan": "Y (mm)", "side": "Z (mm)", "front": "Z (mm)", "iso": ""}[view], fontsize=8)
    if view == "iso":
        ax.set_xticks([]); ax.set_yticks([])
    ax.grid(view != "iso", color="#E6EAEE", linewidth=0.5)


def _title(ax, text, sub=""):
    ax.set_title(text + (f"\n{sub}" if sub else ""), fontsize=10, color="#18242F", loc="left", fontweight="bold")


def _dimension(ax, g: Geometry, view: str):
    """외형 치수선(가로·세로) — 도면 관례대로 바깥쪽에 얇게."""
    pts = [project(p, view) for p in g.nodes.values()]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pad = 0.06 * max(x1 - x0, y1 - y0, 1)
    ax.annotate("", (x0, y0 - pad), (x1, y0 - pad), arrowprops=dict(arrowstyle="<->", color="#5B6975", lw=0.7))
    ax.text((x0 + x1) / 2, y0 - pad * 1.25, f"{x1 - x0:,.0f}", ha="center", va="top", fontsize=7, color="#34424E")
    ax.annotate("", (x0 - pad, y0), (x0 - pad, y1), arrowprops=dict(arrowstyle="<->", color="#5B6975", lw=0.7))
    ax.text(x0 - pad * 1.25, (y0 + y1) / 2, f"{y1 - y0:,.0f}", ha="right", va="center", fontsize=7, color="#34424E", rotation=90)
    ax.set_xlim(x0 - pad * 3, x1 + pad); ax.set_ylim(y0 - pad * 3, y1 + pad)


def _label(ax, occupied, px, py, text, color, fontsize=7):
    """데이터 좌표를 픽셀로 바꿔 겹침 회피 후 리더선 + 박스 라벨."""
    fig = ax.get_figure(); fig.canvas.draw()
    disp = ax.transData.transform((px, py))
    w, h = fontsize * 0.62 * len(text) + 8, fontsize * 1.9
    bx, by = place_label(occupied, disp[0], disp[1], w, h)
    dx, dy = ax.transData.inverted().transform((bx + w / 2, by + h / 2))
    ax.annotate(text, (px, py), (dx, dy), fontsize=fontsize, color="#18242F", ha="center", va="center",
                bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=color, lw=0.8),
                arrowprops=dict(arrowstyle="-", color=color, lw=0.7), zorder=6)


# ── 각 그림 ───────────────────────────────────────────────────────────────────
def _render_model(g: Geometry, view: str, d: ReportData) -> bytes:
    fig, ax = _fig()
    _draw_structure(ax, g, view, color="#6B7A88", lw=0.6)
    if view != "iso":
        _dimension(ax, g, view)
    cog = d.model.cog_mm
    if cog:
        cx, cy = project((cog.get("x", 0), cog.get("y", 0), cog.get("z", 0)), view)
        ax.plot(cx, cy, marker=(4, 1, 0), ms=11, color="#D73A49", zorder=5)
        ax.annotate("COG", (cx, cy), (6, 6), textcoords="offset points", fontsize=7, color="#D73A49")
    names = {"plan": "평면도 (Plan, XY)", "side": "측면도 (Side, XZ)", "front": "정면도 (Front, YZ)", "iso": "등각도 (Isometric)"}
    _title(ax, f"해석 모델 — {names[view]}", f"절점 {d.model.node_count:,} · 요소 {d.model.element_count:,}")
    _axis_labels(ax, view)
    return _png(fig)


def _render_hoist(g: Geometry, d: ReportData, view: str) -> bytes:
    fig, ax = _fig(7.2, 5.0)
    _draw_structure(ax, g, view)
    occupied: list = []
    st = d.stability
    for w in st.wires:
        s, e = w.start_mm, w.end_mm
        if not s or not e: continue
        p0, p1 = project((s["x"], s["y"], s["z"]), view), project((e["x"], e["y"], e["z"]), view)
        c = group_color(w.group_id)
        ax.plot([p0[0], p1[0]], [p0[1], p1[1]], color=c, lw=1.4, zorder=3)
        ax.plot(*p1, "o", ms=6, color=c, zorder=4)
    for a in st.apexes:
        p = a.get("pointMm") or {}
        px, py = project((p.get("x", 0), p.get("y", 0), p.get("z", 0)), view)
        ax.plot(px, py, "o", ms=9, mfc="white", mec=group_color(a.get("groupId", 1)), mew=1.6, zorder=5)
    cog = d.model.cog_mm
    if cog:
        cx, cy = project((cog.get("x", 0), cog.get("y", 0), cog.get("z", 0)), view)
        ax.plot(cx, cy, marker=(4, 1, 0), ms=12, color="#D73A49", zorder=6)
        if view == "plan" and st.tipping and st.tipping.evaluation_mode == "ConvexPolygon" and len(st.apexes) >= 3:
            pts = [project((a["pointMm"]["x"], a["pointMm"]["y"], 0), "plan") for a in st.apexes]
            hull = _convex_hull(pts) + [_convex_hull(pts)[0]]
            ax.plot([p[0] for p in hull], [p[1] for p in hull], "--", color="#7653C6", lw=0.9, zorder=2, label="지지 다각형")
    ax.autoscale_view()
    fig.canvas.draw()
    for w in st.wires:
        e = w.end_mm
        if not e: continue
        px, py = project((e["x"], e["y"], e["z"]), view)
        _label(ax, occupied, px, py, f"G{w.group_id}·N{w.lug_node_id}·{w.angle_deg:.1f}°", group_color(w.group_id))
    for a in st.apexes:
        p = a["pointMm"]; px, py = project((p["x"], p["y"], p["z"]), view)
        _label(ax, occupied, px, py, f"HOOK G{a.get('groupId')}", group_color(a.get("groupId", 1)), fontsize=7.5)
    if cog:
        _label(ax, occupied, cx, cy, "COG", "#D73A49")
    handles = [plt.Line2D([], [], color=group_color(i + 1), lw=2, label=f"권상 그룹 G{i + 1}") for i in range(d.identity.group_count)]
    handles.append(plt.Line2D([], [], color=STRUCTURE, lw=2, label="기존 구조"))
    ax.legend(handles=handles, fontsize=7, loc="upper right", framealpha=0.95)
    _title(ax, f"권상 배치 — {'평면도' if view == 'plan' else '측면도'}",
           f"{d.identity.lifting_method} · {d.model.total_mass_ton:.3f} ton · 그룹 / 러그 절점 / 슬링각")
    _axis_labels(ax, view)
    return _png(fig)


def _convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) <= 2: return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0: lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0: upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _render_deformed(g: Geometry, d: ReportData) -> bytes:
    fig, ax = _fig(7.2, 5.0)
    view = "iso"
    _draw_structure(ax, g, view, color="#D5DBE1", lw=0.5)
    disp = {r.node_id: (r.t1, r.t2, r.t3) for r in d.results.all_displacements}
    size = max(d.model.size_mm) or 1.0
    scale = (0.05 * size / d.results.max_displacement_mm) if d.results.max_displacement_mm > 0 else 1.0
    segs, vals = [], []
    for eid, n1, n2, _pid, _r in g.elements:
        a, b = g.nodes[n1], g.nodes[n2]
        da, db = disp.get(n1, (0, 0, 0)), disp.get(n2, (0, 0, 0))
        pa = tuple(a[i] + da[i] * scale for i in range(3)); pb = tuple(b[i] + db[i] * scale for i in range(3))
        segs.append([project(pa, view), project(pb, view)])
        vals.append((math.dist((0, 0, 0), da) + math.dist((0, 0, 0), db)) / 2)
    norm = mcolors.Normalize(0, d.results.max_displacement_mm or 1)
    lc = LineCollection(segs, cmap="viridis", norm=norm, linewidths=0.9, zorder=3); lc.set_array(vals)
    ax.add_collection(lc); ax.autoscale_view()
    cb = fig.colorbar(lc, ax=ax, fraction=0.035, pad=0.02); cb.set_label("변위 크기 (mm)", fontsize=8); cb.ax.tick_params(labelsize=7)
    nid = d.results.max_displacement_node_id
    if nid in g.nodes:
        dn = disp.get(nid, (0, 0, 0)); p = tuple(g.nodes[nid][i] + dn[i] * scale for i in range(3))
        px, py = project(p, view); ax.plot(px, py, "o", ms=7, mfc="none", mec="#D73A49", mew=1.5, zorder=6)
        _label(ax, [], px, py, f"최대 {d.results.max_displacement_mm:.2f} mm @N{nid}", "#D73A49")
    _title(ax, "변형 형상 (Deformed shape)", f"변형 배율 ×{scale:,.0f} · 회색 = 원형")
    _axis_labels(ax, view)
    return _png(fig)


def _render_stress(g: Geometry, d: ReportData, view: str) -> bytes:
    fig, ax = _fig(7.2, 5.0)
    util = {m.element_id: m.utilization for m in d.results.all_members}
    segs, cols = [], []
    for eid, n1, n2, _pid, _r in g.elements:
        segs.append([project(g.nodes[n1], view), project(g.nodes[n2], view)])
        u = util.get(eid)
        cols.append(NO_RESULT if u is None else (EXCEEDED if u > 1 else RAMP(min(max(u, 0), 1))))
    ax.add_collection(LineCollection(segs, colors=cols, linewidths=1.0, zorder=3)); ax.autoscale_view()
    sm = plt.cm.ScalarMappable(cmap=RAMP, norm=mcolors.Normalize(0, 1)); sm.set_array([])
    cb = fig.colorbar(sm, ax=ax, fraction=0.035, pad=0.02, ticks=[0, 0.4, 0.7, 0.85, 1.0])
    cb.set_label(f"활용도 σ/σ허용 (σ허용 = {d.results.allowable_mpa:g} MPa)", fontsize=8); cb.ax.tick_params(labelsize=7)
    fig.canvas.draw()
    occupied: list = []
    for m in d.results.governing[:5]:
        el = next((e for e in g.elements if e[0] == m.element_id), None)
        if not el: continue
        a, b = g.nodes[el[1]], g.nodes[el[2]]
        px, py = project(tuple((a[i] + b[i]) / 2 for i in range(3)), view)
        _label(ax, occupied, px, py, f"E{m.element_id} {m.stress_mpa:.1f} MPa", EXCEEDED if m.exceeds else "#34424E")
    _title(ax, f"부재 응력 활용도 — {'평면도' if view == 'plan' else '등각도'}",
           f"최대 {d.results.max_stress_mpa:.1f} MPa @E{d.results.max_stress_element_id} · 초과 {d.results.exceed_count}개 · 회색 = 결과 없음")
    _axis_labels(ax, view)
    return _png(fig)


def _render_support(g: Geometry, d: ReportData, view: str) -> bytes:
    fig, ax = _fig(7.2, 5.0)
    _draw_structure(ax, g, view)
    occupied: list = []
    fig.canvas.draw()
    for i, s in enumerate(d.edits.support_beams):
        a, b = g.nodes.get(s.start_node), g.nodes.get(s.end_node)
        if not a or not b: continue
        p0, p1 = project(a, view), project(b, view)
        ax.plot([p0[0], p1[0]], [p0[1], p1[1]], color=SUPPORT, lw=2.4, zorder=4)
        _label(ax, occupied, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, f"S{i + 1}·N{s.start_node}–N{s.end_node}", SUPPORT)
    ax.autoscale_view()
    _title(ax, f"가서포트 배치 — {'평면도' if view == 'plan' else '등각도'}", f"가서포트 {len(d.edits.support_beams)}개 (주황)")
    _axis_labels(ax, view)
    return _png(fig)


def _render_histogram(d: ReportData) -> bytes:
    fig, ax = plt.subplots(figsize=(7.2, 3.2), dpi=DPI)
    bins = d.results.utilization_bins
    labels = [f"{lo:.1f}–{hi:.1f}" if math.isfinite(hi) else "≥1.2" for lo, hi, _ in bins]
    counts = [c for _, _, c in bins]
    colors = [EXCEEDED if lo >= 1.0 else RAMP(min(lo + 0.05, 1)) for lo, _, _ in bins]
    ax.bar(labels, counts, color=colors, edgecolor="white")
    for i, c in enumerate(counts):
        if c: ax.text(i, c, f"{c:,}", ha="center", va="bottom", fontsize=7)
    ax.axvline(9.5, color=EXCEEDED, ls="--", lw=1); ax.text(9.6, max(counts or [1]) * 0.95, "허용 (1.0)", color=EXCEEDED, fontsize=7)
    ax.set_xlabel("활용도 구간", fontsize=8); ax.set_ylabel("부재 수", fontsize=8); ax.tick_params(labelsize=7)
    ax.set_title(f"부재 활용도 분포 (n = {d.results.member_count:,})", fontsize=10, loc="left", fontweight="bold")
    for s in ("top", "right"): ax.spines[s].set_visible(False)
    return _png(fig)
```

- [ ] **Step 4: 통과 확인**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_lifting_report_figures.py -q --noconftest`
Expected: `4 passed`. (한글 폰트 경고 `findfont` 가 뜨면 `Malgun Gothic` 설치 여부 확인 — Windows 기본 포함.)

- [ ] **Step 5: 눈으로 확인** — `WorkBenchEnv/Scripts/python.exe -c "..."` 로 `render_all(data)` 의 `hoist_plan`, `stress_iso` 를 scratchpad 에 PNG 로 저장해 Read 툴로 열어 라벨 겹침·방향(X 오른쪽)·컬러바를 확인.

- [ ] **Step 6: 커밋 준비 보고** — `figures.py`, `tests/test_unit_lifting_report_figures.py`

---

### Task 4: sheet — openpyxl 레이아웃 프리미티브

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/unit_lifting_report/sheet.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_unit_lifting_report_sheet.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
import io
from openpyxl import Workbook, load_workbook

from app.services.unit_lifting_report.sheet import ReportSheet

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080200000090775"
    "3de0000000c4944415408d763f8cfc00000030101000ce3b60e0000000049454e44ae426082")


def _roundtrip(wb):
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return load_workbook(buf)


def test_chapter_starts_new_page_and_records_page():
    wb = Workbook(); s = ReportSheet(wb.active, header="HULL 1 / UNIT 2")
    s.para("본문 " * 10)
    p1 = s.chapter("1", "1. 개요")
    s.para("x")
    p2 = s.chapter("2", "2. 모델")
    assert (p1, p2) == (2, 3)
    assert s.chapter_pages == {"1": 2, "2": 3}
    assert len(s.ws.row_breaks.brk) == 2


def test_table_writes_header_rows_and_status_fill():
    wb = Workbook(); s = ReportSheet(wb.active)
    s.table(["항목", "값", "판정"], [["a", 1.2345, "OK"], ["b", 2, "NG"]], widths=[4, 4, 4], status_col=2)
    ws = _roundtrip(wb).active
    assert ws["A1"].value == "항목"
    assert ws["A2"].value == "a" and ws["E2"].value == 1.2345
    assert ws["I3"].value == "NG"
    assert ws["I3"].fill.fgColor.rgb.endswith("FFE0E3")


def test_toc_two_pass_fills_pages():
    wb = Workbook(); s = ReportSheet(wb.active)
    s.toc_placeholder(2)
    s.chapter("1", "1. 개요"); s.chapter("2", "2. 모델")
    s.toc_fill([("1. 개요", s.chapter_pages["1"]), ("2. 모델", s.chapter_pages["2"])])
    ws = _roundtrip(wb).active
    assert ws["A2"].value == "1. 개요" and ws["L2"].value == 2
    assert ws["A3"].value == "2. 모델" and ws["L3"].value == 3


def test_figure_inserts_image_with_caption():
    wb = Workbook(); s = ReportSheet(wb.active)
    s.figure(PNG_1PX, "그림 1. 테스트", width_px=300, height_px=200)
    assert len(s.ws._images) == 1
    assert any(c.value == "그림 1. 테스트" for row in s.ws.iter_rows() for c in row)


def test_cover_and_kv():
    wb = Workbook(); s = ReportSheet(wb.active)
    s.cover("Module Unit 권상 구조 검토 보고서", [("HULL NO.", "3496"), ("UNIT NO.", "35210")],
            [("구조", "OK", "ok"), ("자세안정성", "WARN", "warn"), ("지그", "불요", "ok")], logo_png=PNG_1PX)
    s.kv([("중량", "6.740 ton")])
    assert s.page == 2
    vals = [c.value for row in s.ws.iter_rows() for c in row if c.value is not None]
    assert "Module Unit 권상 구조 검토 보고서" in vals and "6.740 ton" in vals
```

- [ ] **Step 2: 실패 확인**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_lifting_report_sheet.py -q --noconftest`
Expected: `ModuleNotFoundError ... sheet`

- [ ] **Step 3: sheet.py 구현**

```python
"""보고서 레이아웃 프리미티브 — 한 시트에 위→아래로 써 내려간다.

격자: A~L 12열(각 7.2 문자폭 ≈ A4 세로 인쇄폭). 표 열 폭은 '몇 칸을 병합하나(widths)' 로 정한다.
쪽 추정: 행 높이(pt) 누적으로 페이지 경계를 근사한다. 장(chapter) 은 강제 페이지 나누기라 정확하고,
절/문단 위치는 ±1쪽 오차가 있을 수 있다(목차용으로 충분).
"""
from __future__ import annotations

import io
from typing import Iterable, Optional, Sequence

from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.pagebreak import Break

COLS = 12
COL_WIDTH = 7.2
PAGE_PT = 700.0            # A4 세로, 상하 여백·머리글/바닥글 제외 본문 높이(근사)
DEFAULT_ROW_PT = 15.0
FONT = "맑은 고딕"
NAVY, GRAY, LIGHT, LINE = "002554", "5B6975", "F3F5F7", "AEB8C2"
STATUS_FILL = {"ok": "E3F6EA", "pass": "E3F6EA", "warn": "FFF3D6", "ng": "FFE0E3", "fail": "FFE0E3", "skip": "EEF1F4", "판정 불가": "EEF1F4"}
_thin = Side(style="thin", color=LINE)
BORDER = Border(left=_thin, right=_thin, top=_thin, bottom=_thin)


class ReportSheet:
    def __init__(self, ws, header: str = ""):
        self.ws = ws
        self.ws.title = "Report"
        self.row = 1
        self.page = 1
        self._page_pt = 0.0
        self.chapter_pages: dict[str, int] = {}
        self._fig_no = 0
        self._tbl_no = 0
        self._toc_row: Optional[int] = None
        for c in range(1, COLS + 1):
            ws.column_dimensions[get_column_letter(c)].width = COL_WIDTH
        ws.sheet_view.showGridLines = False
        ps = ws.page_setup; ps.orientation = "portrait"; ps.paperSize = ws.PAPERSIZE_A4; ps.fitToWidth = 1; ps.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_margins.left = ws.page_margins.right = 0.55; ws.page_margins.top = 0.7; ws.page_margins.bottom = 0.6
        ws.oddHeader.left.text = header; ws.oddHeader.left.size = 8
        ws.oddFooter.center.text = "- &P / &N -"; ws.oddFooter.center.size = 8
        ws.oddFooter.right.text = "Hi-TESS WorkBench 자동 생성"; ws.oddFooter.right.size = 7
        ws.print_title_rows = None

    # ── 내부 ────────────────────────────────────────────────────────────────
    def _advance(self, pt: float = DEFAULT_ROW_PT, rows: int = 1):
        for _ in range(rows):
            if pt != DEFAULT_ROW_PT:
                self.ws.row_dimensions[self.row].height = pt
            self.row += 1
            self._page_pt += pt
            if self._page_pt > PAGE_PT:
                self.page += 1
                self._page_pt = pt

    def _merge(self, c0: int, c1: int, row: Optional[int] = None):
        r = row or self.row
        if c1 > c0:
            self.ws.merge_cells(start_row=r, start_column=c0, end_row=r, end_column=c1)
        return self.ws.cell(row=r, column=c0)

    def _text(self, text, c0=1, c1=COLS, size=9.5, bold=False, color="18242F", align="left", wrap=True, fill=None, border=False, row=None):
        cell = self._merge(c0, c1, row)
        cell.value = text
        cell.font = Font(name=FONT, size=size, bold=bold, color=color)
        cell.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
        if fill:
            cell.fill = PatternFill("solid", fgColor=fill)
        if border:
            for c in range(c0, c1 + 1):
                self.ws.cell(row=row or self.row, column=c).border = BORDER
        return cell

    @staticmethod
    def _lines(text: str, cols: int, size: float) -> int:
        chars_per_line = max(8, int(cols * COL_WIDTH * 1.05 * (9.5 / size)))
        n = 0
        for part in str(text).split("\n"):
            n += max(1, -(-len(part) // chars_per_line))
        return n

    def page_break(self):
        self.ws.row_breaks.append(Break(id=self.row - 1))
        self.page += 1
        self._page_pt = 0.0

    # ── 공개 프리미티브 ─────────────────────────────────────────────────────
    def cover(self, title: str, facts: Sequence[tuple[str, str]], verdicts: Sequence[tuple[str, str, str]], logo_png: Optional[bytes] = None):
        if logo_png:
            img = XLImage(io.BytesIO(logo_png)); img.width, img.height = 218, 36
            img.anchor = f"A{self.row}"; self.ws.add_image(img)
        self._advance(30, 1); self._advance(DEFAULT_ROW_PT, 6)
        self._text(title, size=22, bold=True, color=NAVY, align="center"); self._advance(40)
        self._text("Structural Review Report for Module Unit Lifting", size=11, color=GRAY, align="center"); self._advance(20)
        self._advance(DEFAULT_ROW_PT, 3)
        for k, v in facts:
            self._text(k, 3, 5, size=10, bold=True, color=GRAY, align="right"); self._text(v, 6, 10, size=10.5)
            self._advance(20)
        self._advance(DEFAULT_ROW_PT, 3)
        self._text("핵심 판정", size=10, bold=True, color=GRAY, align="center"); self._advance(18)
        span = COLS // max(1, len(verdicts)); c = 1
        for label, value, status in verdicts:
            self._text(label, c, c + span - 1, size=9, color=GRAY, align="center", fill=LIGHT, border=True); c += span
        self._advance(18); c = 1
        for label, value, status in verdicts:
            self._text(value, c, c + span - 1, size=16, bold=True, align="center",
                       fill=STATUS_FILL.get(str(status).lower(), LIGHT), border=True); c += span
        self._advance(34)
        self.page_break()

    def toc_placeholder(self, n_entries: int):
        self._text("목차 (Contents)", size=14, bold=True, color=NAVY); self._advance(24)
        self._toc_row = self.row
        self._advance(DEFAULT_ROW_PT, n_entries)
        self.page_break()

    def toc_fill(self, entries: Sequence[tuple[str, int]]):
        assert self._toc_row is not None, "toc_placeholder 를 먼저 호출해야 한다"
        for i, entry in enumerate(entries):      # (text, page) 또는 (text, page, level)
            r = self._toc_row + i
            text, page = entry[0], entry[1]
            level = entry[2] if len(entry) > 2 else 0
            self._text(("    " * level) + text, 1, 11, row=r, size=9.5, bold=(level == 0))
            cell = self.ws.cell(row=r, column=COLS, value=page)
            cell.font = Font(name=FONT, size=9.5); cell.alignment = Alignment(horizontal="right")

    def chapter(self, key: str, text: str) -> int:
        if self.row > 1:
            self.page_break()
        self.chapter_pages[key] = self.page
        self._text(text, size=15, bold=True, color=NAVY); self._advance(28)
        cell = self._merge(1, COLS); cell.border = Border(bottom=Side(style="medium", color=NAVY)); self._advance(4)
        self._advance(DEFAULT_ROW_PT, 1)
        return self.page

    def section(self, text: str) -> int:
        self._advance(DEFAULT_ROW_PT, 1)
        self._text(text, size=11.5, bold=True, color=NAVY); self._advance(20)
        return self.page

    def subsection(self, text: str):
        self._text(text, size=10, bold=True); self._advance(17)

    def para(self, text: str, size: float = 9.5, color: str = "18242F"):
        lines = self._lines(text, COLS, size)
        self._text(text, size=size, color=color); self._advance(max(DEFAULT_ROW_PT, 13.5 * lines))

    def bullet(self, text: str):
        lines = self._lines(text, COLS - 1, 9.5)
        self._text("•", 1, 1, align="center"); self._text(text, 2, COLS)
        self._advance(max(DEFAULT_ROW_PT, 13.5 * lines))

    def note(self, text: str):
        self.para(text, size=8.5, color=GRAY)

    def kv(self, rows: Sequence[tuple[str, str]], key_cols: int = 4):
        for k, v in rows:
            lines = self._lines(v, COLS - key_cols, 9.5)
            self._text(k, 1, key_cols, size=9, bold=True, fill=LIGHT, border=True)
            self._text(v, key_cols + 1, COLS, size=9.5, border=True)
            self._advance(max(16, 13.5 * lines))
        self._advance(DEFAULT_ROW_PT, 1)

    def table(self, headers: Sequence[str], rows: Iterable[Sequence], widths: Sequence[int], align: Optional[Sequence[str]] = None,
              status_col: Optional[int] = None, number_format: str = "#,##0.###", title: Optional[str] = None) -> int:
        """widths 합계는 COLS 이하. status_col 열의 값(OK/NG/PASS/WARN/FAIL) 에 배경색."""
        assert sum(widths) <= COLS, f"표 폭 초과: {widths}"
        if title:
            self._tbl_no += 1
            self._text(f"표 {self._tbl_no}. {title}", size=9, bold=True, color=GRAY); self._advance(16)
        c = 1
        for h, w in zip(headers, widths):
            self._text(h, c, c + w - 1, size=9, bold=True, align="center", fill=LIGHT, border=True); c += w
        self._advance(18)
        n = 0
        for r in rows:
            c = 1
            for i, (v, w) in enumerate(zip(r, widths)):
                a = (align[i] if align else ("right" if isinstance(v, (int, float)) else "left"))
                fill = STATUS_FILL.get(str(v).lower()) if (status_col is not None and i == status_col) else None
                cell = self._text(v, c, c + w - 1, size=9, align=a, wrap=False, fill=fill, border=True)
                if isinstance(v, float):
                    cell.number_format = number_format
                c += w
            self._advance(15.5); n += 1
        if n == 0:
            self._text("(해당 없음)", size=9, color=GRAY, align="center", border=True); self._advance(15.5)
        self._advance(DEFAULT_ROW_PT, 1)
        return self._tbl_no

    def figure(self, png: bytes, caption: str, width_px: int = 640, height_px: int = 410) -> int:
        self._fig_no += 1
        rows_needed = -(-height_px // 20)                # 1행 ≈ 20px
        if self._page_pt + rows_needed * DEFAULT_ROW_PT + 30 > PAGE_PT:
            self.page_break()
        img = XLImage(io.BytesIO(png)); img.width, img.height = width_px, height_px
        img.anchor = f"A{self.row}"; self.ws.add_image(img)
        self._advance(DEFAULT_ROW_PT, rows_needed)
        self._text(f"그림 {self._fig_no}. {caption}", size=8.5, color=GRAY, align="center"); self._advance(16)
        self._advance(DEFAULT_ROW_PT, 1)
        return self._fig_no

    def placeholder(self, caption: str, reason: str):
        """그림 렌더 실패 자리표시."""
        self._fig_no += 1
        self._text(f"[그림 {self._fig_no} 렌더 실패] {reason}", size=9, color="B00020", align="center", fill=LIGHT, border=True)
        self._advance(40)
        self._text(f"그림 {self._fig_no}. {caption}", size=8.5, color=GRAY, align="center"); self._advance(16)
```

- [ ] **Step 4: 통과 확인**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_lifting_report_sheet.py -q --noconftest`
Expected: `5 passed`. `test_chapter_starts_new_page_and_records_page` 가 (2, 3) 이 아니면 `page_break()` 의 `self.page += 1` 과 `chapter()` 의 `if self.row > 1` 순서를 확인.

- [ ] **Step 5: 커밋 준비 보고** — `sheet.py`, `tests/test_unit_lifting_report_sheet.py`

---

### Task 5: builder + 진입점 + 서비스 껍데기 + 라우트 계약

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/unit_lifting_report/builder.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/unit_lifting_report/__init__.py`
- Rewrite: `HiTessWorkBenchBackEnd/app/services/unit_lifting_report_service.py`
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py:2989-3049` (`create_unit_structural_report`)
- Test: `HiTessWorkBenchBackEnd/tests/test_unit_lifting_report_builder.py`, `tests/test_unit_lifting_report_service.py`(재작성)

- [ ] **Step 1: builder 테스트 작성**

```python
import io
import os
import pytest
from openpyxl import load_workbook

from app.services.unit_lifting_report.collector import collect, ReportOptions
from app.services.unit_lifting_report import figures
from app.services.unit_lifting_report.builder import build_workbook, toc_entries

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"


def _info(folder=FIX):
    return {"nastranResultJson": os.path.join(folder, f"{STEM}_lifting_nastranResult.json"),
            "stabilityJson": os.path.join(folder, f"{STEM}_stability.json"),
            "liftingMetaJson": os.path.join(folder, f"{STEM}_lifting_meta.json"),
            "bdf": os.path.join(folder, f"{STEM}.bdf")}


@pytest.fixture(scope="module")
def built():
    data = collect(_info(), ReportOptions(author="A476854", department="구조기본설계부", drawing_no="D-001"), "2026-09-07 15:00")
    figs, errors = figures.render_all_safe(data)
    wb = build_workbook(data, figs, errors)
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return data, load_workbook(buf)


def test_sheets_present(built):
    _, wb = built
    assert wb.sheetnames == ["Report", "Members", "Displacements", "Wires"]
    assert wb["Members"].max_row == 61            # 헤더 + 60
    assert wb["Wires"].max_row == 8


def test_cover_summary_and_verdict_text(built):
    data, wb = built
    vals = [str(c.value) for row in wb["Report"].iter_rows() for c in row if c.value is not None]
    joined = "\n".join(vals)
    assert "Module Unit 권상 구조 검토 보고서" in joined
    assert "HULL NO." in joined and "3496" in joined
    assert "허용응력을 초과하는 부재는 없습니다" in joined
    assert "145.76" in joined and "23.52" in joined
    assert "자료 없음" not in joined                  # fixture 는 7종 모두 있음


def test_toc_pages_monotonic(built):
    data, wb = built
    ws = wb["Report"]
    entries = toc_entries(data)
    toc_rows = [r for r in ws.iter_rows(min_row=1, max_row=80) if r[0].value and str(r[0].value).strip().startswith("1. 개요")]
    assert toc_rows, "목차에 1장 항목이 있어야 한다"
    start = toc_rows[0][0].row
    pages = [ws.cell(row=start + i, column=12).value for i in range(len(entries))]
    assert all(isinstance(p, int) for p in pages)
    chapter_pages = [p for (t, _lvl), p in zip(entries, pages) if _lvl == 0]
    assert chapter_pages == sorted(chapter_pages)


def test_missing_optional_json_writes_placeholder(tmp_path):
    import shutil
    for name in ("_lifting_nastranResult.json", "_stability.json", "_lifting_meta.json"):
        shutil.copy(os.path.join(FIX, f"{STEM}{name}"), tmp_path / f"{STEM}{name}")
    data = collect(_info(str(tmp_path)), ReportOptions())
    figs, errors = figures.render_all_safe(data)
    wb = build_workbook(data, figs, errors)
    vals = "\n".join(str(c.value) for row in wb["Report"].iter_rows() for c in row if c.value is not None)
    assert "자료 없음" in vals
    assert wb["Members"].max_row == 61
```

- [ ] **Step 2: 실패 확인**

Run: `cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_lifting_report_builder.py -q --noconftest`
Expected: `ImportError ... builder`

- [ ] **Step 3: builder.py 구현**

```python
"""장 순서대로 ReportSheet 에 써 넣는다. 두 패스(1패스로 장 쪽번호 확정 → 2패스로 목차 채움)."""
from __future__ import annotations

import os
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill

from .collector import ReportData, _fmt
from .sheet import ReportSheet, FONT, LIGHT

LOGO_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "templates", "hd_logo.png"))
STATUS_KO = {"pass": "PASS", "warn": "WARN", "fail": "FAIL", "skip": "SKIP", "OK": "OK", "NG": "NG"}


def toc_entries(d: ReportData) -> list[tuple[str, int]]:
    """(제목, level). level 0 = 장. 데이터에 따라 절이 달라지므로 builder 와 같은 규칙으로 만든다."""
    e = [("요약 (Summary)", 0),
         ("1. 개요", 0), ("1.1 목적", 1), ("1.2 검토 범위", 1), ("1.3 입력 자료", 1), ("1.4 소프트웨어", 1), ("1.5 판정 기준", 1),
         ("2. 해석 모델", 0), ("2.1 모델 개요", 1), ("2.2 중량 및 무게중심", 1), ("2.3 재료 및 단면", 1), ("2.4 모델 편집 이력", 1),
         ("3. 권상 위치 선정 및 자세 안정성", 0), ("3.1 권상 그룹 및 러그 절점", 1), ("3.2 권상 위치 선정 근거", 1),
         ("3.3 자세 안정성 단계별 판정", 1), ("3.4 정점 및 와이어 기하", 1), ("3.5 전도 여유", 1),
         ("4. 하중 및 경계조건", 0), ("4.1 하중", 1), ("4.2 와이어 모델링", 1), ("4.3 경계조건", 1), ("4.4 안정화 파라미터", 1), ("4.5 해석 조건 및 진단", 1),
         ("5. 해석 결과", 0), ("5.1 변위", 1), ("5.2 부재 응력", 1), ("5.3 와이어 장력 및 반력", 1)]
    if d.edits and d.edits.support_beams:
        e.append(("5.4 가서포트", 1))
    e += [("6. 결론", 0), ("부록 A. 단면 물성", 0), ("부록 B. 기호", 0), ("부록 C. 해석 로그 요약", 0)]
    return e


def build_workbook(d: ReportData, figs: dict[str, bytes], fig_errors: Optional[dict[str, str]] = None) -> Workbook:
    fig_errors = fig_errors or {}
    logo = open(LOGO_PATH, "rb").read() if os.path.isfile(LOGO_PATH) else None
    entries = toc_entries(d)
    pages = _write(Workbook(), d, figs, fig_errors, logo, entries, None)   # 1패스
    wb = Workbook()
    _write(wb, d, figs, fig_errors, logo, entries, pages)                   # 2패스
    _data_sheets(wb, d)
    return wb


def _write(wb, d, figs, errs, logo, entries, pages):
    s = ReportSheet(wb.active, header=f"HULL {d.identity.hull_no} / UNIT {d.identity.unit_no} / {d.identity.lifting_method}")
    i, r, v = d.identity, d.results, d.verdicts
    title = f"{i.title_prefix} 권상 구조 검토 보고서"
    s.cover(title, [("HULL NO.", i.hull_no), ("UNIT NO.", i.unit_no), ("도면 번호", i.drawing_no), ("권상 방식", f"{i.lifting_method} ({i.equipment or 'Hook'})"),
                    ("리비전", f"Rev. {i.revision}"), ("작성", f"{i.author} / {i.department}"), ("작성일", i.generated_at)],
            [("구조 판정", v.structure, "ok" if v.structure == "OK" else ("ng" if v.structure == "NG" else "skip")),
             ("자세 안정성", STATUS_KO.get(v.stability, v.stability.upper()), v.stability),
             ("국부변형 방지 지그", "필요" if v.jig_required else "불요", "warn" if v.jig_required else "ok")], logo_png=logo)
    sec_pages: dict[str, int] = {}
    def sec(text):
        sec_pages[text] = s.section(text)
    def fig(key, caption, w=640, h=410):
        if key in figs: s.figure(figs[key], caption, w, h)
        elif key in errs: s.placeholder(caption, errs[key])
    def none_note(what):
        s.note(f"자료 없음 — {what} 파일이 결과 폴더에 없어 이 절은 생략되었습니다.")

    # ── 요약 ────────────────────────────────────────────────────────────────
    sec_pages["요약 (Summary)"] = s.chapter("summary", "요약 (Summary)")
    s.table(["중량 [ton]", "항복강도 [MPa]", "허용응력 [MPa]", "최대응력 [MPa]", "최대변위 [mm]", "판정"],
            [[round(d.model.total_mass_ton, 3), round(r.yield_mpa, 1), round(r.allowable_mpa, 1),
              f"{r.max_stress_mpa:.2f} (E{r.max_stress_element_id})", f"{r.max_displacement_mm:.2f} (N{r.max_displacement_node_id})", v.structure]],
            widths=[2, 2, 2, 2, 2, 2], status_col=5, title="검토 요약")
    s.note(f"허용응력 = 항복강도 × 0.8. 하중 = 자중 × 안전계수 {d.loads.safety_factor:g}. 변위는 참고치(판정 없음).")
    s.table(["Hook/Trolley", "와이어 수", "장력 합 [ton]", "수직 반력 합 [ton]"],
            [[f"G{h.group_id}", h.wire_count, round(h.tension_ton, 3), round(h.vertical_ton, 3)] for h in r.hook_totals]
            + [["합계", sum(h.wire_count for h in r.hook_totals), round(sum(h.tension_ton for h in r.hook_totals), 3), round(sum(h.vertical_ton for h in r.hook_totals), 3)]],
            widths=[3, 3, 3, 3], title="Hook 별 반력 요약")
    if r.hook_check_error_pct is not None:
        s.note(f"검산: Σ수직반력 {sum(h.vertical_ton for h in r.hook_totals):.3f} ton vs 설계하중 {d.loads.total_load_ton:.3f} ton (오차 {r.hook_check_error_pct:+.1f} %).")
    s.subsection("먼저 확인할 사항")
    for a in (v.actions[:3] or ["조치가 필요한 항목이 없습니다."]):
        s.bullet(a)

    # ── 목차 ────────────────────────────────────────────────────────────────
    s.toc_placeholder(len(entries))

    # ── 1. 개요 ─────────────────────────────────────────────────────────────
    sec_pages["1. 개요"] = s.chapter("1", "1. 개요")
    sec("1.1 목적")
    s.para(f"본 보고서는 {i.title_prefix}(HULL {i.hull_no}, UNIT {i.unit_no})의 {i.lifting_method} 권상 시 구조 안전성을 검토한 결과를 기술한다. "
           "권상 위치 선정과 자세 안정성 평가, 와이어를 포함한 선형 정적 구조 해석의 입력·가정·결과를 한 문서로 정리하여 검토자가 별도 자료 없이 판정 근거를 확인할 수 있게 한다.")
    sec("1.2 검토 범위")
    s.kv([("권상 방식", f"{i.lifting_method} ({i.equipment or 'Hook'})"), ("권상 그룹 수", f"{i.group_count} (Hook/Trolley)"), ("와이어 길이", f"{i.wire_length_m:g} m"),
          ("안전계수", f"{d.loads.safety_factor:g}"), ("해석 종류", d.loads.solver)])
    sec("1.3 입력 자료")
    s.kv([("원본 BDF", i.source_bdf or "-"), ("해석 모델(편집본)", i.edited_model or "-"), ("결과 생성 시각", i.generated_at), ("비고", i.notes or "-")])
    sec("1.4 소프트웨어")
    s.kv([("플랫폼", "Hi-TESS WorkBench / Module Unit Studio"), ("자세안정성 엔진", i.engine_version or "ModuleAnalysis.Stability"),
          ("BDF 생성·결과 매핑", "NastranBridge (LiftingBdfBuild / LiftingResultMapper)"), ("해석기", d.loads.solver)])
    sec("1.5 판정 기준")
    s.table(["항목", "기준", "비고"],
            [["부재 응력", f"σmax ≤ σ허용 = σy × 0.8 = {r.allowable_mpa:g} MPa", f"σy = {r.yield_mpa:g} MPa"],
             ["와이어 장력", f"장력 > {d.options.jig_limit_ton:g} ton 이면 국부 변형 방지 지그 필요", "장력 = |축력| / 9,800 N/ton"],
             ["와이어 건전성", "압축·슬랙 와이어 없어야 함", "CROD 축력 부호"],
             ["자세 안정성", "엔진 7단계 종합 판정 (FAIL 이면 권상 불가)", "Strict 평가 " + ("ON" if d.stability.strict_evaluation else "OFF")],
             ["변위", "참고치 (판정 없음)", "최대 변위 절점·성분 기록"]], widths=[3, 6, 3], title="판정 기준")

    # ── 2. 해석 모델 ─────────────────────────────────────────────────────────
    m = d.model
    sec_pages["2. 해석 모델"] = s.chapter("2", "2. 해석 모델")
    sec("2.1 모델 개요")
    s.kv([("절점 / 요소", f"{m.node_count:,} / {m.element_count:,} (RBE2 {m.rigid_count:,}, 집중질량 {m.point_mass_count:,})"),
          ("단면(PID) / 재료", f"{m.property_count} / {m.material_count}"),
          ("외형 치수 (X × Y × Z)", f"{m.size_mm[0]:,.0f} × {m.size_mm[1]:,.0f} × {m.size_mm[2]:,.0f} mm"),
          ("좌표 범위", f"X {m.bbox['minX']:,.0f}~{m.bbox['maxX']:,.0f} · Y {m.bbox['minY']:,.0f}~{m.bbox['maxY']:,.0f} · Z {m.bbox['minZ']:,.0f}~{m.bbox['maxZ']:,.0f}"),
          ("입력 검증", f"{(m.validation_status or '-').upper()} · 자유단 절점 {m.free_end_nodes if m.free_end_nodes is not None else '-'} · 분리 그룹 {m.disconnected_groups if m.disconnected_groups is not None else '-'}")])
    fig("model_plan", "해석 모델 평면도 (XY)"); fig("model_side", "해석 모델 측면도 (XZ)"); fig("model_iso", "해석 모델 등각도")
    sec("2.2 중량 및 무게중심")
    c = m.cog_mm
    s.kv([("총 중량", f"{m.total_mass_ton:.3f} ton ({m.mass_source or '-'})"),
          ("무게중심 (X, Y, Z)", f"({c.get('x', 0):,.1f}, {c.get('y', 0):,.1f}, {c.get('z', 0):,.1f}) mm")])
    if m.point_masses:
        s.table(["CONM2 ID", "절점", "질량 [ton]"], [[p.get("id"), p.get("nodeId"), float(p.get("mass") or 0)] for p in m.point_masses[:40]],
                widths=[4, 4, 4], title=f"집중질량 목록 (상위 {min(40, len(m.point_masses))}개 / 총 {len(m.point_masses)})")
    sec("2.3 재료 및 단면")
    s.table(["MID", "이름", "E [MPa]", "ν", "ρ [ton/mm³]"], [[x.mid, x.name, x.e_mpa, x.nu, x.rho] for x in m.materials], widths=[2, 3, 3, 2, 2], title="재료")
    s.table(["PID", "단면", "치수 [mm]", "면적 [mm²]", "MID"],
            [[x.pid, f"{x.card} {x.kind}", ", ".join(_fmt(v) for v in x.dims), round(x.area_mm2, 1) if x.area_mm2 else "-", x.material_id] for x in m.sections],
            widths=[1, 3, 4, 2, 2], title="단면 목록")
    sec("2.4 모델 편집 이력")
    if d.edits:
        e = d.edits
        s.kv([("삭제 요소 / 강체 / 절점", f"{e.deleted_element_count} / {e.deleted_rigid_count} / {e.deleted_node_count}"),
              ("가서포트 추가", f"{len(e.support_beams)}개"), ("제거된 원본 경계조건", f"SPC 계열 {e.removed_spc_cards}장 · SUPORT {e.removed_suport_cards}장 (권상 해석은 정점 SPC 만 사용)")])
        if e.support_beams:
            s.table(["No.", "요소 ID", "절점 A", "절점 B", "길이 [mm]", "단면 치수"],
                    [[k + 1, sb.element_id, sb.start_node, sb.end_node, round(sb.length_mm, 0), ", ".join(_fmt(v) for v in sb.dims)] for k, sb in enumerate(e.support_beams)],
                    widths=[1, 2, 2, 2, 2, 3], title="가서포트 목록")
    else:
        none_note("편집 모델(_edited.json) 또는 원본 json")

    # ── 3. 권상 위치·자세 안정성 ─────────────────────────────────────────────
    st, h = d.stability, d.hoist
    sec_pages["3. 권상 위치 선정 및 자세 안정성"] = s.chapter("3", "3. 권상 위치 선정 및 자세 안정성")
    sec("3.1 권상 그룹 및 러그 절점")
    if h:
        rows = []
        for g in h.groups:
            for n in (g.nodes or [{"id": nid} for nid in g.node_ids]):
                rows.append([f"G{g.group_id}", n.get("id"), n.get("x", "-"), n.get("y", "-"), n.get("z", "-")])
        s.table(["그룹", "러그 절점", "X [mm]", "Y [mm]", "Z [mm]"], rows, widths=[2, 2, 3, 3, 2], title="권상 그룹별 러그 절점")
    else:
        s.table(["그룹", "러그 절점"], [[f"G{a.get('groupId')}", ", ".join(str(n) for n in a.get("assignedNodeIds", []))] for a in st.apexes], widths=[3, 9], title="권상 그룹")
    fig("hoist_plan", "권상 배치 평면도 — 러그·정점·와이어·COG"); fig("hoist_side", "권상 배치 측면도")
    sec("3.2 권상 위치 선정 근거")
    if h:
        if h.auto_selected:
            s.para(f"권상 위치는 엔진 최적화(후보 {h.candidate_count:,}개 조립, {h.evaluated_count:,}개 평가, {h.elapsed_ms / 1000:.1f} s)로 자동 선정되었다. "
                   f"평가 결과 PASS {h.pass_count:,} / WARN {h.warn_count:,} / FAIL {h.fail_count:,} 중 '{h.best_label}' (점수 {h.best_score:,.0f}) 이 선택되었다.")
        else:
            s.para("권상 위치는 사용자가 Studio 에서 직접 지정하였다(최적화 결과와 다름). 아래 표는 참고용 최적화 지표다.")
        keys = [("stage6Status", "전도 판정"), ("stage6MarginMm", "전도 여유 [mm]"), ("minSlingAngleDeg", "최소 슬링각 [°]"), ("wireConflictCount", "와이어 간섭 [건]"),
                ("supportSpanFraction", "지지 폭 비율"), ("evaluationMode", "평가 방식")]
        s.table(["지표", "최적(선정)", "이전(current)"], [[k2, h.best_metrics.get(k, "-"), h.current_metrics.get(k, "-")] for k, k2 in keys], widths=[4, 4, 4], title="선정 지표 비교")
    else:
        none_note("권상 위치 최적화(_hoist_optimization.json)")
    sec("3.3 자세 안정성 단계별 판정")
    s.para(f"종합 판정: {STATUS_KO.get(st.overall_status, st.overall_status)} — {st.primary_message}")
    if st.shape_gate_relaxed:
        s.note("Strict 평가 OFF: 1·2단계 형상 판정이 FAIL 대신 WARN 으로 완화되어 평가되었다(3단계 wire≤0, 6단계 전도는 완화 없음).")
    s.table(["단계", "항목", "판정", "핵심 수치", "비고"], [[x.stage, x.label, STATUS_KO.get(x.status, x.status), x.key_metric, x.note] for x in st.stage_rows],
            widths=[1, 3, 1, 5, 2], status_col=2, title="자세 안정성 7단계 판정")
    for w in st.warnings:
        s.bullet(f"[{w.get('stage')}단계 · {w.get('target', '')}] {w.get('headline', '')} — {w.get('message', '')}")
    sec("3.4 정점 및 와이어 기하")
    s.table(["그룹", "정점 X", "정점 Y", "정점 Z", "연결 러그"], [[f"G{a.get('groupId')}", a['pointMm']['x'], a['pointMm']['y'], a['pointMm']['z'], ", ".join(f"N{n}" for n in a.get("assignedNodeIds", []))] for a in st.apexes],
            widths=[1, 2, 2, 2, 5], title="권상 정점(Hook/Trolley) 좌표 [mm]")
    s.table(["그룹", "러그", "길이 [mm]", "슬링각 [°]", "상태"], [[f"G{w.group_id}", f"N{w.lug_node_id}", round(w.length_mm, 1), round(w.angle_deg, 2), "pass" if w.safe else "warn"] for w in st.wires],
            widths=[2, 2, 3, 3, 2], status_col=4, title=f"와이어 기하 (최소 슬링각 {st.min_sling_angle_deg if st.min_sling_angle_deg is not None else '-'}°)")
    sec("3.5 전도 여유")
    if st.tipping:
        t = st.tipping
        s.kv([("평가 방식", t.evaluation_mode), ("안정 여부", "안정" if t.is_stable else "불안정"), ("전도 여유 / 내부 여유", f"{t.margin_mm:,.1f} / {t.interior_margin_mm:,.1f} mm"),
              ("COG 편차 / 임계", f"{t.deviation_mm:,.1f} / {t.threshold_mm:,.1f} mm"), ("COG 지지영역 내부", "예" if t.cog_inside else "아니오"),
              ("경사각", f"{t.tilt_deg:.2f}°"), ("정점–COG 높이", f"{t.apex_to_cog_mm:,.1f} mm")])
    else:
        none_note("6단계 전도 평가 결과")

    # ── 4. 하중·경계조건 ─────────────────────────────────────────────────────
    L = d.loads
    sec_pages["4. 하중 및 경계조건"] = s.chapter("4", "4. 하중 및 경계조건")
    sec("4.1 하중")
    s.kv([("중력 가속도", f"{L.gravity_mm_s2:g} mm/s² (−Z), GRAV SID {L.grav_sid}"), ("안전계수", f"{L.safety_factor:g} (LOAD SID {L.load_sid} 로 배율)"),
          ("설계 하중", f"{d.model.total_mass_ton:.3f} ton × {L.safety_factor:g} = {L.total_load_ton:.3f} ton")])
    sec("4.2 와이어 모델링")
    s.kv([("요소", f"CROD, PID {L.wire_pid}{' (충돌 회피 재배정)' if L.wire_pid_remapped else ''}, MID {L.wire_mid}{' (충돌 회피 재배정)' if L.wire_mid_remapped else ''}"),
          ("단면", f"A = {L.wire_area_mm2:,.0f} mm², J = {L.wire_j_mm4:,.0f} mm⁴"), ("재료", f"E = {L.wire_e_mpa:,.0f} MPa"),
          ("연결", "각 러그 절점 ↔ 그룹 정점 절점, 축력만 전달")])
    sec("4.3 경계조건")
    s.kv([("정점 구속", f"SPC SID {L.spc_sid}, 성분 {L.spc_components}"),
          ("강체 운동 방지 앵커", f"절점 {L.anchor_node_id} 성분 {L.anchor_components} (COG 로부터 {_fmt(L.anchor_distance_mm)} mm)" if L.anchor_node_id else "미적용"),
          ("원본 경계조건", "권상 해석에서는 원본 SPC/SUPORT 를 모두 제거하고 위 조건만 사용")])
    sec("4.4 안정화 파라미터")
    s.para(L.stabilization_reason or "-")
    for card in L.stabilization_cards: s.bullet(card)
    sec("4.5 해석 조건 및 진단")
    f = L.f06
    s.kv([("해석", f"{L.solver}, SUBCASE {L.subcase_id}"),
          ("F06 진단", f"FATAL {f.get('fatalCount', 0)} · ERROR {f.get('errorCount', 0)}" if f.get("available") else "F06 파일 없음")])
    for smp in (f.get("fatalSamples") or [])[:3]: s.note(smp)

    # ── 5. 해석 결과 ─────────────────────────────────────────────────────────
    sec_pages["5. 해석 결과"] = s.chapter("5", "5. 해석 결과")
    sec("5.1 변위")
    t1, t2, t3 = r.max_displacement_components
    s.kv([("최대 변위", f"{r.max_displacement_mm:.3f} mm @ 절점 {r.max_displacement_node_id}"), ("성분 (T1, T2, T3)", f"({t1:.3f}, {t2:.3f}, {t3:.3f}) mm"),
          ("평가", "참고치 — 판정 기준 없음")])
    s.table(["절점", "T1 [mm]", "T2 [mm]", "T3 [mm]", "크기 [mm]"], [[x.node_id, round(x.t1, 3), round(x.t2, 3), round(x.t3, 3), round(x.magnitude, 3)] for x in r.top_displacements],
            widths=[2, 2, 2, 2, 4], title="변위 상위 10 절점")
    fig("deformed_iso", "변형 형상 (배율 자동)")
    sec("5.2 부재 응력")
    if r.exceeding:
        s.para(f"허용응력 {r.allowable_mpa:g} MPa 를 초과하는 부재가 {len(r.exceeding)}개 있다.")
        s.table(["요소", "PID", "단면", "σmax [MPa]", "활용도", "판정"], [[x.element_id, x.pid, x.section_label, round(x.stress_mpa, 2), round(x.utilization or 0, 3), "NG"] for x in r.exceeding],
                widths=[1, 1, 5, 2, 2, 1], status_col=5, title="허용응력 초과 부재 (전량)")
    else:
        s.para(f"허용응력을 초과하는 부재는 없습니다 (검사 부재 {r.member_count:,}개, 최대 활용도 {(r.governing[0].utilization if r.governing else 0):.3f}).")
    s.table(["순위", "요소", "PID", "단면", "σmax [MPa]", "활용도"], [[k + 1, x.element_id, x.pid, x.section_label, round(x.stress_mpa, 2), round(x.utilization or 0, 3)] for k, x in enumerate(r.governing)],
            widths=[1, 1, 1, 5, 2, 2], title=f"지배 부재 상위 {len(r.governing)}")
    s.table(["PID", "단면", "부재 수", "최대 σ [MPa]", "최대 활용도", "지배 요소"], [[p.pid, p.section_label, p.count, round(p.max_stress_mpa, 2), round(p.max_utilization, 3), p.governing_element_id] for p in r.pid_summary],
            widths=[1, 5, 1, 2, 2, 1], title="단면(PID)별 요약")
    fig("utilization_hist", "부재 활용도 분포", 640, 290); fig("stress_plan", "부재 응력 활용도 — 평면도"); fig("stress_iso", "부재 응력 활용도 — 등각도")
    sec("5.3 와이어 장력 및 반력")
    s.table(["그룹", "러그", "축력 [N]", "장력 [ton]", "슬링각 [°]", "수직반력 [ton]", "지그", "상태"],
            [[f"G{w.group_id}", f"N{w.lug_node_id}", round(w.axial_force_n, 1), round(w.tension_ton, 3), round(w.angle_deg, 2) if w.angle_deg is not None else "-",
              round(w.vertical_ton, 3) if w.vertical_ton is not None else "-", "필요" if w.needs_jig else "불요",
              "NG" if (w.is_compression or w.is_slack) else "OK"] for w in r.wires], widths=[1, 1, 2, 2, 1, 2, 1, 2], status_col=7,
            title=f"와이어별 장력·반력 (지그 기준 {d.options.jig_limit_ton:g} ton)")
    s.table(["Hook/Trolley", "와이어 수", "장력 합 [ton]", "수직 반력 합 [ton]"], [[f"G{x.group_id}", x.wire_count, round(x.tension_ton, 3), round(x.vertical_ton, 3)] for x in r.hook_totals],
            widths=[3, 3, 3, 3], title="Hook 별 합계")
    if r.hook_check_error_pct is not None:
        s.note(f"검산: Σ수직반력 / (중량 × SF) − 1 = {r.hook_check_error_pct:+.1f} % (슬링각 산정과 와이어 자중 무시에 따른 차이).")
    if d.edits and d.edits.support_beams:
        sec("5.4 가서포트")
        sup_ids = {sb.element_id for sb in d.edits.support_beams}
        s.table(["요소", "단면", "σmax [MPa]", "활용도"], [[x.element_id, x.section_label, round(x.stress_mpa, 2), round(x.utilization or 0, 3)] for x in r.all_members if x.element_id in sup_ids],
                widths=[2, 6, 2, 2], title="가서포트 부재 응력")
        fig("support_plan", "가서포트 배치 — 평면도"); fig("support_iso", "가서포트 배치 — 등각도")

    # ── 6. 결론 ──────────────────────────────────────────────────────────────
    sec_pages["6. 결론"] = s.chapter("6", "6. 결론")
    s.para(f"구조 판정: {v.structure} — 최대 응력 {r.max_stress_mpa:.2f} MPa (요소 {r.max_stress_element_id}) / 허용 {r.allowable_mpa:g} MPa, 초과 부재 {r.exceed_count}개.")
    s.para(f"자세 안정성: {STATUS_KO.get(v.stability, v.stability)} — {st.primary_message}")
    s.para(f"국부 변형 방지 지그: {'필요' if v.jig_required else '불요'} (기준 {d.options.jig_limit_ton:g} ton, 최대 와이어 장력 {max((w.tension_ton for w in r.wires), default=0):.3f} ton).")
    s.subsection("조치 필요 사항")
    for a in (v.actions or ["없음"]): s.bullet(a)
    s.subsection("근거와 한계")
    for line in ("선형 정적 해석(SOL 101)이며 동적 계수·충격은 안전계수에 포함된 것으로 간주한다.",
                 "와이어는 축력만 전달하는 CROD 로 이상화하였고 와이어 자중·탄성 신장에 따른 각도 변화는 무시하였다.",
                 "허용응력은 항복강도 × 0.8 의 사내 기준을 적용하였다. 좌굴·용접부·러그 국부 강도는 본 검토 범위 밖이다.",
                 "자세 안정성은 강체 가정의 기하 평가이며 구조 해석 결과와 독립적으로 판정한다."):
        s.bullet(line)

    # ── 부록 ─────────────────────────────────────────────────────────────────
    sec_pages["부록 A. 단면 물성"] = s.chapter("A", "부록 A. 단면 물성")
    s.table(["PID", "카드", "종류", "치수 [mm]", "면적 [mm²]", "MID"], [[x.pid, x.card, x.kind, ", ".join(_fmt(vv) for vv in x.dims), round(x.area_mm2, 1) if x.area_mm2 else "-", x.material_id] for x in m.sections],
            widths=[1, 2, 1, 4, 2, 2])
    sec_pages["부록 B. 기호"] = s.chapter("B", "부록 B. 기호")
    s.table(["기호", "의미"], [["σmax", "요소 내 모든 응력점·양단 중 |σ| 최대"], ["σy / σ허용", "항복강도 / 허용응력 (= σy × 0.8)"], ["활용도", "σmax / σ허용"],
                               ["SF", "안전계수 (하중 배율)"], ["슬링각", "와이어와 수평면이 이루는 각"], ["수직반력", "장력 × sin(슬링각)"], ["COG", "무게중심"]], widths=[3, 9])
    sec_pages["부록 C. 해석 로그 요약"] = s.chapter("C", "부록 C. 해석 로그 요약")
    if f.get("available"):
        s.kv([("FATAL", str(f.get("fatalCount", 0))), ("ERROR", str(f.get("errorCount", 0)))])
        for smp in (f.get("fatalSamples") or []) + (f.get("errorSamples") or []): s.note(smp)
    else:
        none_note("F06")
    for w in d.warnings: s.note("※ " + w)

    if pages is not None:
        s.toc_fill([(t, pages.get(t, s.chapter_pages.get(t, 0)), lvl) for t, lvl in entries])
    return {**{t: p for t, p in sec_pages.items()}}


def _data_sheets(wb: Workbook, d: ReportData):
    def sheet(name, headers, rows):
        ws = wb.create_sheet(name)
        ws.append(headers)
        for c in ws[1]:
            c.font = Font(name=FONT, bold=True); c.fill = PatternFill("solid", fgColor=LIGHT); c.alignment = Alignment(horizontal="center")
        for r in rows: ws.append(list(r))
        ws.freeze_panes = "A2"
        for col in ws.columns: ws.column_dimensions[col[0].column_letter].width = 14
    sheet("Members", ["elementId", "pid", "section", "maxStressMPa", "utilization", "exceeds"],
          ((x.element_id, x.pid, x.section_label, x.stress_mpa, x.utilization, x.exceeds) for x in d.results.all_members))
    sheet("Displacements", ["nodeId", "t1", "t2", "t3", "magnitude"], ((x.node_id, x.t1, x.t2, x.t3, x.magnitude) for x in d.results.all_displacements))
    sheet("Wires", ["wireElementId", "groupId", "lugNodeId", "axialForceN", "tensionTon", "angleDeg", "verticalTon", "needsJig", "isCompression", "isSlack"],
          ((x.wire_element_id, x.group_id, x.lug_node_id, x.axial_force_n, x.tension_ton, x.angle_deg, x.vertical_ton, x.needs_jig, x.is_compression, x.is_slack) for x in d.results.wires))
```

> 주의: `toc_entries` 는 `(text, level)` 을 반환하고 `_write` 는 절 제목 문자열을 키로 쪽을 기록한다. 절 제목 문자열은 **두 곳이 글자 단위로 같아야** 목차 쪽이 채워진다(테스트 `test_toc_pages_monotonic` 이 검출).

- [ ] **Step 4: `__init__.py` 진입점**

```python
"""Unit 권상 구조 검토 보고서 — 공개 진입점."""
from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any

from .collector import ReportOptions, collect
from .figures import render_all_safe
from .builder import build_workbook


def generate_unit_lifting_report(result_info: dict[str, Any], options: dict[str, Any] | None = None, *, generated_by: str = "") -> tuple[str, bytes, list[str], dict[str, Any]]:
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
    buf = io.BytesIO(); wb.save(buf)
    i = data.identity
    name = f"{_safe(i.hull_no)}-{_safe(i.unit_no)}_{_safe(i.lifting_method)}_{_safe(i.title_prefix)}_권상_구조_검토_보고서_Rev{_safe(i.revision)}_{now:%Y%m%d}.xlsx"
    summary = {"totalMassTon": data.model.total_mass_ton, "yieldStrengthMPa": data.results.yield_mpa, "allowableMPa": data.results.allowable_mpa,
               "maxDisplacementMm": data.results.max_displacement_mm, "maxStressMPa": data.results.max_stress_mpa,
               "structure": data.verdicts.structure, "stability": data.verdicts.stability, "jigRequired": data.verdicts.jig_required,
               "figureCount": len(figs), "warningCount": len(data.warnings)}
    return name, buf.getvalue(), list(data.warnings), summary


def _safe(v) -> str:
    return re.sub(r'[<>:"/\\|?*\s]+', "_", str(v or "unknown")).strip("_.") or "unknown"
```

- [ ] **Step 5: 서비스 껍데기로 교체** — `app/services/unit_lifting_report_service.py` 전체를 아래로 덮어쓴다:

```python
"""Module Unit 권상 구조 검토 보고서 — 패키지 위임 껍데기.

구현은 app/services/unit_lifting_report/ (collector·figures·sheet·builder). 라우터 import 경로 보존용.
"""
from .unit_lifting_report import generate_unit_lifting_report  # noqa: F401

__all__ = ["generate_unit_lifting_report"]
```

- [ ] **Step 6: 라우트 계약 변경** — `analysis.py` 의 `create_unit_structural_report` 본문에서 `result_path/stability_path` 검사 이후 부분을 교체:

```python
    result_info = record.result_info or {}
    for label, key in (("구조 해석 결과", "nastranResultJson"), ("자세안정성 결과", "stabilityJson")):
        candidate = result_info.get(key)
        if not candidate or not os.path.isfile(candidate):
            raise HTTPException(status_code=409, detail=f"{label} 파일을 찾을 수 없습니다: {candidate}")
        assert_current_user_can_access_path(candidate, current_user, db, _USER_CONNECTION_DIR)

    options = payload.get("options") or {}
    for key in ("jigLimitTon", "yieldStrengthMpa"):
        if key in options and options[key] not in (None, ""):
            try:
                if float(options[key]) <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{key} 는 양수여야 합니다.")
    try:
        file_name, report_bytes, warnings, summary = generate_unit_lifting_report(
            result_info, options, generated_by=current_user,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Unit 권상 보고서 생성 실패: %s", exc)
        raise HTTPException(status_code=500, detail=f"보고서 생성 중 오류가 발생했습니다: {exc}")
```
(기존 `with open(...) json.load` 두 블록과 `payload.get("captures")` 전달 삭제. 헤더/StreamingResponse 는 그대로.)

- [ ] **Step 7: 서비스 테스트 재작성** — `tests/test_unit_lifting_report_service.py` 전체 교체:

```python
import io
import os
from openpyxl import load_workbook

from app.services.unit_lifting_report_service import generate_unit_lifting_report

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"
INFO = {"nastranResultJson": os.path.join(FIX, f"{STEM}_lifting_nastranResult.json"),
        "stabilityJson": os.path.join(FIX, f"{STEM}_stability.json"),
        "liftingMetaJson": os.path.join(FIX, f"{STEM}_lifting_meta.json"),
        "bdf": os.path.join(FIX, f"{STEM}.bdf")}


def test_generate_returns_named_workbook_and_summary():
    name, data, warnings, summary = generate_unit_lifting_report(INFO, {"revision": "A", "department": "구조기본설계부"}, generated_by="A476854")
    assert name.startswith("3496-35210_Hydro_Crane_Module_Unit_권상_구조_검토_보고서_RevA_")
    wb = load_workbook(io.BytesIO(data))
    assert wb.sheetnames == ["Report", "Members", "Displacements", "Wires"]
    assert summary["structure"] == "OK" and summary["stability"] == "warn" and summary["jigRequired"] is False
    assert summary["figureCount"] >= 10
    assert warnings == []


def test_options_override_identity_and_jig():
    name, data, _, summary = generate_unit_lifting_report(INFO, {"hullNo": "9999", "unitNo": "11111", "jigLimitTon": 0.5}, generated_by="X")
    assert name.startswith("9999-11111_")
    assert summary["jigRequired"] is True


def test_missing_required_json_raises():
    import pytest
    with pytest.raises(FileNotFoundError):
        generate_unit_lifting_report({"nastranResultJson": "nope.json", "stabilityJson": "nope.json"}, {})
```

라우트 테스트 `tests/test_unit_lifting_report_route.py` 신규(`switchable_client` 사용 — conftest 가 필요하므로 `--noconftest` 없이 실행; 다른 세션이 `app.main` import 를 깨뜨린 상태면 나중에 실행):

```python
import os
import shutil
from datetime import datetime

from app import models

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "unit_lifting_report")
STEM = "3496-35210-A508372_20260108_edit"


def _record(db, tmp_path, owner="EMP001"):
    for n in ("_lifting_nastranResult.json", "_stability.json", "_lifting_meta.json", "_edited.json", ".json", "_posture.json", "_hoist_optimization.json", "_validation_step1.json"):
        shutil.copy(os.path.join(FIX, f"{STEM}{n}"), tmp_path / f"{STEM}{n}")
    a = models.Analysis(employee_id=owner, program_name="UnitStructuralAnalysis", project_name="t", status="Success", created_at=datetime.now(),
                        result_info={"nastranResultJson": str(tmp_path / f"{STEM}_lifting_nastranResult.json"), "stabilityJson": str(tmp_path / f"{STEM}_stability.json"),
                                     "liftingMetaJson": str(tmp_path / f"{STEM}_lifting_meta.json"), "bdf": str(tmp_path / f"{STEM}.bdf")})
    db.add(a); db.commit(); return a


def test_owner_gets_xlsx(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    a = _record(db_session, tmp_path)
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report", json={"analysisId": a.id, "options": {"revision": "0"}})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert "X-Report-Summary" in res.headers


def test_other_user_forbidden(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    a = _record(db_session, tmp_path, owner="SOMEONE")
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report", json={"analysisId": a.id})
    assert res.status_code == 403


def test_bad_option_rejected(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    a = _record(db_session, tmp_path)
    switchable_client.as_user()
    res = switchable_client.post("/api/analysis/unit-structural/report", json={"analysisId": a.id, "options": {"jigLimitTon": -1}})
    assert res.status_code == 400
```

- [ ] **Step 8: 통과 확인**

```bash
cd HiTessWorkBenchBackEnd
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_lifting_report_builder.py tests/test_unit_lifting_report_service.py -q --noconftest
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_unit_lifting_report_route.py -q     # conftest 필요
```
Expected: 각각 `4 passed`, `3 passed`, `3 passed`. (`assert_current_user_can_access_path` 가 소유자 검사에 폴더 소유자 사번을 쓰면 tmp_path 이름 때문에 403 이 날 수 있다 — 그 경우 라우트 테스트의 tmp 폴더명을 `tmp_path / "20260907_000000_EMP001_GroupModuleUnit"` 하위로 옮긴다.)

- [ ] **Step 9: 실제 결과로 1회 생성해 Excel 확인**

```bash
cd HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -c "
from app.services.unit_lifting_report_service import generate_unit_lifting_report
D=r'userConnection/20260907_145643_A476854_GroupModuleUnit'; S='3496-35210-A508372_20260108_edit'
name,data,w,s=generate_unit_lifting_report({'nastranResultJson':f'{D}/{S}_lifting_nastranResult.json','stabilityJson':f'{D}/{S}_stability.json','liftingMetaJson':f'{D}/{S}_lifting_meta.json','bdf':f'{D}/{S}.bdf'},{'department':'구조기본설계부'},generated_by='A476854')
open(r'C:/Users/HHI/AppData/Local/Temp/claude/C--Coding-WorkBench/d48c1b6a-dbda-4a1a-b083-6723519213d7/scratchpad/'+name,'wb').write(data); print(name, len(data), w, s)"
```
사용자에게 파일 위치를 알려 Excel 인쇄 미리보기로 쪽 나눔·그림 크기·표 폭을 확인받는다. (scratchpad 의 .xlsx 는 DRM 에 걸려도 Excel 은 정상적으로 연다.)

- [ ] **Step 10: 커밋 준비 보고** — `builder.py`, `__init__.py`, `unit_lifting_report_service.py`, `analysis.py`, 테스트 3개

---

### Task 6: artifacts 응답에 `unitStructuralAnalysisId` 추가 (WorkBench 버튼용)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py:2878-2911` (`get_groupmoduleunit_artifacts`)
- Test: `HiTessWorkBenchBackEnd/tests/test_groupmoduleunit_artifacts_unit_id.py`

- [ ] **Step 1: 실패하는 테스트**

```python
import os
from datetime import datetime
from app import models


def test_artifacts_include_latest_success_unit_structural_id(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    folder = tmp_path / "20260907_000000_EMP001_GroupModuleUnit"; folder.mkdir()
    bdf = folder / "m.bdf"; bdf.write_text("CEND\nBEGIN BULK\nENDDATA\n")
    parent = models.Analysis(employee_id="EMP001", program_name="GroupModuleUnit", project_name="p", status="Success",
                             created_at=datetime(2026, 9, 7, 10), input_info={"bdf_model": str(bdf)})
    db_session.add(parent); db_session.commit()
    older = models.Analysis(employee_id="EMP001", program_name="UnitStructuralAnalysis", project_name="u1", status="Success",
                            created_at=datetime(2026, 9, 7, 11), input_info={"parent_analysis_id": parent.id})
    failed = models.Analysis(employee_id="EMP001", program_name="UnitStructuralAnalysis", project_name="u2", status="Failed",
                             created_at=datetime(2026, 9, 7, 13), input_info={"parent_analysis_id": parent.id})
    newest = models.Analysis(employee_id="EMP001", program_name="UnitStructuralAnalysis", project_name="u3", status="Success",
                             created_at=datetime(2026, 9, 7, 12), input_info={"parent_analysis_id": parent.id})
    db_session.add_all([older, failed, newest]); db_session.commit()
    switchable_client.as_user()
    res = switchable_client.get(f"/api/analysis/groupmoduleunit/artifacts/{parent.id}")
    assert res.status_code == 200, res.text
    assert res.json()["unitStructuralAnalysisId"] == newest.id


def test_artifacts_unit_id_null_when_none(switchable_client, db_session, tmp_path, monkeypatch):
    from app.routers import analysis as router
    monkeypatch.setattr(router, "_USER_CONNECTION_DIR", str(tmp_path))
    folder = tmp_path / "20260907_000000_EMP001_GroupModuleUnit"; folder.mkdir()
    bdf = folder / "m.bdf"; bdf.write_text("ENDDATA\n")
    parent = models.Analysis(employee_id="EMP001", program_name="GroupModuleUnit", project_name="p", status="Success",
                             created_at=datetime.now(), input_info={"bdf_model": str(bdf)})
    db_session.add(parent); db_session.commit()
    switchable_client.as_user()
    assert switchable_client.get(f"/api/analysis/groupmoduleunit/artifacts/{parent.id}").json()["unitStructuralAnalysisId"] is None
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_groupmoduleunit_artifacts_unit_id.py -q` → `KeyError: 'unitStructuralAnalysisId'`

- [ ] **Step 3: 구현** — `get_groupmoduleunit_artifacts` 의 `return {"folder": folder, "artifacts": artifacts}` 를 아래로 교체:

```python
    artifacts = scan_lifting_artifacts(folder, stem)
    # 이 parent 로 실행된 Unit 구조 해석 중 가장 최근 Success 레코드 — WorkBench 페이지의 '검토 보고서' 버튼이 쓴다.
    # input_info 는 JSON 컬럼이라 DB 방언에 따라 JSON 경로 질의가 다르므로, 후보를 파이썬에서 거른다(레코드 수가 작다).
    unit_id = None
    candidates = (
        db.query(models.Analysis)
        .filter(models.Analysis.program_name == "UnitStructuralAnalysis",
                models.Analysis.employee_id == parent.employee_id,
                models.Analysis.status == "Success")
        .order_by(models.Analysis.created_at.desc(), models.Analysis.id.desc())
        .limit(200).all()
    )
    for cand in candidates:
        if (cand.input_info or {}).get("parent_analysis_id") == parent_id:
            unit_id = cand.id
            break
    return {"folder": folder, "artifacts": artifacts, "unitStructuralAnalysisId": unit_id}
```

- [ ] **Step 4: 통과 확인** — `2 passed`
- [ ] **Step 5: 커밋 준비 보고**

---

### Task 7: WorkBench 프론트 — API·입력 모달·버튼

**Files:**
- Modify: `HiTessWorkBench/frontend/src/api/analysis.js` (끝에 추가)
- Create: `HiTessWorkBench/frontend/src/components/analysis/UnitLiftingReportDialog.jsx`
- Modify: `HiTessWorkBench/frontend/src/components/analysis/ResultArtifactsCard.jsx`
- Test: `HiTessWorkBench/frontend/src/components/analysis/UnitLiftingReportDialog.test.jsx`

- [ ] **Step 1: API 함수** — `api/analysis.js` 맨 끝에 추가:

```js
/** Unit 권상 구조 검토 보고서(xlsx) — 응답 blob + 헤더(파일명·경고·요약) */
export const downloadUnitLiftingReport = (analysisId, options = {}) =>
  axios.post(`${API_BASE_URL}/api/analysis/unit-structural/report`,
    { analysisId, options },
    { headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, responseType: 'blob' });
```

- [ ] **Step 2: 모달 테스트 (vitest + @testing-library/react — 프로젝트에 이미 설정됨, 없으면 `frontend/src/**/*.test.jsx` 기존 예를 따른다)**

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import UnitLiftingReportDialog, { deriveIds } from './UnitLiftingReportDialog';

describe('UnitLiftingReportDialog', () => {
  it('파일명에서 호선·유닛을 선입력한다', () => {
    expect(deriveIds('3496-35210-A508372_20260108_edit.bdf')).toEqual({ hullNo: '3496', unitNo: '35210' });
    expect(deriveIds('foo.bdf')).toEqual({ hullNo: '', unitNo: '' });
  });

  it('생성 버튼이 옵션을 넘긴다', () => {
    const onSubmit = vi.fn();
    render(<UnitLiftingReportDialog open sourceFileName="3496-35210-x.bdf" defaultAuthor="A1" onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('도면 번호'), { target: { value: 'D-1' } });
    fireEvent.click(screen.getByRole('button', { name: /보고서 생성/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ hullNo: '3496', unitNo: '35210', drawingNo: 'D-1', author: 'A1', jigLimitTon: 6.2, yieldStrengthMpa: 275 }));
  });

  it('지그 기준이 0 이하이면 생성 버튼을 막는다', () => {
    render(<UnitLiftingReportDialog open sourceFileName="" onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByLabelText('지그 기준 (ton)'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /보고서 생성/ })).toBeDisabled();
  });
});
```

- [ ] **Step 3: 실패 확인** — `cd HiTessWorkBench/frontend && npx vitest run src/components/analysis/UnitLiftingReportDialog.test.jsx` → 모듈 없음

- [ ] **Step 4: 모달 구현** — `UnitLiftingReportDialog.jsx`:

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { X, FileSpreadsheet, Loader2 } from 'lucide-react';

/** BDF 파일명 `(\d{4})[-_](\d{5})` → 호선·유닛 */
export function deriveIds(fileName = '') {
  const m = /(?<!\d)(\d{4})[-_](\d{5})(?!\d)/.exec(fileName || '');
  return { hullNo: m ? m[1] : '', unitNo: m ? m[2] : '' };
}

const FIELDS = [
  ['hullNo', '호선 (HULL NO.)', 'text'], ['unitNo', '유닛 (UNIT NO.)', 'text'], ['drawingNo', '도면 번호', 'text'],
  ['revision', '리비전', 'text'], ['author', '작성자', 'text'], ['department', '부서', 'text'],
  ['jigLimitTon', '지그 기준 (ton)', 'number'], ['yieldStrengthMpa', '항복강도 (MPa)', 'number'],
];

/**
 * Unit 권상 검토 보고서 입력 모달 — Studio 의 UnitStructuralReportDialog 와 같은 필드.
 * props: open, sourceFileName, defaultAuthor, busy, onClose(), onSubmit(options)
 */
export default function UnitLiftingReportDialog({ open, sourceFileName = '', defaultAuthor = '', busy = false, onClose, onSubmit }) {
  const initial = useMemo(() => ({
    ...deriveIds(sourceFileName), drawingNo: '', revision: '0', author: defaultAuthor, department: '',
    jigLimitTon: 6.2, yieldStrengthMpa: 275, notes: '',
  }), [sourceFileName, defaultAuthor]);
  const [form, setForm] = useState(initial);
  useEffect(() => { if (open) setForm(initial); }, [open, initial]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const numOk = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
  const valid = numOk(form.jigLimitTon) && numOk(form.yieldStrengthMpa);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () => valid && !busy && onSubmit?.({ ...form, jigLimitTon: Number(form.jigLimitTon), yieldStrengthMpa: Number(form.yieldStrengthMpa) });

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[520px] max-w-[92vw] rounded-2xl bg-white shadow-2xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><FileSpreadsheet size={16} className="text-[#002554]" /> 권상 구조 검토 보고서</div>
          <button type="button" onClick={onClose} aria-label="닫기" className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          {FIELDS.map(([key, label, type]) => (
            <label key={key} className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              {label}
              <input aria-label={label} type={type} step="any" value={form[key]} onChange={set(key)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002554]/30" />
            </label>
          ))}
          <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold text-slate-500">비고
            <textarea aria-label="비고" rows={2} value={form.notes} onChange={set('notes')}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-normal text-slate-800" />
          </label>
          <p className="col-span-2 text-[11px] text-slate-400">호선·유닛은 BDF 파일명에서 자동 추출됩니다. 허용응력 = 항복강도 × 0.8, 지그 기준은 와이어 장력(ton) 판정에 쓰입니다.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
          <button type="button" onClick={submit} disabled={!valid || busy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[#002554] text-white disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} 보고서 생성
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: ResultArtifactsCard 에 버튼 연결**

import 추가:
```js
import { getGroupModuleUnitArtifacts, downloadFileBlob, downloadUnitLiftingReport } from '../../api/analysis';
import { downloadBlob, filenameFromDisposition } from '../../utils/fileHelper';
import { isAdmin, getCurrentUser } from '../../utils/auth';
import UnitLiftingReportDialog from './UnitLiftingReportDialog';
```
state 추가(`registerTarget` 아래):
```js
  const [unitAnalysisId, setUnitAnalysisId] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
```
`fetchArtifacts` 의 `setArtifacts(...)` 다음 줄에 `setUnitAnalysisId(res.data?.unitStructuralAnalysisId ?? null);` 추가.
핸들러 추가(`handleDownload` 아래):
```js
  const handleReport = async (options) => {
    setReportBusy(true);
    try {
      const res = await downloadUnitLiftingReport(unitAnalysisId, options);
      const name = filenameFromDisposition(res.headers['content-disposition'], 'Unit_권상_구조_검토_보고서.xlsx');
      downloadBlob(res.data, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      let warnings = [];
      try { warnings = JSON.parse(decodeURIComponent(res.headers['x-report-warnings'] || '[]')); } catch { /* 헤더 없음 */ }
      showToast(warnings.length ? `보고서 생성 완료 · 경고 ${warnings.length}건 (부록 C 참조)` : '보고서 생성 완료', warnings.length ? 'warning' : 'success');
      setReportOpen(false);
    } catch (e) {
      let detail = e?.message;
      if (e?.response?.data instanceof Blob) { try { detail = JSON.parse(await e.response.data.text()).detail; } catch { /* JSON 아님 */ } }
      showToast(`보고서 생성 실패: ${detail || '알 수 없는 오류'}`, 'error');
    } finally { setReportBusy(false); }
  };
```
카드 헤더(새로고침 버튼 옆, `onClick={fetchArtifacts}` 버튼 앞)에 버튼:
```jsx
          {state === 'loaded' && (
            <button type="button" onClick={() => setReportOpen(true)} disabled={!unitAnalysisId}
              title={unitAnalysisId ? '권상 구조 검토 보고서(xlsx) 생성' : 'Studio 에서 단위 구조 해석을 완료하면 활성화됩니다'}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-[#002554]/30 text-[#002554] hover:bg-[#002554]/5 disabled:opacity-40">
              <FileBarChart2 size={13} /> 검토 보고서
            </button>
          )}
```
컴포넌트 return 최하단(`ModelRegistrationModal` 옆)에:
```jsx
      <UnitLiftingReportDialog open={reportOpen} busy={reportBusy} onClose={() => setReportOpen(false)} onSubmit={handleReport}
        sourceFileName={byKind.editedBdf?.fileName || byKind.liftingBdf?.fileName || ''} defaultAuthor={getCurrentUser()?.employee_id || ''} />
```
(`byKind` 는 이미 존재. `filenameFromDisposition`·`getCurrentUser` 는 기존 export 확인됨.)

- [ ] **Step 6: 통과·린트** — `npx vitest run src/components/analysis/UnitLiftingReportDialog.test.jsx` → `3 passed`; `npx eslint src/components/analysis/ResultArtifactsCard.jsx src/components/analysis/UnitLiftingReportDialog.jsx src/api/analysis.js`

- [ ] **Step 7: 커밋 준비 보고**

---

### Task 8: Electron IPC — `captures` 검증 제거

**Files:**
- Modify: `HiTessWorkBench/electron/index.js:1688-1745`

- [ ] **Step 1: 수정** — 핸들러 안에서 아래 블록을 삭제:
```js
    if (!payload?.captures || typeof payload.captures !== "object") {
      return { ok: false, error: "보고서용 3D 캡처가 없습니다." };
    }
```
`body: JSON.stringify({...})` 를 `body: JSON.stringify({ analysisId, options: payload.options || {} })` 로. 주석 첫 줄을 `// ModuleUnitStudio "보고서 생성" → 백엔드가 결과 JSON 만으로 표준 검토 보고서(xlsx)를 만들어 사용자 PC 에 저장한다.` 로. `defaultPath` 기본 파일명을 `"Module_Unit_권상_구조_검토_보고서.xlsx"` 로.

- [ ] **Step 2: 확인** — `node --check HiTessWorkBench/electron/index.js` 가 조용히 끝나야 함.
- [ ] **Step 3: 커밋 준비 보고**

---

### Task 9: Studio — 캡처 경로 삭제, 입력 모달, 버전 0.0.131

작업 루트: `C:\Coding\WorkBenchSubModule\ModuleUnitStudio\apps\module-unit-studio\`

**Files:**
- Delete: `src/three/LiftingArrangementReport.js`, `src/three/LiftingArrangementReport.test.js`, `src/three/DisplacementResultOverlay.js`, `src/three/DisplacementResultOverlay.test.js`
- Modify: `src/components/ThreeViewport.jsx` (import 2줄 + `reportCaptureRef` 선언 + `captureReportViews` API 항목 + 1569~1700 캡처 블록 삭제)
- Modify: `src/components/ViewportContainer.jsx` (`useUnitStructuralStore` import, `setReportCapture`, `captureReportViews` useCallback/useEffect 삭제)
- Modify: `src/store/useUnitStructuralStore.js` (`reportCapture`, `setReportCapture` 삭제), `src/store/useUnitStructuralStore.test.js` (관련 단언 삭제)
- Create: `src/components/UnitStructuralReportDialog.jsx`, `src/components/UnitStructuralReportDialog.test.jsx`
- Rewrite: `src/components/UnitStructuralReportButton.jsx`
- Modify: `src/host/host.js` 주석(`generateUnitLiftingReport({ analysisId, options })`), `package.json` version → `0.0.131`

- [ ] **Step 1: 캡처 코드 삭제** — 위 목록대로 제거 후 `npx vitest run` → 캡처 관련 2개 테스트 파일이 사라져 `35 files` 근처, 모두 통과. `git diff --stat` 로 `ThreeViewport.jsx` 가 **HEAD 대비 순증 0에 가깝게**(codex 추가분 +138 이 사라짐) 돌아갔는지 확인.

- [ ] **Step 2: 모달 테스트**

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import UnitStructuralReportDialog, { deriveIds } from './UnitStructuralReportDialog.jsx'

describe('UnitStructuralReportDialog', () => {
  it('파일명에서 호선·유닛 선입력', () => {
    expect(deriveIds('3496-35210-A508372.bdf')).toEqual({ hullNo: '3496', unitNo: '35210' })
  })
  it('생성 시 옵션 전달', () => {
    const onSubmit = vi.fn()
    render(<UnitStructuralReportDialog sourceFileName="3496-35210-x.json" onClose={() => {}} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('리비전'), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: /보고서 생성/ }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ hullNo: '3496', unitNo: '35210', revision: 'B', jigLimitTon: 6.2 }))
  })
})
```

- [ ] **Step 3: 모달 구현** (`RotateModelDialog.jsx` 의 다크 스타일을 따른다)

```jsx
import { useEffect, useMemo, useState } from 'react'
import { X, FileSpreadsheet } from 'lucide-react'

export function deriveIds(fileName = '') {
  const m = /(?<!\d)(\d{4})[-_](\d{5})(?!\d)/.exec(fileName || '')
  return { hullNo: m ? m[1] : '', unitNo: m ? m[2] : '' }
}

const FIELDS = [
  ['hullNo', '호선 (HULL NO.)', 'text'], ['unitNo', '유닛 (UNIT NO.)', 'text'], ['drawingNo', '도면 번호', 'text'],
  ['revision', '리비전', 'text'], ['author', '작성자', 'text'], ['department', '부서', 'text'],
  ['jigLimitTon', '지그 기준 (ton)', 'number'], ['yieldStrengthMpa', '항복강도 (MPa)', 'number'],
]
const input = {
  background: '#0f0f1e', border: '1px solid #2a2a40', borderRadius: 6, color: '#e6e9f2',
  padding: '6px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box',
}

/** 보고서 표지 정보 입력 — WorkBench 의 UnitLiftingReportDialog 와 같은 필드. props: sourceFileName, defaultAuthor, onClose, onSubmit */
export default function UnitStructuralReportDialog({ sourceFileName = '', defaultAuthor = '', onClose, onSubmit }) {
  const initial = useMemo(() => ({ ...deriveIds(sourceFileName), drawingNo: '', revision: '0', author: defaultAuthor, department: '',
    jigLimitTon: 6.2, yieldStrengthMpa: 275, notes: '' }), [sourceFileName, defaultAuthor])
  const [form, setForm] = useState(initial)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const numOk = (v) => Number.isFinite(Number(v)) && Number(v) > 0
  const valid = numOk(form.jigLimitTon) && numOk(form.yieldStrengthMpa)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '92vw', background: '#0d0d22', border: '1px solid rgba(55,224,138,0.45)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 12px 36px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#65F0A2', letterSpacing: 1.2, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileSpreadsheet size={13} /> 권상 구조 검토 보고서
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', color: '#9fb4cc', cursor: 'pointer' }}><X size={15} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {FIELDS.map(([key, label, type]) => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: '#9fb4cc', fontWeight: 700 }}>
              {label}
              <input aria-label={label} type={type} step="any" value={form[key]} onChange={set(key)} style={input} />
            </label>
          ))}
          <label style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: '#9fb4cc', fontWeight: 700 }}>비고
            <textarea aria-label="비고" rows={2} value={form.notes} onChange={set('notes')} style={{ ...input, resize: 'vertical' }} />
          </label>
        </div>
        <div style={{ fontSize: 10, color: '#7a8aaa', lineHeight: 1.5 }}>호선·유닛은 파일명에서 자동 추출. 허용응력 = 항복강도 × 0.8. 지그 기준은 와이어 장력(ton) 판정에 사용.</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #2a2a40', background: 'transparent', color: '#9fb4cc', fontSize: 11.5, cursor: 'pointer' }}>취소</button>
          <button type="button" disabled={!valid} onClick={() => valid && onSubmit?.({ ...form, jigLimitTon: Number(form.jigLimitTon), yieldStrengthMpa: Number(form.yieldStrengthMpa) })}
            style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid rgba(55,224,138,0.55)', background: valid ? 'rgba(55,224,138,0.15)' : '#0f0f1e', color: valid ? '#65F0A2' : '#5a5a80', fontSize: 11.5, fontWeight: 800, cursor: valid ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileSpreadsheet size={13} /> 보고서 생성
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 버튼 재작성** — `UnitStructuralReportButton.jsx` 전체 교체:

```jsx
import { useState } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { getHost } from '../host/host.js'
import { useUnitStructuralStore } from '../store/useUnitStructuralStore.js'
import { useStageStore } from '../store/useStageStore.js'
import UnitStructuralReportDialog from './UnitStructuralReportDialog.jsx'

/** 저장된 Unit 구조 해석 결과로 표준 검토 보고서(xlsx)를 생성한다. 그림은 백엔드가 그린다(캡처 없음). */
export default function UnitStructuralReportButton() {
  const status = useUnitStructuralStore(s => s.status)
  const analysisId = useUnitStructuralStore(s => s.analysisId)
  const sourceFileName = useStageStore(s => s.stages?.[0]?.sourceFile ?? s.stages?.[0]?.meta?.sourceFile ?? '')
  const [open, setOpen] = useState(false)
  const [state, setState] = useState({ status: 'idle', message: '' })
  const running = state.status === 'running'
  const disabled = status !== 'Success' || !analysisId || running

  const handleSubmit = async (options) => {
    setOpen(false)
    const host = getHost()
    if (typeof host.generateUnitLiftingReport !== 'function') {
      setState({ status: 'error', message: 'Workbench 보고서 생성 기능을 사용할 수 없습니다.' }); return
    }
    setState({ status: 'running', message: '백엔드에서 보고서를 작성하는 중...' })
    try {
      const r = await host.generateUnitLiftingReport({ analysisId, options })
      if (r?.canceled) setState({ status: 'idle', message: '' })
      else if (r?.ok) setState({ status: 'success', message: `저장 완료${r.warnings?.length ? ` · 경고 ${r.warnings.length}건(부록 C)` : ''}: ${r.savedPath}` })
      else setState({ status: 'error', message: r?.error ?? '보고서 생성에 실패했습니다.' })
    } catch (e) {
      setState({ status: 'error', message: e?.message ?? String(e) })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <button type="button" onClick={() => !disabled && setOpen(true)} disabled={disabled}
        title="구조 해석 결과와 자세안정성 결과로 표준 검토 보고서(xlsx)를 생성합니다."
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', padding: '9px 10px', borderRadius: 7,
          border: `1px solid ${disabled ? '#2a2a40' : 'rgba(55,224,138,0.55)'}`, background: disabled ? '#0f0f1e' : 'rgba(55,224,138,0.12)',
          color: disabled ? '#5a5a80' : '#65F0A2', fontSize: 11.5, fontWeight: 850, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        {running ? <Loader2 size={15} className="spin" /> : <FileSpreadsheet size={15} />}
        {running ? '보고서 생성 중...' : '해석 검토 보고서 생성'}
      </button>
      {state.message && (
        <div style={{ fontSize: 10, lineHeight: 1.45, wordBreak: 'break-all', color: state.status === 'error' ? '#FF8A98' : state.status === 'success' ? '#65F0A2' : '#9fb4cc' }}>{state.message}</div>
      )}
      {open && <UnitStructuralReportDialog sourceFileName={sourceFileName} onClose={() => setOpen(false)} onSubmit={handleSubmit} />}
    </div>
  )
}
```
`useStageStore` 의 원본 파일명 필드는 실제 스토어를 열어 확인한다(`stages[0].meta.sourceFile` 이 `_edited.json` 의 `meta.sourceFile` 과 같은 경로임 — 없으면 빈 문자열로 두어 사용자가 직접 입력).

- [ ] **Step 5: 테스트·린트·빌드** — `npx vitest run` 전부 통과, `npx eslint src --ext .js,.jsx` 클린, `package.json` version `0.0.131`, `npm run package` → `release/module-unit-studio-0.0.131.zip` + `.sha256`.

- [ ] **Step 6: 배포는 사용자 허락 후** — 허락 시: zip+sha256 을 `HiTessWorkBenchBackEnd\StudioProgram\` 과 UNC(`Copy-Item -LiteralPath`) 양쪽에 복사, SHA-256 대조, `GroupModuleUnitLiftingAnalysis.jsx` 의 `MODULE_STUDIO_VERSION = '0.0.131'`.

- [ ] **Step 7: 커밋 준비 보고** (Studio 저장소 + WorkBench 핀)

---

### Task 10: 템플릿 잔재 정리·문서·메모리

**Files:**
- Delete: `HiTessWorkBenchBackEnd/app/templates/unit_lifting_report_template.bin`, `.xlsx`(로컬 마스터 — 사용자 확인 후), `app/templates/README.md`, `scripts/export_report_template_bin.py`
- Modify: `.gitignore` (templates/*.xlsx 항목과 주석 4줄 삭제), `CLAUDE.md`(Module Unit 절에 보고서 소절 추가), 메모리 `reference_drm_xlsx_template_pattern.md`

- [ ] **Step 1: 삭제·정리** — `.xlsx` 마스터는 더 이상 코드가 읽지 않으므로 `git rm` 대상은 아니고(미추적) 로컬 파일 삭제 여부만 사용자에게 묻는다. 나머지는 삭제.
- [ ] **Step 2: 회귀** — `grep -rn "unit_lifting_report_template\|_TEMPLATE_PATH" HiTessWorkBenchBackEnd/app HiTessWorkBenchBackEnd/tests scripts` 가 0건.
- [ ] **Step 3: CLAUDE.md** — "Module Unit Studio" 절 끝에 소절 추가:

```markdown
#### Unit 권상 구조 검토 보고서 (2026-09-07 전면 재구성)

`POST /api/analysis/unit-structural/report` → `app/services/unit_lifting_report/`(collector·figures·sheet·builder) 가 결과 폴더 JSON 7종으로 다장 xlsx 를 메모리에서 생성. 그림은 **matplotlib 백엔드 렌더**(Studio 캡처 없음, `requirements.txt` 에 matplotlib 추가 → 서버 `pip install` 1회). 진입점 2곳: Studio `UnitStructuralReportButton`(입력 모달) · WorkBench `ResultArtifactsCard` "검토 보고서"(artifacts 응답의 `unitStructuralAnalysisId` 필요). 판정: σ허용=σy×0.8, 지그 기준 ton 옵션(기본 6.2), 변위는 참고치. 절 제목은 `builder.toc_entries` 와 `_write` 가 글자 단위로 같아야 목차 쪽이 채워진다.
```
- [ ] **Step 4: 메모리** — `reference_drm_xlsx_template_pattern.md` 의 "구현 예" 문단을 "이 서비스는 이후 템플릿 없이 openpyxl 로 직접 생성하도록 바뀌어 `.bin` 이 제거됐다. 패턴 자체(DRM/.bin/pythoncom)는 유효." 로 갱신. `MEMORY.md` 한 줄은 유지.
- [ ] **Step 5: 커밋 준비 보고**

---

### Task 11: E2E 검증 및 배포 보고

- [ ] **Step 1: 백엔드 전체 테스트** — `WorkBenchEnv/Scripts/python.exe -m pytest -q` (다른 세션의 `module_ocean_*` 편집이 `app.main` 을 깨뜨린 상태면 그 사실을 보고하고 `--noconftest` 로 보고서 테스트 5개 파일만 실행).
- [ ] **Step 2: 실환경** — 로컬 백엔드(`uvicorn ... --port 9091`) 기동 → WorkBench dev 앱에서 GMU 페이지 Step3 "검토 보고서" 로 실제 다운로드 → Excel 인쇄 미리보기 확인(표지·목차 쪽번호·그림 6종 이상·표 폭·데이터 시트 3개). Studio(0.0.131 설치 후)에서도 같은 모달 → 저장 다이얼로그 → 파일 열림 확인.
- [ ] **Step 3: 사용자 보고 항목**
  - `git pull` 로 끝나는 것: 백엔드 패키지·라우트·requirements·hd_logo.png·fixture, 프론트(모달·카드·핀·Electron)
  - **수동**: 서버(145) `pip install -r requirements.txt`(matplotlib) + 백엔드 재시작, `StudioProgram\module-unit-studio-0.0.131.zip(+sha256)` 복사
  - 커밋은 사용자가 직접(파일 목록 제시)

---

## Self-review

- **Spec 커버리지:** 틀·장 구성(Task 5), 그림 백엔드 렌더(Task 3), 한국어(전 Task), 부재 깊이·데이터 시트(Task 2·5), 진입점 2곳+모달(Task 7·9), 변위 참고치(Task 5 1.5절), 안정성 판정표+선정 근거(Task 2·5 3장), 지그 옵션(Task 2 `ReportOptions`), 편집 이력(Task 2 `_edits`·5 2.4절), 예외 처리(Task 2 `_optional`, Task 3 `render_all_safe`, Task 5 라우트), 테스트 5종(Task 2~6), matplotlib 의존성(Task 1), 캡처 삭제·재배포(Task 9), 잔재 정리(Task 10). 누락 없음.
- **타입 일관성:** `ReportOptions.from_payload` ↔ 라우트 `options` 키(`hullNo, unitNo, drawingNo, revision, author, department, jigLimitTon, yieldStrengthMpa, notes`) ↔ 두 모달의 `onSubmit` 객체 키 동일. `render_all_safe -> (figs, errors)` 를 `__init__`·builder 테스트가 같은 시그니처로 사용. `toc_entries -> list[(text, level)]`, `toc_fill(entries: (text, page, level))`. `generate_unit_lifting_report(result_info, options, *, generated_by)` 를 라우트·서비스 테스트가 동일하게 호출.
- **placeholder 없음.** 모든 코드 스텝에 실제 코드 포함.

