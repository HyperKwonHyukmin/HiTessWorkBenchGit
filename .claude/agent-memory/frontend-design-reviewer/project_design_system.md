---
name: 프로젝트 디자인 시스템 기초
description: HiTESS WorkBench 프론트엔드의 Tailwind 브랜드 컬러, 공통 모달 구조, 스타일링 컨벤션, 공통 컴포넌트 패턴
type: project
---

## 브랜드 컬러 (실제 소스는 Tailwind v4 — `src/index.css` 의 `@theme` 블록. tailwind.config.js 는 잔존물이라 여기 없는 토큰도 있음)
- `brand-blue`: #002554 (HD 현대 Trust Blue — 매우 진한 남색, 제목·CTA에 사용)
- `brand-blue-dark`: #003366 / `brand-blue-light`: #004080 (index.css 에만 정의됨)
- `brand-green`: #008233 (Heritage Green)
- `brand-accent`: #00E600 (형광 연두 포인트)
- `brand-gray`: #F5F7FA (배경 연회색)

## 공통 모달 패턴 (components/ui/Modal.jsx)
- `@headlessui/react`의 `Dialog` + `Transition` 사용
- `Dialog.Panel`: `flex flex-col rounded-2xl shadow-2xl overflow-hidden` + `max-h-[calc(100vh-2rem)]`
- 배경 오버레이: `bg-black/60 backdrop-blur-sm`
- 헤더/본문/푸터 3단 flex 구조, 푸터는 `shrink-0`, 본문은 `min-h-0 flex-1 overflow-y-auto`
- ⚠️ **본문 영역에 padding 이 전혀 없다.** 각 모달이 자기 wrapper(`<div className="p-5 lg:p-6">`)를 반드시 넣어야 한다 — 빠뜨리면 콘텐츠가 모서리에 붙어 잘려 보인다(실제 사용자 버그 보고 사례).
- size 맵: `sm/md/lg` → max-w-sm/md/lg, `xl` → **max-w-2xl(672px)**, `full` → max-w-5xl, `screen` → **max-w-[1600px]**(밀도 높은 작업용 폼 전용)

## 타이포그래피
- 페이지 제목: `text-2xl font-bold text-brand-blue tracking-tight`
- 섹션 헤더: `text-sm font-bold text-slate-700` + lucide 아이콘 size=15
- 카드 제목: `font-bold text-sm text-slate-700~800`
- 본문 텍스트: `text-sm text-slate-700 leading-relaxed`
- 메타/보조: `text-xs text-slate-400~500`
- 힌트/라벨: `text-[10px] font-bold` (10px 미만 사용 빈번)

## 아이콘
- `lucide-react` 단일 세트 사용
- 섹션 헤더 아이콘: size=15
- 카드/버튼 내 인라인 아이콘: size=16~18
- 강조 아이콘(배경색 패드): size=22~28
- 배경 장식 아이콘: size=100~120, opacity 5~10%

## 카드 패턴
- 기본 카드: `bg-white rounded-xl border border-slate-200 shadow-sm`
- hover 강조: `hover:shadow-lg hover:border-blue-300 transition-all`
- Framer Motion: `whileHover={{ y: -3 }}` 리프트 효과 표준
- 상태별 accent: emerald(Active), blue(Developing), amber(Planned), red(Failed)

## AppCard / AppListRow 패턴 (2026-07-30 기준, 네이비 헤더형 재설계 이후 — `ed79a4b`/`c11f518`/`c2a5ac9`)
⚠ 아래는 이전 "tint 배경" 세대를 대체한 현재 구조. AppCard.jsx 를 다시 열어보면 바로 확인 가능.
- **헤더 존**: 카드 상단에 `bg-gradient-to-br ${ACCENT_HEADER[accentColor]}` 존을 두고(`from-brand-blue via-brand-blue-dark to-brand-blue-light` 등 accent별 맵), 그 위에 아이콘(반투명 유리박스 `bg-white/[0.13] border-white/20 backdrop-blur-sm`)과 흰색 제목을 얹는다. PageHeader 배너와 같은 시각 언어.
- **색은 hover 상태로 이관됐다**: 카드 배경 자체는 흰색(`bg-white`)이고, tint 배경(`bg-cyan-50/30` 등)은 더 이상 기본 상태에 없다 — `ACCENT_BORDER`(hover 시 테두리)와 `AppListRow`의 `ACCENT_HOVER`(hover 시 `border+bg-*-50/30`)에만 남아 있음. 즉 그리드 카드는 hover 색이 아예 없고(리프트+그림자만), 리스트 행만 hover 시 은은한 tint 가 붙는다.
- **태그(tags) 렌더링이 카드에서 사라졌다.** 지금은 `description`(2줄 clamp) + `FormatFlow`(input→output 포맷 흐름)만 본문에 있고, 별도 태그 칩은 없음. `item.tags` 는 여전히 데이터엔 있지만 검색 매칭(`matchesSearch`)에만 쓰이고 카드엔 노출 안 됨.
- **a11y 재작업**: 카드 루트는 `<motion.article>`(인터랙티브 role 없음), 제목만 실제 `<button>`. 예전엔 role="button" div 안에 버튼이 중첩돼 ARIA 위반이었음(`c2a5ac9`에서 해소). 즐겨찾기·설정(톱니바퀴, 관리자 전용)은 헤더 우상단에 별도 버튼으로 절대 위치.
- `colorToAccent()`(AppCataloguePage.jsx): `item.color`(`bg-cyan-600` 등 Tailwind 클래스 문자열)에서 accent 키를 뽑아내는 함수, cyan > violet > emerald > indigo > teal > amber > purple > blue 우선순위로 판별.
- `AppListRow`는 여전히 solid 아이콘 박스(`iconBg` + 광택 오버레이) 유지 — 그리드 카드(네이비 헤더)와 리스트 행(solid 아이콘 박스)이 서로 다른 아이콘 처리 방식을 쓴다는 점 주의(의도된 차이, 밀도가 다른 뷰라서).

## 공통 UI 컴포넌트 (src/components/ui/)
- `PageHeader`: title, icon, subtitle, actions props — 다른 페이지들에서 표준으로 사용
- `AppCard`: devStatus 배지, 즐겨찾기 토글, onStart 콜백
- `FilterTabs`: categories 배열, active 상태 관리
- `AnimatedGrid`: stagger 그리드 래퍼
- Dashboard 전용: `EngineeringStatCard`, `FavoriteCard`, `ProjectRow`, `NoticeStrip` (Dashboard.jsx 내 인라인 정의)

## 레이아웃
- 페이지 wrapper: `max-w-7xl mx-auto` + `pb-10` or `pb-16`
- 섹션 간격: `space-y-6` or 섹션별 `mb-8`
- **Interactive App (파라메트릭 입력 + 3D 뷰어) 레이아웃 패턴 (IndependentTankAssessment 확정)**:
  - 상단 2컬럼 `grid-cols-[440px_1fr]`: 좌측(Geometry/Stiffener 입력), 우측(3D 뷰어 h-[420px])
  - 하단 풀폭 `grid-cols-[200px_280px_1fr]`: AirVent / Acceleration / BC Node 3카드
  - 3D 뷰어 높이는 `calc(100vh-160px)` 대신 **고정값 420px** 사용 — BC 행이 한 화면에 표시되는 게 우선
  - SectionCard 헤더: `from-violet-600 to-violet-500` (기존 `from-violet-700 to-violet-600` 보다 소프트)
  - 입력 패널 섹션 구분: Geometry / Stiffener / Boundary & Load 3개 divier `tracking-widest`

## 기타 컨벤션
- 인라인 style은 동적 색상(glow rgba, 그라데이션 등)에만 한정
- framer-motion: 진입 fade/slide + hover lift + tap scale에 일관 사용
- whitespace-pre-wrap으로 plain text 줄바꿈 보존 (마크다운/HTML 변환 없음)
- 서버 상태 폴링: 3초 간격 (queueStatus), 1.5초 (작업 진행률)
