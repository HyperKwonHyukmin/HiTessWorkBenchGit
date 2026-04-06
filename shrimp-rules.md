# HiTessWorkBench 개발 가이드라인 (AI Agent용)

## 1. 프로젝트 개요

- **목적**: 사내 구조 해석 실행 파일(.exe)을 현대적 웹 UI로 감싸고 AI 어시스턴트를 결합한 플랫폼
- **배포 형태**: Electron 포터블 .exe (사내 배포), 팀 공용 서버(FastAPI)와 REST 통신
- **기술 스택**
  - 프론트엔드: React 18 + Vite + Tailwind CSS + axios
  - 백엔드: Python FastAPI + SQLAlchemy + MySQL
  - 데스크톱: Electron

---

## 2. 디렉토리 구조 및 역할

```
HiTessWorkBench/
├── electron/           ← Electron 진입점 (index.js, preload.js)
└── frontend/src/
    ├── App.jsx             ← 유일한 라우터. setCurrentMenu()로만 페이지 전환
    ├── config.js           ← API_BASE_URL 단일 관리
    ├── api/
    │   ├── analysis.js     ← 모든 해석 관련 API 호출 (axios)
    │   └── admin.js        ← 모든 관리자/시스템 API 호출 (axios)
    ├── hooks/
    │   ├── useAnalysisManager.js  ← 해석 요청/상태 단일 진입 훅
    │   └── usePolling.js          ← 폴링 전용 훅 (유일한 폴링 구현체)
    ├── contexts/
    │   └── DashboardContext.jsx   ← 전역 상태 Provider (인터페이스 변경 금지)
    ├── pages/
    │   ├── analysis/       ← 해석 페이지 컴포넌트
    │   ├── Administration/ ← 관리자 페이지 컴포넌트
    │   ├── AI/             ← AI 관련 페이지
    │   ├── auth/           ← 로그인 페이지
    │   └── dashboard/      ← 메인 대시보드
    ├── components/         ← 재사용 UI 컴포넌트
    └── utils/
        ├── formatting.js   ← 숫자/날짜 포매팅 공용 함수
        └── fileHelper.js   ← 파일명/확장자 추출 공용 함수

HiTessWorkBenchBackEnd/app/
├── main.py             ← FastAPI 앱 진입점, CORS 설정
├── database.py         ← MySQL 연결, 환경변수 기반
├── models.py           ← ORM 모델 (스키마 변경 금지)
├── routers/            ← HTTP 라우터 (경로 변경 금지)
├── services/           ← 비즈니스 로직, exe 실행
└── settings.py         ← exe 경로 등 환경 상수 관리
```

---

## 3. 프론트엔드 코드 규칙

### 3-1. 네비게이션

- **반드시** `setCurrentMenu('메뉴이름')` 호출로만 페이지를 전환한다
- `react-router-dom` 또는 `window.location` 사용 **금지**
- 새 페이지 추가 시 `App.jsx`의 `renderPage()` 함수에 분기를 추가하고, `Sidebar.jsx`의 메뉴 목록에도 항목을 추가한다
- 메뉴 이름 문자열은 `App.jsx`와 `Sidebar.jsx` 두 곳을 **반드시 동시에** 수정한다

### 3-2. API 호출

- **반드시** `api/analysis.js` 또는 `api/admin.js`의 함수를 호출한다
- 컴포넌트나 훅에서 `fetch(` 또는 `axios.get/post` 직접 사용 **금지**
- 새 API 엔드포인트 호출이 필요하면 `api/` 파일에 함수를 추가한 뒤 호출한다
- 해석 관련 → `api/analysis.js`, 관리자/시스템 관련 → `api/admin.js`
- `API_BASE_URL`은 `config.js`에서만 가져온다. 컴포넌트에 URL 문자열 하드코딩 **금지**

### 3-3. 폴링 (작업 상태 주기적 조회)

- **반드시** `hooks/usePolling.js` 훅만 사용한다
- `setInterval`, `setTimeout`을 폴링 목적으로 직접 사용 **금지**
- `usePolling` 인터페이스: `usePolling({ jobId, interval, maxRetries, onProgress, onComplete, onError })`
- 언마운트 시 cleanup은 `usePolling` 내부가 담당하므로 호출 측에서 별도 처리 **불필요**

### 3-4. 컴포넌트 크기

- 단일 컴포넌트 파일은 **500라인 이내**로 유지한다
- 500라인 초과 시 단일 책임 서브컴포넌트로 분리한다
- 오케스트레이터 컴포넌트(페이지)는 상태 관리 + 서브컴포넌트 조합만 담당한다
- 서브컴포넌트는 `pages/[페이지명]/components/` 또는 동일 폴더 하위에 배치한다

### 3-5. 하드코딩 금지

| 금지 항목 | 올바른 방법 |
|-----------|-------------|
| 직원 ID 리터럴 (예: `"A476854"`) | `JSON.parse(localStorage.getItem('user'))?.employee_id` |
| 기본 수치값 매직 넘버 (예: `-5000`) | 파일 상단 상수로 추출 (예: `const BEAM_DEFAULT_FORCE = -5000`) |
| 서버 URL (예: `"http://10.133.x.x:8000"`) | `config.js`의 `API_BASE_URL` 사용 |
| 파일 경로 문자열 직접 조작 | `utils/fileHelper.js`의 `extractFilename()` 사용 |
| 인라인 숫자 포매팅 (예: `.toFixed(3)`) | `utils/formatting.js`의 `formatEngineering()` 사용 |

### 3-6. 전역 상태 (DashboardContext)

- `useDashboard()`로만 접근한다
- **변경 불가** 공개 인터페이스:
  - `ANALYSIS_DATA` — 해석 앱 메타데이터 목록
  - `globalJob` / `startGlobalJob` / `clearGlobalJob` — 백그라운드 작업 위젯
  - `assessmentPageState` / `setAssessmentPageState` — TrussAssessment 상태 보존
  - `favorites` / `toggleFavorite` — 즐겨찾기
- 위 공개 값/함수의 이름, 타입, 시그니처 변경 **금지**
- 내부 구현(폴링 방식 등)은 변경 가능하나 공개 인터페이스는 유지

### 3-7. 사용자 인증

- 로그인 사용자 정보는 `localStorage.getItem('user')` → JSON.parse로 취득
- `user.employee_id`, `user.is_admin` 등 필드 사용
- JWT 없음. 인증 토큰 헤더 추가 **금지**

---

## 4. 백엔드 코드 규칙

### 4-1. 라우터 경로 (변경 금지)

| 파일 | 프리픽스 | 변경 가능 여부 |
|------|----------|---------------|
| `routers/auth.py` | `/api` | **금지** |
| `routers/users.py` | `/api/users` | **금지** |
| `routers/analysis.py` | `/api/analysis` | **금지** |
| `routers/support.py` | `/api` | **금지** |
| `routers/system.py` | `/api/system` | **금지** |
| `routers/ai.py` | `/api/ai` | **금지** |

- 기존 엔드포인트의 경로, 요청/응답 스키마 변경 **금지**
- 새 엔드포인트는 기존 패턴에 맞춰 추가한다

### 4-2. exe 경로 및 환경 상수

- `services/` 파일에 exe 절대 경로 리터럴 하드코딩 **금지**
- exe 경로는 `settings.py` 상수 또는 `os.getenv("EXE_PATH")` 환경변수로 관리
- `settings.py` 경로 상수 변경 시 해당 상수를 사용하는 service 파일도 함께 확인한다

### 4-3. 서비스 계층

- exe 실행 로직은 반드시 `services/` 파일에 위치한다. 라우터에서 직접 subprocess 호출 **금지**
- 작업 상태는 `services/job_manager.py`의 `job_status_store`를 통해 관리한다
- `ThreadPoolExecutor` 최대 동시 실행 수(5) 변경 시 서버 부하를 반드시 검토한다

### 4-4. DB 모델

- `models.py`의 테이블 구조(컬럼 추가/삭제/타입 변경) **금지**
- 신규 데이터 필드가 필요하면 기존 JSON 컬럼(`input_info`, `result_info`) 활용을 우선 검토한다

### 4-5. 헬스체크

- `main.py` `/health` 응답은 `{"status": "ok", "service": "HiTessWorkBench"}` 형식을 유지한다
- 개인 식별자(사번, 이름 등) 응답값 포함 **금지**

---

## 5. 파일 동시 수정 규칙

| 수정 대상 | 반드시 함께 수정할 파일 |
|-----------|------------------------|
| `App.jsx` — 새 페이지 라우트 추가 | `Sidebar.jsx` (메뉴 항목 추가) |
| `api/analysis.js` — 함수 시그니처 변경 | `hooks/useAnalysisManager.js` (호출 측 업데이트) |
| `components/analysis/BeamModelPreview.jsx` — 파일명/컴포넌트명 변경 | import하는 모든 파일 |
| `pages/analysis/SimpleBeamAssessmentPage.jsx` — 파일명 변경 | `App.jsx` import 경로 |
| `DashboardContext.jsx` — 공개 값 추가/변경 | 해당 값을 사용하는 모든 컴포넌트 |
| `HiTessWorkBenchBackEnd/app/settings.py` — exe 경로 상수 변경 | 해당 상수를 사용하는 service 파일 |

---

## 6. 유틸리티 사용 규칙

### utils/formatting.js

- 숫자 포매팅은 `formatEngineering(val, digits)` 사용
- 날짜 포매팅은 `formatDate(date)` 사용
- 인라인 `.toFixed()`, `.toLocaleString()` 사용 **금지**

### utils/fileHelper.js

- 파일명 추출은 `extractFilename(filePath)` 사용
- 확장자 추출은 `getFileExtension(filePath)` 사용
- `filePath.split('\\').pop().split('/').pop()` 패턴 직접 작성 **금지**

---

## 7. 금지 행위 목록

| 금지 행위 | 이유 |
|-----------|------|
| `fetch()` 직접 사용 (api/ 폴더 외부) | axios/fetch 이중화로 에러 처리 파편화 |
| `setInterval`/`setTimeout`으로 폴링 구현 | usePolling 훅으로 단일화 필요 |
| 직원 ID 리터럴 하드코딩 | 타 사용자 요청이 잘못된 사번으로 제출됨 |
| 백엔드 라우터 경로 변경 | 프론트엔드 API 호출 전체 깨짐 |
| exe 절대 경로 하드코딩 | 다른 서버 배포 시 즉시 실패 |
| `useDashboard()` 공개 인터페이스 변경 | 20+ 컴포넌트 동시 깨짐 |
| `react-router-dom` 도입 | 커스텀 히스토리 스택과 충돌 |
| 추가 전역 상태 라이브러리 도입 (zustand 등) | 별도 아키텍처 결정 필요, 현재 범위 외 |
| MySQL 스키마 변경 | 별도 마이그레이션 필요 |
| `components/analysis/ComponentWizard.jsx` 이름 유지 | `pages/analysis/ComponentWizard.jsx`와 동명 충돌 |
