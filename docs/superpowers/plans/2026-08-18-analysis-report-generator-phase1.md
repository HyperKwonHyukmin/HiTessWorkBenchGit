# 해석 리포트 생성기 1단계 (엔진 + 범용 경로 + App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Analysis` 레코드 1건을 표준 XLSX 계산서로 만드는 공통 리포트 엔진과, 그것을 쓰는 Productivity 모드 App 하나를 만든다. 앱별 코드 추가 없이 25개 App 전부가 즉시 커버된다.

**Architecture:** 백엔드에 `app/services/report/` 패키지를 신설한다. 어댑터(레코드 → 중간표현 `ReportDoc`)와 렌더러(`ReportDoc` → XLSX bytes)를 직교하는 두 축으로 분리하고, 어댑터 선택은 기존 `program_registry.ProgramSpec`에 칸 두 개를 추가해 해결한다(새 레지스트리를 만들지 않는다). 이번 단계에서는 generic 어댑터·렌더러만 구현하며, 템플릿 렌더러는 2단계로 미룬다.

**Tech Stack:** FastAPI + SQLAlchemy + openpyxl + pytest(인메모리 SQLite) / React 18 + Vite + axios

**설계 스펙:** `docs/superpowers/specs/2026-08-18-analysis-report-generator-design.md`

---

## 이 계획에서 다루지 않는 것 (2단계로 미룸)

- `TemplateRenderer`와 `<template>.map.json` 외부화
- `carling_report_service` 이관 및 `/api/carling/{free,optimization}/report` 위임 + 스냅샷 회귀
- `/api/analysis/export-xlsx`(Truss 상세 시트)는 **이번에도 다음에도 손대지 않는다.**
  스펙의 "기존 엔드포인트 이행" 표 참조 — 무손실 이관이 불가능하고 얻는 것도 없다.

1단계만으로도 25개 App 전부에서 범용 계산서가 나온다. 그 자체로 배포 가능한 상태다.

---

## 사전 지식 (이 코드베이스를 처음 보는 사람을 위해)

**백엔드 실행·테스트** — 작업 디렉터리 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd`

```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_payload.py -q
```

- 테스트는 인메모리 SQLite + `app.dependency_overrides`로 동작한다(`tests/conftest.py`).
- `admin_client` fixture는 `require_auth`와 `require_admin`을 **둘 다** `"ADMIN001"`로 고정한다.
- `switchable_client` fixture는 `require_auth`만 덮어쓰고 `require_admin`은 실제 DB `is_admin`
  검사를 타게 둔다. `client.as_admin()` / `client.as_user()`로 신원을 바꾼다. **비소유자 403 검증은
  이 픽스처를 써야 한다.** (`admin_client`로는 항상 관리자라 403이 안 난다.)
- `db_session` fixture가 매 테스트마다 테이블을 만들고 지운다.

**프론트엔드 빌드·테스트** — 작업 디렉터리 `C:\Coding\WorkBench\HiTessWorkBench\frontend`

```bash
npm run build
node --test src/utils/reportCatalogue.test.js
```

- 순수 함수만 `node:test`로 테스트한다. React 컴포넌트 렌더 테스트 인프라는 이 레포에 없다.

**반드시 지킬 프로젝트 규칙 (CLAUDE.md)**

- `HiTessWorkBench/frontend/src/config.js`는 **어떤 커밋에도 스테이징하지 않는다.**
- 저장소 루트 `Darkmode.js/`는 **절대 커밋하지 않는다.**
- 커밋 메시지는 한국어로 쓴다.
- 리포트 파일을 **서버 디스크에 쓰지 않는다.** 쓰는 순간 사내 DRM이 암호화한다. 항상 `BytesIO`.

**기존 코드에서 그대로 쓰는 것들**

| 대상 | 위치 | 용도 |
|---|---|---|
| `resolve_program(name) -> ProgramSpec \| None` | `app/services/program_registry.py:253` | `program_name`(과거 alias 포함) → 정규 spec |
| `build_analysis_passport(record, *, user_connection_base)` | `app/services/analysis_passport.py:190` | 산출물 계보(해시·존재 여부) |
| `assert_current_user_can_access_owner(owner_id, current_user, db)` | `app/routers/_access_control.py:35` | 본인 또는 관리자만 통과, 아니면 403 |
| `log_activity(db, action_type, employee_id=, action_detail=, ip_address=)` | `app/services/activity_service.py:10` | 감사 로그 |
| `_USER_CONNECTION_DIR` | `app/routers/analysis.py:76` | `userConnection` 절대경로 |

---

## 파일 구조

**백엔드 — 생성**

| 파일 | 책임 |
|---|---|
| `app/services/report/__init__.py` | 공개 API 재노출 (`build_report_xlsx`, `report_capabilities`) |
| `app/services/report/models.py` | `ReportField/Table/Section/Meta/Doc` frozen dataclass |
| `app/services/report/verdict_vocab.py` | 판정 낱말 — 어댑터(판정 추론)와 렌더러(행 강조)가 **함께 쓰는 단일 출처** |
| `app/services/report/payload.py` | 레코드 → `payload` dict. `userConnection` 밖 경로 로드 차단 |
| `app/services/report/adapters/__init__.py` | `ADAPTERS` 레지스트리와 조회 함수 |
| `app/services/report/adapters/generic.py` | 어댑터 미지정 앱 공용. payload → 표준 5섹션 |
| `app/services/report/renderers/__init__.py` | 패키지 마커 |
| `app/services/report/renderers/generic_xlsx.py` | `ReportDoc` → XLSX bytes |
| `app/services/report/service.py` | 오케스트레이터 |
| `app/routers/reports.py` | `GET /api/reports/capabilities`, `POST /api/reports/generate` |

**백엔드 — 수정**

| 파일 | 변경 |
|---|---|
| `app/services/program_registry.py` | `ProgramSpec`에 `report_adapter`·`report_template` 추가 |
| `app/services/app_settings.py` | `GUARDED_ROUTES`에 `/api/reports/` 등록 |
| `app/main.py:202` 부근 | `application.include_router(reports.router)` |

**프론트엔드 — 생성/수정**

| 파일 | 변경 |
|---|---|
| `src/api/reports.js` | 함수 2개 추가(기존 사용량 리포트 함수는 그대로) |
| `src/utils/reportCatalogue.js` | 이력 + capabilities 병합 순수 함수 (테스트 대상) |
| `src/utils/reportCatalogue.test.js` | 위 함수 테스트 |
| `src/pages/analysis/AnalysisReportGenerator.jsx` | 페이지 |
| `src/contexts/DashboardContext.jsx` | 카탈로그 항목 등록 |
| `src/App.jsx` | `renderPage()` case 추가 |

---

## Task 1: ReportDoc 중간표현

**Files:**
- Create: `app/services/report/__init__.py`
- Create: `app/services/report/models.py`
- Test: `tests/test_report_models.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_report_models.py`:

```python
"""ReportDoc 중간표현의 불변 계약."""
import dataclasses

import pytest

from app.services.report.models import (
    STANDARD_SECTION_ORDER,
    ReportDoc,
    ReportField,
    ReportMeta,
    ReportSection,
    ReportTable,
)


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="column-buckling",
        display_name="Column Buckling Load Calculator",
        analysis_id=7,
        project_name="ColumnBuckling_20260818",
        employee_id="EMP001",
        created_at=None,
        status="Success",
    )


def test_report_doc_is_frozen():
    doc = ReportDoc(meta=_meta(), verdict="합격", sections=())
    with pytest.raises(dataclasses.FrozenInstanceError):
        doc.verdict = "불합격"


def test_section_defaults_are_empty_tuples():
    section = ReportSection(key="input", title="입력 조건")
    assert section.fields == ()
    assert section.tables == ()


def test_standard_section_order_is_the_agreed_five():
    assert STANDARD_SECTION_ORDER == (
        "overview",
        "input",
        "result",
        "verdict",
        "provenance",
    )


def test_sort_sections_puts_standard_keys_first_and_keeps_unknown_at_end():
    doc = ReportDoc(
        meta=_meta(),
        verdict=None,
        sections=(
            ReportSection(key="custom", title="비고"),
            ReportSection(key="result", title="해석 결과"),
            ReportSection(key="overview", title="개요"),
        ),
    )
    assert [s.key for s in doc.ordered_sections()] == ["overview", "result", "custom"]


def test_field_and_table_carry_units_and_notes():
    field = ReportField(label="최대 허용 하중", value=12.5, unit="ton", note="AISC")
    table = ReportTable(
        title="후보",
        columns=("호칭", "두께"),
        rows=((1, 2), (3, 4)),
        note="상위 2건",
    )
    assert field.unit == "ton"
    assert table.rows[1] == (3, 4)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_models.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.report'`

- [ ] **Step 3: 최소 구현**

`app/services/report/__init__.py`:

```python
"""해석 리포트 생성 엔진.

Analysis 레코드 하나를 표준 XLSX 계산서로 바꾼다. 어댑터(데이터 정규화)와
렌더러(서식)를 분리해, 신규 App 추가 비용이 어댑터 함수 하나가 되게 한다.
"""
```

`app/services/report/models.py`:

```python
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_models.py -q`
Expected: PASS — 5 passed

- [ ] **Step 5: 커밋**

```bash
git add app/services/report/__init__.py app/services/report/models.py tests/test_report_models.py
git commit -m "✨ feat: 리포트 중간표현 ReportDoc 추가"
```

---

## Task 2: program_registry 에 리포트 칸 추가

**Files:**
- Modify: `app/services/program_registry.py:14-32` (`ProgramSpec`), `:35-52` (`_spec`)
- Test: `tests/test_program_registry.py` (기존 파일에 추가)

`ProgramSpec`은 frozen dataclass이고 `_spec()` 팩토리를 통해서만 만들어진다. 두 곳 모두 고쳐야 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_program_registry.py` 맨 아래에 추가:

```python
def test_spec_defaults_report_fields_to_none():
    spec = resolve_program("BDF Scanner")
    assert spec is not None
    assert spec.report_adapter is None
    assert spec.report_template is None


def test_truss_assessment_declares_a_report_adapter():
    spec = resolve_program("Truss Structural Assessment")
    assert spec is not None
    assert spec.report_adapter == "truss-assessment"
    assert "report" in spec.capabilities
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_program_registry.py -q`
Expected: FAIL — `AttributeError: 'ProgramSpec' object has no attribute 'report_adapter'`

- [ ] **Step 3: 최소 구현**

`app/services/program_registry.py`의 `ProgramSpec`에 필드 두 개를 **맨 뒤에** 추가한다
(기본값이 있는 필드라 순서상 뒤여야 한다):

```python
@dataclass(frozen=True, slots=True)
class ProgramSpec:
    program_id: str
    display_name: str
    aliases: tuple[str, ...]
    capabilities: frozenset[str]
    history_visible: bool = True
    rerun_adapter: str | None = None
    input_keys: tuple[str, ...] = ()
    statistics_group: str | None = None
    report_adapter: str | None = None
    report_template: str | None = None
```

`_spec()` 팩토리에도 같은 두 개를 키워드 인자로 추가하고 그대로 전달한다:

```python
def _spec(
    program_id: str,
    display_name: str,
    *aliases: str,
    capabilities: tuple[str, ...] = (),
    history_visible: bool = True,
    rerun_adapter: str | None = None,
    input_keys: tuple[str, ...] = (),
    statistics_group: str | None = None,
    report_adapter: str | None = None,
    report_template: str | None = None,
) -> ProgramSpec:
    return ProgramSpec(
        program_id=program_id,
        display_name=display_name,
        aliases=tuple(dict.fromkeys((display_name, *aliases))),
        capabilities=frozenset(capabilities),
        history_visible=history_visible,
        rerun_adapter=rerun_adapter,
        input_keys=input_keys,
        statistics_group=statistics_group,
        report_adapter=report_adapter,
        report_template=report_template,
    )
```

`truss-assessment` 엔트리에 `report_adapter`와 `"report"` capability를 넣는다
(`PROGRAM_SPECS` 안, 기존 `_spec("truss-assessment", ...)` 블록):

```python
    _spec(
        "truss-assessment", "Truss Assessment", "Truss Structural Assessment",
        capabilities=("file-analysis", "rerun", "passport", "report"),
        rerun_adapter="truss-assessment",
        input_keys=("bdf_model",),
        report_adapter="truss-assessment",
    ),
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_program_registry.py -q`
Expected: PASS — 기존 테스트 포함 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add app/services/program_registry.py tests/test_program_registry.py
git commit -m "✨ feat: program_registry 에 report_adapter·report_template 칸 추가"
```

---

## Task 3: payload 수집 (경로 보안 포함)

**Files:**
- Create: `app/services/report/payload.py`
- Test: `tests/test_report_payload.py`

`result_info["output_json"]`은 사용자 입력이 아니라 서비스가 기록한 값이지만, DB가 오염되면
임의 파일을 읽는 통로가 된다. `userConnection` 밖 경로는 로드하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_report_payload.py`:

```python
"""payload 수집 — 결과 파일 로드와 경로 경계."""
import json
import os

from app import models
from app.services.report.payload import collect_payload


def _record(**kwargs) -> models.Analysis:
    defaults = {
        "employee_id": "EMP001",
        "program_name": "Column Buckling Load Calculator",
        "project_name": "p",
        "status": "Success",
        "input_info": {"length_mm": 3000},
        "result_info": {"maxWorkingLoadTon": 12.5},
    }
    defaults.update(kwargs)
    return models.Analysis(**defaults)


def test_collects_input_and_result_without_output_file():
    payload = collect_payload(_record(), user_connection_base="/base")
    assert payload["input"] == {"length_mm": 3000}
    assert payload["result"] == {"maxWorkingLoadTon": 12.5}
    assert payload["output"] is None


def test_loads_output_json_inside_user_connection(tmp_path):
    base = tmp_path / "userConnection"
    job = base / "20260818_EMP001_ColumnBuckling"
    job.mkdir(parents=True)
    out = job / "result.json"
    out.write_text(json.dumps({"result": {"assessment": 0.82}}), encoding="utf-8")

    record = _record(result_info={"output_json": str(out)})
    payload = collect_payload(record, user_connection_base=str(base))

    assert payload["output"] == {"result": {"assessment": 0.82}}


def test_skips_output_json_outside_user_connection(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    outside = tmp_path / "secret.json"
    outside.write_text(json.dumps({"leak": True}), encoding="utf-8")

    record = _record(result_info={"output_json": str(outside)})
    payload = collect_payload(record, user_connection_base=str(base))

    assert payload["output"] is None


def test_missing_output_file_does_not_raise(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    record = _record(result_info={"output_json": str(base / "gone.json")})

    payload = collect_payload(record, user_connection_base=str(base))

    assert payload["output"] is None


def test_null_json_columns_become_empty_dicts():
    payload = collect_payload(
        _record(input_info=None, result_info=None),
        user_connection_base="/base",
    )
    assert payload["input"] == {}
    assert payload["result"] == {}


# ── 보안 경계 회귀 테스트 ──────────────────────────────────────────────
# 아래 세 건은 이 모듈이 '보안 경계'이기 때문에 둔다. 리팩터링이 조용히
# 경계를 무너뜨리면 여기서 잡힌다.

def test_rejects_parent_traversal_escaping_the_base(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    secret = tmp_path / "secret.json"
    secret.write_text(json.dumps({"leak": True}), encoding="utf-8")

    record = _record(result_info={"output_json": str(base / ".." / "secret.json")})

    assert collect_payload(record, user_connection_base=str(base))["output"] is None


def test_rejects_sibling_directory_that_merely_shares_the_base_prefix(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    evil = tmp_path / "userConnectionEvil"
    evil.mkdir()
    target = evil / "x.json"
    target.write_text(json.dumps({"leak": True}), encoding="utf-8")

    record = _record(result_info={"output_json": str(target)})

    assert collect_payload(record, user_connection_base=str(base))["output"] is None


def test_deeply_nested_json_degrades_instead_of_raising(tmp_path):
    """RecursionError 는 RuntimeError 하위라 ValueError 로 안 잡힌다.

    크기 상한(8MB)으로는 막을 수 없다 — 200KB 짜리 '[[[[…' 로도 재현된다.
    엔진이 잘못된 결과 파일을 뱉어도 리포트 생성은 죽지 않아야 한다.
    """
    base = tmp_path / "userConnection"
    base.mkdir()
    bomb = base / "bomb.json"
    bomb.write_text("[" * 100000 + "]" * 100000, encoding="utf-8")

    record = _record(result_info={"output_json": str(bomb)})

    assert collect_payload(record, user_connection_base=str(base))["output"] is None
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_payload.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.report.payload'`

- [ ] **Step 3: 최소 구현**

`app/services/report/payload.py`:

```python
"""Analysis 레코드에서 어댑터가 쓸 평평한 payload 를 만든다.

어댑터가 레코드가 아니라 dict 를 받아야 같은 어댑터를 이력 기반 경로와
레거시 POST 경로(2단계) 양쪽에 쓸 수 있다.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# result_info 에서 결과 본문 경로로 쓰이는 키 (서비스마다 이름이 조금씩 다르다).
_OUTPUT_KEYS: tuple[str, ...] = ("output_json", "result_json")

_MAX_OUTPUT_BYTES = 8 * 1024 * 1024


def _is_within(base: str, candidate: str) -> bool:
    base_real = os.path.realpath(os.path.abspath(base))
    cand_real = os.path.realpath(os.path.abspath(candidate))
    return os.path.commonpath([base_real, cand_real]) == base_real


def _load_json_if_allowed(path: str, user_connection_base: str) -> Any | None:
    try:
        if not _is_within(user_connection_base, path):
            logger.warning("리포트: userConnection 밖 결과 경로를 건너뜁니다")
            return None
        if not os.path.isfile(path):
            return None
        if os.path.getsize(path) > _MAX_OUTPUT_BYTES:
            logger.warning("리포트: 결과 JSON 이 너무 커 로드를 건너뜁니다 (%s bytes 초과)", _MAX_OUTPUT_BYTES)
            return None
        with open(path, encoding="utf-8-sig") as fp:
            return json.load(fp)
    except (OSError, ValueError, RecursionError):
        # 파일 유실·깨진 JSON 은 리포트 실패 사유가 아니다. 근거 섹션이 상태를 대신 보여 준다.
        # RecursionError 는 RuntimeError 하위라 ValueError 로 안 잡힌다 — 깊게 중첩된 JSON
        # (크기 상한과 무관하게 200KB 로도 재현된다) 이 리포트 생성을 죽이지 않게 명시적으로 받는다.
        logger.info("리포트: 결과 JSON 로드 실패 — 요약만으로 생성합니다", exc_info=True)
        return None


def collect_payload(record, *, user_connection_base: str) -> dict[str, Any]:
    """레코드 → {"input", "result", "output"} 평평한 dict."""
    input_info = record.input_info if isinstance(record.input_info, dict) else {}
    result_info = record.result_info if isinstance(record.result_info, dict) else {}

    output: Any | None = None
    for key in _OUTPUT_KEYS:
        candidate = result_info.get(key)
        if isinstance(candidate, str) and candidate:
            output = _load_json_if_allowed(candidate, user_connection_base)
            if output is not None:
                break

    return {"input": input_info, "result": result_info, "output": output}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_payload.py -q`
Expected: PASS — 8 passed (기본 5건 + 보안 경계 회귀 3건)

- [ ] **Step 5: 커밋**

```bash
git add app/services/report/payload.py tests/test_report_payload.py
git commit -m "✨ feat: 리포트 payload 수집기 추가 — userConnection 밖 경로 차단"
```

---

## Task 4: generic 어댑터

**Files:**
- Create: `app/services/report/adapters/__init__.py`
- Create: `app/services/report/adapters/generic.py`
- Test: `tests/test_report_generic_adapter.py`

어댑터 시그니처는 `(payload: dict, meta: ReportMeta) -> ReportDoc`로 고정한다. 이후 모든 앱별
어댑터가 이 모양을 따른다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_report_generic_adapter.py`:

```python
"""generic 어댑터 — 어떤 App 이든 표준 섹션으로 편다."""
import pytest

from app.services.report.adapters import get_adapter
from app.services.report.adapters.generic import generic_adapter
from app.services.report.models import ReportMeta


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="column-buckling",
        display_name="Column Buckling Load Calculator",
        analysis_id=7,
        project_name="ColumnBuckling_20260818",
        employee_id="EMP001",
        created_at=None,
        status="Success",
    )


def test_builds_overview_input_and_result_sections():
    payload = {
        "input": {"length_mm": 3000, "sectionName": "H-300x300"},
        "result": {"maxWorkingLoadTon": 12.5},
        "output": None,
    }
    doc = generic_adapter(payload, _meta())

    keys = [s.key for s in doc.ordered_sections()]
    assert keys[:3] == ["overview", "input", "result"]

    input_labels = {f.label for f in next(s for s in doc.sections if s.key == "input").fields}
    assert input_labels == {"length_mm", "sectionName"}


def test_file_path_keys_are_excluded_from_the_input_and_result_sections():
    payload = {
        "input": {"bdf_model": "C:/x/model.bdf", "mesh_size": 50},
        "result": {"output_json": "C:/x/out.json", "assessment": 0.9},
        "output": None,
    }
    doc = generic_adapter(payload, _meta())

    input_labels = {f.label for f in next(s for s in doc.sections if s.key == "input").fields}
    result_labels = {f.label for f in next(s for s in doc.sections if s.key == "result").fields}

    assert input_labels == {"mesh_size"}
    assert result_labels == {"assessment"}


def test_list_of_dicts_becomes_a_table():
    payload = {
        "input": {},
        "result": {
            "candidates": [
                {"name": "A", "weight": 1.0},
                {"name": "B", "weight": 2.0},
            ]
        },
        "output": None,
    }
    doc = generic_adapter(payload, _meta())
    result = next(s for s in doc.sections if s.key == "result")

    assert len(result.tables) == 1
    table = result.tables[0]
    assert table.title == "candidates"
    assert table.columns == ("name", "weight")
    assert table.rows == (("A", 1.0), ("B", 2.0))


def test_verdict_is_read_from_common_keys():
    payload = {"input": {}, "result": {"assessment": "PASS"}, "output": None}
    doc = generic_adapter(payload, _meta())
    assert doc.verdict == "합격"


def test_verdict_is_none_when_no_known_key_exists():
    payload = {"input": {}, "result": {"someNumber": 3}, "output": None}
    doc = generic_adapter(payload, _meta())
    assert doc.verdict is None


def test_output_json_contributes_a_result_table():
    payload = {
        "input": {},
        "result": {},
        "output": {"members": [{"id": 1, "stress": 120.0}]},
    }
    doc = generic_adapter(payload, _meta())
    result = next(s for s in doc.sections if s.key == "result")
    assert result.tables[0].title == "members"


def test_get_adapter_falls_back_to_generic_for_unknown_key():
    assert get_adapter(None) is generic_adapter
    assert get_adapter("no-such-adapter") is generic_adapter


# ── 조용한 누락 금지 ────────────────────────────────────────────────────
# 계산서가 입력을 말없이 빠뜨리면 결재자가 그 사실을 알 방법이 없다.
# 생략 사실은 필드가 아니라 문서 수준 notices 로 올라간다(표지 '유의 사항').

def _result_fields(payload):
    doc = generic_adapter(payload, _meta())
    return next(s for s in doc.sections if s.key == "result").fields


def test_scalar_list_is_joined_into_one_field():
    doc = generic_adapter({"input": {}, "result": {"loads": [1, 2, 3]}, "output": None}, _meta())
    fields = next(s for s in doc.sections if s.key == "result").fields
    assert next(f for f in fields if f.label == "loads").value == "1, 2, 3"
    assert doc.notices == ()


def test_long_scalar_list_is_trimmed_with_a_note():
    fields = _result_fields({"input": {}, "result": {"loads": list(range(30))}, "output": None})
    loads = next(f for f in fields if f.label == "loads")
    assert loads.value.startswith("0, 1, 2")
    assert loads.note == "상위 20개만 표시 (전체 30개)"


def test_float_list_is_not_written_with_binary_repr_artifacts():
    fields = _result_fields({"input": {}, "result": {"vals": [0.1 + 0.2]}, "output": None})
    assert next(f for f in fields if f.label == "vals").value == "0.3"


def test_mixed_list_becomes_a_document_notice_instead_of_vanishing():
    doc = generic_adapter({"input": {}, "result": {"odd": [1, {"a": 2}]}, "output": None}, _meta())
    assert doc.notices == ("해석 결과에서 생략됨: odd",)


def test_rows_of_empty_dicts_become_a_document_notice():
    doc = generic_adapter({"input": {}, "result": {"rows": [{}, {}]}, "output": None}, _meta())
    assert doc.notices == ("해석 결과에서 생략됨: rows",)


def test_deeply_nested_dict_becomes_a_document_notice():
    payload = {"input": {}, "result": {"meta": {"flat": 5, "inner": {"deep": 1}}}, "output": None}
    doc = generic_adapter(payload, _meta())
    fields = next(s for s in doc.sections if s.key == "result").fields
    assert next(f for f in fields if f.label == "meta.flat").value == 5
    assert doc.notices == ("해석 결과에서 생략됨: meta.inner",)


def test_result_and_output_omissions_merge_into_one_notice():
    payload = {"input": {}, "result": {"a": [1, {"x": 1}]}, "output": {"b": [1, {"y": 2}]}}
    doc = generic_adapter(payload, _meta())
    assert doc.notices == ("해석 결과에서 생략됨: a, b",)


def test_input_and_result_omissions_are_separate_notices():
    payload = {"input": {"x": [1, {"a": 2}]}, "result": {"y": [1, {"b": 2}]}, "output": None}
    doc = generic_adapter(payload, _meta())
    assert doc.notices == ("입력 조건에서 생략됨: x", "해석 결과에서 생략됨: y")


def test_empty_containers_produce_neither_field_nor_notice():
    doc = generic_adapter({"input": {}, "result": {"a": [], "b": {}}, "output": None}, _meta())
    assert next(s for s in doc.sections if s.key == "result").fields == ()
    assert doc.notices == ()


# ── 판정 감지 ───────────────────────────────────────────────────────────
# 실제 서비스가 내보내는 문자열로 검증한다. 정확 일치만 보면 전부 공란이 된다.

def _verdict(value):
    return generic_adapter({"input": {}, "result": {"assessment": value}, "output": None}, _meta()).verdict


def test_verdict_matches_carling_total_ok():
    """carling_service._assessment_from_checks 는 'Total OK' 를 내보낸다."""
    assert _verdict("Total OK") == "합격"


def test_verdict_does_not_mistake_not_ok_for_ok():
    """가장 위험한 오류 — 불합격을 합격으로 뒤집으면 안 된다."""
    assert _verdict("Not OK") == "불합격"


def test_verdict_ng_matches_only_as_a_whole_token():
    assert _verdict("NG") == "불합격"
    assert _verdict("bending governs") is None


def test_verdict_reads_warning_and_plain_words():
    assert _verdict("WARNING") == "경고"
    assert _verdict("pass") == "합격"
    assert _verdict("불합격") == "불합격"


@pytest.mark.parametrize(
    "value",
    ["not safe", "not pass", "not passed", "NOT PASS", "Not-Safe",
     "does not pass", "not 합격", "not 적합", "no ok", "never safe"],
)
def test_negated_positive_words_are_never_read_as_pass(value):
    """부정어가 앞선 긍정 토큰은 전부 불합격이다.

    'not ok' 만 리터럴로 막으면 긍정 토큰이 하나 늘 때마다 구멍이 하나 늘어난다.
    합격으로 새는 것이 이 기능의 최악 실패라 토큰 규칙으로 막고 여기서 고정한다.
    """
    assert _verdict(value) == "불합격"


@pytest.mark.parametrize("value", ["not applicable", "not tested", "not run"])
def test_negated_non_verdict_words_stay_unknown(value):
    """부정어가 붙었다고 아무 문장이나 불합격으로 만들지는 않는다."""
    assert _verdict(value) is None


# 고정 목록이 아니라 규칙 자체를 검사한다 — 목록으로 막으면 목록에 없는 표현이 새어 나간다.
@pytest.mark.parametrize("positive", ["ok", "pass", "passed", "safe", "합격", "적합"])
@pytest.mark.parametrize("gap", [0, 1, 2, 3, 5])
def test_negator_flips_positive_at_any_distance(positive, gap):
    """부정어와 긍정어 사이가 얼마나 벌어져도 합격으로 새지 않는다.

    'not currently considered safe' 처럼 두 칸만 벌어져도 뚫리던 창(window) 방식을
    버렸다. 창을 키우는 대신 없앴으므로, 거리를 늘려 가며 규칙을 고정한다.
    """
    filler = " ".join(["currently"] * gap)
    value = f"not {filler} {positive}".replace("  ", " ")
    assert _verdict(value) == "불합격"


@pytest.mark.parametrize(
    "value", ["not,safe", "not/safe", "not.ok", "not;합격", "(not) safe", "safe? no"]
)
def test_punctuation_does_not_hide_the_negator(value):
    """부호가 붙어 'not,' 이 되면 부정어 목록에 안 걸려 그대로 합격이 되던 구멍."""
    assert _verdict(value) == "불합격"


@pytest.mark.parametrize(
    "value",
    ["cannot pass", "cannot be verified as safe", "CANNOT PASS", "cannot 합격"],
)
def test_cannot_is_recognised_without_an_apostrophe(value):
    """'cannot' 은 축약형 복원으로 살아나지 않는다 — 별도 부정어 토큰이어야 한다.

    형식체 보고서일수록 can't 대신 cannot 을 쓴다.
    """
    assert _verdict(value) == "불합격"


@pytest.mark.parametrize(
    "value",
    ["isn't safe", "doesn't pass", "wasn't ok", "aren't safe",
     "can't pass", "won't pass", "didn't pass", "isn’t safe"],
)
def test_contractions_are_not_read_as_pass(value):
    """축약형은 아포스트로피를 떼는 순간 부정어가 통째로 사라진다.

    'isn't safe' → [isn, t, safe] 가 되어 부정어가 없는 것처럼 보이고 'safe' 만 남는다.
    마지막 따옴표는 유니코드 오른쪽 작은따옴표(’) — 문서에서 붙여넣은 문자열 대비.
    """
    assert _verdict(value) == "불합격"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_generic_adapter.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.report.adapters'`

- [ ] **Step 3: 최소 구현**

`app/services/report/adapters/generic.py`:

```python
"""어댑터 미지정 App 이 쓰는 공용 어댑터.

앱별 지식이 없으므로 input_info / result_info 를 기계적으로 편다.
스칼라는 필드, dict 리스트는 표. 파일 경로 키는 근거 섹션이 따로 다루므로 뺀다.
"""
from __future__ import annotations

import re
from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable

# 판정 문자열 토큰 분리 — 영숫자·한글이 아니면 전부 구분자.
_TOKEN_SPLIT_RE = re.compile(r"[^0-9a-z가-힣]+")
# 축약형 부정. 아포스트로피가 구분자라 "isn't" 는 [isn, t] 로 쪼개져 부정어가 사라진다.
# 조동사마다 토큰을 등록하는 대신 n't 를 not 으로 되돌린다.
_CONTRACTION_NOT_RE = re.compile(r"n['’]t\b")

# 경로·내부 식별자 — 계산서 본문에 노출하지 않는다(근거 섹션이 대신 보여 준다).
_EXCLUDED_KEY_SUFFIXES: tuple[str, ...] = ("_json", "_path", "_dir", "_file")
_EXCLUDED_KEYS: frozenset[str] = frozenset({
    "bdf_model", "input_json", "output_json", "work_dir", "_work_dir",
})

# 판정으로 해석할 키와 값. 색이 아니라 한국어 문자열로 굳힌다.
#
# ⚠️ 정확 일치로는 실제 데이터를 못 잡는다 — carling_service 는 "Total OK" / "Not OK" 를
#    내보낸다. 그래서 토큰 단위로 본다.
# ⚠️ 순서가 안전을 좌우한다: 부정 표현을 **먼저** 검사한다. "Not OK" 를 토큰만 보고 처리하면
#    "ok" 가 걸려 불합격이 합격으로 뒤집힌다 — 구조 계산서에서 가장 위험한 오류다.
# ⚠️ 짧은 토큰(ng)은 부분 문자열로 찾지 않는다. "bending" 안의 "ng" 가 걸린다.
_VERDICT_KEYS: tuple[str, ...] = ("assessment", "verdict", "judgement", "result_status")

# 부정어. 같은 문자열 안에 긍정어와 함께 나오면 거리·순서를 따지지 않고 불합격으로 읽는다.
# ⚠️ 창(window)을 두지 않는다. "부정어 바로 앞 N칸" 규칙은 N 을 아무리 키워도
#    'not currently considered safe' 처럼 한 칸만 더 벌어지면 뚫린다. 창을 없애야 닫힌다.
# "cannot" 은 아포스트로피가 없어 축약형 복원으로도 살아나지 않는다. 별도 토큰으로 넣는다
# (형식체 보고서일수록 can't 보다 cannot 을 쓴다).
_VERDICT_NEGATORS: frozenset[str] = frozenset({
    "not", "no", "non", "never", "without", "cannot",
})

# 긍정 토큰을 포함하지 않아 위 규칙으로는 못 잡는 다어절 부정 표현.
_VERDICT_NEGATIVE_PHRASES: tuple[str, ...] = ("no good",)
# 아래 세 묶음은 모두 **토큰 완전 일치**로만 본다.
_VERDICT_NEGATIVE_TOKENS: frozenset[str] = frozenset({
    "fail", "failed", "ng", "nok", "불합격", "부적합",
})
_VERDICT_WARNING_TOKENS: frozenset[str] = frozenset({
    "warn", "warning", "경고", "주의",
})
_VERDICT_POSITIVE_TOKENS: frozenset[str] = frozenset({
    "ok", "pass", "passed", "safe", "합격", "적합",
})

_MAX_TABLE_ROWS = 500
_MAX_LIST_ITEMS = 20


def _is_excluded(key: str) -> bool:
    return key in _EXCLUDED_KEYS or key.endswith(_EXCLUDED_KEY_SUFFIXES)


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def _table_from_rows(title: str, rows: list[dict]) -> ReportTable | None:
    columns: list[str] = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    if not columns:
        return None
    trimmed = rows[:_MAX_TABLE_ROWS]
    note = None if len(rows) <= _MAX_TABLE_ROWS else f"상위 {_MAX_TABLE_ROWS}행만 표시 (전체 {len(rows)}행)"
    return ReportTable(
        title=title,
        columns=tuple(columns),
        rows=tuple(tuple(row.get(col) for col in columns) for row in trimmed),
        note=note,
    )


def _as_text(item: Any) -> str:
    """한 칸에 이어 붙일 때 쓰는 표기.

    float 를 str() 하면 0.1+0.2 가 '0.30000000000000004' 로 굳어 버린다. 스칼라 필드는
    숫자 그대로 넘겨 Excel 이 표시 자릿수를 정하지만, 목록은 텍스트로 굳으므로 여기서 다듬는다.
    """
    if isinstance(item, float):
        return f"{item:g}"
    return "" if item is None else str(item)


def _scalar_list_field(key: str, values: list) -> ReportField:
    """스칼라 목록은 한 칸에 이어 붙인다(하중 배열 등이 통째로 사라지지 않게)."""
    shown = values[:_MAX_LIST_ITEMS]
    text = ", ".join(_as_text(item) for item in shown)
    note = (
        None if len(values) <= _MAX_LIST_ITEMS
        else f"상위 {_MAX_LIST_ITEMS}개만 표시 (전체 {len(values)}개)"
    )
    return ReportField(label=key, value=text, note=note)


def _split(source: dict) -> tuple[tuple[ReportField, ...], tuple[ReportTable, ...], tuple[str, ...]]:
    """payload 한 덩어리를 (필드, 표, 생략된 키) 로 편다.

    ⚠️ 표현할 수 없는 값을 조용히 버리지 않는다 — 무엇이 빠졌는지 세 번째 반환값으로
    올려 보내고, 호출자가 ReportDoc.notices 에 담는다. 계산서가 입력을 말없이 누락하면
    결재자가 그 사실을 알 방법이 없다 (설계원칙 1: 신뢰가 곧 기능).

    생략 사실을 '필드'로 끼워 넣지 않는 이유: 렌더러가 필드를 실제 데이터 행과 똑같이
    그리므로 결재자가 데이터와 구분할 수 없고, result 와 output 에 각각 호출되면 같은
    라벨이 두 번 나온다. notices 는 표지에 '유의 사항'으로 따로 그려진다.
    """
    fields: list[ReportField] = []
    tables: list[ReportTable] = []
    omitted: list[str] = []

    for key, value in (source or {}).items():
        if _is_excluded(key):
            continue
        if _is_scalar(value):
            fields.append(ReportField(label=key, value=value))
        elif isinstance(value, list):
            if not value:
                continue  # 빈 목록은 잃을 정보가 없다
            if all(isinstance(item, dict) for item in value):
                table = _table_from_rows(key, value)
                if table:
                    tables.append(table)
                else:
                    omitted.append(key)
            elif all(_is_scalar(item) for item in value):
                fields.append(_scalar_list_field(key, value))
            else:
                omitted.append(key)  # 혼합 목록은 표로도 한 칸으로도 못 편다
        elif isinstance(value, dict):
            if not value:
                continue
            for sub_key, sub_value in value.items():
                if _is_excluded(sub_key):
                    continue
                if _is_scalar(sub_value):
                    fields.append(ReportField(label=f"{key}.{sub_key}", value=sub_value))
                else:
                    omitted.append(f"{key}.{sub_key}")  # 2단계 이상 중첩은 펴지 않는다
        else:
            omitted.append(key)

    return tuple(fields), tuple(tables), tuple(omitted)


def _tokenize(value: str) -> list[str]:
    """casefold → 축약형 부정 복원 → 영숫자·한글이 아닌 문자는 전부 구분자.

    'not,safe' / 'not/safe' / 'safe?' 처럼 문장부호가 붙어도 부정어가 온전한 토큰으로
    떨어지게 한다. 부호를 안 떼면 'not,' 이 부정어 목록에 안 걸려 그대로 새어 나간다.
    축약형("isn't")은 부호를 떼는 순간 부정어가 통째로 사라지므로 먼저 되돌린다.
    """
    text = _CONTRACTION_NOT_RE.sub(" not ", value.casefold())
    return [token for token in _TOKEN_SPLIT_RE.split(text) if token]


def _match_verdict(value: str) -> str | None:
    """판정 문자열 하나를 한국어 판정으로.

    ⚠️ 이 함수는 **틀리더라도 안전한 쪽으로만 틀리게** 만들어져 있다.
    잘못된 '합격'은 결재를 그대로 통과하지만, 지나친 '불합격'은 사람이 다시 보게 만든다.
    그래서 _VERDICT_NEGATORS 의 부정어와 긍정어가 한 문자열에 함께 있으면 거리도 순서도
    따지지 않고 불합격이다. 'no issues, safe' 가 불합격으로 읽히는 대가를 치르더라도,
    'not currently considered safe' 가 합격으로 읽히는 일은 없어야 한다.

    ⚠️ 다만 부정어는 **고정 목록**이다(not/no/non/never/without/cannot + n't 축약형).
    목록 밖 부정 표현('insufficient', 'fails to meet', 'unable to')은 인식하지 못하고,
    긍정어가 함께 있으면 합격으로 읽힌다. 새 표현이 실제로 관측되면 목록에 추가한다 —
    이 fallback 을 문장 분류기로 키우지 않는다.

    한계(의도적): 'OK but check' 처럼 단서만 달린 표현은 합격으로 읽고, 한국어 활용형
    ('적합하지 않음')과 영어·한국어 밖 문자(중국어·일본어·키릴)는 인식하지 못해
    판정 없음이 된다. 어휘 밖 부정 표현('insufficient', 'fails to meet')도 마찬가지다.
    이건 전용 어댑터가 없는 App 을 위한 fallback 이지 문장 분류기가 아니다 —
    판정이 중요한 App 은 전용 어댑터에서 직접 채운다.
    """
    tokens = _tokenize(value)
    if not tokens:
        return None
    unique = set(tokens)

    if (unique & _VERDICT_NEGATORS) and (unique & _VERDICT_POSITIVE_TOKENS):
        return "불합격"
    if any(phrase in " ".join(tokens) for phrase in _VERDICT_NEGATIVE_PHRASES):
        return "불합격"
    if unique & _VERDICT_NEGATIVE_TOKENS:
        return "불합격"
    if unique & _VERDICT_WARNING_TOKENS:
        return "경고"
    if unique & _VERDICT_POSITIVE_TOKENS:
        return "합격"
    return None


def _detect_verdict(*sources: dict) -> str | None:
    for source in sources:
        for key in _VERDICT_KEYS:
            value = (source or {}).get(key)
            if isinstance(value, str):
                mapped = _match_verdict(value)
                if mapped:
                    return mapped
    return None


def _omission_notice(section_title: str, omitted: tuple[str, ...]) -> str:
    return f"{section_title}에서 생략됨: {', '.join(omitted)}"


def generic_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    input_fields, input_tables, input_omitted = _split(payload.get("input") or {})
    result_fields, result_tables, result_omitted = _split(payload.get("result") or {})

    output = payload.get("output")
    if isinstance(output, dict):
        output_fields, output_tables, output_omitted = _split(output)
        result_fields = (*result_fields, *output_fields)
        result_tables = (*result_tables, *output_tables)
        result_omitted = (*result_omitted, *output_omitted)

    notices: list[str] = []
    if input_omitted:
        notices.append(_omission_notice("입력 조건", input_omitted))
    if result_omitted:
        notices.append(_omission_notice("해석 결과", result_omitted))

    sections = (
        ReportSection(
            key="overview",
            title="개요",
            fields=(
                ReportField(label="해석 App", value=meta.display_name),
                ReportField(label="프로젝트", value=meta.project_name),
                ReportField(label="수행자 사번", value=meta.employee_id),
                ReportField(label="상태", value=meta.status),
            ),
        ),
        ReportSection(key="input", title="입력 조건", fields=input_fields, tables=input_tables),
        ReportSection(key="result", title="해석 결과", fields=result_fields, tables=result_tables),
    )

    return ReportDoc(
        meta=meta,
        verdict=_detect_verdict(payload.get("result") or {}, payload.get("output") or {}),
        sections=sections,
        notices=tuple(notices),
    )
```

`app/services/report/adapters/__init__.py`:

```python
"""어댑터 레지스트리.

program_registry 의 ProgramSpec.report_adapter 값이 이 map 의 키다.
등록되지 않은 키(또는 None)는 generic_adapter 로 떨어진다 — 신규 App 이
아무 등록 없이도 리포트가 나오는 이유다.
"""
from __future__ import annotations

from typing import Callable

from ..models import ReportDoc, ReportMeta
from .generic import generic_adapter

Adapter = Callable[[dict, ReportMeta], ReportDoc]

ADAPTERS: dict[str, Adapter] = {}


def get_adapter(key: str | None) -> Adapter:
    if not key:
        return generic_adapter
    return ADAPTERS.get(key, generic_adapter)
```

`app/services/report/renderers/__init__.py` (빈 패키지 마커, 다음 Task에서 채운다):

```python
"""ReportDoc → 파일 bytes 렌더러."""
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_generic_adapter.py -q`
Expected: PASS — 81 passed (69 + 축약형 부정 8 + cannot 4)

- [ ] **Step 5: 커밋**

```bash
git add app/services/report/adapters app/services/report/renderers tests/test_report_generic_adapter.py
git commit -m "✨ feat: 리포트 generic 어댑터와 어댑터 레지스트리 추가"
```

---

## Task 5: truss-assessment 어댑터

**Files:**
- Create: `app/services/report/adapters/truss_assessment.py`
- Modify: `app/services/report/adapters/__init__.py` (ADAPTERS 등록)
- Test: `tests/test_report_truss_adapter.py`

Truss Assessment 결과 JSON은 `loadCases[].elements[]` 구조다. generic 어댑터는 이 중첩을 못 펴서
표가 하나도 안 나온다. Load Case별 표로 펴는 전용 어댑터를 붙인다.

**주의:** 기존 `/api/analysis/export-xlsx`(`_json_to_xlsx_bytes`)는 **건드리지 않는다.** 그건 부재
전수 데이터용 상세 시트고, 이 어댑터는 결재용 요약 계산서다. 스펙의 "기존 엔드포인트 이행" 표 참조.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_report_truss_adapter.py`:

```python
"""truss-assessment 어댑터 — Load Case 중첩을 표로 편다."""
from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="truss-assessment",
        display_name="Truss Assessment",
        analysis_id=3,
        project_name="truss-p",
        employee_id="EMP001",
        created_at=None,
        status="Success",
    )


def _payload() -> dict:
    return {
        "input": {"bdf_model": "C:/x/m.bdf"},
        "result": {"output_json": "C:/x/out.json"},
        "output": {
            "loadCases": [
                {
                    "loadCaseId": 1,
                    "elements": [
                        {"element": 11, "assessment": 0.42, "result": "OK"},
                        {"element": 12, "assessment": 1.31, "result": "FAIL"},
                    ],
                },
                {
                    "loadCaseId": 2,
                    "elements": [{"element": 11, "assessment": 0.20, "result": "OK"}],
                },
            ]
        },
    }


def test_registered_under_its_registry_key():
    assert get_adapter("truss-assessment") is not get_adapter("no-such-adapter")


def test_makes_one_table_per_load_case():
    doc = get_adapter("truss-assessment")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")

    assert [t.title for t in result.tables] == ["Load Case 1", "Load Case 2"]
    assert result.tables[0].columns == ("element", "assessment", "result")
    assert result.tables[0].rows[1] == (12, 1.31, "FAIL")


def test_verdict_is_fail_when_any_element_fails():
    doc = get_adapter("truss-assessment")(_payload(), _meta())
    assert doc.verdict == "불합격"


def test_summary_field_reports_the_worst_assessment():
    doc = get_adapter("truss-assessment")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    worst = next(f for f in result.fields if f.label == "최대 Assessment")
    assert worst.value == 1.31


def test_verdict_is_pass_when_every_element_is_ok():
    payload = _payload()
    payload["output"]["loadCases"] = [
        {"loadCaseId": 1, "elements": [{"element": 11, "assessment": 0.42, "result": "OK"}]}
    ]
    doc = get_adapter("truss-assessment")(payload, _meta())
    assert doc.verdict == "합격"


def test_missing_output_falls_back_to_an_empty_result_section():
    payload = {"input": {}, "result": {}, "output": None}
    doc = get_adapter("truss-assessment")(payload, _meta())
    result = next(s for s in doc.sections if s.key == "result")
    assert result.tables == ()
    assert doc.verdict is None


def test_verdict_is_unknown_when_no_element_declares_a_result():
    """판정 근거가 없으면 합격이라 단정하지 않는다.

    result 키가 없으면 5배 과응력이어도 any_fail 은 False 다. 그걸 합격으로 찍으면
    없는 데이터로 결재를 통과시키는 셈이다.
    """
    payload = _payload()
    payload["output"]["loadCases"] = [
        {"loadCaseId": 1, "elements": [{"element": 11, "assessment": 5.0}]}
    ]
    assert get_adapter("truss-assessment")(payload, _meta()).verdict is None


def test_verdict_is_unknown_when_every_load_case_is_empty():
    payload = _payload()
    payload["output"]["loadCases"] = [{"loadCaseId": 1, "elements": []}]
    assert get_adapter("truss-assessment")(payload, _meta()).verdict is None


def test_partial_declaration_does_not_yield_a_pass():
    """한 요소가 OK 라고 해서 옆의 판정 없는 과응력 요소까지 합격은 아니다.

    부분 누락은 전면 누락보다 흔하다 — 파이프라인이 일부 result 만 빠뜨리는 경우.
    """
    payload = _payload()
    payload["output"]["loadCases"] = [
        {"loadCaseId": 1, "elements": [{"element": 1, "assessment": 0.4, "result": "OK"}]},
        {"loadCaseId": 2, "elements": [{"element": 2, "assessment": 9.0}]},
    ]
    assert get_adapter("truss-assessment")(payload, _meta()).verdict is None


def test_partial_declaration_is_explained_in_a_notice():
    """판정을 비우기만 하면 승인자는 고장인지 데이터 부족인지 알 수 없다."""
    payload = _payload()
    payload["output"]["loadCases"] = [
        {"loadCaseId": 1, "elements": [{"element": 1, "result": "OK"}, {"element": 2}]},
    ]
    doc = get_adapter("truss-assessment")(payload, _meta())
    assert any("판정 표기가 없는 요소 1건" in notice for notice in doc.notices)


def test_a_known_failure_still_dominates_incomplete_coverage():
    """아는 실패는 커버리지 구멍과 무관하게 불합격이다."""
    payload = _payload()
    payload["output"]["loadCases"] = [
        {"loadCaseId": 1, "elements": [{"element": 1, "result": "FAIL"}, {"element": 2}]},
    ]
    assert get_adapter("truss-assessment")(payload, _meta()).verdict == "불합격"


def test_extra_element_keys_are_kept_as_columns():
    """허용응력 같은 '비율의 근거'가 고정 투영에 잘려 나가면 안 된다."""
    payload = _payload()
    payload["output"]["loadCases"] = [{
        "loadCaseId": 1,
        "elements": [{
            "element": 11, "axial": 100.0, "allowAxial": 250.0,
            "assessment": 0.4, "result": "OK", "note": "x",
        }],
    }]
    table = next(
        s for s in get_adapter("truss-assessment")(payload, _meta()).sections
        if s.key == "result"
    ).tables[0]
    assert table.columns == ("element", "axial", "allowAxial", "assessment", "result", "note")


def test_boolean_assessment_does_not_pollute_the_worst_value():
    payload = _payload()
    payload["output"]["loadCases"] = [{
        "loadCaseId": 1,
        "elements": [{"element": 11, "assessment": True, "result": "OK"}],
    }]
    fields = next(
        s for s in get_adapter("truss-assessment")(payload, _meta()).sections
        if s.key == "result"
    ).fields
    assert not any(f.label == "최대 Assessment" for f in fields)


def test_load_case_without_an_id_is_labelled_explicitly():
    payload = _payload()
    payload["output"]["loadCases"] = [{"elements": [{"element": 1, "result": "OK"}]}]
    table = next(
        s for s in get_adapter("truss-assessment")(payload, _meta()).sections
        if s.key == "result"
    ).tables[0]
    assert table.title == "Load Case (미지정)"


def test_generic_adapter_still_emits_the_result_section_we_replace():
    """delegate-then-replace 는 generic 이 'result' 섹션을 낸다는 전제 위에 있다.

    generic 이 그 키를 바꾸면 이 어댑터는 예외 없이 조용히 무력화된다 — 표도 판정도
    사라진 채 generic 결과만 나간다. 런타임에 못 알아채니 여기서 고정한다.
    """
    from app.services.report.adapters.generic import generic_adapter

    base = generic_adapter({"input": {}, "result": {}, "output": None}, _meta())
    assert any(section.key == "result" for section in base.sections)


def test_generic_omission_notices_survive_the_result_swap():
    """result 섹션만 갈아끼우고 notices 를 떨어뜨리면 조용한 누락으로 되돌아간다.

    truss 어댑터는 loadCases 만 해결한다. input 이나 output 의 다른 키를 generic 이
    펴지 못했다면 그 사실은 계속 남아야 한다.
    """
    payload = _payload()
    payload["input"]["weird"] = [1, {"a": 2}]  # generic 이 표로도 값으로도 못 펴는 모양

    doc = get_adapter("truss-assessment")(payload, _meta())

    assert doc.notices == ("입력 조건에서 생략됨: weird",)


def test_every_declared_report_adapter_is_actually_registered():
    """레지스트리 오타는 조용히 generic 으로 떨어져 알아챌 수 없다.

    get_adapter 는 모르는 키를 generic 으로 폴백한다 — 신규 App 이 등록 없이도
    리포트가 나오게 하려는 의도지만, 그 탓에 report_adapter="truss-assesment" 같은
    오타도 그냥 밋밋한 리포트가 되어 버린다. 여기서 고정한다.
    """
    from app.services.program_registry import PROGRAM_SPECS
    from app.services.report.adapters import ADAPTERS

    declared = {spec.report_adapter for spec in PROGRAM_SPECS if spec.report_adapter}
    assert declared <= set(ADAPTERS), f"ADAPTERS 에 없는 report_adapter: {declared - set(ADAPTERS)}"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_truss_adapter.py -q`
Expected: FAIL — `test_makes_one_table_per_load_case`에서 `IndexError` 또는 빈 tables
(아직 generic 으로 떨어진다)

- [ ] **Step 3: 최소 구현**

`app/services/report/adapters/truss_assessment.py`:

```python
"""Truss Structural Assessment 전용 어댑터.

결과 JSON 의 loadCases[].elements[] 중첩을 Load Case 별 표로 편다.
기존 /api/analysis/export-xlsx(부재 전수 상세 시트)와는 별개 문서다.
"""
from __future__ import annotations

from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

# 열 순서 선호도. 실제 요소가 가진 키는 전부 싣되, 읽는 순서만 여기서 정한다.
# ⚠️ 고정 3열로 투영하면 axial/allowAxial 같은 '비율의 근거'가 흔적 없이 사라진다.
#    승인자가 assessment 값을 검산할 방법이 없어지고, 이 설계가 지켜 온
#    '조용히 버리지 않는다'가 표 열에서만 깨진다.
_PREFERRED_COLUMNS: tuple[str, ...] = (
    "element", "set", "property", "leg", "condition",
    "axial", "bending", "allowAxial", "allowBending",
    "assessment", "result",
)


def _is_number(value: Any) -> bool:
    """bool 은 int 의 하위형이라 그냥 두면 최대값에 섞인다."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _columns_for(elements: list[dict]) -> tuple[str, ...]:
    """요소들이 실제로 가진 키 전부를, 선호 순서를 앞세워 돌려준다."""
    seen: list[str] = []
    for item in elements:
        for key in item:
            if key not in seen:
                seen.append(key)
    preferred = [key for key in _PREFERRED_COLUMNS if key in seen]
    rest = [key for key in seen if key not in _PREFERRED_COLUMNS]
    return tuple(preferred + rest)


def _rows_for(elements: list[dict], columns: tuple[str, ...]) -> tuple[tuple[Any, ...], ...]:
    return tuple(tuple(item.get(col) for col in columns) for item in elements)


def _case_title(case: dict) -> str:
    case_id = case.get("loadCaseId")
    return f"Load Case {case_id}" if case_id is not None else "Load Case (미지정)"


def truss_assessment_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    output = payload.get("output")
    load_cases = (output or {}).get("loadCases") if isinstance(output, dict) else None
    if not isinstance(load_cases, list) or not load_cases:
        # 결과 파일이 없거나 형태가 다르면 기계적 전개로 물러선다.
        return generic_adapter(payload, meta)

    tables: list[ReportTable] = []
    worst: float | None = None
    any_fail = False
    any_declared = False  # result 값을 하나라도 읽었는가
    undeclared = 0  # result 표기가 아예 없는 요소 수

    for case in load_cases:
        if not isinstance(case, dict):
            continue
        elements = [e for e in (case.get("elements") or []) if isinstance(e, dict)]
        for element in elements:
            value = element.get("assessment")
            if _is_number(value):
                worst = value if worst is None else max(worst, value)
            token = str(element.get("result", "")).strip().upper()
            if token:
                any_declared = True
                if token == "FAIL":
                    any_fail = True
            else:
                undeclared += 1
        columns = _columns_for(elements)
        tables.append(
            ReportTable(
                title=_case_title(case),
                columns=columns,
                rows=_rows_for(elements, columns),
            )
        )

    fields: list[ReportField] = [
        ReportField(label="Load Case 수", value=len(tables)),
    ]
    if worst is not None:
        fields.append(ReportField(label="최대 Assessment", value=worst))

    base = generic_adapter(payload, meta)
    sections = tuple(
        ReportSection(key="result", title="해석 결과", fields=tuple(fields), tables=tuple(tables))
        if section.key == "result"
        else section
        for section in base.sections
    )

    # base.notices 를 반드시 이어받는다. 우리는 result 섹션만 다시 만들 뿐, generic 이
    # 펴지 못한 다른 키(입력 조건 쪽, 또는 output 의 loadCases 외 항목)를 대신 표현하지는
    # 않는다. 여기서 notices 를 떨어뜨리면 '무엇이 빠졌는지' 만 사라지고 데이터는 계속
    # 빠진 채로 남는다 — 조용한 누락으로 되돌아간다.
    # ⚠️ 합격은 '전 부재가 통과했음이 확인될 때'만 쓴다.
    #    한 요소만 OK 를 달아도 문서 전체가 합격으로 열리면, 바로 옆의 판정 표기 없는
    #    과응력 요소가 합격에 묻힌다. 부분 누락(파이프라인이 일부 result 만 빠뜨림)이
    #    전면 누락보다 흔하므로 여기가 실제 위험 지점이다.
    #    불합격은 커버리지와 무관하게 우선한다 — 아는 실패는 아는 실패다.
    if any_fail:
        verdict = "불합격"
    elif undeclared or not any_declared:
        verdict = None
    else:
        verdict = "합격"

    # 판정을 비우는 데 그치지 않고 왜 비었는지 남긴다. 빈 칸만 보면 승인자는
    # 도구가 고장 난 건지 데이터가 부족한 건지 구분할 수 없다.
    notices = list(base.notices)
    if undeclared:
        notices.append(
            f"판정 표기가 없는 요소 {undeclared}건이 있습니다 — "
            "전 부재에 대한 합격 여부는 확인되지 않았습니다."
        )

    return ReportDoc(
        meta=meta,
        verdict=verdict,
        sections=sections,
        notices=tuple(notices),
    )
```

`app/services/report/adapters/__init__.py`의 `ADAPTERS`를 채운다:

```python
from .generic import generic_adapter
from .truss_assessment import truss_assessment_adapter

Adapter = Callable[[dict, ReportMeta], ReportDoc]

ADAPTERS: dict[str, Adapter] = {
    "truss-assessment": truss_assessment_adapter,
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_truss_adapter.py tests/test_report_generic_adapter.py -q`
Expected: PASS — 98 passed (truss 17 + generic 81)

- [ ] **Step 5: 커밋**

```bash
git add app/services/report/adapters tests/test_report_truss_adapter.py
git commit -m "✨ feat: Truss Assessment 리포트 어댑터 추가"
```

---

## Task 6: GenericRenderer (ReportDoc → XLSX)

**Files:**
- Create: `app/services/report/verdict_vocab.py`
- Create: `app/services/report/renderers/generic_xlsx.py`
- Modify: `app/services/report/adapters/generic.py` (판정 낱말을 공유 모듈에서 가져오도록)
- Test: `tests/test_report_generic_renderer.py`

### Step 0: 판정 낱말 단일 출처

`app/services/report/verdict_vocab.py`:

```python
"""판정 낱말 — 어댑터와 렌더러가 함께 쓰는 단일 출처.

어댑터는 이 낱말로 문자열에서 판정을 읽어 내고, 렌더러는 같은 낱말로 표의 실패 행을
강조한다. 두 곳에 따로 적어 두면 조용히 어긋난다 — 어댑터가 '부적합'을 불합격으로
읽는데 렌더러는 그 행을 강조하지 않는 식이다. 그러면 '실패 행이 눈에 걸려야 한다'는
약속이 어휘 불일치만으로 깨지고, 아무 테스트도 깨지지 않는다.

여기에는 **낱말만** 둔다. 부정어·부정 표현처럼 문장을 해석하는 규칙은 어댑터의 몫이다.
"""

NEGATIVE_TOKENS: frozenset[str] = frozenset({
    "fail", "failed", "ng", "nok", "불합격", "부적합",
})
WARNING_TOKENS: frozenset[str] = frozenset({
    "warn", "warning", "경고", "주의",
})
POSITIVE_TOKENS: frozenset[str] = frozenset({
    "ok", "pass", "passed", "safe", "합격", "적합",
})
```

그리고 `app/services/report/adapters/generic.py` 의 세 상수를 이 모듈에서 가져오도록 바꾼다
(값은 그대로다 — 출처만 옮긴다):

```python
from .. import verdict_vocab

_VERDICT_NEGATIVE_TOKENS = verdict_vocab.NEGATIVE_TOKENS
_VERDICT_WARNING_TOKENS = verdict_vocab.WARNING_TOKENS
_VERDICT_POSITIVE_TOKENS = verdict_vocab.POSITIVE_TOKENS
```

`_VERDICT_NEGATORS` 와 `_VERDICT_NEGATIVE_PHRASES` 는 **옮기지 않는다** — 문장 해석 규칙이라
렌더러에는 쓸모가 없다.

스타일은 기존 `assessment_service._json_to_xlsx_bytes`(`app/services/assessment_service.py:57` 부근)의
팔레트를 그대로 따른다 — 헤더 `002554`(Trust Blue), 섹션 `D6E0F0`, FAIL `FFE4E4`/`CC0000`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_report_generic_renderer.py`:

```python
"""GenericRenderer — ReportDoc 을 XLSX bytes 로."""
import io
import zipfile

import pytest

import openpyxl

from app.services.report.models import (
    ReportDoc,
    ReportField,
    ReportMeta,
    ReportSection,
    ReportTable,
)
from app.services.report.renderers.generic_xlsx import _text_width, render_generic_xlsx


def _doc(**overrides) -> ReportDoc:
    base = dict(
        meta=ReportMeta(
            program_id="column-buckling",
            display_name="Column Buckling Load Calculator",
            analysis_id=7,
            project_name="ColumnBuckling_20260818",
            employee_id="EMP001",
            created_at=None,
            status="Success",
        ),
        verdict="합격",
        sections=(
            ReportSection(
                key="overview",
                title="개요",
                fields=(ReportField(label="해석 App", value="Column Buckling Load Calculator"),),
            ),
            ReportSection(
                key="result",
                title="해석 결과",
                fields=(ReportField(label="최대 허용 하중", value=12.5, unit="ton"),),
                tables=(
                    ReportTable(
                        title="후보",
                        columns=("호칭", "중량"),
                        rows=((1, 2.0), (3, 4.0)),
                    ),
                ),
            ),
        ),
    )
    base.update(overrides)
    return ReportDoc(**base)


def _load(data: bytes):
    return openpyxl.load_workbook(io.BytesIO(data))


def test_returns_a_valid_xlsx_zip():
    data = render_generic_xlsx(_doc())
    assert zipfile.is_zipfile(io.BytesIO(data))


def test_creates_one_sheet_per_section_plus_cover():
    wb = _load(render_generic_xlsx(_doc()))
    assert wb.sheetnames[0] == "표지"
    assert "개요" in wb.sheetnames
    assert "해석 결과" in wb.sheetnames


def test_cover_shows_verdict_as_text():
    wb = _load(render_generic_xlsx(_doc()))
    cover = wb["표지"]
    values = [cell.value for row in cover.iter_rows() for cell in row]
    assert "합격" in values


def test_field_unit_lands_in_its_own_column():
    wb = _load(render_generic_xlsx(_doc()))
    ws = wb["해석 결과"]
    rows = [[c.value for c in row] for row in ws.iter_rows()]
    assert ["최대 허용 하중", 12.5, "ton"] in [row[:3] for row in rows]


def test_table_headers_and_rows_are_written():
    wb = _load(render_generic_xlsx(_doc()))
    ws = wb["해석 결과"]
    rows = [[c.value for c in row] for row in ws.iter_rows()]
    flat = [row[:2] for row in rows]
    assert ["호칭", "중량"] in flat
    assert [1, 2.0] in flat


def test_notices_are_written_on_the_cover():
    doc = _doc(notices=("표준 양식 미적용",))
    wb = _load(render_generic_xlsx(doc))
    values = [cell.value for row in wb["표지"].iter_rows() for cell in row]
    assert "표준 양식 미적용" in values


def test_duplicate_section_titles_get_unique_sheet_names():
    doc = _doc(
        sections=(
            ReportSection(key="overview", title="개요"),
            ReportSection(key="custom", title="개요"),
        )
    )
    wb = _load(render_generic_xlsx(doc))
    assert len(set(wb.sheetnames)) == len(wb.sheetnames)


def test_long_section_title_is_truncated_to_excel_sheet_limit():
    doc = _doc(sections=(ReportSection(key="overview", title="가" * 40),))
    wb = _load(render_generic_xlsx(doc))
    assert all(len(name) <= 31 for name in wb.sheetnames)


# ── 판정을 읽히게 만들기 ────────────────────────────────────────────────
# 결재자가 긴 표를 훑을 때 실패 행이 눈에 걸려야 한다. 색만으로 알리지는 않는다
# (글자는 그대로 '불합격'), 색을 아예 안 쓰지도 않는다.

def _cells(ws):
    return [cell for row in ws.iter_rows() for cell in row]


def _table_doc(rows, columns=("부재", "판정")):
    return _doc(
        sections=(
            ReportSection(
                key="result",
                title="해석 결과",
                tables=(ReportTable(title="부재", columns=columns, rows=rows),),
            ),
        )
    )


def test_failing_table_row_is_filled_and_passing_row_is_not():
    ws = _load(render_generic_xlsx(_table_doc((("A", "합격"), ("B", "불합격")))))["해석 결과"]

    fail_cell = next(c for c in _cells(ws) if c.value == "불합격")
    pass_cell = next(c for c in _cells(ws) if c.value == "합격")

    assert fail_cell.fill.patternType == "solid"
    assert fail_cell.font.color.rgb.endswith("CC0000")
    assert pass_cell.fill.patternType is None


def test_verdict_cell_on_cover_is_coloured_as_well_as_written():
    ws = _load(render_generic_xlsx(_doc(verdict="불합격")))["표지"]
    cell = next(c for c in _cells(ws) if c.value == "불합격")
    assert cell.font.color.rgb.endswith("CC0000")


def test_wide_table_columns_are_sized_to_their_content():
    doc = _table_doc(
        rows=(("H-300x300", 300, 10, 94.0, "합격"),),
        columns=("호칭", "외경", "두께", "중량(kg/m)", "판정"),
    )
    ws = _load(render_generic_xlsx(doc))["해석 결과"]

    # ⚠️ openpyxl 의 기본 열 너비는 None 이 아니라 13.0 이다. '>= 8' 같은 느슨한 임계값은
    #    고정 폭 시절에도 우연히 통과한다. 실제로 내용에 맞춰졌는지 값으로 못박는다.
    assert ws.column_dimensions["A"].width == _text_width("H-300x300") + 2   # 11
    assert ws.column_dimensions["D"].width == _text_width("중량(kg/m)") + 2  # 12 (한글 2폭)
    assert ws.column_dimensions["E"].width == 10  # 내용이 짧아 하한(_MIN_COL_WIDTH)에 걸린다


def test_undetermined_verdict_is_written_out_not_left_blank():
    """빈 칸은 '아직 안 채운 항목'처럼 보인다 — 판정 불가와 구분되어야 한다."""
    ws = _load(render_generic_xlsx(_doc(verdict=None)))["표지"]
    assert "판정 미확정" in [cell.value for cell in _cells(ws)]


def test_undetermined_verdict_is_marked_as_a_caution_not_a_pass():
    ws = _load(render_generic_xlsx(_doc(verdict=None)))["표지"]
    cell = next(c for c in _cells(ws) if c.value == "판정 미확정")
    assert cell.font.color.rgb.endswith("CC6600")


def test_first_table_header_row_is_frozen():
    """200행 넘는 표에서 스크롤하면 열 이름이 사라진다."""
    doc = _table_doc(rows=tuple((f"E{index}", "합격") for index in range(50)))
    ws = _load(render_generic_xlsx(doc))["해석 결과"]
    assert ws.freeze_panes is not None


@pytest.mark.parametrize(
    "word,colour",
    [("부적합", "CC0000"), ("failed", "CC0000"), ("주의", "CC6600"), ("적합", "1B7A3D")],
)
def test_renderer_highlights_every_word_the_adapter_understands(word, colour):
    """어댑터가 아는 낱말인데 렌더러가 모르면 실패 행이 조용히 강조를 잃는다."""
    ws = _load(render_generic_xlsx(_table_doc(rows=(("A", word),))))["해석 결과"]
    cell = next(c for c in _cells(ws) if c.value == word)
    assert cell.font.color.rgb.endswith(colour)


def test_an_unrelated_column_holding_a_verdict_word_does_not_paint_the_row():
    """무관한 열의 'OK' 가 규격 이탈 행을 합격 색으로 칠하던 문제.

    등록 어댑터가 없는 23개 App 이 전부 generic 표 경로를 쓰므로 실제로 도달한다.
    """
    doc = _table_doc(rows=(("W1", "OK", 8.4),), columns=("id", "inspector_note", "gap_mm"))
    ws = _load(render_generic_xlsx(doc))["해석 결과"]

    cell = next(c for c in _cells(ws) if c.value == "OK")
    assert cell.fill.patternType is None
    assert cell.font.color is None


def test_a_real_verdict_column_still_paints_the_row():
    doc = _table_doc(rows=(("W1", "불합격"),), columns=("id", "판정"))
    ws = _load(render_generic_xlsx(doc))["해석 결과"]

    cell = next(c for c in _cells(ws) if c.value == "불합격")
    assert cell.fill.patternType == "solid"


def test_renderer_and_adapter_share_one_verdict_vocabulary():
    """같은 낱말 목록을 두 곳에 적어 두면 언젠가 어긋난다 — 출처가 하나여야 한다."""
    from app.services.report import verdict_vocab
    from app.services.report.adapters import generic as adapter
    from app.services.report.renderers import generic_xlsx as renderer

    assert renderer._FAIL_WORDS is verdict_vocab.NEGATIVE_TOKENS
    assert renderer._WARN_WORDS is verdict_vocab.WARNING_TOKENS
    assert renderer._PASS_WORDS is verdict_vocab.POSITIVE_TOKENS
    assert adapter._VERDICT_NEGATIVE_TOKENS is verdict_vocab.NEGATIVE_TOKENS
    assert adapter._VERDICT_WARNING_TOKENS is verdict_vocab.WARNING_TOKENS
    assert adapter._VERDICT_POSITIVE_TOKENS is verdict_vocab.POSITIVE_TOKENS


def test_values_openpyxl_cannot_write_are_stringified_instead_of_crashing():
    """표 셀에 리스트·사전이 들어와도 리포트 생성이 죽지 않아야 한다.

    generic._table_from_rows 는 행 값에 리스트를 그대로 실을 수 있고, 그걸 openpyxl 에
    넘기면 저장 시 ValueError 로 리포트 전체가 실패한다. 계산서는 죽는 대신
    덜 예쁘게 나오는 쪽을 택한다.
    """
    doc = _table_doc(rows=((["a", "b"], {"k": 1}),), columns=("목록", "사전"))

    ws = _load(render_generic_xlsx(doc))["해석 결과"]

    values = [cell.value for cell in _cells(ws)]
    assert "['a', 'b']" in values
    assert "{'k': 1}" in values
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_generic_renderer.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.report.renderers.generic_xlsx'`

- [ ] **Step 3: 최소 구현**

`app/services/report/renderers/generic_xlsx.py`:

```python
"""ReportDoc → XLSX bytes (양식 없는 범용 서식).

디스크에 쓰지 않는다 — 저장하는 순간 사내 DRM 이 암호화한다. BytesIO 만 쓴다.
색 팔레트는 assessment_service._json_to_xlsx_bytes 와 맞춘다(PRODUCT.md Trust Blue).
"""
from __future__ import annotations

import io
from datetime import date, datetime, time
from decimal import Decimal

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .. import verdict_vocab
from ..models import ReportDoc, ReportSection

_HDR_FILL = PatternFill("solid", fgColor="002554")
_HDR_FONT = Font(bold=True, color="FFFFFF", size=9)
_SEC_FILL = PatternFill("solid", fgColor="D6E0F0")
_SEC_FONT = Font(bold=True, color="002554", size=10)
_TITLE_FONT = Font(bold=True, color="002554", size=14)
_BASE_FONT = Font(size=9)
_LABEL_FONT = Font(bold=True, size=9)
_LEFT = Alignment(horizontal="left", vertical="center")
_CENTER = Alignment(horizontal="center", vertical="center")

# 판정 강조 — 색만으로 알리지 않는다(PRODUCT.md 접근성). 글자는 이미 '불합격'/'합격'이고
# 여기에 색을 덧입혀, 긴 표를 훑을 때 실패 행이 눈에 걸리게 한다.
# assessment_service._json_to_xlsx_bytes 와 같은 팔레트를 쓴다.
_FAIL_FILL = PatternFill("solid", fgColor="FFE4E4")
_FAIL_FONT = Font(bold=True, color="CC0000", size=9)
_WARN_FONT = Font(bold=True, color="CC6600", size=9)
_PASS_FONT = Font(bold=True, color="1B7A3D", size=9)

# ⚠️ 낱말 목록을 여기에 따로 적지 않는다. 어댑터가 '부적합'을 불합격으로 읽는데
#    렌더러가 그 행을 강조하지 않으면, '실패 행이 눈에 걸려야 한다'는 약속이
#    어휘 불일치만으로 조용히 깨진다. 단일 출처에서 가져온다.
_FAIL_WORDS = verdict_vocab.NEGATIVE_TOKENS
_WARN_WORDS = verdict_vocab.WARNING_TOKENS
_PASS_WORDS = verdict_vocab.POSITIVE_TOKENS
_STATUS_FONT = {"fail": _FAIL_FONT, "warn": _WARN_FONT, "pass": _PASS_FONT}

# ⚠️ 판정어를 행 전체에서 찾지 않는다. 표 열은 그냥 라벨이라 어떤 열이 판정인지 표시가 없고,
#    무관한 열('inspector_note' 값이 우연히 "OK')이 행 전체를 합격 색으로 칠해 버린다.
#    실제로 규격을 벗어난 행이 초록으로, 문제 있는 행이 무색으로 나오는 역전이 생긴다.
#    adapters/generic._VERDICT_KEYS 가 최상위 키를 제한하는 것과 같은 취지를 열 이름에 적용한다.
_VERDICT_COLUMN_NAMES: frozenset[str] = frozenset({
    "result", "verdict", "judgement", "judgment", "result_status",
    "assessment", "판정", "결과",
})

_SHEET_NAME_LIMIT = 31
# Excel 시트 이름에 쓸 수 없는 문자.
_FORBIDDEN = ':\\/?*[]'

# 열 너비 자동 맞춤 범위. 표 열이 3개를 넘으면 고정 너비로는 헤더가 잘린다.
_MIN_COL_WIDTH = 10
_MAX_COL_WIDTH = 52


def _safe_sheet_name(title: str, used: set[str]) -> str:
    cleaned = "".join("_" if ch in _FORBIDDEN else ch for ch in (title or "섹션")).strip() or "섹션"
    cleaned = cleaned[:_SHEET_NAME_LIMIT]
    candidate = cleaned
    suffix = 2
    while candidate.casefold() in used:
        tail = f"_{suffix}"
        candidate = cleaned[: _SHEET_NAME_LIMIT - len(tail)] + tail
        suffix += 1
    used.add(candidate.casefold())
    return candidate


def _cell_value(value):
    """openpyxl 이 셀에 쓸 수 없는 값은 텍스트로 굳힌다.

    generic._table_from_rows 는 행 값에 리스트·사전을 그대로 실을 수 있다. 그대로
    넘기면 wb.save 에서 ValueError 가 나 리포트 생성 전체가 죽는다 — 계산서는
    죽는 대신 덜 예쁘게 나오는 쪽이 낫다.
    """
    if value is None or isinstance(value, (str, int, float, bool, Decimal, datetime, date, time)):
        return value
    return str(value)


def _text_width(value) -> int:
    """대략적인 표시 폭. 한글·한자는 라틴 문자의 두 배로 친다."""
    text = "" if value is None else str(value)
    return sum(2 if ord(ch) > 0x2E80 else 1 for ch in text)


def _autofit(ws, widths: dict[int, int]) -> None:
    for index, width in widths.items():
        ws.column_dimensions[get_column_letter(index)].width = max(
            _MIN_COL_WIDTH, min(width + 2, _MAX_COL_WIDTH)
        )


def _status_of(value) -> str | None:
    """셀 값이 판정어인지. 표 안에 묻힌 실패를 찾아내는 데 쓴다."""
    if not isinstance(value, str):
        return None
    token = value.strip().casefold()
    if token in _FAIL_WORDS:
        return "fail"
    if token in _WARN_WORDS:
        return "warn"
    if token in _PASS_WORDS:
        return "pass"
    return None


def _row_status(row, columns: tuple[str, ...]) -> str | None:
    """행의 판정. **판정 열에서만** 읽는다. 실패가 하나라도 있으면 실패로 본다.

    판정으로 볼 만한 열이 하나도 없으면 아무 강조도 하지 않는다 — 잘못된 강조는
    강조가 없는 것보다 나쁘다. 결재자의 눈을 엉뚱한 행으로 끌기 때문이다.
    """
    seen: set[str] = {
        status
        for name, value in zip(columns, row)
        if str(name).strip().casefold() in _VERDICT_COLUMN_NAMES
        and (status := _status_of(value))
    }
    for level in ("fail", "warn", "pass"):
        if level in seen:
            return level
    return None


def _verdict_cell(verdict: str | None):
    """판정 칸의 표기와 글꼴.

    비어 있으면 '판정 미확정'이라고 분명히 적는다 — 빈 칸은 '아직 안 채운 항목'처럼
    보여서 '판정할 근거가 없다'와 구분되지 않는다. 어댑터가 근거 부족을 이유로
    None 을 낸 노력이 렌더 층에서 도로 사라지면 안 된다.
    """
    if verdict is None:
        return "판정 미확정", _WARN_FONT
    return verdict, _STATUS_FONT.get(_status_of(verdict), _BASE_FONT)


def _write_cover(ws, doc: ReportDoc) -> None:
    ws["A1"] = f"{doc.meta.display_name} 해석 계산서"
    ws["A1"].font = _TITLE_FONT
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 46

    verdict_text, verdict_font = _verdict_cell(doc.verdict)
    rows = [
        ("해석 App", doc.meta.display_name),
        ("프로젝트", doc.meta.project_name),
        ("수행자 사번", doc.meta.employee_id),
        ("수행 일시", doc.meta.created_at.strftime("%Y-%m-%d %H:%M") if doc.meta.created_at else None),
        ("작업 상태", doc.meta.status),
        ("판정", verdict_text),
        ("적용 양식", "사내 표준 양식" if doc.template_applied else "범용 서식"),
    ]
    row_ptr = 3
    for label, value in rows:
        ws.cell(row=row_ptr, column=1, value=label).font = _LABEL_FONT
        ws.cell(row=row_ptr, column=1).alignment = _LEFT
        cell = ws.cell(row=row_ptr, column=2, value=value)
        # 판정 줄만 색을 덧입힌다 — 글자('불합격')는 그대로 두므로 색에만 기대지 않는다.
        cell.font = verdict_font if label == "판정" else _BASE_FONT
        cell.alignment = _LEFT
        row_ptr += 1

    if doc.notices:
        row_ptr += 1
        header = ws.cell(row=row_ptr, column=1, value="유의 사항")
        header.fill = _SEC_FILL
        header.font = _SEC_FONT
        row_ptr += 1
        for notice in doc.notices:
            ws.cell(row=row_ptr, column=1, value=notice).font = _BASE_FONT
            row_ptr += 1


def _write_section(ws, section: ReportSection) -> None:
    widths: dict[int, int] = {}
    freeze_at: int | None = None  # 첫 표의 헤더 아래 — 스크롤해도 열 이름이 남게

    def put(row, column, value, *, font=_BASE_FONT, fill=None, align=None):
        cell = ws.cell(row=row, column=column, value=_cell_value(value))
        cell.font = font
        if fill is not None:
            cell.fill = fill
        if align is not None:
            cell.alignment = align
        widths[column] = max(widths.get(column, 0), _text_width(value))
        return cell

    row_ptr = 1
    put(row_ptr, 1, section.title, font=_SEC_FONT, fill=_SEC_FILL, align=_LEFT)
    row_ptr += 2

    for item in section.fields:
        put(row_ptr, 1, item.label, font=_LABEL_FONT)
        put(row_ptr, 2, item.value)
        if item.unit:
            put(row_ptr, 3, item.unit)
        if item.note:
            put(row_ptr, 4, item.note)
        row_ptr += 1

    for table in section.tables:
        row_ptr += 1
        put(row_ptr, 1, table.title, font=_SEC_FONT)
        row_ptr += 1
        for col_index, column in enumerate(table.columns, start=1):
            put(row_ptr, col_index, column, font=_HDR_FONT, fill=_HDR_FILL, align=_CENTER)
        row_ptr += 1
        if freeze_at is None:
            freeze_at = row_ptr
        for row in table.rows:
            # 긴 표에 묻힌 실패 행은 훑어서는 안 보인다. 글자는 그대로 두고 색을 덧입힌다.
            status = _row_status(row, table.columns)
            font = _STATUS_FONT.get(status, _BASE_FONT)
            fill = _FAIL_FILL if status == "fail" else None
            for col_index, value in enumerate(row, start=1):
                put(row_ptr, col_index, value, font=font, fill=fill)
            row_ptr += 1
        if table.note:
            put(row_ptr, 1, table.note)
            row_ptr += 1

    _autofit(ws, widths)
    if freeze_at is not None:
        # 200행 넘는 표에서 스크롤하면 열 이름이 사라진다. 첫 표 헤더를 고정한다.
        ws.freeze_panes = f"A{freeze_at}"


def render_generic_xlsx(doc: ReportDoc) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)

    used: set[str] = set()
    cover = wb.create_sheet(_safe_sheet_name("표지", used))
    _write_cover(cover, doc)

    for section in doc.ordered_sections():
        ws = wb.create_sheet(_safe_sheet_name(section.title, used))
        _write_section(ws, section)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_generic_renderer.py -q`
Expected: PASS — 22 passed (20 + 판정 열 한정 2)

- [ ] **Step 5: 커밋**

```bash
git add app/services/report/renderers/generic_xlsx.py tests/test_report_generic_renderer.py
git commit -m "✨ feat: 리포트 범용 XLSX 렌더러 추가"
```

---

## Task 7: 오케스트레이터 service.py

**Files:**
- Create: `app/services/report/service.py`
- Modify: `app/services/report/__init__.py`
- Test: `tests/test_report_service.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_report_service.py`:

```python
"""리포트 오케스트레이터 — 레코드에서 bytes 까지."""
import io

import openpyxl
import pytest

from app import models
from app.services.report.service import (
    ReportNotAvailable,
    build_report_xlsx,
    report_capabilities,
)


def _record(**kwargs) -> models.Analysis:
    defaults = {
        "id": 7,
        "employee_id": "EMP001",
        "program_name": "Column Buckling Load Calculator",
        "project_name": "p",
        "status": "Success",
        "input_info": {"length_mm": 3000},
        "result_info": {"maxWorkingLoadTon": 12.5},
    }
    defaults.update(kwargs)
    return models.Analysis(**defaults)


def test_builds_xlsx_for_an_app_without_any_adapter(tmp_path):
    filename, data = build_report_xlsx(_record(), user_connection_base=str(tmp_path))

    assert filename.endswith(".xlsx")
    wb = openpyxl.load_workbook(io.BytesIO(data))
    assert wb.sheetnames[0] == "표지"


def test_filename_carries_program_and_analysis_id(tmp_path):
    filename, _ = build_report_xlsx(_record(), user_connection_base=str(tmp_path))
    assert "column-buckling" in filename
    assert "7" in filename


def test_rejects_a_record_without_results(tmp_path):
    with pytest.raises(ReportNotAvailable):
        build_report_xlsx(_record(result_info=None), user_connection_base=str(tmp_path))


def test_rejects_a_failed_record(tmp_path):
    with pytest.raises(ReportNotAvailable):
        build_report_xlsx(_record(status="Failed"), user_connection_base=str(tmp_path))


def test_unknown_program_name_still_produces_a_report(tmp_path):
    record = _record(program_name="아직 등록 안 된 App")
    filename, data = build_report_xlsx(record, user_connection_base=str(tmp_path))
    assert data
    assert "unknown" in filename


def test_applied_form_is_stated_on_the_cover_row_not_buried_in_notices(tmp_path):
    """서식 종류는 표지의 「적용 양식」 행이 말한다.

    유의 사항 블록은 이 해석 고유의 경고만 담는다 — 문서 메타 정보를 섞으면
    '왜 판정이 비었는가' 같은 정작 중요한 줄이 묻힌다.
    """
    _, data = build_report_xlsx(_record(), user_connection_base=str(tmp_path))
    wb = openpyxl.load_workbook(io.BytesIO(data))
    values = [cell.value for row in wb["표지"].iter_rows() for cell in row]

    assert "범용 서식" in values
    assert not any(isinstance(v, str) and "범용 서식으로 생성" in v for v in values)


def test_an_adapter_returning_the_wrong_type_falls_back_like_an_exception(tmp_path, monkeypatch):
    """예외만 막으면 폴백이 반쪽이다 — 조용한 None 반환도 같게 취급해야 한다."""
    from app.services.report import service as service_module

    monkeypatch.setattr(service_module, "get_adapter", lambda key: (lambda payload, meta: None))

    filename, data = build_report_xlsx(_record(), user_connection_base=str(tmp_path))

    assert data
    wb = openpyxl.load_workbook(io.BytesIO(data))
    values = [cell.value for row in wb["표지"].iter_rows() for cell in row]
    assert "전용 어댑터가 실패해 기본 서식으로 생성되었습니다." in values


def test_failed_provenance_lookup_is_distinguished_from_having_no_artifacts(tmp_path, monkeypatch):
    """'조회 실패'와 '원래 없음'은 다른 사실이다 — 같은 문구로 쓰면 승인자가 오해한다."""
    from app.services.report import service as service_module

    def _boom(*args, **kwargs):
        raise RuntimeError("passport 실패")

    monkeypatch.setattr(service_module, "build_analysis_passport", _boom)

    _, data = build_report_xlsx(_record(), user_connection_base=str(tmp_path))

    wb = openpyxl.load_workbook(io.BytesIO(data))
    values = [cell.value for sheet in wb for row in sheet.iter_rows() for cell in row]
    assert "조회 실패" in values
    assert "기록 없음" not in values
    assert any(isinstance(v, str) and "계보를 조회하지 못했습니다" in v for v in values)


def test_capabilities_lists_registered_programs():
    caps = report_capabilities()
    assert caps["truss-assessment"]["reportable"] is True
    assert caps["truss-assessment"]["hasTemplate"] is False
    assert "displayName" in caps["truss-assessment"]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.report.service'`

- [ ] **Step 3: 최소 구현**

`app/services/report/service.py`:

```python
"""리포트 생성 오케스트레이터.

레코드 → payload → 어댑터 → (근거 계보 부착) → 렌더러 → XLSX bytes.
2단계에서 TemplateRenderer 가 붙을 자리는 renderer 선택 지점 한 곳뿐이다.
"""
from __future__ import annotations

import logging

from ..analysis_passport import build_analysis_passport
from ..program_registry import PROGRAM_SPECS, resolve_program
from .adapters import generic_adapter, get_adapter
from .models import ReportDoc, ReportField, ReportMeta, ReportSection
from .payload import collect_payload
from .renderers.generic_xlsx import render_generic_xlsx

logger = logging.getLogger(__name__)

_COMPLETED_STATUSES: frozenset[str] = frozenset({"success", "완료", "completed"})

# ⚠️ '범용 서식으로 생성됨'을 notices 에 넣지 않는다.
#    표지에 이미 「적용 양식 : 범용 서식」 행이 있어 순수 중복이고, 유의 사항 블록은
#    이 해석 고유의 경고(무엇이 생략됐는지, 왜 판정이 비었는지)만 담아야 읽힌다.
#    서식 종류 같은 문서 메타 정보를 같은 목록에 섞으면 정작 중요한 줄이 묻힌다.
#    덤으로 2단계에서 문구가 거짓이 될 지뢰도 사라진다 — template_applied 가 표지를 몰고 간다.


class ReportNotAvailable(Exception):
    """리포트를 만들 수 없는 레코드 (미완료·결과 없음)."""


def _meta_for(record, program_id: str, display_name: str) -> ReportMeta:
    return ReportMeta(
        program_id=program_id,
        display_name=display_name,
        analysis_id=record.id,
        project_name=record.project_name,
        employee_id=record.employee_id,
        created_at=record.created_at,
        status=record.status,
    )


def _provenance_section(passport: dict | None, *, lookup_failed: bool) -> ReportSection:
    """근거 파일 섹션.

    ⚠️ '조회 실패'와 '원래 없음'을 같은 문구로 쓰지 않는다. 둘은 다른 사실이고,
    승인자가 구분할 수 없으면 근거가 없는 해석을 근거가 있는 것으로 오해할 수 있다.
    """
    artifacts = (passport or {}).get("artifacts") or []
    fields = tuple(
        ReportField(
            label=str(item.get("name") or item.get("role") or "산출물"),
            value=str(item.get("status") or "확인됨"),
            note=str(item.get("role")) if item.get("role") else None,
        )
        for item in artifacts
    )
    if not fields:
        fields = (
            ReportField(
                label="산출물",
                value="조회 실패" if lookup_failed else "기록 없음",
                note=(
                    "산출물 계보를 읽지 못했습니다 — 근거 파일이 없다는 뜻은 아닙니다."
                    if lookup_failed else None
                ),
            ),
        )
    return ReportSection(key="provenance", title="근거 파일", fields=fields)


def _verdict_section(verdict: str | None) -> ReportSection:
    return ReportSection(
        key="verdict",
        title="판정",
        fields=(ReportField(label="종합 판정", value=verdict or "판정 없음"),),
    )


def build_report_doc(record, *, user_connection_base: str) -> ReportDoc:
    if str(record.status or "").strip().casefold() not in _COMPLETED_STATUSES:
        raise ReportNotAvailable("완료된 해석만 리포트를 생성할 수 있습니다.")
    if not isinstance(record.result_info, dict) or not record.result_info:
        raise ReportNotAvailable("완료된 해석만 리포트를 생성할 수 있습니다.")

    spec = resolve_program(record.program_name)
    program_id = spec.program_id if spec else "unknown"
    display_name = spec.display_name if spec else (record.program_name or "Unknown App")

    payload = collect_payload(record, user_connection_base=user_connection_base)
    meta = _meta_for(record, program_id, display_name)

    adapter = get_adapter(spec.report_adapter if spec else None)
    notices: tuple[str, ...] = ()
    try:
        doc = adapter(payload, meta)
        # 예외만 막으면 폴백이 반쪽이다 — 어댑터가 조용히 None 을 돌려주면(early return 실수 등)
        # 이 블록 밖에서 AttributeError 로 터진다. 계약 위반도 예외와 같게 취급한다.
        if not isinstance(doc, ReportDoc):
            raise TypeError(f"어댑터가 ReportDoc 이 아닌 {type(doc).__name__} 을 돌려줬습니다")
    except Exception:
        logger.warning("리포트: 어댑터 실패 — generic 으로 폴백합니다", exc_info=True)
        # get_adapter(None) 을 다시 부르지 않는다. 그건 정의상 generic_adapter 이므로
        # 안전을 더해 주는 게 없고, 1차 조회와 실패 지점만 공유하게 된다 —
        # 조회 경로 자체가 망가진 상황에서 폴백이 같은 길로 다시 들어간다.
        doc = generic_adapter(payload, meta)
        notices = ("전용 어댑터가 실패해 기본 서식으로 생성되었습니다.",)

    passport_failed = False
    try:
        passport = build_analysis_passport(record, user_connection_base=user_connection_base)
    except Exception:
        logger.info("리포트: passport 생성 실패 — 조회 실패로 표기합니다", exc_info=True)
        passport = None
        passport_failed = True
        notices = (
            *notices,
            "근거 파일 계보를 조회하지 못했습니다 — 산출물 유무는 이 계산서로 판단할 수 없습니다.",
        )

    sections = (
        # ordered_sections() 가 STANDARD_SECTION_ORDER 로 다시 정렬하므로 여기 순서는 무의미하다.
        *doc.sections,
        _verdict_section(doc.verdict),
        _provenance_section(passport, lookup_failed=passport_failed),
    )

    return ReportDoc(
        meta=doc.meta,
        verdict=doc.verdict,
        sections=sections,
        provenance=passport,
        template_applied=False,
        notices=(*doc.notices, *notices),
    )


def build_report_xlsx(record, *, user_connection_base: str) -> tuple[str, bytes]:
    """(파일명, XLSX bytes). 디스크에 쓰지 않는다."""
    doc = build_report_doc(record, user_connection_base=user_connection_base)
    filename = f"WorkBench_Report_{doc.meta.program_id}_{doc.meta.analysis_id}.xlsx"
    return filename, render_generic_xlsx(doc)


def report_capabilities() -> dict[str, dict]:
    """program_id → 리포트 가능 여부. 프론트 카탈로그 표시용."""
    return {
        spec.program_id: {
            "reportable": True,
            "hasTemplate": bool(spec.report_template),
            "displayName": spec.display_name,
        }
        for spec in PROGRAM_SPECS
    }
```

`app/services/report/__init__.py`에 공개 API를 재노출한다(기존 docstring 아래에 추가):

```python
from .service import ReportNotAvailable, build_report_xlsx, report_capabilities  # noqa: E402,F401

__all__ = ["ReportNotAvailable", "build_report_xlsx", "report_capabilities"]
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_service.py -q`
Expected: PASS — 9 passed (7 + 계약 위반·조회 실패 2)

- [ ] **Step 5: 커밋**

```bash
git add app/services/report/service.py app/services/report/__init__.py tests/test_report_service.py
git commit -m "✨ feat: 리포트 오케스트레이터 추가 — 판정·근거 섹션 자동 부착"
```

---

## Task 8: reports 라우터 + 등록 + 게이트

**Files:**
- Create: `app/routers/reports.py`
- Modify: `app/main.py:202` 부근 (`include_router`)
- Modify: `app/services/app_settings.py` (`GUARDED_ROUTES`)
- Test: `tests/test_reports_router.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_reports_router.py`:

```python
"""reports 라우터 — 권한과 응답 계약."""
from datetime import datetime

from app import models


def _seed(db_session, employee_id="EMP001", status="Success"):
    record = models.Analysis(
        employee_id=employee_id,
        program_name="Column Buckling Load Calculator",
        project_name="p",
        status=status,
        input_info={"length_mm": 3000},
        result_info={"maxWorkingLoadTon": 12.5},
        created_at=datetime(2026, 8, 18, 9, 0, 0),
    )
    db_session.add(record)
    db_session.commit()
    return record


def test_capabilities_returns_a_program_map(admin_client):
    res = admin_client.get("/api/reports/capabilities")
    assert res.status_code == 200
    body = res.json()
    assert body["truss-assessment"]["reportable"] is True


def test_generate_returns_xlsx_bytes(admin_client, db_session):
    record = _seed(db_session, employee_id="ADMIN001")

    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 200
    assert res.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "attachment" in res.headers["content-disposition"]
    assert res.content[:2] == b"PK"


def test_generate_rejects_another_users_record(switchable_client, db_session):
    record = _seed(db_session, employee_id="ADMIN001")
    switchable_client.as_user()

    res = switchable_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 403


def test_admin_can_generate_for_any_record(switchable_client, db_session):
    record = _seed(db_session, employee_id="EMP001")
    switchable_client.as_admin()

    res = switchable_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 200


def test_generate_returns_404_for_unknown_id(admin_client):
    res = admin_client.post("/api/reports/generate", json={"analysis_id": 999999})
    assert res.status_code == 404


def test_generate_returns_400_for_an_incomplete_record(admin_client, db_session):
    record = _seed(db_session, employee_id="ADMIN001", status="Failed")
    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})
    assert res.status_code == 400


def test_user_connection_base_matches_the_download_endpoint():
    """경로가 한 단계만 어긋나도 결과 파일과 근거 섹션이 조용히 사라진다.

    예외가 안 나도록 만들어 둔 설계라 깨져도 소리가 안 난다 — 여기서 고정한다.
    """
    import os

    from app.routers import analysis as analysis_router
    from app.routers import reports as reports_router

    assert reports_router._USER_CONNECTION_DIR == analysis_router._USER_CONNECTION_DIR
    assert os.path.basename(reports_router._USER_CONNECTION_DIR) == "userConnection"


def test_output_json_under_user_connection_reaches_the_report(admin_client, db_session, tmp_path, monkeypatch):
    """단위 테스트는 base 를 직접 넘겨 받으므로 라우터의 배선 실수를 잡지 못한다.

    라우터가 실제로 쓰는 상수를 통해 결과 파일이 리포트에 실리는지 확인한다.
    """
    import io
    import json

    import openpyxl

    from app.routers import reports as reports_router

    base = tmp_path / "userConnection"
    job = base / "20260818_ADMIN001_Job"
    job.mkdir(parents=True)
    out = job / "result.json"
    out.write_text(json.dumps({"members": [{"id": 7, "stress": 123.0}]}), encoding="utf-8")
    monkeypatch.setattr(reports_router, "_USER_CONNECTION_DIR", str(base))

    record = _seed(db_session, employee_id="ADMIN001")
    record.result_info = {"output_json": str(out)}
    db_session.commit()

    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})

    assert res.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    values = [cell.value for sheet in wb for row in sheet.iter_rows() for cell in row]
    assert 123.0 in values
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_reports_router.py -q`
Expected: FAIL — 모든 요청이 404 (라우터 미등록)

- [ ] **Step 3: 최소 구현**

`app/routers/reports.py`:

```python
"""해석 리포트 생성 API.

생성이 POST 인 이유: App 가용성 게이트(services/app_settings_gate.py)는
POST/PUT/PATCH/DELETE 만 검사한다. GET 으로 두면 관리자가 이 App 을 점검 중으로
내려도 API 는 열린 채 남는다.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import database, models
from ..dependencies import require_auth
from ..services.activity_service import log_activity
from ..services.report import ReportNotAvailable, build_report_xlsx, report_capabilities
from ._access_control import assert_current_user_can_access_owner

router = APIRouter(prefix="/api/reports", tags=["reports"])

# ⚠️ dirname 을 세 번 올라가야 백엔드 루트다(app/routers/reports.py → app/routers → app → 루트).
#    두 번만 올라가면 존재하지 않는 app/userConnection 을 가리키고, payload._is_within 이
#    모든 실제 경로를 거부해 결과 파일과 근거 파일 섹션이 **조용히** 사라진다 —
#    보안 문제는 아니지만(더 엄격해질 뿐) 예외가 안 나서 깨진 줄 모른 채 배포된다.
#    analysis.py 와 같은 값이어야 하며, tests/test_reports_router.py 가 그걸 고정한다.
_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))
_USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ReportRequest(BaseModel):
    analysis_id: int = Field(..., description="리포트를 만들 해석 이력 id")


@router.get("/capabilities")
def get_capabilities(_employee_id: str = Depends(require_auth)) -> dict:
    """program_id 별 리포트 가능 여부. 카탈로그 표시용 읽기 전용."""
    return report_capabilities()


@router.post("/generate")
def generate_report(
    body: ReportRequest,
    req: Request,
    db: Session = Depends(database.get_db),
    employee_id: str = Depends(require_auth),
) -> Response:
    record = db.query(models.Analysis).filter(models.Analysis.id == body.analysis_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="해석 이력을 찾을 수 없습니다.")

    assert_current_user_can_access_owner(record.employee_id, employee_id, db)

    try:
        filename, data = build_report_xlsx(record, user_connection_base=_USER_CONNECTION_DIR)
    except ReportNotAvailable as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    log_activity(
        db,
        "EXPORT_REPORT",
        employee_id=employee_id,
        action_detail={"analysis_id": record.id, "program_name": record.program_name},
        ip_address=req.client.host if req.client else None,
    )

    return Response(
        content=data,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
```

`app/main.py` — import 목록에 `reports`를 넣고, `include_router` 마지막 줄 뒤에 추가한다:

```python
    application.include_router(reports.router)
```

`app/services/app_settings.py`의 `GUARDED_ROUTES` 마지막 항목 뒤에 추가한다:

```python
    ("/api/reports/generate", "Analysis Report Generator"),
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_reports_router.py -q`
Expected: PASS — 8 passed (6 + 경로 배선 2)

- [ ] **Step 5: 백엔드 전체 회귀 확인**

Run: `./WorkBenchEnv/Scripts/python.exe -m pytest -q`

Expected: **신규 실패 0건.** 단, 아래 2건은 이 계획 착수 전부터 실패하던 것이라 무시한다
(둘 다 `program_registry` / `services.report` 를 전혀 참조하지 않는다 — grep 0건으로 확인).

| 기존 실패 | 원인 |
|---|---|
| `test_drawing_image_lug_fixtures.py::test_generated_lug_image_fixtures_seed_distinct_params_and_mesh` | `Figure/lug_test_basic_160x100.png` 픽스처 파일이 저장소에 없음 |
| `test_mooring_edit_bdf.py::test_connect_rejects_node_already_dependent` | git 미추적인 `WorkBenchSubModule/Nastran_bridge/nastran_bridge.py` 의 동작 드리프트 |

이 둘을 고치는 것은 이 계획의 범위가 아니다. **3건 이상 실패하면** 그때는 우리가 깬 것이므로 조사한다.

- [ ] **Step 6: 커밋**

```bash
git add app/routers/reports.py app/main.py app/services/app_settings.py tests/test_reports_router.py
git commit -m "✨ feat: 리포트 생성 API 추가 — POST 로 App 가용성 게이트 적용"
```

---

## Task 9: 프론트 API + 이력 병합 순수 함수

**Files:**
- Modify: `src/api/reports.js` (기존 사용량 리포트 함수는 그대로 두고 아래에 추가)
- Create: `src/utils/reportCatalogue.js`
- Test: `src/utils/reportCatalogue.test.js`

작업 디렉터리는 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/utils/reportCatalogue.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { decorateHistoryForReport } from './reportCatalogue.js';

const CAPS = {
  'truss-assessment': { reportable: true, hasTemplate: false, displayName: 'Truss Assessment' },
  'carling-free': { reportable: true, hasTemplate: true, displayName: 'Carling Free Calculator' },
};

test('완료된 이력은 리포트 가능으로 표시된다', () => {
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: 'Truss Assessment', status: 'Success' }],
    CAPS,
  );
  assert.equal(rows[0].reportable, true);
  assert.equal(rows[0].blockedReason, null);
});

test('실패한 이력은 사유와 함께 차단된다', () => {
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: 'Truss Assessment', status: 'Failed' }],
    CAPS,
  );
  assert.equal(rows[0].reportable, false);
  assert.equal(rows[0].blockedReason, '완료된 해석만 리포트를 만들 수 있습니다.');
});

test('capabilities 에 없는 App 도 범용 서식으로 생성 가능하다', () => {
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: '처음 보는 App', status: 'Success' }],
    CAPS,
  );
  assert.equal(rows[0].reportable, true);
  assert.equal(rows[0].hasTemplate, false);
});

test('양식 보유 여부가 표시된다', () => {
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: 'Carling Free Calculator', status: 'Success' }],
    CAPS,
  );
  assert.equal(rows[0].hasTemplate, true);
});

test('빈 입력은 빈 배열을 돌려준다', () => {
  assert.deepEqual(decorateHistoryForReport(null, CAPS), []);
  assert.deepEqual(decorateHistoryForReport([], null), []);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test src/utils/reportCatalogue.test.js`
Expected: FAIL — `Cannot find module './reportCatalogue.js'`

- [ ] **Step 3: 최소 구현**

`src/utils/reportCatalogue.js`:

```javascript
/**
 * 해석 이력 행에 '리포트 생성 가능 여부'를 붙이는 순수 함수.
 *
 * 백엔드 capabilities 는 program_id 키인데 이력 행은 program_name(표시명)을 가진다.
 * 표시명으로 매칭하고, 못 찾으면 범용 서식으로 생성 가능하다고 본다
 * (백엔드 generic 경로가 어떤 App 이든 받아 주기 때문).
 */

const COMPLETED = new Set(['success', 'completed', '완료']);

export function decorateHistoryForReport(rows, capabilities) {
  if (!Array.isArray(rows)) return [];
  const caps = capabilities || {};
  const byDisplayName = new Map(
    Object.values(caps)
      .filter((entry) => entry && entry.displayName)
      .map((entry) => [entry.displayName, entry]),
  );

  return rows.map((row) => {
    const entry = byDisplayName.get(row.program_name) || null;
    const completed = COMPLETED.has(String(row.status || '').toLowerCase());
    return {
      ...row,
      hasTemplate: Boolean(entry && entry.hasTemplate),
      reportable: completed,
      blockedReason: completed ? null : '완료된 해석만 리포트를 만들 수 있습니다.',
    };
  });
}
```

`src/api/reports.js` 맨 아래에 추가:

```javascript
/** program_id 별 리포트 가능 여부 조회. */
export function getReportCapabilities({ signal } = {}) {
  return axios.get(`${API_BASE_URL}/api/reports/capabilities`, {
    headers: getAuthHeaders(),
    signal,
  });
}

/**
 * 해석 1건의 계산서(XLSX)를 받아 브라우저 다운로드를 트리거한다.
 * 생성이 POST 인 이유는 백엔드 라우터 docstring 참조(App 가용성 게이트).
 */
export async function downloadAnalysisReport({ analysisId }) {
  const res = await axios.post(
    `${API_BASE_URL}/api/reports/generate`,
    { analysis_id: analysisId },
    { headers: getAuthHeaders(), responseType: 'blob' },
  );

  const disposition = res.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : `WorkBench_Report_${analysisId}.xlsx`;

  const blobUrl = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test src/utils/reportCatalogue.test.js`
Expected: PASS — 5 passed

- [ ] **Step 5: 커밋**

```bash
git add src/api/reports.js src/utils/reportCatalogue.js src/utils/reportCatalogue.test.js
git commit -m "✨ feat: 리포트 생성 프론트 API 와 이력 병합 함수 추가"
```

---

## Task 10: Report Generator 페이지

**Files:**
- Create: `src/pages/analysis/AnalysisReportGenerator.jsx`

- [ ] **Step 1: 페이지 작성**

`src/pages/analysis/AnalysisReportGenerator.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Download, Loader2 } from 'lucide-react';

import { getAnalysisHistory } from '../../api/analysis';
import { downloadAnalysisReport, getReportCapabilities } from '../../api/reports';
import { decorateHistoryForReport } from '../../utils/reportCatalogue';
import { useToast } from '../../contexts/ToastContext';

export default function AnalysisReportGenerator() {
  const { showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [appFilter, setAppFilter] = useState('ALL');

  const employeeId = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}').employee_id || '';
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [historyRes, capsRes] = await Promise.all([
          getAnalysisHistory(employeeId),
          getReportCapabilities(),
        ]);
        if (!alive) return;
        setRows(decorateHistoryForReport(historyRes.data, capsRes.data));
      } catch {
        if (alive) showToast('해석 이력을 불러오지 못했습니다.', 'error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [employeeId, showToast]);

  const appNames = useMemo(
    () => ['ALL', ...Array.from(new Set(rows.map((r) => r.program_name))).sort()],
    [rows],
  );

  const visibleRows = useMemo(
    () => (appFilter === 'ALL' ? rows : rows.filter((r) => r.program_name === appFilter)),
    [rows, appFilter],
  );

  const selected = useMemo(
    () => visibleRows.find((r) => r.id === selectedId) || null,
    [visibleRows, selectedId],
  );

  const handleGenerate = useCallback(async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      await downloadAnalysisReport({ analysisId: selected.id });
      showToast('계산서를 내려받았습니다.', 'success');
    } catch (error) {
      const detail = error?.response?.data?.detail || '리포트 생성에 실패했습니다.';
      showToast(detail, 'error');
    } finally {
      setGenerating(false);
    }
  }, [selected, showToast]);

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[#002554]">Analysis Report Generator</h1>
        <p className="mt-1 text-sm text-slate-600">
          완료된 해석 이력을 선택해 표준 계산서(XLSX)를 생성합니다.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">해석 이력</h2>
            <select
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              value={appFilter}
              onChange={(event) => setAppFilter(event.target.value)}
            >
              {appNames.map((name) => (
                <option key={name} value={name}>{name === 'ALL' ? '전체 App' : name}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">불러오는 중…</p>
          ) : visibleRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">해석 이력이 없습니다.</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
              {visibleRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={!row.reportable}
                    onClick={() => setSelectedId(row.id)}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm ${
                      row.id === selectedId ? 'bg-blue-50' : 'hover:bg-slate-50'
                    } ${row.reportable ? '' : 'cursor-not-allowed opacity-50'}`}
                  >
                    <span>
                      <span className="block font-medium text-slate-800">{row.program_name}</span>
                      <span className="block text-xs text-slate-500">
                        {row.project_name} · {row.created_at}
                      </span>
                    </span>
                    {row.hasTemplate && (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        양식 있음
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">선택한 해석</h2>
          {!selected ? (
            <p className="text-sm text-slate-500">왼쪽 목록에서 해석을 선택하세요.</p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">App</dt><dd className="font-medium">{selected.program_name}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">프로젝트</dt><dd>{selected.project_name}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">상태</dt><dd>{selected.status}</dd></div>
              <div className="flex justify-between">
                <dt className="text-slate-500">적용 양식</dt>
                <dd>{selected.hasTemplate ? '사내 표준 양식' : '범용 서식'}</dd>
              </div>
            </dl>
          )}

          <button
            type="button"
            disabled={!selected || generating}
            onClick={handleGenerate}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-[#002554] px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {generating ? '생성 중…' : '계산서 생성'}
          </button>

          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <FileSpreadsheet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            양식이 등록되지 않은 App 은 범용 서식으로 생성되며, 그 사실이 계산서 표지에 표기됩니다.
          </p>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 임포트 계약 확인 (계획 작성 시점에 실측한 값)**

아래 두 가지는 이미 확인된 사실이다. 그대로여야 한다.

Run: `grep -n "export const getAnalysisHistory" src/api/analysis.js`
Expected: `src/api/analysis.js:18` — `getAnalysisHistory(employeeId, skip = 0, limit = 50, filters = {})`
(페이지는 첫 인자만 넘기므로 기본값 `skip=0, limit=50`이 적용된다. 이력이 50건을 넘으면
잘리는데, 1단계에서는 최근 50건만 다루기로 한다.)

Run: `grep -n "export const useToast" src/contexts/ToastContext.jsx`
Expected: `src/contexts/ToastContext.jsx:99` — Provider value 는 `{ showToast }` 하나뿐이다.

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공 (오류 0건)

- [ ] **Step 4: 커밋**

```bash
git add src/pages/analysis/AnalysisReportGenerator.jsx
git commit -m "✨ feat: Analysis Report Generator 페이지 추가"
```

---

## Task 11: 카탈로그 등록과 라우팅

**Files:**
- Modify: `src/contexts/DashboardContext.jsx` (`RAW_ANALYSIS_DATA`, `APP_REGISTRY_OVERRIDES`, `APP_CAPABILITY_METADATA`)
- Modify: `src/App.jsx` (import + `renderPage()` case)

- [ ] **Step 1: 카탈로그 항목 추가**

`src/contexts/DashboardContext.jsx`의 `RAW_ANALYSIS_DATA` 중 Productivity 블록 마지막
(`선급 Rule 기반 선체 가속도 Calculation` 항목 뒤)에 추가한다:

```javascript
  { mode: "Productivity", category: "Report", title: "Analysis Report Generator", description: "완료된 해석 이력을 선택하여 표준 계산서(XLSX)를 생성합니다.", icon: Wrench, color: "bg-amber-500", tags: ["계산서", "리포트", "XLSX"], devStatus: "Developing", contributor: "권혁민" },
```

`APP_REGISTRY_OVERRIDES`에 추가한다:

```javascript
  "Analysis Report Generator": {
    menuName: "Analysis Report Generator",
    programNames: ["Analysis Report Generator"],
  },
```

`APP_CAPABILITY_METADATA`에 추가한다:

```javascript
  "Analysis Report Generator": { inputFormats: ["해석 이력"], outputFormats: ["XLSX"], workflow: "Productivity" },
```

- [ ] **Step 2: 라우팅 추가**

`src/App.jsx`의 import 블록에 추가한다(다른 페이지 import 들과 같은 자리):

```javascript
import AnalysisReportGenerator from './pages/analysis/AnalysisReportGenerator';
```

`renderPage()`의 `case 'Productivity Apps':` 줄 근처에 추가한다:

```javascript
      case 'Analysis Report Generator': return <AnalysisReportGenerator />;
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공

- [ ] **Step 4: 프론트 단위 테스트 전체 확인**

Run: `node --test src/utils/`
Expected: 기존 테스트 포함 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add src/contexts/DashboardContext.jsx src/App.jsx
git commit -m "✨ feat: Analysis Report Generator 를 App 카탈로그와 라우팅에 등록"
```

> ⚠️ `git status`로 `src/config.js`가 스테이징되지 않았는지 반드시 확인한다(CLAUDE.md 규칙).

---

## Task 12: 수동 통합 확인

**Files:** 없음 (실행 검증)

- [ ] **Step 1: 백엔드 실행**

Run (작업 디렉터리 `HiTessWorkBenchBackEnd`):

```bash
./WorkBenchEnv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9091
```

Expected: 기동 로그에 오류 없음

- [ ] **Step 2: capabilities 응답 확인**

Run: `curl -s http://localhost:9091/api/reports/capabilities`
Expected: `truss-assessment` 키가 포함된 JSON

- [ ] **Step 3: 프론트 개발 서버로 화면 확인**

Run (작업 디렉터리 `HiTessWorkBench/frontend`): `npm run dev`

확인 항목:
- Productivity Apps 목록에 `Analysis Report Generator` 카드가 보인다
- 카드를 열면 해석 이력이 나열되고, 실패 이력은 비활성이다
- 완료된 이력을 골라 [계산서 생성]을 누르면 XLSX 가 내려받아진다
- 받은 파일을 Excel 로 열어 표지에 판정과 "범용 서식"이 적혀 있는지 본다

- [ ] **Step 4: 확인 결과를 커밋 없이 보고**

문제가 있으면 해당 Task 로 돌아가 고친다. 없으면 다음 단계(2단계 계획) 준비 완료.

---

## 배포 메모 (구현 완료 후 보고에 포함할 것)

- 백엔드 변경은 **모두 git 추적 대상**이다 → 운영 서버(145)는 `git pull` + 백엔드 재시작으로 끝난다.
- **InHouseProgram 수동 교체 대상 없음.** StudioProgram zip 배포도 해당 없음.
- 프론트엔드 변경이 있으므로 WorkBench 클라이언트 재배포 대상이다.
- 신규 App 은 `devStatus: "Developing"` 으로 등록되므로 일반 사용자에게는 막혀 있다.
  공개하려면 관리자가 `Administration > App Settings` 에서 `Active` 로 바꾼다.
