# 프론트 구조, AI 파이프라인, DB 모델, 라우터, 페이지 표

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### 프론트엔드 내비게이션 구조

React Router 대신 **NavigationContext** (`src/contexts/NavigationContext.jsx`)를 사용합니다. `useReducer` 기반으로 `history[]` 배열과 `currentIndex`를 원자적으로 관리합니다. 페이지 컴포넌트에서 `useNavigation()` 훅으로 `setCurrentMenu(name)`, `goBack()`, `goForward()` 등에 접근합니다(이전의 props drilling 방식 제거). 전체 라우팅 분기는 `App.jsx:renderPage()`의 switch문에 있습니다.

키보드 단축키: **Alt + ←** (뒤로), **Alt + →** (앞으로), **F5** (새로고침 방지).

⚠ **한글 입력칸의 Enter 처리에는 조합 검사를 붙인다** (2026-10-19, v1.6.16): `if (e.nativeEvent.isComposing || e.keyCode === 229) return;`.
빠지면 글자 조합을 확정하는 Enter 가 전송·저장까지 실행해 마지막 글자가 두 번 보내지거나 빠진다. 적용된 곳은 `ChatDock`·`CommandPalette`·`AppSettings` 의 편집칸이다. Enter 로 보내거나 저장하는 입력칸을 새로 만들 때도 같이 넣을 것.

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


### AI 파이프라인

- 관리자가 `POST /api/ai/ingest` 호출 → `app/AI/ingest.py`가 문서를 청킹하여 FAISS 인덱스 + BM25 피클 생성 (`app/AI/vectorstore/`에 저장)
- 채팅: `POST /api/ai/chat` → `app/AI/chain.py`에서 멀티 쿼리 재구성 → 하이브리드 검색(BM25 30% + 벡터 70%) → Ollama LLM(`qwen2.5:7b`, `localhost:11434`)으로 답변 생성
- 임베딩 모델: BGE-M3 (다국어)


### DB 모델 (`app/models.py`)

| 모델 | 테이블 | 주요 컬럼 |
|------|--------|-----------|
| `User` | `users` | employee_id, is_active, is_admin, login_count |
| `Analysis` | `analysis` | program_name, input_info (JSON), result_info (JSON), source |
| `Notice` | `notices` | type, is_pinned |
| `UserGuide` | `user_guides` | category, content |
| `FeatureRequest` | `feature_requests` | status, upvotes, admin_comment |
| `AppSetting` | `app_settings` | app_key(=ANALYSIS_DATA title), dev_status, maintenance, maintenance_message, description, tags(JSON), contributor |
| `LogbookExport` | `logbook_exports` | analysis_id, sent_by, batch_key, state(staged/blocked/failed), file_count, blocked/rejected(JSON) |

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
| `routers/chat.py` | `/api/chat` | 관리자↔사용자 1:1 DM (폴링 기반, WebSocket 없음). `GET /contacts` 는 대화 가능한 활성 관리자 + 접속 상태(online/idle/offline)를 필드 화이트리스트로 반환 — 사용자가 먼저 대화를 걸 수 있는 진입점. 동명이인 구분용으로 contacts `department`·`position`, threads·conversation `other_department`·`other_position` 을 준다 → 화면은 이름 옆 `부서 · 직책`, 말풍선 `YYYY.MM.DD HH:MM`, 목록 시각은 오늘이면 시각·아니면 날짜(`utils/chatContacts.js`, 2026-10-23, v1.6.26 릴리스 — 채팅 화면은 눈으로 확인 안 함) |
| `routers/app_settings.py` | `/api/app-settings`, `/api/admin/app-settings` | App별 서비스 상태·점검·표시 메타 오버라이드 |
| `routers/admin_projects.py` | `/api/admin/projects` | 관리자 All Projects — 전체 이력·작업 폴더 파일 목록·LogBook 보내기 |

**`/member/check_user`**: 사번(`userID`) + 회사(`company`) 기반으로 사용자 등록·승인 여부 확인. `/api/check_user`로도 동일하게 접근 가능. Electron 앱 초기 로그인에 사용.

### 프론트엔드 페이지 구조

`HiTessWorkBench/frontend/src/pages/`에 위치하며 `App.jsx:renderPage()`의 switch문으로 라우팅됩니다.

**File-Based / 해석 앱**

| 메뉴 이름 | 컴포넌트 | 설명 |
|-----------|----------|------|
| `'Dashboard'` | `dashboard/Dashboard.jsx` | 메인 대시보드 — 새 해석 시작(파일 전달)·내 작업·월별 실행 |
| `'My Project'` / `'My Projects'` | `analysis/MyProjects.jsx` | 내 해석 이력 및 프로젝트 관리, 내 해석 LogBook 보내기(성공한 해석만) |
| `'New Analysis'` / `'File-Based Apps'` | `analysis/NewAnalysis.jsx` | 파일 업로드 기반 해석 선택 |
| `'Truss Analysis'` | `analysis/TrussAnalysis.jsx` | CSV 업로드 + 3D 모델 뷰어 |
| `'Truss Structural Assessment'` | `analysis/TrussAssessment.jsx` | BDF 업로드 + 구조 안정성 평가 |
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
| `'All Projects'` | `Administration/AllProjects.jsx` | 관리자: 모든 사용자의 My Projects — 작업 폴더 파일 받기·LogBook 보내기 |
| `'Usage Reports'` | `Administration/UsageReports.jsx` | 관리자: 일/주/월 사용량 정형 리포트, Excel 내보내기 |
| `'System Management'` | `Administration/SystemSettings.jsx` | 관리자: 시스템 모니터링 |
| `'App Settings'` (탭 `'App Community'`, `'API Apps'`) | `Administration/AppSettings.jsx` 외 | 관리자: App별 서비스 상태, 점검 모드, 표시 정보. 탭 묶음은 `constants/adminMenus.js` `ADMIN_TAB_GROUPS` |
| `'History'` (탭 `'Update History'`, `'Development History'`) | `Administration/UpdateHistory.jsx`, `DevelopmentHistory.jsx` | 관리자: 업데이트 이력, 개발 연대기 |
