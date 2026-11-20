# CLAUDE.md

이 파일은 Claude Code(claude.ai/code)가 이 저장소에서 작업할 때 참고하는 지침서입니다.

## 프로젝트 개요

**HiTESS WorkBench**는 사내 구조 해석 플랫폼입니다. 기존의 레거시 구조 해석 실행 파일(`.exe`)들을 현대적인 웹 UI로 감싸고 AI 어시스턴트를 결합한 시스템으로, Electron 데스크톱 앱(포터블 `.exe`)으로 배포되며 팀 공용 서버와 통신합니다.

## 디자인 컨텍스트 (Impeccable)

UI/디자인 작업 시 다음 문서를 우선 참고합니다 (impeccable 디자인 도구로 관리):

- **`PRODUCT.md`** (repo 루트) — register=`product`, 사용자·목적·브랜드 personality(신뢰·정밀·전문 엔지니어링)·anti-reference(낡은 레거시 엔터프라이즈 회피)·디자인 원칙 5가지·접근성 기준
- **`DESIGN.md`** (생성 시) — 시각 시스템: 브랜드 컬러(Trust Blue `#002554` 등)·타이포(Inter+SUIT)·컴포넌트 토큰
- 디자인 의사결정은 DESIGN.md(시각) > PRODUCT.md(전략/보이스) 순으로 우선. `/impeccable` 명령으로 critique·polish·live 등 수행

## 개발 명령어

### 백엔드 (FastAPI)

```bash
# 가상환경 활성화 (Windows)
HiTessWorkBenchBackEnd/WorkBenchEnv/Scripts/activate

# 개발 서버 실행 (HiTessWorkBenchBackEnd/ 에서)
uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload

# 70 개발 PC 바로 실행 (2026-11-10, 미커밋 · 바탕화면 바로가기 3개)
#   Dev_All_70.bat                       = 백엔드 + 클라이언트를 각자 새 창으로
#   HiTessWorkBenchBackEnd/Dev_Server_70.bat = 백엔드만(9091 이 이미 떠 있으면 그 uvicorn 트리를 끌지 묻는다, 보조 scripts_dev_find_9091.ps1)
#   HiTessWorkBench/Dev_Client_70.bat    = npm run dev 만(5173 이 이미 떠 있으면 묻는다)
#   ⚠ PyCharm 터미널에서 백엔드를 띄우지 말 것 — 백엔드가 부르는 파이썬이 DRM(HIDRMH.DLL)에서 0xC0000005 로 죽는다(전역 CLAUDE.md '이 PC 환경').

# 의존성 설치
pip install -r requirements.txt
```

### 프론트엔드 (React + Vite)

```bash
# 개발 서버 단독 실행 (HiTessWorkBench/frontend/ 에서)
npm run dev

# Electron 패키징용 빌드
npm run build
```

### Electron 데스크톱 앱

```bash
# 전체 개발 환경 실행 (HiTessWorkBench/ 에서)
# concurrently로 React 개발 서버(5173 포트)와 Electron을 동시에 실행
npm run dev

# 배포용 포터블 .exe 생성
npm run dist
```

### 커밋 전 점검 — 테스트·빌드 통과로 끝내지 않는다

v1.5.8 에서 결함 6건이 새어 나갔고 3건을 사용자가 먼저 찾았다(MySQL 정렬 버퍼 500 · lucide `Map` 아이콘이 전역 `Map` 을 가린 크래시 · 재시작 안 한 라우터 404).
백엔드 테스트는 **SQLite** 라 MySQL 고유 실패를 못 잡고, 프론트는 컴포넌트 테스트가 없다. 그래서 커밋 직전에:
1. 백엔드 테스트 + `npm run build` + `node --test src/utils/*.test.js`. 그 위에 **변경이 닿는 화면을 나열하고 그 화면이 부르는 API 를 실제로 1회씩 호출**한다.
2. DB 모델 변경 시 — `schema_bootstrap` 멱등 보강, 그 테이블을 `ORDER BY` 하는 목록 쿼리에 JSON/TEXT 가 끼는지, 목록 API 를 작은·큰 limit 로 두 번 호출.
3. 새 라우터 — `main.py` 등록 + 실제 재시작 후 200, 필요하면 `GUARDED_ROUTES` 등록.
4. 프론트 — 아이콘 이름이 JS 내장(`Map`/`Set`/`Image`)과 겹치지 않는지, 서버 실패 때 로컬 값을 덮어쓰지 않는지.
5. 커밋 메시지 끝에 배포 영향 한 줄(`git pull + 재시작` / `프론트 재배포` / `InHouse 수동 교체 <파일>` / `없음`).
6. 운영 오류는 추측하지 말고 traceback 부터 확보한다.
7. 코드 변경 커밋 직전 `hitess-code-reviewer` 에이전트를 diff 범위로 1회 돌린다(작업 의도는 넘기지 않는다 — 독립 리뷰가 목적). '막아야 함'이 나오면 고친 뒤 커밋하고, 문서만 바뀐 커밋은 건너뛴다.
상세 계획: `docs/operations/regression-prevention-master-plan.md`.

### 사본 동기화 표 — 한쪽을 고치면 같이 고칠 곳 (2026-11-13 모음)

같은 규칙이 저장소나 언어가 달라 두 벌 이상 있는 곳이다. 이 프로젝트에서 운영까지 새어 나간 결함의 단골 유형이라 고치기 전에 여기부터 본다. 상세는 각 절에 있다.
**원본**이 있는 줄은 원본을 먼저 고치고 사본에 옮긴다. 새 사본을 만들면 이 표에 한 줄 더한다.

| 무엇 | 원본 | 사본 (같이 고칠 곳) | 지키는 장치 |
|---|---|---|---|
| MB 와 MU Studio 공용 파일(44개, `findEntity.js` 는 MF 까지) | 어느 쪽이든 | 짝 Studio | `python scripts/studio_pair.py` (`same`) |
| MB 편집 intent kind | Studio 미리보기 | C# 엔진, 계약 테스트 | `test_modelbuilder_edit_contract.py` |
| 호선 정규화(대문자, 20자) | C# `FeModel.NormalizeHullNo` | bridge `normalize_hull_no`, 백엔드 `services/hull_no.py`, 프론트 `utils/hullNo.js` | 없음 |
| 비정상 종료 판정과 문구 | 백엔드 `services/exit_codes.py` | 프론트 `utils/abnormalExit.js` | 프론트 테스트 |
| 장비 COG 경고 메시지 키 | 엔진 `CheckEquipmentCogDistance` | `utils/modelValidation.js` `parseEquipmentCogFar` (WorkBench, Studio) | 없음 |
| 입력 행 제외 사유 문구 | WorkBench `pages/analysis/HiTessModelBuilder.jsx` `REASON_LABELS` | MB Studio `data/excludedRowGhosts.js`, `data/csvRowMapping.js` | 없음 |
| GMU 구조 해석 판정 | `utils/gmuLiftingVerdict.js` | Electron `viewer:runUnitStructural` status 계산 | 없음 |
| Unit 권상 보고서 입력 폼 | 프론트 `utils/unitLiftingReport.js`, `UnitLiftingReportDialog` | Studio `unitLiftingReportForm.js`, `UnitStructuralReportDialog` | 없음 |
| 해석 실패 위치 문구(`위치 후보 절점:`) | 백엔드 `services/f06_location.py` | MU `data/structuralFailure.js`, MF `utils/solveFailure.js` | 없음 |
| MF 강재 등급과 판정 | 엔진 `SteelGrade` | 백엔드 `judge_member` | 없음 |
| MF 새 단면 치수(부식 마진 포함) | 백엔드 `mooring_row_edit._new_dims` | MF Studio `rowDims`, `sectionSketch.aboveHeights` | 없음 |
| MF 단면 이름표 | 엔진 `ProfileInfo.ShortLabel` | MF Studio `utils/shipLabel.js` | 없음 |
| nastran_bridge | InHouse `NastranBridge/nastran_bridge.py` (145 실사용) | `WorkBenchSubModule/Nastran_bridge` (70 백엔드가 import) | 없음 |
| Truss 허용응력 Property ID | C# `ElementStressChecker` | 백엔드 `assessment_diagnostics._ALLOWABLE_PROPERTY_IDS` | 없음 |
| 서버 인증서 지문과 주소 | `electron/server-pins.js` | `AmLauncher/lib/server-pins.js`, HiTessMB `ServerPins.cs`, 프론트 `utils/secureServerUrl.js`, claude-control 스트림덱 `plugin.js` `WB_PINS`(지문만) | 없음 |
| Windows 자동 로그인 | `electron/windows-login.js` | `AmLauncher/lib/windows-login.js` | 없음 |
| AM 실행기 Electron 코드 | WorkBench `electron/` | `AmLauncher/` (원본 위치 주석) | 없음 |
| 접속 이력 임계값(150, 180초) | `routers/presence.py` | `services/access_session_service.py` | `test_thresholds_match_presence_router` |
| 가입 페이지 선택지 | `RegisterModal` | `app/static/signup/signup.html` | 테스트 있음 |
| 수동 메일 주소 규칙 | 백엔드 `_MANUAL_EMAIL_PATTERN` | 프론트 `EMAIL_PATTERN` | 없음 |
| BDF 3D 미리보기 변환기와 엔진 | **LogBook** (여기서 고치지 않음) | `app/services/bdf_preview/`, `components/bdfPreview/lb/` | 없음 |
| PBAR 바깥 치수(가장 먼 응력 회복점 × 2, 없으면 √A) | 자세안정성 엔진 `PropertyDimensionHelper.PbarExtent` | Truss Lifting Studio `data/pbarSection.js` | 양쪽 시험(같은 3321 값 650) |
| Truss 소모듈 판정(UC > 1 = 실패, 빠진 부재 있으면 검토 필요) | 프론트 `utils/trussLiftingVerdict.js` | Truss Lifting Studio `data/trussAssessmentView.js` | 양쪽 시험 |
| 권상 부모 App 이름 | 백엔드 `services/lifting_programs.py` `LIFTING_PARENT_PROGRAMS` | `usage_rollup.ROLLUP_PARENTS` | `test_truss_module_lifting.py` |

## 이 파일에 쓰는 것 (2026-11-19 정리)

이 파일은 세션마다 통째로 읽힌다(한도 15만 자, 정리 전 19만 자). **여기에는 규칙과 함정만** 둔다.
- 앱별 진행 기록(버전 경과, 커밋 해시, 배포 상태, 남은 일)은 아래 표의 `docs/apps/`, `docs/platform/` 문서에 쓴다. `/wrapup` 도 그 문서에 쓴다.
- 여기에는 '고치기 전에 꼭 알아야 하는 것'만 한두 줄로 더하고, 상세는 문서로 보낸다.
- 그 앱이나 기능을 고치기 전에 해당 문서를 먼저 읽는다.

| 주제 | 문서 |
|---|---|
| 설정 포인트 원문(백엔드 URL, 릴리스, Electron, InHouse, Studio 배포) | `docs/platform/settings-and-deploy.md` |
| 해석 작업 흐름, 대시보드, 파일 기반 앱 공통 틀, 작업 탭, 사용 기록, 영상 | `docs/platform/analysis-workflow.md` |
| 인증(AD, Windows 자동 로그인, 계열사 PC 등록, HTTPS 인증서 고정) | `docs/platform/auth.md` |
| 외부 웹 App 프록시, 신원 서명, 보안 점검 | `docs/platform/external-app-proxy.md` |
| 관리자 기능(메일, 메뉴, 웹 콘솔, App Settings, Update History, All Projects) | `docs/platform/admin-features.md` |
| 공개 페이지(뉴스레터, 개발 연대기, 업데이트 안내) | `docs/platform/public-pages.md` |
| 프론트 구조, Context, AI, DB 모델, 라우터, 페이지 표 | `docs/architecture.md` |
| Model Builder (엔진, Studio, 편집 계약, CSV 추적, AM 연동, 호선) | `docs/apps/model-builder-studio.md` |
| Module Unit Studio (GMU 권상, 보고서, 평가 모드) | `docs/apps/module-unit-studio.md` |
| 짝 Studio 싱크 진행 기록 | `docs/apps/studio-pair-sync-log.md` (절차 = `docs/standards/studio-pair-sync.md`) |
| Mooring Fitting | `docs/apps/mooring-fitting.md` |
| DrawingToAnalysis (LugShell) | `docs/apps/drawing-to-analysis.md` |
| 선체 가속도 | `docs/apps/hull-acceleration.md` |
| 이중관 PSA | `docs/apps/doublepipe-psa.md` |
| Truss 소모듈 권상 | `docs/apps/truss-module-lifting.md` |
| D Type Lug | `docs/apps/d-type-lug.md` |
| PSA 평가보고서 자동화 (엑셀 하나 = Line 하나, 그림 이름 = 보고서 제목) | `docs/plans/2026-11-17-psa-report-automation-plan.md` |

## 아키텍처

```
[Electron shell]  →  개발: localhost:5173 로드 / 프로덕션: frontend/dist/index.html 로드
[React SPA]       →  REST API로 백엔드 서버와 통신
[FastAPI backend] →  해석 작업 수행, DB 데이터 제공, AI 질의 처리
```
내비게이션은 React Router 가 아니라 `NavigationContext`(`useNavigation()`), 라우팅 분기는 `App.jsx:renderPage()`. 상세 표는 `docs/architecture.md`.

### 주요 설정 포인트 (원문 `docs/platform/settings-and-deploy.md`)

- **백엔드 URL** = `frontend/src/config.js` `DEFAULT_API_BASE_URL`. ⚠ **이 값의 변경은 항상 커밋에서 제외**(70 '내 컴퓨터' ↔ 145 '서버' 토글용 로컬 변경). 커밋 훅은 Bash 명령 문자열에 그 파일 이름이 들어가기만 해도 막으니 메시지는 파일로 넘기고 확인은 Grep 도구로.
- **릴리스 = `/wb-release`**(`scripts/release.ps1 -Bump -BuildOnly`). 버전만 올릴 때 `pwsh scripts/check-versions.ps1`. 4곳을 손으로 고치지 말 것. 2026-11 부터 1.7.x.
- 🚫 **`Darkmode.js/` 는 영구히 커밋하지 않는다**(자체 `.git` 을 가진 외부 클론 → gitlink 로 깨짐).
- 포트 9091, DB MySQL `localhost:3306/hitessworkbench`(접속 정보 `app/database.py`).
- ⚠ **배포 exe 는 Electron 26**(루트 `node_modules/electron`), 개발 모드는 40. 화면, 웹 기능 확인은 exe 기준.
- ⚠ **InHouse 규칙**: 엔진 코드는 `C:\Coding\WorkBenchSubModule\<Program>\` 에서 고쳐도, 백엔드가 실행하는 최종본은 `HiTessWorkBenchBackEnd/InHouseProgram/<Program>/` 에 복사해야 한다(git 미추적, 145 수동 교체). 보고에는 '`git pull` 만으로 끝나는지 / 수동 교체 파일 + 재시작' 을 늘 구분해 적는다.
- **배포 절차는 `/deploy` 스킬**. Studio "배포해" = 70 로컬 `StudioProgram\` 에만, 145 공개 = `/studio-release`(릴리스 표 `app/studio_release.json`, 반영 = 커밋, 푸시 후 145 ⟳ Update). 70 은 `.env STUDIO_CHANNEL=dev`(145 에는 넣지 말 것).
- ⚠ 회사 DRM 이 C: 에 쓴 zip, xlsx, PDF 를 +4096B 로 감싼다. 백엔드는 파일 크기를 stat 이 아니라 `read()` 한 바이트 기준으로 서빙한다(`FileResponse` 금지 — `ERR_CONTENT_LENGTH_MISMATCH`).

### 짝 Studio 싱크 — MB 와 MU 는 한 쌍 (2026-11-10, 사용자 지시)

한쪽을 고치면 다른 쪽이 들여올 수 있는 부분은 함께 맞춘다. 절차와 싱크 대장 = `docs/standards/studio-pair-sync.md`, 진행 기록 = `docs/apps/studio-pair-sync-log.md`.
- 검사 `python scripts/studio_pair.py`. `same` 파일은 미루지 않고 고친 자리에서 짝에도 복사, `watch` 는 판정 후 `--ack <경로>`(보류는 ack 하지 않음).
- 그 밖의 변경은 대장에 보류로 적고, 145 공개 뒤 `/studio-sync` 로 묶어 옮긴다.

### Model Builder Studio (상세 `docs/apps/model-builder-studio.md`)

- 두 프로젝트: 엔진 C# `WorkBenchSubModule\HiTessModelBuilder\` → `InHouseProgram\HiTessModeBuilder\Cmb.Cli.exe`(폴더 이름 'l' 빠진 것이 맞음) / Studio `WorkBenchSubModule\ModelBuilderStudio\apps\model-studio\`.
- **MB 편집 적용 엔진은 C# 하나**(bridge fallback 2026-10-29 제거). 새 intent kind 는 Studio, C#, 계약 테스트(`test_modelbuilder_edit_contract.py`) 3곳을 함께 고친다. 편집 BDF 가 깨지면 C# 을 고친다(`nastran_bridge` 수정은 MB 에 효력 없음).
- 엔진 변경은 회귀(`scripts/mb_engine_regress/`)로 이전 결과와 비교한 뒤에만 커밋.
- Studio git: `ModelBuilerStudio.git` 의 **`model-studio` 브랜치**. 그 저장소 `master` 는 옛 Module Unit Studio — 'model-studio → master' PR 을 누르지 말 것.
- ⚠ **1점 TEE 는 '제외' 오류로 유지**(사용자 결정). 정상 분류로 바꾸거나 건수에서 빼지 말 것. CSV 행 ↔ 모델 대응은 이름만으로 맞추지 않는다.
- 호선 정규화 4벌, 제외 사유 문구, COG 경고 키는 위 사본 동기화 표.

### Module Unit Studio (상세 `docs/apps/module-unit-studio.md`)

- ⭐ **버전 정책(무조건)**: MU 코드(Studio 또는 엔진 `ModuleUnitAnalysis`)를 고치면 `module-unit-studio` 버전 bump → zip 재배포 → `GroupModuleUnitLiftingAnalysis.jsx` 의 `MODULE_STUDIO_VERSION` 동기화를 세트로.
- MU 개선 요청은 먼저 `ModuleUnitStudio/docs/plans/2026-10-29-mb-features-to-mu.md`. 두 Studio 의 사용 방법은 일관돼야 한다(사용자 지시).
- MU 편집은 Studio 가 JS 로 적용해 `_edited.json` 을 올린다(MB 처럼 C# 에 kind 를 넣는 작업 아님). 편집과 함께 RBE 를 읽는 코드는 파생 모델(`applyNodeEdits`)을 본다.
- ⚠ 셸을 `transform: scale()` 로 키우지 말 것(배율 두 번 곱해짐). ⚠ `window.confirm`, `alert` 금지 — 앱 안 확인 창(`useConfirmStore`).
- ⚠ `/studio-release` 의 출처 release zip 도 DRM 에 감싸질 수 있다 — `dist` 를 메모리에서 묶어 UNC 에 직접 쓴다. 빌드 뒤 `.sha256` 내용이 NUL 이 아닌지 확인.
- 보고서 그림은 백엔드 matplotlib 이 그린다(Studio 3D 캡처 안 씀). 보고서 인쇄 설정(scale 100, 행 높이 13.5pt, 서식 재배치 좌표)은 맞물려 있어 하나만 바꾸면 깨진다 — 고치기 전 상세 문서.

### Mooring Fitting (상세 `docs/apps/mooring-fitting.md`)

- 엔진 `WorkBenchSubModule\MooringFitting\` → `InHouseProgram\MooringFitting\MooringFitting.exe`, Studio `WorkBenchSubModule\MooringFittingStudio\`. ⚠ **둘 다 원격이 없고 70 에만 있다.**
- 재질 판정 원본 = 엔진 `SteelGrade`, 백엔드 `judge_member` 가 사본. 새 단면 치수(부식 마진 포함)는 백엔드 `_new_dims` ↔ Studio `rowDims`.
- 공식 판정 발행은 아직 불가(기존 계산서와 ±15% 재현 전). 강축 굽힘만으로 판정이 현 평가 방식(사용자 결정).

### 그 밖의 앱 (상세는 각 문서)

- **이중관 PSA** — 🚫 엔진 폴더 `InHouseProgram/DoublePipe/Piping Stress Analysis for all load cases/` 는 외부 연구원 소유라 **수정하지 않는다**. WorkBench 개조는 `InHouseAdapters/doublepipe_psa/`(shim, cli, patches)에만.
- **DrawingToAnalysis** — 엔진 `WorkBenchSubModule\DrawingToAnalysis`(원격 없음). 백엔드가 `engine_supports_lugshell` 로 엔진 판을 확인해 순서가 바뀌어도 안 깨진다. 치수 파일은 `lugparams/` 로 내보낸다.
- **Truss 소모듈 권상** — `TrussModuleAssessment` 는 TrussAssessment 판정 파일을 링크로 쓴다. 145 는 백엔드 반영이 Studio 공개보다 먼저(옛 서버는 Case 를 몰라 전체 BDF 로 푼다).
- **D Type Lug** — W1', W2' 는 입력 칸 없이 항상 0(사용자 결정).
- **선체 가속도** — 샘플 PDF 는 UNC 평문을 작업 폴더로 복사하지 않고 그대로 넘긴다.

### 플랫폼 공통 함정 (상세는 각 문서)

- **해석 작업**: 작업 상태는 메모리 + DB write-through, Redis 불필요. 앱 페이지는 전부 keep-alive 라 window 단축키는 `currentMenu === 자기 메뉴` 일 때만. 작업 탭이 여러 개라 **Studio → WorkBench 이벤트는 반드시 탭을 특정해서 받는다**. 새 파일 입력 앱은 대시보드 파일 전달 훅과 `FILE_HANDOFF_MENUS` 등록. 표준 = `docs/standards/file-based-app-page-standard.md`.
- **새 앱의 서버 차단**: `services/app_settings.py` `GUARDED_ROUTES` 에 경로를 등록해야 한다(미등록은 fail-open). 프론트는 `ANALYSIS_DATA` 직접 import 대신 `useAppCatalogue()`. 원인 모를 403 이면 `app_settings` 테이블부터.
- **한글 입력칸의 Enter** 에는 `if (e.nativeEvent.isComposing || e.keyCode === 229) return;`.
- **인증**: `.env AUTH_MODE=ad`(145 켜짐). 틀린 시도 제한은 프로세스 메모리라 uvicorn 워커 1개 전제. Windows 로그인 요청에 본문을 싣지 말 것(Electron 40 이 멈춤). 인증서 지문과 주소는 사본 동기화 표의 네 곳.
- Electron main 의 서버 요청은 `serverFetch`(net.fetch), `net.request` 로만(Node fetch 는 인증서 고정을 거치지 않음).
- **로그인 없는 공개 파일 경로**는 `resolve()` 전에 경로 모양(`_SAFE_ASSET_RE`)부터 거른다(UNC 경로로 서버가 외부 접속하던 결함).
- **관리자 화면 묶음**은 `constants/adminMenus.js` `ADMIN_TAB_GROUPS`, 이름을 `ADMIN_MENUS` 에도.
- **업데이트 이력**(`app/changelog/changelog.json`)은 큰 범주로, `status` 칸과 em dash 금지. "업데이트 이력 작성해" = `git log` 를 보고 이 json 만 고친다. 사용자 안내 페이지 = `UpdateWeb/updates.json`(규칙은 `docs/platform/public-pages.md`).
- All Projects 의 BDF 미리보기 변환기는 **LogBook 사본** — 여기서 고치지 않는다. 작업 폴더를 훑는 코드는 `nul` 같은 Windows 예약 이름을 먼저 거른다.
- 다운로드 `GET /api/download` 는 `userConnection/` 밖 경로를 막는다. Excel 내보내기는 메모리에서 만든다(DRM 회피).

### Truss Structural Assessment — 허용응력 Property ID 테이블은 두 곳에서 참조된다 ★수정 시 동기화 필수

엔진(`WorkBenchSubModule/TrussAssessment`, C#)의 허용응력 테이블은 **Property ID 1~18만** 하드코딩돼 있고(`ElementStressChecker.cs:28-48`, `AllowableInfo.propertiesInfo`), 테이블 밖 ID 는 `catch (KeyNotFoundException) { continue; }` 로 **아무 흔적 없이 스킵**된다.

- 실제 장애(2026-08-28, `177K-01.bdf`): FEGate 5.03.21 이 PBAR/PBARL 을 **+1000 오프셋(1001~1019)** 으로 내보내 23,035 개 CBAR 가 전부 스킵 → F06 에 FATAL 도 없고 엔진도 exit 0 인데 엑셀의 `Summary_LC*` / `부재평가_LC*` 시트만 헤더만 남음. 하중분산판·SideSupport 는 SPC 반력만 쓰므로 정상 출력돼 "일부만 안 나오는" 모양이 된다.
- ⚠ **ID 집합이 백엔드에도 있다**: `app/services/assessment_diagnostics.py` 의 `_ALLOWABLE_PROPERTY_IDS = frozenset(range(1, 19))`. **C# 테이블에 Property ID 를 추가·삭제하면 이 상수도 같이 고칠 것.** (허용응력 *값* 은 복제하지 않는다 — 판정에 필요한 건 ID 집합뿐이라 중복을 정수 리스트 한 줄로 묶어 뒀다.)
- 검사는 **CBAR 가 참조하는 PID** 기준이다. PBAR/PBARL 카드 기준으로 바꾸지 말 것 — 정상 참조 모델 `3321_2tk_moving_04.bdf` 에는 어떤 CBAR 도 쓰지 않는 PBARL 37/38/39 가 카드로만 존재해서 카드 기준이면 **정상 모델이 차단된다.**
- 방어선 2겹(둘 다 백엔드, `git pull` 로 서버 반영): ① `preflight_property_ids()` — 업로드 직후 차단(전량 미매핑) 또는 경고(부분 미매핑, 해석은 진행). ② `_count_element_rows()` — 엔진이 exit 0 + JSON 까지 냈는데 부재평가가 0 행이면 Success 를 Failed 로 뒤집는다.
