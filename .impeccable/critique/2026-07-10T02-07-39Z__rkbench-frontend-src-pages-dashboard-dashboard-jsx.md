---
target: Dashboard 밀도/박스크기/레이아웃 비율
total_score: 31
p0_count: 0
p1_count: 2
timestamp: 2026-07-10T02-07-39Z
slug: rkbench-frontend-src-pages-dashboard-dashboard-jsx
---
# Dashboard.jsx — 밀도/박스 크기/레이아웃 비율 Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | 온라인/오프라인·큐·핑·버전·진행바 등 상태 계측 우수 |
| 2 | Match System / Real World | 4 | 도메인 한국어, 자연스러운 순서 |
| 3 | User Control and Freedom | 3 | 즐겨찾기 편집·뒤/앞 내비 존재 |
| 4 | Consistency and Standards | 3 | compact 카드가 실제로는 compact하지 않음(그리드 stretch) |
| 5 | Error Prevention | 3 | 개발앱 gate 모달, 재시도 버튼 |
| 6 | Recognition Rather Than Recall | 3 | 라벨/아이콘 병기 양호 |
| 7 | Flexibility and Efficiency | 3 | 즐겨찾기·바로가기·Ctrl-K |
| 8 | Aesthetic and Minimalist Design | 2 | 6개 밴드 경쟁, 통계카드 ~50% 공백, 주 콘텐츠(이력) 밀려남 |
| 9 | Error Recovery | 3 | 이력/통계 에러 재시도 |
| 10 | Help and Documentation | 3 | 가이드·툴팁 |
| **Total** | | **31/40** | **Good** |

## Anti-Patterns Verdict
AI slop 아님. 브랜드 시스템(Trust Blue, 절제된 팔레트)이 일관되게 적용됨. 결정론 스캔은 gray-on-color 경고 5건(대부분 hover 상태 tint, 오탐 성격) — 저영향. 진짜 문제는 detector가 못 잡는 **구조적 수직 예산 문제**.

## Priority Issues

### [P1] 프로젝트 이력 테이블이 뷰포트에서 잘림 (실측)
- 1536×864: 이력 섹션에 높이 43px만 배정 → 제목만 보이고 **테이블 0행**.
- 1920×1080: 5행 표시되나 마지막 행 37px 잘림.
- 루트가 `h-full overflow-hidden`(단일 뷰포트 무스크롤) → 상단 밴드들이 예산을 다 써서 flex-1 이력이 굶음.
- PRODUCT.md 원칙 #2("작업 흐름이 주인공, 이력 보존")와 정면 충돌. 매일 최근 실행을 확인하는 핵심 콘텐츠가 잘림.
- Fix: 루트 무스크롤 포기(페이지 스크롤 허용) 또는 이력만 내부 스크롤+최소높이 보장, 그리고 상단 예산 축소. → /impeccable layout

### [P1] 통계 카드(월간·누적)의 ~50% 빈 공간
- 서비스 현황 grid-cols-6: 4카드 모두 193px로 stretch. QueueStatus·인기프로그램은 내용이 차지만, `compact`(min-h-96) 월간/누적은 내용 ~80px가 193px로 늘어나 **아래 ~100px 공백**.
- `compact` 플래그가 그리드 equal-height stretch로 무력화됨.
- Fix: 두 통계를 한 카드로 병합, 또는 이웃 카드를 낮추거나, 행을 items-start로 분리. → /impeccable layout·distill

### [P2] Overview 배너가 저가치 정보로 106px 소비
- 제목 + 오늘 날짜 + 서버 IP 타일. 날짜·IP는 참조 정보(매일 액션 아님)인데 106px 점유 = 이력이 필요한 예산.
- Fix: 배너 ~64px로 슬림, 날짜/IP 강등·제거. → /impeccable distill

### [P2] 6개 밴드 수직 적층 → 밀도/시각 경쟁
- 배너·공지·로드맵·서비스현황·즐겨찾기·이력이 각자 색 액센트를 가져 지배 요소 불명확.
- Fix: 로드맵을 경량 스트립으로, 서비스 통계를 인라인 축소. → /impeccable layout

### [P3] gray-on-color 5건 (detector)
- line 194/203/792/1557/1624 — 대부분 hover tint. 저영향.

## Persona Red Flags
- **Alex(파워유저)**: 매일 "내 최근 실행 확인"이 핵심인데 1536×864에서 이력 0행 → 반드시 "전체 이력 보기" 클릭해야 함. 대시보드의 존재 이유가 약화.
- **Sam(접근성)**: hover 저대비 tint; 높이 기반 media-query 행 숨김은 콘텐츠가 소리 없이 사라짐.

## Questions
- 대시보드는 단일 무스크롤이어야 하는가, 아니면 스크롤을 허용하고 이력을 제대로 보여줄 것인가?
- 월간/누적 통계는 별도 카드가 필요한가, 아니면 한 줄로 압축 가능한가?
- Overview 배너의 날짜/서버IP는 매일 필요한 정보인가?
