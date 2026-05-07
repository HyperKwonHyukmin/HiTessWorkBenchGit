# AGENTS.md

이 파일은 Codex(Codex.ai/code)가 이 저장소에서 작업할 때 참고하는 지침서입니다.

## 프로젝트 개요

**HiTESS WorkBench**는 사내 구조 해석 플랫폼입니다. 기존의 레거시 구조 해석 실행 파일(`.exe`)들을 현대적인 웹 UI로 감싸고 AI 어시스턴트를 결합한 시스템으로, Electron 데스크톱 앱(포터블 `.exe`)으로 배포되며 팀 공용 서버와 통신합니다.

## 개발 명령어

### 백엔드 (FastAPI)

```bash
# 가상환경 활성화 (Windows)
HiTessWorkBenchBackEnd/WorkBenchEnv/Scripts/activate

# 개발 서버 실행 (HiTessWorkBenchBackEnd/ 에서)
uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload

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

## 아키텍처

```
[Electron shell]  →  개발: localhost:5173 로드 / 프로덕션: frontend/dist/index.html 로드
[React SPA]       →  REST API로 백엔드 서버와 통신
[FastAPI backend] →  해석 작업 수행, DB 데이터 제공, AI 질의 처리
```

### 주요 설정 포인트

- **백엔드 URL**: `HiTessWorkBench/frontend/src/config.js`의 `DEFAULT_API_BASE_URL` — 기본값 `http://10.133.122.70:9091`. 사용자가 앱 내에서 서버 주소를 변경하면 `localStorage`의 `'server_url'` 키에 저장되며 이 값이 우선 사용됨(`setApiBaseUrl()` 함수로 런타임 변경 가능).
- **백엔드 개발 서버 포트**: `9091` (uvicorn 실행 시 `--port 9091` 사용).
- **데이터베이스**: MySQL `localhost:3306/hitessworkbench`, 접속 정보는 `HiTessWorkBenchBackEnd/app/database.py`. SQLAlchemy로 서버 시작 시 테이블 자동 생성.
- **Electron 환경 감지**: `electron/index.js`의 `app.isPackaged` 여부로 개발/프로덕션 로드 경로 분기.

### 프론트엔드 내비게이션 구조

React Router 대신 **NavigationContext** (`src/contexts/NavigationContext.jsx`)를 사용합니다. `useReducer` 기반으로 `history[]` 배열과 `currentIndex`를 원자적으로 관리합니다. 페이지 컴포넌트에서 `useNavigation()` 훅으로 `setCurrentMenu(name)`, `goBack()`, `goForward()` 등에 접근합니다(이전의 props drilling 방식 제거). 전체 라우팅 분기는 `App.jsx:renderPage()`의 switch문에 있습니다.

키보드 단축키: **Alt + ←** (뒤로), **Alt + →** (앞으로), **F5** (새로고침 방지).

### 주요 Context

| 파일 | 훅 | 역할 |
|------|-----|------|
| `contexts/NavigationContext.jsx` | `useNavigation()` | 페이지 히스토리 스택 관리, 뒤로/앞으로 이동 |
| `contexts/DashboardContext.jsx` | `useDashboard()` | 해석 앱 메타데이터, 전역 작업 추적, 즐겨찾기 |
| `contexts/ToastContext.jsx` | `useToast()` | 전역 토스트 알림 |

**DashboardContext** 주요 값:

- `ANALYSIS_DATA` — 전체 해석 앱 메타데이터 목록 (mode, category, title, devStatus, contributor)
- `globalJob` / `startGlobalJob` / `clearGlobalJob` — 화면 우측 하단 고정 백그라운드 작업 추적 위젯
- `assessmentPageState` / `setAssessmentPageState` — 페이지 이탈 시에도 TrussAssessment 상태 유지
- `favorites` / `toggleFavorite` — 사용자 즐겨찾기 앱 목록

### 해석 작업 흐름

1. 프론트엔드에서 파일 업로드 → `POST /api/analysis/{type}/request` (type: `truss`, `assessment`, `beam`)
2. 백엔드가 `userConnection/{timestamp}_{employee_id}_{ProgramName}/` 폴더에 파일 저장
3. `app/services/job_manager.py`의 `ThreadPoolExecutor`(최대 5개 동시 실행)에 작업 제출
4. 서비스 파일(`truss_service.py`, `assessment_service.py`, `beam_service.py`, `bdfscanner_service.py`, `hitess_modelflow_service.py`)이 `InHouseProgram/`의 `.exe` 실행
5. 프론트엔드에서 1.5초마다 `GET /api/analysis/status/{job_id}` 폴링 (0~100%)
6. 완료 후 결과 파일 경로를 DB `result_info` (JSON 컬럼)에 저장, `GET /api/download?filepath=...`로 다운로드

작업 상태는 인메모리(`job_status_store` dict)에 저장됩니다. 서버 재시작 시 진행 중인 작업 상태가 소실되는 구조적 한계가 있습니다(프로덕션에서는 Redis 권장).

**다운로드 보안**: `GET /api/download`는 `os.path.abspath` 프리픽스 검사로 `userConnection/` 디렉토리 외부 경로 접근을 차단합니다.

**Excel 내보내기**: `GET /api/analysis/export-xlsx`는 TrussAssessment JSON 결과를 BytesIO 메모리에서 XLSX로 변환하여 반환합니다. 디스크에 저장하지 않아 회사 DRM 소프트웨어의 자동 암호화를 우회합니다.

### AI 파이프라인

- 관리자가 `POST /api/ai/ingest` 호출 → `app/AI/ingest.py`가 문서를 청킹하여 FAISS 인덱스 + BM25 피클 생성 (`app/AI/vectorstore/`에 저장)
- 채팅: `POST /api/ai/chat` → `app/AI/chain.py`에서 멀티 쿼리 재구성 → 하이브리드 검색(BM25 30% + 벡터 70%) → Ollama LLM(`qwen2.5:7b`, `localhost:11434`)으로 답변 생성
- 임베딩 모델: BGE-M3 (다국어)

### 인증

- 사번(employee_id)만으로 로그인 (별도 비밀번호 없음). 신규 사용자는 기본 비활성 상태이며 관리자 승인 후 사용 가능.
- 세션은 `localStorage`의 `'user'` 키에 저장되고 props/context로 전달. JWT 없음.
- `User` 모델의 `is_admin` 플래그로 관리자 페이지 접근 제어.

### DB 모델 (`app/models.py`)

| 모델 | 테이블 | 주요 컬럼 |
|------|--------|-----------|
| `User` | `users` | employee_id, is_active, is_admin, login_count |
| `Analysis` | `analysis` | program_name, input_info (JSON), result_info (JSON), source |
| `Notice` | `notices` | type, is_pinned |
| `UserGuide` | `user_guides` | category, content |
| `FeatureRequest` | `feature_requests` | status, upvotes, admin_comment |

### 백엔드 라우터 구조

| 파일 | 프리픽스 | 역할 |
|------|----------|------|
| `routers/auth.py` | `/api`, `/member` | 로그인, 회원가입, 사번+회사 기반 사용자 확인 (`/check_user`) |
| `routers/users.py` | `/api/users` | 사용자 CRUD, 승인 |
| `routers/analysis.py` | `/api/analysis` | 작업 제출, 상태 조회, 이력, 다운로드, xlsx 내보내기 |
| `routers/support.py` | `/api` | 공지사항, 사용자 가이드, 기능 요청 |
| `routers/system.py` | `/api/system` | CPU/메모리/DB 상태, 큐 현황 |
| `routers/ai.py` | `/api/ai` | 채팅, 인덱싱, 문서 목록 |
| `routers/davit.py` | `/api/davit` | Mast Post / Jib Rest 다빗 구조 계산 |
| `routers/column_buckling.py` | (별도 프리픽스) | AISC 기둥 좌굴 하중 계산 |

**`/member/check_user`**: 사번(`userID`) + 회사(`company`) 기반으로 사용자 등록·승인 여부 확인. `/api/check_user`로도 동일하게 접근 가능. Electron 앱 초기 로그인에 사용.

### 프론트엔드 페이지 구조

`HiTessWorkBench/frontend/src/pages/`에 위치하며 `App.jsx:renderPage()`의 switch문으로 라우팅됩니다.

**File-Based / 해석 앱**

| 메뉴 이름 | 컴포넌트 | 설명 |
|-----------|----------|------|
| `'Dashboard'` | `dashboard/Dashboard.jsx` | 메인 대시보드, 통계 및 즐겨찾기 |
| `'My Project'` / `'My Projects'` | `analysis/MyProjects.jsx` | 내 해석 이력 및 프로젝트 관리 |
| `'New Analysis'` / `'File-Based Apps'` | `analysis/NewAnalysis.jsx` | 파일 업로드 기반 해석 선택 |
| `'Truss Analysis'` | `analysis/TrussAnalysis.jsx` | CSV 업로드 + 3D 모델 뷰어 |
| `'Truss Structural Assessment'` | `analysis/TrussAssessment.jsx` | BDF 업로드 + 구조 안정성 평가 |
| `'HiTess ModelFlow'` | `analysis/HiTessModelFlow.jsx` | CSV → BDF → Nastran 전체 FEM 파이프라인 (개발 중) |
| `'BDF Scanner'` | `analysis/BdfScanner.jsx` | BDF 유효성 검증 + 선택적 Nastran 해석 |

**Interactive / Parametric 앱**

| 메뉴 이름 | 컴포넌트 | 설명 |
|-----------|----------|------|
| `'Interactive Apps'` | `analysis/InteractiveApps.jsx` | 대화형 해석 앱 진입점 |
| `'Component Wizard'` / `'Simple Beam Assessment'` / `'Simple Beam Analyzer'` | `analysis/SimpleBeamAssessmentPage.jsx` | 단면 입력 기반 보(Beam) 응력·변위 평가 |
| `'Parametric Apps'` | `analysis/ParametricApps.jsx` | 파라메트릭 해석 앱 진입점 |
| `'Mast Post Assessment'` | `analysis/MastPostAssessment.jsx` | Post 높이·하중 입력 → 최적 파이프 후보 산출 |
| `'Jib Rest Assessment'` | `analysis/JibRestAssessment.jsx` | Jib Rest 1단/2단 파이프 설계 후보 산출 |
| `'Column Buckling Load Calculator'` | `analysis/ColumnBucklingCalculator.jsx` | AISC 기준 기둥 좌굴 허용 하중 계산 |
| `'Productivity Apps'` | `analysis/ProductivityApps.jsx` | 생산성 도구 모음 진입점 |
| `'Beam Result Viewer'` | `analysis/BeamAnalysisViewer.jsx` | JSON/CSV 결과 시각화 |

**Support / 관리자**

| 메뉴 이름 | 컴포넌트 | 설명 |
|-----------|----------|------|
| `'Notice & Updates'` | `Support/NoticeBoard.jsx` | 공지사항 게시판 |
| `'Feature Requests'` / `'User Requests'` | `Support/UserRequests.jsx` | 기능 요청 및 건의 |
| `'User Guide'` | `Support/UserGuide.jsx` | 사용자 가이드 |
| `'AI Lab Assistant'` / `'AI Assistant'` | `AI/AiAssistantHub.jsx` | RAG 기반 AI 채팅 |
| `'Hi-Lab Insight'` | `AI/HiLabInsight.jsx` | AI 인사이트 페이지 |
| `'User Management'` | `Administration/UserManagement.jsx` | 관리자: 사용자 승인/관리 |
| `'Analysis Management'` | `Administration/AnalysisManagement.jsx` | 관리자: 전체 해석 이력 |
| `'System Settings'` | `Administration/SystemSettings.jsx` | 관리자: 시스템 모니터링 |
| `'API Apps'` | `Administration/ApiApps.jsx` | 관리자: API 연동 앱 관리 |
