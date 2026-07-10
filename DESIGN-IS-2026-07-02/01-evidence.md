# 01 — 증거 (Evidence)

수집 방식: 소스 정독(Dashboard.jsx 1,884줄 전문 + Layout/Sidebar 셸 + DashboardContext + tailwind/index.css) + **라이브 dev 서버(localhost:5173) 실측**(로그인된 상태로 접근 성공, 사용자 권혁민). Playwright 스냅샷·전체 스크린샷·계산 스타일·캔버스 픽셀 기반 WCAG 대비 측정.

## A. 구조 (Structural)

- **화면 구성(위→아래)** — 전부 `Dashboard.jsx`:
  1. 히어로 "WorkBench Overview" (1325–1368): eyebrow 배지 "ENGINEERING CONTROL ROOM"(1330–1333) + 제목/부제 + 4개 정보 타일(사용자/오늘/접속IP/연결서버, 1341–1364). 타일은 비클릭(title 속성만).
  2. 공지 스트립 + 자료 액션 바 (1519–1551): NoticeStrip(role=button) + DashboardFab(2버튼) + 소개 토글.
  3. 플랫폼 소개 배너(접이식, 기본 접힘) + 앱 로드맵 배너 (1565–1591).
  4. 서비스 현황 (1593–1682): QueueStatusCard(비클릭) + 월간/누적 카드(비클릭) + 인기 해석 프로그램 카드(순위보기 버튼 + top3 행 버튼).
  5. 즐겨찾기 (1684–1793): 비었을 때 안내 + 3개 이동 버튼 / 있을 때 카드 그리드 + 순서편집.
  6. 프로젝트 이력 (1795–1872): 표(행 비클릭) + "전체 이력 보기" 버튼.
- **데이터 실/가짜**: 큐(getQueueStatus), 월간/누적(analysis API), 인기프로그램(getTopPrograms), 공지(getNotices), 이력(getAnalysisHistory), 세션 IP/서버(getSessionContext) — **전부 라이브 API**. ANALYSIS_DATA(앱 카탈로그 메타)·PROMOTION_VIDEOS(2건)만 하드코딩(앱 레지스트리 성격이라 적절).
- **앱 개수**(라이브 로드맵 배너 실측): 총 24개 = 서비스 17 / 개발 7 / 예정 0. File-Based 8·Interactive 6·Parametric 7·Productivity 3. 히어로/로드맵/모드별 합계 상호 일치(정합성 OK).
- **도구 실행 진입 경로(중복도 높음)**: ① 사이드바 모드 페이지 ② 즐겨찾기 카드 ③ 로드맵 모달 ④ 인기프로그램 카드/모달(handleProgramShortcut) ⑤ 헤더 검색 ⑥ Command Palette(Ctrl+K, Layout 166–175) ⑦ 헤더 "최근 사용 앱" 칩. 최소 6~7개 독립 진입점.
- **초기 화면 인터랙티브 요소** ≈ 15~18개(모달 제외). 히어로 타일 4개는 비인터랙티브.
- **셸(Layout.jsx)**: 사이드바(complementary/nav landmark) + 헤더(banner) + main(main landmark). 뒤로/앞으로, 검색, 서버상태칩, 진단, 사용자, 로그아웃.

## B. 시각 (Visual) — 라이브 실측

- **타입 스케일(main 내부 실측 px)**: 10 / 11 / 12 / 14 / 16 / 20 / 24 — 7종. 16px(195회)·12px(80)·10px(84)가 주력. 10px 텍스트가 매우 광범위(정보 타일 부제, 배지, 카운트, 힌트). DESIGN.md 스케일(0.625rem=10 ~ 1.5rem=24)과 대체로 일치.
- **간격(gap)**: 2/4/6/8/10/12/16px — 8px(32회) 중심. 6px·4px 다수. 4/8/16 중심의 절제된 스케일에 6px·10px가 소량 혼입(경미).
- **모서리 반경**: 4/6/8/12/16px + full(9999). 8px(14)·12px(16) 중심으로 일관.
- **색상**: main 내 고유 텍스트색 25종 / 배경색 21종. 브랜드 navy·slate 회색계 + 의미색(emerald=서비스, amber=개발, blue=액션, red=위험)으로 절제 사용. 의미색이 곧 상태정보.
- **장식/모션 인벤토리**: 히어로 navy 그라데이션(1325, 은은·브랜드 정합), 배경 장식 아이콘 opacity 0.035(1327 등), framer-motion 카드 진입/호버(전역), 온라인 점 `animate-pulse`(238), 미읽음 공지 점 `animate-ping`(670). **상시 유휴 애니메이션 2종**(pulse·ping). 이모지 UI 사용 없음.
- **스크린샷 관찰(객관)**: 카드 반경·테두리(slate-200)·그림자(shadow-sm) 일관, 정렬 정돈, 레거시 회색폼 느낌 없음. 밀도는 높으나 섹션 위계 명확. 히어로가 시각적으로 가장 무겁고 4타일 중 접속IP/연결서버 2개가 큰 지면 대비 저가치.

## C. 카피 & 정직성 (Copy & Honesty)

- **음성**: 대체로 "군더더기 없는 실무 한국어"(PRODUCT.md 기준 부합). 상태·판정 문구 단정적("해석 완료/실패", "데이터 없음", "…불러오지 못했습니다").
- **경미한 과장 1종**: "차세대 조선해양 구조 해석 플랫폼"(445,451,1574,1510 등, 소개 배너·홍보영상 메타). 제품의 실제 "레거시 탈피" 목적에 비추면 방어 가능하나 유일한 마케팅 수사.
- **다크패턴**: 없음(강제연속/숨은비용/가짜희소성/컨펌셰이밍 전무). 사내 도구 특성 반영.
- **라벨 정직성 이슈(핵심)**: 인기 해석 프로그램·프로젝트 이력 표가 **내부 program_name(camelCase 코드키)**를 그대로 노출 — 라이브 실측: "HiTessModelBuilder"(1480,1670), "GroupModuleUnit", "MooringFitting". 동일 앱이 로드맵/즐겨찾기에서는 사람이 읽는 타이틀("HiTESS Model Builder", "Group & Module Unit 권상 구조 해석", "Mooring Fitting Assessment")로 표기 → **한 개체·두 이름**, 그중 하나가 코드 문자열. 매핑 함수 `findAppByProgramName`은 이미 존재.
- **혼합 언어**: 사이드바 메뉴·섹션 헤더·모드명 전부 영문(WORKBENCH/ANALYSIS/File-Based…), 본문 한국어. 일부 타이틀이 한영 혼용("선급 Rule 기반 선체 가속도 Calculation", context:44). 사내 엔지니어링 관용상 허용 범위이나 일관성 경미 흠.
- **배지 정직성**: NEW 배지는 localStorage `notice_last_seen_id` 대비 실제 미읽음 수 계산(612, 668) — 하드코딩 아님. 가짜 카운터 없음.

## D. 무게 & 마찰 (Weight & Friction)

- **번들(dist/assets 실측)**: 대시보드 초기 로드 = index(entry) 109KB + vendor 260KB + vendor-headlessui 91KB + Dashboard 62KB + CSS 190KB ≈ **712KB(비압축)**. gzip 추정 ~220–250KB. 무거운 `vendor-three`(545KB)·`vendor-charts`(430KB)는 대시보드 미로드(해당 페이지 lazy). 모달 3종 `lazy()` 분할(28–30).
- **초기 네트워크 요청**: 마운트 시 5계열(큐·인기30/전체·세션·이력·월간). 폴링 1종: QueueStatusCard `systemIntervalMs=3000`(3초, 216) — 단 `document.hidden` 가드(205,217)로 비활성 탭 시 정지(양호).
- **TTI(추정)**: Electron 로컬 디스크 로드(네트워크 병목 아님) → 사실상 파싱·초기 fetch 지배. 체감 빠름(라이브 서버칩 "Online·5ms").
- **유휴 애니메이션**: 상시 2종(온라인 pulse 238, 공지 ping 670). 나머지는 진입/호버 트리거.
- **초기 부착 오버레이**: 없음(웰컴 모달·투어·자동 토스트 없음). 모달은 사용자 조작 시에만.
- **prefers-reduced-motion**: index.css 139–148 전역 대응 + main.jsx MotionConfig(reducedMotion="user"). **양호**.
- **다크모드**: 미지원(라이트 전용). PRODUCT.md에 다크모드 요구 없음(사내 밝은 사무실 전제).

## E. 접근성 (Accessibility) — 라이브 캔버스 픽셀 기반 WCAG

- **대비(정밀 측정)**:
  - slate-400 on white/surface: **2.56 / 2.44 → 본문 FAIL**. 사용처: 표 ID열(277), "최근 5건 중 화면 높이에 맞춰 표시" 힌트(1802), "자료" 라벨(1529), 일부 부부-라벨/구분점.
  - text-blue-500 on white: **3.68 → 본문 FAIL(대형만 통과)**. 사용처: "전체 이력 보기 →"(1805) 등.
  - slate-500 on white/slate-50: 4.76 / 4.55 → **간신히 PASS**(설명·부제 다수).
  - slate-600/700: 7.6 / 10.4 → 강한 PASS. 히어로 밝은 텍스트 on navy(slate-300/blue-100): 10.2 / 12.4 → 강한 PASS. 의미색 배지 텍스트(emerald/amber/red on tint): 5.2~19 → PASS.
- **랜드마크**: Layout에 nav(사이드바)·banner(헤더)·main 존재. 스냅샷상 navigation "Primary navigation", complementary, banner, main 정상 노출.
- **키보드 도달성**: 클릭 가능 카드에 role="button"/tabIndex/onKeyDown(Enter·Space) 일관 부착 — EngineeringStatCard(52–54), DiscoverHiTessBanner(329–331), AppRoadmapBanner(388–390), NoticeStrip(650–653), FavoriteCard 오버레이 버튼(189–194). **비버튼 클릭요소도 키보드 접근 가능**(양호).
- **포커스 가시성**: focus-visible:ring 광범위 부착(192, 332, 391, 1423, 1540, DashboardFab 54). outline-none 단독 방치 없음.
- **색 비의존 판정**: 상태 배지는 점+텍스트 병기("● 해석 완료", STATUS_BADGE dot). 서버 온라인/오프라인도 점+"온라인/오프라인" 텍스트(236–246). **색맹 대응 양호**.
- **아이콘 버튼 라벨**: aria-label 다수(닫기·이동·즐겨찾기 해제 130,139,153,523,635 등). 커버리지 양호.
- **스킵 링크**: 미확인/없음(사내 도구 한정, WCAG 인증 목표 아님 — PRODUCT.md).

## 알려진 공백

- 번들 gzip 실측치는 추정(빌드 산출 비압축 바이트 기준). Electron 로컬 로드라 네트워크 영향 미미.
- 즐겨찾기 카드 상태(채워진 그리드)는 현재 계정이 즐겨찾기 0건이라 라이브 스크린샷은 빈 상태만 확보(카드 코드는 정독).
