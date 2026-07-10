# 00 — 감사 범위 (Scope Lock)

- **감사 일자**: 2026-07-02
- **감사 프레임워크**: Dieter Rams 10원칙 (design-is 스킬)
- **요청**: "현재 workbench의 dashboard의 디자인, UI, UX, 사용성, 활용도 측면에서 평가 수행"

## 감사 대상

- **제품**: HiTESS WorkBench (사내 통합 구조 해석 플랫폼, Electron + React/Vite + FastAPI)
- **표면(surface)**: 로그인 후 첫 화면인 **Dashboard 페이지**
  - 주 파일: `HiTessWorkBench/frontend/src/pages/dashboard/Dashboard.jsx` (1,784줄, 93KB)
  - 연관: `src/contexts/DashboardContext.jsx`, `src/components/DashboardFab.jsx`
  - 토큰/스타일: `DESIGN.md`(디자인 토큰 명세), `tailwind.config.js`, 전역 CSS
- **라이브 인스턴스**: Vite dev 서버 실행 중 — `http://localhost:5173` (스크린샷/계산 스타일 검사 가능. 사번 로그인 관문 있음 → 실패 시 소스 기반 INFERRED 모드로 폴백)

## 주 사용자 / 주 작업

- **주 사용자**: HD현대 사내 구조 엔지니어 (구조공학 전문가, 도구 일관성·예측 가능성 중시) — PRODUCT.md 기준
- **주 작업(primary task)**: "입력 파일 업로드 → 해석 실행 → 진행 상황 추적 → 결과 확인·다운로드"의 반복. Dashboard는 이 흐름의 **진입점·허브** 역할 — 원하는 해석 도구로의 빠른 도달과 진행 중 작업 상태 파악이 핵심.

## 제약

- **브랜드**: HD현대 Trust Blue `#002554` 기조, 절제된 색 사용 (DESIGN.md)
- **스택**: React 18 + Vite + Tailwind, Electron 셸
- **접근성 하한**: 본문 대비 ≥4.5:1, 색 단독 판정 금지, prefers-reduced-motion 대응 (PRODUCT.md)
- **안티레퍼런스**: 낡은 레거시 엔터프라이즈 UI(최우선 회피), AI/SaaS slop(그라데이션 텍스트·hero-metric 템플릿·동일 카드 그리드 반복·eyebrow 남발)

## 입력 자료

- `C:\Coding\WorkBench\PRODUCT.md` — 사용자·목적·브랜드·디자인 원칙
- `C:\Coding\WorkBench\DESIGN.md` — 색/타이포/간격/컴포넌트 토큰 명세
- 소스 코드 (frontend/src)
- 라이브 dev 서버 (localhost:5173)

## 범위 제외

- 개별 Studio 뷰어(ModelBuilder, MooringFitting 등)의 내부 화면
- 관리자 전용 페이지(Administration), AI 어시스턴트 페이지 자체 (Dashboard에서의 진입 동선만 평가)
- 백엔드 API 설계
