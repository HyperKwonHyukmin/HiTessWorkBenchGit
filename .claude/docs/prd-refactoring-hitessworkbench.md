# HiTessWorkBench 전체 코드베이스 리팩토링 PRD

> 작성일: 2026-04-03

## 🎯 핵심 정보

**목적**: API 호출 불일치, 1000+ 라인 단일 컴포넌트, 하드코딩 값, 에러 처리 파편화로 인한 유지보수 비용 증가 및 일관성 결여 해소
**대상**: 프론트엔드 전체 (pages/analysis, components, api, hooks, contexts) + 백엔드 핵심 서비스 계층 (routers, services)

---

## 🔍 현재 상태 분석

### 현재 구조

```
Frontend (React + Vite + Tailwind)
├── App.jsx           ← 커스텀 히스토리 스택 라우터
├── contexts/         ← DashboardContext (전역 상태), NavigationContext, ToastContext
├── api/              ← analysis.js (axios), admin.js (axios), auth.js
├── hooks/            ← useAnalysisManager (fetch), useFileParser, useBeamModeling, useServerStatus
├── pages/
│   ├── analysis/     ← TrussAnalysis(689L), TrussAssessment(1409L), ComponentWizard(1057L)...
│   ├── Administration/ ← AnalysisManagement(567L), SystemSettings, UserManagement
│   └── AI/           ← AiAssistantHub, HiLabInsight
└── components/       ← Layout, Sidebar, BdfViewerModal(414L), BeamSharedUI, Viewer3D

Backend (FastAPI + SQLAlchemy)
├── main.py           ← CORS 전체 허용
├── database.py       ← MySQL, 환경변수 기반
├── models.py         ← User, Analysis, Notice, UserGuide, FeatureRequest
├── routers/          ← analysis, auth, users, system, support, ai, davit
└── services/         ← job_manager, truss_service, assessment_service, beam_service
```

### 식별된 문제점

- **API 호출 이중화**: `api/` 폴더는 `axios` 사용, `hooks/useAnalysisManager.js` 및 `Dashboard.jsx`는 `fetch` 직접 사용 — 동일 백엔드 엔드포인트를 두 방식으로 호출
- **컴포넌트 비대화**: `TrussAssessment.jsx` 1409라인에 3D 뷰어 초기화, 결과 테이블, 로그 패널, 폴링, XLSX 다운로드 모두 혼재. `ComponentWizard.jsx` 1057라인도 동일 구조
- **폴링 로직 파편화**: `TrussAnalysis.jsx`는 `setInterval + pollIntervalRef`, `DashboardContext.jsx`는 `setTimeout + pollTimeoutRef`, `useAnalysisManager.js`는 별도 로직 — 동일 목적의 3가지 서로 다른 구현
- **하드코딩된 직원 ID**: `useAnalysisManager.js:80`에 `"A476854"` 리터럴 — 해당 사번 외 사용자 API 요청 오작동
- **숫자/문자열 매직값**: `ComponentWizard.jsx:57` 기본 하중 `-5000N`, `beam_service.py:27` exe 절대 경로 `C:\Coding\WorkBench\...`, `main.py:33` 헬스체크 `"kwonhyukmin"` 응답
- **에러 처리 비일관성**: 일부 컴포넌트는 Toast 알림, 일부는 로그 패널 출력, 일부는 console.log만 — axios interceptor 없음
- **UI 패턴 불일치**: 로딩 표시(progress bar vs spinner vs 없음), 숫자 포매팅(`engFormat` vs `fmt` vs 인라인 `toFixed`), 버튼 비활성화 조건 컴포넌트마다 상이
- **CORS 전체 허용**: `main.py`의 `allow_origins=["*"]` — 사내 서버임에도 모든 외부 출처 허용
- **컴포넌트/함수 이름 중복**: `pages/analysis/ComponentWizard.jsx`(1057L)와 `components/analysis/ComponentWizard.jsx`(282L) 동명 파일 존재

### 개선 필요 이유

하드코딩 직원 ID로 인해 타 사용자 요청이 잘못된 사번으로 제출되는 기능 버그가 현재 존재합니다. `TrussAssessment.jsx`가 1400라인을 초과하여 새 기능 추가 또는 버그 수정 시 영향 범위 파악이 어렵습니다. API 호출 방식 혼재로 인해 오류 처리 로직을 두 곳에서 별도 관리해야 합니다. 폴링 로직이 3곳에 분산되어 폴링 간격 변경 시 3개 파일을 모두 수정해야 합니다.

---

## ⚡ 개선 요구사항

### 1. 핵심 개선 요구사항

| ID | 요구사항 | 설명 | 필수 이유 | 대상 모듈 |
|----|----------|------|-----------|-----------|
| **R001** | API 호출 방식 통일 | 모든 API 호출을 `api/` 폴더의 axios 기반 함수로 통일 | fetch/axios 혼재로 에러 처리 이중화, 유지보수 비용 증가 | analysis.js, admin.js, useAnalysisManager, Dashboard |
| **R002** | 폴링 로직 단일 커스텀 훅화 | `usePolling` 훅으로 폴링 로직 추출 및 통합 | 3곳의 서로 다른 구현을 하나로 통일하여 변경 비용 최소화 | useAnalysisManager, TrussAnalysis, DashboardContext |
| **R003** | 대형 컴포넌트 분리 | 500라인 초과 컴포넌트를 단일 책임 서브컴포넌트로 분리 | 1400라인 단일 파일은 유지보수, 코드 리뷰, 버그 추적 모두 어려움 | TrussAssessment, ComponentWizard, AnalysisManagement, BdfViewerModal |
| **R004** | 하드코딩 직원 ID 제거 | `useAnalysisManager.js:80`의 `"A476854"` 리터럴을 localStorage 사용자 정보로 교체 | 기능 버그: 다른 사용자도 해당 사번으로 API 요청 제출됨 | useAnalysisManager |
| **R005** | 매직값 상수화 | exe 경로, 기본 하중값, 헬스체크 문자열 등 하드코딩 값을 상수/환경변수로 추출 | 경로 변경 시 코드 수정 필요, 다른 개발 환경에서 즉시 실패 | beam_service, ComponentWizard, main |
| **R006** | 공용 UI 유틸리티 통일 | 숫자 포매팅, 파일명 추출, 날짜 포매팅 함수를 `utils/` 공용 모듈로 통합 | 동일 로직 5+ 곳 중복, 한 곳 수정 시 나머지 미반영 위험 | MyProjects, TrussAnalysis, MastPostAssessment, ComponentWizard |
| **R007** | 동명 파일 명확화 | `pages/analysis/ComponentWizard.jsx`와 `components/analysis/ComponentWizard.jsx` 이름 구분 | import 경로 혼동, 잘못된 파일 수정 위험 | pages/analysis/ComponentWizard, components/analysis/ComponentWizard |

### 2. 호환성 유지 요구사항

| ID | 요구사항 | 설명 | 필수 이유 | 대상 모듈 |
|----|----------|------|-----------|-----------|
| **R010** | 기존 API 엔드포인트 유지 | 백엔드 라우터 경로 및 요청/응답 스키마 변경 없음 | 기존 작동 중인 해석 요청 호환성 유지 | analysis, auth, system, support |
| **R011** | App.jsx 라우팅 인터페이스 유지 | `setCurrentMenu(name)` 호출 방식 유지 | 모든 페이지 컴포넌트가 동일 방식으로 네비게이션 | App |
| **R012** | DashboardContext 공개 인터페이스 유지 | `useDashboard()`로 접근하는 모든 공개 값/함수 시그니처 유지 | 20+ 컴포넌트에서 동일 인터페이스로 사용 중 | DashboardContext |

### 3. 이번 범위에서 제외 (다음 단계)

- 전역 상태 관리 라이브러리 교체 (zustand/Redux) — 현재 Context API로 충분, 별도 아키텍처 결정 필요
- 백엔드 인메모리 job_status_store → Redis 마이그레이션 — 인프라 변경 범위, 별도 PRD 필요
- 단위 테스트/통합 테스트 코드 작성 — 별도 QA PRD 필요
- CORS 설정 제한 — 현재 사내 네트워크만 접근하므로 보안 정책 결정 후 별도 처리
- AI 파이프라인 (ingest, chain) 개선 — 별도 도메인

---

## 🗺️ 영향 범위

```
📦 직접 변경 대상
├── 🔧 useAnalysisManager
│   └── 요구사항: R001, R002, R004 (fetch→axios 교체, usePolling 적용, 하드코딩 ID 제거)
├── 🔧 analysis.js
│   └── 요구사항: R001 (누락된 엔드포인트 함수 추가 및 완결화)
├── 🔧 admin.js
│   └── 요구사항: R001 (일관성 유지 확인 및 미흡 부분 보완)
├── 🔧 usePolling (신규)
│   └── 요구사항: R002 (폴링 로직 단일 훅으로 추출)
├── 🔧 TrussAnalysis
│   └── 요구사항: R002 (usePolling 적용, 중복 로직 제거)
├── 🔧 TrussAssessment
│   └── 요구사항: R002, R003 (서브컴포넌트 분리, usePolling 적용)
├── 🔧 ComponentWizard (page)
│   └── 요구사항: R003, R007 (서브컴포넌트 분리, 파일명 변경)
├── 🔧 AnalysisManagement
│   └── 요구사항: R003 (테이블/필터 서브컴포넌트 분리)
├── 🔧 BdfViewerModal
│   └── 요구사항: R003 (414라인 → 논리 분리)
├── 🔧 DashboardContext
│   └── 요구사항: R002 (usePolling 적용으로 폴링 로직 교체)
├── 🔧 utils/ (신규: formatting.js, fileHelper.js)
│   └── 요구사항: R006 (공용 유틸리티 통합)
├── 🔧 MyProjects, MastPostAssessment
│   └── 요구사항: R006 (중복 포매팅/파일명 처리 → utils 사용)
├── 🔧 beam_service
│   └── 요구사항: R005 (exe 경로 환경변수 또는 설정 상수로 추출)
├── 🔧 main (백엔드)
│   └── 요구사항: R005 (헬스체크 하드코딩 문자열 제거)
└── 🔧 ComponentWizard (component → BeamModelPreview)
    └── 요구사항: R007 (파일명 → BeamModelPreview 또는 명확한 이름으로 변경)

📦 간접 영향 대상 (변경 없이 영향받는 모듈)
├── ⚠️ TrussAssessment 하위 서브컴포넌트 (신규 분리)
│   └── 영향: R003으로 생성되는 새 파일들이 TrussAssessment에서 import됨
├── ⚠️ Dashboard
│   └── 영향: R001로 fetch 직접 호출이 api/ 함수 호출로 교체됨
└── ⚠️ truss_service, assessment_service
    └── 영향: R005의 상수화 패턴 참고 (직접 변경은 beam_service만)

🔒 변경 불가 (호환성 유지 대상)
├── 🚫 백엔드 라우터 경로 (/api/analysis/*, /api/auth/*, ...) - R010
├── 🚫 App.jsx setCurrentMenu 인터페이스 - R011
└── 🚫 useDashboard() 공개 값/함수 시그니처 - R012
```

---

## 📄 모듈별 상세 개선 내용

### useAnalysisManager

> **구현 요구사항:** `R001`, `R002`, `R004` | **변경 유형:** 리팩토링

| 항목 | 내용 |
|------|------|
| **역할** | 해석 요청 제출, 작업 상태 관리, 결과 데이터 보관의 단일 진입점 훅 |
| **현재 문제** | ① `fetch` 직접 사용으로 `api/analysis.js`와 중복 구현 ② 하드코딩된 `"A476854"` 직원 ID ③ 자체 폴링 로직이 `TrussAnalysis.jsx`의 것과 별개로 존재 |
| **개선 내용** | • `fetch` 호출을 `api/analysis.js` 함수 호출로 교체 <br>• `employee_id`를 `localStorage.getItem('user')` 파싱으로 동적 추출 <br>• 폴링 로직을 `usePolling` 훅 호출로 교체 |
| **완료 기준** | • `useAnalysisManager.js`에 `fetch(` 문자열 0개 <br>• `"A476854"` 리터럴 0개 <br>• `setInterval`/`setTimeout` 직접 호출 0개 (usePolling으로 위임) |
| **구현 요구사항 ID** | `R001`, `R002`, `R004` |

---

### analysis.js

> **구현 요구사항:** `R001` | **변경 유형:** 리팩토링

| 항목 | 내용 |
|------|------|
| **역할** | 모든 해석 관련 API 호출의 단일 창구 (요청/상태/다운로드/xlsx) |
| **현재 문제** | `useAnalysisManager.js`와 `Dashboard.jsx`가 직접 fetch를 사용하여 이 파일을 우회함 — 파일이 존재하지만 완전히 활용되지 않음 |
| **개선 내용** | • `useAnalysisManager`가 필요로 하는 fetch 호출 함수들을 이 파일에 추가/정의 <br>• 함수 시그니처와 반환 형식을 기존 함수들과 통일 <br>• 모든 호출부에서 이 파일의 함수만 사용하도록 정리 |
| **완료 기준** | • 프로젝트 내 `fetch('/api/analysis` 패턴 0건 (모두 이 파일 함수 호출로 교체) <br>• 기존 함수 시그니처 변경 없음 |
| **구현 요구사항 ID** | `R001` |

---

### admin.js

> **구현 요구사항:** `R001` | **변경 유형:** 리팩토링

| 항목 | 내용 |
|------|------|
| **역할** | 관리자/시스템 관련 API 호출 함수 집합 — axios 기반 단일화 |
| **현재 문제** | `AnalysisManagement.jsx` 등에서 fetch 직접 호출이 혼용되어 admin.js 함수가 완전히 활용되지 않음 |
| **개선 내용** | • 누락된 관리자 API 함수 추가 <br>• 호출부의 직접 fetch 코드를 admin.js 함수로 교체 |
| **완료 기준** | • `AnalysisManagement.jsx` 내 직접 fetch 호출 0건 |
| **구현 요구사항 ID** | `R001` |

---

### usePolling (신규)

> **구현 요구사항:** `R002` | **변경 유형:** 추출/신규

| 항목 | 내용 |
|------|------|
| **역할** | 작업 상태 폴링의 단일 재사용 훅: 시작/중지, 언마운트 자동 정리, 타임아웃 처리 |
| **현재 문제** | `TrussAnalysis.jsx` (setInterval+retryCount), `DashboardContext.jsx` (setTimeout+재귀), `useAnalysisManager.js` (자체 폴링) — 동일 목적의 3가지 서로 다른 구현 |
| **개선 내용** | • `hooks/usePolling.js` 신규 생성 <br>• `usePolling({ jobId, interval, maxRetries, onProgress, onComplete, onError })` 인터페이스 정의 <br>• `useEffect` 의존성 배열 기반 자동 시작/중지 <br>• 언마운트 시 cleanup 함수 반환으로 메모리 누수 방지 |
| **완료 기준** | • `TrussAnalysis.jsx`, `DashboardContext.jsx`, `useAnalysisManager.js` 내 `setInterval`/`setTimeout` 기반 폴링 코드 0건 <br>• 모든 폴링 호출자가 `usePolling` 훅 사용 |
| **구현 요구사항 ID** | `R002` |

---

### TrussAnalysis

> **구현 요구사항:** `R002` | **변경 유형:** 리팩토링

| 항목 | 내용 |
|------|------|
| **역할** | CSV 파일 기반 트러스 해석 실행 및 3D 결과 뷰어 페이지 |
| **현재 문제** | 자체 `setInterval + pollIntervalRef + retryCount` 폴링 구현이 3중 중복 유지 |
| **개선 내용** | • 기존 `setInterval` 폴링 블록을 `usePolling` 훅 호출로 교체 <br>• `retryCount` 상태 제거 (usePolling이 내부 관리) |
| **완료 기준** | • `TrussAnalysis.jsx`에 `setInterval` 직접 사용 0건 <br>• `retryCount` 관련 코드 0건 |
| **구현 요구사항 ID** | `R002` |

---

### TrussAssessment

> **구현 요구사항:** `R002`, `R003` | **변경 유형:** 분리/리팩토링

| 항목 | 내용 |
|------|------|
| **역할** | BDF 파일 업로드 및 구조 안정성 평가 오케스트레이터 — 렌더링 로직은 서브컴포넌트에 위임 |
| **현재 문제** | 1409라인에 3D 뷰어 초기화(~300L), 결과 테이블 렌더링(~400L), 로그 패널(~150L), 폴링(~100L), XLSX 다운로드(~100L) 모두 혼재 — 단일 책임 원칙 위반 |
| **개선 내용** | • 로그 패널 → `AssessmentLogPanel.jsx` 분리 <br>• 결과 요약 테이블 → `AssessmentResultTable.jsx` 분리 <br>• 파일 업로드 UI → `AssessmentFileUpload.jsx` 분리 <br>• TrussAssessment.jsx는 상태 관리 + 컴포넌트 조합만 담당 (목표 300라인 이내) <br>• 폴링 로직 `usePolling` 교체 |
| **완료 기준** | • `TrussAssessment.jsx` 300라인 이내 <br>• 분리된 각 서브컴포넌트 200라인 이내 <br>• `setInterval`/`setTimeout` 폴링 코드 0건 |
| **구현 요구사항 ID** | `R002`, `R003` |

---

### ComponentWizard (page → SimpleBeamAssessmentPage)

> **구현 요구사항:** `R003`, `R007` | **변경 유형:** 분리/리팩토링/명명

| 항목 | 내용 |
|------|------|
| **역할** | Simple Beam Assessment 입력 마법사 오케스트레이터 |
| **현재 문제** | 1057라인에 3D 모델 렌더링, 입력 폼, 결과 차트, API 호출 모두 혼재. `components/analysis/ComponentWizard.jsx`와 동명으로 import 경로 혼동 위험 |
| **개선 내용** | • 빔 입력 폼 → `BeamInputForm.jsx` 분리 <br>• 결과 패널 → `BeamResultPanel.jsx` 분리 <br>• 페이지 파일명 `SimpleBeamAssessmentPage.jsx`로 변경 <br>• 기본 하중값 `-5000` → `BEAM_DEFAULT_FORCE` 상수로 추출 |
| **완료 기준** | • `pages/analysis/ComponentWizard.jsx` 파일 없음 (→ `SimpleBeamAssessmentPage.jsx`) <br>• `pages/analysis/`에 동명 파일 충돌 0건 <br>• 분리 후 각 파일 200라인 이내 |
| **구현 요구사항 ID** | `R003`, `R007` |

---

### AnalysisManagement

> **구현 요구사항:** `R003` | **변경 유형:** 분리

| 항목 | 내용 |
|------|------|
| **역할** | 관리자의 전체 해석 이력 조회 및 관리 페이지 |
| **현재 문제** | 567라인에 검색/필터 UI, 데이터 테이블, 다운로드 로직, 페이지네이션이 혼재 |
| **개선 내용** | • 검색/필터 컨트롤 → `AnalysisFilterBar.jsx` 분리 <br>• 데이터 테이블 → `AnalysisHistoryTable.jsx` 분리 <br>• `AnalysisManagement.jsx`는 상태 관리 + 레이아웃 조합만 담당 |
| **완료 기준** | • `AnalysisManagement.jsx` 200라인 이내 <br>• 분리된 서브컴포넌트 각각 200라인 이내 |
| **구현 요구사항 ID** | `R003` |

---

### utils/formatting.js + utils/fileHelper.js (신규)

> **구현 요구사항:** `R006` | **변경 유형:** 추출/신규

| 항목 | 내용 |
|------|------|
| **역할** | 프로젝트 전체에서 재사용하는 순수 유틸리티 함수 모음 |
| **현재 문제** | `engFormat` (ComponentWizard), `fmt` (MastPostAssessment), 인라인 `toFixed` (여러 곳), 파일명 추출 `filePath.split('\\').pop().split('/').pop()` (MyProjects, TrussAnalysis 등 5+ 곳 중복) |
| **개선 내용** | • `utils/formatting.js`: `formatEngineering(val, digits)`, `formatDate(date)` 통일 함수 <br>• `utils/fileHelper.js`: `extractFilename(filePath)`, `getFileExtension(filePath)` 통일 함수 <br>• 기존 중복 인라인 코드를 utils 함수 호출로 교체 |
| **완료 기준** | • 중복 포매팅 인라인 코드 0건 (utils 함수 사용) <br>• `split('\\').pop().split('/').pop()` 패턴 0건 |
| **구현 요구사항 ID** | `R006` |

---

### ComponentWizard (component → BeamModelPreview)

> **구현 요구사항:** `R007` | **변경 유형:** 명명 변경

| 항목 | 내용 |
|------|------|
| **역할** | 빔 단면 3D 미리보기 컴포넌트 |
| **현재 문제** | `components/analysis/ComponentWizard.jsx`가 `pages/analysis/ComponentWizard.jsx`와 동일한 이름 — IDE 자동완성 및 import 경로 혼동 유발 |
| **개선 내용** | • `components/analysis/ComponentWizard.jsx` → `components/analysis/BeamModelPreview.jsx`로 파일명 변경 <br>• 컴포넌트 함수명도 `BeamModelPreview`로 변경 <br>• 이 컴포넌트를 import하는 모든 파일의 import 경로 업데이트 |
| **완료 기준** | • `components/analysis/ComponentWizard.jsx` 파일 없음 <br>• 모든 import에서 `BeamModelPreview` 참조 정상 동작 |
| **구현 요구사항 ID** | `R007` |

---

### DashboardContext

> **구현 요구사항:** `R002` | **변경 유형:** 리팩토링

| 항목 | 내용 |
|------|------|
| **역할** | 앱 전체 전역 상태 및 백그라운드 작업 추적 Provider |
| **현재 문제** | `setTimeout + pollTimeoutRef` 재귀 방식의 자체 폴링 구현 존재 |
| **개선 내용** | • 백그라운드 작업 폴링을 `usePolling` 훅 호출로 교체 <br>• R012(useDashboard 공개 인터페이스) 유지하면서 내부 구현만 교체 |
| **완료 기준** | • `DashboardContext.jsx`에 `setTimeout` 기반 폴링 코드 0건 <br>• `useDashboard()` 공개 인터페이스 변경 없음 |
| **구현 요구사항 ID** | `R002` |

---

### beam_service + main (백엔드)

> **구현 요구사항:** `R005` | **변경 유형:** 리팩토링

| 항목 | 내용 |
|------|------|
| **역할** | Beam 해석 실행 서비스 + FastAPI 애플리케이션 진입점 |
| **현재 문제** | `beam_service.py:27`의 exe 절대 경로 `C:\Coding\WorkBench\...` 하드코딩 — 다른 서버 배포 즉시 실패. `main.py:33` 헬스체크 응답값 `"kwonhyukmin"` 개인 식별자 사용 |
| **개선 내용** | • `beam_service.py`: exe 경로를 `os.getenv("BEAM_EXE_PATH")` 환경변수로 추출, 미설정 시 상대 경로 기본값 사용 <br>• `main.py`: 헬스체크 응답을 `{"status": "ok", "service": "HiTessWorkBench"}` 표준 형식으로 변경 <br>• `InHouseProgram/` 하위 exe 경로를 `settings.py` 상수 파일로 통합 |
| **완료 기준** | • `beam_service.py`에 절대 경로 리터럴 0개 <br>• `main.py` 헬스체크에 개인 식별자 0개 <br>• 다른 서버 환경에서 환경변수 설정만으로 경로 변경 가능 |
| **구현 요구사항 ID** | `R005` |

---

## 🔗 데이터/인터페이스 변경 사항

### 변경되는 인터페이스

| 대상 | 변경 유형 | 변경 내용 | 하위 호환성 |
|------|-----------|-----------|------------|
| `usePolling(options)` | 추가 (신규 훅) | `{ jobId, interval, maxRetries, onProgress, onComplete, onError }` 파라미터 인터페이스 | 신규 |
| `formatEngineering(val, digits)` | 추가 (신규 함수) | `utils/formatting.js`의 공용 포매터 | 신규 |
| `extractFilename(filePath)` | 추가 (신규 함수) | `utils/fileHelper.js`의 공용 파일명 추출 | 신규 |
| `ComponentWizard` (component) | 수정 | 파일명·컴포넌트명 `BeamModelPreview`로 변경 | 파괴 — import 경로 수정 필요 |
| `pages/analysis/ComponentWizard.jsx` | 수정 | 파일명 `SimpleBeamAssessmentPage.jsx`로 변경 | 파괴 — App.jsx import 수정 필요 |
| `main.py /health` 응답 | 수정 | `"kwonhyukmin"` → `{"status": "ok", "service": "HiTessWorkBench"}` | 파괴 — 헬스체크 클라이언트가 있다면 수정 필요 (현재 없음) |

### 하위 호환성 영향

- **영향 없음**: `useDashboard()` 공개 값/함수 (R012), 백엔드 라우터 경로 (R010), `setCurrentMenu` (R011), `api/analysis.js` 기존 함수 시그니처
- **영향 있음 (주의)**: `ComponentWizard` 컴포넌트 이름 변경 → App.jsx 및 `SimpleBeamAssessmentPage.jsx`의 import 경로 동시 수정 필요

---

## 🛠️ 기술 제약 조건

### 언어 / 프레임워크

- **React 18 + Vite** — Context API 유지, 추가 상태관리 라이브러리 도입 없음
- **Python 3.x + FastAPI** — SQLAlchemy 동기 세션 패턴 유지
- **Tailwind CSS** — 기존 `brand-blue`, 커스텀 클래스 유지
- **axios (프론트엔드)** — `api/` 폴더의 현재 버전 유지, 업그레이드 없음

### 변경 불가 외부 의존성

- **InHouseProgram/*.exe** — 사내 레거시 실행 파일, 호출 인터페이스(명령행 인수, 입출력 파일 구조) 변경 불가
- **MySQL `hitessworkbench` 스키마** — 테이블 구조 변경 없음
- **Ollama LLM (localhost:11434)** — AI 파이프라인 미포함

### 유지해야 하는 인터페이스 계약

- **`setCurrentMenu(name: string)`**: App.jsx 라우팅 진입점, 모든 페이지가 동일 방식으로 사용
- **`useDashboard()` 반환 값**: `ANALYSIS_DATA`, `globalJob`, `startGlobalJob`, `clearGlobalJob`, `assessmentPageState`, `setAssessmentPageState`, `favorites`, `toggleFavorite`
- **`GET /api/analysis/status/{job_id}` 응답 형식**: `{ status, progress, message, result }` — 폴링 훅이 의존
