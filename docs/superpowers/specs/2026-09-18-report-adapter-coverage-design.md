# 계산서 어댑터 확대 — 설계 (Plan I)

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §2.9(Plan I 계약, **이 plan 이 소유**) · §1(공통 규칙) · §3(실행 순서 — 독립, 언제든 착수 가능).
- 대상: `HiTessWorkBenchBackEnd/app/services/report/` + `app/routers/reports.py` + `HiTessWorkBench/frontend/src/pages/analysis/AnalysisReportGenerator.jsx` + `frontend/src/api/reports.js`.
- 구현 plan: `docs/superpowers/plans/2026-09-18-report-adapter-coverage.md`

## 1. 배경 / 문제

`app/services/report/` 는 어댑터·렌더러가 분리된 완성된 뼈대다. 그런데 **실제 등록된 전용 어댑터는
`truss-assessment` 하나**뿐이라(`adapters/__init__.py:17-19`), `program_registry.PROGRAM_SPECS` 에
`report_scope="planned"` 로 남아 있는 프로그램 **9개**가 `POST /api/reports/generate` 를 부르면
`ReportNotAvailable("이 App 의 전용 계산서는 준비 중입니다 …")` 로 400 을 낸다(`service.py:47-50, 121`).

프론트 진입점 `pages/analysis/AnalysisReportGenerator.jsx` 는 `getReportCapabilities()` 로 목록을
필터링해, 이 9개는 "준비 중" 배지가 붙고 클릭 자체가 막힌다(`reportCatalogue.js:38-46`). 즉 사용자는
`Truss Structural Assessment` 와 `report_scope="supported"` 로 이미 열려 있는 계산기 App 계열
(Simple Beam · Column Buckling · Mast/Jib Rest · Carling · D Type Lug · Hole Fatigue · Section Property)
을 벗어난 순간 **범용 계산서조차** 못 받는다.

Unit 권상(`unit_lifting_report_service.py`) · Mooring(`/api/analysis/mooring-fitting/report`) ·
Module Ocean(`module_ocean_report.py`) 은 **자체 파이프라인·자체 라우트**로 이미 xlsx/PDF 를 만들고 있어
`/api/reports/generate` 와 무관하다. 이 plan 은 그 세 계열은 손대지 않고, 9개의 planned 프로그램에
전용 어댑터를 붙여 **`/api/reports/generate` 하나로 모든 정상 이력이 계산서를 뱉게** 한다.

동시에 마스터 §2.9 의 두 번째 요구사항 — `format:"pdf"|"xlsx"` — 를 `POST /api/reports/generate` 에
추가해, 기존 xlsx 응답과 하위호환을 유지한 채 PDF 옵션을 연다(`xlsx_to_pdf.convert_xlsx_to_pdf` 재사용).

## 2. 확정 결정

| # | 결정 | 이유 |
|---|---|---|
| 1 | **어댑터는 프로그램당 파일 하나.** `services/report/adapters/<program_id_snake>.py` 에 module-level 함수 `<snake>_adapter(payload, meta) -> ReportDoc` 를 두고 `adapters/__init__.py::ADAPTERS` map 에 `ProgramSpec.report_adapter` 키로 등록 | 기존 `truss_assessment.py` 와 동일 패턴. 등록 위치 하나만 늘고, 신규 App 이 아무 등록 없이도 `generic_adapter` 로 떨어지는 폴백은 그대로 유지된다(`adapters/__init__.py:22-25`). |
| 2 | **렌더러는 `render_generic_xlsx` 재사용, 새 렌더러를 만들지 않는다.** | 서식 통일이 요구 계약(§2.9). 표지·판정·근거 파일 섹션 자리·판정 색 강조가 어댑터 9개에서 저절로 같아진다. Unit 권상처럼 회사 서식을 인쇄해야 하는 리포트는 이 파이프라인이 아니다. |
| 3 | **각 어댑터는 `verdict_vocab` 낱말만 쓴다.** 새 판정어가 필요하면 `verdict_vocab.py` 의 세 frozenset(NEGATIVE/WARNING/POSITIVE) 에 먼저 추가한 뒤 참조 | 어댑터·렌더러가 판정 낱말을 공유한다는 계약(`verdict_vocab.py:1-9`). 어댑터 안에서 낱말을 하드코딩하면 렌더러가 그 행을 강조하지 않아 '실패 행이 눈에 걸려야 한다'는 약속이 조용히 깨진다. |
| 4 | `POST /api/reports/generate` 에 `format: "pdf" \| "xlsx"` 파라미터를 추가한다. **본문 기본값은 `"xlsx"`**(하위호환), **프론트 기본 선택은 `"pdf"`** | 마스터 §2.9. body 를 기본 `"pdf"` 로 두면 `frontend/src/api/reports.js:56-61` 의 기존 호출이(현재 format 미전송) 갑자기 PDF 를 받아 파일명 확장자가 어긋난다. 화면 기본값은 프론트에서 결정한다. |
| 5 | PDF 변환은 **기존 `services/xlsx_to_pdf.convert_xlsx_to_pdf(xlsx_bytes, sheet_name=None)`** 을 그대로 부른다. `sheet_name=None` 으로 워크북 전체를 인쇄 | 이 렌더러는 데이터 전용 시트를 만들지 않는다(표지 + 섹션 시트만, `generic_xlsx.py:243-251`). Unit 권상처럼 `Members`/`Displacements` 를 걸러야 하는 상황이 아니라 시트 선택이 필요 없다. `sheet_name` 이 falsy 이면 `_printable()` 은 워크북 전체를 돌려준다. |
| 6 | Excel COM 실패 · pywin32 부재 · DRM 복호화 실패는 **HTTP 503 + 원인 문구**로 내려보낸다. xlsx 폴백은 하지 않는다 | `PdfConversionError` 는 실제 사유(설치 문제)를 이미 문구로 담고 있다(`xlsx_to_pdf.py:45-47`). 사용자가 "PDF" 를 골랐는데 조용히 xlsx 가 돌아오면 확장자만 보고 파일이 깨졌다고 오해한다. Unit 권상 PDF 라우트가 이미 같은 규칙이다. |
| 7 | Unit 권상 · Mooring · Module Ocean 의 **기존 전용 리포트 파이프라인은 건드리지 않는다.** `group-module-unit` / `side-passage` / `mooring-fitting-solve` 에 어댑터를 붙여도 그 파이프라인은 별도 라우트(`/api/analysis/unit-structural/report`, `/api/analysis/mooring-fitting/report`, module_ocean_report 라우트)라 서로 독립적으로 동작한다 | 마스터 §2.9. 새 어댑터는 `POST /api/reports/generate` 로 오는 요청만 응대하고, 프로그램의 화면 버튼(예: Studio "검토 보고서") 은 자기 전용 라우트를 그대로 부른다. |
| 8 | **어댑터 파일마다 테스트 파일 1개.** `tests/test_report_adapter_<program_id_snake>.py` — 정상 payload → 섹션 헤더/한 행 스냅샷 + `result_info` 필수 키 누락 → "자료 없음" 셀 + 어댑터가 크래시하지 않음 | truss_adapter 는 `test_report_truss_adapter.py` 로 이미 이 패턴이라 파일명 규약이 자연스럽다. planned 프로그램은 실측 이력이 얇아 스냅샷을 크게 만들 수 없으니(각 App 당 fixture 하나) 표지·섹션 헤더·verdict 셀 정도만 잡는다. |
| 9 | **어댑터는 크래시하지 않는다.** `result_info` 에 기대 키가 없거나 타입이 어긋나면 해당 필드/표는 `ReportField(label=..., value="자료 없음")` 로 넣고 `ReportDoc.notices` 에 "…을 읽지 못했습니다" 를 남긴다 | `service.py:131-142` 가 이미 어댑터 예외를 잡아 `generic_adapter` 로 폴백하지만, 폴백은 App 별 지식을 잃는다. 크래시 대신 자료 없음 셀을 내면 표지·판정·근거 섹션과 App 별 시트 구조는 살고, 왜 비었는지는 유의 사항에 남는다(`generic_adapter._omission_notice` 와 같은 철학). |
| 10 | 어댑터가 등록되면 해당 프로그램의 `ProgramSpec.report_scope` 를 **`"planned" → "supported"`** 로 뒤집는다(같은 커밋). `report_adapter` 필드도 새 키로 채운다 | `service.py:120-121` 이 `report_scope != "supported"` 이면 400 을 내므로 어댑터만 등록해서는 라우트가 안 열린다. `_spec()` 이 `report_scope=="supported"` 일 때 자동으로 `"report"` capability 를 파생한다(`program_registry.py:73-75`) — 두 곳이 아니라 이 한 곳만 고치면 프론트 카탈로그 표시도 함께 바뀐다. |
| 11 | 어댑터가 스스로 "무엇을 담는지" 를 선언하는 별도 메타 표는 만들지 않는다. **`ReportDoc.sections[].title`** 이 곧 자기소개다 | 렌더러가 이미 섹션 제목으로 시트를 만들고, 프론트는 `capabilities.hasTemplate`/`scope` 만 본다. 어댑터별 capability 자기선언 필드를 새로 만들면 program_registry 와 이중 출처가 된다. |
| 12 | 리포트 산출물은 **디스크에 남기지 않는다.** 현재 정책(BytesIO 스트림 응답, `service.py:213-216`) 그대로. PDF 도 `xlsx_to_pdf` 내부 임시폴더에서 읽어 바이트만 돌려주고 폴더는 파괴 | 사내 DRM at-rest 암호화 회피. userConnection 아래에 쓰면 `HHIDRMC` 4096B 가 덧붙어 다음 응답이 깨진다(모듈 오션 보고서 개발 시 실측). |
| 13 | 라우트에 `GUARDED_ROUTES` 등록은 **하지 않는다** — 리포트는 앱 상태와 무관한 파생 조회 | 마스터 §1.8. 계산기 App 을 점검 모드로 내려도 이미 생성된 해석의 계산서는 뽑을 수 있어야 한다. |

## 3. 데이터 모델

**신규 테이블·컬럼 없음.** 어댑터 확대는 순수 코드 변경 + `ProgramSpec.report_scope` 값 전환이다.

### 3.1 `ProgramSpec.report_scope` 상태 전이

```
"planned"        ── adapter 등록 + report_scope="supported" ──▶  "supported"
"not-applicable" ── 손대지 않음
"supported"      ── 손대지 않음(이미 서빙 중)
```

- `planned → supported` 는 반드시 한 번의 커밋에서 함께 일어난다(`report_adapter="<key>"` + `report_scope="supported"`). 둘을 나누면 등록만 되고 라우트는 400 을 계속 낸다.
- `capabilities` frozenset 은 `_spec()` 에서 자동으로 `("report",)` 를 붙이므로 손으로 추가하지 않는다(§2 #10, `program_registry.py:73-75`).
- 데이터베이스 스키마는 그대로 — `Analysis` 레코드는 `program_name` 문자열만 저장하고, 스코프는 코드 안에 있다.

## 4. 서비스 계약

### 4.1 어댑터 파일 규약

```python
# app/services/report/adapters/<program_id_snake>.py
from __future__ import annotations

from ..models import ReportDoc, ReportField, ReportMeta, ReportSection, ReportTable
from .generic import generic_adapter  # 부분 채움을 얹을 때만 임포트


def <snake>_adapter(payload: dict, meta: ReportMeta) -> ReportDoc:
    """<프로그램 표시명> 전용 어댑터.

    input  = payload["input"]  = record.input_info
    result = payload["result"] = record.result_info
    output = payload["output"] = result_info.output_json/result_json 로 로드한 dict (없으면 None)
    """
    # 1) 필수 키 정규화 (없으면 "자료 없음" 셀 + notices 문구)
    # 2) 섹션 조립: overview 는 generic 이 만든 걸 유지하거나 직접 구성
    # 3) 표는 ReportTable(title, columns, rows, note?) 로만 표현
    # 4) 판정은 verdict_vocab 낱말 하나로 좁힌다: "합격" | "불합격" | "경고" | None
```

- **등록**: `adapters/__init__.py::ADAPTERS` map 에 `"<key>": <snake>_adapter` 추가. 키는 `ProgramSpec.report_adapter` 값과 정확히 일치해야 한다(문자열 비교, `adapters/__init__.py:22-25`).
- **부분 재사용**: `truss_assessment_adapter` 처럼 `generic_adapter(payload, meta)` 로 기본 골격을 만들고 `result` 섹션만 갈아 끼워도 된다(`truss_assessment.py:93-99`). 이때 `base.notices` 는 반드시 이어받는다 — 조용한 누락 방지.
- **크래시 금지**: 파일 로드/키 조회는 `try/except`(또는 `.get()`) 로 감싸고, 실패 사유는 `ReportDoc.notices` 에 남긴다. `service.py:131-142` 의 예외 폴백은 마지막 안전망일 뿐 정상 경로가 아니다.

### 4.2 대상 프로그램 9종 — 판정 매핑 표

| # | program_id | display_name / alias | 주요 `result_info` 경로 | 판정 근거 |
|---|---|---|---|---|
| 1 | `hp-scr-psa` | HP-SCR PSA · HP-SCR | `result_info.XLSX_Report` (엔진이 만든 xlsx 경로), `result_info.bdf`, `result_info.analysis_mode` | HP-SCR 엔진이 별도 xlsx 를 만들지만 우리는 요약본만 낸다 — 엔진 xlsx 존재 여부 + `analysis_mode` 필드로 성공 판정, 실패면 `job_message` 를 유의 사항. verdict_kind="required" 라 판정 필드는 뜬다. |
| 2 | `hp-scr-por` | HP-SCR POR | 위와 동일 스키마(`hpscr_service.py` 를 mode 만 바꿔 재사용) | 같은 어댑터 함수를 두 키(`hp-scr-psa`, `hp-scr-por`)에 매핑해도 되고, 파일을 나눠 각자 등록해도 된다. YAGNI: 필드가 동일하니 공용 헬퍼 + 두 개의 얇은 어댑터 함수. |
| 3 | `mooring-fitting-solve` | MooringFittingSolve | `result_info.output_json`(SOL101 결과), `result_info.edited_bdf`, `result_info.yield_mpa`, `result_info.safety_factor` | Mooring `solve-bdf` 는 `Usage = σeff/(σy/γM)` 를 낸다. 최대 Usage > 1.0 이면 "불합격", 그 외 "합격". 파일이 없으면 판정 비움 + 사유. |
| 4 | `model-builder-analysis` | ModelBuilderAnalysis | `result_info.output_json`(Nastran 결과 파서 `_results.json`), `result_info.f06_file`, `result_info.edited_bdf` | 결과 JSON 의 최대 응력/변위 요약만 표로. 판정은 result JSON 안의 pass/fail 플래그가 있으면 그것으로, 없으면 verdict None + 사유. |
| 5 | `group-module-unit` | GroupModuleUnit · Group & Module Unit 권상 구조 해석 | `result_info.nastran_result_json`, `result_info.stability_json`, `result_info.posture_json` | ⚠ **전용 Unit 권상 보고서(`unit_lifting_report`)와는 별개**. 이 어댑터는 `/api/reports/generate` 로 왔을 때만 도는 가벼운 요약본이다. 판정: `stability_json.overall` 을 그대로 verdict_vocab 낱말로 매핑(pass→합격, warn→경고, fail→불합격). |
| 6 | `side-passage` | SidePassage · Side Passage Assessment | `result_info.output_json`(unit_structural 파이프라인 결과), `result_info.f06_file` | 결과 JSON 의 요소 응력 요약(활용도 > 1.0 개수) 로 판정. 없으면 판정 비움. |
| 7 | `hull-acceleration` | HullAcceleration · 선급 Rule 기반 선체 가속도 Calculation | `result_info.output_json` 또는 `result_info` 직접 필드(가속도 컴포넌트, condition), `input_info.constants` · `input_info.condition_overrides` | 계산기 App(판정 없음)에 가깝지만 registry 는 `verdict_kind="required"` 기본값이라 판정 칸이 뜬다. 어댑터에서 verdict None 을 그대로 두고 유의 사항으로 "판정 대상 아님" 을 남긴다(장기적으로는 `verdict_kind="none"` 으로 뒤집는 게 맞지만, 그건 이 plan 범위 밖). |
| 8 | `plate-structure` | PlateStructureAnalysis · Plate Structure Analysis | `result_info.output_json`(플레이트 응력 결과), `input_info.input_json` | 각 플레이트 요소의 utilization 표. 최대 utilization > 1.0 → 불합격, ≤ 1.0 → 합격. 결과 파일 없으면 판정 비움. |
| 9 | `double-pipe-fuel-line` | DoublePipeFuelLine · 이중관 구조 연료배관 해석 | `result_info.XLSX_Report`(PSA 엔진이 만든 사내 서식 xlsx), `input_info.input_csv` · `input_info.csv_file` | ⚠ 엔진이 자체 xlsx 를 만들어 `HiTessAdapter/report_template.bin` 서식으로 서빙 중이지만, 그 파일은 **엔진의 산출물**이지 `/api/reports/generate` 응답이 아니다. 우리 어댑터는 요약(로드케이스 수 · 최대 응력 · 엔진 exit)만 표로 낸다. 판정은 엔진 결과에 verdict 컬럼이 있으면 그것으로, 없으면 비움. |

- 등록 순서는 **9개 병렬**이지만, plan(구현) 에서는 위 순서대로 1개씩 커밋을 끊어 리뷰가 가능하게 한다.
- 각 어댑터 함수 이름은 `_adapter` 접미사(`hp_scr_psa_adapter`, `hull_acceleration_adapter` …). `ADAPTERS` 키는 `program_id` 슬러그 그대로.

### 4.3 `service.py` 변경

- **`build_report_bytes(record, *, user_connection_base, format="xlsx") -> tuple[str, bytes, str]`** 신설. 튜플의 세 번째 값은 미디어 타입. 기존 `build_report_xlsx` 는 이 함수를 얇게 감싸 xlsx 를 돌려주는 하위호환 유지(외부에서 import 될 수 있다).
- `format=="pdf"` 이면 `render_generic_xlsx(doc)` 결과를 `convert_xlsx_to_pdf(xlsx_bytes, sheet_name=None)` 로 통과시키고 파일명 확장자를 `.pdf` 로. `PdfConversionError` 는 그대로 던진다(라우터가 503 매핑).
- `_report_filename(doc)` 확장자 분기: `xlsx` 는 `.xlsx`, `pdf` 는 `.pdf`. `_FILENAME_STEM_MAX` 는 그대로.

### 4.4 payload 구조와 어댑터의 방어선

`collect_payload(record, *, user_connection_base)` 가 어댑터에 넘기는 dict 구조는 이미 굳어 있다(`payload.py:48-`):

```
payload = {
    "input":  record.input_info  (dict, 없으면 {}),
    "result": record.result_info (dict, 없으면 {}),
    "output": <result_info.output_json | result_json> 로 로드한 JSON dict 또는 None,
}
```

- `output` 이 `None` 인 경우는 두 가지가 섞여 있다 — ① 결과 파일 경로가 애초에 없다, ② 경로는 있지만 파일이 사라졌거나 손상됐다. **어댑터는 두 사유를 구분해 notices 를 남긴다** — `result_info.output_json` 키의 존재 여부로 갈린다. 구분 없이 "결과 파일 없음"만 쓰면 결재자가 이력이 지워진 것으로 오해한다.
- `_load_json_if_allowed` 는 `userConnection` 밖 경로·8MB 초과·깨진 JSON 을 조용히 `None` 으로 돌려준다(`payload.py:28-45`) — 이 세 상황이 사용자 관점에선 같은 "output=None" 이라 어댑터가 여기서 특별한 진단을 할 방법이 없다. 결과 파일 진단이 필요한 App 은 `Analysis.result_info` 스냅샷을 표에 통째로 실어(`generic_adapter._split`) 결재자가 원본 경로를 볼 수 있게 한다.

## 5. 발신 훅

없음. 리포트 생성은 사용자 요청에 대한 동기 응답이라 알림을 남기지 않는다 — 다운로드가 즉시 이뤄지므로 알림이 소음이 된다.

## 6. API

### 6.1 `POST /api/reports/generate` — 요청 스키마 확장

```python
class ReportRequest(BaseModel):
    analysis_id: int
    format: Literal["xlsx", "pdf"] = "xlsx"   # 기본 xlsx(하위호환)
```

- 기존 응답 헤더는 그대로. `Content-Type` 은 형식에 따라 갈린다:
  - xlsx: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - pdf: `application/pdf`
- `Content-Disposition` 파일명 확장자도 대응 형식으로 바뀐다. `_content_disposition()` 이 `.xlsx` 를 하드코딩해 두어(`reports.py:41-55`) `format` 을 받아 스템에서 떼내도록 시그니처를 넓힌다.
- 오류 매핑:
  - `ReportNotAvailable` → 400 (기존 그대로)
  - `PdfConversionError` → 503, detail = 예외 문구 그대로 (Excel 미설치·pywin32 부재·DRM 복호화 실패 모두 포함)
  - 소유자 아님 → 403 (기존 `assert_current_user_can_access_owner`)

### 6.2 `GET /api/reports/capabilities` — 변경 없음

`report_capabilities()` 는 그대로. 어댑터가 등록되고 `report_scope="supported"` 로 뒤집히면 자동으로 `reportable: true` 로 노출된다(`service.py:219-236`). 어댑터 등장 = 프론트 버튼 게이팅 통과.

### 6.3 `GUARDED_ROUTES` — 등록하지 않음

§2 #13.

## 7. 프론트

### 7.1 `pages/analysis/AnalysisReportGenerator.jsx`

- 선택 카드 하단의 `handleGenerate` 옆에 **라디오 두 버튼 [PDF / xlsx]** 를 얹는다(`AnalysisReportGenerator.jsx:157-181` 우측 카드 안). 기본 선택 = `"pdf"`(§2 #4).
- `downloadAnalysisReport({ analysisId, programName, format })` 로 시그니처 확장. 파일명 폴백 확장자도 format 에 따라 바꾼다(`api/reports.js:66-69`).
- 503 응답이면 blob 안의 `detail` 을 읽어 토스트로 표시(`readBlobErrorDetail` 재사용). 응답이 xlsx 로 오더라도 사용자가 PDF 를 골랐는데 서버가 xlsx 를 돌려주는 경로는 없다(§2 #6) — 그래도 확장자 안전장치로 `res.headers['content-type']` 을 보고 파일명 스템의 확장자를 맞춰 둔다.

### 7.2 새 페이지·새 컴포넌트 없음

마스터 §2.9 는 `ResultArtifactsCard` 를 언급하지만, 그 컴포넌트는 실제로는 Unit 권상 전용 다이얼로그를 여는 카드다(§ 11 참조). 범용 계산서 진입점은 **`AnalysisReportGenerator`** 하나이고, 이 plan 은 그 페이지만 손댄다. MyProjects 상세 모달·앱 페이지에 새 버튼을 얹지 않는다.

### 7.3 `reportCatalogue.js` 변경 없음

`decorateHistoryForReport()` 는 `capabilities.reportable` 만 본다. 어댑터가 등록되면 `report_scope="supported"` 가 자동으로 이 값을 true 로 만들어 목록이 열린다. 프론트 코드 변경 불필요.

## 8. 보관

- 리포트 파일은 **디스크에 남기지 않는다.** 요청 → 메모리 xlsx → (PDF 이면) 임시폴더에서 즉시 변환·삭제 → 응답 스트림(§2 #12).
- 활동 로그(`activity_service.log_activity`) 는 이미 `EXPORT_REPORT` 로 남기고 있다(`reports.py:86-92`). action_detail 에 `format` 도 함께 남겨 사용 통계에 재료를 남긴다(마스터 §2.5 통계 그룹과 무관, 감사 목적).
- Excel 임시폴더(`hitess_pdf_<random>`) 는 `xlsx_to_pdf._cleanup()` 이 `finally` 에서 지운다(`xlsx_to_pdf.py:137-143`).

## 9. 테스트 전략

백엔드(pytest, `tests/conftest.py` fixture 재사용 — `db_session`, `admin_client`, `switchable_client`):

| 파일 | 검증 |
|---|---|
| `tests/test_report_adapter_hp_scr_psa.py` | 정상 payload → 표지·result 시트에 기대 필드가 있고, verdict 가 verdict_vocab 낱말; `result_info.XLSX_Report` 누락 → "자료 없음" 셀 + notices 문구; 어댑터가 크래시하지 않음 |
| `tests/test_report_adapter_hp_scr_por.py` | 위와 동일(POR mode) |
| `tests/test_report_adapter_mooring_fitting_solve.py` | Usage > 1.0 → "불합격", ≤ 1.0 → "합격", `output_json` 부재 → 판정 비움 + 사유 |
| `tests/test_report_adapter_model_builder_analysis.py` | 결과 요약 표 · f06 참조 · edit intent 없어도 안 깨짐 |
| `tests/test_report_adapter_group_module_unit.py` | `stability_json.overall` → 판정 3종 매핑, unit_lifting 전용 리포트 라우트를 부르지 않음 |
| `tests/test_report_adapter_side_passage.py` | utilization 표 · 최대 활용도 판정 |
| `tests/test_report_adapter_hull_acceleration.py` | 가속도 컴포넌트 필드 · 판정 비움(현재 상황) · 유의 사항 문구 |
| `tests/test_report_adapter_plate_structure.py` | utilization 표 · 판정 · 결과 파일 없으면 자료 없음 |
| `tests/test_report_adapter_double_pipe_fuel_line.py` | 엔진 xlsx 경로 존재/부재 · 로드케이스 요약 |
| `tests/test_report_router_format.py` | `format="xlsx"` (기본) → PK/xlsx MIME, `format="pdf"` → `%PDF` 매직/pdf MIME; pywin32 미설치 모킹 → 503 + detail; `format` 없으면 xlsx(하위호환); `assert_current_user_can_access_owner` 403 은 형식과 무관 |

`test_report_service.py` 의 기존 케이스(어댑터 없는 App 이 planned 사유로 400) 는 9개 중 아직 어댑터가 안 붙은 것을 골라 유지한다 — 9개 전부 supported 로 뒤집힌 시점에는 `test_report_service.py` 안의 planned 검증 케이스를 `hitess-modelflow`(여전히 not-applicable) 처럼 뒤집기 불가 항목으로 옮긴다.

**수동 프론트 검증**(러너 없음): 9개 App 각각에 대해 완료된 이력 하나씩 → `Analysis Report Generator` 진입 → PDF/xlsx 각각 다운로드 → 표지·판정·근거 파일 섹션 확인 + 파일 확장자 · MIME 확인. PDF 는 서버(145)에 MS Excel 이 있어야 되므로 dev PC 에서 검증 후 서버에서 1회 재검.

추가 수동 케이스:
- `result_info.output_json` 을 일시적으로 다른 이름으로 옮겨 두고 재생성 → "자료 없음" 셀 + 유의 사항, 500/크래시 없음.
- 프론트 라디오를 PDF 에 두고 서버(145) 재시작 직후 첫 요청 → Excel 초기 기동 지연(≈ 2.6s) 확인, 두 번째 요청은 즉시 종료(모듈 락 해제 확인).
- `format` 파라미터 없이 옛 프론트 빌드에서 호출 → xlsx 응답(하위호환).

## 10. 서버(145) 반영 구분

- 백엔드: **`git pull` + 백엔드 재시작으로 끝.** 새 파일(어댑터 9개 + 테스트 9개 + 라우터 시그니처 변경)은 모두 순수 파이썬. 신규 pip 의존성 없음(`xlsx_to_pdf` 가 요구하는 pywin32 는 이미 Unit 권상 PDF 를 위해 설치돼 있음).
- 프론트: **재배포 필요**(`AnalysisReportGenerator.jsx` + `api/reports.js` 라디오·format 파라미터).
- InHouse 프로그램: **없음.** 어댑터는 이미 저장된 `result_info` JSON 만 읽는다.

## 11. 비목표

- **차트 임베딩** — 결과 그래프·응력 컨투어를 어댑터가 만들어 xlsx 에 이미지로 붙이는 방식은 이 plan 범위 밖. 필요하면 별도 plan.
- **테넌트/부서별 브랜딩** — 표지 로고·양식 커스터마이즈는 회사 서식 파일(예: 이중관 PSA 의 `report_template.bin`) 몫이고, 우리 렌더러는 브랜드 중립이다.
- **결재/승인 워크플로우** — 계산서에 결재란·서명·상태를 붙이는 것은 이 plan 범위 밖.
- **다중 해석 합본 리포트** — "3건을 하나의 pdf 로" 같은 요구는 Plan F(결과 비교) 의 영역이지 이 plan 이 아니다.
- **Unit 권상 · Mooring · Module Ocean 전용 파이프라인 변경** — 위 세 계열은 이미 자체 라우트로 서빙 중이고, 이 plan 은 그 코드·서식·엔드포인트를 **읽지도 고치지도 않는다**. `group-module-unit`/`side-passage`/`mooring-fitting-solve` 어댑터는 `/api/reports/generate` 로 오는 요청만 응대한다.
- **리포트 디스크 캐싱** — 같은 해석에 같은 형식을 다시 요청해도 매번 새로 렌더링한다. 사용자 이력이 얇고(하루 수십 회), Excel COM 이 캐시보다 느리지 않아 캐시가 이득이 없다.
- **`ResultArtifactsCard` 재작업** — 마스터 §2.9 가 언급했지만 그 컴포넌트는 Unit 권상 다이얼로그 카드다(§7.2). 이 plan 은 그 카드에 손대지 않는다 — Unit 권상은 자체 라우트로 이미 xlsx/PDF 를 서빙한다.
