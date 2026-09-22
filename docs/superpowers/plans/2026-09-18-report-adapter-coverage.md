# 계산서 어댑터 확대 (Plan I) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/reports/generate` 하나가 정상 종료된 모든 App 이력에 대해 xlsx/PDF 를 돌려주도록, `report_scope="planned"` 로 남아 있는 9개 프로그램에 **전용 어댑터**를 붙이고 라우트에 `format` 파라미터를 얹는다. Unit 권상 · Mooring · Module Ocean 의 **자체 리포트 파이프라인은 손대지 않는다** — 그 세 계열은 자기 라우트(`/api/analysis/unit-structural/report`, `/api/analysis/mooring-fitting/report`, `module_ocean_report`)로 이미 서빙 중이고, `group-module-unit`·`side-passage`·`mooring-fitting-solve` 어댑터는 `/api/reports/generate` 요청에만 응한다.

**Architecture:** 백엔드 — `services/report/adapters/{hp_scr_psa, hp_scr_por, mooring_fitting_solve, model_builder_analysis, group_module_unit, side_passage, hull_acceleration, plate_structure, double_pipe_fuel_line}.py` 9개 + 각 어댑터 테스트 + `services/report/adapters/__init__.py::ADAPTERS` map 등록 + `services/program_registry.PROGRAM_SPECS` 의 9개 스펙을 `report_adapter="<키>"` + `report_scope="supported"` 로 뒤집기 + `services/report/service.py::build_report_bytes()`(신규, `build_report_xlsx` 는 얇은 래퍼로 남긴다) + `routers/reports.py::ReportRequest.format` 필드와 `_content_disposition()` 확장자 분기 + `PdfConversionError → 503` 매핑. 프론트 — `AnalysisReportGenerator.jsx` 우측 카드에 형식 라디오 [PDF/xlsx] 기본 PDF + `api/reports.js::downloadAnalysisReport({..., format})` 시그니처 확장 + `readBlobErrorDetail` 503 문구 표시.

**Tech Stack:** Python 3.14 / FastAPI / pydantic v2 / SQLAlchemy / pytest — React 18 + Vite + Tailwind + lucide-react 0.284 + axios — Excel COM(pywin32, Unit 권상 PDF 용으로 이미 설치). 신규 pip 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-18-report-adapter-coverage-design.md` (마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1·§2.9)

**규칙(마스터 §1):** 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"** 다. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다(로컬 백엔드 토글). `Darkmode.js/` 는 건드리지 않는다. 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과) 순으로 간다. 프론트는 러너가 없어 수동 검증 절차를 따른다. 문서·주석·UI 문구는 한국어, 식별자는 영어.

**테스트 실행 위치:** 모든 pytest 는 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest …` 로. 프론트 빌드 확인은 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서 `npm run build`.

**규모 표시:** 신규 파일 20개(어댑터 9 + 어댑터 테스트 9 + 라우터 테스트 1 + fixtures 폴더 1)·수정 파일 4개(`__init__.py`, `program_registry.py`, `service.py`, `reports.py`, `AnalysisReportGenerator.jsx`, `api/reports.js`). 이 plan 은 순수 Python + JSX. **InHouse 프로그램 변경 없음**(어댑터는 이미 저장된 `result_info` 만 읽는다).

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/services/report/adapters/hp_scr_psa.py` | 생성 | HP-SCR PSA 전용 어댑터 |
| `HiTessWorkBenchBackEnd/app/services/report/adapters/hp_scr_por.py` | 생성 | HP-SCR POR 전용 어댑터(PSA 헬퍼 공유) |
| `HiTessWorkBenchBackEnd/app/services/report/adapters/mooring_fitting_solve.py` | 생성 | MooringFittingSolve 전용 어댑터 |
| `HiTessWorkBenchBackEnd/app/services/report/adapters/model_builder_analysis.py` | 생성 | ModelBuilderAnalysis 전용 어댑터 |
| `HiTessWorkBenchBackEnd/app/services/report/adapters/group_module_unit.py` | 생성 | Group & Module Unit 권상 요약 어댑터 |
| `HiTessWorkBenchBackEnd/app/services/report/adapters/side_passage.py` | 생성 | Side Passage 요약 어댑터 |
| `HiTessWorkBenchBackEnd/app/services/report/adapters/hull_acceleration.py` | 생성 | 선급 Rule 선체 가속도 어댑터 |
| `HiTessWorkBenchBackEnd/app/services/report/adapters/plate_structure.py` | 생성 | Plate Structure 어댑터 |
| `HiTessWorkBenchBackEnd/app/services/report/adapters/double_pipe_fuel_line.py` | 생성 | 이중관 연료배관 어댑터 |
| `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py` | 수정 | `ADAPTERS` map 에 9개 엔트리 추가 |
| `HiTessWorkBenchBackEnd/app/services/program_registry.py` | 수정 | 9개 `ProgramSpec` 에 `report_adapter=...`+`report_scope="supported"` |
| `HiTessWorkBenchBackEnd/app/services/report/service.py` | 수정 | `build_report_bytes(record, *, user_connection_base, format)` 신설, `build_report_xlsx` 는 래퍼로 보존, `_report_filename` 확장자 분기 |
| `HiTessWorkBenchBackEnd/app/routers/reports.py` | 수정 | `ReportRequest.format` 필드, `_content_disposition(..., extension=)`, `PdfConversionError → 503` |
| `HiTessWorkBenchBackEnd/tests/test_report_adapter_hp_scr_psa.py` | 생성 | PSA 어댑터 계약 |
| `HiTessWorkBenchBackEnd/tests/test_report_adapter_hp_scr_por.py` | 생성 | POR 어댑터 계약 |
| `HiTessWorkBenchBackEnd/tests/test_report_adapter_mooring_fitting_solve.py` | 생성 | Solve 어댑터 계약 |
| `HiTessWorkBenchBackEnd/tests/test_report_adapter_model_builder_analysis.py` | 생성 | ModelBuilder 어댑터 계약 |
| `HiTessWorkBenchBackEnd/tests/test_report_adapter_group_module_unit.py` | 생성 | 권상 요약 어댑터 계약 |
| `HiTessWorkBenchBackEnd/tests/test_report_adapter_side_passage.py` | 생성 | SidePassage 어댑터 계약 |
| `HiTessWorkBenchBackEnd/tests/test_report_adapter_hull_acceleration.py` | 생성 | 선체 가속도 어댑터 계약 |
| `HiTessWorkBenchBackEnd/tests/test_report_adapter_plate_structure.py` | 생성 | Plate 어댑터 계약 |
| `HiTessWorkBenchBackEnd/tests/test_report_adapter_double_pipe_fuel_line.py` | 생성 | 이중관 어댑터 계약 |
| `HiTessWorkBenchBackEnd/tests/test_report_router_format.py` | 생성 | `format` 파라미터 통합 테스트(xlsx 기본, pdf 성공, 503 매핑, 하위호환) |
| `HiTessWorkBench/frontend/src/api/reports.js` | 수정 | `downloadAnalysisReport({..., format})` 시그니처 확장, 503 detail 흐름 |
| `HiTessWorkBench/frontend/src/pages/analysis/AnalysisReportGenerator.jsx` | 수정 | 형식 라디오 [PDF/xlsx] 기본 PDF, handleGenerate 에 format 전달 |

---

## 어댑터 계약(재확인) — 모든 태스크가 이걸 지킨다

이 절은 각 태스크의 GREEN 단계에서 반복적으로 참고된다. 태스크 사이를 오갈 때마다 새로 읽지 않도록 여기서 한 번 굳혀 둔다.

### 시그니처

```python
# app/services/report/adapters/<program_id_snake>.py
from __future__ import annotations
from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

def <snake>_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    """<프로그램 표시명> 전용 어댑터."""
    ...
```

- `payload` = `{"input": <record.input_info | {}>, "result": <record.result_info | {}>, "output": <result_info.output_json / result_json 로 load 한 dict | None>}`. 형태는 이미 굳어 있다(`payload.collect_payload`, `payload.py:48`).
- `meta` = 라우트가 만들어 넘겨 준 `ReportMeta`. 표지 기본 4행(App/프로젝트/사번/상태)은 여기서 나온다.
- 반환은 **`ReportDoc`**. 렌더러는 이 dataclass 밖의 어떤 값도 읽지 않는다.

### 등록

`adapters/__init__.py::ADAPTERS: dict[str, Adapter]` 에 `"<report_adapter 키>": <snake>_adapter` 를 추가하고, `program_registry.PROGRAM_SPECS` 에서 대응 `ProgramSpec.report_adapter` 를 같은 문자열로 채운다. `report_scope` 는 `"planned" → "supported"` 로 함께 뒤집는다 — 둘을 나눠 커밋하면 등록만 되고 라우트는 여전히 400 이다(`service.py:120-121`).

### 4대 규칙

1. **판정 낱말은 `verdict_vocab` 만 쓴다.** `"합격"|"경고"|"불합격"|None`. 새 낱말이 필요하면 `verdict_vocab.py` 의 세 frozenset 에 먼저 넣는다. 어댑터 안에서 하드코딩하면 렌더러가 그 행을 강조하지 않아 '실패 행이 눈에 걸려야 한다'는 약속이 조용히 깨진다.
2. **크래시하지 않는다.** 기대 키가 없거나 타입이 어긋나면 `ReportField(label=..., value="자료 없음")` + `ReportDoc.notices` 에 "…을 읽지 못했습니다". `service.py:131-142` 의 예외 폴백은 마지막 안전망일 뿐 정상 경로가 아니다.
3. **`output=None` 을 이유로 갈라 남긴다.** 두 경우가 섞여 있다 — ① `result_info.output_json` 키가 애초에 없다 ② 경로는 있지만 파일 유실/8MB 초과/깨진 JSON. `_load_json_if_allowed` 는 세 상황을 조용히 `None` 으로 돌려주므로 어댑터가 두 사유를 구분해 notices 를 남긴다("결과 파일 미기록" vs "결과 파일을 읽지 못했습니다").
4. **부분 재사용 시 `base.notices` 를 이어받는다.** `generic_adapter(payload, meta)` 를 골격으로 쓰고 `result` 섹션만 교체하는 경우 `truss_assessment.py:93-99` 처럼 `notices=(*base.notices, *extra)` 로 보존한다. 떨어뜨리면 generic 이 감지한 조용한 누락이 사라진다.

### 파일 규약

- 파일명 = `<program_id 를 하이픈→언더스코어>.py` (예: `program_id="hp-scr-psa"` → `hp_scr_psa.py`).
- 함수명 = `<파일명 stem>_adapter` (예: `hp_scr_psa_adapter`).
- 테스트 파일 = `tests/test_report_adapter_<파일명 stem>.py`.
- 테스트 안에서 `get_adapter("<report_adapter 키>")` 로 부른다(모듈 직접 import 도 허용하지만, 등록이 진짜 됐는지 잡고 싶다면 `get_adapter` 쪽이 낫다).

---

## fixtures 폴더 준비

**Files:**
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/` (빈 폴더 + `.gitkeep`)

어댑터 태스크마다 `result_info` 스냅샷을 `tests/fixtures/report_adapters/<program_id_snake>_result.json` 으로 둔다. Unit 권상 리포트가 `tests/fixtures/unit_lifting_report/` 를 쓰는 것과 같은 패턴이다. 이 폴더가 없으면 태스크 2 부터 fixture 경로가 하나씩 깨진다.

```
mkdir -p HiTessWorkBenchBackEnd/tests/fixtures/report_adapters
touch  HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/.gitkeep
```

`.gitkeep` 은 빈 폴더가 git 에 추적되게 하는 관례 파일이다. 각 태스크가 자기 `<name>_result.json` 을 여기에 추가한다.

---

### Task 1: 라우터 `format` 파라미터 + PDF 분기 + 503 매핑

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/report/service.py:213-216`(`build_report_xlsx`), 새 함수 `build_report_bytes` 추가, `_report_filename` 시그니처
- Modify: `HiTessWorkBenchBackEnd/app/routers/reports.py:34-56`(`_content_disposition` / `_XLSX_MEDIA_TYPE`), `:58-59`(`ReportRequest`), `:68-102`(`generate_report`)
- Create: `HiTessWorkBenchBackEnd/tests/test_report_router_format.py`

이 태스크가 **먼저** 온다 — 어댑터 태스크(2~10)가 만드는 각 어댑터의 통과 확인은 서비스 레이어(`build_report_bytes`)로 돌리는데, 그 시그니처가 이미 있어야 어댑터 테스트가 실측 통합까지 잡을 수 있다. 또 라우터 응답을 먼저 굳혀 두면 프론트 태스크(11)가 뒤에서 안전하게 붙는다.

- [ ] **Step 1: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_report_router_format.py`:

```python
"""`POST /api/reports/generate` — format 파라미터 통합.

기본은 xlsx(하위호환), 프론트 기본 선택은 pdf(라우트는 형식을 결정하지 않는다).
PDF 는 xlsx_to_pdf.convert_xlsx_to_pdf 를 통과시키고, 그 예외는 503 으로 매핑한다.
"""
from datetime import datetime

import pytest

from app import models
from app.services import xlsx_to_pdf


def _seed(db_session, employee_id="ADMIN001"):
    """test_reports_router.py 의 seed 패턴을 그대로 재사용."""
    record = models.Analysis(
        employee_id=employee_id,
        program_name="Column Buckling Load Calculator",  # 이미 supported 인 App
        project_name="p",
        status="Success",
        input_info={"length_mm": 3000},
        result_info={"maxWorkingLoadTon": 12.5},
        created_at=datetime(2026, 9, 18, 9, 0, 0),
    )
    db_session.add(record)
    db_session.commit()
    return record


def test_default_is_xlsx_when_format_omitted(admin_client, db_session):
    """format 를 안 보내는 옛 프론트 빌드는 예전처럼 xlsx 를 받아야 한다."""
    record = _seed(db_session)
    res = admin_client.post("/api/reports/generate", json={"analysis_id": record.id})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert res.content[:2] == b"PK"
    assert res.headers["content-disposition"].split("filename=")[1].startswith('"')
    # 확장자만 잘라내면 폴백 스템 규칙에 걸리지 않는다.
    assert ".xlsx" in res.headers["content-disposition"]


def test_explicit_xlsx_returns_xlsx(admin_client, db_session):
    record = _seed(db_session)
    res = admin_client.post(
        "/api/reports/generate",
        json={"analysis_id": record.id, "format": "xlsx"},
    )
    assert res.status_code == 200
    assert res.content[:2] == b"PK"


def test_pdf_route_calls_xlsx_to_pdf_and_returns_pdf_bytes(
    admin_client, db_session, monkeypatch,
):
    """실제 Excel COM 을 의존하지 않고 변환 함수만 모킹."""
    record = _seed(db_session)
    captured = {}

    def _fake_convert(xlsx_bytes, sheet_name="Report"):
        # 계약 확인: 워크북 전체를 인쇄해야 한다(§2 #5, sheet_name=None).
        captured["xlsx_head"] = xlsx_bytes[:2]
        captured["sheet_name"] = sheet_name
        return b"%PDF-1.7\n%fake-pdf-body\n"

    monkeypatch.setattr(
        "app.services.report.service.convert_xlsx_to_pdf", _fake_convert
    )

    res = admin_client.post(
        "/api/reports/generate",
        json={"analysis_id": record.id, "format": "pdf"},
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF")
    assert captured["xlsx_head"] == b"PK"
    assert captured["sheet_name"] is None    # 워크북 전체 인쇄


def test_pdf_filename_uses_pdf_extension(admin_client, db_session, monkeypatch):
    record = _seed(db_session)
    monkeypatch.setattr(
        "app.services.report.service.convert_xlsx_to_pdf",
        lambda _b, sheet_name=None: b"%PDF-1.7\n",
    )
    res = admin_client.post(
        "/api/reports/generate",
        json={"analysis_id": record.id, "format": "pdf"},
    )
    disposition = res.headers["content-disposition"]
    assert ".pdf" in disposition
    assert ".xlsx" not in disposition


def test_pdf_conversion_failure_maps_to_503(admin_client, db_session, monkeypatch):
    """Excel 미설치 · pywin32 부재 · DRM 복호화 실패는 모두 503 + 원문."""
    record = _seed(db_session)

    def _fail(*_a, **_kw):
        raise xlsx_to_pdf.PdfConversionError("Excel 을 실행할 수 없습니다 (테스트).")

    monkeypatch.setattr(
        "app.services.report.service.convert_xlsx_to_pdf", _fail
    )
    res = admin_client.post(
        "/api/reports/generate",
        json={"analysis_id": record.id, "format": "pdf"},
    )
    assert res.status_code == 503
    assert "Excel 을 실행할 수 없습니다" in res.json()["detail"]


def test_invalid_format_is_422(admin_client, db_session):
    """pydantic Literal 검증 — 알 수 없는 값은 서비스에 닿기 전에 튕겨야 한다."""
    record = _seed(db_session)
    res = admin_client.post(
        "/api/reports/generate",
        json={"analysis_id": record.id, "format": "docx"},
    )
    assert res.status_code == 422


def test_ownership_check_runs_before_format_branch(switchable_client, db_session):
    """format=pdf 라도 남의 것은 403 이지 503 이 아니다.

    변환기가 먼저 뜨면 남의 레코드에 Excel 을 띄우게 되고, 그건 정보 유출은
    아니지만 낭비다. 소유권 확인이 먼저다.
    """
    record = _seed(db_session, employee_id="ADMIN001")
    switchable_client.as_user()
    res = switchable_client.post(
        "/api/reports/generate",
        json={"analysis_id": record.id, "format": "pdf"},
    )
    assert res.status_code == 403


def test_activity_log_records_the_format(admin_client, db_session, monkeypatch):
    """감사 목적으로 xlsx/pdf 어느 쪽을 뽑았는지 남긴다(§8)."""
    monkeypatch.setattr(
        "app.services.report.service.convert_xlsx_to_pdf",
        lambda _b, sheet_name=None: b"%PDF-1.7\n",
    )
    record = _seed(db_session)
    admin_client.post(
        "/api/reports/generate",
        json={"analysis_id": record.id, "format": "pdf"},
    )
    log = (
        db_session.query(models.ActivityLog)
        .filter(models.ActivityLog.action_type == "EXPORT_REPORT")
        .order_by(models.ActivityLog.id.desc())
        .first()
    )
    assert log is not None
    assert log.action_detail.get("format") == "pdf"


def test_content_disposition_ascii_fallback_survives_format_switch(admin_client, db_session, monkeypatch):
    """PDF 로 바꿔도 RFC 5987 두 벌 표기와 UTF-8 이름이 남는다."""
    from urllib.parse import unquote

    monkeypatch.setattr(
        "app.services.report.service.convert_xlsx_to_pdf",
        lambda _b, sheet_name=None: b"%PDF-1.7\n",
    )
    record = _seed(db_session)
    record.project_name = "선체 보강 검토"
    db_session.commit()

    res = admin_client.post(
        "/api/reports/generate",
        json={"analysis_id": record.id, "format": "pdf"},
    )
    disposition = res.headers["content-disposition"]
    ascii_part = disposition.split("filename=")[1].split(";")[0]
    assert ascii_part.isascii() and ascii_part.endswith('.pdf"')
    utf8_part = unquote(disposition.split("filename*=UTF-8''")[1])
    assert "선체_보강_검토" in utf8_part and utf8_part.endswith(".pdf")
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_router_format.py -q
```
기대: `9 failed` 정도(대부분 `format` 파라미터가 없어 pydantic 이 튕기거나 xlsx 만 나옴).

- [ ] **Step 3: 서비스 계층 확장** — `app/services/report/service.py`

(a) 파일 상단 import 옆에 `convert_xlsx_to_pdf` 를 지연 import 없이 **모듈 상단**에서 가져온다. 서비스가 xlsx_to_pdf 를 직접 참조해야 라우터 테스트가 `service.convert_xlsx_to_pdf` 를 monkeypatch 할 수 있다. `xlsx_to_pdf` 는 pywin32 를 **함수 안**에서 import 하므로 상단 import 자체가 Windows 만의 문제로 이어지지 않는다.

```python
from ..xlsx_to_pdf import PdfConversionError, convert_xlsx_to_pdf
```

(b) `_report_filename(doc)` 를 확장자 인자로 넓힌다(하드코딩 `.xlsx` 제거):

```python
def _report_filename(doc: ReportDoc, extension: str = "xlsx") -> str:
    """다운로드 폴더에서 어느 App 의 어느 해석인지 바로 읽히는 이름."""
    parts = (_filename_part(doc.meta.display_name), _filename_part(doc.meta.project_name))
    stem = "_".join(part for part in parts if part)[:_FILENAME_STEM_MAX].strip("._")
    return f"{stem or 'WorkBench_Report'}_{doc.meta.analysis_id}.{extension}"
```

(c) `build_report_bytes` 를 신설하고 `build_report_xlsx` 는 얇게 감싸 남긴다:

```python
def build_report_bytes(
    record,
    *,
    user_connection_base: str,
    format: str = "xlsx",
) -> tuple[str, bytes, str]:
    """(파일명, 응답 바이트, media_type). 디스크에 남기지 않는다.

    format="pdf" 이면 render_generic_xlsx 결과를 convert_xlsx_to_pdf 로 통과시킨다.
    sheet_name=None 을 넘겨 워크북 전체를 인쇄한다 — 이 렌더러는 데이터 전용 시트를
    만들지 않아 시트 선택이 필요 없다(§2 #5).
    """
    doc = build_report_doc(record, user_connection_base=user_connection_base)
    xlsx_bytes = render_generic_xlsx(doc)
    if format == "pdf":
        pdf_bytes = convert_xlsx_to_pdf(xlsx_bytes, sheet_name=None)
        return _report_filename(doc, extension="pdf"), pdf_bytes, "application/pdf"
    return (
        _report_filename(doc, extension="xlsx"),
        xlsx_bytes,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def build_report_xlsx(record, *, user_connection_base: str) -> tuple[str, bytes]:
    """(파일명, XLSX bytes) — 하위호환용 얇은 래퍼."""
    filename, data, _ = build_report_bytes(
        record, user_connection_base=user_connection_base, format="xlsx"
    )
    return filename, data
```

- [ ] **Step 4: 라우터 확장** — `app/routers/reports.py`

(a) import 에 `Literal` 추가하고 서비스에서 `PdfConversionError` 를 import:

```python
from typing import Literal
...
from ..services.report import (
    ReportNotAvailable, build_report_bytes, report_capabilities,
)
from ..services.xlsx_to_pdf import PdfConversionError
```

(b) `_XLSX_MEDIA_TYPE` 상수 옆에:

```python
_MEDIA_TYPE_BY_FORMAT: dict[str, str] = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}
```

(c) `_content_disposition` 을 확장자 인자로 넓힌다. 기존 시그니처를 지우면 `test_reports_router.py::test_content_disposition_keeps_an_ascii_fallback_and_a_utf8_name` 이 xlsx 폴백을 그대로 유지한다는 사실을 잃으니, 기본값을 xlsx 로 남긴다:

```python
def _content_disposition(filename: str, *, fallback_stem: str, extension: str = "xlsx") -> str:
    """RFC 5987 두 벌 표기. extension 은 앞뒤에 붙이는 확장자(pdf/xlsx)."""
    suffix = f".{extension}"
    ascii_stem = _NON_ASCII_FILENAME.sub("_", filename.removesuffix(suffix))
    ascii_stem = re.sub(r"_+", "_", ascii_stem).strip("._")
    if len(ascii_stem) < 3:
        ascii_stem = fallback_stem
    return (
        f'attachment; filename="{ascii_stem}{suffix}"; '
        f"filename*=UTF-8''{quote(filename, safe='')}"
    )
```

(d) `ReportRequest` 에 `format` 필드 추가:

```python
class ReportRequest(BaseModel):
    analysis_id: int = Field(..., description="리포트를 만들 해석 이력 id")
    format: Literal["xlsx", "pdf"] = Field(
        default="xlsx",
        description=(
            "출력 형식. 하위호환을 위해 기본은 xlsx 로 두고, "
            "프론트가 기본 선택을 pdf 로 화면에서 결정한다."
        ),
    )
```

(e) `generate_report` 본문 재작성:

```python
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

    # 소유권 확인이 먼저다 — 형식 분기 전에 확인해야 남의 레코드에 Excel 을 띄우지 않는다.
    assert_current_user_can_access_owner(record.employee_id, employee_id, db)

    try:
        filename, data, media_type = build_report_bytes(
            record,
            user_connection_base=_USER_CONNECTION_DIR,
            format=body.format,
        )
    except ReportNotAvailable as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PdfConversionError as exc:
        # Excel 미설치 · pywin32 부재 · DRM 복호화 실패 — 사용자가 PDF 를 골랐는데 xlsx 로
        # 조용히 물러서면 확장자만 보고 파일이 깨졌다고 오해한다. 사유를 그대로 보여 준다.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    log_activity(
        db,
        "EXPORT_REPORT",
        employee_id=employee_id,
        action_detail={
            "analysis_id": record.id,
            "program_name": record.program_name,
            "format": body.format,
        },
        ip_address=req.client.host if req.client else None,
    )

    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": _content_disposition(
                filename,
                fallback_stem=f"WorkBench_Report_{record.id}",
                extension=body.format,
            ),
        },
    )
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_router_format.py tests/test_reports_router.py tests/test_report_service.py -q
```
기대: 신규 9건 + 기존 라우터/서비스 테스트가 전부 통과(실패 0). `test_reports_router.py` 의 기존 계약(파일명 xlsx 폴백·UTF-8 두 벌·CORS expose)이 그대로 살아 있는지 확인한다.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/report/service.py`, `app/routers/reports.py`, `tests/test_report_router_format.py`.

---

### Task 2: `hp-scr-psa` 어댑터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/report/adapters/hp_scr_psa.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/hp_scr_psa_result.json`
- Create: `HiTessWorkBenchBackEnd/tests/test_report_adapter_hp_scr_psa.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:115-122` (`hp-scr-psa` 스펙)

이 어댑터가 첫 신규 어댑터라 `ADAPTERS` map 확장·`ProgramSpec` 뒤집기·fixture 폴더 사용의 세 단계를 다 밟는다. 다음 어댑터들은 같은 절차 사본이라 이 태스크가 참조점이다.

#### 프로그램 컨텍스트

- 서비스: `app/services/hpscr_service.py` — HP-SCR 엔진(외부 exe)이 `HP-SCR-PSA-REPORT.xlsx` 를 만들면 그 경로만 `result_info["XLSX_Report"]` 로 붙는다. 그 엑셀은 엔진 산출물이지 `/api/reports/generate` 응답이 아니다.
- `result_info` 키: `XLSX_Report`(엔진 xlsx 절대경로, 없으면 실패), `bdf`(입력 BDF 절대경로), `analysis_mode`("PSA" 문자열).
- `input_info` 키: `bdf_model`, `analysis_mode`.
- output_json 없음 — HP-SCR 은 엔진 xlsx 로 결과를 끝낸다. `payload.output` 은 항상 `None` 이다.

우리 어댑터는 **엔진 xlsx 를 여는 게 아니라**, 그 xlsx 의 존재를 판정 신호로 삼고 표지·판정 시트를 만든다. 결재자에게 "언제, 어떤 BDF 로, PSA 모드로 해석했고, 엔진 xlsx 는 이 경로에 있음"을 알리는 요약본이다.

- [ ] **Step 1: fixture** — `tests/fixtures/report_adapters/hp_scr_psa_result.json`:

```json
{
  "XLSX_Report": "C:/Users/HHI/AppData/Local/Temp/user/HP-SCR-PSA-REPORT.xlsx",
  "bdf": "C:/Users/HHI/AppData/Local/Temp/user/model.bdf",
  "analysis_mode": "PSA"
}
```

fixture 는 인위적인 값이라 dev PC 에 존재할 필요가 없다. 어댑터는 존재 여부를 파일시스템으로 판단하지 않고(어댑터가 파일시스템을 만지면 크로스 플랫폼에서 깨진다) `XLSX_Report` 키의 존재·비어있음으로만 본다.

- [ ] **Step 2: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_report_adapter_hp_scr_psa.py`:

```python
"""hp-scr-psa 전용 어댑터 — 엔진 xlsx 요약."""
import json
from pathlib import Path

from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta

_FIXTURE = Path(__file__).parent / "fixtures" / "report_adapters" / "hp_scr_psa_result.json"


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="hp-scr-psa",
        display_name="HP-SCR PSA",
        analysis_id=101,
        project_name="HP-SCR PSA 스냅샷",
        employee_id="ADMIN001",
        created_at=None,
        status="Success",
    )


def _payload(**overrides) -> dict:
    result = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    result.update(overrides.get("result_extra", {}))
    return {
        "input": overrides.get("input", {"bdf_model": result["bdf"], "analysis_mode": "PSA"}),
        "result": result,
        "output": None,   # HP-SCR 은 output_json 을 만들지 않는다
    }


def test_registered_under_its_registry_key():
    """레지스트리 오타는 조용히 generic 으로 떨어져 알아챌 수 없다.

    truss 어댑터의 `test_every_declared_report_adapter_is_actually_registered` 와
    같은 정신이지만, 여기서는 개별 키가 올바르게 매핑됐는지도 확인한다.
    """
    from app.services.report.adapters.generic import generic_adapter
    assert get_adapter("hp-scr-psa") is not generic_adapter


def test_overview_and_result_have_expected_headers():
    doc = get_adapter("hp-scr-psa")(_payload(), _meta())
    sections = {s.key: s for s in doc.sections}
    assert set(sections) >= {"overview", "input", "result"}
    result_labels = {f.label for f in sections["result"].fields}
    assert {"해석 모드", "엔진 계산서"} <= result_labels


def test_engine_xlsx_present_yields_pass():
    """엔진 xlsx 가 있으면 성공으로 본다 — HP-SCR 은 그 파일 자체가 판정 근거."""
    doc = get_adapter("hp-scr-psa")(_payload(), _meta())
    assert doc.verdict == "합격"


def test_missing_engine_xlsx_records_the_reason_without_crashing():
    payload = _payload()
    payload["result"].pop("XLSX_Report")
    doc = get_adapter("hp-scr-psa")(payload, _meta())
    # 판정은 비운다(안전한 쪽) + 유의 사항으로 사유.
    assert doc.verdict is None
    assert any("엔진 계산서" in n for n in doc.notices)
    # 크래시 대신 '자료 없음' 셀.
    result = next(s for s in doc.sections if s.key == "result")
    xlsx_field = next(f for f in result.fields if f.label == "엔진 계산서")
    assert xlsx_field.value == "자료 없음"


def test_mode_fallback_reads_from_input_when_result_field_missing():
    payload = _payload()
    payload["result"].pop("analysis_mode")   # 엔진이 mode 를 안 남겼다고 가정
    doc = get_adapter("hp-scr-psa")(payload, _meta())
    result = next(s for s in doc.sections if s.key == "result")
    mode = next(f for f in result.fields if f.label == "해석 모드")
    assert mode.value == "PSA"


def test_por_mode_marker_is_flagged_as_a_mismatch():
    """psa 어댑터에 mode='POR' 이 오면 잘못된 라우팅이다 — 조용히 통과시키지 않는다."""
    payload = _payload()
    payload["result"]["analysis_mode"] = "POR"
    doc = get_adapter("hp-scr-psa")(payload, _meta())
    assert any("모드 불일치" in n for n in doc.notices)


def test_result_info_snapshot_survives_the_adapter():
    """generic 이 넣어 준 result 스칼라 필드가 uphold 되어야 결재자가 원본 경로를 볼 수 있다.

    §4.4: 결과 파일 진단이 필요할 때는 result_info 스냅샷이 표에 통째로 실려야 한다.
    """
    doc = get_adapter("hp-scr-psa")(_payload(), _meta())
    all_labels = {f.label for s in doc.sections for f in s.fields}
    # 경로 계열은 생략된다(_EXCLUDED_KEY_SUFFIXES), 하지만 자체 필드(엔진 계산서)로 노출된다.
    assert "엔진 계산서" in all_labels
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_hp_scr_psa.py -q
```
기대: `7 failed`(대부분 `is not generic_adapter` 로 시작해서 어댑터 미등록 판정).

- [ ] **Step 4: 어댑터 구현** — `app/services/report/adapters/hp_scr_psa.py`:

```python
"""HP-SCR PSA 전용 어댑터.

엔진(외부 HP-SCR exe)이 자체 xlsx(`HP-SCR-PSA-REPORT.xlsx`)를 만들어 result_info["XLSX_Report"]
에 경로를 남긴다. 이 어댑터는 그 xlsx 를 파싱하지 않는다 — 파일 존재를 신호로 삼고,
표지·판정·근거 섹션이 사내 서식 통일 요구(§2 #2) 를 만족하도록 요약본을 낸다.

⚠️ output_json 은 없다. HP-SCR 은 결과 JSON 을 만들지 않는다. payload["output"] 은 None 이 정상.
"""
from __future__ import annotations

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

_MODE_LABEL = "해석 모드"
_XLSX_LABEL = "엔진 계산서"
_BDF_LABEL = "입력 BDF"
_MISSING = "자료 없음"


def _detect_mode(payload: dict) -> str | None:
    for source_key in ("result", "input"):
        source = payload.get(source_key) or {}
        mode = source.get("analysis_mode")
        if isinstance(mode, str) and mode.strip():
            return mode.strip().upper()
    return None


def _hp_scr_adapter(payload: dict, meta: ReportMeta, *, expected_mode: str) -> ReportDoc:
    """PSA / POR 공용 헬퍼. 두 어댑터가 mode 문자열만 다르다."""
    result = payload.get("result") or {}
    base = generic_adapter(payload, meta)

    mode = _detect_mode(payload)
    xlsx_path = result.get("XLSX_Report")
    xlsx_present = isinstance(xlsx_path, str) and bool(xlsx_path.strip())
    bdf_path = result.get("bdf") or (payload.get("input") or {}).get("bdf_model")

    fields: list[ReportField] = [
        ReportField(
            label=_MODE_LABEL,
            value=mode or _MISSING,
            note=f"{expected_mode} 어댑터" if mode else "해석 모드가 기록되지 않았습니다.",
        ),
        ReportField(
            label=_XLSX_LABEL,
            value=xlsx_path if xlsx_present else _MISSING,
            note="사내 서식 계산서는 엔진이 별도로 생성합니다." if xlsx_present else None,
        ),
        ReportField(
            label=_BDF_LABEL,
            value=bdf_path if isinstance(bdf_path, str) and bdf_path.strip() else _MISSING,
        ),
    ]

    notices = list(base.notices)
    if not xlsx_present:
        notices.append(
            f"엔진 계산서({expected_mode})가 result_info 에 없습니다 — "
            "엔진 실행에서 실패했거나 결과 파일이 유실됐을 수 있습니다."
        )
    if mode and mode != expected_mode:
        notices.append(
            f"모드 불일치: 이력은 {mode} 인데 {expected_mode} 어댑터가 실행됐습니다."
        )
    if not mode:
        notices.append("해석 모드를 확인하지 못했습니다.")

    # generic 이 만든 'result' 섹션 자리에 우리 요약을 얹는다. 다른 섹션(overview/input) 은 그대로.
    sections = tuple(
        ReportSection(key="result", title="해석 결과", fields=tuple(fields))
        if section.key == "result"
        else section
        for section in base.sections
    )

    if xlsx_present and mode == expected_mode:
        verdict = "합격"
    else:
        verdict = None

    return ReportDoc(
        meta=meta,
        verdict=verdict,
        sections=sections,
        notices=tuple(notices),
    )


def hp_scr_psa_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    return _hp_scr_adapter(payload, meta, expected_mode="PSA")
```

- [ ] **Step 5: 등록 + 스펙 뒤집기**

(a) `app/services/report/adapters/__init__.py`:

```python
from .generic import generic_adapter
from .hp_scr_psa import hp_scr_psa_adapter
from .truss_assessment import truss_assessment_adapter

...

ADAPTERS: dict[str, Adapter] = {
    "truss-assessment": truss_assessment_adapter,
    "hp-scr-psa": hp_scr_psa_adapter,
}
```

(b) `app/services/program_registry.py:115-122`(hp-scr-psa `_spec` 호출):

```python
    _spec(
        "hp-scr-psa", "HP-SCR PSA", "HP-SCR",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="hp-scr",
        input_keys=("bdf_model",),
        statistics_group="hp-scr",
        report_adapter="hp-scr-psa",
        report_scope="supported",
    ),
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_hp_scr_psa.py tests/test_report_truss_adapter.py tests/test_report_service.py -q
```
기대: 신규 7건 통과 + truss 어댑터 22건(등록 fixture 함수 `test_every_declared_report_adapter_is_actually_registered` 가 새 키를 검사한다) + service 테스트가 전부 통과.

- [ ] **Step 7: 커밋 준비 완료** — 보고: `app/services/report/adapters/hp_scr_psa.py`, `app/services/report/adapters/__init__.py`, `app/services/program_registry.py`, `tests/fixtures/report_adapters/.gitkeep`, `tests/fixtures/report_adapters/hp_scr_psa_result.json`, `tests/test_report_adapter_hp_scr_psa.py`.

---

### Task 3: `hp-scr-por` 어댑터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/report/adapters/hp_scr_por.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/hp_scr_por_result.json`
- Create: `HiTessWorkBenchBackEnd/tests/test_report_adapter_hp_scr_por.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:123-130`(`hp-scr-por`)

PSA 와 스키마가 같다 — `hp_scr_psa._hp_scr_adapter` 헬퍼를 그대로 재사용하고 `expected_mode="POR"` 만 바꾼다(§4.2 #2 결정: 파일 분리, 얇은 어댑터 함수 두 개).

- [ ] **Step 1: fixture** — `tests/fixtures/report_adapters/hp_scr_por_result.json`:

```json
{
  "XLSX_Report": "C:/Users/HHI/AppData/Local/Temp/user/HP-SCR-POR-REPORT.xlsx",
  "bdf": "C:/Users/HHI/AppData/Local/Temp/user/model.bdf",
  "analysis_mode": "POR"
}
```

- [ ] **Step 2: 실패 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_report_adapter_hp_scr_por.py`:

```python
"""hp-scr-por 전용 어댑터 — PSA 와 스키마가 같아 헬퍼 공유."""
import json
from pathlib import Path

from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta

_FIXTURE = Path(__file__).parent / "fixtures" / "report_adapters" / "hp_scr_por_result.json"


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="hp-scr-por",
        display_name="HP-SCR POR",
        analysis_id=102,
        project_name="POR 스냅샷",
        employee_id="ADMIN001",
        created_at=None,
        status="Success",
    )


def _payload() -> dict:
    result = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    return {
        "input": {"bdf_model": result["bdf"], "analysis_mode": "POR"},
        "result": result,
        "output": None,
    }


def test_registered_under_its_registry_key():
    from app.services.report.adapters.generic import generic_adapter
    assert get_adapter("hp-scr-por") is not generic_adapter
    # PSA 와 다른 함수여야 한다 — 헬퍼 공유는 구현 세부지 계약이 아니다.
    assert get_adapter("hp-scr-por") is not get_adapter("hp-scr-psa")


def test_por_mode_yields_pass():
    doc = get_adapter("hp-scr-por")(_payload(), _meta())
    assert doc.verdict == "합격"


def test_wrong_mode_marker_is_flagged():
    """이력이 PSA 인데 POR 어댑터가 돌면 '모드 불일치'."""
    payload = _payload()
    payload["result"]["analysis_mode"] = "PSA"
    doc = get_adapter("hp-scr-por")(payload, _meta())
    assert any("모드 불일치" in n for n in doc.notices)


def test_missing_engine_xlsx_records_the_reason():
    payload = _payload()
    payload["result"].pop("XLSX_Report")
    doc = get_adapter("hp-scr-por")(payload, _meta())
    assert doc.verdict is None
    assert any("엔진 계산서(POR)" in n for n in doc.notices)


def test_shared_helper_keeps_the_same_field_labels():
    """PSA/POR 이 같은 자리 같은 라벨을 쓴다 — 결재자 습관을 지킨다."""
    doc_psa_labels = {
        f.label
        for s in get_adapter("hp-scr-psa")(
            {"input": {}, "result": {"XLSX_Report": "x", "analysis_mode": "PSA"}, "output": None},
            _meta(),
        ).sections
        for f in s.fields
    }
    doc_por_labels = {
        f.label
        for s in get_adapter("hp-scr-por")(_payload(), _meta()).sections
        for f in s.fields
    }
    assert {"해석 모드", "엔진 계산서", "입력 BDF"} <= doc_psa_labels
    assert {"해석 모드", "엔진 계산서", "입력 BDF"} <= doc_por_labels
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_hp_scr_por.py -q
```
기대: `5 failed`.

- [ ] **Step 4: 어댑터 구현** — `app/services/report/adapters/hp_scr_por.py`:

```python
"""HP-SCR POR 전용 어댑터. PSA 와 스키마가 같아 헬퍼를 공유한다."""
from __future__ import annotations

from ..models import ReportDoc, ReportMeta
from .hp_scr_psa import _hp_scr_adapter


def hp_scr_por_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    return _hp_scr_adapter(payload, meta, expected_mode="POR")
```

- [ ] **Step 5: 등록 + 스펙 뒤집기**

(a) `adapters/__init__.py`:

```python
from .hp_scr_por import hp_scr_por_adapter
from .hp_scr_psa import hp_scr_psa_adapter
...

ADAPTERS: dict[str, Adapter] = {
    "truss-assessment": truss_assessment_adapter,
    "hp-scr-psa": hp_scr_psa_adapter,
    "hp-scr-por": hp_scr_por_adapter,
}
```

(b) `program_registry.py:123-130`(hp-scr-por):

```python
    _spec(
        "hp-scr-por", "HP-SCR POR",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="hp-scr",
        input_keys=("bdf_model",),
        statistics_group="hp-scr",
        report_adapter="hp-scr-por",
        report_scope="supported",
    ),
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_hp_scr_por.py tests/test_report_adapter_hp_scr_psa.py -q
```
기대: 5 + 7 = 12건 통과.

- [ ] **Step 7: 커밋 준비 완료** — 보고: `app/services/report/adapters/hp_scr_por.py`, `app/services/report/adapters/__init__.py`, `app/services/program_registry.py`, `tests/fixtures/report_adapters/hp_scr_por_result.json`, `tests/test_report_adapter_hp_scr_por.py`.

---

### Task 4: `mooring-fitting-solve` 어댑터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/report/adapters/mooring_fitting_solve.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/mooring_fitting_solve_result.json`
- Create: `HiTessWorkBenchBackEnd/tests/test_report_adapter_mooring_fitting_solve.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:145-151`(`mooring-fitting-solve`)

#### 프로그램 컨텍스트

- 서비스: `app/services/mooring_fitting_service.py` `task_execute_mooring_solve`. Nastran SOL 101 을 돌린 뒤 `_results.json` (`von Mises Usage = σeff/(σy/γM)`) 을 만든다.
- `result_info` 키: `nastranResultJson`(결과 JSON 경로), `summary`(dict: `globalMax`, `globalMaxUsage`, `yieldStress`, `gammaM`, `allowable`, `ok`, `caseCount`, `quantity`, `unit`), 선택적 `diagnosisJson`.
- `input_info`: `bdf`, `model_json`, `yieldStrength`, `gammaM`.
- ⚠ **자체 라우트(`/api/analysis/mooring-fitting/report`) 는 별개다** — Studio 검토 보고서용. 이 어댑터는 `/api/reports/generate` 응답만 담당한다(§2 #7).

판정: `summary.globalMaxUsage`(또는 output_json 의 최상위 `globalMaxUsage`) 가 실수인데 > 1.0 이면 "불합격", ≤ 1.0 이면 "합격", 못 읽으면 verdict=None + 사유. `summary.ok` 가 있으면 그 값을 보조로 쓰되(True/False), Usage 가 우선한다 — 숫자가 더 방어적이다.

- [ ] **Step 1: fixture** — `tests/fixtures/report_adapters/mooring_fitting_solve_result.json`:

```json
{
  "nastranResultJson": "C:/Users/HHI/AppData/Local/Temp/user/results.json",
  "summary": {
    "quantity": "von Mises",
    "unit": "MPa",
    "globalMax": 245.8,
    "globalMaxShear": 68.4,
    "globalMaxUsage": 0.78,
    "yieldStress": 315.0,
    "gammaM": 1.0,
    "allowable": 315.0,
    "allowableShear": 181.85,
    "ok": true,
    "caseCount": 12
  }
}
```

- [ ] **Step 2: 실패 테스트 작성**

`tests/test_report_adapter_mooring_fitting_solve.py`:

```python
"""mooring-fitting-solve 어댑터 — Usage 로 판정, summary 로 요약."""
import json
from pathlib import Path

from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta

_FIXTURE = (
    Path(__file__).parent / "fixtures" / "report_adapters"
    / "mooring_fitting_solve_result.json"
)


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="mooring-fitting-solve",
        display_name="MooringFittingSolve",
        analysis_id=201,
        project_name="mooring solve 스냅샷",
        employee_id="ADMIN001",
        created_at=None,
        status="Success",
    )


def _payload(**over) -> dict:
    result = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    if "summary_extra" in over:
        result["summary"].update(over["summary_extra"])
    return {
        "input": {
            "bdf": "C:/x/edited.bdf",
            "model_json": "C:/x/model.json",
            "yieldStrength": 315.0,
            "gammaM": 1.0,
        },
        "result": result,
        "output": over.get("output"),
    }


def test_registered_under_its_registry_key():
    from app.services.report.adapters.generic import generic_adapter
    assert get_adapter("mooring-fitting-solve") is not generic_adapter


def test_summary_usage_below_one_yields_pass():
    doc = get_adapter("mooring-fitting-solve")(_payload(), _meta())
    assert doc.verdict == "합격"


def test_summary_usage_above_one_yields_fail():
    doc = get_adapter("mooring-fitting-solve")(
        _payload(summary_extra={"globalMaxUsage": 1.42, "ok": False}), _meta(),
    )
    assert doc.verdict == "불합격"


def test_usage_exactly_one_is_pass():
    """경계값은 합격 — Nastran 이 Usage=1.0 을 낼 만한 케이스는 이미 사람이 본 뒤다."""
    doc = get_adapter("mooring-fitting-solve")(
        _payload(summary_extra={"globalMaxUsage": 1.0, "ok": True}), _meta(),
    )
    assert doc.verdict == "합격"


def test_result_section_lists_yield_gamma_usage_and_case_count():
    doc = get_adapter("mooring-fitting-solve")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    labels = {f.label for f in result.fields}
    assert {"항복강도(σy)", "γM", "허용응력", "최대 Usage", "케이스 수"} <= labels


def test_missing_summary_records_the_reason():
    payload = _payload()
    payload["result"].pop("summary")
    doc = get_adapter("mooring-fitting-solve")(payload, _meta())
    assert doc.verdict is None
    assert any("요약이 없어" in n or "요약을 읽지" in n for n in doc.notices)


def test_missing_usage_records_the_reason_even_with_summary():
    payload = _payload()
    payload["result"]["summary"].pop("globalMaxUsage")
    doc = get_adapter("mooring-fitting-solve")(payload, _meta())
    assert doc.verdict is None
    assert any("Usage" in n for n in doc.notices)


def test_non_numeric_usage_is_treated_as_missing():
    """summary.globalMaxUsage 가 문자열이면 판정을 내지 않는다 — 파싱 실패 방어."""
    doc = get_adapter("mooring-fitting-solve")(
        _payload(summary_extra={"globalMaxUsage": "N/A"}), _meta(),
    )
    assert doc.verdict is None


def test_ok_flag_alone_does_not_flip_verdict_up():
    """summary.ok=True 만 있고 Usage 가 없으면 합격으로 뒤집지 않는다 — 숫자 우선."""
    payload = _payload()
    payload["result"]["summary"].pop("globalMaxUsage")
    payload["result"]["summary"]["ok"] = True
    doc = get_adapter("mooring-fitting-solve")(payload, _meta())
    assert doc.verdict is None
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_mooring_fitting_solve.py -q
```
기대: `9 failed`.

- [ ] **Step 4: 어댑터 구현** — `app/services/report/adapters/mooring_fitting_solve.py`:

```python
"""MooringFittingSolve 전용 어댑터.

Nastran SOL 101 결과(σeff/(σy/γM)) 의 최대 Usage 로 판정한다. summary 는 exe 가 저장 시점에
넣어 준다(mooring_fitting_service:476-490).

⚠️ 자체 라우트 `/api/analysis/mooring-fitting/report` 와는 별개다 — 그쪽은 Studio 검토 보고서
파이프라인, 이 어댑터는 `/api/reports/generate` 로 오는 요청만 처리한다.
"""
from __future__ import annotations

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection
from .generic import generic_adapter

_MISSING = "자료 없음"


def _is_real_number(value) -> bool:
    """bool 은 int 하위형이라 그냥 두면 True 를 1.0 으로 취급한다."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def mooring_fitting_solve_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    base = generic_adapter(payload, meta)
    result = payload.get("result") or {}
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else None

    notices = list(base.notices)
    if summary is None:
        notices.append("solve 요약이 없어 판정 근거를 만들 수 없습니다 — Nastran FATAL 여부를 확인하세요.")

    def _pick(key):
        if not summary:
            return None
        value = summary.get(key)
        return value if _is_real_number(value) else None

    yield_mpa = _pick("yieldStress")
    gamma_m = _pick("gammaM")
    allowable = _pick("allowable")
    usage = _pick("globalMaxUsage")
    global_max = _pick("globalMax")
    case_count = summary.get("caseCount") if summary else None

    fields: list[ReportField] = [
        ReportField(label="항복강도(σy)", value=yield_mpa if yield_mpa is not None else _MISSING, unit="MPa"),
        ReportField(label="γM", value=gamma_m if gamma_m is not None else _MISSING),
        ReportField(label="허용응력", value=allowable if allowable is not None else _MISSING, unit="MPa"),
        ReportField(label="최대 응력", value=global_max if global_max is not None else _MISSING, unit="MPa"),
        ReportField(label="최대 Usage", value=usage if usage is not None else _MISSING),
        ReportField(
            label="케이스 수",
            value=case_count if isinstance(case_count, int) else _MISSING,
        ),
    ]

    if usage is None:
        if summary is not None:
            notices.append("summary.globalMaxUsage 를 읽지 못해 판정을 비웠습니다.")
        verdict = None
    elif usage > 1.0:
        verdict = "불합격"
    else:
        verdict = "합격"

    sections = tuple(
        ReportSection(key="result", title="해석 결과", fields=tuple(fields))
        if section.key == "result"
        else section
        for section in base.sections
    )

    return ReportDoc(
        meta=meta,
        verdict=verdict,
        sections=sections,
        notices=tuple(notices),
    )
```

- [ ] **Step 5: 등록 + 스펙 뒤집기**

(a) `adapters/__init__.py` 에 `mooring_fitting_solve_adapter` 추가.

(b) `program_registry.py:145-151`:

```python
    _spec(
        "mooring-fitting-solve", "MooringFittingSolve",
        capabilities=("derived-analysis", "passport"),
        input_keys=("edited_bdf", "bdf_model"),
        statistics_group="mooring-fitting-solve",
        report_adapter="mooring-fitting-solve",
        report_scope="supported",
    ),
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_mooring_fitting_solve.py tests/test_report_truss_adapter.py -q
```
기대: 9건 통과 + truss 등록 fixture 통과.

- [ ] **Step 7: 커밋 준비 완료** — 보고: `app/services/report/adapters/mooring_fitting_solve.py`, `app/services/report/adapters/__init__.py`, `app/services/program_registry.py`, `tests/fixtures/report_adapters/mooring_fitting_solve_result.json`, `tests/test_report_adapter_mooring_fitting_solve.py`.

---

### Task 5: `model-builder-analysis` 어댑터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/report/adapters/model_builder_analysis.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/model_builder_analysis_result.json`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/model_builder_analysis_output.json`
- Create: `HiTessWorkBenchBackEnd/tests/test_report_adapter_model_builder_analysis.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:168-174`(`model-builder-analysis`)

#### 프로그램 컨텍스트

- 서비스: `app/services/hitess_modelflow_service.py` 의 `task_execute_apply_edit` 계열 및 ModelBuilder Nastran 러너. F06Parser 가 만든 `_results.json` 을 `result_info.output_json` 으로 남긴다.
- `result_info` 키: `output_json`(F06Parser 결과 JSON 경로), `f06_file`, `edited_bdf`, `edit_intents`(있으면).
- 결과 JSON 형태(관찰치): `{ "subcases": [{"caseId": 1, "maxStressMPa": 132.5, "maxDisplacementMm": 2.3, ...}], "summary": {"maxStress": ..., "maxDisplacement": ...} }`. 세부 스키마는 파서 버전마다 달라 `result` 표기(`pass`/`fail`) 필드가 있으면 판정에 쓰고, 없으면 verdict None.
- 어댑터는 **subcase 표 + 최댓값 요약 필드**를 낸다.

- [ ] **Step 1: fixture** — `tests/fixtures/report_adapters/model_builder_analysis_result.json`:

```json
{
  "output_json": "C:/Users/HHI/AppData/Local/Temp/user/results.json",
  "f06_file": "C:/Users/HHI/AppData/Local/Temp/user/model.f06",
  "edited_bdf": "C:/Users/HHI/AppData/Local/Temp/user/edited/model.bdf"
}
```

`tests/fixtures/report_adapters/model_builder_analysis_output.json`:

```json
{
  "subcases": [
    {"caseId": 1, "label": "Static G", "maxStressMPa": 132.5, "maxDisplacementMm": 2.34, "result": "pass"},
    {"caseId": 2, "label": "Lift Case", "maxStressMPa": 288.7, "maxDisplacementMm": 6.82, "result": "pass"}
  ],
  "summary": {
    "maxStressMPa": 288.7,
    "maxDisplacementMm": 6.82,
    "subcaseCount": 2
  }
}
```

- [ ] **Step 2: 실패 테스트 작성**

`tests/test_report_adapter_model_builder_analysis.py`:

```python
"""model-builder-analysis 어댑터 — F06Parser 결과 요약."""
import json
from pathlib import Path

from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta

_FIX_DIR = Path(__file__).parent / "fixtures" / "report_adapters"


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="model-builder-analysis",
        display_name="ModelBuilderAnalysis",
        analysis_id=301,
        project_name="MB 결과 스냅샷",
        employee_id="ADMIN001",
        created_at=None,
        status="Success",
    )


def _payload(*, output=None) -> dict:
    result = json.loads((_FIX_DIR / "model_builder_analysis_result.json").read_text(encoding="utf-8"))
    default_output = json.loads((_FIX_DIR / "model_builder_analysis_output.json").read_text(encoding="utf-8"))
    return {
        "input": {"bdf_model": "C:/x/orig.bdf"},
        "result": result,
        "output": default_output if output is None else output,
    }


def test_registered_under_its_registry_key():
    from app.services.report.adapters.generic import generic_adapter
    assert get_adapter("model-builder-analysis") is not generic_adapter


def test_subcases_become_one_table():
    doc = get_adapter("model-builder-analysis")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    assert len(result.tables) == 1
    table = result.tables[0]
    assert table.title == "Subcase 요약"
    assert {"caseId", "label", "maxStressMPa", "maxDisplacementMm", "result"} <= set(table.columns)
    assert table.rows[0][0] == 1


def test_summary_field_reports_the_worst_values():
    doc = get_adapter("model-builder-analysis")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    fields = {f.label: f.value for f in result.fields}
    assert fields.get("최대 응력") == 288.7
    assert fields.get("최대 변위") == 6.82


def test_verdict_is_pass_when_every_subcase_declares_pass():
    doc = get_adapter("model-builder-analysis")(_payload(), _meta())
    assert doc.verdict == "합격"


def test_verdict_is_fail_when_any_subcase_declares_fail():
    output = json.loads((_FIX_DIR / "model_builder_analysis_output.json").read_text(encoding="utf-8"))
    output["subcases"][1]["result"] = "fail"
    doc = get_adapter("model-builder-analysis")(_payload(output=output), _meta())
    assert doc.verdict == "불합격"


def test_missing_output_records_the_distinction():
    """output=None 이면 두 사유가 섞여 있다 — 어댑터가 구분해 남긴다."""
    payload = _payload(output=None)
    # 결과 경로가 아예 없다는 시나리오
    payload["result"].pop("output_json")
    doc = get_adapter("model-builder-analysis")(payload, _meta())
    assert doc.verdict is None
    assert any("결과 파일 미기록" in n or "결과 경로가 없어" in n for n in doc.notices)


def test_output_present_key_but_load_failed_is_a_different_notice():
    """output_json 경로는 있는데 로드에 실패한 경우(payload.output=None)."""
    payload = _payload(output=None)  # 로드 실패 — 경로는 남아 있다.
    doc = get_adapter("model-builder-analysis")(payload, _meta())
    assert any("결과 JSON 을 읽지 못했습니다" in n or "결과 파일을 읽지 못했" in n for n in doc.notices)


def test_partial_result_declaration_yields_unknown_verdict():
    """subcase 중 하나만 result 표기가 없으면 합격으로 단정하지 않는다."""
    output = json.loads((_FIX_DIR / "model_builder_analysis_output.json").read_text(encoding="utf-8"))
    output["subcases"][1].pop("result")
    doc = get_adapter("model-builder-analysis")(_payload(output=output), _meta())
    assert doc.verdict is None
    assert any("판정 표기가 없는 subcase" in n for n in doc.notices)


def test_edit_intents_absent_does_not_crash():
    """편집 이력이 없는 정상 케이스도 크래시하지 않는다 — Runner 가 edit_intents 를 생략하는 흐름."""
    payload = _payload()
    payload["result"].pop("edited_bdf", None)
    doc = get_adapter("model-builder-analysis")(payload, _meta())
    assert isinstance(doc.verdict, (str, type(None)))
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_model_builder_analysis.py -q
```
기대: `9 failed`.

- [ ] **Step 4: 어댑터 구현** — `app/services/report/adapters/model_builder_analysis.py`:

```python
"""ModelBuilderAnalysis 전용 어댑터 — F06Parser `_results.json` 요약.

subcases 배열은 파서가 SUBCASE 별로 최대 응력·변위·pass/fail 판정을 한 줄씩 담는다.
스키마가 파서 버전마다 조금씩 다르므로 있는 키만 표에 실어 낸다(_columns_for 자동).
"""
from __future__ import annotations

from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

_PREFERRED_COLUMNS: tuple[str, ...] = (
    "caseId", "label", "maxStressMPa", "maxDisplacementMm", "result",
)


def _columns_for(rows: list[dict]) -> tuple[str, ...]:
    seen: list[str] = []
    for row in rows:
        for key in row:
            if key not in seen:
                seen.append(key)
    preferred = [key for key in _PREFERRED_COLUMNS if key in seen]
    rest = [key for key in seen if key not in _PREFERRED_COLUMNS]
    return tuple(preferred + rest)


def _rows_for(rows: list[dict], columns: tuple[str, ...]) -> tuple[tuple[Any, ...], ...]:
    return tuple(tuple(row.get(col) for col in columns) for row in rows)


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def model_builder_analysis_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    base = generic_adapter(payload, meta)
    result = payload.get("result") or {}
    output = payload.get("output")
    notices = list(base.notices)

    # output=None 을 두 사유로 갈라 남긴다(§4.4).
    if not isinstance(output, dict):
        if isinstance(result.get("output_json"), str) and result.get("output_json"):
            notices.append(
                "결과 JSON 을 읽지 못했습니다 — 파일 유실이나 8MB 초과일 수 있습니다."
            )
            output = None
        else:
            notices.append("결과 파일 미기록 — 해석은 끝났지만 output_json 이 저장되지 않았습니다.")
            output = None

    subcases_raw = (output or {}).get("subcases")
    subcases = [row for row in (subcases_raw or []) if isinstance(row, dict)]
    summary = (output or {}).get("summary") if isinstance(output, dict) else None

    tables: list[ReportTable] = []
    if subcases:
        columns = _columns_for(subcases)
        tables.append(
            ReportTable(title="Subcase 요약", columns=columns, rows=_rows_for(subcases, columns))
        )

    # 최댓값 요약 — output.summary 를 우선하고 없으면 subcases 로 계산.
    max_stress = None
    max_disp = None
    if isinstance(summary, dict):
        if _is_number(summary.get("maxStressMPa")):
            max_stress = summary["maxStressMPa"]
        if _is_number(summary.get("maxDisplacementMm")):
            max_disp = summary["maxDisplacementMm"]
    for row in subcases:
        s = row.get("maxStressMPa")
        d = row.get("maxDisplacementMm")
        if _is_number(s):
            max_stress = s if max_stress is None else max(max_stress, s)
        if _is_number(d):
            max_disp = d if max_disp is None else max(max_disp, d)

    fields: list[ReportField] = [
        ReportField(label="Subcase 수", value=len(subcases) if subcases else "자료 없음"),
    ]
    if max_stress is not None:
        fields.append(ReportField(label="최대 응력", value=max_stress, unit="MPa"))
    if max_disp is not None:
        fields.append(ReportField(label="최대 변위", value=max_disp, unit="mm"))

    # 판정 — truss 어댑터와 같은 정신: 부분 누락은 verdict None.
    declared = 0
    passed = 0
    failed = 0
    for row in subcases:
        token = str(row.get("result", "")).strip().casefold()
        if not token:
            continue
        declared += 1
        if token in {"fail", "failed", "ng", "nok"}:
            failed += 1
        elif token in {"ok", "pass", "passed"}:
            passed += 1
    undeclared = len(subcases) - declared

    if failed:
        verdict = "불합격"
    elif not subcases or undeclared or declared == 0:
        verdict = None
        if undeclared:
            notices.append(
                f"판정 표기가 없는 subcase {undeclared}건이 있습니다 — "
                "전 케이스 통과는 확인되지 않았습니다."
            )
    else:
        verdict = "합격" if passed == declared else None

    sections = tuple(
        ReportSection(
            key="result", title="해석 결과",
            fields=tuple(fields), tables=tuple(tables),
        )
        if section.key == "result"
        else section
        for section in base.sections
    )

    return ReportDoc(
        meta=meta,
        verdict=verdict,
        sections=sections,
        notices=tuple(notices),
    )
```

- [ ] **Step 5: 등록 + 스펙 뒤집기**

(a) `adapters/__init__.py` 에 `model_builder_analysis_adapter` 추가.

(b) `program_registry.py:168-174`:

```python
    _spec(
        "model-builder-analysis", "ModelBuilderAnalysis",
        capabilities=("derived-analysis", "passport"),
        input_keys=("bdf_model", "edited_bdf"),
        statistics_group="model-builder-analysis",
        report_adapter="model-builder-analysis",
        report_scope="supported",
    ),
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_model_builder_analysis.py -q
```
기대: 9건 통과.

- [ ] **Step 7: 커밋 준비 완료** — 보고: `app/services/report/adapters/model_builder_analysis.py`, `app/services/report/adapters/__init__.py`, `app/services/program_registry.py`, `tests/fixtures/report_adapters/model_builder_analysis_result.json`, `tests/fixtures/report_adapters/model_builder_analysis_output.json`, `tests/test_report_adapter_model_builder_analysis.py`.

---

### Task 6: `group-module-unit` 어댑터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/report/adapters/group_module_unit.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/group_module_unit_result.json`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/group_module_unit_stability.json`
- Create: `HiTessWorkBenchBackEnd/tests/test_report_adapter_group_module_unit.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:185-190`

#### 프로그램 컨텍스트

- 서비스: `app/services/hitess_modelflow_service.task_execute_modelflow` 의 unit 파이프라인. 결과는 여러 개의 JSON 파일로 흩어져 있다 — `stability_json`(자세안정성 overall), `posture_json`(단계별 판정), `nastran_result_json`(구조해석), `hoist_optimization_json`.
- **자체 라우트 `/api/analysis/unit-structural/report` 는 별개다** — Studio 검토 보고서(21p PDF). 이 어댑터는 그 라우트를 부르지 않고, `/api/reports/generate` 요청에만 응한다(§2 #7).
- `result_info` 키(관찰): `stability_json`, `posture_json`, `nastran_result_json`, `output_json`(경우에 따라). payload.output 이 있으면 `stability_json` 을 우선 로드한다 — `collect_payload` 는 `output_json` 만 자동 로드하니 stability 는 어댑터가 직접 result_info 안의 dict 로만 본다(스캐너가 파일 로드를 대신하지 않는다).

⚠ **어댑터는 파일 시스템을 만지지 않는다** — 크로스 플랫폼과 테스트 격리를 지키려면 payload dict 안에 이미 있는 값만 쓴다. 따라서 이 어댑터는 result_info 안에 임베드된 stability 요약 dict 를 기대한다: `result_info.stabilitySummary = {"overall": "pass"|"warn"|"fail", "postureSummary": [...]}`. 없으면 verdict None.

- [ ] **Step 1: fixtures**

`tests/fixtures/report_adapters/group_module_unit_result.json`:

```json
{
  "output_json": "C:/Users/HHI/AppData/Local/Temp/user/result.json",
  "stabilitySummary": {
    "overall": "pass",
    "postureSummary": [
      {"stage": "Stage1", "verdict": "pass", "note": "형상 분류"},
      {"stage": "Stage2", "verdict": "pass", "note": "Trolley"},
      {"stage": "Stage6", "verdict": "pass", "note": "전도"}
    ],
    "wireLengthMm": 4820.0,
    "minSlingAngleDeg": 62.4
  },
  "nastranResultJson": "C:/Users/HHI/AppData/Local/Temp/user/nastran.json"
}
```

`tests/fixtures/report_adapters/group_module_unit_stability.json` (재사용용, 다른 overall 을 만들 때 orient 만 바꾸는 세컨더리 스냅샷):

```json
{
  "overall": "warn",
  "postureSummary": [
    {"stage": "Stage2", "verdict": "warn", "note": "형상 완화(strictEvaluation=False)"}
  ]
}
```

- [ ] **Step 2: 실패 테스트 작성**

```python
"""group-module-unit 어댑터 — 자세안정성 overall 로 판정.

⚠ 이 어댑터는 자체 라우트(/api/analysis/unit-structural/report)를 부르지 않는다.
   /api/reports/generate 요청만 응답한다.
"""
import json
from pathlib import Path

from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta

_FIX_DIR = Path(__file__).parent / "fixtures" / "report_adapters"


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="group-module-unit",
        display_name="GroupModuleUnit",
        analysis_id=401,
        project_name="3496 유닛",
        employee_id="ADMIN001",
        created_at=None,
        status="Success",
    )


def _payload(*, stability=None) -> dict:
    result = json.loads((_FIX_DIR / "group_module_unit_result.json").read_text(encoding="utf-8"))
    if stability is not None:
        if stability is False:
            result.pop("stabilitySummary", None)
        else:
            result["stabilitySummary"] = stability
    return {"input": {"bdf_model": "C:/x/m.bdf"}, "result": result, "output": None}


def test_registered_under_its_registry_key():
    from app.services.report.adapters.generic import generic_adapter
    assert get_adapter("group-module-unit") is not generic_adapter


def test_overall_pass_yields_pass():
    doc = get_adapter("group-module-unit")(_payload(), _meta())
    assert doc.verdict == "합격"


def test_overall_warn_yields_warning():
    doc = get_adapter("group-module-unit")(
        _payload(stability={"overall": "warn", "postureSummary": []}), _meta(),
    )
    assert doc.verdict == "경고"


def test_overall_fail_yields_fail():
    doc = get_adapter("group-module-unit")(
        _payload(stability={"overall": "fail", "postureSummary": []}), _meta(),
    )
    assert doc.verdict == "불합격"


def test_posture_summary_becomes_a_table():
    doc = get_adapter("group-module-unit")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    assert len(result.tables) == 1
    table = result.tables[0]
    assert table.title == "자세안정성 단계"
    assert {"stage", "verdict"} <= set(table.columns)
    assert table.rows[0][0] == "Stage1"


def test_wire_length_and_sling_angle_are_fields():
    doc = get_adapter("group-module-unit")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    fields = {f.label: f.value for f in result.fields}
    assert fields.get("와이어 길이") == 4820.0
    assert fields.get("최소 슬링각") == 62.4


def test_missing_stability_summary_records_the_reason():
    doc = get_adapter("group-module-unit")(_payload(stability=False), _meta())
    assert doc.verdict is None
    assert any("자세안정성 요약" in n for n in doc.notices)


def test_unknown_overall_token_is_treated_as_missing():
    doc = get_adapter("group-module-unit")(
        _payload(stability={"overall": "unknown", "postureSummary": []}), _meta(),
    )
    assert doc.verdict is None
    assert any("overall" in n.lower() or "판정" in n for n in doc.notices)


def test_does_not_call_the_unit_lifting_report_pipeline():
    """자체 리포트 파이프라인을 부르지 않는다 — 자체 라우트가 그 몫이다.

    파일 시스템·figures3d.render 를 부르지 않아야 한다. 여기서는 크래시하지 않는지만 본다 —
    실제 호출 점검은 stability 는 임베드된 dict 만 읽는다는 계약이 지켜지면 자연스럽다.
    """
    doc = get_adapter("group-module-unit")(_payload(), _meta())
    # 표지 4행 + 자세안정성 필드가 나오면 파일 시스템을 만지지 않고 끝났다는 뜻이다.
    all_labels = {f.label for s in doc.sections for f in s.fields}
    assert "해석 App" in all_labels
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_group_module_unit.py -q
```
기대: `9 failed`.

- [ ] **Step 4: 어댑터 구현** — `app/services/report/adapters/group_module_unit.py`:

```python
"""GroupModuleUnit 전용 어댑터 — 자세안정성 overall 로 판정.

⚠ 자체 라우트 `/api/analysis/unit-structural/report` 와는 별개다. 그쪽은 사내 서식 21p PDF 를
만드는 파이프라인, 이 어댑터는 `/api/reports/generate` 요청에만 응한다(§2 #7).

⚠ 파일 시스템을 만지지 않는다 — result_info 안에 임베드된 stabilitySummary dict 만 본다.
서비스가 자세안정성 결과를 요약해 result_info 에 남기는 흐름과 맞춰야 한다
(hitess_modelflow_service `_compose_stability_summary`).
"""
from __future__ import annotations

from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

_OVERALL_MAP = {"pass": "합격", "warn": "경고", "fail": "불합격"}


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def group_module_unit_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    base = generic_adapter(payload, meta)
    result = payload.get("result") or {}
    stability = result.get("stabilitySummary")

    notices = list(base.notices)
    if not isinstance(stability, dict):
        notices.append(
            "자세안정성 요약이 result_info 에 없어 판정 근거를 만들 수 없습니다. "
            "Studio 의 자체 리포트(검토 보고서)는 별도로 발급됩니다."
        )
        stability = {}

    overall_raw = str(stability.get("overall") or "").strip().casefold()
    verdict = _OVERALL_MAP.get(overall_raw)
    if verdict is None and stability:
        notices.append(
            f"overall 이 알 수 없는 값({stability.get('overall')!r}) 이라 판정을 비웠습니다."
        )

    fields: list[ReportField] = [
        ReportField(label="종합 overall", value=stability.get("overall") or "자료 없음"),
    ]
    wire_length = stability.get("wireLengthMm")
    if _is_number(wire_length):
        fields.append(ReportField(label="와이어 길이", value=wire_length, unit="mm"))
    min_angle = stability.get("minSlingAngleDeg")
    if _is_number(min_angle):
        fields.append(ReportField(label="최소 슬링각", value=min_angle, unit="deg"))

    posture = stability.get("postureSummary") if isinstance(stability, dict) else None
    tables: list[ReportTable] = []
    if isinstance(posture, list) and posture:
        rows = [row for row in posture if isinstance(row, dict)]
        if rows:
            columns_seen: list[str] = []
            for row in rows:
                for key in row:
                    if key not in columns_seen:
                        columns_seen.append(key)
            columns = tuple(columns_seen)
            tables.append(
                ReportTable(
                    title="자세안정성 단계",
                    columns=columns,
                    rows=tuple(tuple(row.get(col) for col in columns) for row in rows),
                )
            )

    sections = tuple(
        ReportSection(key="result", title="해석 결과", fields=tuple(fields), tables=tuple(tables))
        if section.key == "result"
        else section
        for section in base.sections
    )

    return ReportDoc(
        meta=meta,
        verdict=verdict,
        sections=sections,
        notices=tuple(notices),
    )
```

- [ ] **Step 5: 등록 + 스펙 뒤집기**

(a) `adapters/__init__.py` 에 추가.

(b) `program_registry.py:185-190`:

```python
    _spec(
        "group-module-unit", "GroupModuleUnit", "Group & Module Unit 권상 구조 해석",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="group-module-unit",
        input_keys=("bdf_model",),
        report_adapter="group-module-unit",
        report_scope="supported",
    ),
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_group_module_unit.py -q
```
기대: 9건 통과.

- [ ] **Step 7: 커밋 준비 완료** — 보고: 어댑터·테스트·fixtures·`__init__.py`·`program_registry.py`.

---

### Task 7: `side-passage` 어댑터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/report/adapters/side_passage.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/side_passage_result.json`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/side_passage_output.json`
- Create: `HiTessWorkBenchBackEnd/tests/test_report_adapter_side_passage.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:191-196`

#### 프로그램 컨텍스트

- 서비스: `app/services/unit_structural_service.py` (Side Passage 는 모듈 오션과 다른, unit_structural 파이프라인의 일부다). 결과 JSON: `output_json` 에 `{"elements": [{"id": ..., "utilization": 0.83, "vonMisesMPa": 261.0}, ...], "summary": {...}}`.
- 판정: `elements[].utilization` 의 최댓값 > 1.0 → "불합격", ≤ 1.0 → "합격", 없으면 None + 사유.

- [ ] **Step 1: fixtures**

`tests/fixtures/report_adapters/side_passage_result.json`:

```json
{
  "output_json": "C:/Users/HHI/AppData/Local/Temp/user/results.json",
  "f06_file": "C:/Users/HHI/AppData/Local/Temp/user/model.f06"
}
```

`tests/fixtures/report_adapters/side_passage_output.json`:

```json
{
  "elements": [
    {"id": 1001, "utilization": 0.42, "vonMisesMPa": 132.0},
    {"id": 1002, "utilization": 0.83, "vonMisesMPa": 261.0},
    {"id": 1003, "utilization": 0.75, "vonMisesMPa": 236.0}
  ],
  "summary": {
    "maxUtilization": 0.83,
    "elementCount": 3
  }
}
```

- [ ] **Step 2: 실패 테스트 작성**

```python
"""side-passage 어댑터 — utilization 로 판정."""
import json
from pathlib import Path

from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta

_FIX_DIR = Path(__file__).parent / "fixtures" / "report_adapters"


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="side-passage",
        display_name="SidePassage",
        analysis_id=501,
        project_name="Side Passage 스냅샷",
        employee_id="ADMIN001",
        created_at=None,
        status="Success",
    )


def _payload(*, output=None) -> dict:
    result = json.loads((_FIX_DIR / "side_passage_result.json").read_text(encoding="utf-8"))
    default_output = json.loads((_FIX_DIR / "side_passage_output.json").read_text(encoding="utf-8"))
    return {
        "input": {"bdf_model": "C:/x/m.bdf"},
        "result": result,
        "output": default_output if output is None else output,
    }


def test_registered_under_its_registry_key():
    from app.services.report.adapters.generic import generic_adapter
    assert get_adapter("side-passage") is not generic_adapter


def test_utilization_table_and_max_field():
    doc = get_adapter("side-passage")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    assert len(result.tables) == 1
    table = result.tables[0]
    assert {"id", "utilization"} <= set(table.columns)
    fields = {f.label: f.value for f in result.fields}
    assert fields.get("최대 활용도") == 0.83


def test_utilization_below_one_yields_pass():
    doc = get_adapter("side-passage")(_payload(), _meta())
    assert doc.verdict == "합격"


def test_utilization_above_one_yields_fail():
    output = json.loads((_FIX_DIR / "side_passage_output.json").read_text(encoding="utf-8"))
    output["elements"].append({"id": 9999, "utilization": 1.42, "vonMisesMPa": 447.3})
    output["summary"]["maxUtilization"] = 1.42
    doc = get_adapter("side-passage")(_payload(output=output), _meta())
    assert doc.verdict == "불합격"


def test_max_survives_when_summary_missing():
    """summary 가 없어도 elements 로 최댓값을 계산해야 판정이 나온다."""
    output = json.loads((_FIX_DIR / "side_passage_output.json").read_text(encoding="utf-8"))
    output.pop("summary")
    doc = get_adapter("side-passage")(_payload(output=output), _meta())
    assert doc.verdict == "합격"
    result = next(s for s in doc.sections if s.key == "result")
    fields = {f.label: f.value for f in result.fields}
    assert fields.get("최대 활용도") == 0.83


def test_missing_output_records_reason_and_leaves_verdict_empty():
    payload = _payload(output=None)
    payload["result"].pop("output_json")
    doc = get_adapter("side-passage")(payload, _meta())
    assert doc.verdict is None
    assert any("결과 파일 미기록" in n for n in doc.notices)


def test_element_row_cap_and_note():
    """수천 개 요소가 오면 상위 500 개만 표에 실리고 note 로 축약 사실을 남긴다."""
    output = {
        "elements": [{"id": i, "utilization": 0.1 + (i % 100) * 0.005} for i in range(1200)],
        "summary": {"maxUtilization": 0.595},
    }
    doc = get_adapter("side-passage")(_payload(output=output), _meta())
    table = next(s for s in doc.sections if s.key == "result").tables[0]
    assert len(table.rows) <= 500
    assert table.note is not None and "전체 1200" in table.note
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_side_passage.py -q
```
기대: `7 failed`.

- [ ] **Step 4: 어댑터 구현** — `app/services/report/adapters/side_passage.py`:

```python
"""SidePassage 전용 어댑터 — utilization 최댓값으로 판정.

unit_structural 파이프라인이 낸 `_results.json` 을 output 으로 받는다. 요소 수가 많아
상위 500 행만 표에 싣고 note 로 축약 사실을 남긴다(_MAX_TABLE_ROWS).
"""
from __future__ import annotations

from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

_MAX_TABLE_ROWS = 500
_PREFERRED_COLUMNS: tuple[str, ...] = ("id", "utilization", "vonMisesMPa", "propertyId")


def _columns_for(rows: list[dict]) -> tuple[str, ...]:
    seen: list[str] = []
    for row in rows:
        for key in row:
            if key not in seen:
                seen.append(key)
    preferred = [key for key in _PREFERRED_COLUMNS if key in seen]
    rest = [key for key in seen if key not in _PREFERRED_COLUMNS]
    return tuple(preferred + rest)


def _rows_for(rows: list[dict], columns: tuple[str, ...]) -> tuple[tuple[Any, ...], ...]:
    return tuple(tuple(row.get(col) for col in columns) for row in rows)


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def side_passage_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    base = generic_adapter(payload, meta)
    result = payload.get("result") or {}
    output = payload.get("output")
    notices = list(base.notices)

    if not isinstance(output, dict):
        if isinstance(result.get("output_json"), str) and result.get("output_json"):
            notices.append("결과 JSON 을 읽지 못했습니다 — 파일 유실이나 8MB 초과일 수 있습니다.")
        else:
            notices.append("결과 파일 미기록 — 해석은 끝났지만 output_json 이 저장되지 않았습니다.")
        output = {}

    elements_raw = output.get("elements") if isinstance(output, dict) else None
    elements = [row for row in (elements_raw or []) if isinstance(row, dict)]
    summary = output.get("summary") if isinstance(output, dict) else None

    columns = _columns_for(elements)
    trimmed = elements[:_MAX_TABLE_ROWS]
    note = None if len(elements) <= _MAX_TABLE_ROWS else f"상위 {_MAX_TABLE_ROWS}행만 표시 (전체 {len(elements)}행)"
    tables: list[ReportTable] = []
    if trimmed:
        tables.append(
            ReportTable(title="요소별 활용도", columns=columns, rows=_rows_for(trimmed, columns), note=note)
        )

    max_util = None
    if isinstance(summary, dict) and _is_number(summary.get("maxUtilization")):
        max_util = summary["maxUtilization"]
    for row in elements:
        util = row.get("utilization")
        if _is_number(util):
            max_util = util if max_util is None else max(max_util, util)

    fields: list[ReportField] = [
        ReportField(label="요소 수", value=len(elements) if elements else "자료 없음"),
    ]
    if max_util is not None:
        fields.append(ReportField(label="최대 활용도", value=max_util))

    if max_util is None:
        verdict = None
        if elements:
            notices.append("요소 활용도를 읽지 못했습니다.")
    elif max_util > 1.0:
        verdict = "불합격"
    else:
        verdict = "합격"

    sections = tuple(
        ReportSection(key="result", title="해석 결과", fields=tuple(fields), tables=tuple(tables))
        if section.key == "result"
        else section
        for section in base.sections
    )

    return ReportDoc(
        meta=meta,
        verdict=verdict,
        sections=sections,
        notices=tuple(notices),
    )
```

- [ ] **Step 5: 등록 + 스펙 뒤집기**

(a) `adapters/__init__.py` 에 `side_passage_adapter` 추가.

(b) `program_registry.py:191-196`:

```python
    _spec(
        "side-passage", "SidePassage", "Side Passage Assessment",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="side-passage",
        input_keys=("bdf_model",),
        report_adapter="side-passage",
        report_scope="supported",
    ),
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_side_passage.py -q
```
기대: 7건 통과.

- [ ] **Step 7: 커밋 준비 완료** — 보고: 어댑터·테스트·fixtures·`__init__.py`·`program_registry.py`.

---

### Task 8: `hull-acceleration` 어댑터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/report/adapters/hull_acceleration.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/hull_acceleration_result.json`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/hull_acceleration_output.json`
- Create: `HiTessWorkBenchBackEnd/tests/test_report_adapter_hull_acceleration.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:198-204`

#### 프로그램 컨텍스트

- 서비스: `app/services/hull_acceleration_service.py`. `HullAccelerationResult.json` (선급 Rule 기반 가속도 성분) 을 `result_info["json_result"]` 로 저장. 판정 없는 계산기.
- `verdict_kind="required"` 는 그대로 두되(scope 밖), 어댑터에서 `verdict=None` 을 유지하고 유의 사항으로 "판정 대상 아님"을 남긴다. 서비스 레이어(`service.py:159-164`)는 `verdict_kind=="required"` 에서 `_NO_VERDICT_NOTICE` 를 자동 추가하는데, 이는 **전용 어댑터가 있을 때는 발동하지 않는다**(`not spec.report_adapter` 조건). 따라서 우리 어댑터가 남긴 "판정 대상 아님" 문구가 그 자리에 앉는다.
- output_json 형태: `{"loadingConditions": [{"name": "Full Load", "accelerations": {"aX": 2.1, "aY": 1.6, "aZ": 3.8}}, ...], "constants": {...}}`.

- [ ] **Step 1: fixtures**

`tests/fixtures/report_adapters/hull_acceleration_result.json`:

```json
{
  "output_json": "C:/Users/HHI/AppData/Local/Temp/user/HullAccelerationResult.json",
  "json_loading_conditions": "C:/Users/HHI/AppData/Local/Temp/user/HullAccelerationResult.json",
  "csv_loading_conditions": "C:/Users/HHI/AppData/Local/Temp/user/SummaryLoadingConditions.csv",
  "pdf": "C:/Users/HHI/AppData/Local/Temp/user/rules.pdf"
}
```

`tests/fixtures/report_adapters/hull_acceleration_output.json`:

```json
{
  "loadingConditions": [
    {"name": "Full Load Departure", "accelerations": {"aX": 2.1, "aY": 1.6, "aZ": 3.8}},
    {"name": "Ballast Arrival",     "accelerations": {"aX": 1.9, "aY": 1.4, "aZ": 3.2}}
  ],
  "constants": {
    "shipRule": "LR",
    "L_bp": 210.4,
    "B": 32.2,
    "T_scantling": 12.5
  }
}
```

- [ ] **Step 2: 실패 테스트 작성**

```python
"""hull-acceleration 어댑터 — 판정 대상 아님이지만 계산 요약은 낸다."""
import json
from pathlib import Path

from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta

_FIX_DIR = Path(__file__).parent / "fixtures" / "report_adapters"


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="hull-acceleration",
        display_name="선급 Rule 기반 선체 가속도 Calculation",
        analysis_id=601,
        project_name="LR 스냅샷",
        employee_id="ADMIN001",
        created_at=None,
        status="Success",
    )


def _payload(*, output=None) -> dict:
    result = json.loads((_FIX_DIR / "hull_acceleration_result.json").read_text(encoding="utf-8"))
    default_output = json.loads((_FIX_DIR / "hull_acceleration_output.json").read_text(encoding="utf-8"))
    return {
        "input": {"pdf_file": "C:/x/rules.pdf"},
        "result": result,
        "output": default_output if output is None else output,
    }


def test_registered_under_its_registry_key():
    from app.services.report.adapters.generic import generic_adapter
    assert get_adapter("hull-acceleration") is not generic_adapter


def test_loading_conditions_become_a_table():
    doc = get_adapter("hull-acceleration")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    assert len(result.tables) == 1
    table = result.tables[0]
    assert table.title == "Loading Conditions"
    assert {"name", "aX", "aY", "aZ"} <= set(table.columns)
    # 두 조건이 있다면 두 행.
    assert len(table.rows) == 2


def test_ship_constants_are_fields():
    doc = get_adapter("hull-acceleration")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    fields = {f.label: f.value for f in result.fields}
    assert fields.get("선급") == "LR"
    assert fields.get("L_bp") == 210.4


def test_verdict_is_left_empty_and_reason_is_documented():
    """판정 대상 아님 — 판정을 채워 넣지 않고 사유만 남긴다."""
    doc = get_adapter("hull-acceleration")(_payload(), _meta())
    assert doc.verdict is None
    assert any("판정 대상" in n for n in doc.notices)


def test_missing_output_records_the_reason():
    payload = _payload(output=None)
    payload["result"].pop("output_json", None)
    payload["result"].pop("json_loading_conditions", None)
    doc = get_adapter("hull-acceleration")(payload, _meta())
    assert doc.verdict is None
    assert any("결과 파일 미기록" in n for n in doc.notices)


def test_condition_with_missing_component_becomes_a_column_gap():
    output = {
        "loadingConditions": [
            {"name": "Test", "accelerations": {"aX": 2.0}}  # aY/aZ 없음
        ],
    }
    doc = get_adapter("hull-acceleration")(_payload(output=output), _meta())
    table = next(s for s in doc.sections if s.key == "result").tables[0]
    # 컬럼은 있는 것만 나오되(aX 는 반드시), aY/aZ 가 없어도 크래시하지 않는다.
    assert "aX" in table.columns
    assert doc.verdict is None
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_hull_acceleration.py -q
```
기대: `6 failed`.

- [ ] **Step 4: 어댑터 구현** — `app/services/report/adapters/hull_acceleration.py`:

```python
"""HullAcceleration 전용 어댑터 — 판정 대상 아님(계산기), Loading Conditions 요약.

⚠ verdict_kind 는 registry 기본값 'required' 를 그대로 둔다 — 이 plan 은 스코프 밖.
   대신 어댑터가 `verdict=None` + notices 로 "판정 대상 아님"을 남긴다. service.py 는
   전용 어댑터가 붙은 App 의 판정 비움에는 자동 사유(_NO_VERDICT_NOTICE)를 추가하지 않아
   ('not spec.report_adapter' 조건, service.py:163) 이 문구가 표지에 올라간다.
"""
from __future__ import annotations

from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

_CONSTANT_LABELS = {
    "shipRule": "선급",
    "L_bp": "L_bp",
    "B": "B",
    "T_scantling": "T_scantling",
    "Cb": "Cb",
}


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _condition_rows(conditions: list[dict]) -> tuple[list[str], list[dict]]:
    """가속도 성분을 개별 컬럼으로 편다 — {name, aX, aY, aZ, ...} 모양."""
    rows: list[dict] = []
    seen_axes: list[str] = []
    for cond in conditions:
        if not isinstance(cond, dict):
            continue
        row: dict[str, Any] = {"name": cond.get("name")}
        accels = cond.get("accelerations")
        if isinstance(accels, dict):
            for axis in accels:
                if axis not in seen_axes:
                    seen_axes.append(axis)
                row[axis] = accels[axis]
        rows.append(row)
    columns = ["name", *seen_axes]
    return columns, rows


def hull_acceleration_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    base = generic_adapter(payload, meta)
    result = payload.get("result") or {}
    output = payload.get("output")
    notices = list(base.notices)

    if not isinstance(output, dict):
        has_path = any(
            isinstance(result.get(key), str) and result.get(key)
            for key in ("output_json", "json_loading_conditions", "json_result")
        )
        if has_path:
            notices.append("결과 JSON 을 읽지 못했습니다 — 파일 유실이나 8MB 초과일 수 있습니다.")
        else:
            notices.append("결과 파일 미기록 — 해석은 끝났지만 결과 JSON 이 저장되지 않았습니다.")
        output = {}

    conditions_raw = output.get("loadingConditions") if isinstance(output, dict) else None
    conditions = [c for c in (conditions_raw or []) if isinstance(c, dict)]
    constants = output.get("constants") if isinstance(output, dict) else None

    fields: list[ReportField] = []
    if isinstance(constants, dict):
        for key, label in _CONSTANT_LABELS.items():
            value = constants.get(key)
            if value is None:
                continue
            fields.append(ReportField(label=label, value=value))
    fields.append(
        ReportField(
            label="Loading Condition 수",
            value=len(conditions) if conditions else "자료 없음",
        )
    )

    columns, rows = _condition_rows(conditions)
    tables: list[ReportTable] = []
    if rows:
        tuple_rows = tuple(tuple(row.get(col) for col in columns) for row in rows)
        tables.append(
            ReportTable(title="Loading Conditions", columns=tuple(columns), rows=tuple_rows)
        )

    notices.append(
        "판정 대상 아님 — 선급 Rule 기반 가속도 산출은 합격/불합격을 내지 않습니다."
    )

    sections = tuple(
        ReportSection(key="result", title="해석 결과", fields=tuple(fields), tables=tuple(tables))
        if section.key == "result"
        else section
        for section in base.sections
    )

    return ReportDoc(
        meta=meta,
        verdict=None,
        sections=sections,
        notices=tuple(notices),
    )
```

- [ ] **Step 5: 등록 + 스펙 뒤집기**

(a) `adapters/__init__.py` 에 `hull_acceleration_adapter` 추가.

(b) `program_registry.py:198-204`:

```python
    _spec(
        "hull-acceleration", "선급 Rule 기반 선체 가속도 Calculation", "HullAcceleration",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="hull-acceleration",
        input_keys=("pdf_file", "constants", "condition_overrides"),
        report_adapter="hull-acceleration",
        report_scope="supported",
    ),
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_hull_acceleration.py -q
```
기대: 6건 통과.

- [ ] **Step 7: 커밋 준비 완료** — 보고: 어댑터·테스트·fixtures·`__init__.py`·`program_registry.py`.

---

### Task 9: `plate-structure` 어댑터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/report/adapters/plate_structure.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/plate_structure_result.json`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/plate_structure_output.json`
- Create: `HiTessWorkBenchBackEnd/tests/test_report_adapter_plate_structure.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:210-215`

#### 프로그램 컨텍스트

- 서비스: `plate_structure_service.py`. Nastran 을 돌린 뒤 `plateResultJson` 을 `result_info["plateResultJson"]` 로 남긴다(어댑터가 읽는 경로는 `result_info.output_json` 대신 `plateResultJson`을 참고할 수 있게 두 경로를 모두 폴백한다 — payload.output 은 `_OUTPUT_KEYS=("output_json","result_json")` 만 로드하므로 어댑터가 result 안의 임베드 summary 를 우선 읽는다).
- `result_info` 키: `bdfPath`, `f06Path`, `bridgeResultJson`, `plateResultJson`, `summary`. summary 는 서비스가 이미 채워 넣어 준다 — `subcaseCount`, `nodeCount`, `shellElementCount`, `cbeamStressRowCount`, `maxDisplacementMm`, `maxVonMisesMPa`, `maxCbeamStressMPa`.
- 판정: `maxVonMisesMPa` 만으로는 판정할 수 없다(허용응력 컨텍스트 필요). 하지만 `summary.utilization` 이 있으면 그 최댓값으로 본다. 없으면 verdict None + "판정 근거 미제공" 사유.
- 실제 subcase 별 utilization 은 `subcases` 배열에 실려 있고 그건 output_json 에 있다.

- [ ] **Step 1: fixtures**

`tests/fixtures/report_adapters/plate_structure_result.json`:

```json
{
  "bdfPath": "C:/Users/HHI/AppData/Local/Temp/user/model.bdf",
  "f06Path": "C:/Users/HHI/AppData/Local/Temp/user/model.f06",
  "plateResultJson": "C:/Users/HHI/AppData/Local/Temp/user/plate_result.json",
  "output_json": "C:/Users/HHI/AppData/Local/Temp/user/plate_result.json",
  "summary": {
    "subcaseCount": 3,
    "nodeCount": 21054,
    "shellElementCount": 15782,
    "maxDisplacementMm": 4.62,
    "maxVonMisesMPa": 189.3,
    "maxCbeamStressMPa": 122.7,
    "maxUtilization": 0.72
  }
}
```

`tests/fixtures/report_adapters/plate_structure_output.json`:

```json
{
  "summary": {
    "maxVonMisesMPa": 189.3,
    "maxUtilization": 0.72
  },
  "subcases": [
    {"caseId": 1, "label": "Static", "maxVonMisesMPa": 132.0, "utilization": 0.51},
    {"caseId": 2, "label": "Lift", "maxVonMisesMPa": 189.3, "utilization": 0.72},
    {"caseId": 3, "label": "Return", "maxVonMisesMPa": 145.5, "utilization": 0.56}
  ]
}
```

- [ ] **Step 2: 실패 테스트 작성**

```python
"""plate-structure 어댑터 — utilization 최댓값으로 판정."""
import json
from pathlib import Path

from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta

_FIX_DIR = Path(__file__).parent / "fixtures" / "report_adapters"


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="plate-structure",
        display_name="PlateStructureAnalysis",
        analysis_id=701,
        project_name="Plate 스냅샷",
        employee_id="ADMIN001",
        created_at=None,
        status="Success",
    )


def _payload(*, output=None, drop_summary=False) -> dict:
    result = json.loads((_FIX_DIR / "plate_structure_result.json").read_text(encoding="utf-8"))
    if drop_summary:
        result.pop("summary")
    default_output = json.loads((_FIX_DIR / "plate_structure_output.json").read_text(encoding="utf-8"))
    return {
        "input": {"bdf_path": "C:/x/m.bdf"},
        "result": result,
        "output": default_output if output is None else output,
    }


def test_registered_under_its_registry_key():
    from app.services.report.adapters.generic import generic_adapter
    assert get_adapter("plate-structure") is not generic_adapter


def test_summary_scalars_are_fields():
    doc = get_adapter("plate-structure")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    fields = {f.label: f.value for f in result.fields}
    assert fields.get("Subcase 수") == 3
    assert fields.get("최대 von Mises") == 189.3
    assert fields.get("최대 변위") == 4.62
    assert fields.get("최대 활용도") == 0.72


def test_utilization_below_one_yields_pass():
    doc = get_adapter("plate-structure")(_payload(), _meta())
    assert doc.verdict == "합격"


def test_utilization_above_one_yields_fail():
    output = json.loads((_FIX_DIR / "plate_structure_output.json").read_text(encoding="utf-8"))
    output["summary"]["maxUtilization"] = 1.15
    output["subcases"][1]["utilization"] = 1.15
    doc = get_adapter("plate-structure")(_payload(output=output), _meta())
    assert doc.verdict == "불합격"


def test_subcases_become_a_table():
    doc = get_adapter("plate-structure")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    assert len(result.tables) == 1
    table = result.tables[0]
    assert {"caseId", "label", "maxVonMisesMPa", "utilization"} <= set(table.columns)
    assert len(table.rows) == 3


def test_missing_utilization_yields_unknown_verdict():
    """utilization 이 없으면 von Mises 만으로는 판정할 수 없다 — 허용응력 컨텍스트 부재."""
    output = json.loads((_FIX_DIR / "plate_structure_output.json").read_text(encoding="utf-8"))
    output["summary"].pop("maxUtilization")
    for row in output["subcases"]:
        row.pop("utilization", None)
    doc = get_adapter("plate-structure")(_payload(output=output), _meta())
    assert doc.verdict is None
    assert any("판정 근거" in n or "utilization" in n.lower() for n in doc.notices)


def test_missing_output_and_summary_records_reason():
    doc = get_adapter("plate-structure")(_payload(output=None, drop_summary=True), _meta())
    assert doc.verdict is None
    assert any("자료 없음" in v for s in doc.sections for f in s.fields
               if isinstance((v := f.value), str))
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_plate_structure.py -q
```
기대: `7 failed`.

- [ ] **Step 4: 어댑터 구현** — `app/services/report/adapters/plate_structure.py`:

```python
"""PlateStructureAnalysis 전용 어댑터 — utilization 로 판정.

summary 는 서비스가 result_info 에 그대로 임베드해 두었고(plate_structure_service:456-462),
subcase 상세는 output_json 안에 있다. 어댑터는 두 출처 모두를 폴백해 요약 필드를 채운다.
"""
from __future__ import annotations

from typing import Any

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter

_MISSING = "자료 없음"

_PREFERRED_COLUMNS: tuple[str, ...] = ("caseId", "label", "maxVonMisesMPa", "utilization")


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _columns_for(rows: list[dict]) -> tuple[str, ...]:
    seen: list[str] = []
    for row in rows:
        for key in row:
            if key not in seen:
                seen.append(key)
    preferred = [key for key in _PREFERRED_COLUMNS if key in seen]
    rest = [key for key in seen if key not in _PREFERRED_COLUMNS]
    return tuple(preferred + rest)


def _rows_for(rows: list[dict], columns: tuple[str, ...]) -> tuple[tuple[Any, ...], ...]:
    return tuple(tuple(row.get(col) for col in columns) for row in rows)


def plate_structure_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    base = generic_adapter(payload, meta)
    result = payload.get("result") or {}
    output = payload.get("output") if isinstance(payload.get("output"), dict) else {}
    notices = list(base.notices)

    # summary 는 result_info 에도, output_json 에도 있을 수 있다 — 둘 다 병합.
    summary_result = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    summary_output = output.get("summary") if isinstance(output.get("summary"), dict) else {}
    merged: dict[str, Any] = {**summary_output, **summary_result}   # result 가 최신

    def _pick(key):
        value = merged.get(key)
        return value if _is_number(value) else None

    subcases_raw = output.get("subcases")
    subcases = [row for row in (subcases_raw or []) if isinstance(row, dict)]

    # 최댓값 폴백 계산 — merged 가 못 채운 자리를 subcases 로 메운다.
    max_von = _pick("maxVonMisesMPa")
    max_util = _pick("maxUtilization")
    for row in subcases:
        v = row.get("maxVonMisesMPa")
        u = row.get("utilization")
        if _is_number(v):
            max_von = v if max_von is None else max(max_von, v)
        if _is_number(u):
            max_util = u if max_util is None else max(max_util, u)

    fields: list[ReportField] = [
        ReportField(
            label="Subcase 수",
            value=merged.get("subcaseCount") if isinstance(merged.get("subcaseCount"), int) else (len(subcases) or _MISSING),
        ),
        ReportField(label="최대 von Mises", value=max_von if max_von is not None else _MISSING, unit="MPa"),
        ReportField(
            label="최대 변위",
            value=_pick("maxDisplacementMm") if _pick("maxDisplacementMm") is not None else _MISSING,
            unit="mm",
        ),
        ReportField(label="최대 활용도", value=max_util if max_util is not None else _MISSING),
    ]

    tables: list[ReportTable] = []
    if subcases:
        columns = _columns_for(subcases)
        tables.append(ReportTable(title="Subcase 요약", columns=columns, rows=_rows_for(subcases, columns)))

    if max_util is None:
        verdict = None
        notices.append(
            "판정 근거(utilization) 를 읽지 못했습니다 — von Mises 만으로는 허용응력 판정을 낼 수 없습니다."
        )
    elif max_util > 1.0:
        verdict = "불합격"
    else:
        verdict = "합격"

    sections = tuple(
        ReportSection(key="result", title="해석 결과", fields=tuple(fields), tables=tuple(tables))
        if section.key == "result"
        else section
        for section in base.sections
    )

    return ReportDoc(meta=meta, verdict=verdict, sections=sections, notices=tuple(notices))
```

- [ ] **Step 5: 등록 + 스펙 뒤집기**

(a) `adapters/__init__.py` 에 추가.

(b) `program_registry.py:210-215`:

```python
    _spec(
        "plate-structure", "PlateStructureAnalysis", "Plate Structure Analysis",
        capabilities=("file-analysis", "passport"),
        input_keys=("input_json", "bdf_model"),
        report_adapter="plate-structure",
        report_scope="supported",
    ),
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_plate_structure.py -q
```
기대: 7건 통과.

- [ ] **Step 7: 커밋 준비 완료** — 보고: 어댑터·테스트·fixtures·`__init__.py`·`program_registry.py`.

---

### Task 10: `double-pipe-fuel-line` 어댑터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/report/adapters/double_pipe_fuel_line.py`
- Create: `HiTessWorkBenchBackEnd/tests/fixtures/report_adapters/double_pipe_fuel_line_result.json`
- Create: `HiTessWorkBenchBackEnd/tests/test_report_adapter_double_pipe_fuel_line.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/report/adapters/__init__.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:216-221`

#### 프로그램 컨텍스트

- 서비스: `doublepipe_psa_service.py`. 엔진(외부 연구원 소유)이 자체 xlsx(사내 서식 `report_template.bin` 기반)를 만들어 `result_info["XLSX_Report"]` 에 남긴다.
- `result_info` 키(관찰): `XLSX_Report`(엔진 xlsx 경로), `csv_file`(입력 CSV), `loadCases`(로드케이스 목록, 있으면), `summary`(있으면 로드케이스 수·최대응력).
- HP-SCR 과 같은 정신 — 엔진 xlsx 자체가 결재 서식이라 우리 어댑터는 요약만 낸다. 판정: `summary.verdict` 가 있으면 그것으로, 없으면 verdict None.

- [ ] **Step 1: fixture** — `tests/fixtures/report_adapters/double_pipe_fuel_line_result.json`:

```json
{
  "XLSX_Report": "C:/Users/HHI/AppData/Local/Temp/user/PSA_Report.xlsx",
  "csv_file": "C:/Users/HHI/AppData/Local/Temp/user/input.csv",
  "loadCases": ["LC1", "LC2", "LC3", "LC4", "LC5"],
  "summary": {
    "loadCaseCount": 5,
    "maxStressMPa": 178.4,
    "verdict": "pass"
  }
}
```

- [ ] **Step 2: 실패 테스트 작성**

```python
"""double-pipe-fuel-line 어댑터 — 엔진 xlsx + 로드케이스 요약."""
import json
from pathlib import Path

from app.services.report.adapters import get_adapter
from app.services.report.models import ReportMeta

_FIXTURE = (
    Path(__file__).parent / "fixtures" / "report_adapters" / "double_pipe_fuel_line_result.json"
)


def _meta() -> ReportMeta:
    return ReportMeta(
        program_id="double-pipe-fuel-line",
        display_name="이중관 구조 연료배관 해석",
        analysis_id=801,
        project_name="이중관 스냅샷",
        employee_id="ADMIN001",
        created_at=None,
        status="Success",
    )


def _payload(**over) -> dict:
    result = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    if "summary_extra" in over:
        result["summary"].update(over["summary_extra"])
    if over.get("drop_summary"):
        result.pop("summary")
    if over.get("drop_xlsx"):
        result.pop("XLSX_Report")
    return {"input": {"input_csv": result.get("csv_file")}, "result": result, "output": None}


def test_registered_under_its_registry_key():
    from app.services.report.adapters.generic import generic_adapter
    assert get_adapter("double-pipe-fuel-line") is not generic_adapter


def test_result_section_lists_load_case_count_and_max_stress():
    doc = get_adapter("double-pipe-fuel-line")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    fields = {f.label: f.value for f in result.fields}
    assert fields.get("로드케이스 수") == 5
    assert fields.get("최대 응력") == 178.4


def test_engine_xlsx_path_is_a_field_when_present():
    doc = get_adapter("double-pipe-fuel-line")(_payload(), _meta())
    result = next(s for s in doc.sections if s.key == "result")
    fields = {f.label: f.value for f in result.fields}
    assert "PSA_Report.xlsx" in str(fields.get("엔진 계산서"))


def test_verdict_pass_when_summary_declares_pass():
    doc = get_adapter("double-pipe-fuel-line")(_payload(), _meta())
    assert doc.verdict == "합격"


def test_verdict_fail_when_summary_declares_fail():
    doc = get_adapter("double-pipe-fuel-line")(
        _payload(summary_extra={"verdict": "fail"}), _meta(),
    )
    assert doc.verdict == "불합격"


def test_missing_verdict_yields_none_and_notice():
    doc = get_adapter("double-pipe-fuel-line")(
        _payload(summary_extra={"verdict": None}), _meta(),
    )
    assert doc.verdict is None
    assert any("판정" in n for n in doc.notices)


def test_missing_engine_xlsx_records_the_reason():
    doc = get_adapter("double-pipe-fuel-line")(_payload(drop_xlsx=True), _meta())
    assert any("엔진 계산서" in n for n in doc.notices)


def test_summary_missing_does_not_crash():
    doc = get_adapter("double-pipe-fuel-line")(_payload(drop_summary=True), _meta())
    assert doc.verdict is None
    result = next(s for s in doc.sections if s.key == "result")
    labels = {f.label for f in result.fields}
    assert "로드케이스 수" in labels
```

- [ ] **Step 3: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_double_pipe_fuel_line.py -q
```
기대: `8 failed`.

- [ ] **Step 4: 어댑터 구현** — `app/services/report/adapters/double_pipe_fuel_line.py`:

```python
"""DoublePipeFuelLine 전용 어댑터 — 엔진 xlsx + 로드케이스 요약.

엔진(외부 연구원 소유)이 자체 xlsx(사내 서식 report_template.bin 기반)를 만든다 — 이 xlsx 는
정본 계산서라 여기서는 요약만 낸다. summary.verdict 가 있으면 그것으로 판정하고, 없으면 비운다.
"""
from __future__ import annotations

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection
from .generic import generic_adapter

_MISSING = "자료 없음"

_TOKEN_MAP = {
    "pass": "합격", "passed": "합격", "ok": "합격", "합격": "합격",
    "fail": "불합격", "failed": "불합격", "ng": "불합격", "불합격": "불합격",
    "warn": "경고", "warning": "경고", "경고": "경고",
}


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def double_pipe_fuel_line_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    base = generic_adapter(payload, meta)
    result = payload.get("result") or {}
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    notices = list(base.notices)

    xlsx_path = result.get("XLSX_Report")
    xlsx_present = isinstance(xlsx_path, str) and bool(xlsx_path.strip())
    if not xlsx_present:
        notices.append("엔진 계산서(사내 서식 xlsx) 가 result_info 에 없습니다.")

    lc_count = summary.get("loadCaseCount")
    if not isinstance(lc_count, int):
        load_cases = result.get("loadCases")
        lc_count = len(load_cases) if isinstance(load_cases, list) else None

    max_stress = summary.get("maxStressMPa") if _is_number(summary.get("maxStressMPa")) else None

    fields: list[ReportField] = [
        ReportField(label="엔진 계산서", value=xlsx_path if xlsx_present else _MISSING),
        ReportField(label="로드케이스 수", value=lc_count if lc_count is not None else _MISSING),
        ReportField(label="최대 응력", value=max_stress if max_stress is not None else _MISSING, unit="MPa"),
    ]

    verdict_token = str(summary.get("verdict") or "").strip().casefold()
    verdict = _TOKEN_MAP.get(verdict_token)
    if verdict is None:
        notices.append("summary.verdict 가 없어 판정을 비웠습니다 — 엔진 계산서를 열어 직접 확인하세요.")

    sections = tuple(
        ReportSection(key="result", title="해석 결과", fields=tuple(fields))
        if section.key == "result"
        else section
        for section in base.sections
    )

    return ReportDoc(meta=meta, verdict=verdict, sections=sections, notices=tuple(notices))
```

- [ ] **Step 5: 등록 + 스펙 뒤집기**

(a) `adapters/__init__.py` 에 추가.

(b) `program_registry.py:216-221`:

```python
    _spec(
        "double-pipe-fuel-line", "DoublePipeFuelLine", "이중관 구조 연료배관 해석",
        capabilities=("file-analysis", "passport"),
        input_keys=("input_csv", "csv_file"),
        report_adapter="double-pipe-fuel-line",
        report_scope="supported",
    ),
```

- [ ] **Step 6: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_report_adapter_double_pipe_fuel_line.py -q
```
기대: 8건 통과.

전체 어댑터 회귀:

```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -k "test_report_adapter_ or test_report_truss_adapter or test_report_service or test_report_router or test_reports_router"
```
기대: 전 케이스 통과. `test_report_truss_adapter.py::test_every_declared_report_adapter_is_actually_registered` 가 신규 9개 키를 모두 검사하는지 확인.

- [ ] **Step 7: 커밋 준비 완료** — 보고: 어댑터·테스트·fixtures·`__init__.py`·`program_registry.py`.

---

### Task 11: 프론트 라디오 [PDF/xlsx] + `api/reports.js` 확장

**Files:**
- Modify: `HiTessWorkBench/frontend/src/api/reports.js:52-77`(`downloadAnalysisReport`)
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/AnalysisReportGenerator.jsx:1-192`(형식 선택 라디오 + 파일명 fallback)

프론트는 러너가 없어 수동 검증을 따른다. 파일명 확장자는 `Content-Disposition` 을 우선하고, 헤더를 못 읽으면 사용자가 선택한 format 을 기본값으로 쓴다.

- [ ] **Step 1: `api/reports.js` 확장**

```js
/**
 * 해석 1건의 계산서를 받아 브라우저 다운로드를 트리거한다.
 * @param {object} opts
 * @param {number} opts.analysisId
 * @param {string} [opts.programName]     - 파일명 폴백에 들어갈 App 이름
 * @param {'xlsx'|'pdf'} [opts.format='xlsx']  - 서버 하위호환을 위해 기본은 xlsx.
 *                                             화면 기본 선택은 프론트가 따로 정한다.
 * 생성이 POST 인 이유는 백엔드 라우터 docstring 참조(App 가용성 게이트).
 */
export async function downloadAnalysisReport({ analysisId, programName, format = 'xlsx' }) {
  const res = await axios.post(
    `${API_BASE_URL}/api/reports/generate`,
    { analysis_id: analysisId, format },
    { headers: getAuthHeaders(), responseType: 'blob' },
  );

  const fallbackExt = format === 'pdf' ? 'pdf' : 'xlsx';
  const filename = filenameFromDisposition(
    res.headers['content-disposition'],
    `${programName ? `${programName}_` : ''}WorkBench_Report_${analysisId}.${fallbackExt}`,
  );

  const blobUrl = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}
```

- [ ] **Step 2: `AnalysisReportGenerator.jsx` 에 형식 라디오 추가**

(a) `useState` 옆에 형식 상태 추가(21행 근처, `appFilter` 다음 줄):

```jsx
  const [format, setFormat] = useState('pdf');   // 화면 기본 선택은 PDF (§2 #4).
```

(b) `handleGenerate` 를 아래로 교체(62~74행):

```jsx
  const handleGenerate = useCallback(async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      await downloadAnalysisReport({
        analysisId: selected.id,
        programName: selected.program_name,
        format,
      });
      showToast(`계산서(${format.toUpperCase()})를 내려받았습니다.`, 'success');
    } catch (error) {
      // blob 요청이라 오류 본문도 Blob 이다. PDF 실패(503)의 detail 은 여기서 읽힌다.
      showToast(await readBlobErrorDetail(error, '리포트 생성에 실패했습니다.'), 'error');
    } finally {
      setGenerating(false);
    }
  }, [selected, showToast, format]);
```

(c) 우측 카드(`<section ...>` 175~181행 사이) 의 `<button ...>계산서 생성</button>` **위**에 라디오 두 버튼을 얹는다:

```jsx
          <fieldset className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="출력 형식">
            <label
              className={`flex cursor-pointer items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-semibold transition-colors ${
                format === 'pdf'
                  ? 'border-[#002554] bg-[#002554] text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="report-format"
                value="pdf"
                checked={format === 'pdf'}
                onChange={() => setFormat('pdf')}
                className="sr-only"
              />
              PDF
            </label>
            <label
              className={`flex cursor-pointer items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-semibold transition-colors ${
                format === 'xlsx'
                  ? 'border-[#002554] bg-[#002554] text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="report-format"
                value="xlsx"
                checked={format === 'xlsx'}
                onChange={() => setFormat('xlsx')}
                className="sr-only"
              />
              XLSX
            </label>
          </fieldset>
```

(d) 버튼 아래 안내 문구(184~186행)도 형식별로 바꾼다:

```jsx
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <FileSpreadsheet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {format === 'pdf'
              ? 'PDF 는 서버(145) 의 MS Excel 로 인쇄해 만듭니다 — Excel 미설치 시 503 이 반환됩니다.'
              : '양식이 등록되지 않은 App 은 범용 서식으로 생성되며, 그 사실이 계산서 표지에 표기됩니다.'}
          </p>
```

- [ ] **Step 3: 빌드 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
기대: 오류 없이 `dist/` 생성.

- [ ] **Step 4: 수동 검증 1(형식 라디오 존재/기본값)**

백엔드 `uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload` + `HiTessWorkBench` 에서 `npm run dev`.

1. 로그인 → `Analysis Report Generator` 진입.
2. 좌측 이력에서 아무 supported App(예: `Truss Structural Assessment`) 을 클릭.
3. 우측 카드 하단에 **[PDF] [XLSX] 라디오 2개**가 보이고, 기본은 **PDF** 가 선택돼 있다(진한 파랑).
4. "계산서 생성" 클릭 → PDF 파일(`.pdf`) 다운로드, 파일 열면 표지 4행(App/프로젝트/사번/상태) + 판정 시트 + 근거 파일 섹션이 올라와 있다.
5. XLSX 로 바꾸고 다시 생성 → `.xlsx` 파일. 시트 구조 동일.

- [ ] **Step 5: 수동 검증 2(9개 신규 어댑터)**

각 App 이력 1건씩 골라(없으면 아무 파일이나 업로드해 이력을 만든다) PDF/xlsx 각각 생성:

| # | App(program_name 이력) | 확인 |
|---|---|---|
| 1 | HP-SCR PSA | 표지에 "해석 모드 = PSA", 유의 사항에 엔진 계산서 언급, 판정=합격 |
| 2 | HP-SCR POR | 같은 요약(POR mode), 판정=합격 |
| 3 | MooringFittingSolve | "최대 Usage" 필드 존재, ≤ 1 이면 합격, > 1 이면 불합격 |
| 4 | ModelBuilderAnalysis | Subcase 요약 표 + "최대 응력"/"최대 변위" 필드 |
| 5 | GroupModuleUnit | "종합 overall" 필드, 자세안정성 단계 표, 판정 3종 매핑 |
| 6 | SidePassage | 요소별 활용도 표(500행 캡), 최대 활용도 필드 |
| 7 | 선급 Rule 기반 선체 가속도 Calculation | Loading Conditions 표, 판정 비움 + "판정 대상 아님" 유의 사항 |
| 8 | PlateStructureAnalysis | Subcase 표 + 활용도 판정 |
| 9 | 이중관 구조 연료배관 해석 | 엔진 계산서 경로 필드, 로드케이스 수 |

- [ ] **Step 6: 수동 검증 3(오류 흐름)**

1. 백엔드에서 `xlsx_to_pdf.convert_xlsx_to_pdf` 를 임시로 예외 던지도록 만들거나(pywin32 미설치 환경) 서버(145) 로 전환(Excel 유무에 따라 다름) → PDF 요청 시 토스트에 "Excel 을 실행할 수 없습니다 …" 문구가 뜨고 다운로드가 트리거되지 않는다. HTTP 는 503.
2. `format` 을 임의로 다른 값으로 바꿔 요청(DevTools 로 XHR 재현) → 422 Unprocessable Entity.
3. `format` 를 아예 뺀 옛 프론트 호출을 재현(payload 에 `format` 미포함) → xlsx 응답(하위호환).

- [ ] **Step 7: 커밋 준비 완료** — 보고: `src/api/reports.js`, `src/pages/analysis/AnalysisReportGenerator.jsx`. (`config.js` 는 스테이징하지 않는다.)

---

### Task 12: `GET /api/reports/capabilities` 자동 노출 확인 + 프론트 배지 확인

이 태스크는 **새 코드가 없다** — 어댑터 태스크(2~10) 가 등록하며 `report_scope` 를 `"supported"` 로 뒤집을 때마다 `report_capabilities()` 는 자동으로 그 App 을 `reportable: true` 로 노출하도록 이미 만들어져 있다(`service.py:219-236`). 여기서는 그 자동 노출이 실제로 프론트 목록에서도 잠금이 풀리는지 사람 눈으로 확인한다.

- [ ] **Step 1: 백엔드 응답 스냅샷 스모크**

```
WorkBenchEnv/Scripts/python.exe -c "from app.services.report.service import report_capabilities as C; import json; d=C(); print(json.dumps({k:d[k] for k in ('hp-scr-psa','hp-scr-por','mooring-fitting-solve','model-builder-analysis','group-module-unit','side-passage','hull-acceleration','plate-structure','double-pipe-fuel-line')}, ensure_ascii=False, indent=2))"
```

기대: 9개 모두 `"reportable": true, "scope": "supported"`. `reason` 은 `null` 이다(supported 는 사유가 필요 없다). `displayName` 은 registry 의 `display_name` 그대로.

- [ ] **Step 2: 신규 라우터 회귀**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_reports_router.py -q -k "capabilities"
```
기대: `test_capabilities_returns_a_program_map` · `test_capabilities_report_which_apps_are_excluded` 통과. 후자는 여전히 `hitess-model-builder` 가 `reportable=False` 임을 검사한다 — `not-applicable` 항목은 지금도 그대로다.

- [ ] **Step 3: 수동 확인 — 프론트 목록에서 "준비 중" 배지 사라짐**

`npm run dev` 로 프론트를 띄우고 `Analysis Report Generator` 열기:

- 9개 App 이력 중 하나라도 있으면 그 행이 **"준비 중"(주황) 배지 없이 활성**으로 보인다(과거에는 `reportScope="planned"` 라 주황 배지 + 비활성).
- 우측 카드의 "적용 양식" 값이 여전히 **"범용 서식"** 이다(hasTemplate=False) — 정본 회사 서식은 이 plan 범위 밖(§11 비목표).
- 클릭 → 계산서 생성 가능.

- [ ] **Step 4: 이 태스크는 산출물 없음** — 사용자 보고: "capabilities 자동 노출 확인 완료, 9개 App 모두 reportable=true". 커밋할 파일 없음.

---

### Task 13: 전체 회귀 + 커밋 준비 완료 + 서버(145) 반영 안내

- [ ] **Step 1: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 신규 파일 10개(어댑터 테스트 9 + 라우터 테스트 1) 합계:
- HP-SCR PSA: 7건
- HP-SCR POR: 5건
- MooringFittingSolve: 9건
- ModelBuilderAnalysis: 9건
- GroupModuleUnit: 9건
- SidePassage: 7건
- HullAcceleration: 6건
- PlateStructure: 7건
- DoublePipeFuelLine: 8건
- 라우터 format: 9건

합계 76건 신규 통과 + 기존 회귀(truss adapter 22건, reports router 15건, service 케이스) 모두 통과.

- [ ] **Step 2: 프론트 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
기대: 오류 없이 `dist/` 생성.

- [ ] **Step 3: 스테이징 점검**

```
git status
```

⚠ `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글, 마스터 §1). `Darkmode.js/` 가 목록에 있으면 제외. 그 외 스테이징 대상:

- 백엔드: `app/services/report/service.py`, `app/routers/reports.py`, `app/services/program_registry.py`, `app/services/report/adapters/__init__.py`, `app/services/report/adapters/hp_scr_psa.py`, `hp_scr_por.py`, `mooring_fitting_solve.py`, `model_builder_analysis.py`, `group_module_unit.py`, `side_passage.py`, `hull_acceleration.py`, `plate_structure.py`, `double_pipe_fuel_line.py`.
- 테스트 + fixtures: `tests/test_report_adapter_*.py` (9개), `tests/test_report_router_format.py`, `tests/fixtures/report_adapters/` 전체(.gitkeep + 9개 result.json + 3개 output.json + 1개 stability.json).
- 프론트: `HiTessWorkBench/frontend/src/api/reports.js`, `HiTessWorkBench/frontend/src/pages/analysis/AnalysisReportGenerator.jsx`.

- [ ] **Step 4: 사용자 보고(커밋은 사용자가 직접)** — 변경 파일 전체 목록(위) + 아래 서버 반영 구분을 그대로 전달.

**서버(145) 반영:**

- **백엔드 — `git pull` + 백엔드 재시작으로 끝.** 신규 어댑터 9개·라우터 시그니처 변경·`program_registry` 뒤집기는 모두 순수 파이썬. 신규 pip 의존성 없음(`requirements.txt` 변경 없음). `pywin32` 는 Unit 권상 PDF 를 위해 이미 설치돼 있어 PDF 경로가 즉시 작동한다.
- **프론트 — 재배포 필요.** WorkBench 포터블 exe 를 `npm run dist` 로 다시 빌드해 배포(`AnalysisReportGenerator.jsx` 라디오 + `api/reports.js` format 파라미터).
- **InHouse 프로그램 — 없음.** 어댑터는 이미 저장된 `result_info` JSON 만 읽는다. `InHouseProgram/` 수동 교체 대상 없음.

**참고 — 다음 Plan 에서 이어질 수 있는 자리:**

- 정본 회사 서식(`report_template`) 를 각 App 에 붙이는 Plan(hasTemplate=True 로 뒤집기).
- verdict_kind="none" 으로 뒤집기 후보(`hull-acceleration`, 계산기 성격): 이 plan 은 `verdict=None + notice` 로 절충했지만 장기적으로는 표지·판정 시트 자체를 안 그리는 게 맞다.
- HP-SCR / DoublePipeFuelLine 엔진 xlsx 를 우리 워크북에 붙임(별첨 시트) — 지금은 경로만 필드로 노출한다.

---

## 자기 검토

- **spec 커버리지**: §2 결정(#1 파일당 어댑터·#2 렌더러 재사용·#3 verdict_vocab·#4 format 파라미터·#5 sheet_name=None·#6 503·#7 자체 파이프라인 불간섭·#8 어댑터당 테스트·#9 크래시 금지·#10 planned→supported 세트 전환·#11 sections.title 이 자기소개·#12 디스크 불사용·#13 GUARDED_ROUTES 미등록) 모두 태스크에 나눠 배치됐다. §3 상태 전이(planned→supported)는 각 어댑터 태스크에서 함께 커밋된다. §4.1 어댑터 규약 4대 규칙은 "어댑터 계약(재확인)" 절에 굳어 있고 각 태스크가 참조한다. §4.2 판정 매핑 표 9종이 태스크 2~10 에 1:1. §4.3 `service.build_report_bytes` 는 태스크 1. §4.4 payload 방어선은 model_builder / side_passage / hull_acceleration 세 어댑터가 "결과 파일 미기록" vs "결과 JSON 을 읽지 못했습니다" 로 갈라 남긴다. §6.1 API 확장·§6.2 capabilities 자동 노출·§7 프론트 라디오·§8 activity_log format·§10 서버 반영 구분·§11 비목표(차트·브랜딩·결재·합본·자체 파이프라인·캐싱·ResultArtifactsCard) 모두 반영.

- **플레이스홀더 없음**: 모든 어댑터 코드가 실제 구현이다. fixture JSON 은 실제 서비스가 저장하는 `result_info` 키를 관찰해 만든 값이라 어댑터가 크로스 서비스 통합에서도 무너지지 않는다.

- **타입/이름 일관성**:
  - `Adapter = Callable[[dict, ReportMeta], ReportDoc]` (`adapters/__init__.py:15`) — 9개 어댑터 함수 시그니처가 정확히 이 형태.
  - `ADAPTERS: dict[str, Adapter]` 의 키 = `ProgramSpec.report_adapter` 값 = fixture 파일명 stem(하이픈만 언더스코어로) 의 세 값이 전부 동일한 슬러그 규약.
  - `payload["result"]` / `payload["output"]` 은 `payload.collect_payload` 계약 그대로.
  - `ReportDoc.notices` 는 tuple[str, ...] — 모든 어댑터가 `list.append` 후 `tuple(notices)` 로 반환.
  - 판정 낱말은 `"합격"|"경고"|"불합격"|None` 만. verdict_vocab 의 세 frozenset 밖 낱말이 나오지 않는다.
  - `format: Literal["xlsx","pdf"]` (라우터) = `format: "xlsx"|"pdf"` (프론트 라디오) = `build_report_bytes(..., format=)` (서비스) — 세 곳이 같은 문자열 2종.
  - `_content_disposition(..., extension="pdf"|"xlsx")` 확장자 조각과 `_report_filename(..., extension=)` 이 같은 값.

- **의존 순서**:
  - Task 1 이 `build_report_bytes` 를 만든다 — Task 2~10 의 어댑터 테스트는 어댑터 함수를 직접 호출하고 서비스 통합은 Task 1 의 라우터 테스트가 대신하므로, Task 1 을 먼저 마쳐야 라우터 회귀가 신규 테스트를 감지한다.
  - Task 2 (`hp_scr_psa`) 가 헬퍼 `_hp_scr_adapter` 를 만든다 — Task 3 (`hp_scr_por`) 가 그 헬퍼를 import 한다. 순서 반전 시 import 실패.
  - Task 4~10 은 서로 독립적이지만 spec §3 실행 순서를 따라 위 표 순서로 커밋한다 — 리뷰가 어댑터 하나씩 끊긴다.
  - Task 11 (프론트) 는 Task 1 의 라우터가 `format` 을 받아야 실동작하므로 태스크 1 이후. 라디오만이라면 프론트를 먼저 배포해도 안전한데(서버는 옛 payload=`{analysis_id}` 로 오면 xlsx 를 돌려주는 하위호환), 이 순서라면 사용자가 PDF 를 골랐는데 xlsx 가 오는 일시적 불일치가 생긴다 — 그래서 배포는 백엔드 → 프론트 순.
  - Task 12 (capabilities 확인) 는 Task 2~10 이 끝난 뒤에만 의미가 있다. `report_scope` 를 뒤집지 않으면 `reportable: false` 로 남는다.
  - Task 13 (전체 회귀 + 반영 안내) 는 마지막.

- **truss adapter 등록 fixture 가 신규 9개 키를 검사한다**: `test_report_truss_adapter.py::test_every_declared_report_adapter_is_actually_registered` 는 `PROGRAM_SPECS` 에서 `report_adapter` 를 뽑아 `ADAPTERS` 키 집합과 비교한다. Task 2~10 이 하나라도 `report_adapter="..."` 를 `ADAPTERS` 등록 없이 프로그램 스펙에만 넣으면 이 테스트가 즉시 실패해 조용한 오타 폴백을 차단한다.

- **자체 파이프라인 불간섭 재확인**: `group-module-unit`·`side-passage`·`mooring-fitting-solve` 어댑터는 파일 시스템·자체 라우트·figures3d 를 부르지 않는다. Unit 권상 검토 보고서(`/api/analysis/unit-structural/report`), Mooring 검토 보고서(`/api/analysis/mooring-fitting/report`), Module Ocean 보고서(`module_ocean_report`)는 이 plan 에서 읽지도 고치지도 않는다 — 그 세 파이프라인의 테스트(`test_unit_lifting_report_*.py`, `test_mooring_report*.py`, `test_module_ocean_report*.py`) 는 회귀에서 그대로 통과해야 한다.

- **`config.js` / `Darkmode.js/` 는 절대 스테이징하지 않는다** — Task 13 Step 3 의 강조 한 번으로 반복 실수를 방지.

- **커밋 메시지 attribution**(사용자가 커밋할 때): 이 대화 session 을 포함한 attribution 문자열은 세션 시스템 지시대로 마지막 두 줄에 붙인다. 각 태스크 커밋 준비 완료 단계에서 사용자에게 파일 목록만 넘기고 커밋 문구는 사용자 재량.
