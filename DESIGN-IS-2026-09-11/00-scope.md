# Side Passage 전체 작업 흐름 UX 감사 범위

## 감사 대상

- WorkBench 진입 화면: `HiTessWorkBench/frontend/src/pages/analysis/SidePassageAssessment.jsx`
- Side Passage Studio 0.3.2: `C:/Coding/WorkBenchSubModule/SidePassageStudio/apps/side-passage-studio`
- 흐름: BDF 선택 → 입력 검증 → Studio 설치/실행 → 모델 확인 → 편집 → 권상 설정 → 자세안정성 → Unit 구조해석 → 통합 검증/기록 → BDF 저장·Workbench 복귀 → 결과 확인/다운로드
- 실행 표면: 로컬 WorkBench 개발 화면, 배포된 Studio 패키지, 필요 시 합성 모델 fixture. 실제 Nastran 실모델 성공을 이 UX 감사에서 주장하지 않는다.

## 사용자와 핵심 작업

- 주 사용자: Side Passage 장비 권상 검토를 수행하는 사내 구조 엔지니어.
- 핵심 작업: 처음 사용하는 엔지니어도 현재 위치, 다음 행동, 완료 조건, 판정 근거, 미검토 범위를 잃지 않고 한 번의 연속된 흐름으로 권상 검토를 끝내는 것.

## 제약

- WorkBench React/Vite/Electron + FastAPI, Studio React/Zustand/Three.js 구조 유지.
- HiTESS `DESIGN.md`, `PRODUCT.md`, `.impeccable/design.json`의 관제실형 디자인 언어와 상태 중복 표기 원칙 준수.
- 공학 기준이나 계산계수는 UX 감사만으로 변경하지 않는다.
- 사무실 데스크톱과 좁은 Electron 창(대표적으로 1366×768)을 모두 고려한다.
- 이번 산출물은 진단·점수·개선 방향이며 구현은 별도 계획 이후 수행한다.

## 비교 기준

- 저장소 제품 원칙: 업로드 → 실행 → 진행 → 결과 → 다운로드가 즉시 읽혀야 함.
- Dieter Rams의 좋은 디자인 10원칙.
- 상용 구조해석 도구와의 기능 수 비교보다 작업 상태, 추적성, 판정의 정직성, 반복 작업 효율을 우선한다.
