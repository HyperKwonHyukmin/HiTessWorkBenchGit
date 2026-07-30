# Model Library (선별형 BDF Model Registry) — 흐름 · 사용법 · 유의사항

> 최종 확인: 2026-07-30 (코드 기준)
> 관련 문서
> - 운영/배포 정책: [`docs/operations/model-registry-operations-guide.md`](../operations/model-registry-operations-guide.md)
> - 구현 계획서: `docs/superpowers/plans/2026-07-27-curated-bdf-model-registry.md`
>
> 이 문서는 **기능이 실제로 어떻게 흘러가고, 어떻게 쓰며, 무엇을 조심해야 하는지**를 기록한다.
> (배포 절차·미확정 운영 정책은 운영 가이드 쪽을 본다.)

---

## 1. 한눈에 보기

| 항목 | 값 |
|------|-----|
| 메뉴 위치 | 좌측 사이드바 **`ANALYSIS > Model Library`** (`Sidebar.jsx:54`) |
| 라우팅 | `App.jsx:471` — `case 'Model Library'` |
| 성격 | 해석 앱이 **아니다.** `ANALYSIS_DATA` 카탈로그에 없는 고정 메뉴이며, exe 를 실행하지 않는다 |
| 목적 | `userConnection/` 의 **30일 자동 삭제를 면제**받는, 관리자가 선별한 기준 BDF 라이브러리 |
| 등록 권한 | **관리자만** (`require_admin`) |
| 조회 권한 | 인증된 전 사용자 + visibility ACL (기본 `company` = 전사 공개) |
| API 프리픽스 | `/api/model-registry` (`main.py:202` 에서 라우터 등록) |

**존재 이유:** `cleanup_service.run_cleanup()` 는 `userConnection/` 을 `RETENTION_DAYS=30` 으로 **예외 없이** 지운다.
화이트리스트도 보존 플래그도 없다. 기준 모델·회귀 예제로 가치 있는 BDF 도 한 달이면 사라지므로,
**userConnection 밖의 별도 루트**로 복사해 두는 것이 이 기능의 전부다.

---

## 2. 전체 흐름

### 2.1 등록 파이프라인 (관리자)

```
[해석 앱 산출물 화면]                     ← 진입점. 자동 등록은 없다. 관리자가 「등록」을 눌러야 시작.
   │  source = { analysisId, artifactKind }   ★ 파일 경로는 절대 보내지 않는다
   ▼
POST /api/model-registry/preview          ← DB·저장소 무변경. 몇 번 눌러도 안전.
   │   resolve_source()  : analysis_id + artifact_kind → ARTIFACT_RULES allowlist → 절대경로
   │   summarize_...()   : normalized-model JSON 재사용, 없을 때만 nastran_bridge 폴백(임시폴더)
   │   sha256            : 중복(EXACT/ARCHIVED_DUPLICATE) 판정
   ▼
[등록 모달]  자동 추출 요약 + 엔지니어 메타(제목/역할/신뢰도/태그/설명/재사용주의) + 저장할 파일 선택
   ▼  사용자가 「등록」 클릭
POST /api/model-registry/models           ← 여기서 처음으로 상태가 바뀐다
   │  ① 중복 재확인 → 409
   │  ② registry root 결정 (env → UNC → 백엔드 로컬)
   │  ③ DB insert + flush  (PK·revision_no 확보, 아직 commit 아님)
   │  ④ publish_revision() : .staging/<uuid> 에 전부 복사 → sha256 재검증 → os.replace 로 원자적 확정
   │  ⑤ manifest.json 기록 (실패 시 unpublish + rollback)
   │  ⑥ db.commit()       ← 실패하면 확정된 폴더를 되돌린다(보상 트랜잭션)
   ▼
201 { model_uid, revision, quality_level, status, registered_at }  + ActivityLog(MODEL_REGISTER)
```

**핵심 계약 3가지**

1. **클라이언트는 파일 경로를 보내지 않는다.** `source_analysis_id + artifact_kind` 만 보내고
   서버가 `ARTIFACT_RULES` allowlist 로 해석한다 (`model_registry_service.py:199`).
   브라우저가 임의 경로를 넣어 userConnection 밖 파일을 복사시키는 것을 원천 차단.
2. **신원도 보내지 않는다.** `registered_by` 는 인증 토큰에서만 정한다.
   요청 본문의 `registered_by` / `employee_id` 는 받지도 저장하지도 않는다.
3. **등록 성공은 `db.commit()` 이후에만 성립한다.** 파일만 남고 DB 행이 없는 상태는 만들지 않는다.

### 2.2 조회 흐름 (전 사용자)

```
Model Library 페이지
 ├─ [등록 모델] 탭 → GET /models   (서버 사이드 검색·필터·페이지네이션, 20건/페이지)
 │     행 클릭      → GET /models/{uid}      → 상세 모달 (revision + artifact 목록)
 │       └ artifact → GET /artifacts/{id}/download   ★ ID 로만 조회, 경로를 보내지 않음
 │     체크박스 2개 → 비교 모달 (두 모델 상세를 나란히)
 └─ [Insight] 탭  → GET /insights/overview   (탭을 실제로 열 때만 호출 — 지연 로드)
                   GET /export.json          (분석용 export, 사번 기본 제외)
```

### 2.3 저장소 레이아웃

```text
<registry root>/
  .staging/<uuid>/                  # 작업 중 임시 — 반드시 root 내부(os.replace 원자성은 동일 볼륨에서만 보장)
  models/<model-uid>/rev-0001/
    summary.json        # 항상 (스키마 v1.0)
    manifest.json       # 항상, 마지막에 기록(자기 자신은 checksum 대상 아님)
    source.bdf          # 기본 포함
    normalized-model.json / validation.json / input-audit.json /
    stage-summary.json  / analysis-result.json / result.f06 / result.op2   # 선택
```

root 결정 순서 (`model_registry_storage.resolve_registry_root`) — **존재하는 첫 폴더**:

1. 환경변수 `MODEL_REGISTRY_DIR`
2. 사내 UNC `\\storage.hpc.hd.com\...\HiTessWorkBench\ModelRegistry`
3. 백엔드 로컬 `HiTessWorkBenchBackEnd/DataStorage/ModelRegistry` (없으면 **생성**)
   ⚠ 폴더명은 화면 이름(Model Library)과 다르게 `DataStorage` 그대로다 — 경로를 바꾸면 기존 등록본을 전부 잃는다.

> DB 에는 **root 기준 상대경로만** 저장한다. 절대·UNC 경로는 API 응답에도 summary 에도 넣지 않는다.

---

## 3. 구성요소 지도

**백엔드**

| 파일 | 역할 |
|------|------|
| `app/routers/model_registry.py` | 8개 엔드포인트, 권한 분기, 도메인 오류 → HTTP 변환 |
| `app/model_registry_schemas.py` | enum·요청/응답 스키마, 태그 정규화, `SUMMARY_SCHEMA_VERSION = "1.1"` |
| `app/services/model_registry_service.py` | `ARTIFACT_RULES` 경로 해석 + 등록 오케스트레이션 + 읽기 ACL |
| `app/services/model_family.py` | 모델 계열 파생 규칙(`derive_model_family`) + 읽기 관용 정규화(`family_key`/`family_label`) — 순수 함수 |
| `app/services/model_summary_service.py` | summary.json 생성 — 품질 등급 산정, 설계 결과 추출 |
| `app/services/model_registry_storage.py` | root 결정, staging→원자적 publish, 보상 트랜잭션 |
| `app/services/model_insight_service.py` | Insight 집계 + export (순수 함수, DB 비의존) |
| `app/models.py` | `RegisteredModel` / `RegisteredModelRevision` / `RegisteredModelArtifact` |

**프론트엔드**

| 파일 | 역할 |
|------|------|
| `pages/analysis/ModelLibrary.jsx` | 목록·검색·필터·페이지네이션·탭·비교 선택 |
| `components/modelRegistry/ModelRegistrationModal.jsx` | preview→commit 2단계 등록, 삭제본 복원 분기 |
| `components/modelRegistry/ModelDetailModal.jsx` | 상세, 3D 미리보기/승인/삭제/복원/다운로드 |
| `components/modelRegistry/RegistryModelPreview3D.jsx` | 3D 형상 미리보기(LineSegments) |
| `components/modelRegistry/ModelSourceInsights.jsx` | 입력 감사·생성 단계·진단을 표로 편다 |
| `components/modelRegistry/QualityLevelGuide.jsx` | 품질 등급 배지·사다리·접이식 설명 |
| `components/modelRegistry/SimilarModelsPanel.jsx` | 유사 모델 + 근거 표시 |
| `components/modelRegistry/ModelCompareModal.jsx` | 두 모델 비교 |
| `components/modelRegistry/ModelInsightDashboard.jsx` | 통계 대시보드 |
| `api/modelRegistry.js` | API 클라이언트 |
| `utils/modelRegistryUtils.js` | 순수 헬퍼(라벨·payload 빌더·포맷·오류 파싱) — `node --test` 로 검증 |

---

## 4. 등록 가능한 산출물 (artifact_kind)

`SourceArtifactKind` 6종. 프로그램마다 `result_info` 키가 제각각이라 매핑을 한 곳에 모아 뒀다.

| artifact_kind | 원 프로그램 | BDF 소스 | UI 진입점 |
|---|---|---|---|
| `modelbuilder_final` | HiTessModelBuilder | `result_info.bdf_path` | ✅ ModelBuilder 3단계 "원본 최종 BDF" |
| `modelbuilder_edited` | HiTessModelBuilder | `detect_edited_artifacts(output_dir)` | ✅ ModelBuilder 3단계 "최종 Edit BDF" |
| `modelbuilder_solved` | ModelBuilderAnalysis | `result_info.bdf` | ❌ **없음 (API 전용)** |
| `groupmodule_original` | GroupModuleUnit / SidePassage | `input_info.bdf_model` | ❌ **없음 (API 전용)** |
| `module_unit_edited` | GroupModuleUnit / SidePassage | 작업 폴더 스캔 `editedBdf` | ✅ `ResultArtifactsCard` |
| `module_unit_lifting` | GMU / SidePassage / UnitStructuralAnalysis | `liftingBdf` | ✅ `ResultArtifactsCard` |

- `_edited` 와 `_lifting` 은 **의미가 다르다**(편집 구조 모델 vs 와이어·하중 반영 해석 모델).
  한 버튼이 둘을 암묵적으로 고르지 않게 각각 별도 kind 로 등록한다.
- `artifact_kind` 와 프로그램 조합이 맞지 않으면 400 `UNSUPPORTED_ARTIFACT_KIND`.

---

## 5. 사용 방법

### 5.1 등록하기 (관리자)

1. **해석을 먼저 끝낸다.** 등록은 Model Library 화면이 아니라 **각 해석 앱의 산출물 화면**에서 시작한다.
   - HiTess Model Builder → 3단계 결과 카드의 `등록` 버튼
   - Group & Module Unit 권상 구조 해석 → Step3 결과 카드(`ResultArtifactsCard`)의 `등록` 버튼
2. 모달이 열리면서 **자동으로 preview** 가 돌아간다. 이 단계에서는 아무것도 저장되지 않는다.
3. 자동 추출 결과를 확인한다 — **모델 품질**(왼쪽)과 **설계 결과**(오른쪽)가 분리되어 표시된다.
4. 엔지니어 메타데이터를 입력한다.

   | 필드 | 필수 | 비고 |
   |---|---|---|
   | 제목 | ✓ | preview 결과로 초안이 자동 채워짐 (`<파일명> — <산출물 종류>`) |
   | 역할 | | 기준 모델 / 주목할 사례 / 실패·회귀 예제 / 수정 전 / 수정 후 |
   | 신뢰도 | | 높음 / 보통 / 검토 필요 |
   | 모델 종류 | | **계열 선택**(Module/Group Unit · Side Passage · Truss · 기타). 비워 두면 서버가 원 프로그램·산출물 종류에서 자동 판정한다 |
   | 공개 범위 | | **기본 전사 공개** / 소유자만 |
   | 태그 | | 쉼표 구분. trim→소문자→중복제거→최대 20개(각 50자)로 자동 정규화 |
   | 설명 / 재사용 주의사항 | | 왜 남기는지, 재사용 시 무엇을 재검토해야 하는지 |

5. 가운데 열에서 **이 모델이 만들어진 내역**(입력 감사·생성 단계·진단)을 확인한다.
   예전에는 JSON 을 내려받아야 알 수 있던 값이다.
6. 오른쪽 아래 접이식 **함께 보관할 원본 파일**을 고른다. `summary.json`·`manifest.json` 은 항상 저장되고,
   F06/OP2 는 용량 때문에 **기본 제외**다.
6. `등록` 클릭 → 201 과 함께 `model_uid` 가 표시된다.

### 5.2 찾아보기 (전 사용자)

`ANALYSIS > Model Library` → **등록 모델** 탭.

- 검색: 제목·설명 부분일치 (입력 250ms 디바운스, 이전 요청은 취소)
- 필터: **모델 계열** / 품질 등급 / 설계 결과 / 상태(사용 중·삭제됨). 계열 필터에는 **'미지정' 옵션이 없다**
  (어휘 4종 + 전체) — 신규 등록본에는 계열이 항상 채워지기 때문이다. 행에는 계열 라벨 배지가 붙는다.
- 필터를 바꾸면 1페이지로 되돌아간다. 페이지당 20건.
- 행 클릭 → 상세 모달(요약·revision·artifact 목록·다운로드)

### 5.3 상세에서 할 수 있는 것

| 화면 버튼 | 권한 | 결과 |
|---|---|---|
| **3D 형상 미리보기** | 조회 권한 | 상세를 열면 자동 로드. 드래그 회전·시점 전환·전체화면 |
| 원본 파일 다운로드 | 조회 권한 | ActivityLog `FILE_DOWNLOAD` 기록 |
| **엔지니어 승인** | 관리자 | `review_status=approved` + `quality_level=Q4` |
| **미검토로 되돌리기** | 관리자 | `review_status=unreviewed` + **`Q4 → Q3`** (⚠ §7-4 참고) |
| **삭제** | 관리자 | `status=archived` — 목록에서 내려가지만 **파일은 남는다** |
| **복원** | 관리자 | `status=active` — 삭제의 역연산, 재시도 안전(멱등) |

> **화면 용어 ≠ 내부 값.** API 는 여전히 `/archive`·`archived` 지만 화면에서는 '삭제'로 부른다.
> '보관'이라 부르면 "그럼 삭제는 어디서 하나"가 남기 때문이다. 되돌릴 수 있다는 사실은
> 라벨이 아니라 문구가 알린다. 마찬가지로 '승인 해제'는 반려인지 미검토인지 모호해
> **「미검토로 되돌리기」** 로 바꿨다.

> ⚠ **위 표가 전부다 — 상세 모달에는 메타데이터 편집기가 없다.** 바꿀 수 있는 것은
> `review_status`(승인/미검토)와 `status`(삭제/복원) 뿐이며, 제목·설명·태그·**모델 계열**을
> 고치는 화면은 아직 없다 (§7-13).

### 5.4 3D 형상 미리보기

상세 모달 왼쪽 위에 형상이 바로 뜬다. **숫자(노드 9,893개)는 "내가 찾던 그 모델인가"에
답해 주지 않기 때문이다.**

- 드래그 회전 / 휠 확대 / `등각·평면·정면·측면` 시점 전환 / 전체화면
- 구조 요소(하늘색) · 강체 연결 RBE(주황) · 집중 질량(노랑)을 색으로 구분한다
- 판별용 간이 뷰다 — 실린더 메시가 아니라 선(LineSegments)으로 그려 1만 요소도 즉시 뜬다.
  상세 검토는 각 해석 Studio 에서 한다.
- 대형 모델은 잘라서 보여 주고 **잘렸다고 화면에 명시**한다
- 등록 시 「정규화 모델 JSON」을 빼면 서버가 BDF 를 다시 파싱하고(느림, 결과는 캐시됨),
  BDF 마저 없으면 미리보기가 뜨지 않는다 → **기본 선택을 해제하지 말 것**

### 5.5 비슷한 모델 찾기

상세 모달의 3D 미리보기 바로 아래에 **형상이 비슷한 등록 모델**이 뜹니다.
제목 검색으로는 같은 형상을 다른 이름으로 등록한 모델을 찾을 수 없기 때문입니다.

- 일치도(%) 옆의 ⓘ 를 누르면 **왜 비슷한지**가 항목별로 펼쳐집니다
  (요소 구성 0.30 / 노드 수 0.20 / 요소 수 0.20 / 치수 0.20 / 종류 0.10 가중 평균)
- **값이 없어 비교하지 못한 항목은 숨기지 않고 사유와 함께** 표시합니다 —
  근거 4개인 80%와 근거 1개인 99%는 전혀 다른 이야기입니다
- **종류(0.10)** 차원은 **완전 일치만** 같다고 봅니다(`categorical_similarity`). 예전에는
  자유 입력이라 같은 계열이어도 표기가 갈려(예: `module unit` vs `모듈유닛`) 이 차원이 사실상
  죽어 있었습니다. 계열이 통제 어휘로 자동 채워지면서 **신규 등록본 사이에서는 이제부터 실제로
  판별력을 냅니다**(기존 자유 문자열 레거시 값은 그대로 남아 여전히 갈릴 수 있습니다)
- 길이 단위가 다르면 **치수 항목만** 빼고 나머지는 비교합니다(개수·구성은 단위와 무관)
- 결과를 누르면 같은 모달에서 그 모델로 갈아탑니다
- ⚠ **'같은 모양'이지 '같은 용도'가 아닙니다.** 설계 판단으로 오독하지 마세요

### 5.6 비교

목록 행의 체크박스로 **최대 2개**를 고르면 하단에 고정 바가 뜬다 → `비교하기`.
두 모델의 상세를 받아 나란히 보여준다. **길이 단위가 다르면 형상 비교는 차단**된다.

### 5.7 Insight

**Insight** 탭을 열 때만 집계가 돈다(목록만 볼 사람에게 부담을 주지 않기 위한 지연 로드).
현재 사용자가 **볼 수 있는 모델만** 집계 대상이다.

Insight 는 **두 스코프**로 나뉜다. 개수·분포·데이터 위생은 계열을 섞어도 의미가 있지만,
연속값의 평균·비율·교차표·학습 표본은 계열이 섞이면 의미를 잃기 때문이다(혼합 모집단에서
평균은 거짓말을 하고 교차표는 역전된다).

| 스코프 | 블록 |
|---|---|
| **라이브러리 현황(항상 전체)** | `totals` · `distributions`(계열·원 프로그램·역할·품질·설계 결과·단위) · `topTags` · `recentTrend` · `dataHygiene`(피처 커버리지 · 분할 누수 검증) |
| **계열별 특성(선택 계열)** | `metrics` · `qualityIssues` · `qualityByOutcome` · `datasetReadiness`(표본·라벨·코호트) |

`GET /api/model-registry/insights/overview?status=&family=` 를 호출한다. `family` 를 생략하면
서버가 **건수 최다 계열**을 고르고, 무엇을 골랐는지 `scope.family` 로 되돌려 준다. 존재하지 않는
계열 키는 오류가 아니라 **빈 계열 스코프**(표본 0, 통계 전부 null)로 온다. 값이 비었거나 어휘
밖인 레거시 `model_type` 은 `other`(명시적 '기타')와 섞지 않고 `unassigned`(미분류) 버킷으로
분리된다(`?family=unassigned` 조회도 된다).

화면 구성: 상단 **「라이브러리 현황」**(항상 전체) + 하단 **「계열별 특성」**(계열 선택기, 기본값 =
최다 계열). status 를 바꾸면 계열 선택은 초기화된다 — 이전 계열이 새 status 스코프에 없을 수
있어, 선택기 value 가 options 에 없는 상태를 막기 위함이다.

⚠ 레거시 등록본의 계열을 **화면에서 채울 수단이 없다**(§7-13). `families` 는 건수 내림차순이라
레거시가 많으면 하단의 **기본 선택 계열이 '미분류'** 로 열릴 수 있다.

상단 「모델 계열」 카드는 `distributions.modelType`(원본 `model_type` 값의 분포)이 아니라
**`families`** 를 그린다. 전자는 값이 빈 행을 세지 않고 어휘 밖 레거시 값을 각각 별도 막대로
내보내서, 같은 화면의 계열 선택기와 미분류 건수가 어긋나기 때문이다.

#### 전체 스코프 — 라이브러리 현황

| 블록 | 내용 |
|---|---|
| `totals` | models / revisions / active / archived / **goldenApproved**(품질 축) / reviewNeeded / **designPass**(설계 축) |
| `distributions` | 계열 · 원 프로그램 · 역할 · 품질등급 · 설계결과 · 길이 단위 |
| `topTags` / `recentTrend` | 상위 12개 태그 / 최근 30일 등록 추이 |
| `dataHygiene` | 학습 입력 후보 커버리지(피처) + **분할 누수 검증**(같은 모델의 revision 이 학습/검증에 겹치는지) — 이번에 처음 화면에 노출됐다 |

#### 계열 스코프 — 계열별 특성 (선택한 계열 하나만)

| 블록 | 내용 |
|---|---|
| `metrics` | nodeCount / elementCount / maxUtilization / totalMassKg / **modelSpan**(지배 단위만) |
| `qualityIssues` | 결함별 "영향받은 모델 수 / 측정된 모델 수" |
| `qualityByOutcome` | 품질 × 설계 결과 교차표 — **관측 빈도이지 인과가 아니다** |
| `datasetReadiness` | **머신러닝 준비도** — 과제별 확보/최소 표본·부족분, 라벨 가용성, 학습 가능 코호트, 구조적 제약(`caveats`) |

> 「데이터셋 준비도」는 **기대를 부풀리지 않기 위한 블록**이다. 표본 수를 채워도
> 클래스가 치우쳤으면 `ready=false` 로 두고 그 이유를 적는다. 피처 커버리지·분할 누수
> 검증은 계열과 무관한 데이터 위생이라 위 `dataHygiene`(전체 스코프)로 옮겨졌다.
> 배경과 로드맵은 `docs/operations/model-registry-ml-roadmap.md` 참조.

### 5.8 export

`GET /api/model-registry/export.json` — 분석·데이터셋용.
**사번(`owner_id`/`registered_by`)은 기본 제외**이며 `include_identity=true` 는 **관리자만** (비관리자 403).

---

## 6. 두 축을 읽는 법 — 이 기능의 핵심 규칙

**모델 품질과 설계 결과는 절대 하나로 합치지 않는다.**

### 축 ① 모델 품질 `quality_level` — "이 모델이 얼마나 검증되었나"

화면에는 **평문 한국어가 주 표기**로 나오고 Q 코드는 작게 병기된다.
'Q3' 만 보고 뜻을 아는 사람은 이 기능을 만든 사람뿐이기 때문이다.

| 화면 표기 | 값 | 조건 (`derive_quality_level`) |
|---|---|---|
| **원본만 확보** | `Q0` | 파싱 실패 |
| **연결 결함 있음** | `Q1` | 파싱은 되지만 **치명 결함 > 0** (미참조 GRID + 고립 GRID + 영길이 요소 + 분리 그룹) |
| **구조 이상 없음** | `Q2` | 치명 결함 0. 단, solver 근거 없음 |
| **해석까지 통과** | `Q3` | 치명 결함 0 **AND** `analysis-result` 존재 **AND** Nastran FATAL 없음 |
| **엔지니어 승인** | `Q4` | **자동 부여되지 않는다.** 관리자가 `review_status=approved` 로 명시 승인할 때만 |

등급은 **사다리**다 — 위 칸은 아래 칸 조건을 모두 만족한다. 각 모달의 품질 카드에 있는
접이식 「등급은 어떻게 정해지나요?」가 사다리 전체와 현재 위치를 보여 준다.

> ⚠ `freeEndNodeCount`(degree=1)는 **결함이 아니다.** 등급 산정에도 Insight 이슈 집계에도 쓰지 않는다.
> 품질 어휘(`orphanNodeCount` / `isolatedNodeCount` / `zeroLengthElementCount` / `disconnectedGroupCount`)는
> `groupmoduleunit_service.transform_to_step1()` 정의를 그대로 재사용한다 — 새로 만들지 말 것.

### 축 ② 설계 결과 `design_outcome` — "해석에서 허용치를 만족했나"

| 값 | 조건 (`extract_analysis_outcome`) |
|---|---|
| `unknown` | 해석 결과 JSON 이 없거나, 초과부재수·최대응력이 모두 없음 |
| `fail` | `memberExceedCount > 0` |
| `mixed` | 부재는 통과했지만 `wireCompressionCount > 0` (와이어 슬랙) |
| `pass` | 위 어느 것도 아님 |

`maxUtilization = maxStressMPa / structuralAllowableMPa` (1.0 초과 = 허용치 초과, 목록 뱃지 빨강).

> **응력 초과(fail)는 나쁜 모델을 뜻하지 않는다.** 실패 설계를 정확히 표현한 모델은 고품질 회귀 예제다.
> **Q4 + fail 조합은 정상**이며, Insight 도 `goldenApproved` 와 `designPass` 를 **별도 KPI** 로 낸다.

---

## 7. ★ 유의사항

### 7-1. 저장 위치를 확정하지 않으면 "삭제는 면했지만 백업은 안 되는" 상태가 된다

`MODEL_REGISTRY_DIR` 미설정 + UNC 폴더 부재 → **백엔드 로컬 `DataStorage/ModelRegistry` 를 자동 생성**해 거기에 쌓는다.
경로 해석이 조용히 성공하므로 **오류가 나지 않는다**. 운영 반영 전에 1번(환경변수) 또는 2번(UNC 생성) 중 하나를 반드시 정할 것.

### 7-2. 원본이 30일 안에 사라지면 등록 자체가 불가능하다

등록은 `userConnection/` 의 실제 파일을 복사한다. 보존 기간이 지나면 409 `SOURCE_EXPIRED` 로 끝난다.
**가치 있는 모델은 해석 직후에 등록하는 것이 원칙.** 나중에 하려고 미루면 되돌릴 방법이 없다.

### 7-3. 같은 BDF 는 영원히 한 번만 등록된다 — 삭제본은 "재등록"이 아니라 "복원"

`bdf_sha256` 이 **전역 unique** 다.

| 상황 | 응답 코드 | 사용자가 할 일 |
|---|---|---|
| 활성 모델과 동일 BDF | 409 `EXACT_DUPLICATE` | 기존 모델을 쓴다 |
| **삭제된 모델과 동일 BDF** | 409 `ARCHIVED_DUPLICATE` | 등록 모달의 **「삭제 취소하고 복원」** 을 누른다 |

삭제된 모델은 목록에서 사라지지만 파일과 sha256 은 남아 재등록이 계속 막힌다.
이 막다른 길을 피하려고 `ARCHIVED_DUPLICATE` 코드와 `POST /models/{uid}/restore` 를 분리해 뒀다.
**복원은 기존 제목·태그를 덮어쓰지 않는다** — 예전 큐레이션 내용을 보존하기 위함이다.
내용을 고치려면 `PATCH /models/{uid}` 를 직접 호출해야 한다 — 화면에는 편집기가 없다(§7-13).

### 7-4. 미검토로 되돌리면 원래 등급이 아니라 **Q3(해석까지 통과)으로** 내려온다

```python
if status_value == "approved":   rev.quality_level = "Q4"
elif rev.quality_level == "Q4":  rev.quality_level = "Q3"
```

Q1 이던 모델을 승인해 Q4 로 올렸다가 되돌리면 **Q1 이 아니라 Q3** 이 된다(원 등급을 따로 보관하지 않는다).
등급을 정확히 되돌리려면 새 revision 을 등록해야 한다. 승인 취소를 남발하지 말 것.

### 7-5. `total_mass_kg` 는 **항상 null** 이다 — 버그가 아니다

모델 JSON 에 단위계가 선언되지 않아 CONM2 질량 합을 kg 로 단정할 수 없다.
그래서 `extract_physical_properties` 는 `totalMassKg=None` 으로 두고 `pointMassSumRaw` 로만 보존한다.
결과적으로 **Insight 의 `totalMassKg` 통계는 항상 `sampleSize=0`** 이다. "0 kg" 이 아니라 "표본 없음"으로 읽어야 한다.

### 7-6. 통계는 "없는 값"을 0 으로 채우지 않는다

- 표본이 없으면 0 이 아니라 **`null`**. 모든 통계가 `sampleSize` 와 `missing` 을 함께 낸다.
- **단위가 다른 길이 값을 합산하지 않는다.** `modelSpan` 은 지배 단위만 집계하고 `excludedForUnitMismatch` 로 제외 건수를 밝힌다.
- 교차표는 관측 빈도일 뿐 인과가 아니다 — 응답 `note` 가 UI 캡션으로 그대로 노출된다.
- 프론트 `formatNumber` 도 `null` 은 `'-'`, `0` 은 `'0'` 으로 **반드시 구분**한다.

### 7-7. summary 계산과 "저장할 파일 선택"은 별개다

`summarize_resolved_source()` 는 **companions 로 발견된 파일**을 읽어 요약을 만든다.
등록 모달의 체크박스(`include_artifacts`)는 **저장 여부만** 정한다.
→ `analysis-result` 체크를 꺼도 설계 결과·Q3 판정은 그대로 계산된다. 다만 **나중에 그 파일을 다시 볼 수는 없다.**

반대로 `normalized-model` JSON 이 companion 에 없으면 **`nastran_bridge.py` 로 폴백 파싱**한다.

- 필요 경로: `InHouseProgram/NastranBridge/nastran_bridge.py` (git 미추적 → 서버 수동 반영 대상)
- 타임아웃 120초, 임시 폴더에서 실행 후 정리 → **원본 작업 폴더(userConnection)를 오염시키지 않는다**
- 실패 시 422 `BDF_SUMMARY_FAILED`

### 7-8. 물리 삭제 API 는 없다

삭제(archive)는 소프트 삭제라 파일이 계속 남는다. 저장소 quota·백업 주기도 아직 없다 → **무제한 증가**한다.
등록 1건의 총 크기 상한은 `MODEL_REGISTRY_MAX_PACKAGE_MB`(기본 **500MB**), 초과 시 413 `PACKAGE_TOO_LARGE`.

### 7-9. 기본이 전사 공개인데 민감정보 sanitization 이 없다

`visibility` 기본값은 `company`(전사 공개)다. **BDF 주석·파일명에 프로젝트 식별 정보가 그대로 들어간다.**
현재 마스킹 처리가 없으므로, 민감한 모델은 등록 시 공개 범위를 `owner`(소유자만)로 낮출 것.
`department` 는 스키마에만 있고 UI·정책 미개방 상태다.

### 7-10. App Settings 게이트 대상이 **아니다**

`/api/model-registry` 는 `app_settings.GUARDED_ROUTES` 에 등록되어 있지 않다(=fail-open).
`Model Library` 는 `ANALYSIS_DATA` 카탈로그 앱도 아니라 관리자가 "점검 중"으로 내릴 수단이 없다.
보호는 **`require_admin`(쓰기) + visibility ACL(읽기)** 뿐이다. 게이트를 걸고 싶다면 `GUARDED_ROUTES` 등록이 선행되어야 한다.

### 7-11. 목록 API 는 전체 행을 메모리로 가져와 자른다

`list_models()` 는 `q.all()` 로 전부 읽은 뒤 파이썬에서 `rows[skip:skip+limit]` 한다.
태그 필터도 JSON 컬럼 이식성(MySQL/SQLite) 때문에 파이썬에서 거른다.
**등록 건수가 수천 건 규모가 되면 SQL 페이지네이션으로 바꿔야 한다.** (MVP 규모에서는 문제 없음)

### 7-12. PATCH 는 새 revision 을 만들지 않는다

메타데이터 수정은 현재 행을 덮어쓴다. **변경 이력이 남지 않는다.**
새 revision 은 오직 **등록(POST /models)** 으로만 생긴다. 같은 모델에 revision 을 추가하려면
`target_model_uid` 를 보내야 하는데 — **현재 등록 모달에는 그 경로가 없다**(항상 새 모델 생성). API 전용이다.

> 그 API 전용 경로에서는 **계산된 계열이 부모 모델 행에 반영되지 않는다.** `model_type` 은
> 신규 모델을 만들 때만 행에 기록되고, 기존 모델에 revision 을 덧붙이면 그 계열은
> `summary.json` 에만 남는다. 목록·Insight 는 모두 모델 행의 `model_type` 을 읽으므로
> 부모의 계열은 그대로다 — 바꾸려면 PATCH 다(§7-13).

### 7-13. 등록한 뒤에는 **모델 계열을 화면에서 바꿀 수 없다**

계열을 고르는 곳은 **등록 모달뿐**이다(§5.1). 등록이 끝난 모델의 계열을 고치는 UI 는 **없다** —
상세 모달은 승인/미검토와 삭제/복원만 PATCH 한다. 방법은 두 가지뿐이다.

1. `PATCH /api/model-registry/models/{uid}` 에 `model_type` 을 실어 보낸다 (**관리자만**, API 직접 호출)
2. 같은 모델을 다시 등록한다 (동일 BDF 는 sha256 중복으로 막히니 §7-3 의 복원 경로를 먼저 확인)

그래서 **이 기능 이전에 등록된 행은 `미분류` 로 남는다.** Insight 의 `families` 는 **건수 내림차순**이라
레거시가 많으면 하단 「계열별 특성」의 **기본 선택 계열이 '미분류'** 가 될 수 있다. 신규 등록본에는
계열이 항상 채워지므로 시간이 지나면 해소되지만, 그때까지는 그대로 보인다.
화면에서 계열(과 제목·설명·태그)을 고치는 경로가 필요하면 **후속 작업**이다.

---

## 8. 오류 코드 대응표

| 코드 | HTTP | 원인 | 대응 |
|---|---|---|---|
| `SOURCE_ANALYSIS_NOT_FOUND` | 404 | analysis_id 없음 | 해석 기록 확인 |
| `UNSUPPORTED_ARTIFACT_KIND` | 400 | 프로그램·kind 조합 불일치, 또는 `.bdf` 아님 | §4 매핑표 확인 |
| `SOURCE_EXPIRED` | 409 | 원본이 30일 정리로 삭제됨 / 읽기 실패 | 재해석 후 등록 |
| `SOURCE_FORBIDDEN` | 400 | 경로가 `userConnection/` 밖 | DB `result_info` 오염 의심 |
| `EXACT_DUPLICATE` | 409 | 동일 BDF 가 활성 등록됨 | 기존 모델 사용 |
| `ARCHIVED_DUPLICATE` | 409 | 동일 BDF 가 **삭제** 상태 | **복원** (§7-3) |
| `BDF_SUMMARY_FAILED` | 422 | 폴백 파싱 실패/타임아웃 | `nastran_bridge.py` 배치 확인 |
| `REGISTRY_STORAGE_UNAVAILABLE` | 503 | root 생성·쓰기·복사 실패 (UNC 미마운트 등) | 저장 경로 점검 |
| `PACKAGE_TOO_LARGE` | 413 | 500MB 초과 | F06/OP2 체크 해제 |
| `CHECKSUM_MISMATCH` | 500 | 복사본이 원본과 다름 | 디스크/네트워크 이상 |
| `REVISION_ALREADY_PUBLISHED` | 409 | 동시 등록 충돌 | 재시도 |
| `REGISTRY_COMMIT_FAILED` | 500 | DB commit 실패 (파일은 롤백됨) | 로그 확인 |
| `IDENTITY_FORBIDDEN` | 403 | 비관리자가 `include_identity=true` | 관리자 계정 필요 |

**404 의 이중 의미:** 볼 수 없는 모델은 403 이 아니라 **404** 를 준다 — 존재 여부 자체를 숨기기 위함이다.

---

## 9. 변경·확장 시 체크리스트

- **새 artifact_kind 추가** → ① `SourceArtifactKind` ② `ARTIFACT_RULES` resolver ③ `ARTIFACT_KIND_LABELS`
  ④ UI 진입점 ⑤ 테스트. resolver 는 반드시 `userConnection` 내부 경로만 돌려줘야 한다.
- **새 계열 추가** → ① `ModelFamily` enum ② `MODEL_FAMILY_LABELS` ③ `model_family.PROGRAM_FAMILIES`
  또는 `MODULE_UNIT_KINDS` 파생 규칙 ④ 프론트 `MODEL_FAMILIES` ⑤ `tests/test_model_family.py`.
  ⚠ 파생 규칙에서 **프로그램 이름 판정이 artifact_kind 판정보다 먼저**여야 한다(SidePassage 가
  kind 를 GroupModuleUnit 과 공유한다).
- **summary 스키마 변경** → `SUMMARY_SCHEMA_VERSION` bump (기존 revision 은 옛 버전으로 남는다).
- **품질 어휘 추가** → `transform_to_step1` 정의와 어긋나지 않게. `freeEnd` 를 결함으로 세지 말 것.
- **새 통계 추가** → `sampleSize`/`missing` 동반, 단위 혼합 금지, 품질·설계 축 혼합 금지.
- **API 응답 필드 추가** → 절대경로·UNC 경로가 새어나가지 않는지 확인
  (회귀 테스트 `test_api_responses_never_leak_absolute_storage_paths` 가 잡는다).

## 10. 검증

```powershell
# 백엔드
cd HiTessWorkBenchBackEnd
WorkBenchEnv\Scripts\python.exe -m pytest `
  tests/test_model_registry_source_resolver.py tests/test_model_summary_service.py `
  tests/test_model_registry_storage.py tests/test_model_registry_api.py `
  tests/test_model_insight_service.py tests/test_model_family.py -v

# 프론트
cd HiTessWorkBench/frontend
node --test src/utils/modelRegistryUtils.test.js
npm run build
```

**배포:** `git pull` + 백엔드 재시작 + 프론트 재배포. InHouse exe 수동 교체 불필요, DB 마이그레이션 불필요
(신규 테이블 3개는 `Base.metadata.create_all()` 이 자동 생성).
단, summary 폴백 파싱을 쓰려면 서버에 `InHouseProgram/NastranBridge/nastran_bridge.py` 가 있어야 한다.
