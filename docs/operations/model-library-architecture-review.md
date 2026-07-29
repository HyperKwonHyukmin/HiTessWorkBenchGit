# Model Library — 아키텍처 모듈 검토

> 제안된 3개 모듈(Analysis Case/Run, Feature/Dataset, Knowledge Retrieval)을 실제 코드에
> 대조해 검토한 결과와, 그중 구현한 것 / 설계만 마친 것.
>
> 관련: `model-registry-operations-guide.md`(운영), `model-registry-ml-roadmap.md`(ML),
> `docs/apps/model-library.md`(사용법)

## 요약

| 모듈 | 진단 | 이번 결과 |
|---|---|---|
| ① Analysis Case/Run | **타당하며 가장 시급.** 이론이 아니라 지금 데이터 수집을 막고 있다 | **설계 + 마이그레이션 계획 완료, 실행 보류** — 이유는 §1.4 |
| ② Feature/Dataset | 타당. 게다가 제안보다 더 큰 문제(이종 스키마 혼재)가 있었다 | **구현 완료** — `model_feature_service.py` |
| ③ Knowledge Retrieval | 타당. ML 로드맵도 이것을 1순위로 꼽았다 | **구현 완료** — `model_search_service.py` + UI |

---

## 1. Analysis Case/Run 모듈

### 1.1 진단은 맞다 — 그리고 이건 추상적 결함이 아니다

`RegisteredModelRevision` 한 행이 세 가지를 동시에 담고 있다.

| 성격 | 필드 |
|---|---|
| **모델 내용** | `bdf_sha256`, `node_count`, `element_count`, `storage_relative_path`, `summary_json.geometry / modelQuality / inputAudit / buildStages / diagnostics` |
| **실행 조건** | `source_analysis_id`, `source_program_name`, `summary_json.analysisOutcome.allowableStressMPa` (안전계수·재료등급의 결과물) |
| **실행 결과** | `design_outcome`, `max_utilization`, `summary_json.analysisOutcome.*` |

여기에 `bdf_sha256` 이 **전역 unique** 다. 두 사실을 겹치면 이렇게 된다.

> **같은 BDF 를 서로 다른 하중·허용응력으로 두 번 기록할 수 없다.**

이게 왜 치명적인가. 우리가 스스로 적어 둔 두 문장과 정면으로 충돌한다.

- ML 로드맵 §3.4 — *"같은 모델이라도 안전계수·재료 등급이 다르면 pass 가 fail 이 된다."*
- ML 로드맵 §4.1 — *"사용률은 하중·경계조건의 함수인데 현재 summary 에는 하중 정보가 없다."*

즉 **surrogate 학습에 필요한 데이터(동일 형상 × 여러 조건 → 여러 결과)를 지금 스키마로는
저장할 방법이 없다.** 표본이 부족한 게 아니라 **담을 그릇이 없다.** 같은 이유로 운영
가이드 §9 Stage B(엔진 버전별 재실행 비교)도 착수할 수 없다.

증상은 이미 화면에 나와 있다 — 데이터셋 준비도의 *"같은 모델의 revision 이 함께 집계되어
있습니다"* 경고는, revision 이 '내용 변경'과 '재실행'을 구분하지 못해서 생기는 잡음이다.

### 1.2 제안 스키마

```text
RegisteredModel                       (논리 모델 — 변경 없음)
└─ RegisteredModelRevision            = ModelContent (BDF 내용의 불변 스냅샷)
     bdf_sha256  UNIQUE               ← 그대로 둔다 (§1.3)
     geometry / modelQuality / inputAudit / buildStages / diagnostics
     ⛔ design_outcome · max_utilization 은 여기서 **나간다**
     └─ RegisteredAnalysisRun         (신규, 0..N)
          run_uid            UUID
          revision_id        FK → revisions.id (CASCADE)
          run_kind           lifting | static | …
          source_analysis_id 이 실행을 만든 Analysis (FK 없음, 기존 규칙 유지)
          conditions_json    {allowableStressMPa, safetyFactor, loadCaseCount,
                              unit, engineVersion, nastranVersion}
          results_json       {maxStressMPa, maxUtilization, memberExceedCount,
                              wireCompressionCount, maxDisplacementMag}
          design_outcome     조회용 scalar (인덱스)
          max_utilization    조회용 scalar (인덱스)
          executed_at / created_at
          UNIQUE(revision_id, conditions_hash)   ← 같은 조건 재등록만 막는다
```

### 1.3 ★ `bdf_sha256` 의 unique 제약은 **풀지 않는다**

제안을 순진하게 읽으면 "중복 등록이 막히니 unique 를 풀자"가 되기 쉬운데, 반대다.

- revision 이 **내용**만 담게 되는 순간, `bdf_sha256` unique 는 *"같은 바이트 = 같은 내용"*
  이라는 **올바른 정의**가 된다.
- 지금 막혀 있던 시나리오("같은 BDF, 다른 하중")는 **revision 을 하나 더 만드는 일이 아니라
  run 을 하나 더 붙이는 일**이 된다. 제약을 풀 필요가 없다.
- 오히려 제약을 풀면 중복 방지가 사라지고, 지금 잘 동작하는 `ARCHIVED_DUPLICATE` → 복원
  경로가 무너진다.

**분해가 제대로 되면 제약이 문제가 아니라 자산이 된다** — 이 점이 이 설계의 핵심이다.

### 1.4 왜 이번에 실행하지 않았나

라이브 테이블이고 이미 등록된 데이터가 있다. 그리고 이 변경이 지나가는 길목이
`register_model()` 인데, 여기에는 이미 미묘한 보상 로직이 있다.

```
DB insert + flush (PK·revision_no 확보)
  → storage.publish (파일 확정)
  → commit
commit 실패 → 발행된 rev_dir 제거 → 실패 시 orphan 로그
```

이 트랜잭션에 run insert 를 끼워 넣는 일을, **이번 턴의 다른 대규모 변경(개명·피처 모듈·
검색 모듈)과 같이 섞으면 회귀가 생겼을 때 원인을 좁힐 수 없다.** 별도 변경으로 두고,
그 대신 아래 §1.6 처럼 **갈아끼울 자리(seam)만 미리 만들어 두었다.**

### 1.5 마이그레이션 계획 (무중단 3단계)

**Phase A — 추가만 한다 (읽기 경로 무변경)**
1. `RegisteredAnalysisRun` 테이블 추가. 신규 테이블이라 `models.Base.metadata.create_all()`
   이 자동 생성한다 → **DB 마이그레이션 스크립트 불필요**(`schema_bootstrap.py` 는 신규
   테이블에 관여하지 않는다 — 기존 계획서 C3 참조).
2. 등록 시 run 1건을 함께 만든다. `revision.design_outcome` / `max_utilization` 은
   **대표 run 의 캐시**로 계속 채운다(기존 목록·필터·Insight 가 그대로 동작).
3. 테스트: run 이 생성되고 revision 캐시와 값이 일치하는지.

**Phase B — 과거 데이터 채우기**
4. `analysisOutcome.outcome != "unknown"` 인 기존 revision 마다 run 1건 backfill.
   조건은 `allowableStressMPa` 만 아는 상태이므로 `conditions_json.inferred = true` 로
   표시한다 — **추정한 조건과 기록된 조건을 섞지 않는다.**
5. `unknown` 인 revision 은 run 을 만들지 않는다(해석을 안 돌린 것은 실행이 0건인 게 맞다).

**Phase C — 읽기 전환**
6. 목록·상세·Insight 가 run 을 통해 읽도록 어댑터 교체(§1.6).
7. `revision.design_outcome` 은 `deprecated` 주석과 함께 **동기화만** 유지한다.
   컬럼 삭제는 하지 않는다 — 되돌릴 수 없는 작업이고 얻는 게 없다.

**어느 단계에서도 InHouse exe 교체·수동 DB 작업은 없다.** `git pull` + 재시작으로 충분하다.

### 1.6 이번에 미리 만든 seam

run 이 생겼을 때 **바꿔야 할 곳이 어디인지**가 지금 한곳으로 모였다.

| 자리 | 지금 | run 도입 후 |
|---|---|---|
| `routers/model_registry._visible_revision_rows()` | revision → dict | revision **+ 대표 run** → dict |
| `routers/model_registry._revision_dict()` | 검색용 dict | 동일 |
| `model_feature_service.build_cohort(require_design_label=…)` | `revision["design_outcome"]` | run 필드 |
| `model_search_service.descriptor()` | 형상만 읽음(변경 불필요) | — |

즉 **run 이 들어와도 집계·검색 로직은 손대지 않는다.** 어댑터 두 개만 바뀐다.
이것이 이번에 피처/검색을 별도 모듈로 뺀 실질적 이유다.

---

## 2. Feature / Dataset 모듈 — 구현 완료

**신규**: `app/services/model_feature_service.py` (+ `tests/test_model_feature_service.py` 23건)

### 2.1 제안된 문제 + 발견한 더 큰 문제

제안대로 피처 의미가 집계 구현 안에 박혀 있었다. 그런데 그보다 심각한 게 있었다.

> **이종 스키마 revision 을 한 칸에 세고 있었다.**

summary schema **1.0 으로 등록된 revision 에는 `totalMassKg` 가 구조적으로 없다** —
그 시절 추출기가 항상 `None` 을 넣었기 때문이다(코드로 확인). 이걸 1.1 revision 의 결측과
같이 세면 *"질량 커버리지 40%"* 같은 숫자가 나오는데, 실제로는 *"1.1 로 등록된 것 중에서는
100%"* 일 수 있다.

두 숫자는 **취해야 할 조치가 정반대다.**
- 결측 40% → "데이터를 더 모아야 한다"
- 해당 없음 → "재등록해서 스키마를 갱신해야 한다"

### 2.2 해결

- `FeatureSpec.since_schema` — 이 버전 미만에서는 **결측이 아니라 '해당 없음'**.
  `feature_coverage()` 의 **분모가 전체가 아니라 적용 대상 수**로 바뀌었다.
- 스키마 비교는 문자열이 아니라 숫자 튜플이다(`'1.10' > '1.9'` 가 성립해야 한다).
- `FEATURE_EXTRACTOR_VERSION` — 어떤 추출 규칙으로 뽑았는지를 피처 행에 함께 기록한다.
  버전이 다른 데이터를 섞어 학습하면 조용히 오염된다.
- `Cohort` — 부분집합과 **제외 사유를 함께** 들고 다닌다. 화면의 n 이 왜 그 숫자인지
  설명할 수 있게 됐다(`trainableCohort` 로 Insight 에 노출).
- `group_kfold()` / `split_report()` — *"model_uid 기준 GroupKFold"* 규칙이 문서에만 있었다.
  **문서에만 있는 규칙은 지켜지지 않으므로** 코드로 옮기고, 누수가 0 임을 검증 가능한
  형태(`leakageFree`)로 낸다. 난수를 쓰지 않아 같은 입력이면 항상 같은 분할이다.
- `ratio_similarity` / `composition_similarity` / `categorical_similarity` —
  검색 모듈이 재사용하는 기본 연산. **모르는 값은 절대 0 이나 1 로 채우지 않고 `None`.**

### 2.3 효과

검색·통계·ML 이 같은 인터페이스를 쓴다. `build_dataset_readiness()` 는 이제 **정책만**
담당하고(최소 표본, 차단 조건), 피처의 의미는 전혀 모른다.

---

## 3. Knowledge Retrieval 모듈 — 구현 완료

**신규**: `app/services/model_search_service.py`, `components/modelRegistry/SimilarModelsPanel.jsx`
**신규 API**: `GET /api/model-registry/models/{uid}/similar?limit=8`
(+ `tests/test_model_search_service.py` 15건, API 테스트 4건)

### 3.1 왜 텍스트 검색으로는 안 되는가

같은 형상이 `3454-35020-A505080` 과 `기준모델_4점권상` 으로 각각 등록돼 있으면
제목 검색으로는 **영원히 만나지 못한다.** 라이브러리에 오는 이유가 "예전에 비슷한 걸
했었나?"인데, 그 질문에 답하는 수단이 없었다.

### 3.2 2단 구조 (제안대로)

1. **SQL 후보 축소** — visibility ACL + `status=active` + 노드 수 10배 밴드.
   축소는 최적화일 뿐이라 target 에 노드 수가 없으면 건너뛴다(전부 비교).
   모델당 **최신 revision 하나만** 비교한다 — 같은 모델의 revision 이 순위를 채우면 안 된다.
2. **Python distance** — 5개 차원의 가중 평균.

| 차원 | 가중치 | 방식 |
|---|---|---|
| 요소 구성 | 0.30 | 비율 정규화 후 코사인 — 규모가 달라도 '같은 방식으로 지어졌나' |
| 노드 수 | 0.20 | `min/max` 비율 |
| 요소 수 | 0.20 | `min/max` 비율 |
| 모델 치수 | 0.20 | `min/max` 비율 (**단위 종속**) |
| 모델 종류 | 0.10 | 일치 여부 |

### 3.3 설명 가능성을 위해 정한 규칙

- **거리 대신 비율(`min/max`)** 을 쓴다. "노드 수 92% 일치"는 바로 읽히지만 정규화된
  유클리드 거리는 사람이 못 읽는다. 항상 [0,1] 이라 가중 평균에 그대로 들어간다.
- **근거 없는 차원은 평균에서 빼고 뺐다고 말한다.** 0 으로 채우면 '완전히 다르다',
  1 로 채우면 '완전히 같다'가 된다 — 둘 다 거짓말이다.
- **단위가 다르면 치수 차원만** 제외한다. 개수·구성은 단위와 무관하므로 후보를 통째로
  버리지 않는다. 제외 사유에 두 단위를 모두 적는다.
- **`basisWeight` 가 0.3 미만이면 순위에서 뺀다.** 차원 하나만 겹쳐 나온 0.99 를 1위에
  올리면 추천 전체의 신뢰가 무너진다. 걸러진 건수도 숨기지 않고 보고한다.
- 동점 정렬은 `(점수, 근거 두께, uid)` 로 **결정적**이다.
- 응답 문구에 *"'같은 모양'이지 '같은 용도'가 아닙니다"* 를 넣었다. 이 구분이 무너지면
  추천이 설계 판단으로 오독된다.

### 3.4 두 번째 어댑터를 위한 자리

표본이 수천 건을 넘어 이 방식이 느려지면 `find_similar(target, candidates, *, limit)`
시그니처를 유지한 채 내부만 교체하면 된다. **지금 vector DB 를 넣지 않는 이유는
근거를 설명할 수 없기 때문**이지 성능 때문이 아니다.

---

## 4. 남은 일

| 항목 | 상태 |
|---|---|
| Analysis Run 테이블 Phase A | 설계 완료, 실행 대기 (§1.5) |
| 하중·경계조건 요약 추출 | ML 로드맵 §4.1 — Run 모듈과 함께 하는 것이 자연스럽다 |
| 검색 사용 로그(feedback) | 어떤 추천이 실제로 열렸는지 → 가중치 조정의 유일한 근거 |
| `export.json` 페이지네이션 | 수천 건 넘어가면 필요 |

> **검색 피드백을 먼저 쌓기를 권한다.** 지금 가중치(0.30/0.20/0.20/0.20/0.10)는 근거 있는
> 추정이지 측정값이 아니다. 어떤 추천이 실제로 열렸는지가 쌓이면 그때 조정할 수 있고,
> 그 전까지의 조정은 취향이다.
