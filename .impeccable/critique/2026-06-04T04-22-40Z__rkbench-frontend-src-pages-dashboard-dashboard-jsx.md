---
target: Dashboard.jsx 대시보드 화면
total_score: 26
p0_count: 0
p1_count: 3
timestamp: 2026-06-04T04-22-40Z
slug: rkbench-frontend-src-pages-dashboard-dashboard-jsx
---
# Critique — Dashboard.jsx (메인 대시보드)

대상: `HiTessWorkBench/frontend/src/pages/dashboard/Dashboard.jsx` (1161줄)
방식: Assessment A(독립 디자인 리뷰) + Assessment B(슬롭 디텍터) 종합. 브라우저 검사는 인증 백엔드 세션 필요로 생략(아래 명시).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | 서버 온라인 dot·큐 진행바·이력 로딩 양호. 통계/즐겨찾기 스켈레톤 없음 |
| 2 | Match System / Real World | 3 | 구조해석 도메인 용어 적절(건/서비스 중/대기) |
| 3 | User Control and Freedom | 3 | 모달 Esc·X, 네비 뒤로가기 존재. 대시보드 자체는 읽기 위주 |
| 4 | Consistency and Standards | 2 | ProjectRow가 공유 Badge 미사용(emerald-100 vs 50 드리프트), hover 언어 4종, div/button 혼재, 색상 난립 |
| 5 | Error Prevention | 3 | 개발중 앱 AdminGate 차단, Truss 상태 초기화 |
| 6 | Recognition Rather Than Recall | 3 | 카드 아이콘+텍스트, 상태 텍스트 병기 |
| 7 | Flexibility and Efficiency | 2 | 즐겨찾기는 파워유저용이나 배너 3개 뒤에 묻힘, 단축키 없음 |
| 8 | Aesthetic and Minimalist | 2 | 9색 계열 난립, 사이드 스트라이프, eyebrow 중복, 상단 홍보 배너 3개 |
| 9 | Error Recovery | 2 | 오프라인 dot·로딩 표시. 상세 에러 없음(console.error 무시) |
| 10 | Help and Documentation | 3 | 사이드바 UserGuide, 카드 desc로 용도 표시 |
| **Total** | | **26/40** | **Acceptable — 사용자 만족 전 상당한 개선 필요** |

## Anti-Patterns Verdict

**"AI가 만들었다" 신호가 명확히 존재한다.**

- **LLM 평가**: 색상 난립(emerald/indigo/violet/amber/cyan/blue/red/orange/slate 9계열), 사이드 스트라이프 좌측 컬러 바(NoticeStrip L323, DiscoverHiTessBanner L176), eyebrow 중복(DiscoverHiTessBanner badge `text-[9px] uppercase tracking-widest` ×2), 동일 크기 배너 그리드 2개. DESIGN.md "관제실" 미감이 아니라 템플릿 SaaS 첫인상.
- **디텍터 스캔(3건)**: `ai-color-palette` indigo 그라데이션 L151·L152(BANNER_THEMES.workbench) — AI 팔레트 tell 확정. `gray-on-color` L392(text-slate-500 on bg-blue-50, 전체보기 버튼 hover) — 경계선(blue-50 위 slate-500은 ~5:1로 실통과 가능, 약한 FP). 디텍터는 사이드 스트라이프·slate-400 대비·eyebrow는 못 잡음(A가 보완).
- **브라우저 오버레이**: 없음. 대상이 사번 로그인 + FastAPI 백엔드(queue/history API) 인증 세션을 요구해 정적 dev 렌더가 비대표적 → 브라우저 검사 생략(소스+디텍터 기반).

## Overall Impression

기반 구조(네이비/슬레이트 베이스, 공유 컴포넌트, NoticeStrip)는 단단하지만, **정보 우선순위가 역전**되어 있고 **색·장식이 과하다**. 가장 큰 기회: 상단 홍보 배너 3개를 내리고 서버 현황·즐겨찾기를 끌어올리면 매일 쓰는 도구로서의 체감이 가장 크게 개선된다.

## What's Working

1. **NoticeStrip** — 미읽음 ping·상대시간·키보드 접근(role/tabIndex/onKeyDown)·슬림 레이아웃까지 갖춘 페이지 최고 완성도 컴포넌트. h1 직후 위치도 적절.
2. **EngineeringStatCard의 isClickable 분기** — role/tabIndex/onKeyDown/hover를 클릭 가능 여부로 명시 분리. 배너들이 따라야 할 모범.
3. **RoadmapModal** — 모드별 그룹화·상태 dot·카테고리 카운트로 본문보다 정제됨.

## Priority Issues

### [P1] 정보 우선순위 역전 — 홍보 배너가 작업 콘텐츠를 밀어냄
- **무엇**: `DiscoverHiTessBanner`×2 + `AppRoadmapBanner` 3개 홍보 배너가 최상단(prime real estate)을 차지하고, 서버 현황·즐겨찾기·이력을 스크롤 아래로 밀어냄. 섹션 부제가 스스로 "처음이신가요?"라며 온보딩용임을 인정.
- **왜 중요**: 매일 접속하는 파워유저(Alex)가 매번 배너 3개를 스크롤로 건너뛰어야 자기 도구에 도달. 반복될수록 UI가 장애물로 인지됨.
- **수정**: 섹션 순서를 `NoticeStrip → 서비스 현황 → 즐겨찾기 → 프로젝트 이력 → 플랫폼 소개·로드맵`으로. 소개 섹션은 접기(`localStorage` 플래그로 신규 사용자에게만 펼침). h1(2xl)→섹션헤더(sm) 위계 점프도 중간 단계(headline)로 보완.
- **명령**: `/impeccable layout`

### [P1] 대비 실패 다수 — text-slate-400 남용 + 그라데이션 위 저투명도 텍스트
- **무엇**: `EngineeringStatCard` subtext(L60), `ProjectRow` date(L127), `NoticeStrip` 부제(text-[9px] slate-400) 등 흰 배경 위 `text-slate-400`(#94a3b8≈2.9:1) 6~7곳. 배너 위 `text-blue-200/70`·`text-emerald-100/55`·`text-indigo-100/55` 등 위치별 배경이 달라 검증 불가(=위반 간주).
- **왜 중요**: 밝은 사무실 조명에서 판독 어려움. DESIGN.md "slate-500 하한" 명시 위반, WCAG AA 불통과.
- **수정**: `text-slate-400` 본문 → `text-slate-500`. 배너 subtitle 투명도 제거 → `text-white/85` 또는 고정 `text-slate-200`. 9px 본문 폰트 상향.
- **명령**: `/impeccable audit` (대비 정밀 점검) → 수정은 `/impeccable polish`

### [P1] AI 슬롭 2종 — 사이드 스트라이프 + 색상 난립/eyebrow
- **무엇**: NoticeStrip L323·DiscoverHiTessBanner L176의 `w-1` 좌측 컬러 바(DESIGN.md Don't 명시). 9개 색 계열 난립(통계 카드 indigo/blue/amber 아이콘 배경이 정보 없는 장식). DiscoverHiTessBanner eyebrow 2개. 디텍터도 indigo 그라데이션을 AI tell로 확정.
- **왜 중요**: "AI가 만든" 최강 시각 신호. Restrained/Rare Spark/Two-Blue 원칙 위반으로 "관제실" 정체성이 무너짐.
- **수정**: 좌측 바 제거(아이콘 배경색/전체 테두리로 대체). 통계 카드 아이콘 배경 Trust Blue/slate-700로 단일화(서버 카드만 상태색). eyebrow 제거. indigo/violet/cyan → 네이비+슬레이트로 수렴, 그린은 희귀 스파크로만.
- **명령**: `/impeccable quieter`

### [P2] Badge 컴포넌트 분열 — ProjectRow 자체 구현
- **무엇**: `ProjectRow` 상태(L96 `bg-emerald-100 text-emerald-700`)·모듈 타입 뱃지가 공유 `Badge`(emerald-50/700/200, rounded-full) 미사용 → 이미 드리프트 발생. 모듈 뱃지는 `rounded`(4px)로 표준 `rounded-full`과 불일치.
- **왜 중요**: 같은 앱에 "success" 뱃지 2종 공존. 디자인 시스템 드리프트 시작점.
- **수정**: `<Badge variant="success" dot size="sm">해석 완료</Badge>` 등으로 교체. `divide-slate-50`(거의 안 보임) → `divide-slate-100`.
- **명령**: `/impeccable polish`

### [P2] 키보드 접근성 결함 — 클릭 가능 div
- **무엇**: `DiscoverHiTessBanner`(L166)·`AppRoadmapBanner`(L221)가 `<div onClick>` (role/tabIndex/onKeyDown 없음) → Tab 도달 불가. 이력 로딩 스피너에 role="status"/aria-label 없음.
- **왜 중요**: 키보드/스크린리더 사용자(Sam)에게 두 진입점이 사실상 부재.
- **수정**: `motion.button` 또는 `div role="button" tabIndex={0} onKeyDown`(NoticeStrip 패턴 재사용). 로딩에 `role="status"`.
- **명령**: `/impeccable audit` → `/impeccable harden`

## Persona Red Flags

**Alex (파워유저, 매일 접속)**: 매일 홍보 배너 3개를 스크롤로 건너뛰어야 즐겨찾기 도달. 서버 상태가 2번째 섹션이라 접속 직후 확인에 스크롤 필요. slate-400 서브텍스트 판독난. 단축키 없음.

**Sam (접근성, 키보드/스크린리더)**: DiscoverHiTessBanner·AppRoadmapBanner Tab 도달 불가 = 두 진입점 부재. 배너 위 저투명도 텍스트 대비 미달. 로딩 상태 비고지.

**사내 구조 엔지니어 (신뢰·정밀 기대)**: 9색 난립이 "다 강조 = 무강조"로 읽혀 관제실이 아닌 마케팅 랜딩 첫인상. 색이 정보가 아니라 장식으로 기능해 신뢰 정체성과 충돌.

## Minor Observations

- IntroModal/AppRoadmapBanner가 Trust Blue를 인라인 `linear-gradient` 하드코딩 → 토큰 변경 시 단절점.
- `FavoriteCard` Star가 `text-yellow-400`(팔레트 외) → `amber-400` 통일 또는 즐겨찾기 전용색 문서화.
- topProgramsAll 🥇🥈🥉 이모지(L880) — 내부 모달이라 의도된 듯하나 공개 표면 확산 주의.
- "전체 이력 보기 →"가 섹션 헤더 우측 텍스트 링크라 무게 약함 → 테이블 `<tfoot>` 행 고려.
- 서버 큐 3초 폴링: 다중 탭 시 3N배 부하 → 부하 높을 때 역설. 주기 상향/WebSocket 검토.

## Questions to Consider

1. 플랫폼 소개 배너를 일주일에 한 번이라도 다시 여는 사용자가 있는가? 클릭률로 배치 재검토 가능.
2. 즐겨찾기가 빈 신규 사용자는 지금 구조에서 다음 행동을 명확히 아는가?
3. 통계 4카드의 색 다양성이 정보를 전달하는가, 장식인가?
