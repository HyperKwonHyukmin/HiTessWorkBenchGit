# Model Library 데이터의 빅데이터 · 머신러닝 활용 방안

> 대상: HiTESS WorkBench 관리자 / 구조 해석 담당 / 데이터 활용 검토자
> 관련 문서: `docs/operations/model-registry-operations-guide.md` (운영), `docs/apps/model-library.md` (사용법)
> 근거 코드: `app/services/model_insight_service.py`(집계·준비도), `app/services/model_summary_service.py`(피처 추출), `app/routers/model_registry.py`(export)

---

## 0. 결론부터 — 지금 할 수 있는 것과 없는 것

| 할 수 있다 | 아직 못 한다 |
|---|---|
| **유사 모델 검색**(학습 없이 색인만으로 동작) | 설계 결과 예측 — 정답 라벨이 절대 부족 |
| 라이브러리 통계·품질 추세 관찰 | 응력/사용률 surrogate — 표본 부족 + 하중 조건 미수집 |
| 이상 모델 자동 표시(표본이 쌓이면) | 형상 임베딩/GNN — 표본 수백 배 필요 |

**이 문서의 목적은 가능성을 파는 것이 아니라 착수 조건을 못박는 것이다.**
"AI 로 해석을 대체한다"는 문장은 지금 데이터로는 근거가 없다. 대신 *무엇이 얼마나 모이면
무엇을 할 수 있는지*를 숫자로 적어 두고, 화면(Insight → 데이터셋 준비도)에서 실시간으로
그 진행 상황을 보여 준다.

---

## 1. 우리가 실제로 가진 데이터

등록 1건(= revision 1개)마다 다음이 남는다. 출처는 전부 서버가 계산한 값이며 사용자가
손으로 적은 값이 아니다(제목·태그·설명 제외).

### 1.1 형상 · 규모 (거의 항상 존재)

| 필드 | 출처 | 비고 |
|---|---|---|
| `node_count`, `element_count` | `geometry` | DB 컬럼으로도 승격 — 필터·정렬에 쓰임 |
| `rigidElementCount`, `pointMassCount` | `geometry` | |
| `boundingBox` | `geometry` | 모델 최대 치수(`modelSpan`) 파생 |
| `elementBreakdown` | `geometry` | `{CBEAM: 8021, CBAR: 1500, RBE2: 482, …}` 희소 벡터 |
| `propertyBreakdown`, `materialBreakdown` | `geometry` | 단면·재료 **종류 수**만. 실제 물성값은 미승격 |
| `length_unit`, `units.confidence` | `units` | ⚠ `declared` 가 아닌 모델이 많다 |

### 1.2 품질 (규칙 기반 파생 — 라벨로 쓰면 안 된다)

`orphanNodeCount` / `isolatedNodeCount` / `zeroLengthElementCount` /
`disconnectedGroupCount` / `shortElementCount` / `nastranFatal` → `quality_level`(Q0~Q4).

> ⚠ **`quality_level` 을 예측하는 모델을 만들지 말 것.**
> 이 값은 `derive_quality_level()` 이라는 **결정적 규칙**의 출력이다. 입력(결함 카운트)이
> 피처에 들어 있으므로, 이걸 예측하는 모델은 규칙을 그대로 외우는 것일 뿐 새 정보를 주지 않는다.
> 정확도 99%가 나와도 의미가 없다.

### 1.3 설계 결과 (라벨 후보 — 그러나 희소)

| 필드 | 출처 | 조건 |
|---|---|---|
| `design_outcome` (pass/mixed/fail/unknown) | `analysisOutcome` | **해석까지 끝낸 모델만** |
| `max_utilization`, `maxStressMPa`, `allowableStressMPa` | `analysisOutcome` | 동일 |
| `memberExceedCount`, `wireCompressionCount` | `analysisOutcome` | 동일 |

### 1.4 생성 이력 (스키마 1.1 신규)

| 필드 | 출처 | 쓰임 |
|---|---|---|
| `inputAudit.totals` (전체/변환/제외/오류 행) | `00_InputAudit.json` | 입력 품질 지표. **변환율이 낮은 모델은 형상이 원본과 다르다** |
| `inputAudit.topIgnoredReasons` | 동일 | 제외 사유 분포 — 데이터 정제 규칙 개선의 근거 |
| `buildStages.stages[]` (단계별 노드/요소/그룹) | `00_StageSummary.json` | 엔진 알고리즘 회귀 감지 |
| `physicalProperties.totalMassKg` / `centerOfGravityMm` | `00_StageSummary.json` | **단위가 필드명에 선언된 값** — 안전하게 쓸 수 있는 몇 안 되는 물리량 |
| `diagnostics.topCodes[]` | 정규화 모델 JSON | 코드별 경고 빈도 — 이상 탐지의 좋은 피처 |

### 1.5 원본 파일 (미래 자산)

`normalized-model.json` 을 등록 시 기본 포함하므로 **노드 좌표와 요소 연결이 그대로 남는다.**
지금은 3D 미리보기에만 쓰지만, 장기적으로 형상 임베딩·GNN 의 원천 데이터다.
**이것이 이 저장소의 가장 큰 장기 가치다** — 요약 통계는 다시 만들 수 있지만 원본 형상은 30일 뒤 사라진다.

---

## 2. 활용 시나리오 — 필요 표본과 착수 조건

임계값은 통계적 보장이 아니라 **착수 판단을 위한 사내 기준값**이다. Insight 탭의
「데이터셋 준비도」가 이 표를 그대로 화면에 그린다(`DATASET_TASKS`).

### ① 유사 모델 검색 — 최소 30건 · 학습 불필요 · **가장 먼저**

- **무엇**: 새 모델을 만들 때 "예전에 비슷한 걸 했었나?"에 답한다.
- **어떻게**: `[node_count, element_count, modelSpan, elementBreakdown 비율]` 을 정규화한
  벡터의 코사인 유사도. 학습이 없으므로 표본이 적어도 즉시 쓸모가 있다.
- **왜 먼저인가**: 라벨이 필요 없고, 실패해도 손해가 없으며, **사용자가 검색을 쓰기 시작하면
  그 자체가 어떤 모델이 실제로 재사용되는지에 대한 데이터가 된다.**
- **선행 작업**: 단위 정규화(§3.2). mm 모델과 m 모델을 같은 공간에 넣으면 무의미하다.

### ② 품질 이상 탐지 — 최소 100건 · 라벨 불필요

- **무엇**: 새로 만든 모델이 기존 모델 분포에서 벗어나면 검토를 권한다.
  (예: 요소당 노드 비율이 이상, 경고 코드 구성이 처음 보는 형태)
- **어떻게**: Isolation Forest / LOF 같은 비지도 이상 탐지.
  피처는 `diagnostics.topCodes` 빈도 + 구조 비율 지표.
- **주의**: "이상 = 잘못"이 아니다. **검토 권유이지 판정이 아님**을 UI 에서 분명히 해야 한다.

### ③ 설계 결과 예측(분류) — 최소 200건 + **소수 클래스 30건** · 라벨 필요

- **무엇**: 해석 전에 통과/미통과 가능성을 가늠한다.
- **막는 것**: 지금 `design_outcome` 이 `unknown` 이 아닌 모델이 극소수다. 게다가
  큐레이션 특성상 **통과 모델이 과대 대표**될 가능성이 높다(§3.1).
- **표본 수만 채우면 안 된다**: `build_dataset_readiness()` 는 소수 클래스가 30건 미만이면
  `ready=false` 로 두고 그 이유를 화면에 적는다. 치우친 표본으로 학습하면 "전부 통과"라고만
  답하는 모델이 나오고, 정확도는 높게 보인다.

### ④ 사용률 회귀 (surrogate) — 최소 300건 · 라벨 + 하중 조건 필요

- **무엇**: Nastran 을 돌리지 않고 최대 사용률을 추정한다.
- **막는 것**: 표본 수보다 **피처가 근본적으로 부족하다.** 사용률은 하중·경계조건의 함수인데
  현재 summary 에는 하중 정보가 하나도 없다(§4.1). 형상만으로 응력을 맞히려는 것은
  물리적으로 불가능하다.
- **먼저 할 일**: 하중/경계조건 요약을 summary 에 추가(§4.1). 그 전에는 표본이 1,000건 쌓여도 안 된다.

### ⑤ (장기) 형상 임베딩 · GNN — 1,000건+

- 노드/요소 그래프를 직접 학습해 "형상적으로 유사한 모델"을 찾거나 국부 응력을 추정한다.
- 원천 데이터(`normalized-model.json`)는 이미 보존 중이므로 **지금 해야 할 일은 계속 등록하는 것뿐**이다.
- 저장 용량 계획이 선행되어야 한다(§5).

---

## 3. 이 데이터의 함정 — 모르고 쓰면 틀린 결론이 나온다

### 3.1 선택 편향 (가장 중요)

이 저장소는 **무작위 표본이 아니다.** 관리자가 "남길 가치가 있다"고 판단한 모델만 들어온다.
따라서:

- 평범한 모델·중간에 버려진 모델은 **구조적으로 빠져 있다.**
- "등록 모델의 80%가 설계 통과"라는 통계는 *WorkBench 로 만든 모델의 80%가 통과한다*는 뜻이
  **아니다.** 통과한 모델이 더 자주 기준 모델로 선정될 뿐일 수 있다.
- 예측 모델을 만들면 이 편향이 그대로 학습된다.

**대응**: 실패·회귀 사례를 의도적으로 등록한다(`model_role = failure`). 등록 정책 자체가
데이터셋 설계라는 점을 인식할 것.

### 3.2 단위 혼재

`units.confidence` 가 `declared` 인 모델이 소수다. 길이 단위가 선언되지 않은 모델의
치수·질량 피처는 **다른 축척의 값이 같은 열에 섞여 있다는 뜻**이다.
Insight 의 `modelSpan` 이 단위별로 분리 집계하고 `excludedForUnitMismatch` 를 밝히는 이유가 이것이다.

**대응**: 학습 시 `length_unit` 이 없는 표본은 제외하거나 별도 모델로 분리한다. 절대 추정해서 채우지 않는다.

### 3.3 revision 누수 (data leakage)

같은 모델의 revision 1·2가 학습셋과 검증셋에 각각 들어가면 성능이 크게 부풀려진다.
거의 같은 형상이기 때문이다.

**대응**: 반드시 `model_uid` 기준 **GroupKFold**. `datasetReadiness.distinctModels` 와
`sampleSize` 가 다르면 화면이 이 경고를 띄운다.

### 3.4 라벨 정의의 불안정성

`design_outcome` 은 허용응력(`structuralAllowableMPa`) 대비 판정이다. 그런데 허용응력은
해석 시 사용자가 정한 안전계수·재료 등급에 따라 달라진다. **같은 모델이라도 설정이 다르면
pass 가 fail 이 된다.**

**대응**: 라벨을 쓸 때 `allowableStressMPa` 를 반드시 피처로 함께 넣거나,
`max_utilization`(연속값)을 라벨로 쓰고 임계값은 사후에 적용한다. 후자를 권한다.

### 3.5 `quality_level` 은 정답이 아니다

§1.2 참조. 규칙의 출력이므로 예측 대상이 될 수 없다.

### 3.6 시간에 따른 분포 이동

엔진(`Cmb.Cli.exe`)이 갱신되면 같은 CSV 에서 다른 모델이 나온다(`buildStages` 의 단계 구성이
바뀐다). 2026년 데이터로 학습한 모델이 2027년 산출물에 맞지 않을 수 있다.

**대응**: `schema_version` 과 등록일을 항상 함께 보관하고, 학습 시 기간을 명시한다.

---

## 4. 지금 보완해야 할 것 (우선순위 순)

### 4.1 하중 · 경계조건 요약 (⭐ 최우선)

현재 summary 에 **하중이 전혀 없다.** 이것 없이는 어떤 응력/사용률 예측도 성립하지 않는다.
`normalized-model.json` 에는 이미 들어 있으므로 추출만 하면 된다.

추가할 필드(제안):
```
loads: { caseCount, totalForceMagnitude, forceNodeCount, gravityIncluded }
boundaryConditions: { spcNodeCount, fullyFixedCount, dofPattern: {"123456": 12, "13": 4} }
```

### 4.2 단면 · 재료 물성값

현재는 **종류 수만** 센다(`propertyBreakdown`, `materialBreakdown`).
실제 `E`, `rho`, 단면 치수 분포가 있어야 강성·질량 특성을 학습할 수 있다.

### 4.3 라벨링 규약

`model_role`(reference/notable/failure/before/after)과 `tags` 는 지금 자유롭게 쓰인다.
데이터셋으로 쓰려면 **어떤 태그가 무엇을 뜻하는지 사내 합의**가 필요하다.
예: `failure` 는 "설계가 미통과"인가, "모델이 잘못됐다"인가? 지금은 둘 다로 쓰일 수 있다.

### 4.4 등록 편향을 줄이는 수집 정책

주기적으로 **무작위 샘플을 의무 등록**하는 규칙을 두면 §3.1 의 편향을 크게 줄일 수 있다.
(예: 매월 완료된 해석 중 5건을 무작위로 등록)

---

## 5. 데이터 내보내기

```
GET /api/model-registry/export.json?status=active
GET /api/model-registry/export.json?status=active&include_identity=true   # 관리자만
```

- **사번은 기본 제외**다. `include_identity=true` 는 관리자 권한이 필요하고, 개인 식별 정보가
  포함되므로 분석 목적에 필수가 아니면 쓰지 않는다.
- 현재 사용자가 **볼 수 있는 모델만** 나간다(visibility ACL 적용).
- ⚠ 행 수 상한이 없다. 등록이 수천 건을 넘어가면 페이지네이션을 추가해야 한다.

3D 형상까지 필요하면:
```
GET /api/model-registry/models/{model_uid}/geometry
```
노드 좌표 `{id: [x,y,z]}` 와 요소 연결 `[[start, end, id]]` 를 준다. 대형 모델은 잘려 나올 수
있으므로 응답의 `truncated` 를 반드시 확인할 것.

---

## 6. 화면에서 보는 준비도

Model Library → **Insight** 탭 → 「데이터셋 준비도」

- 과제별 `확보 표본 / 최소 표본` 과 **부족분**
- 학습 입력 후보별 **채워진 비율**(coverage). 표본이 0이면 `0%` 가 아니라 `-`
- 라벨 가용성과 **소수 클래스 수**
- 구조적 제약(caveats) — 단위 미선언, 해석 미완료, revision 중복

숫자가 임계값을 넘어도 `blockers` 가 있으면 **준비되지 않음**으로 표시된다.
표본을 채웠다는 것과 성능이 쓸 만하다는 것은 다른 문제이기 때문이다.

---

## 7. 권고 로드맵

| 단계 | 조건 | 할 일 |
|---|---|---|
| **지금** | — | 등록을 계속한다. 실패 사례도 등록한다. `normalized-model` 포함을 해제하지 않는다 |
| **1단계** | §4.1 하중 요약 추가 | 유사 모델 검색 구현(학습 없음). 사용 로그로 재사용 패턴 관찰 |
| **2단계** | 100건 | 품질 이상 탐지 시범 운영. **판정이 아니라 검토 권유**로만 노출 |
| **3단계** | 해석 완료 200건 + 소수 클래스 30건 | 설계 결과 분류 시범. GroupKFold(model_uid) 필수 |
| **4단계** | 해석 완료 300건 + 하중 피처 | 사용률 회귀 검토. 성능이 안 나오면 접는다 |
| **장기** | 1,000건+ | 형상 임베딩. 저장 용량·백업 계획 선행 |

각 단계에서 **성능이 기준에 못 미치면 접는 것도 결과다.** 쓸 수 없는 모델을 배포하면
해석 담당자가 잘못된 값을 믿게 되고, 그 피해는 데이터가 없어서 생기는 불편보다 크다.
