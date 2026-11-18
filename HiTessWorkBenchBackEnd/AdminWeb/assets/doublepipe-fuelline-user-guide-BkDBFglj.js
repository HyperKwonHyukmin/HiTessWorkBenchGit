var e=`<!doctype html>\r
<html lang="ko">\r
<head>\r
<meta charset="utf-8">\r
<meta name="viewport" content="width=device-width, initial-scale=1">\r
<title>이중관 연료배관 해석 파이프라인</title>\r
<meta name="description" content="이중관 구조 연료배관 해석 App이 CSV 한 장에서 ASME B31.3 보고서까지 어떤 8단계를 거치는지, 각 단계가 무엇을 하고 어디서 실패하며 어느 코드가 그것을 담당하는지 정리한 사용자 · 공동 개발자 문서.">\r
<link rel="preconnect" href="https://fonts.googleapis.com">\r
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\r
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap">\r
<style>\r
/* ═══════════════════════════════════════════════════════════════\r
   토큰 — HiTESS WorkBench DESIGN.md 정렬\r
   posture-stability-user-guide.html 과 같은 시스템을 쓴다.\r
   두 문서가 한 제품의 문서군으로 읽혀야 하므로 토큰을 갈라놓지 않는다.\r
   ═══════════════════════════════════════════════════════════════ */\r
:root {\r
  color-scheme: light dark;\r
\r
  /* 지면 */\r
  --bg:        #f5f7fa;   /* DESIGN.md brand-gray */\r
  --surface:   #ffffff;   /* DESIGN.md white */\r
  --surface-2: #f8f9fc;   /* DESIGN.md surface */\r
  --surface-3: #edf1f7;   /* 파생 — 표 머리글. 시스템에 없던 층 */\r
\r
  /* 잉크 */\r
  --ink:   #1e293b;       /* DESIGN.md ink-strong */\r
  --ink-2: #334155;       /* DESIGN.md ink-body */\r
  --ink-3: #556377;       /* 파생 — DESIGN.md ink-muted(#64748b)는 틴트 지면에서 4.20:1 로 미달 */\r
\r
  --line:   #e2e8f0;      /* DESIGN.md line */\r
  --line-2: #cbd5e1;      /* 파생 — 강조 경계 */\r
\r
  --brand:      #002554;  /* DESIGN.md trust-blue */\r
  --brand-2:    #003366;  /* DESIGN.md trust-blue-dark */\r
  --brand-soft: #e7edf5;  /* 파생 — 브랜드 틴트 지면 */\r
  --brand-solid: #002554; /* 파생 — 브랜드 '채움' 면. --brand 와 달리 테마에 따라 밝아지지 않는다 */\r
  --on-brand:    #ffffff; /* 파생 — brand-solid 위 글자 */\r
  --link:       #2563eb;  /* DESIGN.md action-blue */\r
\r
  /* 판정 3색 — DESIGN.md success/warning/danger 와 같은 색상 계열을\r
     본문 대비 4.5:1 이상까지 끌어올린 파생. 원본(#10b981/#f59e0b)은 채움 전용 */\r
  --pass: #047857; --pass-bg: #ecfdf5; --pass-line: #a7f3d0;\r
  --warn: #b45309; --warn-bg: #fffbeb; --warn-line: #fde68a;\r
  --fail: #b91c1c; --fail-bg: #fef2f2; --fail-line: #fecaca;\r
  --neut: #475569; --neut-bg: #e8edf3; --neut-line: #cbd5e1;\r
\r
  --shadow: 0 1px 2px rgba(30, 41, 59, .05), 0 8px 24px -18px rgba(30, 41, 59, .30);\r
\r
  /* 반경 — DESIGN.md rounded */\r
  --r-sm: 4px; --r-md: 8px; --r-lg: 12px; --r-full: 9999px;\r
\r
  /* 간격 — DESIGN.md spacing */\r
  --s-xs: 4px; --s-sm: 8px; --s-md: 16px; --s-lg: 24px; --s-xl: 32px;\r
  --s-2xl: 48px; --s-3xl: 72px;\r
\r
  /* 타입 — 고정 rem 스케일 (제품 UI 는 가변 clamp 를 쓰지 않는다) */\r
  --t-xs:   .75rem;\r
  --t-sm:   .8125rem;\r
  --t-ui:   .875rem;\r
  --t-tbl:  .9375rem;\r
  --t-body: 1rem;\r
  --t-lead: 1.125rem;\r
  --t-h4:   1rem;\r
  --t-h3:   1.0625rem;\r
  --t-card: 1.25rem;\r
  --t-h2:   1.375rem;\r
  --t-h1:   2.25rem;\r
\r
  --z-sticky: 100;\r
  --z-float:  200;\r
\r
  --sans: "Inter", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif;\r
  --mono: "Fira Code", "D2Coding", Consolas, ui-monospace, monospace;\r
\r
  --topbar-h: 3rem;\r
}\r
\r
@media (prefers-color-scheme: dark) {\r
  :root:not([data-theme="light"]) {\r
    --bg:        #0f151c;\r
    --surface:   #171f29;\r
    --surface-2: #1c2531;\r
    --surface-3: #212c39;\r
\r
    --ink:   #e2e8f0;\r
    --ink-2: #a8b6c8;\r
    --ink-3: #8d9cb0;\r
\r
    --line:   #27333f;\r
    --line-2: #37485c;\r
\r
    --brand:      #8ab6e8;\r
    --brand-2:    #a9cbf1;\r
    --brand-soft: #17232f;\r
    --brand-solid: #1b4a7a;\r
    --on-brand:    #ffffff;\r
    --link:       #7db2f0;\r
\r
    --pass: #5fd0a0; --pass-bg: #0f2b21; --pass-line: #1d5340;\r
    --warn: #ebb457; --warn-bg: #2c2312; --warn-line: #5c4620;\r
    --fail: #f78d84; --fail-bg: #301815; --fail-line: #63302b;\r
    --neut: #aab7c7; --neut-bg: #1e2836; --neut-line: #37485c;\r
\r
    --shadow: 0 1px 2px rgba(0, 0, 0, .45), 0 10px 28px -20px rgba(0, 0, 0, .85);\r
  }\r
}\r
\r
:root[data-theme="dark"] {\r
  --bg:        #0f151c;\r
  --surface:   #171f29;\r
  --surface-2: #1c2531;\r
  --surface-3: #212c39;\r
\r
  --ink:   #e2e8f0;\r
  --ink-2: #a8b6c8;\r
  --ink-3: #8d9cb0;\r
\r
  --line:   #27333f;\r
  --line-2: #37485c;\r
\r
  --brand:      #8ab6e8;\r
  --brand-2:    #a9cbf1;\r
  --brand-soft: #17232f;\r
  --brand-solid: #1b4a7a;\r
  --on-brand:    #ffffff;\r
  --link:       #7db2f0;\r
\r
  --pass: #5fd0a0; --pass-bg: #0f2b21; --pass-line: #1d5340;\r
  --warn: #ebb457; --warn-bg: #2c2312; --warn-line: #5c4620;\r
  --fail: #f78d84; --fail-bg: #301815; --fail-line: #63302b;\r
  --neut: #aab7c7; --neut-bg: #1e2836; --neut-line: #37485c;\r
\r
  --shadow: 0 1px 2px rgba(0, 0, 0, .45), 0 10px 28px -20px rgba(0, 0, 0, .85);\r
}\r
\r
/* ═══ 기본 ═════════════════════════════════════════════════════ */\r
*, *::before, *::after { box-sizing: border-box; }\r
\r
html { scroll-behavior: smooth; }\r
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }\r
\r
body {\r
  margin: 0;\r
  padding-top: var(--topbar-h);\r
  background: var(--bg);\r
  color: var(--ink-2);\r
  font-family: var(--sans);\r
  font-size: var(--t-body);\r
  line-height: 1.75;\r
  -webkit-font-smoothing: antialiased;\r
  word-break: keep-all;\r
  overflow-wrap: break-word;\r
}\r
\r
a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 3px; }\r
a:hover { color: var(--brand-2); }\r
\r
a:focus-visible, button:focus-visible, summary:focus-visible {\r
  outline: 2px solid var(--link);\r
  outline-offset: 3px;\r
  border-radius: var(--r-sm);\r
}\r
\r
strong { color: var(--ink); font-weight: 600; }\r
em { font-style: normal; font-weight: 600; color: var(--ink); }\r
\r
code, .mono { font-family: var(--mono); font-variant-ligatures: none; }\r
code {\r
  font-size: .875em;\r
  font-weight: 500;\r
  background: var(--surface-3);\r
  border: 1px solid var(--line);\r
  border-radius: var(--r-sm);\r
  padding: .06em .34em;\r
  color: var(--ink);\r
  white-space: nowrap;\r
}\r
/* nowrap 은 \`abaqus job=... cpus=2 int\` 처럼 공백이 든 코드를 한 줄로 붙들기 위한 것이다.\r
   그런데 이 문서에는 긴 파일 경로가 많아, 좁은 폭에서는 그 nowrap 이 지면을 밀어내\r
   페이지 전체에 가로 스크롤을 만든다. 본문(표 아님)은 좁을 때 줄바꿈을 허용한다.\r
   표 칸은 여기서 제외한다 — 표는 .tw 가 자체 가로 스크롤로 처리하고,\r
   칸 안에서 끊기게 하면 아래 '글자탑' 문제가 생긴다. */\r
@media (max-width: 760px) {\r
  p code, li code, dd code { white-space: normal; overflow-wrap: anywhere; }\r
}\r
/* 넓은 화면에서도 줄바꿈을 허용해야 하는 긴 경로 — 열이 많은 표에서 nowrap 경로 하나가\r
   표를 밀어내 정작 중요한 마지막 열을 화면 밖으로 보내는 것을 막는다. */\r
code.brk { white-space: normal; overflow-wrap: anywhere; }\r
\r
/* ⚠️ 표 안에서 '아무 데서나 끊기'는 그 칸의 최소 폭을 한 글자로 만든다.\r
   auto 테이블 레이아웃은 그 칸을 최소 폭까지 굶겨 버리므로, 긴 경로가 폭 세 글자짜리\r
   세로 글자탑이 된다(실측: '위치' 열이 3자 폭으로 붕괴, 행 높이 250px+).\r
   그래서 표 안의 끊김 허용 요소에는 반드시 폭 하한을 준다 — 이 하한이 곧 그 열의\r
   최소 폭이 되어 레이아웃이 칸을 굶기지 못한다. */\r
td code.brk, th code.brk {\r
  display: inline-block;\r
  min-width: 11rem;\r
  max-width: 100%;\r
  vertical-align: top;\r
}\r
/* 설명 열 — 앞의 nowrap 코드 열들이 폭을 다 먹으면 정작 읽어야 할 설명이\r
   폭 120px 짜리 세로 탑이 된다(실측: 실패 진단 표에서 122x388px).\r
   설명 열에 하한을 줘서, 모자라면 칸을 굶히는 대신 .tw 가 가로로 스크롤되게 한다. */\r
td.desc, th.desc { min-width: 15rem; }\r
\r
.skip {\r
  position: absolute;\r
  left: var(--s-sm);\r
  top: calc(var(--topbar-h) + var(--s-sm));\r
  z-index: var(--z-float);\r
  transform: translateY(-300%);\r
  background: var(--brand-solid);\r
  color: var(--on-brand);\r
  padding: var(--s-sm) var(--s-md);\r
  border-radius: var(--r-md);\r
  font-size: var(--t-ui);\r
  font-weight: 600;\r
  text-decoration: none;\r
}\r
.skip:focus { transform: translateY(0); color: var(--on-brand); }\r
\r
/* ═══ 고정 상단 바 ═════════════════════════════════════════════ */\r
.topbar {\r
  position: fixed;\r
  inset: 0 0 auto 0;\r
  height: var(--topbar-h);\r
  z-index: var(--z-sticky);\r
  display: flex;\r
  align-items: center;\r
  gap: var(--s-sm);\r
  padding-inline: var(--s-md);\r
  background: var(--surface);\r
  border-bottom: 1px solid var(--line);\r
}\r
\r
.tb-home {\r
  font-size: var(--t-ui);\r
  font-weight: 600;\r
  color: var(--ink);\r
  text-decoration: none;\r
  white-space: nowrap;\r
  flex: none;\r
}\r
.tb-home:hover { color: var(--brand-2); }\r
.tb-sep { color: var(--line-2); flex: none; }\r
.topbar:not(.has-now) .tb-sep { display: none; }\r
.tb-now {\r
  font-size: var(--t-ui);\r
  color: var(--ink-3);\r
  white-space: nowrap;\r
  overflow: hidden;\r
  text-overflow: ellipsis;\r
  min-width: 0;\r
  flex: 1 1 auto;\r
}\r
.tb-now b { color: var(--ink-2); font-weight: 600; }\r
@media (max-width: 560px) { .tb-home, .tb-sep { display: none; } }\r
\r
.tb-top {\r
  flex: none;\r
  font-size: var(--t-sm);\r
  font-weight: 600;\r
  color: var(--ink-3);\r
  background: var(--surface);\r
  border: 1px solid var(--line);\r
  border-radius: var(--r-md);\r
  padding: var(--s-xs) var(--s-sm);\r
  font-family: inherit;\r
  cursor: pointer;\r
  visibility: hidden;\r
}\r
.tb-top:hover { color: var(--ink); border-color: var(--line-2); background: var(--surface-2); }\r
.tb-top.on { visibility: visible; }\r
\r
/* ═══ 셸 ═══════════════════════════════════════════════════════ */\r
/* 2단(목차 + 본문) 분기점 860px.\r
   이 문서는 WorkBench 안에서 모달 iframe 으로도 뜨는데, 그때 폭은\r
   min(1024, 창폭 - 32) 이다. 940px 기준에서는 앱 창이 972px 만 돼도\r
   1단으로 내려가 목차가 사라졌다(배율 150%+ 또는 창 비최대화에서 쉽게 발생). */\r
.shell {\r
  max-width: 76rem;\r
  margin: 0 auto;\r
  padding: 0 var(--s-lg) var(--s-3xl);\r
  display: grid;\r
  grid-template-columns: minmax(0, 1fr);\r
  gap: var(--s-xl);\r
}\r
\r
@media (min-width: 860px) {\r
  .shell {\r
    grid-template-columns: 14rem minmax(0, 1fr);\r
    column-gap: var(--s-2xl);\r
    padding-inline: var(--s-xl);\r
  }\r
  .rail {\r
    position: sticky;\r
    top: calc(var(--topbar-h) + var(--s-md));\r
    align-self: start;\r
    max-height: calc(100vh - var(--topbar-h) - var(--s-xl));\r
    overflow-y: auto;\r
    overscroll-behavior: contain;\r
    padding-block: var(--s-lg) var(--s-md);\r
  }\r
}\r
\r
/* ═══ 머리 ═════════════════════════════════════════════════════ */\r
.masthead {\r
  grid-column: 1 / -1;\r
  padding: var(--s-2xl) 0 var(--s-xl);\r
  border-bottom: 2px solid var(--brand);\r
}\r
.kicker {\r
  font-family: var(--mono);\r
  font-size: var(--t-xs);\r
  font-weight: 600;\r
  letter-spacing: .1em;\r
  color: var(--brand);\r
  margin: 0 0 var(--s-sm);\r
}\r
.masthead h1 {\r
  margin: 0;\r
  font-size: var(--t-h1);\r
  font-weight: 700;\r
  letter-spacing: -.025em;\r
  line-height: 1.2;\r
  color: var(--ink);\r
  text-wrap: balance;\r
}\r
@media (max-width: 560px) { .masthead h1 { font-size: 1.75rem; } }\r
\r
.masthead .lede {\r
  margin: var(--s-md) 0 0;\r
  max-width: 62ch;\r
  font-size: var(--t-lead);\r
  color: var(--ink-2);\r
  line-height: 1.7;\r
  text-wrap: pretty;\r
}\r
.specline {\r
  display: flex;\r
  flex-wrap: wrap;\r
  gap: var(--s-xs) var(--s-lg);\r
  margin: var(--s-lg) 0 0;\r
  padding: 0;\r
  list-style: none;\r
  font-family: var(--mono);\r
  font-size: var(--t-xs);\r
  color: var(--ink-3);\r
}\r
.specline b { color: var(--ink-2); font-weight: 600; margin-right: var(--s-sm); }\r
\r
/* ═══ 색인 ═════════════════════════════════════════════════════ */\r
.rail {\r
  padding-block: var(--s-md) 0;\r
  font-size: var(--t-ui);\r
}\r
.rail details {\r
  border: 1px solid var(--line);\r
  border-radius: var(--r-md);\r
  background: var(--surface);\r
}\r
.rail summary {\r
  cursor: pointer;\r
  list-style: none;\r
  padding: var(--s-sm) var(--s-md);\r
  font-weight: 600;\r
  color: var(--ink);\r
}\r
.rail summary::-webkit-details-marker { display: none; }\r
.rail summary::after { content: " \\25BE"; color: var(--ink-3); }\r
.rail details[open] summary::after { content: " \\25B4"; }\r
\r
.rail-body { padding: 0 var(--s-sm) var(--s-sm); }\r
@media (min-width: 860px) { .rail-body { padding: 0; } }\r
\r
.rail h2 {\r
  font-family: var(--mono);\r
  font-size: var(--t-xs);\r
  font-weight: 600;\r
  letter-spacing: .08em;\r
  color: var(--ink-3);\r
  margin: var(--s-md) 0 var(--s-sm);\r
}\r
.rail h2:first-child { margin-top: var(--s-sm); }\r
.rail ol { list-style: none; margin: 0; padding: 0; }\r
.rail a {\r
  display: flex;\r
  gap: var(--s-sm);\r
  align-items: baseline;\r
  padding: var(--s-xs) var(--s-sm);\r
  border-radius: var(--r-sm);\r
  text-decoration: none;\r
  color: var(--ink-2);\r
  line-height: 1.45;\r
  border-left: 2px solid transparent;\r
}\r
.rail a:hover { background: var(--surface-2); color: var(--ink); }\r
.rail a .n {\r
  font-family: var(--mono);\r
  font-size: var(--t-xs);\r
  font-weight: 600;\r
  color: var(--ink-3);\r
  min-width: 1ch;\r
}\r
.rail a[aria-current="true"] {\r
  background: var(--brand-soft);\r
  color: var(--ink);\r
  font-weight: 600;\r
  border-left-color: var(--brand);\r
}\r
.rail a[aria-current="true"] .n { color: var(--brand); }\r
\r
/* 넓은 화면에서는 목차가 항상 펼쳐진 평면 목록이다 (접기 UI 없음).\r
   이 블록은 위 .rail details 기본형보다 뒤에 와야 한다 — 같은 특이도라 순서가 승부를 가른다. */\r
@media (min-width: 860px) {\r
  .rail summary { display: none; }\r
  .rail details { border: 0; background: none; }\r
}\r
\r
/* ═══ 본문 ═════════════════════════════════════════════════════ */\r
.doc {\r
  min-width: 0;\r
  padding-top: var(--s-lg);\r
  display: flex;\r
  flex-direction: column;\r
  gap: var(--s-3xl);\r
}\r
section { scroll-margin-top: calc(var(--topbar-h) + var(--s-md)); }\r
\r
h2.head {\r
  margin: 0 0 var(--s-md);\r
  font-size: 1.5rem;\r
  font-weight: 700;\r
  letter-spacing: -.018em;\r
  line-height: 1.35;\r
  color: var(--ink);\r
  text-wrap: balance;\r
}\r
h3 {\r
  margin: var(--s-xl) 0 var(--s-sm);\r
  font-size: var(--t-h3);\r
  font-weight: 600;\r
  letter-spacing: -.008em;\r
  color: var(--ink);\r
  text-wrap: balance;\r
}\r
h4 {\r
  margin: var(--s-lg) 0 var(--s-sm);\r
  font-size: var(--t-h4);\r
  font-weight: 600;\r
  color: var(--ink);\r
}\r
p { margin: 0 0 var(--s-md); max-width: 68ch; text-wrap: pretty; }\r
.doc ul, .doc ol.steps { max-width: 68ch; padding-left: 1.2em; margin: 0 0 var(--s-md); }\r
.doc li { margin-bottom: var(--s-xs); }\r
.doc li::marker { color: var(--ink-3); }\r
\r
/* ═══ 칩 ═══════════════════════════════════════════════════════ */\r
.chip {\r
  display: inline-flex;\r
  align-items: center;\r
  padding: 1px var(--s-sm);\r
  border-radius: var(--r-full);\r
  border: 1px solid;\r
  font-size: var(--t-xs);\r
  font-weight: 600;\r
  white-space: nowrap;\r
  line-height: 1.7;\r
  vertical-align: baseline;\r
}\r
.chip.pass  { background: var(--pass-bg);  color: var(--pass);  border-color: var(--pass-line); }\r
.chip.warn  { background: var(--warn-bg);  color: var(--warn);  border-color: var(--warn-line); }\r
.chip.fail  { background: var(--fail-bg);  color: var(--fail);  border-color: var(--fail-line); }\r
.chip.neut  { background: var(--neut-bg);  color: var(--neut);  border-color: var(--neut-line); }\r
.chip.brand { background: var(--brand-soft); color: var(--brand); border-color: var(--line-2); }\r
\r
/* ═══ 요약 표 — 문서 첫 블록, 내비게이션 겸용 ══════════════════ */\r
.summary { width: 100%; border-collapse: collapse; font-size: var(--t-tbl); }\r
.summary thead th {\r
  text-align: left;\r
  font-size: var(--t-xs);\r
  font-weight: 600;\r
  color: var(--ink-3);\r
  padding: 0 var(--s-md) var(--s-sm);\r
  border-bottom: 1px solid var(--line-2);\r
  white-space: nowrap;\r
  background: none;\r
}\r
.summary tbody tr { border-bottom: 1px solid var(--line); }\r
.summary tbody tr:hover { background: var(--surface-2); }\r
.summary tbody tr:hover > * { background: none; }\r
.summary td, .summary th {\r
  padding: var(--s-sm) var(--s-md);\r
  vertical-align: baseline;\r
  border-bottom: 0;\r
  color: var(--ink-2);\r
}\r
.summary .s-n {\r
  font-family: var(--mono);\r
  font-size: var(--t-lead);\r
  font-weight: 600;\r
  font-variant-numeric: tabular-nums;\r
  width: 1%;\r
  padding-right: 0;\r
}\r
.summary .s-name { width: 1%; }\r
.summary .s-name a { font-weight: 600; color: var(--ink); text-decoration: none; white-space: nowrap; }\r
.summary .s-name a:hover { color: var(--link); text-decoration: underline; }\r
.summary .s-max { width: 1%; white-space: nowrap; }\r
.summary tr[data-sev="fail"] .s-n { color: var(--fail); }\r
.summary tr[data-sev="warn"] .s-n { color: var(--warn); }\r
.summary tr[data-sev="neut"] .s-n { color: var(--ink-3); }\r
\r
@media (max-width: 760px) {\r
  .summary, .summary tbody, .summary tr, .summary td, .summary th { display: block; width: auto; }\r
  .summary thead { display: none; }\r
  .summary tbody tr { padding: var(--s-sm) var(--s-md); }\r
  .summary td, .summary th { padding: 0 0 var(--s-xs); }\r
  .summary .s-n, .summary .s-name { display: inline; }\r
  .summary .s-n { margin-right: var(--s-sm); }\r
  /* 블록으로 풀린 셀에 남은 width:1% 는 폭 4px 짜리 칸을 만들어 칩이 지면 밖으로 삐져나간다.\r
     이 표는 열이 5개라 좁은 폭에서 특히 잘 드러난다 — 스택 모드에서는 폭 제약을 전부 푼다. */\r
  .summary .s-max, .summary .w1 { width: auto; }\r
  .summary .s-max { display: block; padding-top: var(--s-xs); }\r
}\r
\r
/* ═══ 일반 표 ══════════════════════════════════════════════════ */\r
.tw {\r
  overflow-x: auto;\r
  margin: 0 0 var(--s-md);\r
  border: 1px solid var(--line);\r
  border-radius: var(--r-md);\r
  background: var(--surface);\r
}\r
table { width: 100%; border-collapse: collapse; font-size: var(--t-tbl); min-width: 26rem; }\r
thead th {\r
  background: var(--surface-3);\r
  text-align: left;\r
  font-weight: 600;\r
  font-size: var(--t-sm);\r
  color: var(--ink-2);\r
  padding: var(--s-sm) var(--s-md);\r
  border-bottom: 1px solid var(--line);\r
  white-space: nowrap;\r
}\r
tbody td, tbody th {\r
  padding: var(--s-sm) var(--s-md);\r
  border-bottom: 1px solid var(--line);\r
  vertical-align: baseline;\r
  text-align: left;\r
  font-weight: 400;\r
  line-height: 1.65;\r
  color: var(--ink-2);\r
}\r
tbody tr:last-child > * { border-bottom: 0; }\r
tbody tr:hover > * { background: var(--surface-2); }\r
tbody th { font-weight: 500; color: var(--ink); }\r
\r
/* 기준 열 — 숫자가 먼저 읽히도록 */\r
.val {\r
  font-family: var(--mono);\r
  font-variant-numeric: tabular-nums;\r
  font-weight: 600;\r
  color: var(--ink);\r
  white-space: nowrap;\r
}\r
.c { text-align: center; }\r
.w1 { width: 1%; white-space: nowrap; }\r
table code { white-space: nowrap; }\r
\r
/* Load Case 표는 29행이라 촘촘하게 — 스캔이 목적이지 정독이 아니다 */\r
table.dense tbody td, table.dense tbody th { padding: var(--s-xs) var(--s-md); line-height: 1.5; }\r
\r
/* 묶음 표시를 열 대신 구분 행으로 — 단계 카드 안(폭 ~600px)에서 열이 4개가 되면\r
   마지막 설명 열이 잘려 나간다. 열 하나를 행으로 접어 설명 열의 폭을 되찾는다. */\r
tbody tr.grp > th {\r
  background: var(--surface-2);\r
  font-family: var(--mono);\r
  font-size: var(--t-xs);\r
  font-weight: 600;\r
  letter-spacing: .06em;\r
  color: var(--ink-3);\r
  padding-top: var(--s-sm);\r
  padding-bottom: var(--s-sm);\r
}\r
tbody tr.grp:hover > * { background: var(--surface-2); }\r
\r
/* ═══ 수식 / 절차 / 흐름도 ═════════════════════════════════════ */\r
.eq {\r
  font-family: var(--mono);\r
  font-size: var(--t-ui);\r
  background: var(--surface-3);\r
  border: 1px solid var(--line);\r
  border-radius: var(--r-md);\r
  padding: var(--s-md) var(--s-lg);\r
  margin: 0 0 var(--s-md);\r
  overflow-x: auto;\r
  line-height: 1.9;\r
  white-space: pre;\r
  color: var(--ink);\r
  font-variant-ligatures: none;\r
}\r
/* 흐름도는 줄간격을 좁혀 도형이 뭉개지지 않게 한다 */\r
.eq.flow { line-height: 1.45; font-size: var(--t-sm); }\r
\r
/* ═══ 단계 카드 ════════════════════════════════════════════════ */\r
.stage {\r
  background: var(--surface);\r
  border: 1px solid var(--line);\r
  border-radius: var(--r-lg);\r
  padding: var(--s-lg);\r
  box-shadow: var(--shadow);\r
}\r
.stage > header {\r
  display: flex;\r
  flex-wrap: wrap;\r
  align-items: baseline;\r
  gap: var(--s-sm) var(--s-md);\r
  padding-bottom: var(--s-md);\r
  margin-bottom: var(--s-md);\r
  border-bottom: 1px solid var(--line);\r
}\r
.stage .num {\r
  font-family: var(--mono);\r
  font-size: 1.5rem;\r
  font-weight: 600;\r
  font-variant-numeric: tabular-nums;\r
  letter-spacing: -.02em;\r
  line-height: 1;\r
  flex: none;\r
}\r
.stage[data-sev="fail"] .num { color: var(--fail); }\r
.stage[data-sev="warn"] .num { color: var(--warn); }\r
.stage[data-sev="neut"] .num { color: var(--ink-3); }\r
.stage h2 {\r
  margin: 0;\r
  font-size: var(--t-card);\r
  font-weight: 700;\r
  letter-spacing: -.012em;\r
  color: var(--ink);\r
  flex: 1 1 12rem;\r
}\r
.stage h2 .anchor {\r
  opacity: 0;\r
  margin-left: var(--s-sm);\r
  font-family: var(--mono);\r
  font-weight: 400;\r
  font-size: var(--t-ui);\r
  text-decoration: none;\r
  color: var(--ink-3);\r
}\r
.stage:hover h2 .anchor, .stage h2 .anchor:focus-visible { opacity: 1; }\r
.stage .aim {\r
  margin: 0 0 var(--s-md);\r
  font-size: var(--t-lead);\r
  color: var(--ink-2);\r
  line-height: 1.65;\r
}\r
\r
/* 담당 코드 경로 — 공동 개발자가 "이 단계는 어느 파일인가"를 즉시 찾게 한다.\r
   flex-basis:100% 로 헤더 안에서 항상 제 줄을 차지한다. */\r
.where {\r
  flex-basis: 100%;\r
  font-family: var(--mono);\r
  font-size: var(--t-xs);\r
  color: var(--ink-3);\r
  line-height: 1.6;\r
  overflow-wrap: anywhere;\r
}\r
.where b { color: var(--ink-2); font-weight: 600; }\r
\r
.stage-nav {\r
  display: flex;\r
  justify-content: space-between;\r
  gap: var(--s-md);\r
  margin-top: var(--s-lg);\r
  padding-top: var(--s-md);\r
  border-top: 1px solid var(--line);\r
  font-size: var(--t-ui);\r
}\r
.stage-nav a { text-decoration: none; color: var(--ink-3); font-weight: 500; }\r
.stage-nav a:hover { color: var(--link); text-decoration: underline; }\r
\r
/* ═══ 조치 / 주의 블록 ═════════════════════════════════════════ */\r
.fix, .note {\r
  border-radius: var(--r-md);\r
  padding: var(--s-md) var(--s-lg);\r
}\r
.fix { background: var(--brand-soft); border: 1px solid var(--line-2); margin: var(--s-lg) 0 0; }\r
.note { margin: var(--s-lg) 0; border: 1px solid var(--line-2); background: var(--surface-2); }\r
.note.caution { border-color: var(--warn-line); background: var(--warn-bg); }\r
.note.caution .lbl { color: var(--warn); }\r
.note.caution strong, .note.caution em { color: var(--warn); }\r
.note.dev { border-color: var(--line-2); background: var(--surface-3); }\r
\r
.note .lbl, .fix > h4 {\r
  display: block;\r
  margin: 0 0 var(--s-sm);\r
  font-family: var(--mono);\r
  font-size: var(--t-xs);\r
  font-weight: 600;\r
  letter-spacing: .08em;\r
  color: var(--ink-3);\r
}\r
.fix > h4 { color: var(--brand); }\r
.fix p:last-child, .fix ul:last-child, .note p:last-child, .note ul:last-child { margin-bottom: 0; }\r
\r
/* ═══ 두 갈래 비교 ═════════════════════════════════════════════ */\r
.split { display: grid; gap: var(--s-md); margin: 0 0 var(--s-md); }\r
@media (min-width: 640px) { .split { grid-template-columns: 1fr 1fr; } }\r
.split > div {\r
  border: 1px solid var(--line);\r
  border-radius: var(--r-md);\r
  padding: var(--s-md) var(--s-lg);\r
  background: var(--surface-2);\r
}\r
.split h4 { margin: 0 0 var(--s-sm); font-size: var(--t-ui); }\r
.split ul { margin: 0; padding-left: 1.2em; font-size: var(--t-tbl); }\r
.split li:last-child { margin-bottom: 0; }\r
\r
/* ═══ 항목 카드 (구성요소 · 진단) ══════════════════════════════ */\r
.opt {\r
  border: 1px solid var(--line);\r
  border-radius: var(--r-lg);\r
  padding: var(--s-lg);\r
  background: var(--surface);\r
  box-shadow: var(--shadow);\r
}\r
.opt + .opt { margin-top: var(--s-md); }\r
.opt > header {\r
  display: flex;\r
  flex-wrap: wrap;\r
  gap: var(--s-sm) var(--s-md);\r
  align-items: baseline;\r
  margin-bottom: var(--s-md);\r
}\r
.opt h3 { margin: 0; font-size: var(--t-h3); }\r
\r
/* ═══ 꼬리 ═════════════════════════════════════════════════════ */\r
.colophon {\r
  grid-column: 1 / -1;\r
  border-top: 1px solid var(--line);\r
  margin-top: var(--s-md);\r
  padding-top: var(--s-lg);\r
  color: var(--ink-3);\r
}\r
.colophon dl {\r
  display: grid;\r
  grid-template-columns: auto minmax(0, 1fr);\r
  gap: var(--s-xs) var(--s-lg);\r
  margin: 0;\r
  font-family: var(--mono);\r
  font-size: var(--t-xs);\r
}\r
.colophon dt { font-weight: 600; color: var(--ink-2); white-space: nowrap; }\r
.colophon dd { margin: 0; overflow-wrap: anywhere; }\r
\r
/* ═══ 인쇄 ═════════════════════════════════════════════════════ */\r
@media print {\r
  :root {\r
    --bg: #fff; --surface: #fff; --surface-2: #fff; --surface-3: #f1f3f6;\r
    --ink: #000; --ink-2: #1a1a1a; --ink-3: #444;\r
    --line: #bbb; --line-2: #888;\r
    --brand: #002554; --brand-solid: #002554; --on-brand: #fff; --link: #00306b;\r
    --pass-bg: #fff; --warn-bg: #fff; --fail-bg: #fff; --neut-bg: #fff;\r
    --shadow: none; --topbar-h: 0px;\r
  }\r
  body { font-size: 10pt; line-height: 1.55; padding-top: 0; }\r
  .topbar, .rail, .skip, .stage-nav, .anchor { display: none !important; }\r
  .shell { display: block; max-width: none; padding: 0; }\r
  .doc { display: block; }\r
  .doc > section { margin-bottom: 20pt; }\r
  .stage, .opt, .note, .fix, .split > div, .tw { break-inside: avoid; box-shadow: none; }\r
  h2.head, h3, .stage > header { break-after: avoid; }\r
  .tw { overflow: visible; }\r
  table { min-width: 0; font-size: 9pt; }\r
  a { color: inherit; text-decoration: none; }\r
  .masthead { padding-top: 0; }\r
}\r
</style>\r
</head>\r
\r
<body id="top">\r
\r
<a class="skip" href="#main">본문 바로가기</a>\r
\r
<div class="topbar">\r
  <a class="tb-home" href="#top">이중관 연료배관 해석 파이프라인</a>\r
  <span class="tb-sep" aria-hidden="true">/</span>\r
  <span class="tb-now" id="tbNow" aria-live="polite"></span>\r
  <button class="tb-top" id="tbTop" type="button">맨 위로</button>\r
</div>\r
\r
<div class="shell">\r
\r
  <header class="masthead">\r
    <p class="kicker">이중관 구조 연료배관 해석 · Piping Stress Analysis</p>\r
    <h1>이중관 연료배관 해석 파이프라인</h1>\r
    <p class="lede">\r
      외관 배관 CSV 한 장을 넣으면 내관과 U-Bolt 지지를 자동으로 만들고, Abaqus 유한요소해석을 세 번\r
      돌린 뒤 ASME B31.3 코드 적합성까지 검토해 Excel 보고서로 끝냅니다. 그 8단계가 <em>각각 무엇을\r
      하고</em>, <em>어디서 멈출 수 있으며</em>, <em>어느 코드가 그것을 담당하는지</em>를 정리했습니다.\r
    </p>\r
    <ul class="specline">\r
      <li><b>대상</b>이중관 구조 연료배관 해석 (File-Based App)</li>\r
      <li><b>엔진</b>PSA_AllLoadCases · InnerPipeTransform</li>\r
      <li><b>코드</b>ASME B31.3-2018</li>\r
      <li><b>App</b>v1.4.4</li>\r
      <li><b>작성</b>2026-08-26</li>\r
    </ul>\r
  </header>\r
\r
  <nav class="rail" aria-label="문서 색인">\r
    <details open>\r
      <summary>목차</summary>\r
      <div class="rail-body">\r
        <h2>먼저 읽기</h2>\r
        <ol>\r
          <li><a href="#what"><span class="n" aria-hidden="true">·</span><span>무엇을 하는 앱인가</span></a></li>\r
          <li><a href="#map"><span class="n" aria-hidden="true">·</span><span>8단계 한눈에</span></a></li>\r
        </ol>\r
        <h2>단계별 동작</h2>\r
        <ol>\r
          <li><a href="#s1"><span class="n" aria-hidden="true">1</span><span>입력 준비</span></a></li>\r
          <li><a href="#s2"><span class="n" aria-hidden="true">2</span><span>내관 자동 생성</span></a></li>\r
          <li><a href="#s3"><span class="n" aria-hidden="true">3</span><span>해석 입력 확정</span></a></li>\r
          <li><a href="#s4"><span class="n" aria-hidden="true">4</span><span>Load Case 선택</span></a></li>\r
          <li><a href="#s5"><span class="n" aria-hidden="true">5</span><span>FEM 모델 생성</span></a></li>\r
          <li><a href="#s6"><span class="n" aria-hidden="true">6</span><span>Abaqus 3회전</span></a></li>\r
          <li><a href="#s7"><span class="n" aria-hidden="true">7</span><span>ASME B31.3 검토</span></a></li>\r
          <li><a href="#s8"><span class="n" aria-hidden="true">8</span><span>보고서 생성</span></a></li>\r
        </ol>\r
        <h2>운영</h2>\r
        <ol>\r
          <li><a href="#lock"><span class="n" aria-hidden="true">·</span><span>라이센스 · 중단 · 재연결</span></a></li>\r
          <li><a href="#errors"><span class="n" aria-hidden="true">·</span><span>실패 진단</span></a></li>\r
        </ol>\r
        <h2>공동 개발자</h2>\r
        <ol>\r
          <li><a href="#csv"><span class="n" aria-hidden="true">·</span><span>입력 CSV 규격</span></a></li>\r
          <li><a href="#parts"><span class="n" aria-hidden="true">·</span><span>구성요소와 배포</span></a></li>\r
          <li><a href="#patches"><span class="n" aria-hidden="true">·</span><span>엔진에 얹은 패치</span></a></li>\r
          <li><a href="#constants"><span class="n" aria-hidden="true">·</span><span>상수 일람</span></a></li>\r
          <li><a href="#scope"><span class="n" aria-hidden="true">·</span><span>하지 않는 것 · 한계</span></a></li>\r
        </ol>\r
      </div>\r
    </details>\r
  </nav>\r
\r
  <main class="doc" id="main">\r
\r
    <!-- ══ 무엇을 하는 앱인가 ════════════════════════════════ -->\r
    <section id="what">\r
      <h2 class="head">무엇을 하는 앱인가</h2>\r
\r
      <p>\r
        이중관(내관 + 외관) 연료배관의 <strong>Inner Support 설계</strong>와\r
        <strong>배관응력 해석(PSA, Piping Stress Analysis)</strong>을 하나로 묶은 도구입니다.\r
        원래 사람이 며칠에 걸쳐 하던 일 — 내관 배치와 U-Bolt 지지 위치를 정하고, Abaqus 모델을 만들고,\r
        29개 하중조합을 돌리고, 결과를 ASME B31.3 허용치와 대조해 보고서를 쓰는 일 — 을\r
        <strong>CSV 한 장에서 버튼 두 번으로</strong> 끝내는 것이 목표입니다.\r
      </p>\r
\r
      <div class="eq flow">Tab 1 · Design Inner Support            Tab 2 · Piping Stress Analysis\r
────────────────────────────            ──────────────────────────────\r
\r
  외관 배관 CSV                             내관 포함 배관 CSV\r
        │                                          │\r
  [1] 입력 준비                             [4] Load Case 선택\r
      내관 규격 · 설계조건                        전체 29개 / 선택(+L17)\r
        │                                          │\r
        ▼                                          ▼\r
  [2] 내관 자동 생성 ── [3] 전달 ──▶      [5] FEM 모델 생성\r
      Y −15000mm · U-Bolt      ▲               Abaqus INP + Nastran BDF\r
        │                      │                    │\r
        ▼                      │                    ▼\r
  결과 CSV · 도면 PDF     직접 업로드도 가능  [6] Abaqus 해석 ×3회전\r
                                               비마찰 → 마찰#1 → 마찰#2\r
                                                   │\r
                                                   ▼\r
                                           [7] ASME B31.3 코드 검토\r
                                                   │\r
                                                   ▼\r
                                           [8] Report for PSA.xlsx\r
                                               + Inforget_f06.f06</div>\r
\r
      <h3>두 탭은 붙어 있지만 독립적입니다</h3>\r
      <p>\r
        Tab 1 은 <strong>외관만 있는 CSV 에 내관을 만들어 붙이는 전처리</strong>이고,\r
        Tab 2 는 <strong>내관까지 들어있는 CSV 를 해석하는 본작업</strong>입니다.\r
        이미 내관이 포함된 CSV 를 가지고 있다면 Tab 1 을 건너뛰고 Tab 2 에 바로 업로드해도 됩니다.\r
      </p>\r
\r
      <div class="split">\r
        <div>\r
          <h4>Tab 1 만 쓰는 경우</h4>\r
          <ul>\r
            <li>내관 배치 · U-Bolt 지지 간격만 검토하고 싶을 때</li>\r
            <li>결과 CSV 와 배치 도면 PDF 만 받아 가면 됩니다</li>\r
            <li>Abaqus 가 필요 없고 <strong>수 초</strong>면 끝납니다</li>\r
          </ul>\r
        </div>\r
        <div>\r
          <h4>Tab 2 만 쓰는 경우</h4>\r
          <ul>\r
            <li>내관이 이미 들어있는 CSV 를 가지고 있을 때</li>\r
            <li>Tab 2 상단에서 CSV 를 직접 업로드하면 됩니다</li>\r
            <li>Abaqus 라이센스가 필요하고 <strong>수십 분~수 시간</strong> 걸립니다</li>\r
          </ul>\r
        </div>\r
      </div>\r
\r
      <div class="note">\r
        <span class="lbl">시간 감각</span>\r
        <p>\r
          ①~③ 은 즉시 끝나지만 <strong>⑤~⑧ 은 한 번 시작하면 되돌릴 수 없는 장시간 작업</strong>입니다.\r
          Load Case 29개 &times; 3회전 = 최대 87회의 Abaqus job 이 순차로 돌아갑니다. 서버 제한 시간은\r
          <span class="val">7,200초(2시간)</span>이고, 그 안에 못 끝나면 강제 종료됩니다.\r
          급하면 <a href="#s4">④ 에서 필요한 Load Case 만 골라</a> 돌리세요.\r
        </p>\r
      </div>\r
\r
      <p>\r
        모든 좌표와 치수는 <strong>mm</strong>, 응력은 <strong>MPa</strong>, 설계압력만 화면에서\r
        <strong>barG</strong> 로 받아 내부에서 MPa 로 바꿉니다(<code>1 bar = 0.1 MPa</code>).\r
      </p>\r
    </section>\r
\r
    <!-- ══ 8단계 한눈에 ══════════════════════════════════════ -->\r
    <section id="map">\r
      <h2 class="head">8단계 한눈에</h2>\r
      <p>\r
        화면 하단 콘솔에서 지금 어느 단계인지 확인했다면, 아래에서 그 줄을 눌러 바로 이동하세요.\r
        오른쪽 열은 <strong>그 단계에서 무엇이 잘못될 수 있는지</strong>입니다.\r
      </p>\r
\r
      <div class="tw">\r
        <table class="summary">\r
          <thead>\r
            <tr><th colspan="2">단계</th><th>무엇을 하는가</th><th>주체</th><th>여기서 멈추면</th></tr>\r
          </thead>\r
          <tbody>\r
            <tr data-sev="neut">\r
              <td class="s-n">1</td>\r
              <th class="s-name"><a href="#s1">입력 준비</a></th>\r
              <td>외관 CSV 업로드 + 내관 규격·설계조건 입력</td>\r
              <td class="w1"><span class="chip neut">사용자</span></td>\r
              <td class="s-max">—</td>\r
            </tr>\r
            <tr data-sev="neut">\r
              <td class="s-n">2</td>\r
              <th class="s-name"><a href="#s2">내관 자동 생성</a></th>\r
              <td>Y &minus;15000mm 복제 · 규격 스냅 · U-Bolt 자동 배치</td>\r
              <td class="w1"><span class="chip brand">자동</span></td>\r
              <td class="s-max"><span class="chip fail">CSV 형식 오류</span></td>\r
            </tr>\r
            <tr data-sev="neut">\r
              <td class="s-n">3</td>\r
              <th class="s-name"><a href="#s3">해석 입력 확정</a></th>\r
              <td>3D 뷰어로 모델 확인 후 해석 입력으로 지정</td>\r
              <td class="w1"><span class="chip neut">사용자</span></td>\r
              <td class="s-max">—</td>\r
            </tr>\r
            <tr data-sev="neut">\r
              <td class="s-n">4</td>\r
              <th class="s-name"><a href="#s4">Load Case 선택</a></th>\r
              <td>전체 29개 또는 필요한 것만 (L17 자동 포함)</td>\r
              <td class="w1"><span class="chip neut">사용자</span></td>\r
              <td class="s-max"><span class="chip warn">라이센스 점유</span></td>\r
            </tr>\r
            <tr data-sev="fail">\r
              <td class="s-n">5</td>\r
              <th class="s-name"><a href="#s5">FEM 모델 생성</a></th>\r
              <td>CSV → 이중관 메시 → Abaqus INP + Nastran BDF</td>\r
              <td class="w1"><span class="chip brand">자동</span></td>\r
              <td class="s-max"><span class="chip fail">전체 중단</span></td>\r
            </tr>\r
            <tr data-sev="fail">\r
              <td class="s-n">6</td>\r
              <th class="s-name"><a href="#s6">Abaqus 3회전</a></th>\r
              <td>비마찰 → 마찰 반복 #1 → 마찰 반복 #2</td>\r
              <td class="w1"><span class="chip brand">자동</span></td>\r
              <td class="s-max"><span class="chip fail">전체 중단</span></td>\r
            </tr>\r
            <tr data-sev="warn">\r
              <td class="s-n">7</td>\r
              <th class="s-name"><a href="#s7">ASME B31.3 검토</a></th>\r
              <td>요소별 코드 응력 vs 허용치 대조</td>\r
              <td class="w1"><span class="chip brand">자동</span></td>\r
              <td class="s-max"><span class="chip warn">과응력 표시</span></td>\r
            </tr>\r
            <tr data-sev="neut">\r
              <td class="s-n">8</td>\r
              <th class="s-name"><a href="#s8">보고서 생성</a></th>\r
              <td>Summary 채우기 + F06 조합 + 다운로드</td>\r
              <td class="w1"><span class="chip brand">자동</span></td>\r
              <td class="s-max"><span class="chip warn">서식 유실</span></td>\r
            </tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h3>어디까지가 앱이고 어디부터가 엔진인가</h3>\r
      <p>\r
        ①·③·④ 는 브라우저(React) 안에서 끝나고, ② 는 백엔드가 파이썬 모듈을 그 자리에서 호출합니다.\r
        <strong>⑤~⑧ 은 백엔드가 백그라운드 스레드에서 실행파일 하나를 띄우고, 그 실행파일이 내부에서\r
        Abaqus 를 부르는 구조</strong>입니다. 그래서 ⑤~⑧ 은 하나의 프로세스로 묶여 있고,\r
        중간에 특정 단계만 다시 돌릴 수 없습니다.\r
      </p>\r
\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="c w1">단계</th><th class="w1">실행 위치</th><th>실행 형태</th></tr></thead>\r
          <tbody>\r
            <tr><td class="c w1"><span class="val">1 · 3 · 4</span></td><th class="w1">브라우저</th><td>React 상태. 서버 왕복 없음(3D 뷰어 파싱도 클라이언트)</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">백엔드 (동기)</th><td><code>inner_pipe_transform.py</code> 를 in-process 로 import 해 실행. 응답이 곧 결과</td></tr>\r
            <tr><td class="c w1"><span class="val">5 · 6 · 7 · 8</span></td><th class="w1">백엔드 (백그라운드)</th><td><code>PSA_AllLoadCases.exe</code> 를 subprocess 로 실행. 프론트는 1.5초마다 상태를 폴링</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note">\r
        <span class="lbl">단계 사이의 의존</span>\r
        <p>\r
          ② 가 만드는 <strong>결과 CSV 가 ⑤ 의 유일한 입력</strong>입니다. 내관 규격이나 U-Bolt 간격을\r
          바꾸려면 ② 로 돌아가 다시 생성해야 하고, 그러면 ⑤~⑧ 을 전부 다시 돌려야 합니다.\r
          반대로 ④ 의 Load Case 선택만 바꾸는 것은 ② 결과를 그대로 재사용할 수 있습니다.\r
        </p>\r
      </div>\r
    </section>\r
\r
    <!-- ══ 1단계 ════════════════════════════════════════════ -->\r
    <section id="s1" class="stage" data-sev="neut">\r
      <header>\r
        <span class="num" aria-hidden="true">01</span>\r
        <h2>입력 준비 <a class="anchor" href="#s1" aria-label="1단계로 가는 링크">#</a></h2>\r
        <span class="chip neut">사용자 입력</span>\r
        <span class="chip brand">Tab 1</span>\r
        <span class="where"><b>화면</b> pages/analysis/DoublePipeFuelLineAssessment.jsx</span>\r
      </header>\r
\r
      <p class="aim">외관 배관 CSV 를 올리고, 만들어질 내관의 규격과 해석에 쓸 설계조건을 정합니다.</p>\r
\r
      <h4>업로드 제약</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">항목</th><th>기준</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1">확장자</th><td><code>.csv</code> 만 허용합니다. 다른 확장자는 400 으로 거부됩니다.</td></tr>\r
            <tr><th class="w1">크기</th><td><span class="val">25 MB</span> 이하. 초과하면 413 입니다.</td></tr>\r
            <tr><th class="w1">내용</th><td>빈 파일은 거부합니다. 컬럼 규격은 <a href="#csv">입력 CSV 규격</a> 참조.</td></tr>\r
            <tr><th class="w1">파일명</th><td>경로 구분자가 섞인 이름은 거부합니다(디렉터리 탈출 차단).</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h4>입력 항목</h4>\r
      <p>왼쪽 사이드바에서 받는 값은 두 묶음입니다. 앞의 4개는 <strong>내관을 어떻게 만들지</strong>,\r
        뒤의 12개는 <strong>해석을 어떤 조건으로 돌릴지</strong>를 정합니다.</p>\r
\r
      <div class="tw">\r
        <table class="dense">\r
          <thead><tr><th class="w1">항목</th><th class="w1">기본값</th><th>쓰이는 곳</th></tr></thead>\r
          <tbody>\r
            <tr class="grp"><th colspan="3">내관 · 지지</th></tr>\r
            <tr><th class="w1">Out. Diameter</th><td class="w1"><span class="val">114.3 mm</span></td><td>내관 외경. ② 에서 표준 규격으로 스냅됩니다</td></tr>\r
            <tr><th class="w1">Thickness</th><td class="w1"><span class="val">3.05 mm</span></td><td>내관 두께. 스냅되어 Schedule(<code>10s</code>/<code>40s</code>/<code>80s</code>)로 확정</td></tr>\r
            <tr><th class="w1">Bend Radius</th><td class="w1"><span class="val">152.4 mm</span></td><td>내관 ELBO 곡률 반경</td></tr>\r
            <tr><th class="w1">Support Stiffness</th><td class="w1"><span class="val">1.75&times;10¹² N/mm</span></td><td>U-Bolt 지지 강성. <strong>이 값이 U-Bolt 배치 간격까지 바꿉니다</strong> — <a href="#s2">② 참조</a></td></tr>\r
\r
            <tr class="grp"><th colspan="3">설계 조건</th></tr>\r
            <tr><th class="w1">Design Pressure</th><td class="w1"><span class="val">15.3 barG</span></td><td>압력 항. 미리보기 응력에도 즉시 반영</td></tr>\r
            <tr><th class="w1">Design / Initial Temp.</th><td class="w1"><span class="val">60 / 45 &deg;C</span></td><td>열팽창과 재료 허용응력 보간의 기준 온도</td></tr>\r
            <tr><th class="w1">Fluid Density</th><td class="w1"><span class="val">0.0</span></td><td>유체 자중</td></tr>\r
            <tr><th class="w1">Friction Factor</th><td class="w1"><span class="val">0.15</span></td><td>마찰 지지 스프링 강성 갱신에 쓰입니다(⑥)</td></tr>\r
\r
            <tr class="grp"><th colspan="3">가속도 · 선체 처짐 · 계절</th></tr>\r
            <tr><th class="w1">Acc. Ux / Uy / Uz</th><td class="w1"><span class="val">0.09 / 0.68 / 0.45 g</span></td><td>지진 하중 U1·U2·U3</td></tr>\r
            <tr><th class="w1">Hogg / Sagg</th><td class="w1"><span class="val">0.44 / &minus;0.34</span></td><td>선체 처짐 변위 D1·D2</td></tr>\r
            <tr><th class="w1">Summer / Winter</th><td class="w1"><span class="val">45 / &minus;18 &deg;C</span></td><td>온도 하중 T1·T2</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note">\r
        <span class="lbl">화면에 없는 값</span>\r
        <p>\r
          U-Bolt 질량 <span class="val">0.2485 kg</span> 은 입력 필드로 노출하지 않고 내부 기본값을 씁니다.\r
          바꿔야 한다면 <code>inner_pipe_config.json</code> 의 <code>ubolt.mass</code> 를 고쳐야 하는데,\r
          현재 화면에서는 그 값을 덮어쓸 방법이 없습니다.\r
        </p>\r
      </div>\r
\r
      <h4>배관 정보 미리보기 — 오른쪽 패널</h4>\r
      <p>\r
        외경·두께·설계압력을 입력하는 즉시 오른쪽에 단면 물성과 응력이 다시 계산됩니다.\r
        <strong>이것은 브라우저 안의 참고 계산이지 해석 결과가 아닙니다.</strong>\r
        여기 값이 커 보인다고 해석이 실패하는 것도, 작다고 통과가 보장되는 것도 아닙니다.\r
      </p>\r
      <div class="eq">d  = D &minus; 2t                       Inner Diameter   [mm]\r
A  = &pi;/4  &middot; (D&sup2; &minus; d&sup2;)               Area             [mm&sup2;]\r
I  = &pi;/64 &middot; (D&#8308; &minus; d&#8308;)               Moment of Inertia[mm&#8308;]\r
Z  = I / (D/2)                    Section Modulus  [mm&sup3;]\r
\r
P  = Design Pressure &times; 0.1       barG &rarr; MPa\r
Sh = P &middot; D / (2t)                 Hoop Stress      [MPa]\r
Sa = P &middot; d&sup2; / (D&sup2; &minus; d&sup2;)          Axial Stress     [MPa]</div>\r
      <p>\r
        설계압력을 비워두면 <code>d · A · I · Z</code> 만 표시되고 Hoop/Axial 응력 칸은 비어 있습니다.\r
        형상만으로는 응력을 낼 수 없기 때문입니다.\r
      </p>\r
\r
      <div class="fix">\r
        <h4>막히면</h4>\r
        <p>\r
          &ldquo;실행&rdquo; 버튼이 눌리지 않으면 CSV 를 아직 올리지 않은 것입니다. 업로드가 400 으로\r
          거부되면 확장자와 파일명을, 413 이면 파일 크기를 확인하세요.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <span></span>\r
        <a href="#s2">다음 · 2단계 내관 자동 생성 &rarr;</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 2단계 ════════════════════════════════════════════ -->\r
    <section id="s2" class="stage" data-sev="neut">\r
      <header>\r
        <span class="num" aria-hidden="true">02</span>\r
        <h2>내관 자동 생성 <a class="anchor" href="#s2" aria-label="2단계로 가는 링크">#</a></h2>\r
        <span class="chip brand">자동 · 수 초</span>\r
        <span class="where"><b>API</b> POST /api/doublepipe/inner-pipe-preview<br>\r
          <b>서비스</b> services/doublepipe_service.py &rarr; run_inner_pipe_preview()<br>\r
          <b>엔진</b> InHouseProgram/DoublePipe/Converting CSV/inner_pipe_transform.py (원본: append_offset.py)</span>\r
      </header>\r
\r
      <p class="aim">외관만 있는 CSV 에 내관 부재와 U-Bolt 지지를 만들어 붙여, 해석에 바로 넣을 수 있는 이중관 CSV 를 만듭니다.</p>\r
\r
      <p>\r
        내부적으로 아홉 가지 일이 순서대로 일어납니다. 화면 하단 콘솔에 각 단계의 로그가 그대로 흘러가므로,\r
        결과가 이상하면 <strong>콘솔에서 어느 줄이 경고를 냈는지</strong>부터 보는 것이 빠릅니다.\r
      </p>\r
\r
      <h4>① 규격 스냅 — 입력값을 표준 배관 규격으로 맞춥니다</h4>\r
      <p>\r
        입력한 외경·두께는 그대로 쓰이지 않습니다. 13개 표준 외경 &times; 3개 Schedule\r
        (<code>10s</code> / <code>40s</code> / <code>80s</code>) 표에서 <strong>가장 가까운 규격</strong>으로\r
        스냅됩니다. 기본값 <span class="val">114.3 / 3.05</span> 는 <span class="val">114.3mm / 10s / 3.05mm</span> 로 확정됩니다.\r
      </p>\r
      <div class="eq">[내관 규격] 입력(114.3mm / 3.05mm) -&gt; Pipe_Dim 114.3mm / 10s / 3.05mm</div>\r
      <p>\r
        표준 외경 13종 [mm] —\r
        <span class="val">21.3</span> · <span class="val">26.7</span> · <span class="val">33.4</span> ·\r
        <span class="val">42.2</span> · <span class="val">48.3</span> · <span class="val">60.3</span> ·\r
        <span class="val">73.0</span> · <span class="val">88.9</span> · <span class="val">101.6</span> ·\r
        <span class="val">114.3</span> · <span class="val">141.3</span> · <span class="val">168.3</span> ·\r
        <span class="val">219.1</span>\r
      </p>\r
\r
      <h4>② 규격 격차 유지 — 외관이 굵어지면 내관도 따라 굵어집니다</h4>\r
      <p>\r
        배관 전체가 한 가지 굵기인 경우는 드뭅니다. 그래서 <strong>첫 배관 부재의 외관 규격과 내관 규격의\r
        단계 차이(gap)를 계산해 두고, 각 부재마다 그 외관 규격에서 gap 단계만큼 내린 규격</strong>을 내관에 씁니다.\r
      </p>\r
      <div class="eq">[규격 격차] 외관 168.3mm(idx=11) - 내관 114.3mm(idx=9) = 2단계\r
   &rarr; 외관 219.1mm 구간의 내관은 141.3mm (idx 12-2=10)</div>\r
      <ul>\r
        <li>내려간 결과가 표 범위를 벗어나면 <strong>최소 규격</strong>으로 두고 경고를 냅니다.</li>\r
        <li>내관 규격이 외관 이상이 되면 한 단계 더 내립니다. 그래도 불가능하면 <code>[오류]</code> 를 남기고 진행합니다.</li>\r
      </ul>\r
\r
      <h4>③ Y &minus;15000mm 오프셋 복제</h4>\r
      <p>\r
        <code>TUBI / ELBO / TEE / REDU / FLAN</code> 부재를 복제해 <strong>Y축으로 &minus;15000mm 이동</strong>시킨\r
        것이 내관입니다. 좌표(<code>pos·apos·lpos</code>), 중간점(<code>interPos·p3Pos</code>),\r
        체적 상자(<code>wvol</code>)가 모두 함께 옮겨집니다.\r
      </p>\r
      <div class="note caution">\r
        <span class="lbl">하드코딩된 설계 계약</span>\r
        <p>\r
          <strong>&minus;15000mm 은 고정값</strong>입니다. 내관과 외관이 화면에서 겹쳐 보이지 않도록\r
          떼어 놓은 것이고, 이후 <code>TIE</code> 연결도 이 간격을 전제로 동작합니다.\r
          입력 CSV 가 이미 이 간격을 쓰고 있지 않다면 내외관 연결이 깨집니다.\r
        </p>\r
      </div>\r
\r
      <h4>④ 원본 타입 정규화 — 해석기가 모르는 부재를 바꿉니다</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">원래 타입</th><th class="w1">바뀌는 타입</th><th>처리</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1"><code>FLAN</code></th><td class="w1"><code>TUBI</code></td><td>플랜지를 직관으로 취급합니다</td></tr>\r
            <tr><th class="w1"><code>TEE</code></th><td class="w1"><code>TUBI</code></td><td>세 번째 분기점(<code>p3Pos</code>)과 보조 단면(<code>outDia2/thick2</code>)을 지웁니다</td></tr>\r
            <tr><th class="w1"><code>REDU</code></th><td class="w1"><code>TUBI</code></td><td>양단 외경·두께의 <strong>산술 평균</strong>을 가진 등단면 직관으로 바꿉니다</td></tr>\r
            <tr><th class="w1"><code>OLET</code></th><td class="w1">제거</td><td>⑤ 의 FEM 모델 생성에서 <code>is_OLET=False</code> 로 빠집니다</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h4>⑤ U-Bolt 자동 배치 — 이 단계의 핵심</h4>\r
      <p>\r
        내관을 외관 안에 붙들어 두는 U-Bolt 를 직관 구간마다 자동으로 놓습니다.\r
        규칙은 <strong>ELBO 가 양 끝에 있는지</strong>와 <strong>구간이 얼마나 긴지</strong>로 갈립니다.\r
      </p>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">구간 조건</th><th>배치</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1">양끝 ELBO · 길이 &le; 400mm</th><td>구간 <strong>중앙에 1개</strong>만 놓습니다</td></tr>\r
            <tr><th class="w1">한쪽 ELBO · 길이 &gt; 1000mm</th><td>ELBO 쪽에서 <strong>NEAR 거리</strong>에 필수 1개를 놓고, 거기서부터 반대쪽까지 간격 패턴으로 채웁니다</td></tr>\r
            <tr><th class="w1">그 외</th><td>ELBO 가 붙은 끝마다 필수 1개 + 그 사이를 간격 패턴으로 채웁니다</td></tr>\r
            <tr><th class="w1">먼 구간 사이 공백</th><td>공백이 <strong>중간점 상한</strong> 이하면 중간에 1개, 넘으면 <strong>채움 간격</strong>으로 분할합니다</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
      <p>간격 패턴은 두 값을 번갈아 씁니다(예 900 &rarr; 1100 &rarr; 900 &rarr; …). 10mm 이내로 겹친 점은 하나로 합칩니다.</p>\r
\r
      <div class="note caution">\r
        <span class="lbl">Support Stiffness 가 배치를 바꿉니다</span>\r
        <p>\r
          ① 에서 입력한 <strong>Support Stiffness 가 <span class="val">1&times;10¹⁰ N/mm</span> 이상이면\r
          U-Bolt 배치 상수 4개가 통째로 다른 세트로 바뀝니다.</strong> 강성이 크면 지지 하나가 더 많은\r
          하중을 받아낼 수 있다는 전제로 간격을 벌리는 것인데, 화면에는 &lsquo;강성&rsquo;이라고만 쓰여 있어\r
          여기까지 영향이 간다는 것이 드러나지 않습니다. 기본값 <span class="val">1.75&times;10¹²</span> 는\r
          이미 넓은 간격 세트에 해당합니다.\r
        </p>\r
      </div>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">상수</th><th class="c w1">Stiff &lt; 1e10</th><th class="c w1">Stiff &ge; 1e10</th><th>뜻</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1">NEAR</th><td class="c w1"><span class="val">150 mm</span></td><td class="c w1"><span class="val">300 mm</span></td><td>ELBO 로부터 필수 U-Bolt 까지의 거리</td></tr>\r
            <tr><th class="w1">SPACING</th><td class="c w1"><span class="val">900 / 1100</span></td><td class="c w1"><span class="val">1500 / 1600</span></td><td>직관 구간 반복 간격(mm, 번갈아)</td></tr>\r
            <tr><th class="w1">GAP 중간점 상한</th><td class="c w1"><span class="val">2000 mm</span></td><td class="c w1"><span class="val">3000 mm</span></td><td>이하면 공백 중앙에 1개</td></tr>\r
            <tr><th class="w1">GAP 채움 간격</th><td class="c w1"><span class="val">1000 mm</span></td><td class="c w1"><span class="val">1500 mm</span></td><td>상한 초과 시 이 간격으로 분할</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h4>⑥ 구속 방향(rest) 자동 결정</h4>\r
      <p>\r
        U-Bolt 는 배관을 감싸는 클램프이므로 <strong>배관 축 방향으로는 미끄러지고 나머지 두 방향만 잡습니다</strong>.\r
        배관의 진행 방향에서 성분이 가장 큰 축을 축 방향으로 보고, 나머지 두 축 번호를 <code>rest</code> 코드로 씁니다.\r
      </p>\r
      <div class="eq">X 방향 배관  &rarr;  rest = 23        (Y·Z 구속, X 자유)\r
Y 방향 배관  &rarr;  rest = 13\r
Z 방향 배관  &rarr;  rest = 12</div>\r
\r
      <h4>⑦ Fixed U-Bolt — 긴 직선 구간은 한 점을 완전 고정</h4>\r
      <p>\r
        <code>ELBO &rarr; 직선 TUBI 체인 &rarr; ELBO</code> 형태이면서 체인 전체 길이가\r
        <span class="val">5,000 mm</span> 를 넘으면, <strong>그 체인의 중앙에 가장 가까운 U-Bolt 하나를\r
        6자유도 완전 구속(<code>rest = 123456</code>)</strong>으로 바꾸고 브랜치 이름 뒤에 <code>-TIE</code> 를 붙입니다.\r
        긴 직선 구간이 열팽창으로 통째로 밀려나지 않도록 앵커를 하나 심는 것입니다.\r
      </p>\r
      <div class="eq">[Fixed UBOLT] 체인 길이=8420mm -&gt; rest=123456, bran=FL-01-TIE @ X ... Y ... Z ...</div>\r
\r
      <h4>⑧ 외관 지지점 충돌 회피</h4>\r
      <p>\r
        새로 놓은 내관 U-Bolt 가 외관의 <code>UBOLT</code>/<code>ATTA</code> 지지점과\r
        <span class="val">100 mm</span> 이내로 겹치면, 배관 축 방향으로 <span class="val">100 mm</span> 옮깁니다.\r
        같은 자리에 지지가 겹치면 실제로 시공이 안 되기 때문입니다. 이동한 항목은 콘솔에\r
        <code>[UBOLT 충돌 회피]</code> 로 남습니다. 방향을 판정하지 못한 경우는\r
        <code>[경고] … 충돌 회피 스킵</code> 이 뜨므로 도면에서 직접 확인해야 합니다.\r
      </p>\r
\r
      <h4>⑨ 연결성 검사 — 떠 있는 부재 제거</h4>\r
      <p>\r
        양 끝(<code>apos</code>·<code>lpos</code>) 어느 쪽도 다른 배관 부재와 만나지 않는 부재\r
        (허용 오차 <span class="val">5 mm</span>)는 <strong>고립된 것으로 보고 제거</strong>합니다.\r
        원본과 내관 양쪽에서 각각 수행하고, 제거한 부재 목록을 콘솔에 표로 출력합니다.\r
        해석 요소 수가 예상보다 적으면 이 로그부터 확인하세요.\r
      </p>\r
\r
      <h4>산출물</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">파일</th><th>설명</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1"><code>&lt;원본이름&gt;_Y-15000.csv</code></th><td>내관이 붙은 결과 CSV. ⑤ 의 입력이 됩니다</td></tr>\r
            <tr><th class="w1"><code>inner_pipe_config.json</code></th><td>이번에 쓴 입력값. 도면 PDF 를 나중에 다시 뽑을 때 재사용합니다</td></tr>\r
            <tr><th class="w1"><code>&lt;원본이름&gt;_Y-15000.pdf</code></th><td>배치·치수 도면. <strong>버튼을 눌렀을 때만</strong> 생성합니다(온디맨드)</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
      <p>\r
        모두 서버의 작업 폴더 <code>userConnection/{시각}_{사번}_DoublePipeFuelLine/</code> 에 저장됩니다.\r
        결과 표는 화면에서 바로 확인할 수 있고, CSV 는 내려받을 수 있습니다.\r
      </p>\r
\r
      <div class="note dev">\r
        <span class="lbl">개발자 노트 · 도면 PDF 를 분리한 이유</span>\r
        <p>\r
          미리보기는 <strong>matplotlib 을 import 하지 않는 빠른 경로</strong>로 돌아갑니다.\r
          도면 PDF 만 별도 요청으로 빼서, 가능하면 <code>InnerPipeTransform.exe</code>\r
          (pandas·numpy·matplotlib 번들, PyInstaller onefile)를 subprocess 로 돌립니다.\r
          운영 서버의 파이썬 환경에 matplotlib 을 깔지 않아도 되게 하려는 것입니다. exe 가 없으면\r
          in-process 모듈로 폴백합니다. <strong>onedir 이 아니라 onefile 인 이유</strong>는 회사 DRM 이\r
          <code>base_library.zip</code> 을 at-rest 암호화해 onedir 빌드가 기동조차 못 하기 때문입니다.\r
        </p>\r
      </div>\r
\r
      <div class="fix">\r
        <h4>실패하면</h4>\r
        <p>\r
          변환 실패는 500 으로 &ldquo;CSV 형식과 입력값을 확인하세요&rdquo; 가 뜹니다. 대부분\r
          <strong>컬럼 순서가 규격과 다르거나</strong>(이름이 아니라 <em>위치</em>로 읽습니다),\r
          좌표 문자열 포맷이 <code>X 1000mm Y 0mm Z 500mm</code> 형태가 아닌 경우입니다.\r
          <a href="#csv">입력 CSV 규격</a>을 확인하세요.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s1">&larr; 이전 · 1단계 입력 준비</a>\r
        <a href="#s3">다음 · 3단계 해석 입력 확정 &rarr;</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 3단계 ════════════════════════════════════════════ -->\r
    <section id="s3" class="stage" data-sev="neut">\r
      <header>\r
        <span class="num" aria-hidden="true">03</span>\r
        <h2>해석 입력 확정 <a class="anchor" href="#s3" aria-label="3단계로 가는 링크">#</a></h2>\r
        <span class="chip neut">사용자 입력</span>\r
        <span class="chip brand">Tab 2</span>\r
        <span class="where"><b>뷰어</b> components/analysis/DoublePipeViewer.jsx (three.js)</span>\r
      </header>\r
\r
      <p class="aim">해석에 넣을 이중관 CSV 를 확정하고, 3D 뷰어로 모델이 의도대로 만들어졌는지 눈으로 확인합니다.</p>\r
\r
      <h4>입력을 넣는 두 경로</h4>\r
      <div class="split">\r
        <div>\r
          <h4>Tab 1 결과 전달</h4>\r
          <ul>\r
            <li>Tab 1 결과 화면의 &ldquo;전달&rdquo; 버튼</li>\r
            <li>파일은 이미 서버 작업 폴더에 있으므로 <strong>업로드가 다시 일어나지 않습니다</strong></li>\r
            <li>해석은 그 폴더를 그대로 작업 폴더로 씁니다</li>\r
          </ul>\r
        </div>\r
        <div>\r
          <h4>CSV 직접 업로드</h4>\r
          <ul>\r
            <li>Tab 2 에서 이중관 CSV 를 바로 올립니다</li>\r
            <li>브라우저가 먼저 파싱해 3D 로 보여주고, <strong>해석을 시작할 때 서버로 전송</strong>합니다</li>\r
            <li>서버가 <strong>새 작업 폴더</strong>를 만들어 저장합니다</li>\r
          </ul>\r
        </div>\r
      </div>\r
\r
      <h4>3D 뷰어가 보여주는 것</h4>\r
      <p>\r
        CSV 의 좌표 문자열을 클라이언트에서 파싱해 그립니다. 해석 파이프라인과 <strong>같은 컬럼 규칙</strong>을\r
        쓰되, 표현을 위해 외경이 가장 큰 부재군을 외관, 가장 작은 부재군을 내관으로 나누고\r
        <code>UBOLT</code> 는 클램프 형태로 그립니다.\r
      </p>\r
      <ul>\r
        <li>내관이 외관에서 <strong>Y 방향으로 멀찍이 떨어져</strong> 보이는 것이 정상입니다(&minus;15000mm 오프셋).</li>\r
        <li>U-Bolt 가 한쪽에만 몰려 있거나 긴 구간에 하나도 없으면 ② 의 배치가 의도와 다른 것입니다.</li>\r
        <li>배관 일부가 뚝 끊겨 보이면 ⑨ 연결성 검사에서 제거된 부재일 수 있습니다.</li>\r
      </ul>\r
\r
      <div class="note">\r
        <span class="lbl">여기가 마지막 확인 지점입니다</span>\r
        <p>\r
          ④ 에서 실행을 누르는 순간부터는 되돌릴 수 없고, 중간에 모델만 고칠 수도 없습니다.\r
          <strong>모델이 이상해 보이면 지금 ② 로 돌아가세요.</strong> 잘못된 모델로 두 시간을 돌린 뒤\r
          알게 되는 것이 이 앱에서 가장 비싼 실수입니다.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s2">&larr; 이전 · 2단계 내관 자동 생성</a>\r
        <a href="#s4">다음 · 4단계 Load Case 선택 &rarr;</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 4단계 ════════════════════════════════════════════ -->\r
    <section id="s4" class="stage" data-sev="neut">\r
      <header>\r
        <span class="num" aria-hidden="true">04</span>\r
        <h2>Load Case 선택 <a class="anchor" href="#s4" aria-label="4단계로 가는 링크">#</a></h2>\r
        <span class="chip neut">사용자 입력</span>\r
        <span class="where"><b>API</b> POST /api/doublepipe/run-psa · run-psa-upload<br>\r
          <b>서비스</b> services/doublepipe_psa_service.py</span>\r
      </header>\r
\r
      <p class="aim">29개 하중조합 전부를 돌릴지, 필요한 것만 고를지 정하고 해석을 시작합니다.</p>\r
\r
      <h4>하중조합 29개</h4>\r
      <div class="tw">\r
        <table class="dense">\r
          <thead><tr><th class="w1">구간</th><th class="w1">타입</th><th class="w1">개수</th><th>구성</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1"><span class="val">L1&ndash;L16</span></th><td class="w1"><code>OPE</code> 운전</td><td class="w1"><span class="val">16</span></td><td>자중 + 압력 + 온도(T1/T2) + 변위(D1/D2) &plusmn; 지진(U1/U2/U3)</td></tr>\r
            <tr><th class="w1"><span class="val">L17</span></th><td class="w1"><code>SUS</code> 지속</td><td class="w1"><span class="val">1</span></td><td>자중 + 압력. <strong>항상 자동 포함</strong></td></tr>\r
            <tr><th class="w1"><span class="val">L18&ndash;L23</span></th><td class="w1"><code>OCC</code> 우발</td><td class="w1"><span class="val">6</span></td><td>자중 + 압력 + 지진 + 변위</td></tr>\r
            <tr><th class="w1"><span class="val">L24&ndash;L29</span></th><td class="w1"><code>EXP</code> 팽창</td><td class="w1"><span class="val">6</span></td><td>온도 + 변위 조합</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note caution">\r
        <span class="lbl">L17 은 끌 수 없습니다</span>\r
        <p>\r
          <strong>L17(SUS)은 EXP 하중조합의 허용치를 계산하는 선행조건</strong>입니다\r
          (<code>1.25(Sc+Sh) &minus; SUS 코드응력</code> — <a href="#s7">⑦ 참조</a>).\r
          그래서 선택 모드에서 L17 은 체크가 잠겨 있고, L20 하나만 골라도 내부적으로는\r
          <strong>L17 &rarr; L20 순서</strong>로 두 개가 돌아갑니다. 화면 · 백엔드 · 엔진 세 곳 모두 같은 규칙을 적용합니다.\r
        </p>\r
      </div>\r
\r
      <h4>전체와 선택의 차이</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">항목</th><th>전체 (기본)</th><th>선택</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1">해석 개수</th><td>29개</td><td>고른 개수 + L17</td></tr>\r
            <tr><th class="w1">Abaqus job</th><td>최대 <span class="val">87회</span> (29 &times; 3회전)</td><td>(선택수+1) &times; 3회전</td></tr>\r
            <tr><th class="w1">INP 파일</th><td colspan="2"><strong>어느 쪽이든 29개 전부 생성됩니다.</strong> 하중조합 사이 참조 정합을 유지해야 하기 때문입니다</td></tr>\r
            <tr><th class="w1">보고서</th><td>모든 행이 채워집니다</td><td><strong>해석한 것만 채워지고 나머지는 빈칸</strong>으로 남습니다</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h4>시작할 때 서버가 확인하는 것</h4>\r
      <ol class="steps">\r
        <li><strong>Abaqus 라이센스가 비어 있는가</strong> — 다른 사람이 돌리는 중이면 409 로 즉시 거부합니다(<a href="#lock">라이센스 참조</a>).</li>\r
        <li><strong>Load Case 표기가 유효한가</strong> — <code>L1</code>~<code>L29</code> 범위를 벗어나면 400 입니다. 중복은 제거하되 순서는 보존합니다.</li>\r
        <li><strong>입력 CSV 가 실제로 있는가</strong> — 작업 폴더 밖을 가리키는 경로는 거부합니다.</li>\r
        <li><strong>해석 실행파일이 있는가</strong> — <code>PSA_AllLoadCases.exe</code> 가 없으면 503 입니다.</li>\r
      </ol>\r
      <p>\r
        네 가지를 통과하면 작업이 등록되고 백그라운드 스레드가 뜹니다. 응답으로 <code>jobId</code> 를 받고,\r
        화면은 그때부터 <strong>1.5초마다 상태를 물어보며 콘솔에 로그를 흘립니다.</strong>\r
      </p>\r
\r
      <div class="fix">\r
        <h4>&ldquo;All licenses are currently occupied&rdquo; 가 뜨면</h4>\r
        <p>\r
          다른 사용자의 해석이 Abaqus 라이센스를 점유 중입니다. 페이지가 잠기고 경과 시간이 표시되며,\r
          <strong>3초마다 자동으로 해제를 확인</strong>합니다. 풀리면 알림이 뜨니 기다리면 됩니다.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s3">&larr; 이전 · 3단계 해석 입력 확정</a>\r
        <a href="#s5">다음 · 5단계 FEM 모델 생성 &rarr;</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 5단계 ════════════════════════════════════════════ -->\r
    <section id="s5" class="stage" data-sev="fail">\r
      <header>\r
        <span class="num" aria-hidden="true">05</span>\r
        <h2>FEM 모델 생성 <a class="anchor" href="#s5" aria-label="5단계로 가는 링크">#</a></h2>\r
        <span class="chip brand">자동</span>\r
        <span class="chip fail">실패 시 전체 중단</span>\r
        <span class="where"><b>엔진</b> Piping Stress Analysis for all load cases/Main.py &rarr; AbaqusModelCreator<br>\r
          <b>메시</b> AbaqusModelCreatorPKG/ (PipeEditiorCSV · ModelAlgorithm · ExportINP · BDF_Export)</span>\r
      </header>\r
\r
      <p class="aim">CSV 를 유한요소 모델로 바꿔 Abaqus 입력 파일과 Nastran 시각화 파일을 씁니다. 여기서부터 실행파일 하나가 끝까지 진행합니다.</p>\r
\r
      <h4>하는 일</h4>\r
      <ol class="steps">\r
        <li><strong>CSV 파싱</strong> — 32개 컬럼을 위치로 읽어 노드 · 요소 · 물성으로 바꿉니다.</li>\r
        <li><strong>이중관 메시 구성</strong> — DFS 로 배관을 따라가며 내관과 외관을 잇는 요소망을 만듭니다.</li>\r
        <li><strong>Abaqus <code>.inp</code> 작성</strong> — 이 시점에 <strong>29개 하중조합이 전부</strong> INP 안에 기록됩니다.</li>\r
        <li><strong>Nastran <code>.bdf</code> 작성</strong> — HyperMesh 등에서 형상을 확인하기 위한 파일입니다. <strong>해석에는 쓰이지 않습니다.</strong></li>\r
      </ol>\r
\r
      <div class="note dev">\r
        <span class="lbl">개발자 노트 · 작업 폴더가 곧 출력 폴더</span>\r
        <p>\r
          엔진 내부의 <code>write_LC()</code> · <code>make_report()</code> · <code>F06Format</code> 이\r
          <strong>전부 현재 작업 디렉터리 기준 상대경로</strong>로 파일을 읽고 씁니다. 그래서 백엔드는\r
          <strong>실행 디렉터리를 CSV 가 있는 작업 폴더로 지정</strong>하고 CSV 는 절대경로로 넘깁니다.\r
          프로그램 폴더를 작업 디렉터리로 쓰면 여러 사용자의 산출물이 서로 덮어써지고, 보고서 생성이\r
          중간 결과 파일을 못 찾아 빈 보고서가 나옵니다. 엔진 쪽에서도 <code>os.chdir()</code> 를 쓰지 않도록\r
          <code>Main.py</code> 상단에 경고가 박혀 있습니다.\r
        </p>\r
      </div>\r
\r
      <p>\r
        모든 산출물(<code>.inp</code> · <code>.bdf</code> · <code>.dat</code> · <code>.txt</code> ·\r
        <code>.xlsx</code> · <code>.f06</code>)이 이 한 폴더에 쌓입니다. 별도의 출력 경로 설정은 없습니다.\r
      </p>\r
\r
      <div class="fix">\r
        <h4>실패하면</h4>\r
        <p>\r
          이 단계의 실패는 대부분 <strong>CSV 데이터 문제</strong>입니다 — 좌표가 비었거나, 요소가 서로 이어지지\r
          않거나, 재료 이름이 알 수 없는 값인 경우입니다. 프로세스가 0 이 아닌 코드로 끝나고 이후 단계는\r
          진행되지 않습니다. 콘솔의 파이썬 예외 메시지를 확인하세요.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s4">&larr; 이전 · 4단계 Load Case 선택</a>\r
        <a href="#s6">다음 · 6단계 Abaqus 3회전 &rarr;</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 6단계 ════════════════════════════════════════════ -->\r
    <section id="s6" class="stage" data-sev="fail">\r
      <header>\r
        <span class="num" aria-hidden="true">06</span>\r
        <h2>Abaqus 해석 3회전 <a class="anchor" href="#s6" aria-label="6단계로 가는 링크">#</a></h2>\r
        <span class="chip brand">자동 · 가장 오래 걸림</span>\r
        <span class="chip fail">실패 시 전체 중단</span>\r
        <span class="where"><b>오케스트레이션</b> Head_for_FuelLine_ASME_B313_v2018.py &rarr; HeadClass_01.Abaqus_Run()<br>\r
          <b>마찰 갱신</b> FuelLine_Making_FricINP.py (Non_fric_inp_parse · ModifyINP · Fric_inp_parse)</span>\r
      </header>\r
\r
      <p class="aim">하중조합마다 Abaqus 를 세 번 돌립니다. 마찰 지지의 강성을 결과로부터 다시 계산해 넣는 반복 과정입니다.</p>\r
\r
      <h4>왜 세 번인가</h4>\r
      <p>\r
        마찰 지지는 <strong>얼마나 미끄러지느냐에 따라 강성이 달라집니다.</strong> 그런데 얼마나 미끄러지는지는\r
        해석을 해봐야 압니다. 그래서 먼저 마찰 없이 풀어 반력을 얻고, 그 반력으로 스프링 강성을 계산해 다시\r
        풀고, 또 갱신해 한 번 더 푸는 <strong>수렴 반복</strong>을 합니다.\r
      </p>\r
      <div class="eq">1회전  비마찰 해석            &rarr;  .dat 에서 지지점 반력 추출\r
                                     K = &mu;N / |합성 슬립|\r
2회전  마찰 반복 #1 (_iter01)  &rarr;  반력 재추출 &rarr; 강성 재갱신\r
3회전  마찰 반복 #2 (_iter02)  &rarr;  최종 결과. 이후 단계는 항상 이것을 씁니다</div>\r
\r
      <h4>실행 방식</h4>\r
      <p>\r
        하중조합마다 <code>abaqus job=&lt;LC이름&gt; cpus=2 int</code> 를 <strong>순차로</strong> 실행합니다.\r
        병렬로 돌리지 않는 이유는 Abaqus 가 잠금 파일을 쓰기 때문에 같은 폴더에서 동시에 돌리면 서로 충돌하기\r
        때문입니다. 성공 판정은 출력에 <code>Analysis initiated from SIMULIA established products</code> 가 있고\r
        <code>Abaqus/Analysis exited with errors</code> 가 없는 경우입니다.\r
      </p>\r
\r
      <h4>자동 재시도 — 일시적 오류는 스스로 넘어갑니다</h4>\r
      <p>\r
        job 을 연달아 돌리면 <strong>직전 job 의 자식 프로세스가 파일 핸들을 아직 놓지 않아</strong>\r
        다음 job 이 실패하는 일이 흔합니다. 모델 오류가 아니므로 자동으로 재시도합니다.\r
      </p>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">항목</th><th>동작</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1">일시적 오류 신호</th><td><code>error 1023</code> · <code>ABAQUS/pre exited with error</code> · <code>CreateFile</code> · <code>being used by another process</code> · <code>다른 프로세스가 파일을 사용</code></td></tr>\r
            <tr><th class="w1">재시도 횟수</th><td><span class="val">최대 3회</span></td></tr>\r
            <tr><th class="w1">재시도 전 정리</th><td><code>.lck</code> · <code>.odb_f</code> · <code>*.exception</code> · <code>*.SMABulk</code> 삭제</td></tr>\r
            <tr><th class="w1">대기</th><td>일시 오류 <span class="val">10초</span> · 불완전 종료 <span class="val">5초</span> · job 사이 <span class="val">2초</span></td></tr>\r
            <tr><th class="w1">재시도해도 실패</th><td><strong>전체 파이프라인 중단.</strong> 이후 하중조합은 시도하지 않습니다</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note caution">\r
        <span class="lbl">진짜 해석 오류는 재시도하지 않습니다</span>\r
        <p>\r
          출력에 <code>Abaqus/Analysis exited with errors</code> 가 있고 일시적 오류 신호가 <em>없으면</em>\r
          모델 자체의 문제로 보고 즉시 중단합니다. 요소가 뒤틀렸거나, 구속이 부족해 강체 운동이 생겼거나,\r
          재료 물성이 비었을 때 나타납니다. <strong>Abaqus 가 낸 메시지가 콘솔 로그에 그대로 남으므로\r
          그 줄을 찾아 읽으세요.</strong>\r
        </p>\r
      </div>\r
\r
      <div class="note dev">\r
        <span class="lbl">개발자 노트 · 서버가 조용히 죽던 문제</span>\r
        <p>\r
          Abaqus 가 종료하며 콘솔 신호를 던지면, 콘솔을 공유하던 부모 프로세스(백엔드 서버)까지 함께\r
          죽는 일이 있었습니다. 그래서 자식 프로세스는 <strong>독립 콘솔 + 별도 프로세스 그룹</strong>으로 띄웁니다.\r
          또 한국어 Windows 의 <code>cmd.exe</code> 는 UTF-8 이 아닌 코드페이지로 오류 메시지를 내므로,\r
          Abaqus 출력은 <strong>로케일 기본 인코딩으로 디코딩</strong>하고 엔진의 표준 출력은 UTF-8 로 고정합니다\r
          (한글이 깨져 출력 단계에서 크래시하던 문제).\r
        </p>\r
      </div>\r
\r
      <div class="fix">\r
        <h4>얼마나 걸리나</h4>\r
        <p>\r
          배관 규모와 PC 성능에 따라 <strong>수십 분에서 수 시간</strong>입니다. 서버 제한 시간\r
          <span class="val">7,200초</span>를 넘으면 프로세스 트리가 강제 종료되고 실패로 기록됩니다.\r
          큰 모델을 전체 29개로 돌릴 계획이면 먼저 <strong>Load Case 두어 개로 시험 실행</strong>해\r
          한 개당 소요 시간을 재보는 편이 안전합니다.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s5">&larr; 이전 · 5단계 FEM 모델 생성</a>\r
        <a href="#s7">다음 · 7단계 ASME B31.3 검토 &rarr;</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 7단계 ════════════════════════════════════════════ -->\r
    <section id="s7" class="stage" data-sev="warn">\r
      <header>\r
        <span class="num" aria-hidden="true">07</span>\r
        <h2>ASME B31.3 코드 검토 <a class="anchor" href="#s7" aria-label="7단계로 가는 링크">#</a></h2>\r
        <span class="chip brand">자동</span>\r
        <span class="chip warn">과응력이면 표시</span>\r
        <span class="where"><b>엔진</b> FuelLine_ASME_Code.py &rarr; PSA.code_stress()<br>\r
          <b>재료표</b> 같은 파일 materialTest() (온도별 허용응력 · 탄성계수 · 열팽창계수)</span>\r
      </header>\r
\r
      <p class="aim">해석 결과를 요소 하나하나 훑으며 ASME B31.3-2018 허용치와 대조합니다.</p>\r
\r
      <h4>코드 응력</h4>\r
      <p>축력 · 굽힘 · 비틀림을 합성해 요소별 코드 응력을 구합니다.</p>\r
      <div class="eq">FA  = |SF1| / A  ( + 압력항 )      축응력   [MPa]\r
BM  = &radic;(SM1&sup2; + SM2&sup2;) / Z          굽힘응력 [MPa]\r
TM  = SM3 / (2Z)                   비틀림   [MPa]\r
\r
CODE = &radic;( (|FA| + BM)&sup2; + (2&middot;TM)&sup2; )</div>\r
      <p>\r
        압력항은 <code>0.1 &middot; P &middot; d&sup2; / (D&sup2; &minus; d&sup2;)</code> 로 더해집니다.\r
        다만 <strong>EXP(팽창) 하중조합에서는 압력항을 넣지 않습니다</strong> — 팽창 검토는 압력 효과를\r
        따로 보지 않기 때문입니다.\r
      </p>\r
\r
      <h4>허용치 — 하중 타입마다 다릅니다</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">타입</th><th class="w1">허용치</th><th>설명</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1"><code>SUS</code></th><td class="w1"><span class="val">Sh</span></td><td>21.1&deg;C 기준 재료 허용응력을 그대로 씁니다</td></tr>\r
            <tr><th class="w1"><code>OCC</code></th><td class="w1"><span class="val">Sh &times; 1.33</span></td><td>우발 하중은 33% 증가를 허용합니다</td></tr>\r
            <tr><th class="w1"><code>EXP</code></th><td class="w1"><span class="val">1.25(Sc + Sh) &minus; S<sub>SUS</sub></span></td><td>같은 요소·절점의 <strong>SUS 코드 응력을 빼서</strong> 남은 여유만 팽창에 씁니다. L17 이 선행되어야 하는 이유입니다</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
      <p>\r
        <code>Sc</code>·<code>Sh</code> 는 설계온도에 따라 저온측/고온측이 뒤바뀝니다. 설계온도가 21.1&deg;C\r
        이하면 그 온도에서 보간한 값이 <code>Sc</code>, 21.1&deg;C 값이 <code>Sh</code> 이고, 그보다 높으면 반대입니다.\r
      </p>\r
\r
      <h4>재료</h4>\r
      <p>\r
        지원 재료는 <code>A312_TP304</code> · <code>A312_TP304L</code> · <code>A312_TP316</code> ·\r
        <code>A312_TP316L</code> · <code>STEEL</code> 다섯 가지입니다. 각 재료마다\r
        <strong>&minus;198&deg;C ~ 538&deg;C 사이 19개 온도점</strong>의 허용응력 · 탄성계수 · 열팽창계수 · 항복강도가\r
        표로 들어 있고, 설계온도는 그 사이를 <strong>선형 보간</strong>해 씁니다.\r
        내관·외관 구분용 접미사(<code>_i</code> / <code>_o</code>)는 떼고 매칭합니다.\r
      </p>\r
      <div class="note caution">\r
        <span class="lbl">표에 없는 재료</span>\r
        <p>\r
          다섯 가지 목록에 없는 재료 이름을 만나면 <strong>허용치 계산을 건너뜁니다.</strong>\r
          해석 자체는 계속 진행되지만 그 요소의 판정은 신뢰할 수 없습니다.\r
          CSV 의 <code>material</code> 컬럼이 정확히 이 이름들과 일치하는지 확인하세요.\r
        </p>\r
      </div>\r
\r
      <h4>과응력 표시</h4>\r
      <p>\r
        어느 요소든 <code>CODE &gt; CRITERIA</code> 이면 그 하중조합 이름 뒤에 <code>*</code> 가 붙고,\r
        파이프라인 끝에서 요약으로 출력됩니다. <strong>과응력은 해석을 중단시키지 않습니다</strong> —\r
        끝까지 돌린 뒤 보고서에 담아 사람이 판단하게 합니다.\r
      </p>\r
      <div class="eq">    ASME B31.3\r
\r
L17_SUS_W+P1\r
L18_OCC_W+P1+U1+D1*        &lt;- 과응력 발생\r
L20_OCC_W+P1+U3+D1</div>\r
\r
      <div class="note dev">\r
        <span class="lbl">개발자 노트 · 앵커가 없는 모델</span>\r
        <p>\r
          변위 검토는 <code>ATTA</code> 앵커를 기준점으로 삼는데, <strong>U-Bolt 만 있는 모델에는 앵커가\r
          없습니다.</strong> U-Bolt 는 모멘트 반력을 내지 않아 앵커로 인식되지 않기 때문입니다.\r
          이때 변위비를 <span class="val">0.0</span> 으로 두고 진행합니다 — 버그가 아니라 의도된 처리이며,\r
          콘솔에 <code>[경고] ANC_Point 미설정</code> 로 남습니다. 다만 <strong>앵커 기준 상대변위 보정이\r
          적용되지 않은 결과</strong>라는 점은 알고 읽어야 합니다.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s6">&larr; 이전 · 6단계 Abaqus 3회전</a>\r
        <a href="#s8">다음 · 8단계 보고서 생성 &rarr;</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 8단계 ════════════════════════════════════════════ -->\r
    <section id="s8" class="stage" data-sev="neut">\r
      <header>\r
        <span class="num" aria-hidden="true">08</span>\r
        <h2>보고서 생성 <a class="anchor" href="#s8" aria-label="8단계로 가는 링크">#</a></h2>\r
        <span class="chip brand">자동</span>\r
        <span class="where"><b>엔진</b> FuelLine_PSA_Report.py &rarr; make_report() · FuelLine_F06Format.py<br>\r
          <b>서식</b> report_template.bin (Report for PSA.xlsx 의 DRM 회피 사본)</span>\r
      </header>\r
\r
      <p class="aim">중간 결과 텍스트를 모아 서식이 살아있는 Excel 보고서와 Nastran 형식 결과 파일을 만듭니다.</p>\r
\r
      <h4>Summary-1 시트</h4>\r
      <p>\r
        하중조합마다 <strong>코드 응력이 가장 큰 요소 하나</strong>를 뽑아 한 행에 적습니다.\r
        행 위치는 하중조합 순서로 고정되어 있어, 일부만 해석해도 나머지 행이 밀리지 않습니다.\r
      </p>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="c w1">열</th><th class="w1">항목</th><th>내용</th></tr></thead>\r
          <tbody>\r
            <tr><td class="c w1"><span class="val">E</span></td><th class="w1">Stress</th><td>그 하중조합의 최대 코드 응력 [MPa]</td></tr>\r
            <tr><td class="c w1"><span class="val">G</span></td><th class="w1">Allowable</th><td>그 요소에 적용된 허용치 [MPa]</td></tr>\r
            <tr><td class="c w1"><span class="val">I</span></td><th class="w1">Ratio</th><td><code>100 &times; Stress / Allowable</code> [%]</td></tr>\r
            <tr><td class="c w1"><span class="val">J</span></td><th class="w1">Check</th><td>Ratio 가 <span class="val">100%</span> 를 넘으면 <strong style="color:var(--fail)">Not OK</strong> (빨간 글씨)</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note caution">\r
        <span class="lbl">Summary-1 에는 L17~L29 만 나옵니다</span>\r
        <p>\r
          코드 응력 요약은 <strong>SUS · OCC · EXP 13개</strong>만 대상입니다.\r
          <strong>OPE 16개(L1~L16)는 코드 응력 행이 없습니다</strong> — 운전 하중조합은 지지 반력과\r
          유연 변형(Flex Deformation)을 보는 것이 목적이라 별도 시트로 정리됩니다.\r
          &ldquo;전체 29개를 돌렸는데 Summary 에 13줄만 있다&rdquo;는 것은 정상입니다.\r
        </p>\r
      </div>\r
\r
      <h4>산출물</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">파일</th><th>내용</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1"><code>Report for PSA.xlsx</code></th><td><strong>최종 보고서.</strong> Summary 시트 + 하중조합별 상세 시트. 화면에서 바로 내려받을 수 있습니다</td></tr>\r
            <tr><th class="w1"><code>Inforget_f06.f06</code></th><td>변위 · 응력 텍스트를 Nastran F06 형식으로 조합한 결과 파일</td></tr>\r
            <tr><th class="w1"><code>*_iter02.inp / .dat</code></th><td>최종 회전의 Abaqus 입력 · 결과</td></tr>\r
            <tr><th class="w1"><code>L*_stress.txt</code> 등</th><td>ASME 검토용 중간 텍스트. 보고서를 다시 만들 때 원본이 됩니다</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note dev">\r
        <span class="lbl">개발자 노트 · DRM 때문에 서식이 사라지던 문제</span>\r
        <p>\r
          회사 DRM 은 디스크에 쓰인 <code>.xlsx</code> 를 <strong>1~2분 안에 자동으로 암호화</strong>합니다\r
          (헤더 <code>HHIDRMC</code>, 크기 +4096바이트). 파이프라인은 최대 두 시간이 걸리고 보고서는 맨\r
          마지막에 만드는데, 그때 서식 템플릿을 디스크에서 읽으면 <strong>이미 암호화되어 압축파일로 인식되지\r
          않고</strong> 빈 워크북으로 폴백해 이미지·서식이 통째로 날아갔습니다(약 288KB 짜리 깨진 파일).\r
        </p>\r
        <p>대응은 두 겹입니다.</p>\r
        <ul>\r
          <li><strong>실행 시작 즉시 템플릿을 메모리로 읽어둡니다</strong>(<code>preload_template()</code>). 두 시간 뒤 보고서는 디스크를 다시 읽지 않고 이 메모리 원본을 채웁니다.</li>\r
          <li><strong>템플릿을 <code>.bin</code> 확장자로 보관합니다.</strong> DRM 은 Office 확장자만 건드리므로 <code>.bin</code> 은 항상 원본 그대로 읽힙니다. 백엔드가 작업 폴더로 옮길 때 <code>PK</code> 압축 서명을 검사해 유효한 것만 씁니다.</li>\r
        </ul>\r
        <p>\r
          <strong><code>report_template.bin</code> 이 프로그램 폴더에 없으면</strong> 암호화된\r
          <code>.xlsx</code> 로 폴백하고, 그러면 서식 깨짐이 재발합니다. 서버 배포 시 반드시 함께\r
          복사해야 하는 파일입니다(<a href="#parts">구성요소와 배포</a> 참조).\r
        </p>\r
      </div>\r
\r
      <h4>완료 후</h4>\r
      <p>\r
        보고서가 실제로 생성됐는지 확인한 뒤 작업을 완료 처리하고, 다른 해석 앱과 동일하게\r
        <strong>Analysis 이력에 기록</strong>합니다. 나중에 <em>My Projects</em> 에서\r
        &ldquo;이중관 구조 연료배관 해석&rdquo; 항목으로 다시 찾을 수 있습니다.\r
        Abaqus 라이센스는 이 시점에 해제됩니다.\r
      </p>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s7">&larr; 이전 · 7단계 ASME B31.3 검토</a>\r
        <a href="#lock">다음 · 라이센스 · 중단 · 재연결 &rarr;</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 라이센스 · 중단 · 재연결 ══════════════════════════ -->\r
    <section id="lock">\r
      <h2 class="head">라이센스 · 중단 · 재연결</h2>\r
      <p>\r
        이 앱의 운영상 제약은 거의 전부 <strong>Abaqus 라이센스가 하나뿐이라는 사실</strong>에서 나옵니다.\r
        서버 한 대에 라이센스 한 개이므로 <strong>해석은 전사에서 동시에 하나만</strong> 돌아갑니다.\r
      </p>\r
\r
      <div class="opt">\r
        <header>\r
          <h3>동시 실행 제한</h3>\r
          <span class="chip brand">GET /api/doublepipe/active</span>\r
        </header>\r
        <p>\r
          진행 중인 해석이 있으면 다른 사용자는 <strong>페이지가 잠기고</strong> 경과 시간만 표시됩니다.\r
          누가 돌리고 있는지는 알려주지 않습니다(관리자와 본인만 볼 수 있습니다). 잠긴 화면은\r
          <strong>3초마다 해제 여부를 확인</strong>하고, 풀리면 알림과 함께 자동으로 열립니다.\r
        </p>\r
        <p>\r
          앱의 잠금은 어디까지나 사용자 경험을 위한 것이고, <strong>최종 방어선은 Abaqus 라이센스 매니저</strong>입니다.\r
          서버가 재시작되어 앱이 점유 상태를 잊더라도 두 번째 해석은 라이센스 체크아웃에서 거부됩니다.\r
        </p>\r
      </div>\r
\r
      <div class="opt">\r
        <header>\r
          <h3>페이지를 떠나도 해석은 계속됩니다</h3>\r
          <span class="chip neut">전역 위젯</span>\r
        </header>\r
        <p>\r
          해석은 서버에서 도는 것이므로 다른 메뉴로 이동하거나 페이지를 닫아도 멈추지 않습니다.\r
          화면 우측 하단의 전역 작업 위젯이 진행 상태를 이어받아 표시합니다.\r
        </p>\r
        <ul>\r
          <li><strong>내 해석이 진행 중일 때 돌아오면</strong> — 자동으로 다시 연결되고, 서버가 보관한 로그를 처음부터 콘솔에 복원합니다.</li>\r
          <li><strong>자리를 비운 사이 끝났으면</strong> — 돌아왔을 때 완료 · 중단 · 실패 중 어느 것이었는지 알려줍니다.</li>\r
        </ul>\r
      </div>\r
\r
      <div class="opt">\r
        <header>\r
          <h3>중단</h3>\r
          <span class="chip brand">POST /api/doublepipe/run-psa/cancel</span>\r
        </header>\r
        <p>\r
          <strong>해석을 시작한 본인(과 관리자)만</strong> 중단할 수 있습니다.\r
          중단은 실행파일뿐 아니라 그 아래 Abaqus 프로세스까지 <strong>트리 전체를 종료</strong>하고,\r
          종료가 실제로 확인된 뒤에 라이센스를 해제합니다. 확인 전에 슬롯을 풀어버리면 아직 살아 있는\r
          Abaqus 가 라이센스를 쥔 채로 다음 사람이 시작해 두 해석이 충돌하기 때문입니다.\r
        </p>\r
        <p>중단된 작업도 이력에는 남습니다.</p>\r
      </div>\r
\r
      <div class="note caution">\r
        <span class="lbl">서버가 재시작되면</span>\r
        <p>\r
          작업 상태는 <strong>서버 메모리에만</strong> 있습니다. 백엔드가 재시작되면 진행 중이던 작업의\r
          상태 조회가 404 가 되고, 화면은 해석을 추적할 수 없게 됩니다.\r
          (다른 해석 앱과 공통된 구조적 한계입니다.) <strong>이미 생성된 산출물 파일은 작업 폴더에\r
          그대로 남아 있으므로</strong>, 관리자가 서버에서 직접 회수할 수 있습니다.\r
        </p>\r
      </div>\r
    </section>\r
\r
    <!-- ══ 실패 진단 ═════════════════════════════════════════ -->\r
    <section id="errors">\r
      <h2 class="head">실패 진단</h2>\r
      <p>\r
        해석이 실패하면 로그를 그대로 던지지 않고 <strong>원인을 분류해 안내 문구를 덧붙입니다.</strong>\r
        콘솔 마지막 줄의 <code>[안내]</code> 를 먼저 읽으세요.\r
      </p>\r
\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">진단</th><th class="w1">언제</th><th>무엇을 해야 하나</th></tr></thead>\r
          <tbody>\r
            <tr>\r
              <th class="w1"><code>abaqus_not_found</code></th>\r
              <td>로그에 <code>abaqus</code> 와 &ldquo;내부 또는 외부 명령&rdquo; 이 함께</td>\r
              <td class="desc">해석을 실행한 컴퓨터에 <strong>Abaqus 가 없거나 PATH 에 없습니다.</strong> 관리자에게 문의하세요. 서버가 Abaqus 등록 전에 떠 있었다면 재시작만으로 풀리기도 합니다</td>\r
            </tr>\r
            <tr>\r
              <th class="w1"><code>abaqus_solve_failed</code></th>\r
              <td>로그에 <code class="brk">Abaqus/Analysis exited with errors</code></td>\r
              <td class="desc"><strong>모델 문제입니다.</strong> 재시도를 소진했거나 일시적 오류가 아니었습니다. 로그에서 Abaqus 메시지를 찾아 읽고, ② 로 돌아가 모델을 확인하세요</td>\r
            </tr>\r
            <tr>\r
              <th class="w1"><code>solver_env_missing</code></th>\r
              <td>로그에 <code class="brk">No module named ...</code></td>\r
              <td class="desc">정상적으로는 나오지 않아야 합니다 — 파이썬 의존성은 실행파일 안에 번들되어 있습니다. <strong>실행파일이 손상되었거나 구버전</strong>일 가능성이 높으니 관리자에게 알려주세요</td>\r
            </tr>\r
            <tr>\r
              <th class="w1"><code>cancelled</code></th>\r
              <td>사용자가 중단</td>\r
              <td class="desc">정상 동작입니다. 중간 산출물은 작업 폴더에 남아 있습니다</td>\r
            </tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h4>종료 코드</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="c w1">코드</th><th>뜻</th></tr></thead>\r
          <tbody>\r
            <tr><td class="c w1"><span class="val">0</span></td><td>정상 완료. 보고서 존재 여부를 추가로 확인합니다</td></tr>\r
            <tr><td class="c w1"><span class="val">&minus;1</span></td><td>프로세스 실행 실패 또는 실행 중 예외</td></tr>\r
            <tr><td class="c w1"><span class="val">&minus;2</span></td><td>제한 시간(<span class="val">7,200초</span>) 초과로 강제 종료</td></tr>\r
            <tr><td class="c w1"><span class="val">&minus;3</span></td><td>사용자 중단</td></tr>\r
            <tr><td class="c w1">그 외</td><td>엔진이 낸 종료 코드. 콘솔의 파이썬 예외를 확인하세요</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note">\r
        <span class="lbl">진단이 없는 실패</span>\r
        <p>\r
          네 가지 어디에도 해당하지 않으면 종료 코드만 표시됩니다. 대부분 <strong>⑤ FEM 모델 생성 단계의\r
          파이썬 예외</strong>이며, CSV 데이터 문제인 경우가 많습니다.\r
        </p>\r
      </div>\r
    </section>\r
\r
    <!-- ══ 입력 CSV 규격 ═════════════════════════════════════ -->\r
    <section id="csv">\r
      <h2 class="head">입력 CSV 규격</h2>\r
      <p>\r
        기본 컬럼 19개(A~S) + 설계조건 컬럼 13개(T~AF), <strong>총 32개</strong>입니다.\r
      </p>\r
\r
      <div class="note caution">\r
        <span class="lbl">컬럼은 이름이 아니라 위치로 읽습니다</span>\r
        <p>\r
          엔진은 <code>line[0]</code>~<code>line[31]</code> 로 접근합니다.\r
          <strong>컬럼 순서가 바뀌면 헤더 이름이 맞아도 파싱이 깨집니다.</strong>\r
          열을 추가하거나 재배열하지 마세요.\r
        </p>\r
      </div>\r
\r
      <div class="tw">\r
        <table class="dense">\r
          <thead><tr><th class="c w1">인덱스</th><th class="w1">이름</th><th>설명</th></tr></thead>\r
          <tbody>\r
            <tr><td class="c w1"><span class="val">0</span></td><th class="w1">name</th><td>요소 식별자. 같은 값이면 연결된 요소로 봅니다</td></tr>\r
            <tr><td class="c w1"><span class="val">1</span></td><th class="w1">type</th><td><code>TUBI</code> · <code>ELBO</code> · <code>BEND</code> · <code>TEE</code> · <code>REDU</code> · <code>FLAN</code> · <code>UBOLT</code> · <code>ATTA</code> · <code>OLET</code></td></tr>\r
            <tr><td class="c w1"><span class="val">2 · 3 · 4</span></td><th class="w1">pos · apos · lpos</th><td>중심 · 시작 · 끝 좌표</td></tr>\r
            <tr><td class="c w1"><span class="val">5</span></td><th class="w1">bran</th><td>브랜치 이름. <code>TIE</code> 가 들어가면 내외관 연결점입니다</td></tr>\r
            <tr><td class="c w1"><span class="val">6 · 7</span></td><th class="w1">outDia · thick</th><td>외경 · 두께 [mm]</td></tr>\r
            <tr><td class="c w1"><span class="val">8</span></td><th class="w1">normal</th><td>단면 법선 벡터</td></tr>\r
            <tr><td class="c w1"><span class="val">10</span></td><th class="w1">interPos</th><td><code>ELBO</code> 중간 보조점</td></tr>\r
            <tr><td class="c w1"><span class="val">13</span></td><th class="w1">rest</th><td>구속 방향 코드 — <code>23</code> / <code>13</code> / <code>12</code> / <code>123456</code></td></tr>\r
            <tr><td class="c w1"><span class="val">18</span></td><th class="w1">material</th><td>재료 규격. <a href="#s7">⑦ 의 다섯 가지</a> 중 하나여야 허용치가 계산됩니다</td></tr>\r
            <tr><td class="c w1"><span class="val">19&ndash;31</span></td><th class="w1">설계조건 13개</th><td><code>Pref</code> · <code>DesignTemperature</code> · <code>InitialTemperature</code> · <code>FluidDensity</code> · <code>AccUX</code> · <code>AccUY</code> · <code>AccUZ</code> · <code>Hogg</code> · <code>Sagg</code> · <code>Summer</code> · <code>Winter</code> · <code>Stiff</code> · <code>FrictionFactor</code></td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h4>좌표 문자열 포맷</h4>\r
      <div class="eq">"X 1000mm Y 0mm Z 500mm"\r
\r
공백으로 나눈 뒤 홀수 위치[1, 3, 5] 에서 mm 를 떼어 숫자로 읽습니다.</div>\r
\r
      <div class="note">\r
        <span class="lbl">설계조건은 첫 행에만</span>\r
        <p>\r
          인덱스 19~31 의 설계조건 13개는 <strong>첫 데이터 행에만 값을 넣고 나머지 행은 비워둡니다.</strong>\r
          모델 전체에 하나씩 적용되는 값이기 때문입니다. Tab 1 을 거치면 화면에서 입력한 값으로\r
          자동으로 채워지므로 직접 쓸 일은 Tab 2 직접 업로드 경로뿐입니다.\r
        </p>\r
      </div>\r
    </section>\r
\r
    <!-- ══ 구성요소와 배포 ═══════════════════════════════════ -->\r
    <section id="parts">\r
      <h2 class="head">구성요소와 배포</h2>\r
      <p>\r
        이 App 은 <strong>세 덩어리</strong>로 되어 있고, 각각 배포 방식이 다릅니다.\r
        엔진을 고쳤는데 서버에서 반영이 안 된다면 거의 항상 세 번째 줄 때문입니다.\r
      </p>\r
\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">구성요소</th><th class="w1">위치</th><th class="w1">버전 관리</th><th>서버 반영</th></tr></thead>\r
          <tbody>\r
            <tr>\r
              <th class="w1">프론트엔드</th>\r
              <td><code class="brk">HiTessWorkBench/frontend/src/</code></td>\r
              <td class="w1"><span class="chip pass">git 추적</span></td>\r
              <td>Electron 앱 재빌드 · 재배포</td>\r
            </tr>\r
            <tr>\r
              <th class="w1">백엔드</th>\r
              <td><code class="brk">HiTessWorkBenchBackEnd/app/</code></td>\r
              <td class="w1"><span class="chip pass">git 추적</span></td>\r
              <td><code>git pull</code> + 백엔드 재시작</td>\r
            </tr>\r
            <tr>\r
              <th class="w1">해석 엔진</th>\r
              <td><code class="brk">HiTessWorkBenchBackEnd/InHouseProgram/DoublePipe/</code></td>\r
              <td class="w1"><span class="chip fail">git 미추적</span></td>\r
              <td><strong>수동 복사 필수.</strong> <code>git pull</code> 로 따라오지 않습니다</td>\r
            </tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note caution">\r
        <span class="lbl">가장 흔한 배포 사고</span>\r
        <p>\r
          <code>InHouseProgram/</code> 전체가 <code>.gitignore</code> 에 들어 있습니다.\r
          엔진(<code>.exe</code> · <code>.py</code>)과 서식 템플릿(<code>report_template.bin</code>)을\r
          고쳐도 <strong>커밋·푸시로는 서버에 절대 반영되지 않습니다.</strong>\r
          내 PC 에서는 잘 되는데 서버에서만 깨지는 증상의 원인이 대부분 여기입니다.\r
          엔진을 수정했다면 <strong>서버에 파일을 직접 덮어쓰고 백엔드를 재시작</strong>해야 합니다.\r
        </p>\r
      </div>\r
\r
      <h4>엔진 폴더 안에 무엇이 있나</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">경로</th><th>역할</th></tr></thead>\r
          <tbody>\r
            <tr><th><code class="brk">Converting CSV/</code></th><td><strong>② 내관 자동 생성.</strong> <code>inner_pipe_transform.py</code>(백엔드가 import) + <code>InnerPipeTransform.exe</code>(도면 PDF 렌더) + <code>append_offset.py</code>(원본 스크립트, 참고용)</td></tr>\r
            <tr><th><code class="brk">Piping Stress Analysis for all load cases/</code></th><td><strong>⑤~⑧ 해석 파이프라인.</strong> <code>PSA_AllLoadCases.exe</code> 가 실사용 실행파일이고, 같은 폴더의 <code>.py</code> 들이 그 소스입니다</td></tr>\r
            <tr><th><code class="brk">Piping Stress Analyiss for selected load cases/</code></th><td>선택 해석을 별도 폴더로 두던 <strong>이전 구조의 잔재</strong>입니다. 지금은 <code>--load-cases</code> 옵션으로 통합되어 앱에서 호출하지 않습니다</td></tr>\r
            <tr><th><code class="brk">Testing_CSV(important)/</code></th><td>회귀 확인용 입력 CSV 모음</td></tr>\r
            <tr><th><code class="brk">FuelLine for HiTESS.md</code></th><td>엔진 이식 가이드. 이 문서의 원자료입니다</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h4>서버가 갖춰야 하는 것</h4>\r
      <ol class="steps">\r
        <li><strong>Abaqus 설치 + PATH 등록</strong> — 실행파일은 파이썬 의존성만 해결합니다. Abaqus 자체를 대신하지 않습니다.\r
          자동 탐지가 흔한 설치 경로를 훑고 <code>ABAQUS_COMMANDS_DIR</code> 환경변수로도 지정할 수 있지만,\r
          <strong>PATH 에 정상 등록하는 것이 정석</strong>입니다.</li>\r
        <li><strong><code>PSA_AllLoadCases.exe</code></strong> — 없으면 해석 요청이 503 으로 거부됩니다.</li>\r
        <li><strong><code>report_template.bin</code></strong> — 없으면 보고서 서식이 깨집니다(<a href="#s8">⑧ 참조</a>).</li>\r
        <li><strong><code>inner_pipe_transform.py</code></strong> — 없으면 ② 가 503 으로 실패합니다.</li>\r
        <li><strong><code>InnerPipeTransform.exe</code></strong> — 없어도 동작하지만, 그 경우 서버 파이썬 환경에 matplotlib 이 있어야 도면 PDF 가 나옵니다.</li>\r
      </ol>\r
\r
      <h4>엔진을 수정하는 공동 개발자에게</h4>\r
      <div class="note dev">\r
        <span class="lbl">지켜야 할 계약</span>\r
        <ul>\r
          <li><strong>작업 디렉터리를 바꾸지 마세요.</strong> 엔진 곳곳이 상대경로로 파일을 읽고 씁니다. <code>os.chdir()</code> 를 넣는 순간 동시 실행이 깨집니다.</li>\r
          <li><strong>표준 출력이 곧 사용자 화면입니다.</strong> <code>print()</code> 한 줄이 그대로 콘솔에 흐르고, 실패 진단도 이 텍스트를 패턴 매칭해 분류합니다. 기존 메시지 문구를 바꾸면 <a href="#errors">진단 분류</a>가 깨질 수 있습니다.</li>\r
          <li><strong>종료 코드로 성패를 판정합니다.</strong> 실패는 반드시 0 이 아닌 코드로 끝나야 합니다. 예외를 삼키고 0 으로 끝내면 앱은 성공으로 봅니다.</li>\r
          <li><strong>같은 폴더에서 병렬 실행하지 마세요.</strong> Abaqus 잠금 파일이 충돌해 ⑥ 의 재시도 여유를 소진시킵니다.</li>\r
          <li><strong>보고서 관련 수정은 DRM 을 고려하세요.</strong> <code>.xlsx</code> 를 실행 중에 디스크에서 읽는 코드를 추가하면 <a href="#s8">⑧ 의 서식 유실</a>이 재발합니다.</li>\r
          <li><strong>Y &minus;15000mm 오프셋은 양쪽의 합의입니다.</strong> 변환 스크립트와 FEM 모델 생성이 같은 값을 전제로 동작합니다. 한쪽만 바꾸면 내외관 연결이 조용히 깨집니다.</li>\r
        </ul>\r
      </div>\r
\r
      <p>\r
        그리고 <strong>엔진 사본에는 WorkBench 에서만 얹은 수정이 들어 있습니다.</strong>\r
        새 엔진 버전을 통째로 덮어쓰면 그 수정이 사라지므로, 어떤 것이 있고 무엇을 다시 얹어야 하는지는\r
        <a href="#patches">엔진에 얹은 WorkBench 패치</a>에 정리했습니다.\r
      </p>\r
    </section>\r
\r
    <!-- ══ 엔진에 얹은 WorkBench 패치 ═══════════════════════ -->\r
    <section id="patches">\r
      <h2 class="head">엔진에 얹은 WorkBench 패치</h2>\r
\r
      <p>\r
        해석 엔진의 원본은 <strong>원저자(김윤환)의 개발 환경</strong>에 있고, WorkBench 는 그 사본을\r
        <code>InHouseProgram/DoublePipe/</code> 에 두고 실행합니다. 이 사본에는 원본에는 없는\r
        <strong>WorkBench 에서만 필요한 수정</strong>이 얹혀 있습니다 — 웹에서 무인으로, 여러 사용자가,\r
        회사 DRM 이 걸린 서버에서 돌리기 위한 것들입니다.\r
      </p>\r
\r
      <div class="note caution">\r
        <span class="lbl">왜 이 목록이 필요한가</span>\r
        <p>\r
          이 폴더는 <strong>git 미추적</strong>이라 변경 이력이 없습니다. 새 엔진 버전을 받아\r
          <strong>폴더를 통째로 덮어쓰면 아래 패치가 조용히 사라지고</strong>, 증상은 한참 뒤에\r
          &mdash; 서식이 빈 보고서, 선택 해석에서만 나는 크래시, 한글 로그에서의 급사 &mdash; 나타납니다.\r
          <strong>덮어쓰기 전에 이 표를 보고 병합하세요.</strong>\r
        </p>\r
      </div>\r
\r
      <h3>덮어써도 되는 영역 — 해석 코어 21개</h3>\r
      <p>\r
        아래 파일들은 <strong>WorkBench 가 한 줄도 건드리지 않았습니다.</strong>\r
        (통합 직전 스냅샷과 바이트 단위로 동일함을 확인) 원저자가 고친 최신본으로 그냥 덮어쓰면 됩니다.\r
      </p>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">영역</th><th>파일</th></tr></thead>\r
          <tbody>\r
            <tr>\r
              <th class="w1">모델 생성</th>\r
              <td><code>AbaqusModelCreator.py</code> + <code>AbaqusModelCreatorPKG/</code> 전체 13개\r
                (<code>PipeEditiorCSV</code> · <code>ModelAlgorithm</code> · <code>ExportINP</code> ·\r
                <code>BDF_Export</code> · <code>DatFileEditor</code> · <code>FiniteElementData_*</code> ·\r
                <code>CalcFunc</code> · <code>DFS</code> · <code>hmNastranBDF</code> ·\r
                <code>AnalysisResult</code> · <code>main</code> · <code>__init__</code>)</td>\r
            </tr>\r
            <tr>\r
              <th class="w1">하중조합 · 마찰</th>\r
              <td><code>FuelLine_Making_LoadCase.py</code> · <code>FuelLine_Making_FricINP.py</code></td>\r
            </tr>\r
            <tr>\r
              <th class="w1">코드 검토 · 결과</th>\r
              <td><code>FuelLine_ASME_Code.py</code> · <code>FuelLine_F06Format.py</code> ·\r
                <code>FuelLine_ResultFormat.py</code> · <code>inp_to_bdf.py</code> · <code>Local_Corrdi.py</code></td>\r
            </tr>\r
          </tbody>\r
        </table>\r
      </div>\r
      <p>\r
        즉 <strong>FEM 메시 생성 · 하중조합 · 마찰 반복 · ASME B31.3 판정 로직은 전부 원저자 소유</strong>입니다.\r
        WorkBench 는 해석 결과를 바꾸는 수정을 하지 않았습니다.\r
      </p>\r
\r
      <h3>병합이 필요한 파일 3개</h3>\r
      <p>이 세 개는 <strong>덮어쓰지 말고 병합</strong>해야 합니다.</p>\r
\r
      <div class="opt">\r
        <header>\r
          <h3><code>Main.py</code></h3>\r
          <span class="chip fail">전면 재작성</span>\r
          <span class="where"><b>위치</b> Piping Stress Analysis for all load cases/Main.py</span>\r
        </header>\r
        <p>\r
          원본은 <strong>선택 해석 전용 CLI</strong>(<code>python Main.py L20 L21</code>)였습니다.\r
          WorkBench 는 이것을 <strong>&ldquo;인자 없으면 전체 29개, <code>--load-cases</code> 주면 선택&rdquo;</strong>\r
          하나로 합쳐, 백엔드가 exe 하나만 호출하면 되게 만들었습니다.\r
        </p>\r
        <div class="tw">\r
          <table>\r
            <thead><tr><th>얹은 것</th><th>이유 · 빠지면</th></tr></thead>\r
            <tbody>\r
              <tr><th><code>--load-cases</code> 선택 인자</th><td>기본값 <code>None</code> = 전체 29개. 빠지면 백엔드의 &lsquo;전체/선택&rsquo; 두 경로가 모두 깨집니다</td></tr>\r
              <tr><th><code>preload_template()</code> 호출</th><td>파이프라인 <strong>맨 앞</strong>에서 서식을 메모리로 올립니다. 빠지면 <a href="#s8">⑧ 서식 유실</a>이 재발합니다</td></tr>\r
              <tr><th>stdout UTF-8 고정</th><td>빠지면 Abaqus 가 낸 한글 오류를 출력하다 <strong>파이프라인 전체가 죽습니다</strong> — 해당 호출은 <code class="brk">sys.stdout.reconfigure(encoding="utf-8", errors="replace")</code></td></tr>\r
              <tr><th><code>_app_dir()</code> / <code>_find_latest_csv()</code></th><td>PyInstaller <code>frozen</code> 판정 포함. exe 로 빌드했을 때 기준 폴더를 옳게 잡습니다</td></tr>\r
              <tr><th><code>os.chdir</code> 금지 주석</th><td>실행 디렉터리는 백엔드가 작업 폴더로 지정합니다. 여기서 바꾸면 <a href="#s5">⑤ 의 계약</a>이 깨져 동시 실행이 서로 덮어씁니다</td></tr>\r
            </tbody>\r
          </table>\r
        </div>\r
      </div>\r
\r
      <div class="opt">\r
        <header>\r
          <h3><code>FuelLine_PSA_Report.py</code></h3>\r
          <span class="chip fail">3곳 수정</span>\r
          <span class="where"><b>위치</b> Piping Stress Analysis for all load cases/FuelLine_PSA_Report.py</span>\r
        </header>\r
        <div class="tw">\r
          <table>\r
            <thead><tr><th>얹은 것</th><th>이유 · 빠지면</th></tr></thead>\r
            <tbody>\r
              <tr>\r
                <th><code>preload_template()</code> <span class="chip neut">신규</span></th>\r
                <td>서식 템플릿을 <strong>PK(zip) 검증 후 메모리로</strong> 올립니다. 소스 우선순위는\r
                  exe 번들(<code>sys._MEIPASS</code>) &rarr; 작업 폴더 <code>report_template.bin</code> &rarr;\r
                  <code>Report for PSA.xlsx</code>. 빠지면 두 시간 뒤 보고서가 <strong>DRM 암호화된 템플릿을 읽어\r
                  빈 워크북</strong>이 됩니다</td>\r
              </tr>\r
              <tr>\r
                <th><code>_set_cell()</code> <span class="chip neut">신규</span></th>\r
                <td>병합영역의 비-앵커 셀(<code>MergedCell</code>)은 값을 쓸 수 없습니다.\r
                  초기화 루프가 셀 범위를 훑다 만나면 <strong>보고서 생성이 통째로 죽습니다</strong> —\r
                  openpyxl 이 <code class="brk">attribute 'value' is read-only</code> 를 냅니다</td>\r
              </tr>\r
              <tr>\r
                <th>Summary-2 초기화 시작행 <span class="val">16</span> 고정</th>\r
                <td>원본은 앞 루프의 잔여 <code>idx</code> 를 재사용했습니다. 그래서\r
                  <strong>OPE(L1~L16)를 하나도 안 고른 선택 해석에서 <code>UnboundLocalError</code></strong> 로\r
                  실패했고, <code>idx&lt;16</code> 이면 병합 헤더를 건드려 크래시했습니다.\r
                  <strong>선택 해석을 쓰는 한 반드시 필요한 수정입니다</strong></td>\r
              </tr>\r
            </tbody>\r
          </table>\r
        </div>\r
        <div class="note">\r
          <span class="lbl">원저자 것과 헷갈리기 쉬운 것</span>\r
          <p>\r
            같은 파일의 <code>_clear_all_results()</code>(선택 해석 시 나머지 행을 비우는 함수)는\r
            <strong>원저자가 이미 만들어 둔 것</strong>입니다. WorkBench 가 바꾼 것은 그 안의\r
            <code>cell.value = None</code> 을 <code>_set_cell(c, None)</code> 로 감싼 한 줄뿐입니다.\r
          </p>\r
        </div>\r
      </div>\r
\r
      <div class="opt">\r
        <header>\r
          <h3><code>Head_for_FuelLine_ASME_B313_v2018.py</code></h3>\r
          <span class="chip warn">1곳 수정</span>\r
          <span class="where"><b>위치</b> Piping Stress Analysis for all load cases/Head_for_FuelLine_ASME_B313_v2018.py</span>\r
        </header>\r
        <p>Abaqus 출력을 읽는 인코딩 한 줄만 바꿨습니다.</p>\r
        <div class="eq">- encoding='utf-8', errors='replace'\r
+ encoding=locale.getpreferredencoding(False), errors='replace'   (+ import locale)</div>\r
        <p>\r
          한국어 Windows 의 <code>cmd.exe</code> 는 UTF-8 이 아니라 <strong>cp949</strong> 로 오류 메시지를 냅니다.\r
          UTF-8 로 고정 디코딩하면 한글 바이트가 <code>U+FFFD</code> 로 치환되고, 그 문자를 다시\r
          <code>print()</code> 하는 순간 <strong>인코딩 실패로 파이프라인이 급사</strong>합니다\r
          (2026-07 exe 전환 때 실측). 재시도 로직(<code>_cleanup_job_files</code> ·\r
          <code>_TRANSIENT_SIGNATURES</code> · 최대 3회)은 <strong>원저자가 이미 넣어 둔 것</strong>입니다.\r
        </p>\r
      </div>\r
\r
      <h3>WorkBench 가 새로 만든 파일 4종</h3>\r
      <p>원본에는 없던 파일입니다. 엔진을 새로 받아도 이것들은 <strong>지우면 안 됩니다.</strong></p>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">파일</th><th class="w1">정체</th><th>비고</th></tr></thead>\r
          <tbody>\r
            <tr>\r
              <th class="w1"><code class="brk">Converting CSV/inner_pipe_transform.py</code></th>\r
              <td class="w1">포팅본</td>\r
              <td class="desc">원저자의 <code>append_offset.py</code> 를 <strong>백엔드가 import 할 수 있는 함수 형태</strong>로 감싼 것.\r
                <strong>배치 상수 9개(<code>OFFSET_Y</code> · <code>UBOLT_NEAR/SPACING/THRESH</code> ·\r
                <code>GAP_*</code> · <code>FIXED_CHAIN_LEN</code> · 충돌 회피 거리)가 원본과 전부 일치</strong>합니다 —\r
                알고리즘은 그대로 두고 <code>run_transform()</code> · <code>render_layout_pdf()</code> ·\r
                CLI 진입점만 얹었습니다. <strong>원본 <code>append_offset.py</code> 는 손대지 않고 그대로 보존</strong>돼 있습니다</td>\r
            </tr>\r
            <tr>\r
              <th class="w1"><code class="brk">Converting CSV/InnerPipeTransform.exe</code></th>\r
              <td class="w1">빌드</td>\r
              <td class="desc">위 파일의 PyInstaller <strong>onefile</strong> 빌드(도면 PDF 렌더용).\r
                onedir 이 아닌 이유는 DRM 이 <code>base_library.zip</code> 을 암호화해 기동이 안 되기 때문입니다</td>\r
            </tr>\r
            <tr>\r
              <th class="w1"><code class="brk">PSA_AllLoadCases.exe</code></th>\r
              <td class="w1">빌드</td>\r
              <td class="desc"><code>Main.py</code> 의 PyInstaller 빌드.\r
                <strong><code>report_template.bin</code> 을 내부에 번들</strong>하고 있어, 작업 폴더에 템플릿이\r
                하나도 없어도 서식이 살아납니다. <code>.bak-*</code> 백업이 함께 있습니다</td>\r
            </tr>\r
            <tr>\r
              <th class="w1"><code class="brk">report_template.bin</code></th>\r
              <td class="w1">DRM 회피 사본</td>\r
              <td class="desc">같은 폴더 <code>Report for PSA.xlsx</code> 와 <strong>바이트 단위로 동일</strong>합니다\r
                (해시 일치 확인). 확장자만 다른 이유는 DRM 이 Office 확장자만 암호화하기 때문입니다.\r
                <strong>서식을 고쳤다면 <code>.xlsx</code> 뿐 아니라 이 <code>.bin</code> 도 같이 갱신</strong>해야 합니다</td>\r
            </tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note caution">\r
        <span class="lbl">DRM 은 실제로 걸려 있습니다</span>\r
        <p>\r
          현재 <code>InHouseProgram/DoublePipe/</code> 최상위의 <code>Report for PSA.xlsx</code> 와\r
          <code>Report for PSA_result.xlsx</code> 는 선두 7바이트가 <code>HHIDRMC</code> 로,\r
          <strong>이미 암호화된 상태</strong>입니다. 반면 프로그램 폴더의 <code>.bin</code> 과\r
          <code>.xlsx</code> 는 <code>PK</code> 로 정상입니다. 서식 파일을 옮기거나 새로 만들 때는\r
          <strong>선두 4바이트가 <code>PK</code> 인지 반드시 확인</strong>하세요.\r
        </p>\r
      </div>\r
\r
      <h3>새 엔진 버전을 받았을 때</h3>\r
      <ol class="steps">\r
        <li><strong>해석 코어 21개는 그대로 덮어씁니다.</strong> WorkBench 수정이 없는 영역입니다.</li>\r
        <li><strong><code>Main.py</code> · <code>FuelLine_PSA_Report.py</code> · <code>Head_for_...py</code> 는 병합합니다.</strong>\r
          위 표의 항목이 새 버전에 남아 있는지 하나씩 확인하세요.</li>\r
        <li><strong>변환 로직이 바뀌었다면</strong> <code>append_offset.py</code> 의 변경분을\r
          <code>inner_pipe_transform.py</code> 에도 옮깁니다. 두 파일은 자동 동기화되지 않습니다.</li>\r
        <li><strong>exe 를 다시 빌드합니다.</strong> <code>PSA_AllLoadCases.exe</code>(템플릿 <code>.bin</code> 번들 포함) ·\r
          필요하면 <code>InnerPipeTransform.exe</code>.</li>\r
        <li><strong>서버(145)에 수동 복사하고 백엔드를 재시작합니다.</strong>\r
          <code>git pull</code> 로는 따라오지 않습니다(<a href="#parts">구성요소와 배포</a> 참조).</li>\r
        <li><strong>선택 해석으로 한 번 검증하세요.</strong> OPE 를 하나도 포함하지 않는 조합\r
          (예: <code>--load-cases L20</code>)이 <code>FuelLine_PSA_Report.py</code> 패치가 살아 있는지 가리는\r
          가장 빠른 시험입니다 &mdash; 패치가 빠지면 여기서 보고서 생성이 실패합니다.</li>\r
      </ol>\r
\r
      <h3>미해결 — <code>ask_delete=OFF</code></h3>\r
      <div class="note">\r
        <span class="lbl">확인 필요</span>\r
        <p>\r
          선택 해석 폴더(2026-07-03)의 같은 파일에는 있는데, <strong>현재 운영본과 exe 에는 빠져 있는</strong>\r
          옵션이 하나 있습니다.\r
        </p>\r
        <div class="eq">- abaqus job=&lt;LC&gt; cpus=2 ask_delete=OFF int    (2026-07-03 사본)\r
+ abaqus job=&lt;LC&gt; cpus=2 int                   (현재 운영본)</div>\r
        <p>\r
          원본 주석은 <em>&ldquo;같은 폴더 재실행 시 기존 결과 파일 덮어쓰기 확인 프롬프트로 인해\r
          <code>exited with errors</code> 가 나는 것을 방지(무인 재실행 안정화)&rdquo;</em> 입니다.\r
          <strong>의도적으로 뺀 것인지 두 폴더 사이에서 전파가 누락된 것인지는 파일만으로 판단할 수 없습니다.</strong>\r
        </p>\r
        <p>\r
          WorkBench 는 실행마다 새 작업 폴더를 만들므로 <strong>첫 실행은 안전</strong>하고,\r
          <strong>같은 폴더에 다시 돌릴 때만</strong> 노출됩니다. 되살릴지 여부는 원저자와 확인이 필요합니다.\r
        </p>\r
      </div>\r
    </section>\r
\r
    <!-- ══ 상수 일람 ═════════════════════════════════════════ -->\r
    <section id="constants">\r
      <h2 class="head">상수 일람</h2>\r
      <p>\r
        판정과 배치를 가르는 숫자들입니다. 사내 기준이 정해지면 이 값들이 조정 대상이 됩니다.\r
        <strong>한 곳에 모여 있지 않고 단계별 소스에 흩어져 있다</strong>는 점은 알아두세요.\r
      </p>\r
\r
      <div class="tw">\r
        <table class="dense">\r
          <thead><tr><th class="c w1">단계</th><th class="w1">상수</th><th class="w1">값</th><th>적용</th></tr></thead>\r
          <tbody>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">내관 Y 오프셋</th><td class="w1"><span class="val">&minus;15,000 mm</span></td><td>고정. 변환과 FEM 모델 생성의 공통 전제</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">Stiff 분기점</th><td class="w1"><span class="val">1&times;10¹⁰ N/mm</span></td><td>이상이면 U-Bolt 배치 상수 4개가 넓은 세트로 전환</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">U-Bolt NEAR</th><td class="w1"><span class="val">150 / 300 mm</span></td><td>ELBO 로부터 필수 U-Bolt 거리 (좁은/넓은 세트)</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">U-Bolt 간격</th><td class="w1"><span class="val">900·1100 / 1500·1600 mm</span></td><td>직관 구간 반복 간격, 번갈아 적용</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">양끝 ELBO 단일 배치</th><td class="w1"><span class="val">400 mm</span></td><td>이하이면 구간 중앙에 1개만</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">GAP 중간점 상한</th><td class="w1"><span class="val">2000 / 3000 mm</span></td><td>이하면 중앙 1개, 초과면 채움 간격으로 분할</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">GAP 채움 간격</th><td class="w1"><span class="val">1000 / 1500 mm</span></td><td>상한 초과 구간 분할 간격</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">Fixed U-Bolt 체인 길이</th><td class="w1"><span class="val">5,000 mm</span></td><td>초과 시 중앙 U-Bolt 를 <code>rest=123456</code> 완전 구속 + <code>-TIE</code></td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">지지점 충돌 거리 / 이동량</th><td class="w1"><span class="val">100 / 100 mm</span></td><td>외관 지지와 이 거리 이내면 축 방향으로 이동</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">연결성 판정 오차</th><td class="w1"><span class="val">5 mm</span></td><td>이 안에서 만나면 연결된 것으로 봅니다</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">U-Bolt 중복 제거</th><td class="w1"><span class="val">10 mm</span></td><td>이 안에 겹친 배치점은 하나로 합칩니다</td></tr>\r
            <tr><td class="c w1"><span class="val">4</span></td><th class="w1">Load Case 범위</th><td class="w1"><span class="val">L1 &ndash; L29</span></td><td>벗어나면 400. L17 은 항상 자동 포함</td></tr>\r
            <tr><td class="c w1"><span class="val">6</span></td><th class="w1">Abaqus CPU</th><td class="w1"><span class="val">cpus=2</span></td><td>고정. 라이센스·코어 정책과 맞는지 확인 필요</td></tr>\r
            <tr><td class="c w1"><span class="val">6</span></td><th class="w1">재시도 횟수</th><td class="w1"><span class="val">3회</span></td><td>일시적(파일 잠금·전처리) 오류에 한함</td></tr>\r
            <tr><td class="c w1"><span class="val">6</span></td><th class="w1">재시도 대기</th><td class="w1"><span class="val">10 / 5 / 2 초</span></td><td>일시 오류 / 불완전 종료 / job 사이</td></tr>\r
            <tr><td class="c w1"><span class="val">7</span></td><th class="w1">OCC 허용 증가</th><td class="w1"><span class="val">&times; 1.33</span></td><td>우발 하중조합 허용치</td></tr>\r
            <tr><td class="c w1"><span class="val">7</span></td><th class="w1">EXP 허용 계수</th><td class="w1"><span class="val">1.25</span></td><td><code>1.25(Sc+Sh) &minus; S<sub>SUS</sub></code></td></tr>\r
            <tr><td class="c w1"><span class="val">7</span></td><th class="w1">재료표 기준 온도</th><td class="w1"><span class="val">21.1 &deg;C</span></td><td>Sc/Sh 의 저온·고온측 판정 기준점</td></tr>\r
            <tr><td class="c w1"><span class="val">8</span></td><th class="w1">과응력 판정</th><td class="w1"><span class="val">Ratio &gt; 100 %</span></td><td>Summary 의 Check 열에 <strong style="color:var(--fail)">Not OK</strong></td></tr>\r
            <tr><td class="c w1"><span class="val">&mdash;</span></td><th class="w1">해석 제한 시간</th><td class="w1"><span class="val">7,200 초</span></td><td>초과 시 프로세스 트리 강제 종료 (환경변수로 조정 가능)</td></tr>\r
            <tr><td class="c w1"><span class="val">&mdash;</span></td><th class="w1">CSV 업로드 상한</th><td class="w1"><span class="val">25 MB</span></td><td>초과 시 413</td></tr>\r
            <tr><td class="c w1"><span class="val">&mdash;</span></td><th class="w1">로그 보관 상한</th><td class="w1"><span class="val">3,000 줄</span></td><td>넘으면 오래된 줄부터 버립니다</td></tr>\r
            <tr><td class="c w1"><span class="val">&mdash;</span></td><th class="w1">상태 폴링 주기</th><td class="w1"><span class="val">1.5 / 3 초</span></td><td>해석 진행 / 라이센스 해제 감시</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
    </section>\r
\r
    <!-- ══ 하지 않는 것 · 한계 ═══════════════════════════════ -->\r
    <section id="scope">\r
      <h2 class="head">이 앱이 하지 않는 것 · 알려진 한계</h2>\r
\r
      <h3>하지 않는 것</h3>\r
      <ul>\r
        <li><strong>배관 경로 설계</strong> — 형상은 입력 CSV 로 주어집니다. 라우팅을 바꾸거나 제안하지 않습니다.</li>\r
        <li><strong>지지 형식 선택</strong> — 지지는 U-Bolt 로 고정입니다. 다른 지지 형식은 만들지 않습니다.</li>\r
        <li><strong>U-Bolt 자체의 강도 검토</strong> — 배치와 구속만 다루고, 지지 부재의 응력은 보지 않습니다.</li>\r
        <li><strong>내관·외관 접촉 해석</strong> — 두 관은 지정된 연결점으로만 이어집니다. 실제 접촉·간섭은 모사하지 않습니다.</li>\r
        <li><strong>피로 · 진동 · 좌굴</strong> — ASME B31.3 정적 코드 검토만 수행합니다.</li>\r
        <li><strong>과응력 자동 해소</strong> — 과응력을 표시할 뿐, 지지를 옮기거나 규격을 키우는 재설계는 하지 않습니다.</li>\r
      </ul>\r
\r
      <h3>알려진 한계</h3>\r
      <ul>\r
        <li><strong>동시 해석 1건.</strong> Abaqus 라이센스가 하나입니다. 여러 사람이 쓰려면 순서를 기다려야 합니다.</li>\r
        <li><strong>작업 상태가 서버 메모리에만 있습니다.</strong> 백엔드가 재시작되면 진행 추적이 끊깁니다(산출물 파일은 남습니다).</li>\r
        <li><strong>Windows 전용.</strong> Abaqus 를 Windows 셸로 호출하는 구조입니다.</li>\r
        <li><strong>CPU 2코어 고정.</strong> <code>cpus=2</code> 가 하드코딩되어 있어 서버 사양을 올려도 해석이 빨라지지 않습니다.</li>\r
        <li><strong>재료 5종.</strong> 목록에 없는 재료는 허용치가 계산되지 않고 조용히 넘어갑니다.</li>\r
        <li><strong>U-Bolt 질량이 화면에 없습니다.</strong> 내부 기본값 <span class="val">0.2485 kg</span> 고정입니다.</li>\r
        <li><strong>앵커 없는 모델의 변위 보정.</strong> <code>ATTA</code> 가 없으면 변위비 <span class="val">0.0</span> 으로 진행합니다 — 의도된 처리지만 보정이 적용되지 않은 결과입니다.</li>\r
        <li><strong>부분 해석의 보고서.</strong> 선택 해석은 나머지 행을 빈칸으로 남깁니다. 빈칸이 &lsquo;문제 없음&rsquo;이 아니라 &lsquo;해석 안 함&rsquo;이라는 점을 읽는 사람이 알아야 합니다.</li>\r
        <li><strong>Summary-1 에 OPE 가 없습니다.</strong> L1~L16 은 코드 응력 요약 대상이 아닙니다(<a href="#s8">⑧ 참조</a>).</li>\r
      </ul>\r
\r
      <div class="note">\r
        <span class="lbl">개발 상태</span>\r
        <p>\r
          이 App 은 <strong>개발 중(Developing)</strong>으로 등록되어 있습니다.\r
          해석 로직과 화면이 계속 바뀔 수 있으므로, 결과를 그대로 설계 근거로 쓰기 전에\r
          <strong>담당자와 현재 버전의 유효성을 확인</strong>하세요.\r
        </p>\r
      </div>\r
    </section>\r
\r
  </main>\r
\r
  <footer class="colophon">\r
    <dl>\r
      <dt>화면</dt><dd>HiTessWorkBench / frontend/src/pages/analysis/DoublePipeFuelLineAssessment.jsx</dd>\r
      <dt>API</dt><dd>HiTessWorkBenchBackEnd / app/routers/doublepipe.py</dd>\r
      <dt>서비스</dt><dd>app/services/doublepipe_service.py · doublepipe_psa_service.py</dd>\r
      <dt>변환 엔진</dt><dd>InHouseProgram/DoublePipe/Converting CSV/inner_pipe_transform.py</dd>\r
      <dt>해석 엔진</dt><dd>InHouseProgram/DoublePipe/Piping Stress Analysis for all load cases/Main.py</dd>\r
      <dt>이식 가이드</dt><dd>InHouseProgram/DoublePipe/FuelLine for HiTESS.md</dd>\r
      <dt>패치 근거</dt><dd>'Piping Stress Analyiss for selected load cases' (2026-07-03~09 스냅샷)와의 파일 단위 대조</dd>\r
      <dt>해석 담당</dt><dd>김윤환</dd>\r
    </dl>\r
  </footer>\r
\r
</div>\r
\r
<script>\r
(function () {\r
  'use strict';\r
\r
  var links = Array.prototype.slice.call(document.querySelectorAll('.rail a[href^="#"]'));\r
  var now = document.getElementById('tbNow');\r
  var topBtn = document.getElementById('tbTop');\r
  if (!links.length || !now || !topBtn) return;\r
\r
  var targets = [];\r
  links.forEach(function (a) {\r
    var el = document.getElementById(a.getAttribute('href').slice(1));\r
    var labelEl = a.querySelector('span:last-child');\r
    if (el && labelEl) targets.push({ link: a, el: el, label: labelEl.textContent });\r
  });\r
  if (!targets.length) return;\r
\r
  var current;\r
  var ticking = false;\r
\r
  function readingLine() {\r
    var raw = getComputedStyle(document.documentElement).getPropertyValue('--topbar-h');\r
    var px = parseFloat(raw) || 3;\r
    if (raw.indexOf('rem') !== -1) px *= 16;\r
    return px + 24;\r
  }\r
\r
  function update() {\r
    ticking = false;\r
    var line = readingLine();\r
    var found = null;\r
\r
    for (var i = 0; i < targets.length; i++) {\r
      if (targets[i].el.getBoundingClientRect().top <= line) found = targets[i];\r
    }\r
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 2) {\r
      found = targets[targets.length - 1];\r
    }\r
\r
    if (found !== current) {\r
      current = found;\r
      links.forEach(function (a) { a.removeAttribute('aria-current'); });\r
      if (found) {\r
        found.link.setAttribute('aria-current', 'true');\r
        now.textContent = '';\r
        var b = document.createElement('b');\r
        b.textContent = found.label;\r
        now.appendChild(b);\r
        now.parentNode.classList.add('has-now');\r
      } else {\r
        now.textContent = '';\r
        now.parentNode.classList.remove('has-now');\r
      }\r
    }\r
\r
    if (topBtn.classList.toggle) topBtn.classList.toggle('on', window.scrollY > 400);\r
  }\r
\r
  function onScroll() {\r
    if (!ticking) { ticking = true; requestAnimationFrame(update); }\r
  }\r
\r
  window.addEventListener('scroll', onScroll, { passive: true });\r
  window.addEventListener('resize', onScroll, { passive: true });\r
\r
  topBtn.addEventListener('click', function () {\r
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;\r
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });\r
  });\r
\r
  update();\r
})();\r
<\/script>\r
\r
</body>\r
</html>\r
`;export{e as default};