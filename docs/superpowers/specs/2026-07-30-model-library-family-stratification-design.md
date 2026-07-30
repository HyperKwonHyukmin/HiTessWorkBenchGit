# Model Library — 모델 계열(family) 분류와 통계 층화

> 작성: 2026-07-30
> 관련: `docs/apps/model-library.md`(사용법), `docs/operations/model-library-architecture-review.md`(아키텍처),
> `docs/operations/model-registry-ml-roadmap.md`(ML)

## 1. 문제

Model Library 는 성질이 완전히 다른 모델(Module Unit, Side Passage, 향후 Truss)을 **한 뭉치로 집계**한다.
그 결과 Insight 의 숫자 상당수가 어떤 질문에도 답하지 못한다.

확인된 결함 3건:

1. **기술통계 무의미** — `model_insight_service.aggregate_registry_insights()` 의
   `metrics.nodeCount / elementCount / maxUtilization / modelSpan`, `qualityIssues.share`,
   `qualityByOutcome` 이 전체 revision 평면 리스트에서 계산된다. 계열이 섞이면 평균·분포가
   해석 불가능한 값이 된다.
2. **데이터셋 준비도가 오해를 유발** — `build_dataset_readiness()` 는 `outcome-classifier`
   최소 표본 200건을 **계열 무관 합산**으로 센다. 계열 3종이 섞인 200건은 계열별 ~67건이며,
   그 상태로 학습하면 계열을 맞히는 모델이 된다. 게다가 이 결함은 프로젝트가 스스로 세운 원칙과
   충돌한다 — `model_feature_service` 모듈 docstring: *"이종 스키마 revision 을 한 칸에 세고 있었다.
   없는 것과 못 뽑은 것은 다르다."* **계열 이종성은 같은 오류의 한 층 위 버전이다.**
   현재 `caveats` 는 단위 미선언·해석 미수행·revision 중복만 다루고 계열 혼재는 다루지 않는다.
3. **분류 그릇이 비어 있다** — `model_type` 컬럼(`models.py:255`, index 있음)과 목록 API 필터
   (`model_registry.py:401`)는 이미 있으나, ① 등록 모달이 **자유 입력**이고 ② 자동 채움이 없고
   ③ 프론트에 필터 UI 가 없다(`ModelLibrary.jsx:91` 이 `modelType` 을 넘기지 않는다).
   결과적으로 값이 대부분 비어 목록에 `종류 미지정` 으로 표시된다.

## 2. 범위

**포함** — 계열 어휘 확정, 등록 시 자동 파생·통제 어휘 입력, 목록 필터/배지, **Insight 계열별 층화**
(지표·품질이슈·교차표·데이터셋 준비도).

**제외** — 유사 모델 검색의 계열 게이트, 계열별 저장소/테이블/메뉴 분리, `RegisteredAnalysisRun`
도입(별건, 아키텍처 검토 §1.5).

## 3. 핵심 설계 결정

### 3.1 새 컬럼을 만들지 않고 `model_type` 을 '계열'로 승격한다

`model_type` 은 이미 5곳에 배선돼 있다 — DB 인덱스, 목록 API 필터, `distributions.modelType`,
`FeatureSpec("model_type")`, 검색 `Dimension("modelType")`. 신규 `model_family` 컬럼을 만들면
**이 배선을 전부 두 번 구현**해야 하고, 사용자에게는 "종류와 계열의 차이"라는 설명 부채가 남는다.

세부 구분(예: 4점 권상, 2단 데크)은 **태그**로 간다 — 정규화 로직(`normalize_tags`)이 이미 있다.

**결과: DB 스키마 변경 없음. `schema_bootstrap` 불필요.**

### 3.2 계열 ≠ 해석 목적. 한 필드에 섞지 않는다

`module_unit_edited`(편집 구조 모델)와 `module_unit_lifting`(와이어·하중 반영 해석 모델)의 차이는
*구조가 무엇인지*가 아니라 *어떤 해석인지*다. 후자는 이미 설계된 `RegisteredAnalysisRun.run_kind`
의 몫이다. 계열 어휘에 `module-unit-lifting` 같은 값을 넣기 시작하면 두 축이 엉켜 되돌릴 수 없다.

### 3.3 쓰기는 엄격, 읽기는 관용

- 쓰기(`RegisterRequest` / `ModelPatchRequest`): `model_type` 을 **enum 타입**으로 바꾼다.
  어휘 밖 값은 pydantic 이 **422** 로 거절한다. 이는 `model_role`(`Optional[ModelRole]`),
  `confidence`(`Optional[Confidence]`), `visibility` 가 이미 쓰는 패턴과 동일하다.
  (커스텀 400 코드를 새로 만들지 않는다 — 기존 검증 패턴을 따르는 것이 일관적이다.)
- 읽기(`ModelListItem` / `ModelResponse` / 각종 dict): **`str` 타입을 유지한다.**
  enum 으로 바꾸면 어휘 밖 레거시 값이 직렬화 단계에서 터진다. 모르는 값은 화면에서 '미분류'로
  표시하되 **원값을 지우지 않는다.**

### 3.4 '전체' 스코프에서는 계열 민감 지표를 계산하지 않는다

계열이 2종 이상인데 계열 선택 없이 지표를 보여 주면, 그 숫자는 틀린 것이 아니라 **의미가 없다.**
단위가 섞이면 `modelSpan` 을 집계하지 않고 제외 건수를 밝히는 기존 태도와 같은 규칙을 적용한다.

## 4. 계열 어휘와 파생 규칙

### 4.1 어휘 (`ModelFamily`, `model_registry_schemas.py`)

| key | 화면 라벨 | 비고 |
|---|---|---|
| `module-unit` | Module / Group Unit 구조 | |
| `side-passage` | Side Passage 구조 | |
| `truss` | Truss 구조 | **등록 경로 없음** — 어휘에만 예약. `SourceArtifactKind` 에 truss 종류가 없어 파생 규칙도 아직 없다 |
| `other` | 기타 | 규칙이 판정하지 못한 것 |

`other`(관리자/규칙이 **명시적으로 고른 '기타'**)와 **미지정**(값이 `null` 이거나 어휘 밖 레거시 값)은
같은 것이 아니다. 화면에서 후자는 `미분류` 로 부르고, 집계에서는 `unassigned` 버킷으로 분리한다(§5.3).

프론트 라벨은 `modelRegistryUtils.js` 에 `MODEL_FAMILIES`(기존 `MODEL_ROLES` / `CONFIDENCE_LEVELS`
와 같은 형태)로 두고 `familyLabel(value)` 헬퍼를 추가한다.

### 4.2 파생 규칙 `derive_model_family(source_program_name, artifact_kind)`

순수 함수. 판정 순서가 계약이다.

| 순서 | 조건 | 결과 |
|---|---|---|
| 1 | `source_program_name == "SidePassage"` | `side-passage` |
| 2 | `artifact_kind` 가 `modelbuilder_final` / `modelbuilder_edited` / `modelbuilder_solved` | `module-unit` |
| 3 | `artifact_kind` 가 `groupmodule_original` / `module_unit_edited` / `module_unit_lifting` | `module-unit` |
| 4 | 그 외 | `other` |

> ⚠ **1번이 2·3번보다 먼저여야 한다.** SidePassage 도 `groupmodule_original` / `module_unit_edited` /
> `module_unit_lifting` kind 를 공유하므로(`ARTIFACT_RULES` 의 `programs` 집합), kind 를 먼저 보면
> SidePassage 모델이 전부 `module-unit` 으로 빨려 들어간다. 이 순서를 고정하는 회귀 테스트를 만든다.

프로그램 이름은 **정확 일치**로 본다(현재 값: `HiTessModelBuilder`, `ModelBuilderAnalysis`,
`GroupModuleUnit`, `SidePassage`, `UnitStructuralAnalysis`). 부분일치로 넓히면 새 프로그램이
조용히 잘못 분류되는데, **조용한 오분류는 미분류보다 나쁘다.**

## 5. 변경 상세

### 5.1 등록 흐름

| 위치 | 변경 |
|---|---|
| `model_registry_schemas.py` | `ModelFamily` enum + `MODEL_FAMILY_LABELS` 추가. `RegisterRequest.model_type` / `ModelPatchRequest.model_type` 를 `Optional[ModelFamily]` 로 변경 |
| `PreviewResponse` | `suggested_model_type: Optional[ModelFamily]` 추가 (제목 초안을 preview 로 채우는 기존 패턴과 동일) |
| `model_registry_service.preview_*` | 해석된 source 로 `derive_model_family()` 호출 → 응답에 실어 보낸다 |
| `model_registry_service.register_model()` | `request.model_type` 이 `None` 이면 **파생값으로 채운다** → 신규 등록본에 미지정이 남지 않는다 |
| `ModelRegistrationModal.jsx` | 「모델 종류」를 `Input`(자유 입력) → `select`(4종)로 교체. 기본값은 preview 의 `suggested_model_type`, 없으면 `other` |
| `modelRegistryUtils.buildRegistrationPayload` | `modelType` 을 그대로 실어 보낸다(현행 trim 로직 유지) |

### 5.2 목록 화면

- `ModelLibrary.jsx`: 계열 `select` 필터 추가 → `fetchModels` 의 `buildListParams` 에 `modelType` 전달,
  `useEffect` 의 페이지 리셋 deps 에 추가. **API·util 은 이미 지원하므로 상태 하나 추가가 전부다.**
- 행 표시: `m.model_type || '종류 미지정'` → `familyLabel(m.model_type)`, 값이 없거나 어휘 밖이면 `미분류`.
- 목록 필터 옵션은 **`전체` + 어휘 4종만** 둔다. '미지정' 옵션은 넣지 않는다 — 이 변경 이후 신규
  등록본에는 계열이 항상 채워지고(§5.1), SQL exact-match 로는 "null 또는 어휘 밖"을 표현할 수 없어
  레거시 1건을 위한 특수 분기를 만들 이유가 없다. 미지정 확인은 Insight 의 `unassigned` 버킷으로 한다.

### 5.3 Insight 층화 (핵심)

**API**: `GET /api/model-registry/insights/overview?status=&family=`

응답에 추가되는 것:

```jsonc
{
  "families": [ { "key": "module-unit", "label": "…", "count": 12 } ],  // 실제 존재하는 계열만
  "scope":    { "family": "module-unit" | null, "familyCount": 3, "mixed": false },
  "mixedNote": "계열이 3종 섞여 있어 …",                                  // mixed 일 때만
  // 이하 기존 형태 그대로
}
```

- `families` 는 **실제 존재하는 계열만** 낸다. 0건을 0으로 채우지 않는 기존 원칙(§7-6)을 따른다.
  값이 비었거나 어휘 밖인 revision 은 `other` 에 섞지 않고 **`unassigned`(라벨 `미분류`) 버킷**으로
  분리하며, `?family=unassigned` 조회도 지원한다 — 명시적 '기타'와 미지정을 합치면 §3.3 의
  '읽기 관용' 이 통계에서 무너진다.
- `family` 지정 → 그 계열 revision 만으로 집계. **응답 형태가 지금과 동일**하므로
  `ModelInsightDashboard` 본체를 손대지 않는다.
- `family` 미지정 + 계열 2종 이상(`mixed=true`) → `totals` · `distributions` · `topTags` ·
  `recentTrend` 만 채우고 **`metrics` · `qualityIssues` · `qualityByOutcome` · `datasetReadiness`
  는 `null`**.
- 계열이 1종이면 `mixed=false` → **지금과 완전히 동일하게** 전부 계산한다.

**서비스**: `aggregate_registry_insights(revisions, *, include_family_sensitive: bool = True)`

기본값이 `True` 라 **기존 호출부와 테스트가 전부 그대로 산다.** `False` 면 해당 4블록의 계산을
건너뛰고 `None` 을 낸다(계산해 놓고 버리지 않는다).

**방어**: `build_dataset_readiness(revisions)` 는 입력에 계열이 2종 이상 섞여 있으면 `caveats` 에
경고를 직접 추가한다 — 라우터를 거치지 않는 직접 호출(export·테스트·향후 배치)에서도 침묵하지 않게.

**필터 지점**: `_visible_revision_rows()` 가 이미 dict 에 `model_type` 을 넣는다
(`model_registry.py:464`) → 계열 필터는 행 리스트에 대한 한 줄 필터다. 새 쿼리가 필요 없다.

**프론트**: Insight 탭 상단에 계열 선택기(전체 / 계열별 건수 병기). `metrics` 등이 `null` 이면 해당
카드 자리에 "계열을 선택하세요" 안내 + `mixedNote` 를 노출한다.

### 5.4 피처 모듈

`build_cohort(..., family: Optional[str] = None)` 인자만 추가한다(제외 사유는 기존 `excluded` 규약을
따른다). `group_kfold` 는 손대지 않는다 — `model_uid` 그룹핑은 계열과 독립이고, 계열 층화 분할은
표본이 쌓인 뒤의 별건이다.

## 6. 테스트

**백엔드 (신규 `tests/test_model_family.py`)**
- 파생 규칙 표 전체(4행)
- **SidePassage + `module_unit_edited` → `side-passage`** (순서 함정 회귀)
- 미등록 프로그램 이름 → `other`
- `UnitStructuralAnalysis` + `module_unit_lifting` → `module-unit`

**API (`tests/test_model_registry_api.py` 보강)**
- `model_type` 미지정 등록 → 파생값이 저장된다
- 어휘 밖 값 POST/PATCH → 422
- 어휘 밖 레거시 값이 저장돼 있어도 목록·상세 조회가 200 (읽기 관용)
- `?model_type=` 필터
- `?family=` 지정 시 그 계열만 집계 / 미지정 + 2종 이상 → 4블록 `null` + `mixedNote` /
  1종 → 기존과 동일하게 전부 계산
- 어휘 밖 레거시 값 + `other` 를 명시한 모델이 함께 있을 때 `families` 가 `unassigned` 와 `other` 를
  **분리해서** 낸다 + `?family=unassigned` 가 레거시 쪽만 집계한다

**Insight 서비스 (`tests/test_model_insight_service.py` 보강)**
- `include_family_sensitive=False` → 4블록 `None`, 나머지 유지
- 계열 혼재 입력 → `datasetReadiness.caveats` 에 경고 추가

**프론트 (`modelRegistryUtils.test.js`)**
- `familyLabel()` — 어휘 값 / 빈 값 / 어휘 밖 값
- `buildListParams({ modelType })` — `'All'` 은 파라미터에서 빠진다(기존 계약 유지)

## 7. 배포

- **DB 마이그레이션 없음**, `schema_bootstrap` 변경 없음, InHouse exe 교체 없음
- `git pull` + 백엔드 재시작 + 프론트 재배포
- 기존 등록본: 로컬 registry 는 1건. `model_type` 이 비었거나 어휘 밖이면 '미분류'로 표시되며
  관리자가 상세 모달에서 PATCH 로 지정한다. **지금 하지 않으면 backfill 대상이 계속 늘어난다.**
- 문서 갱신: `docs/apps/model-library.md` §5.1 등록 필드표, §5.2 필터 목록, §5.7 Insight 표,
  §9 체크리스트("새 계열 추가 시 손댈 곳: 어휘 / 파생 규칙 / 프론트 라벨 / 테스트")

## 8. 잔여 리스크 (구현 후에도 남는 것)

1. **유사 검색에 계열 게이트가 없다.** 계열이 달라도 규모·요소구성이 비슷하면 추천될 수 있다.
   계열 값이 채워지면 `Dimension("modelType")`(가중치 0.10)이 지금처럼 skip 되지 않고 작동해
   **부분적으로만** 완화된다. 게이트는 후속 별건.
2. `list_models()` 의 전량 메모리 로딩(§7-11)은 그대로다. 계열 필터는 SQL 로 나가지만 근본 한계는 유지.
3. **계열이 잘못 파생된 채 등록되면 통계가 조용히 어긋난다.** 목록·상세에 계열 배지를 항상 노출해
   사람 눈에 걸리게 하는 것이 유일한 방어다.
4. 계열별로 나누면 각 표본 수가 줄어 데이터셋 준비도의 `shortfall` 이 커진다. 이는 악화가 아니라
   **지금까지 가려져 있던 사실이 드러나는 것**이다.
