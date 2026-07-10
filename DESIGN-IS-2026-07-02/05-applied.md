# 05 — 적용된 개선 (REFINE 실행 결과)

감사(23/30, REFINE) 후 상위 개선 항목을 실제 코드에 적용하고 **라이브 dev 서버(localhost:5173)에서 검증**했다. 콘솔 앱 오류 0.

## 변경 파일

- `HiTessWorkBench/frontend/src/pages/dashboard/Dashboard.jsx` (주 대상)
- `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` (핸드오프 수신 1곳)

## 적용 내역

### 1. [#4 이해가능성] 코드네임 → 앱 타이틀 매핑 ✅
- 헬퍼 `toDisplayProgramName()` 추가 — `findAppByProgramName()`으로 내부 코드키를 사람이 읽는 타이틀로 변환(실패 시 원본 유지, `title` 속성에 원본 보존).
- 적용: 인기 해석 프로그램 카드(top3)·순위 모달·프로젝트 이력 표 "모듈(유형)" 열.
- 검증: `GroupModuleUnit → Group & Module Unit 권상 구조 해석`, `HiTessModelBuilder → HiTESS Model Builder`, `MooringFitting → Mooring Fitting Assessment` 로 표기 확인.

### 2. [#2 유용성] 프로젝트 이력 행 클릭 → 결과 상세 자동 오픈 ✅
- `ProjectRow`를 클릭·키보드 접근 가능(`role=button`, `tabIndex=0`, Enter/Space, `aria-label`, focus-visible 링, hover 강조, 프로젝트명 hover 링크화)으로 개선.
- `handleOpenProjectDetail()`: 선택 프로젝트 객체를 sessionStorage(`workbench:open-project-detail`)에 저장 후 My Projects로 이동.
- `MyProjects.jsx`: 마운트 시 해당 키를 읽어 `setSelectedProject()`로 상세 모달 자동 오픈 후 키 제거.
- 검증(E2E): 이력 행 클릭 → currentMenu="My Projects" → 프로젝트 ID 1641 상세 모달 자동 오픈(해석 완료, BDF/STEP1 결과 파일 다운로드·3D 시각화 노출) → sessionStorage 키 정리 확인. 대시보드에서 단절됐던 "결과 확인·다운로드" 동선이 1클릭으로 연결됨.

### 3. [#4/#8 접근성] 저대비 텍스트/링크 상향 ✅
- 표 ID열·"최근 5건…" 힌트·순위 모달 라벨(집계 건수/표시 앱/1위 점유율) `text-slate-400 → text-slate-500`.
- "자료" 라벨(틴트 배경) `text-slate-400 → text-slate-600`.
- "전체 이력 보기" 링크 `text-blue-500 → text-blue-600`(hover blue-700).
- 검증(라이브 픽셀 측정): 이력 ID 4.76:1 · 전체 이력 보기 링크 4.98:1 · 자료 라벨 5.13:1 — 전부 본문 기준 4.5:1 통과(변경 전 2.4~3.7:1 실패).

### 4. [#5/#7/#10 절제] 히어로 다이어트 ✅
- 영문 대문자 eyebrow "ENGINEERING CONTROL ROOM" 제거(자사 anti-reference·DiscoverHiTessBanner 기존 결정과 일치). 제목 앞 작은 상태 점만 유지.
- 히어로 정보 타일 4→3: 저가치 "접속 IP"·"연결 서버"를 "연결 서버" 단일 타일로 통합(서버 host = 값, 내 IP = 부제 → 정보 손실 없음). 그리드 `grid-cols-1 sm:grid-cols-3`.
- 검증: 1440px·2560px 스크린샷에서 히어로 균형·정보 유지 확인.

### 5. [#9 자원] 유휴 모션·폴링 — 코드 변경 없음(사유 명시)
- 상시 애니메이션 2종(online `animate-pulse`, 공지 `animate-ping`)은 `prefers-reduced-motion` 전역 처리(index.css)로 이미 완화, 의미 있는 상태 어포던스라 유지.
- 큐 폴링 3초는 `document.hidden` 가드로 비활성 탭 시 정지 — 현 수준 적정 판단, 변경 시 실익 대비 위험이 커 보류.

## 회귀 확인(보존 3항목)
- #3 미학: 카드 시스템(DASHBOARD_CARD_BASE)·토큰 그대로. 시각 회귀 없음(스크린샷).
- #6 정직: 모든 라이브 API 렌더 유지, 가짜 데이터 유입 없음.
- #8 꼼꼼함: empty/loading/error/success/focus/disabled 상태 유지 + 이력 행에 focus-visible 링 신규 추가.
- 빌드: Vite HMR 재컴파일, 콘솔 **앱 오류 0**.

## 6. [#4 이해가능성 · 확장] 코드네임 매핑을 MyProjects 표면으로 확장 ✅
대시보드에 이어 My Projects 전 표면의 코드키 표기를 사람이 읽는 이름으로 통일했다.
- **헬퍼 공용화**: `toDisplayProgramName`(Dashboard 로컬)을 제거하고 `getDisplayProgramName`으로 **`DashboardContext.jsx`에서 export**(단일 출처). Dashboard·MyProjects가 공통 사용.
- **적용 지점(표시 전용)**: 상세 모달 "App" 필드(`ProjectDetailModal` 221) · 이력 표 "App" 열(694) · "즐겨쓴 모듈" 통계(518) · "모듈별 사용" 막대 라벨+툴팁(552·556) · 프로그램 필터 드롭다운 라벨(610, **value는 원본 유지**).
- **로직 불변 보장**: `program_name` 기반 분기(모달 타입 판별 108–113, 필터 API 파라미터 328, moduleCount 키 380, 필터 onClick 550)는 원본 코드키 그대로 사용 — 표시만 매핑. 원본 코드는 `title` 툴팁에 보존.
- **검증(E2E)**: 대시보드 행 클릭 → 상세 모달 "App" = "Group & Module Unit 권상 구조 해석"(코드키 미노출), 모달이 올바른 타입(ProjectDetailModal)으로 정상 오픈 → 로직 무결. 이력 표 App 열도 동일 매핑(툴팁 raw=GroupModuleUnit). 대시보드 매핑 회귀 없음, 콘솔 앱 오류 0.

### 변경 파일(확장분)
- `frontend/src/contexts/DashboardContext.jsx` (getDisplayProgramName export 추가)
- `frontend/src/pages/dashboard/Dashboard.jsx` (로컬 헬퍼 → 공용 import로 정리)
- `frontend/src/pages/analysis/MyProjects.jsx` (표시 5개 지점 매핑)

→ 이제 대시보드·My Projects 전역에서 앱 이름 표기가 일관됨. 앱 전역 이름 일관성 완료.
