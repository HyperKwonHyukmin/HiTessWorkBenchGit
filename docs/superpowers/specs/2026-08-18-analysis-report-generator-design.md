# 해석 리포트 생성기 (Analysis Report Generator) — 설계

- 날짜: 2026-08-18
- 상태: 승인됨 → 구현 계획 작성 예정
- 범위: 해석 이력 1건 → XLSX 계산서 1부. Productivity 모드 신규 App + 전 앱 공통 리포트 엔진.

## 목적

해석 결과를 결재·기록용 문서로 만드는 일이 현재 앱마다 제각각이거나 아예 없다.
`Analysis` 레코드 하나를 입력으로 삼는 **단일 리포트 엔진**을 세우고, 그 위에
Productivity 모드 App 하나를 얹어 25개 앱 전체를 같은 방식으로 문서화한다.

## 배경 — 지금은 사일로 2개

| 기존 자산 | 방식 | 적용 범위 |
|---|---|---|
| `services/assessment_service.py:32` `_json_to_xlsx_bytes` | 결과 JSON → 표 덤프 | Truss Structural Assessment 전용 |
| `services/carling_report_service.py:216` `generate_report` | 사내 `.xlsm` 결재 양식에 값 주입 | Carling 전용 (free/optimization × 집중/분포 = 4종) |

즉 **25개 앱 중 2개만** 계산서가 나오고, 두 앱이 서로 다른 코드로 서로 다른 문서를 만든다.
나머지 23개는 화면 결과를 보고 손으로 계산서를 쓴다.

한편 전 앱 공통으로 이미 갖춰진 것이 세 가지 있고, 이 설계는 그 위에 얹힌다.

- **`models.Analysis`** — 파일 기반 앱뿐 아니라 파라메트릭 앱도 레코드를 남긴다
  (`column_buckling_service.py:90`, `carling_service.py:153` 등). `input_info` / `result_info`(JSON)에
  입력값과 결과 요약, 그리고 `input_json` / `output_json` 파일 경로가 들어 있다.
- **`services/program_registry.py`** — `program_id` + 과거 alias + `capabilities` + `rerun_adapter`를
  모아 둔 read-side 단일 진실 소스. 통계·passport·재실행이 이미 공유한다.
- **`services/analysis_passport.py:190`** `build_analysis_passport(record, *, user_connection_base)` —
  레코드가 참조하는 산출물의 계보(해시·크기·존재 여부)를 경로 노출 없이 만들어 준다.

## 확정된 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 문서 성격 | **하이브리드** — 양식이 등록된 앱은 결재 양식, 없으면 범용 서식 | 23개를 즉시 커버하면서 양식은 하나씩 승격 |
| 진입점 | **Productivity 모드 신규 App 카드** | 카탈로그 아이템으로 등재. 개별 앱 결과 화면 버튼은 후속 |
| 출력 포맷 | **XLSX 단일** | `requirements.txt`에 openpyxl만 있고 XLSX→PDF 변환기·Excel COM 모두 없음 |
| 묶음 범위 | **해석 1건 = 리포트 1개** | 데이터 모델·UI 최소. 다건은 후속 |
| 구현 접근 | **렌더러 레지스트리 (접근안 A)** | 어댑터(데이터)와 렌더러(서식) 축을 분리해 신규 앱 비용을 함수 1개로 |

### 비목표 (Non-goals)

- PDF·DOCX 출력 — 서버에 변환 수단이 없다. 필요해지면 별도 설계.
- 여러 해석을 한 문서로 묶기.
- 각 앱 결과 화면의 리포트 버튼 — 같은 엔진을 쓰는 후속 작업.
- 생성된 리포트를 서버 디스크에 저장하기 — 저장하는 순간 사내 DRM이 암호화한다. 메모리에서만 만든다.

## 아키텍처

```
[Report Generator 앱 (React, Productivity 모드)]
   │ ① 대상 선택 : GET /api/analysis/history          (기존 그대로)
   │ ② 가능 여부 : GET /api/reports/capabilities       (신규)
   │ ③ 생성      : POST /api/reports/generate          (신규)
   ▼
[routers/reports.py]   require_auth + 본인/관리자 검사 (_access_control 재사용)
   ▼
[services/report_service.py]  오케스트레이터
   ├─ spec    = resolve_program(record.program_name)           ← program_registry (기존)
   ├─ payload = collect_payload(record)                        ← input_info + result_info + output_json
   ├─ doc     = ADAPTERS[spec.report_adapter](payload, meta)   ← 없으면 generic_adapter
   ├─ doc.provenance = build_analysis_passport(record, ...)    ← analysis_passport (기존)
   └─ renderer = TemplateRenderer(spec.report_template) | GenericRenderer
         └─ XLSX bytes  (openpyxl → BytesIO, 디스크 미저장)
```

핵심은 **어댑터(데이터 정규화)와 렌더러(서식)의 분리**다. 하이브리드가 요구하는
"양식 있는 앱 / 없는 앱"은 렌더러 축에서만 갈리고, 어댑터 축은 앱별 결과 구조를 흡수한다.
두 축이 직교하므로 어느 쪽이든 독립적으로 하나씩 승격할 수 있다.

## 중간표현 `ReportDoc`

`program_registry.ProgramSpec`과 같은 frozen dataclass 스타일로 맞춘다.

```python
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
    key: str                     # "overview" | "input" | "result" | "verdict" | "provenance"
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
    verdict: str | None                     # "합격" | "불합격" | "경고" | None
    sections: tuple[ReportSection, ...]
    provenance: dict | None = None          # analysis_passport 결과
    template_applied: bool = False          # 렌더러가 채운다
```

표준 섹션 순서는 **개요 → 입력 조건 → 해석 결과 → 판정 → 근거 파일**로 고정한다.
어느 앱의 리포트를 열어도 같은 자리에 같은 정보가 있어야 결재자가 읽는다.

`verdict`는 문자열이다. 색으로만 표현하지 않는다(PRODUCT.md 접근성 기준).

## payload 수집 규칙

어댑터는 레코드가 아니라 평평한 `payload: dict`를 받는다. 그래야 같은 어댑터가
이력 기반 경로와 레거시 POST 경로 양쪽을 처리한다.

```
collect_payload(record) =
    { "input":  record.input_info,
      "result": record.result_info,
      "output": <result_info["output_json"] 을 읽은 JSON, 있으면> }
```

- `output_json` / `input_json` 로드는 **`_ALLOWED_DOWNLOAD_BASE` 프리픽스 검사를 통과한 경로만**
  허용한다(`analysis.py`의 다운로드 보안과 동일 규칙). 검사 실패 시 로드를 건너뛰고
  `result_info` 요약만으로 문서를 만든다.
- 파일이 유실됐으면 예외로 죽지 않고 근거 섹션에 "파일 없음"으로 남긴다.

## 레지스트리 확장 (새 레지스트리를 만들지 않는다)

`ProgramSpec`에 두 칸을 추가하고 `capabilities`에 `"report"`를 넣는다.

```python
report_adapter: str | None = None    # ADAPTERS 키 — 없으면 generic_adapter
report_template: str | None = None   # 양식 선택자 키 — 없으면 GenericRenderer
```

초기 등록:

| 대상 | 설정 | 효과 |
|---|---|---|
| `carling-free`, `carling-optimization` | `report_adapter="carling"`, `report_template="carling"` | `carling_report_service`가 TemplateRenderer로 흡수 |
| `truss-assessment` | `report_adapter="truss-assessment"` | `_json_to_xlsx_bytes` 로직이 어댑터로 이관 |
| 나머지 23개 | 미지정 | generic 어댑터 + 렌더러로 **코드 추가 없이 즉시 동작** |

Carling은 하중 타입(집중/분포)에 따라 템플릿이 갈리므로 `report_template`은 단일 파일명이 아니라
**payload를 받아 파일명을 고르는 선택자 키**로 둔다. 선택 로직 자체는 어댑터 모듈에 있다.

## 렌더러 2종

**GenericRenderer** — 표지 시트 + 섹션별 시트. `PRODUCT.md` 톤을 따른다:
Trust Blue(`#002554`) 헤더, 판정은 색 + 텍스트 + 기호 병기, 숫자는 우측 정렬·단위 별도 열.

**TemplateRenderer** — `.xlsm`을 openpyxl로 열어 값을 주입하고 `.xlsx` bytes로 반환한다.

- 템플릿 탐색 순서는 기존 carling과 동일: `env override > 사내 공유 스토리지 > 로컬`.
  공유 스토리지 사본은 DRM 미적용(평문 ZIP)이라 openpyxl로 열린다.
- **셀 매핑은 코드가 아니라 템플릿 옆 `<template>.map.json`에 둔다.** 양식이 바뀌어도
  백엔드 재배포 없이 매핑 파일만 교체하면 된다. 현재 carling은 매핑이 코드에 박혀 있어
  이 이관이 곧 개선이다.
- 매핑 파일이 없으면 기존 carling 하드코딩 매핑을 내장 기본값으로 사용한다(무중단 이관).

## API

| 메서드 | 경로 | 반환 |
|---|---|---|
| GET | `/api/reports/capabilities` | `program_id`별 `{ reportable, hasTemplate, displayName }` |
| POST | `/api/reports/generate` | XLSX bytes (본문: `{ analysis_id }`) |

- 권한: 본인 레코드 또는 관리자. 기존 `_access_control` 헬퍼 재사용.
- 감사: `log_activity(db, "EXPORT_REPORT", ...)`.
- 응답은 `Response(content=bytes, media_type=...)`를 쓴다. carling 라우터가 이미 이 형태이고,
  본문이 전부 메모리에 있으므로 스트리밍 이점이 없다.
- **생성이 POST인 이유**: `services/app_settings.py`의 App 가용성 게이트는 POST/PUT/PATCH/DELETE만
  검사한다. GET으로 두면 관리자가 이 App을 점검 중으로 내려도 화면만 막히고 API는 열린 채 남는다.
  프론트가 어차피 blob(`responseType: "blob"`)으로 받으므로 POST여도 다운로드 흐름은 동일하다.
- ⚠️ `GUARDED_ROUTES`에 `/api/reports`를 **반드시 등록**한다. CLAUDE.md에 적힌 대로
  미등록 경로는 fail-open이다.
- `capabilities`는 카탈로그 표시용 읽기 전용이라 GET으로 두고 게이트 대상에서 제외한다
  (진행 중 작업의 상태 폴링을 막지 않는다는 기존 게이트 원칙과 같은 취지).

## 프론트엔드

- `DashboardContext.jsx`의 `RAW_ANALYSIS_DATA`에 Productivity 항목 추가
  (`mode: "Productivity"`, `category: "Report"`, `icon: Wrench`, `color: "bg-amber-500"`,
  `devStatus: "Developing"`). File 모드가 아니므로 amber 시그니처를 따른다.
- `APP_REGISTRY_OVERRIDES` + `APP_CAPABILITY_METADATA` 등록
  (`inputFormats: ["해석 이력"]`, `outputFormats: ["XLSX"]`, `workflow: "Productivity"`).
- `App.jsx:renderPage()`에 case 추가.
- 화면: 좌측 = 해석 이력 목록(앱·기간 필터, "양식 있음" 배지, 리포트 불가 레코드는 비활성),
  우측 = 선택 레코드 요약 + [리포트 생성] 버튼.
- 카탈로그 실효값은 `useAppCatalogue()`로 읽는다(`ANALYSIS_DATA` 직접 import 금지).

## 에러 처리 — 조용한 대체를 금지한다

| 상황 | 처리 |
|---|---|
| 템플릿 부재·손상 | 범용 서식으로 폴백하되 **리포트 첫머리에 "표준 양식 미적용" 명시**. 결재자가 다른 문서를 받은 줄 모르게 두지 않는다 |
| 실패·미완료 레코드 | 400 — "완료된 해석만 리포트를 생성할 수 있습니다" |
| `result_info` 비어 있음 | 400 — 같은 메시지 |
| 근거 파일 유실 | passport의 status를 그대로 근거 섹션에 표기("파일 없음"). 숨기지 않는다 (설계원칙 1: 신뢰가 곧 기능) |
| 어댑터 예외 | generic_adapter로 폴백하고 그 사실을 문서에 남긴다 |

## 기존 엔드포인트 이행

`/api/analysis/export-xlsx`(Truss)와 `/api/carling/{free,optimization}/report`는 **제거하지 않고
새 엔진에 위임**한다. 프론트 변경 없이 사일로가 해소되고, 기존 출력과의 스냅샷 비교로 회귀를 잡을 수 있다.

Carling 경로는 `Analysis` 레코드가 아니라 클라이언트가 POST로 되돌려준 결과 dict를 받으므로,
`report_service`는 진입점을 둘로 노출한다.

```python
build_from_record(record) -> ReportDoc            # 신규 App 경로
build_from_payload(payload, meta) -> ReportDoc    # 레거시 POST 경로
```

정리 항목: `routers/carling.py:96`의 `_report_response` docstring이 "Excel COM 자동화"라고
설명하지만 실제 서비스는 openpyxl로 바뀌었다(`carling_report_service.py` 헤더 주석 참조).
이관하면서 문구를 바로잡는다.

## 테스트

- **어댑터** — 앱별 `result_info` 샘플 → `ReportDoc` 섹션 구조 단위 테스트. 최소 3종:
  파일 기반(Truss Assessment), 파라메트릭(Column Buckling), 양식 보유(Carling).
- **GenericRenderer** — 반환 bytes가 유효한 XLSX ZIP인지 + 표지·섹션 시트 존재 + 판정 셀 스팟 체크.
- **TemplateRenderer** — 매핑 JSON대로 셀에 값이 들어갔는지. 공유 스토리지 템플릿이 없는 환경에서는 skip.
- **payload 수집** — `userConnection` 밖 경로가 `output_json`에 들어 있을 때 로드를 건너뛰는지(보안 회귀).
- **회귀** — 기존 두 엔드포인트가 이관 전후 동일 bytes를 내는지 스냅샷 비교.
- 백엔드 테스트는 인메모리 SQLite + `app.dependency_overrides`(`tests/conftest.py`) 관례를 따른다.

## 배포

- 백엔드 코드는 git 추적 대상 → 운영 서버(145)는 `git pull` + 백엔드 재시작으로 끝난다.
  **InHouseProgram 수동 교체 대상 없음.**
- 단, 템플릿을 사내 공유 스토리지에서 읽으므로 운영 서버의 UNC 접근 가능 여부를 확인해야 한다.
  불가하면 carling이 쓰는 `CARLING_REPORT_DIR`과 같은 방식으로 env(`WORKBENCH_REPORT_TEMPLATE_DIR`)에
  로컬 경로를 지정하는 폴백을 쓴다.
- 프론트 변경이 있으므로 WorkBench 클라이언트 재배포 대상이다.

## 열린 항목 (후속)

- 각 앱 결과 화면의 [리포트] 버튼 — 같은 엔진 재사용.
- 앱별 `.xlsm` 결재 양식의 점진적 등록(우선순위: 호출 빈도가 높은 앱부터).
- 다건 묶음 리포트(같은 앱 케이스 비교 / 프로젝트 종합).
