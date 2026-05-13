---
name: 프로젝트 디자인 시스템 기초
description: HiTESS WorkBench 프론트엔드의 Tailwind 브랜드 컬러, 공통 모달 구조, 스타일링 컨벤션, 공통 컴포넌트 패턴
type: project
---

## 브랜드 컬러 (tailwind.config.js)
- `brand-blue`: #002554 (HD 현대 Trust Blue — 매우 진한 남색, 제목·CTA에 사용)
- `brand-green`: #008233 (Heritage Green)
- `brand-accent`: #00E600 (형광 연두 포인트)
- `brand-gray`: #F5F7FA (배경 연회색)

## 공통 모달 패턴
- `@headlessui/react`의 `Dialog` + `Transition` 사용
- `Dialog.Panel`: `rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh~90vh]`
- 배경 오버레이: `bg-black/60 backdrop-blur-sm`
- 헤더/본문/푸터 3단 flex 구조, 푸터는 `shrink-0`, 본문은 `flex-1 overflow-y-auto`
- 커스텀 스크롤바: `custom-scrollbar` 클래스 사용

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

## 공통 UI 컴포넌트 (src/components/ui/)
- `PageHeader`: title, icon, subtitle, actions props — 다른 페이지들에서 표준으로 사용
- `AppCard`: devStatus 배지, 즐겨찾기 토글, onStart 콜백
- `FilterTabs`: categories 배열, active 상태 관리
- `AnimatedGrid`: stagger 그리드 래퍼
- Dashboard 전용: `EngineeringStatCard`, `FavoriteCard`, `ProjectRow`, `NoticeStrip` (Dashboard.jsx 내 인라인 정의)

## 레이아웃
- 페이지 wrapper: `max-w-7xl mx-auto` + `pb-10` or `pb-16`
- 섹션 간격: `space-y-6` or 섹션별 `mb-8`

## 기타 컨벤션
- 인라인 style은 동적 색상(glow rgba, 그라데이션 등)에만 한정
- framer-motion: 진입 fade/slide + hover lift + tap scale에 일관 사용
- whitespace-pre-wrap으로 plain text 줄바꿈 보존 (마크다운/HTML 변환 없음)
- 서버 상태 폴링: 3초 간격 (queueStatus), 1.5초 (작업 진행률)
