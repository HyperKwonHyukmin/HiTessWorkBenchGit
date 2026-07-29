# 선별형 BDF Model Registry & Insight Data Storage Implementation Plan

> **For Claude Code / agentic workers:** 이 문서는 설계와 실행 계획을 함께 포함한다. Task를 순서대로 실행하고 각 Task의 검증을 통과한 뒤 다음 Task로 이동한다. 작업 시작 전에 `AGENTS.md`와 `CLAUDE.md`를 다시 읽고, 현재 dirty worktree의 사용자 변경을 보존한다. 자동 등록은 이 기능의 요구사항이 아니며 구현해서는 안 된다.

**Goal:** 사용자가 Model Builder 또는 Group & Module Unit 결과 중 가치 있다고 판단한 BDF만 명시적으로 선택해 Data Storage에 등록하고, 서버가 생성한 버전 있는 요약 JSON과 엔지니어 메타데이터를 축적하여 검색·비교·통계·품질 Insight와 향후 AI/ML 데이터셋으로 활용한다.

**Architecture:** React에서 사용자가 등록할 artifact를 고르고 요약 미리보기를 확인한다. FastAPI는 `source_analysis_id + artifact_kind`를 이용해 서버가 허용한 원본 경로를 해석하고 소유권을 검증한다. BDF는 기존 NastranBridge/검증 결과를 이용해 요약되며, 선택한 파일과 `summary.json`은 30일 정리 대상인 `userConnection` 밖의 `MODEL_REGISTRY_DIR`에 checksum과 함께 영구 보관된다. MySQL은 검색 가능한 scalar metadata, 전체 summary JSON, revision, artifact manifest와 ACL을 관리한다. Insight는 초기에는 DB 데이터를 읽는 순수 집계 서비스로 제공한다.

**Tech Stack:** FastAPI, SQLAlchemy, MySQL, Pydantic, React/Vite, 기존 NavigationContext, 기존 NastranBridge JSON/검증 schema, 사내 UNC 또는 로컬 Data Storage, pytest

**MVP 원칙:** “많이 모으기”보다 “사용자가 선별한 데이터를 같은 schema로 신뢰성 있게 쌓기”가 우선이다. Spark, Kafka, Iceberg, vector DB, embedding, GNN, 자동 추천은 MVP 범위가 아니다.

---

## 0. 확정된 제품 결정

### 0.1 등록 방식

- 등록은 **반드시 사용자의 명시적 선택과 확인**으로만 시작한다.
- 해석 완료, artifact 목록 새로고침, 페이지 진입을 자동 등록 트리거로 사용하지 않는다.
- 성공 모델만 강제하지 않는다. 사용자가 가치 있다고 판단한 실패·이상·수정 전 모델도 역할을 명시해 등록할 수 있다.
- 등록 모달을 열거나 미리보기 API를 호출한 것만으로는 Data Storage 또는 Registry DB를 변경하지 않는다.

### 0.2 저장 대상

- 모든 revision은 `summary.json`을 필수로 저장한다.
- 원본 BDF 보관은 기본 ON으로 제공하되 사용자가 끌 수 있다.
- F06/OP2/normalized model JSON/InputAudit/StageSummary는 artifact별 opt-in으로 제공한다.
- summary JSON에는 전체 node/element 배열을 중복 저장하지 않는다.
- 전체 normalized model JSON이 필요하면 별도 artifact로 저장한다.

### 0.3 품질과 설계 결과

다음 두 축은 분리해 저장하고 UI에서도 별도로 표시한다.

- `modelQuality`: 파싱, 연결성, 누락 참조, 요소 품질, solver health, 엔지니어 검토
- `analysisOutcome`: 허용응력 초과, 변위, Wire 압축, 안정성, 설계 pass/fail

응력 초과 또는 설계 fail은 자동으로 “나쁜 모델”을 의미하지 않는다. 실패 설계를 정확히 표현한 모델은 고품질 regression/failure example일 수 있다.

### 0.4 영구성

- `userConnection`은 30일 후 삭제되므로 Registry의 영구 저장 위치로 사용하지 않는다.
- 등록 API는 durable copy와 checksum 검증을 마치기 전 성공을 반환하지 않는다.
- Registry DB에는 클라이언트가 보낸 절대경로를 저장하지 않는다.
- Data Storage 내부 경로는 root 기준 상대경로로 저장한다.

### 0.5 권한

- MVP 기본 visibility는 `owner`다.
- 소유자와 관리자만 metadata를 변경하거나 archive할 수 있다.
- `department`와 `company` visibility는 DB/schema에는 열어 두되, 운영 정책이 확정되기 전에는 UI에서 비활성화해도 된다.
- 브라우저가 보낸 `registered_by`, `employee_id`, 원본 절대경로는 신뢰하지 않는다. 인증 세션과 Analysis 소유권에서 결정한다.

### 0.6 삭제 정책

- MVP에는 물리 삭제 API를 만들지 않는다.
- `active`/`archived` 상태만 제공한다.
- artifact 물리 삭제와 retention/backup 정책은 운영 정책 확정 후 별도 기능으로 만든다.

---

## Phase 0: Documentation Discovery — 완료된 근거

Claude Code는 구현 시작 시 아래 문서를 다시 읽고, 여기 명시된 API와 패턴만 사용한다.

### 0.1 반드시 읽을 문서

| 문서 | 사용할 근거 |
|---|---|
| `AGENTS.md` | WorkBench 아키텍처, 인증, NavigationContext, 분석 흐름 |
| `CLAUDE.md:74-136` | Model Builder/Module Unit 산출물과 버전·배포 규칙 |
| `PRODUCT.md:40-49` | 신뢰·정확성·상태표현 UX 원칙 |
| `docs/operations/file-retention-policy.md:7-21,68-87` | `userConnection` 30일 보존과 영구 보관 부재 |
| `docs/operations/audit-log-policy.md:3-7` | 의미 있는 business event만 감사 로그에 기록 |
| `docs/EXTERNAL_APP_DB_GUIDE.md:264-299` | transaction, owner/source scope, least privilege |
| `docs/superpowers/specs/2026-06-25-groupmoduleunit-result-downloads-design.md:12-51` | Module Unit artifact 종류와 parent Analysis 기반 조회 |
| `docs/superpowers/specs/2026-05-28-mooring-fitting-studio-phase1-design.md:90-105` | 기존 normalized NastranBridge model JSON |
| `docs/superpowers/specs/2026-05-21-admin-usage-reports-design.md:40-72,310-329` | 순수 집계 service + API + dashboard 패턴 |

### 0.2 Allowed backend APIs/patterns

- `require_auth(...) -> employee_id`: `HiTessWorkBenchBackEnd/app/dependencies.py:7-15`
- `require_admin(...)`: `HiTessWorkBenchBackEnd/app/dependencies.py:18-23`
- owner/admin 검사 패턴: `HiTessWorkBenchBackEnd/app/routers/_access_control.py`
- Analysis 소유권 조회: `HiTessWorkBenchBackEnd/app/routers/analysis.py:1548-1558`
- 페이지네이션 envelope: `HiTessWorkBenchBackEnd/app/routers/analysis.py:561-604`
- Module Unit artifact scan: `HiTessWorkBenchBackEnd/app/routers/analysis.py:2211-2248`
- BDF 품질 vocabulary: `transform_to_step1(...)` in `app/services/groupmoduleunit_service.py:71-263`
- Pydantic `ConfigDict(from_attributes=True)`: `app/schemas.py`
- DB bootstrap: `models.Base.metadata.create_all(...)` in `app/main.py`, 보수적 컬럼/인덱스 추가는 `app/schema_bootstrap.py`
- audit event: `log_activity(...)`와 `models.ActivityLog`
- UNC root 환경변수와 child confinement 참고: `app/routers/newsletters.py`

### 0.3 Allowed frontend APIs/components

- 페이지 lazy import와 `renderPage()` switch: `frontend/src/App.jsx:31-69,397-446`
- NavigationContext: `frontend/src/contexts/NavigationContext.jsx`
- Sidebar analysis group: `frontend/src/components/layout/Sidebar.jsx:46-53`
- 인증 헤더: `frontend/src/utils/auth.js:18-22`
- API base: `frontend/src/config.js`
- 공용 UI: `components/ui/Modal.jsx`, `Input.jsx`, `Button.jsx`, `Badge.jsx`, `KpiCard.jsx`, `FilterTabs.jsx`
- 목록/검색/페이지네이션: `pages/analysis/MyProjects.jsx:318-357,611-815`
- 통계 dashboard: `components/admin/AnalysisStatsDashboard.jsx:109-239`
- Model Builder 최종 BDF 선택: `pages/analysis/HiTessModelBuilder.jsx:2086-2117,2711-2721`
- Module Unit artifact 선택: `components/analysis/ResultArtifactsCard.jsx:18-29,43-58,136-158`

### 0.4 금지할 anti-pattern

- 임의의 브라우저 절대경로를 registration payload로 받아 파일을 복사하지 않는다.
- `/api/download?filepath=...`의 허용 root를 Data Storage까지 넓히지 않는다.
- Registry를 `Analysis.result_info` 안에 끼워 넣지 않는다.
- `userConnection`에 영구 Registry artifact를 쓰지 않는다.
- 브라우저에서 새로운 BDF parser/writer를 구현하지 않는다.
- registry 권한을 frontend에서만 숨기고 backend에서 검사하지 않는 방식을 쓰지 않는다.
- 검색 click과 filter 변경을 감사 로그로 남기지 않는다.
- 해석 성공 여부를 품질등급으로 직접 치환하지 않는다.
- 현재 규모에서 big-data infrastructure나 ML을 먼저 도입하지 않는다.

---

## 1. 사용자 흐름

### 1.1 Model Builder

1. 사용자가 Model Builder 결과의 Original BDF 또는 Edited BDF를 선택한다.
2. `Data Storage에 등록`을 누른다.
3. frontend가 `source_analysis_id + artifact_kind`로 preview API를 호출한다.
4. 등록 모달에 자동 추출 정보와 duplicate 경고를 표시한다.
5. 사용자가 제목, 역할, 용도, 태그, 설명, 신뢰도, 재사용 주의사항, visibility와 포함 artifact를 선택한다.
6. 사용자가 `등록`을 누른다.
7. backend가 source를 다시 해석하고 권한·파일·checksum을 다시 검증한 후 durable storage와 DB에 등록한다.
8. 완료 후 model UID와 Data Storage 상세보기 링크를 반환한다.

### 1.2 Group & Module Unit

1. `ResultArtifactsCard`에서 사용자가 `editedBdf` 또는 `liftingBdf`를 직접 선택한다.
2. 이후 흐름은 Model Builder와 동일하다.
3. `_edited.bdf`와 `_lifting.bdf`는 의미가 다르므로 artifact kind를 유지한다.
   - `module_unit_edited`: Studio 편집이 반영된 구조 모델
   - `module_unit_lifting`: Wire, 자세, 하중/경계조건이 반영되어 실제 해석된 모델

### 1.3 Data Storage

1. `Data Storage` 메뉴에서 등록 모델 목록을 검색·필터링한다.
2. 상세 화면에서 summary, quality, outcome, lineage, artifact, 등록자 메모를 본다.
3. Insight 탭에서 전체 분포와 품질 이슈를 확인한다.
4. 최대 2개 모델을 선택해 핵심 metric과 breakdown을 비교한다.

---

## 2. Storage layout

운영 경로는 코드에 하드코딩하지 않는다.

```text
MODEL_REGISTRY_DIR/
  .staging/
    <registration-uuid>/
  models/
    <model-uid>/
      rev-0001/
        summary.json
        manifest.json
        source.bdf                 # opt-in, 기본 ON
        normalized-model.json      # opt-in
        validation.json            # 존재 시 opt-in
        input-audit.json            # Model Builder opt-in
        stage-summary.json          # Model Builder opt-in
        analysis-result.json        # UnitStructural opt-in
        result.f06                  # opt-in
        result.op2                  # opt-in, 크기 경고
```

### 2.1 환경변수

```text
MODEL_REGISTRY_DIR=<운영 UNC 또는 로컬 절대경로>
MODEL_REGISTRY_MAX_PACKAGE_MB=500
```

개발 fallback:

```text
HiTessWorkBenchBackEnd/DataStorage/ModelRegistry
```

fallback도 `userConnection` 밖이어야 한다.

### 2.2 publish protocol

1. source Analysis와 owner/admin 권한 검사
2. allowlisted artifact kind를 서버에서 source path로 해석
3. source가 `userConnection` 하위인지 검사
4. 파일 존재, `.bdf`, 크기 제한 검사
5. source SHA-256 계산
6. duplicate 조회
7. summary 생성
8. `.staging/<uuid>`에 summary와 선택 artifact 작성
9. 작성된 BDF checksum 재검증
10. 동일 volume에서 `os.replace(staging, final_revision_dir)`로 publish
11. DB transaction commit
12. DB commit 실패 시 final dir 제거를 시도하고 orphan reconciliation 대상으로 기록

등록 성공은 11번 이후에만 반환한다.

---

## 3. DB domain model

Registry는 Analysis history와 별개의 domain이다.

### 3.1 `RegisteredModel`

| 필드 | 형식 | 설명 |
|---|---|---|
| `id` | Integer PK | 내부 키 |
| `model_uid` | String(36), unique/index | 외부에 노출하는 UUID |
| `title` | String(200) | 사용자 지정 제목 |
| `description` | Text | 모델 설명 |
| `model_type` | String(100), index | module-unit, beam-frame 등 |
| `model_role` | String(30), index | reference, notable, failure, before, after |
| `confidence` | String(20) | high, medium, review-required |
| `reuse_notes` | Text | 재사용 주의사항 |
| `visibility` | String(20), index | owner, department, company |
| `tags` | JSON | 문자열 배열 |
| `owner_id` | String(50), index | 접근권한 기준 |
| `registered_by` | String(50), index | 등록 작업 수행자 |
| `status` | String(20), index | active, archived |
| `created_at` | DateTime | 최초 등록 |
| `updated_at` | DateTime | metadata 갱신 |

### 3.2 `RegisteredModelRevision`

| 필드 | 형식 | 설명 |
|---|---|---|
| `id` | Integer PK | revision 내부 키 |
| `model_id` | FK/index | RegisteredModel |
| `revision_no` | Integer | model별 1부터 증가, unique(model_id, revision_no) |
| `schema_version` | String(20) | summary contract version |
| `source_analysis_id` | Integer, nullable/index | provenance. 강한 FK/cascade를 사용하지 않는다 |
| `source_program_name` | String(100), index | HiTessModelBuilder 등 |
| `source_artifact_kind` | String(50), index | 아래 allowlist |
| `bdf_sha256` | String(64), unique/index | exact duplicate 방지 |
| `storage_relative_path` | String(500) | Data Storage root 기준 revision dir |
| `summary_json` | JSON | 전체 요약 |
| `artifact_manifest` | JSON | artifact 목록 snapshot |
| `quality_level` | String(10), index | Q0~Q4 |
| `review_status` | String(30), index | unreviewed, approved, rejected |
| `design_outcome` | String(30), index | unknown, pass, fail, mixed |
| `node_count` | Integer, nullable | 자주 조회할 scalar |
| `element_count` | Integer, nullable | 자주 조회할 scalar |
| `total_mass_kg` | Float, nullable | 단위 명시 |
| `max_utilization` | Float, nullable | 존재하는 해석만 |
| `created_at` | DateTime | immutable revision 생성 시각 |

### 3.3 `RegisteredModelArtifact`

| 필드 | 형식 | 설명 |
|---|---|---|
| `id` | Integer PK | download API가 받는 유일한 식별자 |
| `revision_id` | FK/index | revision |
| `kind` | String(50), index | bdf, summary, validation, f06, op2 등 |
| `file_name` | String(255) | 표시용 basename |
| `relative_path` | String(500) | registry root 기준 |
| `size_bytes` | Integer | 크기 |
| `sha256` | String(64) | 무결성 |
| `media_type` | String(100) | 응답 Content-Type |
| `created_at` | DateTime | 생성 |

### 3.4 Revision 정책

- artifact 또는 자동 추출 summary가 바뀌면 새 revision이다.
- 제목, 태그, description, reuse note 변경은 model metadata 변경이며 새 revision을 만들지 않는다.
- 첫 MVP UI는 “새 모델 등록”만 제공해도 되지만 DB/API는 `target_model_uid`를 optional로 받아 기존 모델의 새 revision을 만들 수 있게 설계한다.
- exact same `bdf_sha256`는 신규 등록하지 않고 기존 `model_uid/revision_no`를 포함한 `409`를 반환한다.

---

## 4. Summary JSON contract v1

파일명: `summary.json`

```json
{
  "schemaVersion": "1.0",
  "model": {
    "modelUid": "UUID",
    "revision": 1,
    "title": "Module Unit 4-Point Lifting Model",
    "modelType": "module-unit",
    "modelRole": "reference",
    "description": "권상 구조해석 기준 모델",
    "tags": ["4-point-lifting", "beam-frame"],
    "confidence": "high",
    "reuseNotes": "COG 편심이 큰 모델에 재사용 시 재검토"
  },
  "provenance": {
    "registeredAt": "2026-07-27T15:30:00+09:00",
    "registeredBy": "A476854",
    "sourceAnalysisId": 127,
    "sourceProgramName": "GroupModuleUnit",
    "sourceArtifactKind": "module_unit_lifting",
    "bdfSha256": "64-hex",
    "engineVersions": {
      "modelBuilder": null,
      "nastranBridge": null,
      "nastran": null
    }
  },
  "units": {
    "length": "mm",
    "force": "N",
    "mass": "kg",
    "stress": "MPa"
  },
  "geometry": {
    "nodeCount": 1842,
    "elementCount": 2360,
    "rigidElementCount": 48,
    "pointMassCount": 12,
    "boundingBox": {
      "xMin": 0.0,
      "xMax": 18200.0,
      "yMin": -4700.0,
      "yMax": 4700.0,
      "zMin": 0.0,
      "zMax": 7800.0
    },
    "elementBreakdown": {
      "CBEAM": 2010,
      "CBAR": 302,
      "RBE2": 48
    },
    "propertyBreakdown": {},
    "materialBreakdown": {}
  },
  "physicalProperties": {
    "totalMassKg": 184200.0,
    "centerOfGravityMm": {
      "x": 120.0,
      "y": -85.0,
      "z": 3250.0
    }
  },
  "modelQuality": {
    "qualityLevel": "Q3",
    "reviewStatus": "unreviewed",
    "parseStatus": "pass",
    "totalErrors": 0,
    "totalWarnings": 3,
    "orphanNodeCount": 0,
    "isolatedNodeCount": 0,
    "zeroLengthElementCount": 0,
    "shortElementCount": 3,
    "disconnectedGroupCount": 0,
    "nastranFatal": false,
    "validationSchemaVersion": "1.2"
  },
  "analysisOutcome": {
    "outcome": "pass",
    "analysisType": "lifting",
    "safetyFactor": 1.3,
    "allowableStressMPa": 235.0,
    "maxStressMPa": 168.4,
    "maxUtilization": 0.717,
    "memberExceedCount": 0,
    "wireCompressionCount": 0
  },
  "artifacts": [
    {
      "kind": "bdf",
      "artifactId": 501,
      "fileName": "source.bdf",
      "sizeBytes": 1234567,
      "sha256": "64-hex"
    }
  ]
}
```

### 4.1 필수/nullable 규칙

- `schemaVersion`, model identity, provenance, units, BDF checksum, geometry counts, `modelQuality`는 필수다.
- mass/COG/result scalar는 소스에 없으면 `null`로 둔다. `0`으로 대체하지 않는다.
- unknown unit을 임의로 `mm/N/kg/MPa`로 추정하지 않는다. `units.confidence = "unknown"` 또는 preview warning을 사용한다.
- summary에 Data Storage 절대경로를 넣지 않는다.
- `registeredBy`는 일반 Insight export에서 기본 제외하거나 익명화한다.

### 4.2 품질등급

| 등급 | 의미 |
|---|---|
| Q0 | Raw: source와 checksum만 확보 |
| Q1 | Parse Valid: BDF 파싱과 기본 참조 검사 통과 |
| Q2 | Topology Valid: 치명 orphan/isolated/zero-length/disconnected 문제 없음 |
| Q3 | Solver Verified: Nastran/검증 실행에서 fatal 없음 |
| Q4 | Golden: 엔지니어가 용도와 한계를 검토하고 approved |

Q4는 자동으로 부여하지 않는다.

---

## 5. Source artifact allowlist

클라이언트는 `source_analysis_id`와 아래 enum만 전송한다. backend가 실제 source path를 해석한다.

| `artifact_kind` | 허용 program | 서버 해석 규칙 |
|---|---|---|
| `modelbuilder_final` | `HiTessModelBuilder` | `result_info.bdf_path` |
| `modelbuilder_edited` | `HiTessModelBuilder` | `result_info.output_dir` 아래 `edited/`를 기존 `detect_edited_artifacts()` 규칙으로 scan |
| `modelbuilder_solved` | `ModelBuilderAnalysis` | `result_info.bdf` |
| `groupmodule_original` | `GroupModuleUnit`, `SidePassage` | `input_info.bdf_model` |
| `module_unit_edited` | `GroupModuleUnit`, `SidePassage` | parent folder의 허용된 `_edited.bdf` |
| `module_unit_lifting` | `GroupModuleUnit`, `SidePassage` 또는 연결된 `UnitStructuralAnalysis` | parent artifact scan 또는 `result_info.liftingBdf` |

공통 조건:

- source Analysis는 현재 사용자 소유이거나 현재 사용자가 admin이어야 한다.
- source path는 정규화 후 `userConnection` 하위여야 한다.
- 확장자는 `.bdf`여야 한다.
- basename/scan 규칙을 통과해야 한다.
- source가 30일 정리로 사라졌으면 `409 SOURCE_EXPIRED`를 반환한다.
- `UnitStructuralAnalysis`는 실패 상태에서도 result artifact가 존재할 수 있으므로 `status == Success`만을 등록 조건으로 사용하지 않는다.

---

## 6. API contract

Base prefix: `/api/model-registry`

### 6.1 Preview — 상태 변경 없음

```http
POST /api/model-registry/preview
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "source_analysis_id": 127,
  "artifact_kind": "module_unit_lifting"
}
```

응답:

```json
{
  "source": {
    "analysis_id": 127,
    "program_name": "GroupModuleUnit",
    "artifact_kind": "module_unit_lifting",
    "file_name": "unit_lifting.bdf",
    "size_bytes": 1234567
  },
  "summary": {},
  "available_artifacts": [
    {"kind": "bdf", "default_selected": true},
    {"kind": "validation", "default_selected": true},
    {"kind": "f06", "default_selected": false},
    {"kind": "op2", "default_selected": false}
  ],
  "duplicate": null,
  "warnings": []
}
```

Preview 결과와 source path를 commit payload로 돌려받아 신뢰하지 않는다. Commit 시 재해석한다.

### 6.2 Register

```http
POST /api/model-registry/models

{
  "source_analysis_id": 127,
  "artifact_kind": "module_unit_lifting",
  "target_model_uid": null,
  "title": "Module Unit 4-Point Lifting Model",
  "description": "권상 기준 모델",
  "model_type": "module-unit",
  "model_role": "reference",
  "confidence": "high",
  "reuse_notes": "COG 편심 모델 적용 시 재검토",
  "visibility": "owner",
  "tags": ["4-point-lifting", "beam-frame"],
  "include_artifacts": ["bdf", "validation", "analysis-result"]
}
```

성공: `201 Created`

```json
{
  "model_uid": "UUID",
  "revision": 1,
  "quality_level": "Q3",
  "status": "active",
  "registered_at": "..."
}
```

주요 오류:

| HTTP | code | 의미 |
|---|---|---|
| 400 | `UNSUPPORTED_ARTIFACT_KIND` | program/artifact allowlist 불일치 |
| 403 | `SOURCE_FORBIDDEN` | 다른 사용자의 Analysis |
| 404 | `SOURCE_ANALYSIS_NOT_FOUND` | Analysis 없음 |
| 409 | `SOURCE_EXPIRED` | DB record는 있으나 파일이 삭제됨 |
| 409 | `EXACT_DUPLICATE` | 같은 SHA-256가 이미 등록됨 |
| 413 | `PACKAGE_TOO_LARGE` | opt-in artifact package 크기 제한 초과 |
| 422 | `BDF_SUMMARY_FAILED` | BDF 파싱/summary 생성 실패 |
| 503 | `REGISTRY_STORAGE_UNAVAILABLE` | UNC/Data Storage 쓰기 불가 |

### 6.3 Browse/detail/update

```http
GET /api/model-registry/models
  ?skip=0
  &limit=30
  &query=
  &source_program=
  &model_type=
  &model_role=
  &quality_level=
  &review_status=
  &design_outcome=
  &tag=
  &status=active
  &sort=created_desc

GET /api/model-registry/models/{model_uid}
PATCH /api/model-registry/models/{model_uid}
POST /api/model-registry/models/{model_uid}/archive
```

PATCH 허용 field:

- title
- description
- model_type
- model_role
- confidence
- reuse_notes
- visibility
- tags
- review_status

`quality_level=Q4`는 `review_status=approved`일 때만 owner/admin의 명시적 review action으로 설정한다.

### 6.4 Artifact download

```http
GET /api/model-registry/artifacts/{artifact_id}/download
```

- artifact ID로 DB record를 조회한다.
- revision → model ACL을 검사한다.
- DB의 relative path만 사용한다.
- normalize 후 `MODEL_REGISTRY_DIR` commonpath 검사를 수행한다.
- 브라우저 query의 filepath를 받지 않는다.

### 6.5 Insight

```http
GET /api/model-registry/insights/overview
GET /api/model-registry/export.json
```

overview MVP:

- total models/revisions
- active/golden/review-needed count
- source program 분포
- model type/role/quality/outcome 분포
- node/element/mass/utilization 기술통계
- orphan/isolated/zero-length/disconnected issue 빈도
- top tags
- quality × outcome cross-tab
- 최근 등록 추이

Insight export는 현재 사용자가 볼 수 있는 model만 포함한다.

---

## 7. Planned file structure

### Backend create

```text
HiTessWorkBenchBackEnd/app/routers/model_registry.py
HiTessWorkBenchBackEnd/app/services/model_registry_service.py
HiTessWorkBenchBackEnd/app/services/model_registry_storage.py
HiTessWorkBenchBackEnd/app/services/model_summary_service.py
HiTessWorkBenchBackEnd/app/services/model_insight_service.py
HiTessWorkBenchBackEnd/app/model_registry_schemas.py
HiTessWorkBenchBackEnd/tests/test_model_registry_source_resolver.py
HiTessWorkBenchBackEnd/tests/test_model_summary_service.py
HiTessWorkBenchBackEnd/tests/test_model_registry_storage.py
HiTessWorkBenchBackEnd/tests/test_model_registry_api.py
HiTessWorkBenchBackEnd/tests/test_model_insight_service.py
```

### Backend modify

```text
HiTessWorkBenchBackEnd/app/models.py
HiTessWorkBenchBackEnd/app/schema_bootstrap.py        # 필요한 index/constraint만
HiTessWorkBenchBackEnd/app/main.py                    # router 등록
```

### Frontend create

```text
HiTessWorkBench/frontend/src/api/modelRegistry.js
HiTessWorkBench/frontend/src/pages/analysis/ModelRegistry.jsx
HiTessWorkBench/frontend/src/components/modelRegistry/ModelRegistrationModal.jsx
HiTessWorkBench/frontend/src/components/modelRegistry/ModelRegistryTable.jsx
HiTessWorkBench/frontend/src/components/modelRegistry/ModelDetailModal.jsx
HiTessWorkBench/frontend/src/components/modelRegistry/ModelInsightDashboard.jsx
HiTessWorkBench/frontend/src/components/modelRegistry/modelRegistryUtils.js
HiTessWorkBench/frontend/src/components/modelRegistry/modelRegistryUtils.test.js
```

### Frontend modify

```text
HiTessWorkBench/frontend/src/App.jsx
HiTessWorkBench/frontend/src/components/layout/Sidebar.jsx
HiTessWorkBench/frontend/src/pages/analysis/HiTessModelBuilder.jsx
HiTessWorkBench/frontend/src/components/analysis/ResultArtifactsCard.jsx
```

`HiTessModelBuilder.jsx`, `GroupModuleUnitLiftingAnalysis.jsx`, backend `analysis.py` 등은 현재 worktree에 사용자 변경이 있을 수 있다. 구현 전 `git diff -- <file>`로 확인하고, 넓은 rewrite 대신 targeted patch를 사용한다. 이 계획은 `GroupModuleUnitLiftingAnalysis.jsx`를 직접 수정하지 않고 `ResultArtifactsCard` 내부에 generic registration action을 넣는 것을 우선한다.

---

## Phase 1: Backend foundation

## Task 1: Registry DB model과 schema contract

**What to implement**

- `models.py`에 `RegisteredModel`, `RegisteredModelRevision`, `RegisteredModelArtifact`를 추가한다.
- `model_registry_schemas.py`에 enum, request, response schema를 만든다.
- create_all로 신규 table이 생성되는 현재 패턴을 따른다.
- 필요한 unique/index가 create_all 이후 운영 DB에서 보강되어야 하면 `schema_bootstrap.py`의 보수적 패턴을 복사한다.

**Documentation references**

- `app/models.py:78-94`의 Analysis JSON/timestamp 스타일
- `app/schemas.py`의 `ConfigDict(from_attributes=True)`
- `app/schema_bootstrap.py:8-27,139-146`
- `tests/conftest.py:16-55`의 in-memory SQLite fixture

**Steps**

- [ ] 실패하는 model/schema test를 작성한다.
- [ ] 세 table과 constraint를 추가한다.
- [ ] Pydantic v2 request/response schema를 추가한다.
- [ ] enum validation, tag normalization, revision uniqueness test를 통과시킨다.

**Verification**

```powershell
cd HiTessWorkBenchBackEnd
WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_registry_api.py -k "schema or model" -v
WorkBenchEnv\Scripts\python.exe -m py_compile app/models.py app/model_registry_schemas.py
```

**Anti-pattern guards**

- Analysis table에 registry field를 추가하지 않는다.
- DB에서만 표현 가능한 hard FK cascade로 Analysis history 삭제가 Registry를 지우게 만들지 않는다.
- mutable default list/dict를 Pydantic/SQLAlchemy 객체 사이에 공유하지 않는다.

---

## Task 2: Server-side source resolver

**What to implement**

- `source_analysis_id + artifact_kind`를 allowlist에 따라 실제 BDF로 해석하는 pure/service layer를 만든다.
- current user와 source Analysis owner/admin을 검증한다.
- 모든 path를 userConnection root 안으로 제한한다.
- Model Builder edited artifact는 기존 `detect_edited_artifacts()`의 scan 규칙을 재사용한다.
- Module Unit artifact는 기존 GMU artifact scan 규칙을 공통 helper로 추출하거나 동일 helper를 호출한다.

**Documentation references**

- `app/routers/_access_control.py`
- `app/routers/analysis.py:1548-1558,2211-2248`
- `app/services/hitess_modelflow_service.py:259-300`
- `app/services/groupmoduleunit_service.py:746-757`
- `app/services/unit_structural_service.py:247-259`
- `tests/test_analysis_access_control.py:22-54`
- `app/services/test_lifting_artifacts.py`

**Steps**

- [ ] program/artifact allowlist parameterized tests를 작성한다.
- [ ] owner, other user, admin 접근 test를 작성한다.
- [ ] expired/missing, path traversal, wrong extension test를 작성한다.
- [ ] source resolver를 구현한다.

**Verification**

```powershell
WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_registry_source_resolver.py -v
```

**Anti-pattern guards**

- request에 `source_path`, `output_dir`, `bdf_path`를 받지 않는다.
- folder 이름만 보고 Registry 소유자를 추론하지 않는다.
- `os.path.startswith()` 문자열 비교로 path containment를 검사하지 않는다. `os.path.commonpath()` 의미를 사용한다.

---

## Task 3: Summary extraction

**What to implement**

- 기존 NastranBridge normalized JSON과 `transform_to_step1()`의 quality vocabulary를 사용하는 `model_summary_service.py`를 만든다.
- geometry/card/quality scalar를 v1 summary contract로 매핑한다.
- Model Builder의 InputAudit/StageSummary와 Module Unit validation/UnitStructural result가 존재하면 결과를 merge한다.
- unit confidence를 명시한다.
- model quality와 analysis outcome을 별도 객체로 만든다.

**Documentation references**

- `app/services/groupmoduleunit_service.py:71-263`
- `docs/superpowers/specs/2026-05-28-mooring-fitting-studio-phase1-design.md:90-105`
- `docs/ModelBuilder_Guide.md:226`
- `app/services/unit_structural_service.py:242-271`

**Steps**

- [ ] 최소 BDF fixture와 existing validation JSON fixture를 준비한다.
- [ ] `null` vs `0`, unit unknown, quality/outcome separation test를 먼저 작성한다.
- [ ] pure mapping 함수를 구현한다.
- [ ] NastranBridge invocation/normalized JSON reuse adapter를 구현한다.
- [ ] summary schema snapshot test를 추가한다.

**Verification**

```powershell
WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_summary_service.py -v
```

**Anti-pattern guards**

- `transform_to_step1()`과 다른 orphan/isolated 정의를 새로 만들지 않는다.
- result가 없는 값을 `0`으로 채우지 않는다.
- frontend BDF parsing 결과를 authoritative summary로 사용하지 않는다.
- Q4를 자동 부여하지 않는다.

---

## Task 4: Atomic Data Storage publisher

**What to implement**

- `MODEL_REGISTRY_DIR`와 package size 설정을 읽는다.
- staging write, checksum, atomic publish, cleanup/reconciliation을 구현한다.
- root-relative artifact manifest를 생성한다.
- storage unavailable, partial copy, checksum mismatch를 명시적 domain error로 만든다.

**Documentation references**

- `app/routers/newsletters.py:29-42,90,181`
- `app/routers/_intake.py:52`의 basename/size/extension 방어
- `docs/operations/file-retention-policy.md`

**Steps**

- [ ] temp registry root를 이용하는 storage unit test를 작성한다.
- [ ] checksum mismatch와 injected copy failure test를 작성한다.
- [ ] Data Storage root confinement test를 작성한다.
- [ ] publisher와 cleanup을 구현한다.

**Verification**

```powershell
WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_registry_storage.py -v
```

**Anti-pattern guards**

- staging을 다른 volume의 temp directory에 두고 atomic rename을 가정하지 않는다.
- publish 전 DB에 active registration을 노출하지 않는다.
- absolute UNC path를 API response/summary에 노출하지 않는다.
- generic `/api/download` root를 수정하지 않는다.

---

## Task 5: Registry service와 API

**What to implement**

- preview, register, list, detail, metadata patch, archive, artifact download API를 추가한다.
- register는 source를 다시 resolve하고 summary를 다시 계산한다.
- storage publish와 DB commit 사이 실패를 보상한다.
- duplicate SHA race를 DB unique constraint로 최종 방어한다.
- business-significant event만 ActivityLog에 기록한다.

**Documentation references**

- `app/routers/analysis.py:561-604` pagination
- `app/dependencies.py`
- `app/routers/_crud_helpers.py`의 404/update field allowlist 패턴
- `docs/operations/audit-log-policy.md`
- `tests/test_app_community.py`의 authenticated author spoof 방지

**Steps**

- [ ] preview가 DB/storage를 변경하지 않는 test를 작성한다.
- [ ] happy path registration test를 작성한다.
- [ ] exact duplicate, owner/admin, expired, storage failure, DB failure test를 작성한다.
- [ ] list/filter/pagination와 visibility test를 작성한다.
- [ ] artifact-ID download traversal test를 작성한다.
- [ ] router를 `main.py`에 등록한다.

**Verification**

```powershell
WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_registry_api.py -v
WorkBenchEnv\Scripts\python.exe -m py_compile app/routers/model_registry.py app/services/model_registry_service.py
```

**Anti-pattern guards**

- preview token을 인메모리 진실원으로 만들지 않는다.
- request의 `registered_by`를 저장하지 않는다.
- source Analysis success만 등록 허용 조건으로 사용하지 않는다.
- 검색 query를 string-built SQL로 만들지 않는다.

---

## Phase 2: Explicit registration UI

## Task 6: Frontend API와 registration modal

**What to implement**

- `api/modelRegistry.js`를 만들고 모든 request에 `getAuthHeaders()`를 사용한다.
- 등록 modal은 preview와 commit을 명확히 분리한다.
- source 정보는 read-only, 엔지니어 annotation은 editable로 표시한다.
- preview warnings, duplicate, package size와 artifact opt-in을 표시한다.

**Documentation references**

- `frontend/src/api/analysis.js:18-33,168-186`
- `components/ui/Modal.jsx`, `Input.jsx`, `Button.jsx`, `Badge.jsx`
- `components/modals/AssessmentProjectModal.jsx:90-100`
- `AuthContext.jsx:82`, `utils/auth.js:18-22`

**Steps**

- [ ] payload/tag/filter pure helper test를 Node built-in test로 작성한다.
- [ ] `modelRegistry.js` API helper를 추가한다.
- [ ] `ModelRegistrationModal`을 공용 UI primitives로 구현한다.
- [ ] preview/commit loading, error, duplicate state를 구현한다.
- [ ] 성공 시 toast와 Data Storage 이동 action을 제공한다.

**Verification**

```powershell
cd HiTessWorkBench/frontend
node --test src/components/modelRegistry/modelRegistryUtils.test.js
npm run build
```

**Anti-pattern guards**

- modal open 시 commit하지 않는다.
- `localStorage.user`를 직접 읽지 않는다.
- registry API에 unauthenticated `fetch`를 사용하지 않는다.
- 브라우저에서 BDF를 authoritative하게 재파싱하지 않는다.

---

## Task 7: Model Builder와 Module Unit 선택 지점 연결

**What to implement**

- Model Builder `NastranPanel`에서 original/edited BDF 각각에 명시적인 등록 action을 추가한다.
- source `Analysis.id`를 frontend state에 명시적으로 보존하도록 backend job result와 `applyJobResult()` 계약을 확인한다.
- `ResultArtifactsCard`의 `editedBdf`와 `liftingBdf`에 별도 등록 action을 추가한다.
- artifact 선택을 generic modal source descriptor로 변환한다.

**Documentation references**

- `HiTessModelBuilder.jsx:2086-2117,2711-2721,3309-3324`
- `GroupModuleUnitLiftingAnalysis.jsx:376-403,1055-1059`
- `ResultArtifactsCard.jsx:18-29,43-58,136-158`

**Steps**

- [ ] 현재 dirty diff를 먼저 읽고 사용자 변경과 충돌하지 않는 targeted patch 위치를 확인한다.
- [ ] Model Builder source analysis ID가 없는 현재 gap을 backend response에서 해결한다.
- [ ] original/edited registration buttons를 연결한다.
- [ ] GMU artifact별 registration buttons를 연결한다.
- [ ] 실패 모델도 parseable BDF가 있으면 등록 modal을 열 수 있는지 확인한다.

**Verification**

- [ ] Model Builder original 선택이 `modelbuilder_final`로 preview되는지 확인
- [ ] Model Builder edited 선택이 `modelbuilder_edited`로 preview되는지 확인
- [ ] Module Unit edited/lifting이 서로 다른 artifact kind로 preview되는지 확인
- [ ] job 완료나 artifact refresh만으로 registry POST가 호출되지 않는지 Network panel로 확인
- [ ] `npm run build`

**Anti-pattern guards**

- `analysisResult`의 현재 dormant state를 registration source로 사용하지 않는다.
- source absolute path를 modal commit payload로 보내지 않는다.
- 한 버튼이 edited와 lifting을 암묵적으로 선택하게 하지 않는다.
- 관련 Studio/engine 코드를 수정하지 않는다.

**Module Unit release guard**

Task 7 실행 전에 `CLAUDE.md:127-136`의 Module Unit 버전 정책을 다시 읽는다. WorkBench의 Module Unit 관련 변경도 해당 정책 범위로 판단되면 `module-unit-studio` version bump, package, StudioProgram 2곳 배포, `MODULE_STUDIO_VERSION` 동기화를 함께 수행한다. 정책을 임의로 생략하지 않는다.

---

## Task 8: Data Storage page

**What to implement**

- `Data Storage`를 Sidebar의 Analysis 그룹에서 `My Projects` 인접 메뉴로 추가한다.
- `App.jsx` lazy import/switch에 `ModelRegistry`를 등록한다.
- 페이지 탭은 `등록 모델`과 `Insight` 두 개로 제한한다.
- 등록 모델 탭은 server-side search/filter/pagination을 사용한다.
- detail modal에서 summary, quality, outcome, artifacts, provenance와 annotation을 보여준다.

**Documentation references**

- `App.jsx:31-75,397-446`
- `Sidebar.jsx:46-53`
- `NavigationContext.jsx:16-27`
- `MyProjects.jsx:318-357,611-815`
- `PageHeader`, `FeedbackState`, `KpiCard`, `Badge`

**Steps**

- [ ] navigation wiring을 추가한다.
- [ ] list/table/filter/pagination을 구현한다.
- [ ] detail modal과 artifact download를 구현한다.
- [ ] quality와 outcome을 별도 section으로 표시한다.
- [ ] loading/error/empty state를 구현한다.
- [ ] archived filter와 owner visibility를 검증한다.

**Verification**

```powershell
cd HiTessWorkBench/frontend
npm run build
```

수동 확인:

- [ ] Alt+Left/Alt+Right NavigationContext history에서 정상 이동
- [ ] 검색/필터가 server query param으로 전달
- [ ] 접근권한 없는 model UID 직접 요청이 403/404
- [ ] pass/warn/fail을 색상뿐 아니라 text/icon으로 표시

**Anti-pattern guards**

- React Router를 추가하지 않는다.
- 모든 등록 모델을 내려받아 client-side filter하지 않는다.
- fabricated Analysis object로 `BdfViewerModal`을 억지 재사용하지 않는다.
- 단일 거대 component에 table/detail/insight/modal을 모두 넣지 않는다.

---

## Phase 3: Insight

## Task 9: Pure insight aggregation service

**What to implement**

- 현재 사용자가 볼 수 있는 registry revision만 입력으로 받는 pure aggregation 함수를 만든다.
- 기술통계, 분포, quality issue 빈도, quality×outcome cross-tab과 top tags를 계산한다.
- scalar column을 우선 사용하고 상세 breakdown만 summary JSON에서 읽는다.
- data count가 부족한 metric은 `null`과 표본 수를 반환한다.

**Documentation references**

- `docs/superpowers/specs/2026-05-21-admin-usage-reports-design.md:40-72,310-329`
- `app/services/activity_service.py`와 usage report의 pure aggregation 패턴

**Steps**

- [ ] empty/one/missing/mixed-unit fixture test를 작성한다.
- [ ] pure aggregation을 구현한다.
- [ ] visibility-filtered API를 구현한다.
- [ ] export JSON에서 PII를 기본 제외한다.

**Verification**

```powershell
WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_insight_service.py -v
```

**Anti-pattern guards**

- 표본이 없는 평균을 0으로 반환하지 않는다.
- 다른 unit을 그대로 합산하지 않는다.
- correlation을 인과관계로 표현하지 않는다.
- registered_by/owner_id를 기본 Insight export에 노출하지 않는다.

---

## Task 10: Insight dashboard와 비교

**What to implement**

- KPI, source/model role/quality/outcome 분포, quality issue, top tag와 최근 등록 추이를 표시한다.
- 두 model revision을 선택해 geometry/physical/quality/outcome/breakdown을 비교한다.
- 차이는 절대값과 비율을 함께 제공하되 nullable과 unit mismatch를 표시한다.

**Documentation references**

- `components/admin/AnalysisStatsDashboard.jsx:19-60,109-239`
- `components/ui/KpiCard.jsx:26-43`
- `PRODUCT.md:40-49`

**Steps**

- [ ] overview API를 dashboard에 연결한다.
- [ ] 표본 수와 unit을 chart/table에 표시한다.
- [ ] 최대 2개 선택 비교 UI를 구현한다.
- [ ] missing result와 mixed unit state를 구현한다.

**Verification**

- [ ] 0개, 1개, 다수 model 상태 확인
- [ ] quality와 outcome chart가 분리되어 있는지 확인
- [ ] chart와 table이 같은 집계값을 보여주는지 확인
- [ ] `npm run build`

**Anti-pattern guards**

- “AI Insight”라는 이름으로 단순 평균을 과장하지 않는다.
- 표본 수를 숨기지 않는다.
- Q4와 design pass를 동일한 KPI로 합치지 않는다.

---

## Phase 4: Final verification and operations

## Task 11: End-to-end failure matrix

다음 시나리오를 하나씩 실행하고 결과를 문서화한다.

| 시나리오 | 기대 결과 |
|---|---|
| 본인 Model Builder final 등록 | 201, summary/BDF/checksum/DB 일치 |
| 본인 Model Builder edited 등록 | edited artifact kind 유지 |
| 본인 Module Unit edited 등록 | edited summary 등록 |
| 본인 Module Unit lifting 등록 | lifting outcome 포함 |
| 다른 사용자 Analysis 등록 시도 | 403 |
| admin이 다른 사용자 source 등록 | 정책에 따라 허용, owner 명시 |
| 동일 BDF 재등록 | 409 + 기존 UID/revision |
| 30일 삭제된 source | 409 SOURCE_EXPIRED |
| UNC/Data Storage unavailable | 503, active DB row 없음 |
| DB commit 실패 | published artifact cleanup 또는 reconciliation 기록 |
| artifact ID traversal 시도 | 불가능/403/404 |
| summary-only 등록 | BDF artifact 없음, summary 검색 가능 |
| 실패/FATAL 모델 등록 | quality/outcome 분리, 등록 가능 |
| archive | 목록 기본 제외, artifact 보존 |

### Backend verification

```powershell
cd HiTessWorkBenchBackEnd
WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_registry_source_resolver.py tests/test_model_summary_service.py tests/test_model_registry_storage.py tests/test_model_registry_api.py tests/test_model_insight_service.py -v
WorkBenchEnv\Scripts\python.exe -m py_compile app/routers/model_registry.py app/services/model_registry_service.py app/services/model_registry_storage.py app/services/model_summary_service.py app/services/model_insight_service.py
```

### Frontend verification

```powershell
cd HiTessWorkBench/frontend
node --test src/components/modelRegistry/modelRegistryUtils.test.js
npm run build
```

### Desktop smoke

```powershell
cd HiTessWorkBench
npm run dev
```

### Anti-pattern grep

등록 관련 frontend/backend에서 아래가 없는지 확인한다.

```powershell
rg -n "source_path|bdf_path.*Form|filepath=.*model-registry|auto.*register|register.*job.*complete" HiTessWorkBench/frontend/src HiTessWorkBenchBackEnd/app
```

검색 결과는 문맥을 읽고 판단한다. 기존 분석 API의 정상적인 `bdf_path`까지 기계적으로 제거하지 않는다.

---

## 8. MVP acceptance criteria

- [ ] 등록은 사용자가 artifact별 `Data Storage에 등록`을 누르고 확인해야만 발생한다.
- [ ] registration API는 absolute path를 받지 않는다.
- [ ] owner/admin이 아닌 사용자는 source 또는 registered model에 접근할 수 없다.
- [ ] 모든 등록 revision에는 `summary.json`, `manifest.json`, BDF SHA-256와 schema version이 있다.
- [ ] Data Storage는 `userConnection` 밖에 있고 30일 cleanup 후에도 등록 artifact가 남는다.
- [ ] exact duplicate는 중복 row/file을 만들지 않는다.
- [ ] 모델 품질과 설계 결과가 schema/UI/Insight에서 분리된다.
- [ ] failure/regression example도 역할을 지정해 등록할 수 있다.
- [ ] Data Storage 목록은 server pagination/filter를 사용한다.
- [ ] Insight는 표본 수, nullable, unit을 정직하게 표시한다.
- [ ] 물리 삭제가 없고 archive만 제공된다.
- [ ] backend pytest와 frontend build가 통과한다.
- [ ] 기존 Model Builder/Module Unit 실행·다운로드 흐름에 회귀가 없다.

---

## 9. MVP 이후 확장 순서

다음은 MVP 데이터를 실제로 사용해 본 후 별도 계획으로 진행한다.

### Stage A — 유사 모델 검색

- log(node/element/mass/bbox), element 비율, quality count를 표준화한 feature vector
- missing-value mask 포함
- nearest neighbor 결과와 각 feature 차이를 설명
- embedding/vector DB 없이 SQL 후보 축소 + Python distance로 시작

### Stage B — Regression benchmark

- Q4/approved revision을 engine version별로 재실행
- node/element/mass/COG/quality/outcome 차이 비교
- Model Builder/NastranBridge 변경의 회귀 검출

### Stage C — 통계·추천

- 최소 표본 수와 동일 분석조건을 만족하는 cohort에서만 관계 분석
- 권상점·COG 편심·Wire compression·utilization 패턴
- rule-based suggestion부터 시작하고 engineer override를 기록

### Stage D — ML/Surrogate

- 동일한 model family와 일관된 load/BC/result label이 충분할 때 별도 feasibility 평가
- train/validation/test를 revision이 아닌 logical model 단위로 분리해 leakage 방지
- 기존 9개 수준의 full lifting result로는 시작하지 않는다

---

## 10. 운영 전에 확정할 항목

아래 값은 코드 기본값으로 숨기지 말고 운영 담당자와 명시적으로 확정한다.

1. 운영 `MODEL_REGISTRY_DIR` UNC 경로와 service account 권한
2. Data Storage backup/restore와 용량 quota
3. 최대 package 크기 및 OP2/F06 기본 포함 정책
4. owner/department/company visibility 실제 정책
5. admin 등록 시 `owner_id` 결정 방식
6. archive retention과 물리 삭제 승인 절차
7. `_edited.bdf`와 `_lifting.bdf` 중 앱별 기본 추천 artifact
8. Q4 승인 권한이 등록자, 담당 엔지니어, 관리자 중 누구에게 있는지
9. 회사/프로젝트 민감정보가 BDF comment·파일명에 포함될 때 sanitization 정책
10. Registry export의 PII와 프로젝트명 익명화 정책

권장 MVP 기본값:

- visibility: `owner`
- include BDF: ON
- include validation/summary: ON
- include F06/OP2: OFF
- physical delete: 없음
- Q4 승인: 관리자 또는 별도 승인 권한자
- Data Storage unavailable: 등록 실패, 임시 “성공” 처리 금지

---

## 11. Worktree and delivery guard

- 현재 repository에는 사용자 변경이 존재할 수 있다.
- 구현자는 `git status --short`와 대상 파일별 `git diff`를 먼저 확인한다.
- unrelated 변경을 reset, checkout, format-all, bulk rewrite하지 않는다.
- `HiTessModelBuilder.jsx`와 Module Unit 관련 파일은 특히 targeted patch를 사용한다.
- Module Unit 관련 변경은 `CLAUDE.md`의 version pin/package/deploy 정책을 반드시 재확인한다.
- 각 Phase 종료 시 테스트 결과와 변경 파일을 보고하고 다음 Phase로 넘어간다.
