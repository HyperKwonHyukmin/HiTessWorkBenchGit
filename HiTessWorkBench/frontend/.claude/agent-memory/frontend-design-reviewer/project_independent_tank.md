---
name: project-independent-tank
description: IndependentTankAssessment 페이지 디자인 리뷰 및 개선 — 확정 레이아웃 골조와 three.js 뷰어 동결 조건 하에 입력 폼/카드/오버레이 전면 개선
metadata:
  type: project
---

IndependentTankAssessment 페이지 전체 UI/UX 리뷰 완료 (2026-05-20).

**확정 골조 (절대 변경 금지)**
- 상단 outer grid: `grid-cols-[440px_1fr] items-start`
- 우측 뷰어: `self-stretch min-h-[480px]` — 좌측 컬럼 높이 추종
- 하단 풀폭 행: `grid-cols-[1fr_1fr_2fr] items-stretch` — 3카드 하단 정렬
- `IndependentTankViewer` 컴포넌트 + `buildSectionShape` + `positionsAlong` 전체 동결

**개선 사항**
- NumInput: `py-1.5` → `py-2`, `rounded-md` → `rounded-lg`, focus ring 추가, unit 박스 `items-stretch`로 높이 통일
- Select: `py-1.5` → `py-2`, `rounded-md` → `rounded-lg`, `border` → `border`+focus ring
- SectionCard 헤더: violet-600→violet-500 → violet-700→violet-600, 아이콘 11px → 13px
- FieldLabel: `text-[10.5px]` → `text-[11px]`, `mb-0.5` → `mb-1`
- axisRow: 라벨 칩을 violet-600 배경 white 텍스트로 강화, 상단 모드선택/하단 값입력 2단 구조로 명확화
- 보강재 치수 WEB/FLG 칩: `h-[26px]` 하드코딩 제거 → `pt-6 flex justify-center`로 라벨 베이스라인 정렬
- BC 카드: 선택 수 배지 → violet/slate pill badge, 빈 상태 2줄로 가독성 향상, 헤더 border-b 구분선 추가
- 뷰어 오버레이: 투명도/gap/shadow 통일, 우하단 조작 안내 2줄 분리, Plate edge 선 두께 표현 개선
- 섹션 디바이더: `pt-1` → `pt-2`, border opacity 60% → 80%

**Why:** 기존 py-1.5 + 10.5px 폰트 조합은 클릭 영역이 좁고 라벨 가독성이 떨어졌음. axisRow 칩 높이 불일치로 세로 정렬이 어긋났었음.
**How to apply:** 이후 동일 페이지 추가 작업 시 위 골조·동결 조건 재확인 필수.
