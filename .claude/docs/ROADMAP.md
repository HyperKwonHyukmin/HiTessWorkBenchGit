# HiTessWorkBench 프론트엔드/백엔드 코드베이스 리팩토링 로드맵

API 호출 이중화, 대형 컴포넌트, 하드코딩 값, 폴링 로직 파편화를 해소하여 유지보수성과 코드 일관성을 확보한다.

## 개요

HiTessWorkBench는 다음과 같은 코드 품질 문제로 인해 유지보수 비용이 증가하고 있습니다:

- **API 호출 이중화**: `api/` 폴더는 axios 사용, `useAnalysisManager.js`와 일부 컴포넌트는 fetch 직접 사용
- **대형 컴포넌트**: TrussAssessment(1409L), ComponentWizard(1057L), TrussAnalysis(689L), AnalysisManagement(567L)
- **하드코딩 값**: 직원 ID `"A476854"`, exe 절대 경로, 기본 하중값 `-5000`, 헬스체크 개인 식별자
- **폴링 로직 3중 중복**: TrussAnalysis(setInterval), DashboardContext(setTimeout+재귀), useAnalysisManager(자체)
- **동명 파일**: `pages/analysis/ComponentWizard.jsx`와 `components/analysis/ComponentWizard.jsx`
- **유틸리티 중복**: 숫자 포매팅, 파일명 추출 로직이 5+ 곳에 인라인으로 존재

## 개발 워크플로우

1. **작업 계획**

   - 기존 코드베이스를 분석하고 현재 상태를 정확히 파악
   - 새로운 작업을 포함하도록 `ROADMAP.md` 업데이트
   - 우선순위 작업은 마지막 완료된 작업 다음에 삽입

2. **작업 생성**

   - 기존 코드베이스를 학습하고 현재 상태를 파악
   - `/tasks` 디렉토리에 새 작업 파일 생성
   - 명명 형식: `XXX-description.md` (예: `001-analyze.md`)
   - 고수준 명세서, 대상 파일, 수락 기준, 구현 단계 포함
   - 변경 작업 시 "## 검증 체크리스트" 섹션 필수 포함 (기존 테스트 통과 + 회귀 검증 시나리오)

3. **작업 구현**

   - 작업 파일의 명세서를 따름
   - 변경 전 반드시 기존 동작을 테스트로 보호
   - 각 단계 후 작업 파일 내 진행 상황 업데이트
   - 구현 완료 후 기존 테스트 전부 통과 확인
   - 각 단계 완료 후 중단하고 추가 지시를 기다림

4. **로드맵 업데이트**

   - 로드맵에서 완료된 작업을 [x]로 표시

---

## 개선 단계

### Phase 1: 즉시 버그 수정 (R004, R005)

> 목표: 기능 버그와 환경 종속 하드코딩을 제거하여 모든 사용자/서버에서 정상 동작을 보장한다.

- [x] **Task 001: useAnalysisManager 하드코딩 직원 ID 제거** -- 우선순위
  - 대상 파일: `frontend/src/hooks/useAnalysisManager.js`
  - `useAnalysisManager.js:80`의 `"A476854"` 리터럴을 `localStorage.getItem('user')` 파싱으로 교체
  - 현재 인증 체계(localStorage `'user'` 키에 JSON 저장)와 일관된 방식으로 employee_id 동적 추출
  - 완료 기준: `useAnalysisManager.js` 내 `"A476854"` 리터럴 0개
  - 검증: 다른 사번으로 로그인 후 해석 요청 제출 시 정상 동작 확인

- [x] **Task 002: beam_service exe 절대 경로 환경변수 추출**
  - 대상 파일: `HiTessWorkBenchBackEnd/app/services/beam_service.py`
  - `beam_service.py:27`의 `r"C:\Coding\WorkBench\..."` 절대 경로를 `os.getenv("BEAM_EXE_PATH", 상대경로기본값)`으로 교체
  - 상대 경로 기본값은 프로젝트 루트 기준 `InHouseProgram/SimpleBeamAssessment/HiTESS.FemEngine.Adapter.exe`
  - 완료 기준: `beam_service.py` 내 절대 경로 리터럴 0개, 환경변수 미설정 시 상대 경로 fallback 정상 동작

- [x] **Task 003: main.py 헬스체크 개인 식별자 제거**
  - 대상 파일: `HiTessWorkBenchBackEnd/app/main.py`
  - `main.py:33`의 `"kwonhyukmin"` 응답을 `{"status": "ok", "service": "HiTessWorkBench"}`로 변경
  - 완료 기준: `main.py` 내 개인 식별자 문자열 0개

- [x] **Task 004: ComponentWizard 매직값 상수화**
  - 대상 파일: `frontend/src/pages/analysis/ComponentWizard.jsx`
  - 파일 상단에 `const BEAM_DEFAULT_FORCE = -5000;` 상수 정의
  - `:57`, `:720` 등 `-5000` 리터럴을 `BEAM_DEFAULT_FORCE` 상수 참조로 교체
  - 완료 기준: `ComponentWizard.jsx` 내 `-5000` 숫자 리터럴 0개 (상수 정의 제외)

---

### Phase 2: 기반 인프라 구축 (R001, R002)

> 목표: API 호출 단일화 및 폴링 훅 구축으로 이후 컴포넌트 분리의 기반을 마련한다.

- [x] **Task 005: analysis.js API 함수 완결화** -- 우선순위
  - 대상 파일: `frontend/src/api/analysis.js` (현재 50라인)
  - `useAnalysisManager.js`가 fetch로 직접 호출하는 엔드포인트를 analysis.js에 axios 함수로 추가
    - `POST /api/analysis/beam/request` -> `requestBeamAnalysis(formData)`
    - `GET /api/analysis/status/{job_id}` -> `getAnalysisStatus(jobId)`
    - `GET /api/download?filepath=...` -> `downloadResultFile(filepath)`
  - 기존 analysis.js 함수 시그니처 변경 없음
  - 완료 기준: 프로젝트 전체에서 모든 `/api/analysis` 관련 호출이 analysis.js를 통해 가능한 상태

- [x] **Task 006: admin.js API 함수 보완**
  - 대상 파일: `frontend/src/api/admin.js` (현재 92라인)
  - `AnalysisManagement.jsx` 등에서 fetch 직접 호출하는 관리자 API를 admin.js 함수로 추가
  - 완료 기준: 관리자 관련 fetch 직접 호출을 admin.js 함수로 대체 가능한 상태

- [x] **Task 007: usePolling 커스텀 훅 신규 생성**
  - 대상 파일: `frontend/src/hooks/usePolling.js` (신규)
  - 인터페이스: `usePolling({ jobId, interval, maxRetries, onProgress, onComplete, onError })`
  - useEffect 의존성 배열 기반 자동 시작/중지
  - 언마운트 시 cleanup 함수로 메모리 누수 방지
  - 내부적으로 `api/analysis.js`의 `getAnalysisStatus()` 사용
  - 완료 기준: 훅이 독립적으로 동작하며, 시작/중지/에러/완료 콜백 정상 호출

- [x] **Task 008: useAnalysisManager fetch를 axios로 교체**
  - 대상 파일: `frontend/src/hooks/useAnalysisManager.js` (현재 121라인)
  - `fetch()` 직접 호출 2건을 `api/analysis.js` 함수 호출로 교체
  - 자체 폴링 로직을 `usePolling` 훅 호출로 교체
  - 완료 기준: `useAnalysisManager.js` 내 `fetch(` 0건, `setInterval`/`setTimeout` 직접 호출 0건

- [x] **Task 009: TrussAnalysis 폴링 로직 usePolling 교체**
  - 대상 파일: `frontend/src/pages/analysis/TrussAnalysis.jsx`
  - `:160`의 `setInterval` 기반 폴링 블록을 `usePolling` 훅 호출로 교체
  - `pollIntervalRef`, `retryCount` 관련 상태 제거
  - 완료 기준: `TrussAnalysis.jsx` 내 `setInterval` 직접 사용 0건, `retryCount` 관련 코드 0건

- [x] **Task 010: DashboardContext 폴링 로직 usePolling 교체**
  - 대상 파일: `frontend/src/contexts/DashboardContext.jsx` (현재 182라인)
  - `setTimeout + pollTimeoutRef` 재귀 방식 폴링을 `usePolling` 훅 호출로 교체
  - `useDashboard()` 공개 인터페이스(R012) 변경 없이 내부 구현만 교체
  - 완료 기준: `DashboardContext.jsx` 내 `setTimeout` 기반 폴링 0건, `useDashboard()` 반환값 시그니처 동일

---

### Phase 3: 컴포넌트 분리 및 파일명 정리 (R003, R007)

> 목표: 500라인 초과 컴포넌트를 단일 책임 서브컴포넌트로 분리하고 동명 파일 혼동을 해소한다.

- [x] **Task 011: TrussAssessment 서브컴포넌트 분리** -- 우선순위
  - 대상 파일: `frontend/src/pages/analysis/TrussAssessment.jsx` (현재 1409라인)
  - 분리 대상:
    - 로그 패널 -> `components/analysis/AssessmentLogPanel.jsx` (신규)
    - 결과 요약 테이블 -> `components/analysis/AssessmentResultTable.jsx` (신규)
    - 파일 업로드 UI -> `components/analysis/AssessmentFileUpload.jsx` (신규)
  - TrussAssessment.jsx는 상태 관리 + 서브컴포넌트 조합만 담당
  - TrussAssessment 내 폴링 로직이 있다면 `usePolling`으로 교체 (Phase 2 의존)
  - 완료 기준: `TrussAssessment.jsx` 300라인 이내, 분리된 서브컴포넌트 각각 200라인 이내

- [x] **Task 012: ComponentWizard(page) 분리 및 파일명 변경**
  - 대상 파일: `frontend/src/pages/analysis/ComponentWizard.jsx` (현재 1057라인)
  - 분리 대상:
    - 빔 입력 폼 -> `components/analysis/BeamInputForm.jsx` (신규)
    - 결과 패널 -> `components/analysis/BeamResultPanel.jsx` (신규)
  - 페이지 파일명을 `SimpleBeamAssessmentPage.jsx`로 변경
  - `App.jsx`의 import 경로 및 `renderPage()` 매핑 업데이트 (R011 `setCurrentMenu` 인터페이스 유지)
  - 완료 기준: `pages/analysis/ComponentWizard.jsx` 파일 없음, `SimpleBeamAssessmentPage.jsx` 300라인 이내

- [x] **Task 013: ComponentWizard(component) -> BeamModelPreview 명명 변경**
  - 대상 파일: `frontend/src/components/analysis/ComponentWizard.jsx` (현재 282라인)
  - 파일명을 `BeamModelPreview.jsx`로 변경, 컴포넌트 함수명도 `BeamModelPreview`로 변경
  - 이 컴포넌트를 import하는 모든 파일의 import 경로 업데이트
  - Task 012와 동시 수행하여 동명 파일 충돌 완전 해소
  - 완료 기준: `components/analysis/ComponentWizard.jsx` 파일 없음, 모든 import 정상 동작

- [x] **Task 014: AnalysisManagement 서브컴포넌트 분리**
  - 대상 파일: `frontend/src/pages/Administration/AnalysisManagement.jsx` (현재 567라인)
  - 분리 대상:
    - 검색/필터 컨트롤 -> `components/admin/AnalysisFilterBar.jsx` (신규)
    - 데이터 테이블 -> `components/admin/AnalysisHistoryTable.jsx` (신규)
  - AnalysisManagement.jsx는 상태 관리 + 레이아웃 조합만 담당
  - 내부 fetch 직접 호출이 있다면 `admin.js` 함수로 교체 (Phase 2 의존)
  - 완료 기준: `AnalysisManagement.jsx` 200라인 이내, 서브컴포넌트 각각 200라인 이내

---

### Phase 4: 유틸리티 통합 및 마무리 (R006)

> 목표: 중복 유틸리티 로직을 공용 모듈로 통합하고 전체 코드 일관성을 확보한다.

- [x] **Task 015: utils/formatting.js 신규 생성 및 적용** -- 우선순위
  - 대상 파일: `frontend/src/utils/formatting.js` (신규)
  - 통합 대상 함수:
    - `formatEngineering(val, digits)` -- ComponentWizard의 `engFormat`, MastPostAssessment의 `fmt`, 인라인 `toFixed` 통합
    - `formatDate(date)` -- 날짜 포매팅 통일
  - 기존 중복 인라인 코드를 utils 함수 호출로 교체
  - 교체 대상 파일: ComponentWizard, MastPostAssessment, TrussAnalysis, BeamAnalysisViewer 등
  - 완료 기준: 프로젝트 내 중복 포매팅 인라인 코드 0건 (utils 함수 사용)

- [x] **Task 016: utils/fileHelper.js 신규 생성 및 적용**
  - 대상 파일: `frontend/src/utils/fileHelper.js` (신규)
  - 통합 대상 함수:
    - `extractFilename(filePath)` -- `filePath.split('\\').pop().split('/').pop()` 패턴 통합
    - `getFileExtension(filePath)` -- 확장자 추출 로직 통합
  - 교체 대상 파일: MyProjects, TrussAnalysis, 기타 파일명 처리 중복 개소
  - 완료 기준: 프로젝트 내 `split('\\').pop().split('/').pop()` 패턴 0건

- [x] **Task 017: 전체 통합 검증**
  - Phase 1~4 전체 개선 항목 통합 동작 확인
  - App.jsx 라우팅 정상 동작 (R011): `setCurrentMenu` 호출로 모든 페이지 전환 확인
  - DashboardContext 공개 인터페이스 정상 동작 (R012): `useDashboard()` 반환값 검증
  - 백엔드 API 엔드포인트 호환성 (R010): 모든 해석 요청/상태/다운로드 정상 동작
  - 해석 워크플로우 end-to-end 검증: Truss, Assessment, Beam 각각 파일 업로드 -> 해석 -> 결과 확인
  - 완료 기준: 모든 해석 타입의 전체 워크플로우 정상 동작, 콘솔 에러 0건

- [x] **Task 018: 코드 품질 최종 점검 및 개선 결과 문서화**
  - import 경로 정리: 사용되지 않는 import, 잘못된 경로 제거
  - 불필요한 주석, 데드코드 제거
  - 네이밍 컨벤션 일관성 검토 (컴포넌트명 PascalCase, 훅 use- 접두어 등)
  - 변경 사항 요약 문서 작성 (변경 전/후 비교)
  - 다음 단계 개선 후보 목록 정리 (PRD 제외 범위: Redux 도입, Redis 마이그레이션, 테스트 코드 등)

---

## 변경 불가 인터페이스

아래 인터페이스는 리팩토링 전 과정에서 변경하지 않습니다. 모든 Task의 검증 시 이 항목들의 호환성을 확인해야 합니다.

### R010: 백엔드 API 엔드포인트

모든 라우터 경로 및 요청/응답 스키마를 현행 그대로 유지합니다.

| 라우터 | 경로 프리픽스 | 비고 |
|--------|---------------|------|
| `routers/analysis.py` | `/api/analysis/*` | 해석 요청, 상태 조회, 다운로드, xlsx 내보내기 |
| `routers/auth.py` | `/api/auth/*`, `/api/login`, `/api/register` | 로그인, 회원가입 |
| `routers/system.py` | `/api/system/*` | CPU/메모리/DB 상태, 큐 현황 |
| `routers/support.py` | `/api/*` | 공지사항, 가이드, 기능 요청 |

특히 `GET /api/analysis/status/{job_id}` 응답 형식 `{ status, progress, message, result }`은 usePolling 훅이 직접 의존하므로 반드시 유지합니다.

### R011: App.jsx 라우팅 인터페이스

`setCurrentMenu(name: string)` 호출 방식을 유지합니다. 페이지 컴포넌트의 파일명이 변경되더라도(ComponentWizard -> SimpleBeamAssessmentPage) 메뉴 이름 문자열(`'Component Wizard'`, `'Simple Beam Assessment'`)과 `renderPage()` 매핑은 기존 동작을 보존합니다.

### R012: DashboardContext 공개 인터페이스

`useDashboard()` 훅이 반환하는 다음 값/함수의 시그니처를 유지합니다:

- `ANALYSIS_DATA` -- 전체 해석 앱 메타데이터 목록
- `globalJob` / `startGlobalJob(job)` / `clearGlobalJob()` -- 백그라운드 작업 추적
- `assessmentPageState` / `setAssessmentPageState(state)` -- TrussAssessment 상태 유지
- `favorites` / `toggleFavorite(appName)` -- 즐겨찾기 목록

내부 폴링 구현은 usePolling으로 교체하되, 위 공개 인터페이스는 변경하지 않습니다.

---

## 요구사항 추적 매트릭스

| 요구사항 ID | 설명 | 관련 Task |
|-------------|------|-----------|
| R001 | API 호출 방식 통일 (fetch -> axios) | Task 005, 006, 008 |
| R002 | 폴링 로직 단일 커스텀 훅화 | Task 007, 008, 009, 010 |
| R003 | 대형 컴포넌트 분리 (500라인 초과) | Task 011, 012, 014 |
| R004 | 하드코딩 직원 ID 제거 | Task 001 |
| R005 | 매직값 상수화 | Task 002, 003, 004 |
| R006 | 공용 UI 유틸리티 통일 | Task 015, 016 |
| R007 | 동명 파일 명확화 | Task 012, 013 |
| R010 | 기존 API 엔드포인트 유지 | 전체 (변경 불가) |
| R011 | App.jsx 라우팅 인터페이스 유지 | Task 012 검증 |
| R012 | DashboardContext 공개 인터페이스 유지 | Task 010 검증 |
