# 선별형 BDF Model Registry (Model Library) — 운영 가이드

> 구현 계획: `docs/superpowers/plans/2026-07-27-curated-bdf-model-registry.md`
> 이 문서는 **배포 전에 반드시 확정해야 할 값**과 **실제로 검증된 동작**을 기록한다.

## 1. 이 기능이 푸는 문제

`userConnection/` 의 해석 산출물은 `cleanup_service.run_cleanup()` 이 **30일 뒤 예외 없이** 삭제한다
(`RETENTION_DAYS=30`, 화이트리스트·보존 플래그 없음). 기준 모델·회귀 예제로 가치가 있는 BDF도
한 달이면 사라진다.

Model Registry 는 **관리자가 선별한** BDF 만 `userConnection` 밖 영구 저장소로 복사하고,
버전 있는 요약 JSON + 엔지니어 메타데이터를 DB 에 축적한다.

## 2. 권한 모델

| 동작 | 권한 | 엔드포인트 |
|---|---|---|
| 미리보기 / 등록 / 수정 / 삭제 / 복원 | **관리자만** (`require_admin`) | `POST /preview`, `POST /models`, `PATCH /models/{uid}`, `POST /models/{uid}/archive`, `POST /models/{uid}/restore` |
| 목록 / 상세 / 3D 형상 / 다운로드 / 통계 / export | 인증된 전 사용자 + visibility ACL | `GET /models`, `GET /models/{uid}`, `GET /models/{uid}/geometry`, `GET /artifacts/{id}/download`, `GET /insights/overview`, `GET /export.json` |

- **기본 visibility = `company`(전사 공개).** 관리자가 선별한 기준 모델을 팀 전체가 참조하는 것이 목적이다.
- `owner_id` = **원 해석 수행자**(source Analysis 의 employee_id) — 출처 보존용.
  `registered_by` = **등록한 관리자**. 관리자는 타인의 Analysis 도 등록할 수 있다.
- 요청 본문의 `registered_by` / `employee_id` / 파일 경로는 **받지도, 저장하지도 않는다.**

### 화면 용어 ≠ 내부 값 — '보관'은 사용자에게 '삭제'다

내부 상태값은 여전히 `active` / `archived` 이고 엔드포인트도 `/archive` 그대로다.
그러나 **화면에서는 '삭제'라고 부른다.** 사용자가 기대하는 행위(목록에서 없앤다)와
실제 동작이 같은데, '보관'이라 부르면 "그럼 삭제는 어디서 하나"라는 질문만 남기 때문이다.
되돌릴 수 있다는 사실은 라벨이 아니라 **문구**가 책임진다(`SOFT_DELETE_NOTE`).

| 내부 값 / API | 화면 표기 |
|---|---|
| `status: archived` | 삭제됨 |
| `POST /archive` | 「삭제」 버튼 |
| `POST /restore` | 「복원」 버튼 |
| `review_status: approved` 로 전환 | 「엔지니어 승인」 |
| `review_status: unreviewed` 로 전환 | 「미검토로 되돌리기」 (← 옛 '승인 해제') |

'승인 해제'를 쓰지 않는 이유는 **반려인지 미검토인지 알 수 없기 때문**이다. 실제 동작은
미검토로 되돌리는 것이므로 그대로 이름 붙였다. 라벨 정의는 전부
`frontend/src/utils/modelRegistryUtils.js` 한 곳(`MODEL_STATUS_INFO`, `SOFT_DELETE_NOTE`)에 있다.

### 삭제는 되돌릴 수 있어야 한다 — 되돌리는 길은 '복원'뿐

`bdf_sha256` 은 **전역 unique** 다. 그래서 삭제된 모델과 **바이트가 같은 BDF 는 새로 등록할 수 없다.**
사용자에겐 "목록에서 사라졌는데 다시 등록도 안 된다"로 보이는데, 이건 막다른 길이다.

- 삭제된 모델과 중복이면 서버는 `EXACT_DUPLICATE` 가 아니라 **`ARCHIVED_DUPLICATE`** 로 답하고
  `model_uid` · `model_status` 를 함께 준다.
- 등록 모달은 그 코드를 보고 **「삭제 취소하고 복원」** 버튼을 띄운다.
  `POST /models/{uid}/restore` 하나로 끝나며, **기존 제목·태그는 덮어쓰지 않는다**
  (예전 큐레이션 내용을 새로 연 모달의 자동 초안으로 날려버리면 안 되기 때문).
- 상세 모달에서도 삭제된 모델에는 「복원」 버튼이 뜬다. 목록의 **상태 필터를 `삭제됨`** 으로
  두면 찾을 수 있다.
- 삭제 버튼은 `danger`(빨강)가 아니라 `secondary` 다. 파일이 실제로 지워지지 않기 때문이다.

> 정말로 **같은 BDF 를 별개 모델로 두 번 등록**해야 한다면 지금 구조로는 불가능하다.
> `bdf_sha256` 의 unique 제약을 푸는 스키마 변경이 필요하며, 그러면 중복 방지가 사라진다.
> 현재는 "같은 파일 = 같은 모델"이 의도된 계약이다.

### 품질 등급은 코드가 아니라 평문이 1차 표기다

`Q0`~`Q4` 는 API·필터·DB 값으로 그대로 남지만, 화면에서는 **평문 한국어가 주 표기**이고
Q 코드는 작게 병기한다. 'Q3' 만 보고 뜻을 아는 사람은 이 기능을 만든 사람뿐이기 때문이다.

| 값 | 화면 표기 | 도달 조건(누적) |
|---|---|---|
| `Q0` | 원본만 확보 | BDF 파싱 실패 |
| `Q1` | 연결 결함 있음 | 파싱 성공 |
| `Q2` | 구조 이상 없음 | + 미참조·고립·영길이·분리 그룹 0 |
| `Q3` | 해석까지 통과 | + Nastran FATAL 없음 |
| `Q4` | 엔지니어 승인 | + 관리자 승인(수동, 자동 부여 없음) |

각 모달의 품질 카드에 접이식 「등급은 어떻게 정해지나요?」(`QualityLevelGuide.jsx`)를 두어
사다리 전체와 현재 위치를 보여 준다. 기본은 접힘 — 아는 사람에게 다섯 줄짜리 소음이 되지 않게.

## 3. 저장 위치 — ★ 배포 전 확정 필요

DB 에는 이 루트 **기준 상대경로만** 들어간다. 즉 **루트가 바뀌면 이전 등록본을 전부 못 찾는다.**
`resolve_registry_root()` 의 선택 규칙은 그래서 아래 순서로 안정적이어야 한다.

1. **환경변수 `MODEL_REGISTRY_DIR` — 있으면 무조건 이것.** 폴더가 없으면 만들고,
   못 만들면 **503 으로 크게 실패**한다(다른 폴더로 조용히 새지 않는다).
2. 후보 중 **이미 `models/` 가 들어 있는(= 사용 중인)** 루트.
3. 그다음에야 선호 순서: 사내 UNC → 백엔드 로컬.
4. 아무것도 없으면 백엔드 로컬 `HiTessWorkBenchBackEnd/DataStorage/ModelRegistry` 를 만든다.

> ⚠ **2번 규칙이 왜 필요한가.** 예전 구현은 "존재하는 첫 폴더"를 골랐다. 로컬에 등록본이
> 쌓인 뒤 UNC 가 뒤늦게 마운트되면 루트가 UNC 로 갈아타면서 **기존 모델의 다운로드가 전부
> 404** 가 된다(DB 행은 멀쩡해 원인 추적이 어렵다). 이제 사용 중인 루트가 선호 순서를 이긴다.
> 그래도 루트가 바뀌면 `[registry] 저장소 루트가 A → B 로 바뀌었습니다` 경고를 남긴다.

> ⚠ **환경변수·UNC 를 둘 다 안 정하면 4번 로컬 폴더로 떨어진다.** 이 경로가 백업 대상인지
> 확인하지 않은 채 운영에 올리면, 30일 삭제는 피했지만 **백업은 안 되는** 상태가 된다.
> 운영 반영 전에 1번(환경변수) 또는 UNC 폴더 생성 중 하나를 반드시 정할 것.

기타 설정:

| 환경변수 | 기본값 | 의미 |
|---|---|---|
| `MODEL_REGISTRY_DIR` | (미설정) | 저장소 루트 override |
| `MODEL_REGISTRY_MAX_PACKAGE_MB` | `500` | 등록 1건의 총 파일 크기 상한 |

### 폴더 구조

```text
<registry root>/
  .staging/<uuid>/                 # 작업 중 임시 — 반드시 루트 내부(os.replace 원자성)
  models/<model-uid>/rev-0001/
    summary.json      # 항상
    manifest.json     # 항상, 마지막에 기록(자기 자신은 checksum 대상 아님)
    source.bdf        # 기본 포함(끌 수 있음)
    normalized-model.json / validation.json / input-audit.json /
    stage-summary.json / analysis-result.json / result.f06 / result.op2   # opt-in
```

- DB 에는 **registry root 기준 상대경로만** 저장한다. 절대/UNC 경로는 API 응답·summary 에 넣지 않는다.
- F06/OP2 는 용량이 커 **기본 제외**다(`DEFAULT_INCLUDED_KINDS`).

## 4. 검증된 동작 (자동 테스트 235건)

계획서 §Task 11 실패 매트릭스를 전부 자동 테스트로 닫았다. 수동 재현 없이 아래로 회귀를 막는다.

| 시나리오 | 기대 동작 | 검증 테스트 |
|---|---|---|
| 관리자가 본인/타인 Analysis 등록 | 201, `owner_id`=원 수행자, `registered_by`=관리자 | `test_api_registration_records_owner_and_registrar_separately` |
| Module Unit `_edited` / `_lifting` 등록 | 서로 다른 파일이 각각 등록됨 | `test_api_module_unit_edited_and_lifting_register_as_distinct_artifacts` |
| 비관리자 등록·수정·삭제 시도 | 403 | `test_api_non_admin_cannot_register`, `..._cannot_patch_or_archive` |
| 비관리자 목록 조회 | 200, `company` 모델만 보임 | `test_api_list_returns_envelope_and_company_models_for_regular_user` |
| 비관리자가 `owner` 모델 상세 요청 | 404 (존재 여부도 숨김) | `test_api_owner_visibility_hides_model_from_other_users` |
| 동일 BDF 재등록 | 409 + 기존 UID/revision | `test_api_duplicate_registration_returns_409_with_existing_uid` |
| 30일 삭제된 source | 409 `SOURCE_EXPIRED`, DB 행 없음 | `test_api_expired_source_returns_409` |
| 저장소 쓰기 불가 | 503, active DB 행 없음 | `test_api_storage_failure_leaves_no_active_row` |
| **DB commit 실패** | 500, **발행된 파일 되돌림**(빈 폴더도 잔여 없음) | `test_api_db_commit_failure_removes_published_files` |
| artifact ID 경로 탈출 | 404 | `test_api_download_refuses_path_escaping_registry_root` |
| 클라이언트가 경로/신원 주입 | 무시하고 서버 해석본 사용 | `test_api_registration_payload_ignores_unknown_path_fields` |
| FATAL/실패 모델 등록 | 등록 성공, 품질·설계결과 분리 | `test_api_failed_analysis_can_be_registered` |
| summary-only 등록 | BDF 미저장, 검색·중복판정 유지 | `test_api_summary_only_registration_keeps_model_searchable` |
| 삭제(archive) | 목록 기본 제외, **파일 보존** | `test_api_archive_hides_from_default_list_but_keeps_files` |
| **삭제된 모델과 같은 BDF 재등록** | 409 `ARCHIVED_DUPLICATE`(코드 분리) | `test_api_archived_duplicate_is_distinguishable_from_active_duplicate` |
| preview 의 중복 안내 | 삭제 여부(`status`)까지 알려줌 | `test_api_preview_reports_duplicate_status` |
| 복원(restore) | 목록 복귀 + 다운로드 계속 가능 | `test_api_restore_brings_archived_model_back_to_list` |
| 복원 재실행 | 안전(멱등) | `test_api_restore_is_idempotent` |
| 비관리자 복원 시도 | 403 | `test_api_non_admin_cannot_restore` |
| 삭제된 모델에 revision 추가 | 자동 활성화(숨은 등록 방지) | `test_api_new_revision_reactivates_archived_target_model` |
| 저장소 루트 선택 | env 우선·사용 중 루트 유지 | `test_env_root_is_created_rather_than_silently_falling_back`, `test_in_use_root_wins_over_preference_order`, `test_preference_order_applies_when_no_root_is_in_use` |
| 중단된 등록의 staging 잔해 | 오래된 것만 자동 정리 | `test_publish_sweeps_stale_staging_but_spares_recent` |
| API 응답의 절대경로 | 어떤 엔드포인트에서도 노출 없음 | `test_api_responses_never_leak_absolute_storage_paths` |
| **유사 검색** — 자기 자신 | 순위에서 제외 | `test_api_similar_excludes_self_and_explains_its_basis` |
| 유사 검색 — 볼 수 없는 모델 | 404 (존재 여부도 숨김) | `test_api_similar_hides_models_the_user_cannot_read` |
| 유사 검색 — 근거 없는 차원 | 0 으로 채우지 않고 평균에서 제외 | `test_missing_dimension_is_skipped_not_zeroed` |
| 유사 검색 — 단위 불일치 | 치수 차원만 제외, 나머지는 비교 | `test_unit_mismatch_drops_only_the_size_dimension` |
| 유사 검색 — 근거 1개짜리 고득점 | 순위에서 제외하고 건수 보고 | `test_similar_drops_candidates_with_too_thin_a_basis` |
| **옛 스키마 피처** | 결측이 아니라 '해당 없음' | `test_old_schema_features_are_not_applicable_not_missing` |
| 커버리지 분모 | 적용 대상 수(전체 아님) | `test_coverage_denominator_excludes_non_applicable_revisions` |
| 스키마 버전 비교 | `'1.10' > '1.9'` (문자열 비교 아님) | `test_schema_versions_compare_numerically_not_lexically` |
| 학습/검증 분할 | 같은 model_uid 는 절대 쪼개지 않음 | `test_group_kfold_never_splits_one_model_across_folds` |
| 분할 재현성 | 난수 없음 — 같은 입력 → 같은 분할 | `test_group_kfold_is_deterministic` |
| **3D 형상 조회** | 좌표/연결만 반환, 저장소 경로 미노출 | `test_api_geometry_returns_coordinates_without_exposing_paths` |
| 비관리자의 3D 형상 조회 | 200 (전사 공개 모델) | `test_api_geometry_is_readable_by_non_admin` |
| 볼 수 없는 모델의 형상 조회 | 404 (존재 여부도 숨김) | `test_api_geometry_hides_models_the_user_cannot_read` |
| 좌표 없는 절점을 잇는 요소 | 그리지 않고 버림(원점에 붙이지 않음) | `test_elements_referencing_missing_nodes_are_dropped` |
| 대형 모델 형상 | 잘라서 주고 `truncated` 로 알림 | `test_oversized_model_is_truncated_and_says_so` |
| BDF 재파싱 결과 | 캐시되어 두 번 돌지 않음 | `test_bdf_parse_result_is_cached_so_it_runs_only_once` |
| 입력 감사 요약 | 절대경로·원문 행 미노출, 파일명만 | `test_input_audit_summarizes_without_leaking_paths_or_raw_rows` |
| 단위가 필드명에 선언된 질량 | kg 로 승격 + 출처 기록 | `test_declared_ton_mass_is_promoted_to_kg_with_its_source` |
| 선언 소스 없는 질량 | 여전히 null (추정 금지) | `test_mass_stays_null_without_a_declared_source` |
| 데이터셋 준비도 | 표본만 채워도 클래스 치우침이면 `ready=false` | `test_readiness_flags_class_imbalance_even_when_sample_is_large` |
| revision 중복 집계 | 학습 누수 경고 노출 | `test_readiness_warns_when_revisions_of_one_model_are_pooled` |

### 실행

```powershell
cd HiTessWorkBenchBackEnd
WorkBenchEnv\Scripts\python.exe -m pytest `
  tests/test_model_registry_source_resolver.py tests/test_model_summary_service.py `
  tests/test_model_registry_storage.py tests/test_model_registry_api.py `
  tests/test_model_insight_service.py tests/test_model_geometry_service.py `
  tests/test_model_feature_service.py tests/test_model_search_service.py -v
```

```powershell
cd HiTessWorkBench/frontend
node --test src/utils/modelRegistryUtils.test.js
npm run build
```

> 전체 회귀(`pytest tests/`)에는 **이 기능과 무관한 기존 실패 2건**이 있다:
> `test_drawing_image_lug_fixtures`(fixture PNG 가 commit `59a70dc` 에서 삭제됨),
> `test_mooring_edit_bdf::test_connect_rejects_node_already_dependent`(`addRigid` 가
> SystemExit 대신 조용히 제외). 회귀로 오판하지 말 것.

## 5. 두 축을 섞지 않는다 — 이 기능의 핵심 규칙

| 축 | 값 | 의미 |
|---|---|---|
| **모델 품질** `quality_level` | Q0 원본만 확보 / Q1 연결 결함 있음 / Q2 구조 이상 없음 / Q3 해석까지 통과 / Q4 엔지니어 승인 | 모델이 **얼마나 검증되었나** |
| **설계 결과** `design_outcome` | unknown / pass / mixed / fail | 해석에서 **허용치를 만족했나** |

- **응력 초과(fail)는 나쁜 모델을 뜻하지 않는다.** 실패 설계를 정확히 표현한 모델은 고품질 회귀 예제다.
  Q4 + `fail` 조합은 정상이며, Insight 는 이 둘을 별도 KPI(`goldenApproved`, `designPass`)로 낸다.
- **Q4 는 자동 부여되지 않는다.** `PATCH {"review_status": "approved"}` 로 관리자가 명시적으로 승인할 때만 올라가고,
  승인을 해제하면 Q3 으로 내려온다.
- 품질 어휘(`orphanNodeCount` / `isolatedNodeCount` / `zeroLengthElementCount` / `disconnectedGroupCount`)는
  `groupmoduleunit_service.transform_to_step1()` 정의를 그대로 쓴다. 새로 만들지 말 것.
  ⚠ `freeEndNodeCount`(degree=1)는 **결함이 아니다** — 등급 산정에 쓰지 않는다.

## 5-1. 파일이 아니라 **값**으로 이해시킨다 (summary 스키마 1.1)

「정규화 모델 JSON」·「입력 검사」·「단계 요약」은 원래 **다운로드 버튼으로만** 존재했다.
그런데 이 파일들은 수 MB 에 `rowAudit` 만 수만 행이라 실제로 열어 보는 사람이 없고,
열어도 뜻을 읽을 수 없다. 그래서 서버가 판단에 쓰이는 집계를 뽑아 summary 로 승격했다.

| summary 절 | 소스 파일 | 화면에서 답하는 질문 |
|---|---|---|
| `inputAudit` | `00_InputAudit.json` | 원본 CSV 몇 줄이 실제로 모델이 됐나. 왜 빠졌나 |
| `buildStages` | `00_StageSummary.json` | 단계마다 절점·요소가 어떻게 변했나. 마지막에 그룹이 1개인가 |
| `diagnostics` | 정규화 모델 JSON | "경고 11,691건" 이 **어떤 코드**로 몇 건인가 |
| `physicalProperties.totalMassKg` | `00_StageSummary.json` | 총 질량 (단위가 필드명에 선언된 값만 승격) |

- 파일 자체는 계속 보관한다 — **재해석·감사의 근거**이기 때문이다. 다만 등록 모달에서는
  선택 UI 를 접어 두고, 상세 모달에서는 다운로드를 맨 끝으로 내렸다.
- `totalMassKg` 는 `massProperties.totalMassTon` 처럼 **필드 이름에 단위가 박힌 값만** kg 로 올린다.
  추정은 하지 않으며, 승격 시 `massSource` 로 출처를 남긴다. 소스가 없으면 여전히 `null` 이다.
- ⚠ **`inputFiles[].path` 는 서버 절대경로다.** 파일명만 남기고 경로는 버린다(테스트로 고정).
- ⚠ **스키마 1.0 으로 등록된 기존 모델에는 이 절들이 아예 없다.** 프론트는 "값 없음"과
  "이전 스키마"를 구분해 표시한다(`ModelSourceInsights`). 채우려면 같은 BDF 를 새 revision 으로 등록한다.

## 5-2. 3D 형상 미리보기

`GET /api/model-registry/models/{uid}/geometry` — 좌표 `{id: [x,y,z]}` 와 선분 `[[start, end, id]]`.

- 소스 우선순위: **저장된 `normalized-model.json` → 캐시 → 저장된 BDF 재파싱**.
  BDF 재파싱은 최대 120초 subprocess 라 결과를 `<root>/.cache/geometry/<revision_id>.json` 에 적어 둔다.
- 등록 시 「정규화 모델 JSON」을 **빼면 미리보기가 BDF 재파싱으로 떨어지고**, BDF 마저 없으면
  `GEOMETRY_UNAVAILABLE` 로 404 다. 기본 선택을 해제하지 말 것.
- 상세 응답과 분리한 이유는 크기다. 노드/요소 배열이 수 MB 라 목록·상세에 매번 실으면
  미리보기를 안 볼 사람까지 느려진다.
- 대형 모델은 잘라서 주고 `truncated: true` 로 알린다. **조용히 일부만 보여 주면
  "요소가 이것뿐"으로 읽힌다.**
- 렌더링은 실린더 메시가 아니라 `LineSegments` 다 — 판별용 간이 뷰이므로 속도를 택했다.
  상세 검토는 각 해석 Studio 에서 한다.

## 6. 통계의 정직성 규칙

- **표본이 없으면 0 이 아니라 `null`.** 모든 통계는 `sampleSize` 와 `missing` 을 함께 낸다.
- **단위가 다른 길이 값을 합산하지 않는다.** `modelSpan` 은 지배 단위만 집계하고
  `excludedForUnitMismatch` 로 제외 건수를 밝힌다. 모델 비교 화면도 단위가 다르면 형상 비교를 차단한다.
- **교차표는 관측 빈도이지 인과가 아니다** — 응답 `note` 에 명시되어 UI 캡션으로 그대로 노출된다.
- **export 는 사번을 기본 제외한다.** `include_identity=true` 는 관리자만 요청할 수 있다(비관리자 403).

## 7. 배포 절차

**`git pull` + 백엔드 재시작 + 프론트 재배포.** 그 외 수동 작업은 없다.

- InHouse 프로그램(exe/py) 변경 **없음** → 서버 `InHouseProgram/` 수동 교체 불필요
- 신규 테이블 3개(`registered_models`, `registered_model_revisions`, `registered_model_artifacts`)는
  `models.Base.metadata.create_all()` 이 자동 생성 → **DB 마이그레이션 불필요**
  (`schema_bootstrap.py` 는 신규 테이블에 관여하지 않는다)
- Module Unit studio zip / `MODULE_STUDIO_VERSION` 은 이번 변경 대상이 아니다
  (WorkBench 프론트의 `ResultArtifactsCard` 만 수정, studio·엔진 미변경)

재시작 후 `Administration` 없이 좌측 `ANALYSIS > Model Library` 로 진입한다.
등록 버튼은 **관리자에게만** 보이며, 각 해석 앱의 산출물 화면(Model Builder 3단계,
Group & Module Unit 결과 카드)에 있다.

## 8. 아직 확정하지 않은 운영 정책

| # | 항목 | 현재 기본값 | 결정 필요 사유 |
|---|---|---|---|
| 1 | `MODEL_REGISTRY_DIR` 실경로 | 로컬 폴백 | **백업 대상 여부 미확인** — 최우선 |
| 2 | 저장소 용량 quota / 백업 주기 | 없음 | 무제한 증가 |
| 3 | F06/OP2 기본 포함 | OFF | 용량 vs 재현성 |
| 4 | `department` visibility | 미사용(스키마만 존재) | 조직 정책 확정 시 UI 개방 |
| 5 | Q4 승인 권한 주체 | 관리자 전원 | 담당 엔지니어로 좁힐지 |
| 6 | 물리 삭제 승인 절차 | **API 없음**(archive 만) | retention 정책 확정 후 별도 기능 |
| 7 | BDF 주석·파일명의 프로젝트 민감정보 | sanitization 없음 | **기본이 전사 공개라 우선순위 높음** |

### 설계상 감수하는 한계 (지금은 문제 아님 — 규모가 커지면 재검토)

| 항목 | 현재 동작 | 재검토 시점 |
|---|---|---|
| 목록 total 계산 | 보이는 모델을 전부 메모리에 올린 뒤 slice. 태그 필터가 JSON 컬럼이라 DB 이식성 때문에 파이썬에서 거르기 때문 | 등록 모델이 **수천 건**을 넘을 때 |
| `GET /export.json` | 건수 상한 없음. 행은 평면 구조라 1건당 크기는 작다(전체 summary_json 을 싣지 않음) | 위와 동일 |
| 물리 삭제 | **API 없음.** 보관만 가능하며 파일은 계속 남는다 | retention 정책 확정 시 |
| 저장소 용량 | quota 없음. 1건 상한만 `MODEL_REGISTRY_MAX_PACKAGE_MB`(기본 500MB) | 디스크 여유 확인 주기에 맞춰 |
| App Settings 점검 모드 | **대상 아님.** Model Library 는 해석 앱이 아니라 라이브러리라 `ANALYSIS_DATA`·`GUARDED_ROUTES` 어디에도 없다. 즉 **점검 중으로 내릴 스위치가 없다**(권한 통제는 `require_auth`/`require_admin` 이 별도로 한다) | 저장소 이관처럼 계획 점검이 필요해질 때 `GUARDED_ROUTES` 에 `/api/model-registry/` 추가 |

### 이번에 예방 조치한 것 (전부 테스트로 고정)

1. **저장소 루트 표류** — 사용 중인 루트가 선호 순서를 이기고, 바뀌면 경고 로그를 남긴다.
   `MODEL_REGISTRY_DIR` 은 이제 조용한 폴백 없이 절대적으로 우선한다.
2. **보관 후 재등록 불가** — `ARCHIVED_DUPLICATE` + 복원 경로.
3. **보관된 모델에 revision 추가** — 201 인데 목록엔 안 보이던 상태를 자동 활성화로 해소.
4. **중단된 등록의 staging 잔해** — 6시간 넘은 것만 다음 등록 때 정리(진행 중 작업은 보존).
5. **미리보기 무한 대기** — preview/register 에 300초 타임아웃. 없으면 연결이 끊겼을 때
   모달이 영원히 스피너에 갇혔다.
6. **모달 헤더·푸터 잘림** — 공용 `Modal` 패널을 flex 컬럼 + 뷰포트 높이 상한으로 바꿔
   본문만 스크롤한다. 예전에는 본문에만 `max-h-[75vh]` 가 걸려 있어 화면이 짧으면
   **등록 버튼이 화면 밖으로 밀려났다.**
7. **등록본이 git 에 커밋될 뻔한 것** — 로컬 폴백 저장소가 레포 안(`HiTessWorkBenchBackEnd/DataStorage/`)
   이라 gitignore 없이는 `git add -A` 한 번에 등록된 BDF 가 통째로 올라간다.
   `.gitignore` 에 추가했다(`userConnection/` 과 같은 이유).

## 9. 향후 확장 (MVP 이후)

> **아키텍처 모듈 검토는 별도 문서로 분리했다** →
> `docs/operations/model-library-architecture-review.md`
> (Analysis Case/Run 분리 설계·마이그레이션 계획, Feature/Dataset 모듈, 유사 검색)
>
> ⚠ **가장 시급한 구조 문제**: revision 이 '모델 내용'과 '실행 결과'를 함께 담고 있어
> **같은 BDF 를 다른 하중·허용응력으로 두 번 기록할 수 없다.** surrogate 학습 데이터와
> 엔진 회귀 벤치마크가 여기서 막힌다(검토 문서 §1).
>
> **빅데이터·머신러닝 활용은 별도 문서로 분리했다** →
> `docs/operations/model-registry-ml-roadmap.md`
> (가진 데이터·과제별 최소 표본·선택 편향/누수 등 함정·보완할 피처)
>
> 화면에서는 Insight 탭의 「데이터셋 준비도」가 그 진행 상황을 실시간으로 보여 준다
> (`build_dataset_readiness()`). **표본 수를 채워도 클래스가 치우쳤으면 `ready=false`** 다.

MVP 데이터를 실제로 써 본 뒤 별도 계획으로 진행한다.

- **Stage A** 유사 모델 검색 — feature vector + SQL 후보 축소 + Python distance (embedding/vector DB 없이 시작)
- **Stage B** 회귀 벤치마크 — Q4/approved revision 을 엔진 버전별로 재실행해 차이 비교
- **Stage C** 통계·추천 — 최소 표본 수와 동일 분석조건을 만족하는 cohort 에서만, rule-based 부터
- **Stage D** ML/Surrogate — 동일 model family 와 일관된 label 이 충분할 때 별도 타당성 평가.
  train/test 는 revision 이 아닌 **logical model 단위**로 분리해 leakage 를 막을 것.
