---
name: HiTESS WorkBench
description: 사내 구조 해석 플랫폼 — 신뢰·정밀·전문 엔지니어링을 위한 제품 UI
colors:
  trust-blue: "#002554"
  trust-blue-dark: "#003366"
  trust-blue-light: "#004080"
  heritage-green: "#008233"
  heritage-green-light: "#00E600"
  action-blue: "#2563eb"
  surface: "#F8F9FC"
  brand-gray: "#F5F7FA"
  ink-strong: "#1e293b"
  ink-body: "#334155"
  ink-muted: "#64748b"
  line: "#e2e8f0"
  white: "#ffffff"
  success: "#10b981"
  warning: "#f59e0b"
  danger: "#dc2626"
typography:
  display:
    fontFamily: "Inter, SUIT, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, SUIT, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "Inter, SUIT, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Inter, SUIT, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, SUIT, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
  eyebrow:
    fontFamily: "Inter, SUIT, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 700
    letterSpacing: "0.1em"
  mono:
    fontFamily: "Fira Code, Consolas, monospace"
    fontSize: "0.85em"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.trust-blue}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.trust-blue-dark}"
    textColor: "{colors.white}"
  button-green:
    backgroundColor: "{colors.heritage-green}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "10px 20px"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.lg}"
    padding: "10px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.lg}"
    padding: "10px 20px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
  input-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.xl}"
    padding: "20px"
  badge:
    rounded: "{rounded.full}"
    padding: "4px 10px"
  nav-item-active:
    backgroundColor: "{colors.heritage-green-light}"
    textColor: "{colors.trust-blue}"
---

# Design System: HiTESS WorkBench

## 1. Overview

**Creative North Star: "The Engineering Control Room"**

HiTESS WorkBench는 정밀한 관제실처럼 작동한다. 진한 네이비(Trust Blue, `#002554`)의 차분한 프레임 위에서 작업 상태, 진행률, 합격·불합격 판정이 명확히 읽히고, 형광 그린 한 점이 지금 주목해야 할 곳을 정확히 가리킨다. 화면은 떠들지 않는다. 엔지니어가 계측기를 신뢰하듯, 도구가 보여주는 숫자와 상태를 신뢰할 수 있어야 한다.

미감은 **정밀하고 차분하다(refined & restrained)**. 절제된 여백, 정확한 정렬, 과하지 않은 마감. 색은 정보가 있을 때만 등장하고, 깊이는 은은한 그림자로만 암시한다. 이 시스템은 레거시 사내 시스템의 칙칙한 회색 폼과 빽빽한 무지향 표를 명시적으로 거부한다 — 그 탈피가 곧 이 플랫폼의 존재 이유다. 동시에 화려한 SaaS 마케팅 톤(의미 없는 그라데이션, 이모지 남발, hero-metric 템플릿)도 거부한다. 신뢰는 화려함이 아니라 일관성에서 온다.

밀도는 중간이다. 정보를 숨기지 않되 숨 막히게 하지 않는다. 데스크탑(Electron) 환경, 밝은 사무실 조명 아래, 매일 같은 작업을 반복하는 전문가를 위해 예측 가능하고 단단하게 설계한다.

**Key Characteristics:**
- 진한 네이비 프레임(사이드바·배너) + 밝은 중성 작업 영역(`#F8F9FC`)
- 형광 그린 액센트는 극도로 희귀하게, 주목 유도 전용
- 평평한 면 + 소프트한 그림자(`shadow-sm`), 연한 테두리로 구획
- 상태·판정은 색 + 텍스트 + dot 으로 중복 표기 (색에만 의존 금지)
- Inter(라틴) + SUIT(한글) 가변 폰트, 무게 대비로 위계 형성

## 2. Colors

진한 네이비를 정체성으로, 중성 슬레이트를 작업 표면으로, 형광 그린을 희소한 신호로 쓰는 절제된(Restrained) 팔레트다.

### Primary
- **Trust Blue** (`#002554`): HD현대 공식 메인 컬러. 사이드바 배경, 페이지 배너 그라디언트의 시작, 페이지 제목(h1) 텍스트, 공유 Button의 primary 배경. 시스템의 권위와 신뢰를 지는 색.
- **Trust Blue Dark** (`#003366`) / **Trust Blue Light** (`#004080`): primary 호버 상태, 배너 그라디언트의 깊이, 사이드바 구분선·푸터에 쓰는 네이비 음영.

### Secondary
- **Heritage Green** (`#008233`): 긍정적 행동을 지는 진한 초록(공유 Button의 `green` variant). "전달/실행/승인" 류의 확정 액션에 제한적으로.
- **Action Blue** (`#2563eb`): 기능 페이지(해석 화면 등)에서 주요 CTA·링크·진행 바에 널리 쓰이는 밝은 인터랙티브 블루. Trust Blue가 정체성이라면 이 색은 상호작용의 신호다.

### Tertiary
- **Heritage Green Light** (`#00E600`): 형광 연두. 사이드바 로고 "H", 활성 네비게이션 알약 배경 등 극소수 지점에만. 시스템에서 가장 강한 시각 신호이자 가장 드물게 쓰는 색.

### Neutral
- **Surface** (`#F8F9FC`) / **Brand Gray** (`#F5F7FA`): 앱 작업 영역 배경. 순백이 아닌 아주 옅은 쿨 그레이.
- **White** (`#ffffff`): 카드·패널·입력 필드 표면.
- **Ink Strong** (`#1e293b`, slate-800): 강조 본문·소제목.
- **Ink Body** (`#334155`, slate-700): 기본 본문.
- **Ink Muted** (`#64748b`, slate-500): 보조 설명·메타 정보. 이보다 연한 회색을 본문에 쓰지 않는다.
- **Line** (`#e2e8f0`, slate-200): 카드·표·구분선 테두리.

### Status
- **Success** (`#10b981` emerald), **Warning** (`#f59e0b` amber), **Danger** (`#dc2626` red), **Info** (`#2563eb` blue). 모두 `-50` 배경 + `-700` 텍스트 + `-200` 테두리의 옅은 톤으로 Badge에 사용.

### Named Rules
**The Rare Spark Rule.** Heritage Green Light(`#00E600`)는 어느 화면에서도 **5% 이하**로만 등장한다. 로고·활성 네비게이션·핵심 주목 유도가 전부다. 희귀함이 곧 그 색의 힘이다. 두 번째 그린 점을 찍고 싶을 때는 멈춘다.

**The Two-Blue Rule.** 네이비(Trust Blue)는 **정체성**(프레임·제목), 밝은 블루(Action Blue)는 **상호작용**(버튼·링크). 둘을 서로의 역할에 섞어 쓰지 않는다.

## 3. Typography

**Display/Body Font:** Inter (라틴·숫자) + SUIT (한글) — 둘 다 100–900 가변, self-host(woff2), `unicode-range`로 자동 분기.
**Label/Mono Font:** Fira Code, Consolas (파일 경로·코드·BDF 식별자 등 기술 텍스트).

**Character:** 하나의 휴머니스트 지오메트릭 산세리프 가족을 무게 대비로 운용한다. 별도 디스플레이 서체 없이 800 무게와 크기 대비만으로 위계를 만든다 — 도구다운 절제. 한글과 라틴이 같은 광학 무게로 섞이도록 Inter+SUIT를 짝지었다.

### Hierarchy
- **Display** (800, `1.5rem`, line-height 1.2, letter-spacing -0.02em): 페이지 제목(h1). 주로 Trust Blue 또는 배너 위 흰색.
- **Headline** (700, `1.2rem`): 카드/패널 제목, 섹션 헤더.
- **Title** (700, `1.05rem`): 하위 그룹 제목.
- **Body** (400, `0.875rem`, line-height 1.6): 기본 본문. 긴 산문은 65–75ch 이내.
- **Label** (600, `0.75rem`, slate-600): 입력 라벨, 보조 캡션.
- **Eyebrow** (700, `0.625rem`, letter-spacing 0.1em, UPPERCASE): 패널 내부의 짧은 카테고리 마커(`다음 해석으로 전달` 등). **모든 섹션 위에 반복하지 않는다.**
- **Mono** (Fira Code, `0.85em`): 파일명·경로·코드·식별자.

### Named Rules
**The Weight-Not-Family Rule.** 위계는 새 서체가 아니라 무게(400/600/700/800)와 크기로 만든다. 본문에 세 번째 폰트를 도입하지 않는다.

**The No-Shout Rule.** 디스플레이 크기 상한은 `1.5rem` 대(페이지 제목). 이건 마케팅 히어로가 아니라 작업 도구다. `clamp()`로 화면을 키워 외치지 않는다.

## 4. Elevation

기본은 **평평(flat-by-default)**, 깊이는 소프트한 그림자로만 암시한다. 면은 연한 테두리(`#e2e8f0`)로 구획하고, 카드·모달에 `shadow-sm` 수준의 은은한 그림자를 더해 작업 영역에서 살짝 떠 보이게 한다. 그림자는 장식이 아니라 계층(이 표면이 배경보다 가깝다)의 신호다.

### Shadow Vocabulary
- **Resting card** (`box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05)`): 카드·패널 기본. 거의 평평하되 종이 한 장 들린 느낌.
- **Sidebar frame** (`box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1)` 계열, `shadow-xl`): 네이비 사이드바가 작업 영역 위에 단단히 서 있는 구조적 그림자.
- **Modal/Dialog**: 한 단계 더 깊은 그림자 + 반투명 백드롭으로 컨텍스트 차단.

### Named Rules
**The Flat-By-Default Rule.** 표면은 쉴 때 평평하다. 깊은 그림자·블러는 모달과 떠 있는 메뉴에만. 카드를 띄우려 그림자를 키우지 말고, 테두리와 배경 대비로 먼저 구획한다.

## 5. Components

### Buttons
공유 `Button` 컴포넌트가 표준. 느낌은 **정밀하고 차분하되 누르면 확신을 주는**(`active:scale-[0.98]`) 마감.
- **Shape:** `rounded-xl`(12px), `font-semibold`, `transition-all 200ms`, focus 시 `ring-2 ring-trust-blue/40`.
- **Primary:** Trust Blue 배경 + 흰 텍스트, 호버 시 Trust Blue Dark. (기능 페이지에서는 Action Blue `#2563eb` 배경도 광범위하게 쓰임 — 동일 역할.)
- **Green:** Heritage Green 배경. 확정·전달 액션.
- **Secondary:** 흰 배경 + slate-300 테두리 + slate-700 텍스트, 호버 시 slate-50.
- **Ghost:** 투명 + slate-600, 호버 시 slate-100.
- **Danger:** red-600 배경.
- **Sizes:** sm(`py-1.5 px-3 text-xs`) / md(`py-2.5 px-5 text-sm`) / lg(`py-3 px-6 text-base`).
- 비활성: `opacity-50 cursor-not-allowed` (개발 중 기능은 slate-200 배경 + Lock 아이콘으로 명시).

### Badges
- **Shape:** `rounded-full`, `font-bold`, 좌측 옵션 dot.
- **Variants:** success(emerald) / warning(amber) / danger(red) / info(blue) / neutral(slate) / purple. 모두 `-50` 배경 + `-700` 텍스트 + `-200` 테두리.
- **Sizes:** sm(`text-[10px] px-2 py-0.5`) / md(`text-xs px-2.5 py-1`).
- 판정 표시에 색만 쓰지 않고 텍스트(+dot)를 함께 둔다.

### Inputs / Fields
- **Shape:** `rounded-lg`(8px), 흰 배경, slate-200 테두리.
- **Focus:** `ring-2 ring-trust-blue/20` + 테두리 Trust Blue.
- **Error:** red-400 테두리 + `ring-red-400/20`, 하단 red-500 메시지.
- **Label:** `text-xs font-semibold` slate-600. Placeholder는 slate-400(가독 대비 유지).

### Cards / Containers
- **Corner:** 주 카드 `rounded-2xl`(16px), 내부 콜아웃·보조 박스 `rounded-xl`(12px).
- **Background:** 흰색. 강조 콜아웃은 `blue-50` 등 옅은 틴트.
- **Border:** `border-slate-200`.
- **Shadow:** `shadow-sm` (Elevation 참조).
- **Padding:** 카드 ~`20px`(p-5), 콜아웃 ~`12–16px`.
- 카드 안에 카드를 중첩하지 않는다.

### Navigation (Sidebar)
- **Frame:** `bg-trust-blue text-white`, `shadow-xl`, 접이식(`transition-all 300ms`). 카테고리(WORKBENCH / ANALYSIS / SUPPORT & COMMUNITY / ADMINISTRATION)로 그룹화, lucide 아이콘.
- **Active item:** Heritage Green Light(`#00E600`) 알약 배경 + Trust Blue 텍스트 + 좌측 형광 그린 인디케이터 바. (활성 상태 인디케이터로서의 좌측 바이며, 카드·알림의 장식용 사이드 스트라이프와는 구분한다.)
- **Inactive:** slate-300 텍스트, 호버 시 Trust Blue Dark 배경 + 흰 텍스트.
- **Admin 메뉴:** 세션 게이트(비밀번호 모달) 통과 후 접근.

### PageBanner (Signature Component)
10여 개 페이지가 공유하는 시그니처 헤더. 전체 폭 그라디언트 띠(`-mx-6 -mt-6`로 풀블리드), `bg-gradient-to-r from-trust-blue via-teal-900 to-teal-700`. 우측 상단에 흰 원 2개를 `opacity-0.04`로 깔아 깊이를 주고, 내부는 `flex justify-between`(좌: 뒤로가기+제목 / 우: 이력·가이드 버튼). 페이지 정체성을 한 줄로 선언하는 네이비 관제 패널.

## 6. Do's and Don'ts

### Do:
- **Do** 페이지 헤더에 PageBanner(Trust Blue 그라디언트)를 써서 일관된 관제실 프레임을 유지한다.
- **Do** 상태·판정을 색 + 텍스트 + dot 으로 중복 표기한다(합격/불합격, 진행률, 오류). 색맹·고대비 사용자 대응.
- **Do** 본문 대비를 ≥4.5:1(큰 텍스트 ≥3:1)로 유지하고, 보조 텍스트는 slate-500보다 연하게 내리지 않는다.
- **Do** 표면을 기본 평평하게 두고 `shadow-sm` + slate-200 테두리로 구획한다.
- **Do** 버튼은 `rounded-xl`, 카드는 `rounded-2xl`, 입력은 `rounded-lg`로 반경 위계를 지킨다.
- **Do** 위계를 무게(700/800)와 크기로 만든다. 서체는 Inter+SUIT 한 가족으로.
- **Do** 모든 애니메이션에 `prefers-reduced-motion: reduce` 대안을 둔다.

### Don't:
- **Don't** 낡은 레거시 엔터프라이즈처럼 보이게 한다 — 칙칙한 회색 폼, 빽빽한 무지향 표, 정렬이 무너진 밀집 레이아웃. (PRODUCT.md 최우선 anti-reference)
- **Don't** 과한 마케팅 SaaS 톤을 쓴다 — 의미 없는 그라데이션 텍스트, 이모지 남발, hero-metric 템플릿, 버즈워드.
- **Don't** Heritage Green Light(`#00E600`)를 한 화면에 5% 넘게 쓴다(The Rare Spark Rule).
- **Don't** 네이비(정체성)와 밝은 블루(상호작용)의 역할을 섞는다(The Two-Blue Rule).
- **Don't** `background-clip: text` 그라데이션 텍스트를 쓴다. 강조는 무게·크기·단색으로.
- **Don't** 카드·콜아웃·알림에 1px 초과 colored `border-left` 장식 스트라이프를 쓴다(네비게이션 활성 인디케이터는 예외).
- **Don't** 모든 섹션 위에 작은 대문자 eyebrow를 반복한다. eyebrow는 패널 내부 한정.
- **Don't** 동일 크기 카드 그리드를 끝없이 반복한다. 밀도·위계로 리듬을 준다.
- **Don't** 본문 텍스트가 컨테이너를 넘치게 둔다 — 모든 breakpoint에서 제목 길이를 검증한다.
