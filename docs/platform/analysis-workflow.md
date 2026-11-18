# 해석 작업 흐름, 대시보드, 공통 틀, 작업 탭, 사용 기록

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### 해석 작업 흐름

1. 프론트엔드에서 파일 업로드 → `POST /api/analysis/{type}/request` (type: `truss`, `assessment`, `beam`)
2. 백엔드가 `userConnection/{timestamp}_{employee_id}_{ProgramName}/` 폴더에 파일 저장
3. `app/services/job_manager.py`의 `ThreadPoolExecutor`(최대 5개 동시 실행)에 작업 제출
4. 서비스 파일(`truss_service.py`, `assessment_service.py`, `beam_service.py`, `bdfscanner_service.py`, `hitess_modelflow_service.py`)이 `InHouseProgram/`의 `.exe` 실행
5. 프론트엔드에서 1.5초마다 `GET /api/analysis/status/{job_id}` 폴링 (0~100%)
6. 완료 후 결과 파일 경로를 DB `result_info` (JSON 컬럼)에 저장, `GET /api/download?filepath=...`로 다운로드

**대시보드(2026-09-30 개편, 되돌리기 기준 태그 `dashboard-v1-backup`)**: `pages/dashboard/Dashboard.jsx` = 인사 줄(실행 중·확인할 실패·서버 칩 + '자료' 메뉴) →
공지 한 줄 → **새 해석 시작 | 내 작업**(5:7) → **내 월별 실행 | 많이 쓰는 앱**(5:7, 위아래 경계를 맞춘 같은 격자).
공지 줄·로드맵/소개/영상 모달·섹션 제목은 `dashboardShared.jsx`. 실패 사유는 DB `analysis.job_message`(job_manager 가 마지막 진행 메시지를 기록)를 쓴다.
- **실패 사유 규칙(2026-10-29)** = `utils/dashboardResults.js` `failureReason`(+테스트) — 진행 문구('…중...'·'45%')는 원인으로 쓰지 않고(결과 오류 → 없으면 '마지막 메시지:'),
  '해석 실패'·'Analysis Failed' 같은 일반 문구는 `result_info` 의 구체적 오류를 먼저 쓴다. 한 칸 배치(xl 미만·고배율)에서 확인할 실패가 있으면 '내 작업'을 '새 해석 시작' 위로 올린다.
  같은 날 `/design` 다듬기: 보조 글자 11px·slate-500, 공지 줄 버튼 분리(버튼 안 버튼 제거), 탭·메뉴의 미완성 ARIA 역할 제거, lucide `Map` → `MapIcon`.
  **2026-10-30 커밋(독립 리뷰 막아야 함 0, 진행 문구 `(n/m)`·진행률 % 정규식 보강) · 화면 눈으로 확인 안 함**. 남은 후보(사용자가 이번에 고르지 않음): 실패 → 같은 입력으로 다시 열기, '진행 중 N' 중복·누적 성공률·장식 효과 덜어내기. 비평 기록 `.impeccable/critique/*dashboard-jsx*`(26/40).
- **파일 전달**: '새 해석 시작'에 놓은 파일 → 추천 앱을 고르면 `utils/dashboardFileHandoff.js` 가 파일을 들고 이동하고, 앱 페이지의
  `useDashboardFileHandoff`(1개) / `useDashboardFilesHandoff`(여러 개)가 **그 페이지의 기존 업로드 처리 함수**에 태운다.
  ⚠ 새 파일 입력 앱을 만들면 페이지에 훅을 붙이고 `FILE_HANDOFF_MENUS` 에 메뉴명을 등록할 것(미등록 앱은 추천 목록에 '다시 선택').
  **자동 실행(2026-10-01)**: 파일 적용 뒤 `useDashboardAutoRun(menu, ready, run)` 이 그 페이지의 실행 버튼 핸들러를 한 번 부른다.
  `ready` 는 실행 버튼이 열리는 조건 && **입력 파일 객체**(값이 바뀌어야 다시 판정된다), 대시보드 전달로 들어온 경우만·15초 안에
  ready 가 안 되면 해제. 권상·Side Passage·해상 운송은 'BDF 검증', Model Builder 는 비동기 배정(형제 CSV 스캔) 완료 후 실행.
  ⚠ 훅은 run·ready 에 쓰는 변수 **선언 뒤**에 둘 것(앞에 두면 렌더 시 TDZ 오류로 페이지가 죽는다). 새 앱도 이 훅을 같이 붙일 것.
  ⚠ 대시보드→앱 이동은 fresh-entry 리셋으로 페이지가 1~2번 **재마운트**된다(DashboardContext 가 페이지 상태 삭제, App.jsx 인스턴스 키 증가).
  그래서 보관소는 꺼내도 지우지 않고(TTL 8s), 적용은 60ms 미뤄 언마운트 시 취소한다 — 바로 적용하면 리셋에 지워지거나 자동 배정 토스트가 여러 번 뜬다.
  다중 슬롯 앱의 배정 규칙은 각 페이지 것을 그대로 쓴다(Truss NODE/WAY 파일명, Mooring `load` 파일명, Model Builder 헤더 ori/outdia/cog, 이중관은 UBOLT 행 유무로 탭 선택).
- **내 작업 목록 규칙**은 `utils/dashboardResults.js`(+테스트)에 있다: 같은 앱·같은 입력의 **연속** 실행은 한 줄로 묶고(실패는 안 묶음),
  판정 칩은 결과에 판정 값이 실제로 있는 앱만(Mooring `summary.ok`, 권상 `step1/2_status`, Column Buckling, Carling) 읽는다.
  '확인할 실패' = 최근 7일 실패 중 이후 같은 앱이 성공하지 않은 것 — 상단 칩과 큰 실패 카드가 같은 기준이다.
  **본 실패는 내린다(2026-10-26)**: 큰 카드의 '확인'·'상세·로그'·'같은 앱에서 새로 시작' 또는 상단 칩(실패 목록 이동)을 누르면 그 실패 id 를
  localStorage `workbench:dashboard-ack-failures:<사번>`(최근 200개)에 넣고 칩·큰 카드에서 뺀다 — 목록에는 한 줄 '실패' 표기로만 남는다(사용자 요청: 인지한 뒤엔 눈에 띄지 않게).
  PC별 기록이라 다른 PC 에서는 다시 큰 카드로 보인다(서버 저장은 과하다고 판단).
  ⚠ 새 앱이 판정 값을 내면 `resultHighlight()` 에 한 줄 추가할 것(없으면 칩이 안 뜰 뿐 깨지진 않는다).
- **월별 건수**(`/analysis/stats/monthly`)는 이력 목록과 같은 기준(샘플·권상 세부 검토 제외)이다. 예전 값(세부 검토 포함)과 비교하지 말 것.
- **버전 체크**는 서버 버전이 **더 높을 때만** 업데이트를 요구한다(`utils/versionCompare.js`, App.jsx·LoginScreen 공통) — exe 를 서버보다 먼저 배포해도 새 클라이언트가 막히지 않는다.

**파일 기반 해석 앱 공통 틀(2026-10-01, 기준 앱 = HiTESS Model Builder · GMU 권상)**: 새 앱·기존 앱 개편은 `components/analysis/runFrame/` 부품을 먼저 쓴다.
★ **표준 문서 = `docs/standards/file-based-app-page-standard.md`** — 골격·부품 props·상태 규칙·체크리스트. 새 페이지/개편은 이 문서와 두 기준 페이지에서 더하고 빼서 시작한다.
골격 = 왼쪽 레일(`StepRail` · `InputSummary` · 옵션 · 주 실행 버튼 1개 + 보조 링크) + 오른쪽 작업면(`JobProgressCard` → `VerdictHeader` → `NextActionBar` → 단계 본문 → `EngineLogPanel`).
- **판정은 통과 / 검토 필요 / 실패 한 가지**(색+아이콘+글자). 판정 함수는 순수 함수 + 테스트로 둔다(Model Builder = `utils/modelBuilderVerdict.js`).
  Model Builder '검토 필요' = 질량 있는 입력 행 제외 · 분리 그룹 · 미해결 U-bolt(사용자 결정). 자유단·경고 수는 판정에 쓰지 않되 **숨기지 않는다**(경고 N '판정 미반영').
- **단계 완료는 실제 사건으로만** — 실행 성공 / 판정 통과·'확인함'·편집 적용 / BDF 받기·후속 전달. 탭을 열었다고 완료로 바꾸지 말 것(예전 600ms 가짜 완료 제거).
- 실행이 끝나면 **판정 화면(2단계)으로 이동**한다. ⚠ 옛 코드 주석의 '사용자 요구: 완료 시 1단계로 이동', '경고 화면에서 삭제'는 2026-10-01 사용자가 뒤집었다 — 되살리지 말 것.
- `NextActionBar` 는 판정 머리 **바로 아래**에 둔다. 화면 하단 sticky 로 두면 오른쪽 아래 전역 작업·메시지 도크가 주 버튼을 가린다(실측). 페이지 루트는 `pb-28`.
- 편집 적용 등 긴 후속 작업에 **전체 화면 잠금 오버레이를 쓰지 않는다** — 해당 패널 안 `JobProgressCard` + 결과에 의존하는 버튼만 잠근다.
- **재실행**: 실행 후 주 버튼은 '옵션 바꿔 다시 실행'. 브라우저에 File 이 있으면 다시 올리고, 없으면 `POST /api/analysis/{id}/rerun` 에 옵션 덮어쓰기(`mesh_size`·`ubolt_full_fix`·`run_nastran`, 현재 Model Builder 만 읽음)를 보낸다. 빈 본문 `{}` 은 원본 옵션 그대로(My Projects 호환).
- **결과 다시 열기**: `utils/resultReentry.js` — My Projects 상세 '결과 화면에서 열기'와 대시보드 '내 작업' 행(성공·파일 보관 중)이 `offerResultReentry(menu, id)` 후 이동, 페이지의 `useResultReentry` 가 `GET /api/analysis/{id}` 의 result_info(산출 폴더)로 결과 상태를 복원한다. 새 앱을 붙이려면 `RESULT_REENTRY_MENUS` 등록 + 페이지에 훅.
- 보조 텍스트 최소 11px · slate-500 이상, 자간 대문자 라벨·그라데이션 카드·2px 색 테두리·측면 색 띠·이모지 금지(대시보드 2026-10 문법과 동일). 비평 기록: `.impeccable/critique/*hitessmodelbuilder*`.
- **적용 앱 2호 = GMU 권상**(`GroupModuleUnitLiftingAnalysis.jsx`, 2026-10-01). 단계 = BDF 입력 검증 → Studio 권상 검토 → 결과·보고서.
  판정은 두 시점: 검증 직후(`basis:'validation'` — 오류·Nastran FATAL=실패, 분리 그룹=검토 필요) / Studio 구조 해석 후(`basis:'structural'`, 우선).
  구조 판정 규칙은 `utils/gmuLiftingVerdict.js` 와 Electron `viewer:runUnitStructural` 의 status 계산이 **같아야 한다**(재진입 때 DB `result_info.summary` 로 다시 계산). 한쪽 고치면 양쪽 다.
  **BDF 구간 경계 검사·자동 수정(2026-10-02)**: 검증이 `services/bdf_deck_check.py` 로 Executive/Case Control/Bulk 경계를 보고 step1 JSON `deckIssues` 에 싣는다 —
  `missing_begin_bulk`(경고) · `case_control_in_bulk`(오류, SOL·CEND·SUBCASE·'키 = 값' 줄이 Bulk 안에 있음). 고칠 수 있는 문제가 있으면 판정은 최소 '검토 필요'이고 화면은 1단계에 남아
  '다음 행동 바'에 'BDF 자동 수정 후 다시 검증'을 띄운다 → `window.confirm` 으로 무엇을 고치는지 보여 준 뒤 `POST /api/analysis/groupmoduleunit/{id}/deck-fix` 가
  **새 작업 폴더에 같은 파일명의 수정본**을 만들고 검증 작업을 띄운다(원본 불변, 고치지 않은 줄은 latin-1 로 바이트 그대로). 이후 '다시 검증' 입력은 수정본(`handoffBdfPath`)이다.
  실례: `3542_m09.bdf` 는 BEGIN BULK 가 없어 검증은 통과했는데 Wire 포함 구조 해석에서 Nastran FATAL 9994/300 — nastran_bridge `bulk_start_index` 도 함께 고쳐 이제는 그대로 둬도 해석된다.
  새 검사 규칙은 이 모듈에 추가하고, 오탐 확인은 `userConnection/**/*.bdf` 전수 스캔으로 할 것(도입 시 925개 중 오탐 0).
  **Wire 포함 권상 BDF 를 입력으로 다시 올리면 검증이 막는다 (2026-11-11, `697b6cd` · WorkBench 1.7.19 — GMU·Side Passage·해상 운송 검증 공용)** — 덱 검사 `lifting_output_input`(오류·자동 수정 없음):
  `TITLE = HiTessWorkBench Lifting Analysis` 또는 `SPC1 990001` + `GRAV 990002`(bridge `build_lifting_bdf` 표식 — 바꾸면 `bdf_deck_check.py` 도).
  실례 3469 M02(A508701): `_lifting.bdf` 를 다시 올려 이전 Wire CROD 8개·훅 절점이 남았고, 편집 BDF 에서 CBEAM → PROD 132 로 FATAL 2010.
  함께 bridge `convert_json_to_bdf` 가 **PROD 를 참조하는 요소는 type 과 무관하게 CROD** 로 쓴다(MU Studio 는 선 요소 type 을 'BEAM' 으로 통일, 원래 카드는 `cardType`).
  70 userConnection BDF 322개 중 오탐 0. 반영 = 백엔드 `git pull + 재시작` + **InHouse `NastranBridge/nastran_bridge.py` 145 수동 교체**. 확인 = 변환 결과 CROD 8개 · 그 8줄을 CROD 로 바꾼 Wire BDF 실제 Nastran FATAL 0 · 백엔드 전체 시험 통과(`AUTH_MODE=` 로 덮어써서 — 70 `.env` 의 AD 모드가 `test_auth_contract` 를 깨뜨림). Studio 안 편집 → 재해석 흐름은 안 함, 커밋 전 독립 리뷰 미실행.
  **PARAM BAILOUT 은 사용자에게 주는 권상 BDF 에 넣지 않는다 (2026-10-27, 사용자 요청)** — BAILOUT 은 mechanism(연결이 끊긴 부분)이 남아도 계속 풀게 한다.
  실측: 3454-35020 권상 BDF 가 BAILOUT 으로 '정상 종료'했지만 최대 변위 1.27e13 mm(검증 BDF 6.3e12 mm), 빼면 FATAL 9050.
  정상 모델 3496·3542 는 있든 없든 결과가 같았다(검증·Wire 해석 모두 백엔드 실제 경로로 확인). 그래서:
  ① Wire 포함 BDF(bridge `build_lifting_bdf` = 다운로드·해석 공용 최종본)의 안정화 PARAM 은 **AUTOSPC 만**,
  입력에서 온 PARAM BAILOUT(Case Control·Bulk, 자유·고정·큰 필드)도 지운다(`param_name`/`bdf_param_name` 같은 규칙, 메타 `removedInputBailout`).
  ⚠ **검증 BDF(`_ensure_validation_stabilization_params`, `_validation.bdf`)는 BAILOUT 을 유지한다**(리뷰 후 되돌림, 사용자 확인 2026-10-28) —
  검증은 최저 Z 노드만 임시 구속해 떨어진 소그룹이 mechanism 이 되므로, 빼면 FATAL 9050 '실패' 로 끝나 그 소그룹을 고치는 Studio 에 못 들어간다.
  검증 변위는 판정에 쓰지 않고, `_validation.bdf` 는 다운로드 목록(`lifting_artifacts.ARTIFACT_SPECS`)에 없다. 두 곳을 같은 정책으로 '통일'하지 말 것.
  ② 입력에 있으면 덱 검사 경고 `bailout_param`(자동 수정 아님) → 판정 '검토 필요' + 단계 힌트 '통과 · PARAM BAILOUT 제외'.
  ③ `unit_structural_service._FATAL_HINTS` 9050 = 연결 끊김/구속 부족(Studio Model Check 안내), 2101 = RBE 종속 자유도에 SPC(UM·US, 실측),
  5289 = 종속 중복(예전 2101 문구가 틀렸었다). 해상 운송(`module_ocean_bdf`)은 BAILOUT 을 유지하고 피벗비 점검(`trustworthy`)으로 거른다 — 범위 밖.
  ⚠ 입력 BDF 의 `PARAM MAXRATIO 1.0+15`(예: 3542_m09)도 피벗비 검사를 사실상 끄는 설정이다 — 아직 손대지 않았다.
  구조 해석 실패 시 job.message 는 고정 문구가 아니라 원인이다(`unit_structural_service.describe_f06_fatal` — FATAL 건수·코드·첫 메시지). Studio 는 이 문구를 '실행 실패' 옆에 보여 준다.
  단계 상태는 저장하지 않고 사건(검증 결과·Studio 열기·`viewer:unit-structural-completed`·산출물/보고서 받기 = `ResultArtifactsCard onDownloaded`)에서 매번 계산한다.
- **첫 화면(입력 전)은 `runFrame/RunStartPanel`** — 진행 순서(단계별 하는 일) + 이 앱의 내 최근 실행 5건(`program_name` 필터, '결과 열기' = 페이지의 `applyResultReentry`,
  '입력 불러오기' = 페이지의 `applyRecentInput` — 실패한 실행도 허용, 보관 만료면 끔). 입력 경로는 `input_info` 에서 읽는다:
  GMU `bdf_model` → 다시 올리지 않고 `handoffBdfPath`(request-from-path), Model Builder `stru/pipe/equip_csv` → `/api/download` 로 받아 File 로 만들어 칸에 넣는다(옵션도 그 실행 값).
  첫 화면에서만 레일의 `xl:self-start` 를 풀어 두 칸 높이를 맞춘다(화면 높이까지 늘리지 않는다 — 늘리면 카드 안이 다시 빈다). 입력 칸이 덩그러니 있는 빈 화면을 꾸밈으로 채우지 말 것.
- **적용 3·4호 = Truss Model Builder · Truss Structural Assessment**(2026-10-02). 판정 = `utils/trussVerdict.js`(+테스트).
  Assessment 의 Side Support 허용 반력 `SIDE_SUPPORT_ALLOWABLE` 은 이 파일 한 곳 — 결과 표(`AssessmentResultTable`)도 여기서 import 한다.
  예전 검은 콘솔은 `runFrame/RunLogPanel`(접힘, 실패 시 펼침)로 바꿨다. `AssessmentProjectModal` 에 `onDownloaded`·`onOpenResult`(My Projects '결과 화면에서 열기') prop 추가.
- **작업 탭(2026-10-02) — Model Builder · GMU 권상** — 한 페이지에서 그 앱의 해석 과정을 **최대 4개 동시에** 진행한다(탭별 Studio 창·탭별 Job Center 기록).
  페이지 컴포넌트 = 배너 + `WorkspaceTabBar` + `WorkspaceFrame` 안에 탭마다 작업 화면 1개(`ModelBuilderWorkspace` / `GmuLiftingWorkspace` = 예전 페이지 본문).
  숨은 탭도 언마운트하지 않아 폴링이 계속 돈다. 탭 UI·저장 훅은 `runFrame/WorkspaceTabs.jsx`(`useWorkspaceStore`), 탭 규칙은 `utils/appWorkspaces.js` 의
  `createWorkspaceKit({ isIdle })` + 앱별 `utils/modelBuilderWorkspaces.js` · `utils/gmuLiftingWorkspaces.js`(+테스트).
  저장소는 DashboardContext `modelBuilderPageState` · `gmuLiftingPageState`(`{activeId, workspaces, states}`). GMU 는 더 이상 `analysisPageStates[GMU]` 를 쓰지 않는다.
  **다른 앱에 붙일 때**: kit(isIdle·label·status) + 컨텍스트 저장소 + `resetAnalysisEntryState` 의 freshEntry + 페이지 분리 + `MULTI_INSTANCE_VIEWERS` 등록.
  - **메뉴 재진입은 탭을 지우지 않는다** — 진행 중·결과 있는 탭은 남기고 빈 탭을 하나 열어 그리로 간다. 대시보드 파일 전달·결과 다시 열기·**다른 App 연계(gmuHandoff)** 는
    **마운트 시점에 활성이고 비어 있던 탭만** 받는다(`useDashboardFileHandoff`·`useDashboardFilesHandoff`·`useDashboardAutoRun`·`useResultReentry` 의 `enabled` 인자).
    탭이 가득 차면 토스트로 알리고 GMU 연계 BDF 는 버린다. ⚠ '가득 찼는가'는 **마운트 시점 값**(`entryBlocked`)으로 판정할 것 — 미뤄서 보면 방금 전달을 받은 빈 탭이 채워져 있어 오판한다(실측).
  - **Studio 는 모델마다 창이 따로다** — Electron `viewer-sessions.js` 의 `MULTI_INSTANCE_VIEWERS`(`model-studio`·`module-unit-studio`)는 세션 키가 `viewerId::sourceKey`
    (MB = 산출 폴더, GMU = 검증한 서버 BDF 경로). 다른 Studio 는 viewerId 당 창 1개. 탭에서 재빌드·재검증 후 Studio 를 다시 열면 그 탭의 옛 모델 창을 닫는다.
  - ⚠ **Studio → WorkBench 이벤트는 반드시 탭을 특정해서 받는다.** 탭이 여러 개라 '현재 페이지 상태' 로 처리하면 **다른 탭 모델에 오류 없이 적용된다.**
    MB `modelflow:finalize-edit-request` = 세션 `outputDir` ↔ 탭 `bdfResult.outputDir`(탭이 닫혔으면 페이지가 Studio 에 실패 회신).
    GMU `viewer:unit-structural-completed` = `parentAnalysisId` ↔ 탭 `bdfAnalysisId`(`isOwnStructuralEvent` — id 가 없으면 받지 않는다. 예전 코드는 id 가 없을 때 통과시켰다).
  - **작업 번호(1~4, `ws.slotNo`)가 탭의 고정 정체성**이다 — 번호별 색 칩, 이름 `작업 N · <입력 파일 이름>`을 탭·Job Center 카드·**Studio 창 제목**
    (`viewer:open` 의 `windowTitle`)이 함께 쓴다. 탭을 닫아도 다른 탭 번호는 그대로, 새 탭은 빈 가장 작은 번호. 위치 순번으로 바꾸지 말 것(이미 뜬 Studio 창 제목과 어긋난다).
  - 탭 모양 = 폴더 탭(활성 탭이 `bg-slate-50` 작업 영역과 이어짐) + 작업 영역 머리(`작업 N · 이름 · 상태`). 상태 문구는 앱별 `statusText` 로 바꾼다.
  - Job Center 는 `startGlobalJob(jobId, menu, { slot, label })` 로 **탭당 1개** 기록(같은 App 이라도 slot 이 다르면 공존). 카드를 누르면 `workbench:job-slot-focus` 이벤트로 그 탭으로 간다.
  - ⚠ Electron 변경이 있어 **WorkBench exe 재빌드가 있어야 Studio 다중 창이 동작**한다(웹 쪽 탭·동시 실행은 프론트만으로 동작).
- **Studio 열기 카드는 공용** `runFrame/StudioLauncherCard`(Model Builder·GMU 공통). 앱마다 그라데이션 카드를 새로 만들지 말 것.
- **결과 다시 열기 조건**은 `canOpenResult(project)` 한 곳 — 앱마다 기준 키가 다르다(Model Builder `output_dir`, GMU `bdf`). 새 앱은 `RESULT_KEYS` 에도 등록.
- ⚠ **앱 페이지는 전부 keep-alive**(`App.jsx KEEP_ALIVE_MENUS`)라 window 키 단축키(Ctrl+Enter)는 `currentMenu === 자기 메뉴`일 때만 반응하게 할 것 — 안 그러면 다른 앱 화면에서 숨은 페이지의 실행이 눌린다.
- `ValidationStepLog`(BDF 검증 본문, BdfScanner·GMU·Side Passage·해상 운송 공용)도 같은 문법으로 바꿨다: 근거 없는 '건전도 %' 게이지 삭제, 카드 분류는 표. 미참조·고립 GRID 는 엔진이 오류로 세지 않으므로 **경고**로 표시한다(판정 머리와 같은 기준). 공통 틀 페이지 안에서는 `bare` prop.

**사용 통계 합산(2026-09-30)**: 권상 App 의 세부 검토 레코드(`ModuleStability`·`ModuleHoistOptimize`·`UnitStructuralAnalysis`)는
통계에서 부모 App(`GroupModuleUnit`/`SidePassage`) 한 줄로 합산되고 세부 건수는 `steps`/`stepBreakdown` 으로 나간다
(대시보드 Top·Analysis Management·프로그램 상세 모달·Usage Reports 4곳 공통, 규칙은 `services/usage_rollup.py`).
부모 판별: UnitStructural = `input_info.parent_analysis_id`, 나머지 = `input_info.posture` 경로의 `<ts>_<사번>_<부모>` 폴더명
(Studio 가 보내는 `source` 는 두 App 모두 `ModuleUnitStudio` 라 못 쓴다). ⚠ 새 세부 검토 program_name 을 만들면 `SUBSTEP_LABELS` 에 등록할 것.

**해석 오류 유형 기록(2026-10-02)** — 반복되는 Nastran/엔진 오류를 코드로 막아 가기 위한 영구 기록. 절차·규칙 원본: `docs/operations/nastran-diagnostics.md`, 대응 스킬 `/nastran-triage`(70 로컬).
작업 종료(`mark_complete`·Model Builder 편집 적용)마다 `services/nastran_diagnostics.py` 가 F06 FATAL/WARNING·엔진 실패를 DB `diagnostic_signatures`(유형)·`diagnostic_occurrences`(발생)에 쌓고,
**처음 보는 유형(또는 handled 후 재발 = regressed)일 때만** 입력 BDF·F06 발췌를 `DataStorage/DiagnosticsArchive/cases/` 에 보관한다(30일 정리 제외). 경고는 세기만 한다.
유형 = Nastran **코드 + 모듈**(본문으로 묶으면 한 원인이 수십 유형으로 갈라진다), 연쇄 코드(6498·6624·9002·208·102·285)는 원인 FATAL 이 있으면 뺀다,
F06 은 **작업 시작~끝 사이**만(권상 계열은 부모 GMU 폴더를 같이 써서 다음 작업 F06 을 가져가는 오귀속이 실측됐다).
운영(145) 기록은 70 에서 `scripts/pull_diagnostics.py`(관리자 사번 로그인, 로그아웃 안 함 — 로그아웃 API 가 외부 앱 세션을 끊는다)로 가져오고 대응 후 `mark` 로 handled 표시.
⚠ 새 Nastran 실행 경로가 `mark_complete` 를 안 거치면 `schedule_collection(job_id, …, extra_dirs=[산출 폴더])` 를 직접 부를 것(편집 적용이 그 예). 테스트는 conftest 가 `HITESS_DIAGNOSTICS=0` 으로 끈다.

**HiTESS Story 영상 — 보호 재생 (2026-10-26)** — 저작권 때문에 영상 파일을 넘기지 않고 WorkBench 안에서만 보게 한다.
- 백엔드 `routers/videos.py`: `GET /api/videos`(목록) → `POST /api/videos/{id}/ticket`(로그인 사용자에게 3시간짜리 서명 표 + 워터마크 '이름 사번', 시청 기록 `VIDEO_PLAY`)
  → `GET /api/videos/stream/{id}?t=`(Range 지원). **`/static/videos` 공개 경로는 없앴다** — 되살리지 말 것(`test_database_lifecycle` 이 잡는다).
  표의 비밀값은 프로세스마다 새로 만들어 재시작하면 재생 중이던 창은 다시 열어야 한다.
- 영상 추가 = 서버 `HiTessWorkBenchBackEnd/Videos/`(git 미추적)에 mp4 + 같은 폴더 `videos.json`(`[{file,category,title,subtitle}]`, 순서=목록 순서). 재시작 불필요.
  **목록 화면은 category 별 묶음**(2026-10-26 오후, 분류 = HiTESS 소개 · 구조 해석 · 생산 지원 자동화) — 묶음 제목에 편수·전체 길이, 행마다 제목·설명·재생 시간.
  재생 시간은 서버가 mp4 `moov/mvhd` 에서 읽는다(`_mp4_duration`, 못 읽으면 표시 안 함). 묶기·시간 표기 = `utils/videoCatalog.js`(+테스트).
  `videos.json` 이 없으면 파일명에서 `HiTESS-`·`_` 를 걷은 제목 + '기타 영상' 한 묶음이 된다 — 145 에서 파일명 제목이 보이면 `videos.json` 이 안 들어간 것이다.
- Electron `electron/video-window.js`: 영상 전용 창에만 `setContentProtection(true)`(캡처·녹화·화면 공유에 검게 나감), 메모리 세션에서 다운로드 취소,
  새 창·이동 금지, 패키징본 개발자 도구 끔, 영상 위 떠다니는 워터마크, 전체 화면은 영상+워터마크 무대째로. ⚠ 본체 창에는 걸지 않는다(Teams 원격 지원 화면이 검게 나감).
  휴대폰 촬영·가상머신·캡처보드는 못 막는다 — 워터마크는 그때 누구 화면인지 남기려는 것이다.
- 브라우저·옛 exe 에서는 재생하지 않고 '최신 WorkBench 앱에서만' 안내만 한다(보호 없는 재생 경로를 만들지 않으려고). 로그아웃 때 영상 창도 닫는다.
- 상태(2026-10-26): 커밋·릴리스에 포함(백엔드 1760 통과, Electron 검증 3건, 독립 리뷰 반영 — 영상 응답도 Content-Length 없이 chunked, 본체 종료 시 영상 창 닫기). 영상 창·캡처 차단은 **눈으로 확인 안 함**.
  배포 순서 = **새 exe 먼저**(서버를 먼저 올리면 옛 exe 의 영상이 404) → 145 `Videos\` 에 mp4 10개 + `videos.json` 수동 복사 → ⟳ Update.

**사용자 유입 시험 기능 3종 (2026-11-03, 미커밋·확정 대기)** — 목표는 체류 시간이 아니라 재방문과 앱 확산이다(10월 실행의 72%가 상위 7명, 80%가 상위 3개 앱). 사용자가 확인 후 기능별로 확정하거나 뒤로 돌린다. 쇼츠 라이브러리(`claude-animated-shorts`)는 쓰지 않기로 했다(Remotion 유료 라이선스).
- **결과 공개 연출·권상 재생**: Module Unit Studio 0.0.182(70 로컬, 핀 동기화, 145 미공개). 모델이 바닥에서 들려 올라오며 와이어가 해석 장력 색으로 바뀐다. 들리는 동작은 연출이고(화면에 표시) 색·변형·장력만 해석 결과다. `data/resultReveal.js`(+테스트) · `three/ResultRevealOverlay.js` · `components/ResultRevealStamp.jsx`, 해석 완료와 결과 도크 '다시 재생'에서만 재생. 판정 규칙은 Electron·`gmuLiftingVerdict.js` 와 같아야 한다.
  ⚠ 연출 동안 기본 모델·절점을 숨긴다 — 절점 빨강이 응력 초과로 읽혔다. 변형은 과장이라 배율을 항상 표시한다.
- **해석 실패 위치 안내 (2026-11-03)**: FATAL 9050 본문에는 번호가 없고 앞선 경고 4698 표가 문제 절점을 말한다. `services/f06_location.py` 가 실패 문구에 `위치 후보 절점: …` 을 붙이고(Electron 무수정), Studio `data/structuralFailure.js` · `StructuralFailureGuide.jsx` 가 읽어 카메라를 옮기고 표식한다. 낱말을 바꾸면 양쪽 다 고칠 것.
  **떨어진 부재 묶음 안내 (MU 0.0.205, 2026-11-10, 릴리스 표 `821e150`·MU `ee7fcb9` — 145 ⟳ Update 는 사용자 몫, 화면 눈으로 확인 안 함(렌더 시험만))**
  리뷰 '고치면 좋음' 미반영: 이을 자리 계산이 묶음×본 구조 절점 전수(큰 모델 편집 때 느려질 수 있음) · 묶음 절점이 전부 RBE 에 걸려 있으면 걸린 절점을 제안(패널이 종속 중복으로 막음 → link 없이 '지우기'만 보일 것) · 이 경로 RBE 의 remark 기본값 UBOLT. — 실패 절점이 본 구조와 이어지지 않은 묶음에 있으면 카드에 묶음 크기·가장 가까운 이을 자리를 보이고
  [RBE 로 잇기](본 구조 절점 = 독립으로 채운 RBE 패널) · [묶음 지우기](그 부재를 고른 삭제 패널)로 Edit 탭에 넘긴다. 확정은 사용자(분리 그룹 자동 차단·자동 연결 안 함 결정 유지).
  연결은 편집 모델로 다시 센다(`structuralFailure.detachedFailureGroups` — 원본 그룹은 RBE 삭제·추가를 모름). 실례 3469 M02: N737 평강 4개 묶음, 자리 N738 ↔ N2805 40 mm(그 RBE 로 Nastran 정상 종료 확인).
  실측: 3454 실제 F06 → 9곳 전부 모델에서 찾음. 표가 없는 오류(9994·2101·5289 등)는 위치 안내 없이 기존 문구만 나온다(2101·5289 는 실제 F06 샘플이 없어 미구현). 후보는 Nastran 이 지목한 절점이지 고칠 자리 확정이 아니다.
- **대시보드 '3D 보기'**(코드명 ModelWall, 화면에 '모델 벽'이라 쓰지 말 것 — 사용자 지시): `GET /api/analysis/{id}/model-preview` 는 서버가 기록에서 BDF 를 고르고(`find_model_bdf`), 썸네일은 브라우저가 그려 IndexedDB 에 둔다. 같은 앱·같은 BDF 이름은 최신 1칸.
  실패는 기억하지 않는다 — '다시 시도' 또는 보기 전환으로 다시 그리고, 실패 칸은 '미리보기 없음' + 안내 줄로 말한다.
- **앱 카드 미리보기**: `Videos/previews/` 무음 클립 8개 + `previews.json`(git 미추적, 145 수동 복사), `GET /api/videos/previews` · `preview-stream`. 로그인 표는 쓰지만 `VIDEO_PLAY` 는 남기지 않고, 녹화 방지·워터마크는 없다(보호 수준은 사용자 판단 대기). `AppCard`·대시보드 타일(`QuickAppTile`) 공용 훅 `hooks/useAppPreviewClips.js`. 대시보드는 계속 떠 있어 목록이 비면 60초마다, 있으면 1시간마다 다시 받는다(재생 표 3시간 만료).
  HiTESS Model Builder 클립은 권상 쇼릴 18~26초라 `HiTESS Module Unit` 머리글이 보인다.
- **상태**: 9091 은 `--reload` 인데도 새 경로를 읽지 못해 404 였다가, 재시작 뒤 새 경로가 401 로 응답한다(F06 위치 문구 수정까지 읽었는지는 미확인). 임시 서버 + Chrome 으로만 확인했고 Electron 앱·실제 Nastran 완료·실패 시점·남의 작업 403 은 미확인. 세 기능 + 실패 안내 모두 사용자 확정 전.

**사용 기록 — 접속 이력·화면 오류·해석 소요시간 (2026-10-20)** — `activity_logs` 는 30일 뒤 지워지고 `user_presence` 는 현재값뿐이라, 장기 기록을 따로 둔다.
- **접속 이력 `access_sessions`**(기간 제한 없음): 로그인~앱 닫기 1행. 하트비트(45초)마다 `services/access_session_service.record_heartbeat` 가
  직전 간격을 `online_seconds` 에, 유휴(3분)가 아니면 `active_seconds` 와 **직전 화면**의 `page_seconds` 에 더한다(화면 이동 즉시 하트비트라 간격 = 직전 화면 몫).
  간격이 150초를 넘으면 새 세션. 닫는 곳 = 로그아웃(logout)·창 닫기 beacon(closed)·강제 로그아웃(forced)·재로그인(relogin)·정리 스케줄러/다음 하트비트(timeout).
  PC 정보(`hostname`·`os_user`·`platform`)는 Electron `app:client-info` → 하트비트 `client` 로 온다. 관리 화면 = User Management '접속 이력'(`/api/presence/sessions[/summary]`).
  ⚠ 임계값(150·180초)은 `presence.py` 와 같아야 한다(`test_thresholds_match_presence_router`).
- **화면 오류 `CLIENT_ERROR`**(activity_logs, 30일): React `window.onerror`·`unhandledrejection`(`api/clientTelemetry.js`, 같은 메시지 3회·세션 30건 상한)과
  Electron `render-process-gone`·`child-process-gone`(main 이 userData `pending-client-errors.json` 에 쌓고 다음 로그인 때 화면이 꺼내 보냄).
  `POST /api/activity/client-error` 는 로그인 전 오류도 받으려고 **인증 없음**(유효 토큰이면 사번, IP당 분당 20건).
- **`analysis.finished_at`**: `_write_through`·`record_analysis` 가 Success/Failed/Cancelled 때 기록. 소요시간 = finished_at − started_at. 도입 전 기록·Interrupted 는 NULL.
  화면 표시는 하지 않는다(2026-10-20 사용자 결정 — 필요 없음). 기록만 유지.
- 배포(2026-10-20): v1.6.21(`733d3dc`). 145 Server Manager ⟳ Update 와 exe 배포는 사용자가 한다. 접속 이력 패널·exe 실행은 눈으로 확인 안 함.
- 강제 로그아웃은 이제 `FORCE_LOGOUT` 감사 로그를 남긴다. ⚠ PC 정보·크래시 수집은 **새 exe 부터** 동작한다(Electron 변경).

작업 상태는 인메모리(`job_status_store`)가 1차 저장소이고, status·progress·message 는 변경마다 DB `analysis.job_status/progress/job_message` 에 write-through 된다(`_write_through`). 상태 조회 API 는 메모리에 없으면 DB 값으로 응답하고, 서버 시작 시 Pending/Running 으로 남은 레코드는 `Interrupted`(실패)로 바뀐다(`main.py` lifespan). 재시작 시 잃는 것은 실행 중이던 프로세스 자체와 대기열 순번·취소 핸들뿐이다 — Redis 는 필요 없다(2026-10-19 확인).

**다운로드 보안**: `GET /api/download`는 `os.path.abspath` 프리픽스 검사로 `userConnection/` 디렉토리 외부 경로 접근을 차단합니다.

**Excel 내보내기**: `GET /api/analysis/export-xlsx`는 TrussAssessment JSON 결과를 BytesIO 메모리에서 XLSX로 변환하여 반환합니다. 디스크에 저장하지 않아 회사 DRM 소프트웨어의 자동 암호화를 우회합니다.
