var e=`<!doctype html>\r
<html lang="ko">\r
<head>\r
<meta charset="utf-8">\r
<meta name="viewport" content="width=device-width, initial-scale=1">\r
<title>권상 자세안정성 평가 기준</title>\r
<meta name="description" content="Group &amp; Module Unit 권상 자세안정성 평가가 8단계에서 무엇을 검사하고 어떤 숫자로 합격을 가르는지 정리한 사용자 문서.">\r
<link rel="preconnect" href="https://fonts.googleapis.com">\r
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\r
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap">\r
<style>\r
/* ═══════════════════════════════════════════════════════════════\r
   토큰 — HiTESS WorkBench DESIGN.md 정렬\r
   파생 토큰은 사유를 함께 적는다.\r
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
   min(1024, 창폭 - 32) 이다. 과거 940px 기준에서는 앱 창이 972px 만\r
   돼도 1단으로 내려갔다(배율 150%+ 또는 창 비최대화에서 쉽게 발생). */\r
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
.doc ul { max-width: 68ch; padding-left: 1.2em; margin: 0 0 var(--s-md); }\r
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
/* ═══ 수식 / 절차 ══════════════════════════════════════════════ */\r
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
/* ═══ 선택 기능 ════════════════════════════════════════════════ */\r
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
.opt .where {\r
  flex-basis: 100%;\r
  font-family: var(--mono);\r
  font-size: var(--t-xs);\r
  color: var(--ink-3);\r
}\r
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
.colophon dd { margin: 0; }\r
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
<body id="top">\r
\r
<a class="skip" href="#main">본문 바로가기</a>\r
\r
<div class="topbar">\r
  <a class="tb-home" href="#top">권상 자세안정성 평가 기준</a>\r
  <span class="tb-sep" aria-hidden="true">/</span>\r
  <span class="tb-now" id="tbNow" aria-live="polite"></span>\r
  <button class="tb-top" id="tbTop" type="button">맨 위로</button>\r
</div>\r
\r
<div class="shell">\r
\r
  <header class="masthead">\r
    <p class="kicker">Group &amp; Module Unit · 권상 구조 해석</p>\r
    <h1>권상 자세안정성 평가 기준</h1>\r
    <p class="lede">\r
      모듈을 실제로 들어 올리기 전에, 지금 고른 권상점 배치로 안정적으로 매달릴 수 있는지를\r
      8단계로 검사합니다. 각 단계가 <em>무엇을 보고</em>, <em>어떤 숫자로 합격을 가르며</em>,\r
      걸렸을 때 <em>무엇을 고치면 되는지</em>를 정리했습니다.\r
    </p>\r
    <ul class="specline">\r
      <li><b>대상</b>Group &amp; Module Unit 권상 구조 해석</li>\r
      <li><b>엔진</b>ModuleAnalysis.Stability</li>\r
      <li><b>명세</b>v0.4</li>\r
      <li><b>작성</b>2026-08-25</li>\r
    </ul>\r
  </header>\r
\r
  <nav class="rail" aria-label="문서 색인">\r
    <details open>\r
      <summary>목차</summary>\r
      <div class="rail-body">\r
        <h2>먼저 읽기</h2>\r
        <ol>\r
          <li><a href="#read"><span class="n" aria-hidden="true">·</span><span>결과 읽는 법</span></a></li>\r
          <li><a href="#map"><span class="n" aria-hidden="true">·</span><span>8단계 한눈에</span></a></li>\r
        </ol>\r
        <h2>단계별 기준</h2>\r
        <ol>\r
          <li><a href="#s0"><span class="n" aria-hidden="true">0</span><span>입력 검증</span></a></li>\r
          <li><a href="#s1"><span class="n" aria-hidden="true">1</span><span>권상 형상 분류</span></a></li>\r
          <li><a href="#s2"><span class="n" aria-hidden="true">2</span><span>형상 유효성 검증</span></a></li>\r
          <li><a href="#s3"><span class="n" aria-hidden="true">3</span><span>권상 정점 산출</span></a></li>\r
          <li><a href="#s4"><span class="n" aria-hidden="true">4</span><span>슬링 와이어 각도</span></a></li>\r
          <li><a href="#s5"><span class="n" aria-hidden="true">5</span><span>와이어 간섭</span></a></li>\r
          <li><a href="#s6"><span class="n" aria-hidden="true">6</span><span>자세 안정성(전도)</span></a></li>\r
          <li><a href="#s7"><span class="n" aria-hidden="true">7</span><span>리깅 하중</span></a></li>\r
        </ol>\r
        <h2>더 알아두기</h2>\r
        <ol>\r
          <li><a href="#options"><span class="n" aria-hidden="true">·</span><span>선택 기능 3가지</span></a></li>\r
          <li><a href="#advisory"><span class="n" aria-hidden="true">·</span><span>참고 지표</span></a></li>\r
          <li><a href="#scope"><span class="n" aria-hidden="true">·</span><span>하지 않는 것</span></a></li>\r
          <li><a href="#constants"><span class="n" aria-hidden="true">·</span><span>기준값 일람</span></a></li>\r
        </ol>\r
      </div>\r
    </details>\r
  </nav>\r
\r
  <main class="doc" id="main">\r
\r
    <!-- ══ 결과 읽는 법 ══════════════════════════════════════ -->\r
    <section id="read">\r
      <h2 class="head">결과 읽는 법</h2>\r
\r
      <p>\r
        평가는 세 등급으로 나옵니다. 종합 판정은 <strong>8단계 중 가장 심한 상태</strong>가 그대로 올라옵니다.\r
        한 단계라도 &lsquo;수정 필요&rsquo;면 전체가 수정 필요입니다.\r
      </p>\r
\r
      <div class="tw">\r
        <table>\r
          <thead>\r
            <tr><th class="w1">표시</th><th>뜻</th><th>다음에 할 일</th></tr>\r
          </thead>\r
          <tbody>\r
            <tr>\r
              <th class="w1"><span class="chip pass">사용 가능</span></th>\r
              <td>모든 단계가 기준 이내입니다.</td>\r
              <td>단위 구조해석으로 진행합니다.</td>\r
            </tr>\r
            <tr>\r
              <th class="w1"><span class="chip warn">검토 필요</span></th>\r
              <td>진행을 막을 오류는 없지만 확인할 항목이 있습니다.</td>\r
              <td>사유를 확인한 뒤 진행 여부를 판단합니다. 단위 구조해석은 열려 있습니다.</td>\r
            </tr>\r
            <tr>\r
              <th class="w1"><span class="chip fail">수정 필요</span></th>\r
              <td>이 조건 그대로는 진행할 수 없습니다.</td>\r
              <td>지적된 항목을 고쳐 권상점을 다시 선택합니다.</td>\r
            </tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note">\r
        <span class="lbl">알아둘 것</span>\r
        <p>\r
          <strong>단위 구조해석은 &lsquo;사용 가능&rsquo;과 &lsquo;검토 필요&rsquo; 양쪽에서 모두 열립니다.</strong>\r
          검토 필요를 무시하고 넘어가도 된다는 뜻이 아니라, 판단을 사람에게 맡긴다는 뜻입니다.\r
          왜 검토 필요가 됐는지는 결과 패널의 해당 단계에서 사유, 수치, 대상 노드 번호까지 함께 나옵니다.\r
        </p>\r
      </div>\r
\r
      <p>\r
        중간 단계가 불합격이어도 평가는 <strong>끝까지 수행한 뒤 한 번에 보고</strong>합니다.\r
        6단계에서 전도로 걸렸다고 4·5단계 결과가 비어 있지는 않습니다. 한 번 돌려서 문제를 전부 모아 보고\r
        고치라는 뜻입니다. 유일한 예외가 0단계로, 여기서 거부되면 평가 결과 자체가 만들어지지 않습니다.\r
      </p>\r
    </section>\r
\r
    <!-- ══ 8단계 한눈에 ══════════════════════════════════════ -->\r
    <section id="map">\r
      <h2 class="head">8단계 한눈에</h2>\r
      <p>\r
        결과 화면에서 걸린 단계 번호를 확인했다면, 아래에서 그 줄을 눌러 바로 이동하세요.\r
        오른쪽 열은 <strong>그 단계가 낼 수 있는 가장 심한 판정</strong>입니다.\r
      </p>\r
\r
      <div class="tw">\r
        <table class="summary">\r
          <thead>\r
            <tr><th colspan="2">단계</th><th>무엇을 보는가</th><th>최대 판정</th></tr>\r
          </thead>\r
          <tbody>\r
            <tr data-sev="fail">\r
              <td class="s-n">0</td>\r
              <th class="s-name"><a href="#s0">입력 검증</a></th>\r
              <td>평가에 필요한 입력이 갖춰졌는지</td>\r
              <td class="s-max"><span class="chip fail">거부</span></td>\r
            </tr>\r
            <tr data-sev="fail">\r
              <td class="s-n">1</td>\r
              <th class="s-name"><a href="#s1">권상 형상 분류</a></th>\r
              <td>권상 방식과 권상점 개수 조합이 성립하는지</td>\r
              <td class="s-max"><span class="chip fail">수정 필요</span></td>\r
            </tr>\r
            <tr data-sev="fail">\r
              <td class="s-n">2</td>\r
              <th class="s-name"><a href="#s2">형상 유효성 검증</a></th>\r
              <td>높이차, 비틀림, 둔각이 기준 안에 드는지</td>\r
              <td class="s-max"><span class="chip fail">수정 필요</span></td>\r
            </tr>\r
            <tr data-sev="neut">\r
              <td class="s-n">3</td>\r
              <th class="s-name"><a href="#s3">권상 정점 산출</a></th>\r
              <td>검사가 아니라 계산. 뒤 세 단계의 기준점을 만듭니다</td>\r
              <td class="s-max"><span class="chip neut">계산</span></td>\r
            </tr>\r
            <tr data-sev="fail">\r
              <td class="s-n">4</td>\r
              <th class="s-name"><a href="#s4">슬링 와이어 각도</a></th>\r
              <td>와이어가 수평면과 이루는 각</td>\r
              <td class="s-max"><span class="chip fail">수정 필요</span></td>\r
            </tr>\r
            <tr data-sev="warn">\r
              <td class="s-n">5</td>\r
              <th class="s-name"><a href="#s5">와이어 간섭</a></th>\r
              <td>와이어가 구조물을 지나가는지</td>\r
              <td class="s-max"><span class="chip warn">검토 필요</span></td>\r
            </tr>\r
            <tr data-sev="fail">\r
              <td class="s-n">6</td>\r
              <th class="s-name"><a href="#s6">자세 안정성(전도)</a></th>\r
              <td>매달았을 때 기울거나 뒤집히는지</td>\r
              <td class="s-max"><span class="chip fail">수정 필요</span></td>\r
            </tr>\r
            <tr data-sev="fail">\r
              <td class="s-n">7</td>\r
              <th class="s-name"><a href="#s7">리깅 하중</a></th>\r
              <td>슬링·샤클·러그가 허용하중 안에 드는지</td>\r
              <td class="s-max"><span class="chip fail">수정 필요</span> <span class="chip neut">선택</span></td>\r
            </tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h3>단계마다 평가 단위가 다릅니다</h3>\r
      <p>\r
        그룹을 여러 개로 묶었을 때 <strong>어떤 단계는 그룹을 하나씩 따로 보고, 어떤 단계는 전부 합쳐서 봅니다.</strong>\r
        이 차이를 모르면 &ldquo;그룹을 늘렸는데 왜 이 단계는 그대로인가&rdquo; 같은 혼동이 생깁니다.\r
      </p>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="c w1">단계</th><th class="w1">평가 단위</th><th>뜻</th></tr></thead>\r
          <tbody>\r
            <tr><td class="c w1"><span class="val">1 · 2</span></td><th class="w1">그룹별</th><td>그룹을 하나씩 검사합니다. <strong>한 그룹이라도 걸리면 그 단계가 불합격</strong>입니다.</td></tr>\r
            <tr><td class="c w1"><span class="val">3</span></td><th class="w1">그룹별</th><td>그룹마다 정점을 1개 만듭니다. Trolley 의 4점 그룹만 2개로 쪼갭니다.</td></tr>\r
            <tr><td class="c w1"><span class="val">4 · 5</span></td><th class="w1">와이어별</th><td>그룹 안의 러그 하나하나를 검사합니다. 가장 나쁜 와이어가 그 단계의 판정이 됩니다.</td></tr>\r
            <tr><td class="c w1"><span class="val">6</span></td><th class="w1"><strong>모델 전체</strong></th><td>모든 그룹의 정점을 <strong>한꺼번에</strong> 놓고 무게중심 위치를 봅니다. 그룹별 결과가 따로 나오지 않습니다.</td></tr>\r
            <tr><td class="c w1"><span class="val">7</span></td><th class="w1">모델 전체</th><td>설계하중을 모든 정점에 분배한 뒤 슬링별 최댓값을 봅니다.</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
      <p>\r
        6단계만 모델 전체를 보기 때문에, <strong>그룹을 추가하면 6단계 전도 판정이 크게 달라집니다.</strong>\r
        반대로 1·2·4·5단계는 그룹을 늘려도 각 그룹이 여전히 같은 기준으로 검사됩니다.\r
      </p>\r
\r
      <div class="note">\r
        <span class="lbl">단계 사이의 의존</span>\r
        <p>\r
          앞 단계의 결과를 뒤 단계가 그대로 씁니다. 특히 <strong>3단계에서 정한 정점 좌표를\r
          4·5·6단계가 전부 기준으로 삼습니다.</strong> 와이어 길이를 바꾸면 정점이 올라가면서\r
          슬링각·간섭·전도가 한꺼번에 달라지는 이유입니다.\r
        </p>\r
      </div>\r
\r
      <p>\r
        모든 좌표와 거리는 <strong>mm</strong>입니다. 와이어 길이만 화면에서 m 로 입력받아 내부에서 mm 로 바꿉니다.\r
        권상 방식은 <code>Hydro(Hook)</code>, <code>Goliat(Trolley)</code>, <code>Ceiling(Crane)</code> 세 가지입니다.\r
      </p>\r
    </section>\r
\r
    <!-- ══ 0단계 ════════════════════════════════════════════ -->\r
    <section id="s0" class="stage" data-sev="fail">\r
      <header>\r
        <span class="num" aria-hidden="true">00</span>\r
        <h2>입력 검증 및 파싱 <a class="anchor" href="#s0" aria-label="0단계로 가는 링크">#</a></h2>\r
        <span class="chip neut">화면에 표시되지 않음</span>\r
      </header>\r
\r
      <p class="aim">평가에 필요한 입력이 갖춰졌는지 확인합니다. 여기서 거부되면 결과 자체가 만들어지지 않습니다.</p>\r
\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">검사</th><th>기준</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1">스키마</th><td><code>posture-stability/1.0</code> 이어야 합니다.</td></tr>\r
            <tr><th class="w1">편집 모델 파일</th><td>편집본이 지정돼 있으면 같은 폴더에 실제로 존재해야 하고, 편집 완료 표시가 있어야 합니다. 없으면 원본으로 대체하지 않고 거부합니다.</td></tr>\r
            <tr><th class="w1">노드 좌표</th><td>권상 노드의 x·y·z 가 모두 있어야 합니다. 권상 설정과 편집 모델의 좌표가 다르면 <strong>편집 모델을 따릅니다</strong>.</td></tr>\r
            <tr><th class="w1">질량</th><td>질량을 산출할 수 없으면 거부합니다. 무게중심을 못 구하면 6단계 전도 평가가 불가능하기 때문입니다.</td></tr>\r
            <tr><th class="w1">그룹 수</th><td><span class="val">Hook 최대 8 · Trolley 최대 3 · Crane 1</span> (Crane 은 고정)</td></tr>\r
            <tr><th class="w1">노드 번호</th><td>한 그룹 안에 같은 노드가 두 번 들어가면 안 됩니다.</td></tr>\r
            <tr><th class="w1">와이어 길이</th><td><span class="val">0 초과</span></td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="fix">\r
        <h4>걸리면</h4>\r
        <p>\r
          대부분 모델 로드나 권상 설정 쪽 문제입니다. 편집 모델을 다시 저장하거나, 그룹 구성을 권상 방식별\r
          한계에 맞춰 줄이세요. 질량이 안 잡히는 경우는 모델에 단면·재질이 빠진 부재가 있는지 확인해야 합니다.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <span></span>\r
        <a href="#s1">다음 · 1단계 권상 형상 분류 →</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 1단계 ════════════════════════════════════════════ -->\r
    <section id="s1" class="stage" data-sev="fail">\r
      <header>\r
        <span class="num" aria-hidden="true">01</span>\r
        <h2>권상 형상 분류 <a class="anchor" href="#s1" aria-label="1단계로 가는 링크">#</a></h2>\r
        <span class="chip fail">수정 필요 가능</span>\r
        <span class="chip neut">완화 가능</span>\r
      </header>\r
\r
      <p class="aim">고른 권상점 개수와 배치가 그 권상 방식으로 들 수 있는 형태인지 봅니다.</p>\r
\r
      <h4>권상 방식 &times; 권상점 개수</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th>방식</th><th class="c">2점</th><th class="c">3점</th><th class="c">4점</th><th class="c">5점 이상</th></tr></thead>\r
          <tbody>\r
            <tr><th>Hook (Hydro)</th><td class="c">가능</td><td class="c">가능</td><td class="c">가능</td><td class="c">불가</td></tr>\r
            <tr><th>Trolley (Goliat)</th><td class="c">가능</td><td class="c"><strong>불가</strong></td><td class="c">가능</td><td class="c">불가</td></tr>\r
            <tr><th>Crane (Ceiling)</th><td class="c"><strong>불가</strong></td><td class="c">가능</td><td class="c">가능</td><td class="c">불가</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
      <p>\r
        Trolley 가 3점을 못 받는 이유는 3단계의 &plusmn;450 mm 분할을 3점에 적용할 수 없기 때문이고,\r
        Crane 이 2점을 못 받는 이유는 천장 레일 한 점으로 모으는 방식이라 2점 직선 권상이 성립하지 않기 때문입니다.\r
      </p>\r
\r
      <h4>4점일 때 추가 판정</h4>\r
      <ul>\r
        <li>4점 중 <strong>어느 3점이든 거의 한 줄</strong>이면 거부합니다. 그 삼각형 면적이 <span class="val">1,000 mm²</span> 이하인 경우입니다.</li>\r
        <li>4점 전체가 X 또는 Y 한 방향으로 늘어서면 <strong>일직선</strong>으로 분류합니다. 방향 편차 약 <span class="val">26°</span> 이내가 기준입니다.</li>\r
        <li>늘어선 게 아니면 <strong>사각형</strong>인지 봅니다. 여섯 변 길이가 다각형 조건을 만족하는지 확인합니다.</li>\r
        <li>둘 다 아니면 &ldquo;형태 인식 불가&rdquo;로 거부합니다.</li>\r
      </ul>\r
\r
      <div class="fix">\r
        <h4>걸리면</h4>\r
        <p>\r
          권상 방식에 맞는 개수로 노드를 다시 고르거나, 한 줄로 늘어선 4점 중 하나를 옆으로 옮겨\r
          사각형이 되게 하세요. 이 단계는 <a href="#opt-strict">Strict 평가 토글</a>로 완화할 수 있습니다.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s0">← 이전 · 0단계 입력 검증</a>\r
        <a href="#s2">다음 · 2단계 형상 유효성 검증 →</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 2단계 ════════════════════════════════════════════ -->\r
    <section id="s2" class="stage" data-sev="fail">\r
      <header>\r
        <span class="num" aria-hidden="true">02</span>\r
        <h2>권상 형상 유효성 검증 <a class="anchor" href="#s2" aria-label="2단계로 가는 링크">#</a></h2>\r
        <span class="chip fail">수정 필요 가능</span>\r
        <span class="chip neut">완화 가능</span>\r
      </header>\r
\r
      <p class="aim">형태는 맞는데 수치적으로 쓸 만한지 봅니다. 높이 차, 비틀림, 둔각을 검사합니다.</p>\r
\r
      <h4>4점 사각형</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">검사</th><th class="w1">기준</th><th>왜 보는가</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1">Z 단차</th><td class="w1"><span class="val">≤ 500 mm</span></td><td>권상점 높이가 크게 다르면 와이어 하중 분배가 무너집니다.</td></tr>\r
            <tr><th class="w1">볼록성</th><td class="w1"><span class="val">convex</span></td><td>오목하거나 자기교차하는 사각형은 와이어가 꼬이거나 한 변에 하중이 몰립니다.</td></tr>\r
            <tr><th class="w1">평면도</th><td class="w1"><span class="val">≤ 300 mm</span></td><td>네 번째 점이 앞 세 점의 평면에서 벗어난 거리. 크면 장력이 비대칭이 됩니다.</td></tr>\r
            <tr><th class="w1">단변 <span class="chip neut">Trolley만</span></th><td class="w1"><span class="val">≥ 900 mm</span></td><td>3단계 &plusmn;450 mm 분할 여유. 짧으면 분할 후 노드가 뒤집힙니다.</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h4>3점 삼각형</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">검사</th><th class="w1">기준</th><th>왜 보는가</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1">Z 단차</th><td class="w1"><span class="val">≤ 500 mm</span></td><td>사각형과 같은 이유입니다.</td></tr>\r
            <tr><th class="w1">최대 내각</th><td class="w1"><span class="val">≤ 120°</span></td><td>둔각이 크면 한 변에 가까운 넓은 영역에서 전도 위험이 커집니다.</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <p><strong>4점 일직선과 2점은 이 단계에서 검사할 항목이 없어 자동으로 통과합니다.</strong></p>\r
\r
      <div class="fix">\r
        <h4>걸리면 · 어느 기준에 걸렸느냐에 따라 안내가 다릅니다</h4>\r
        <ul>\r
          <li><strong>Z 단차</strong> &rarr; 같은 레벨의 러그로 다시 고르거나 그룹을 나눕니다.</li>\r
          <li><strong>오목</strong> &rarr; 외곽을 따라 볼록해지도록 4점을 다시 고릅니다.</li>\r
          <li><strong>평면도</strong> &rarr; 튀어나온 한 점을 같은 평면 위의 다른 노드로 바꿉니다.</li>\r
          <li><strong>Trolley 단변</strong> &rarr; 짧은 변이 900 mm 이상 되게 재선택합니다.</li>\r
          <li><strong>삼각형 둔각</strong> &rarr; 정삼각형에 가깝도록 한 점을 바꿉니다.</li>\r
        </ul>\r
        <p>이 단계도 <a href="#opt-strict">Strict 평가 토글</a>로 완화할 수 있습니다.</p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s1">← 이전 · 1단계 권상 형상 분류</a>\r
        <a href="#s3">다음 · 3단계 권상 정점 산출 →</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 3단계 ════════════════════════════════════════════ -->\r
    <section id="s3" class="stage" data-sev="neut">\r
      <header>\r
        <span class="num" aria-hidden="true">03</span>\r
        <h2>권상 정점 좌표 산출 <a class="anchor" href="#s3" aria-label="3단계로 가는 링크">#</a></h2>\r
        <span class="chip brand">계산 단계</span>\r
      </header>\r
\r
      <p class="aim">검사가 아니라 계산입니다. 이후 4·5·6단계가 전부 여기서 나온 정점을 기준으로 돕니다.</p>\r
\r
      <div class="eq">정점 = 그룹 중심(centroid) + (0, 0, 와이어 길이)</div>\r
\r
      <div class="note caution">\r
        <span class="lbl">가장 자주 오해하는 부분</span>\r
        <p>\r
          <strong>와이어 길이는 그룹 중심에서 수직으로 올린 높이입니다. 사선 와이어의 실제 길이가 아닙니다.</strong>\r
          그래서 &ldquo;와이어가 짧아서 러그에 닿지 않는&rdquo; 경우는 이 도구에서 생기지 않습니다.\r
          와이어 길이를 늘리면 정점이 그만큼 위로 올라가고, 그 결과 슬링각이 커지고 전도 여유가 달라집니다.\r
        </p>\r
      </div>\r
\r
      <h4>Trolley 분할</h4>\r
      <p>Trolley 의 4점(사각형·일직선)만 정점을 &plusmn;450 mm 두 개로 나눕니다.</p>\r
      <ul>\r
        <li>분할 축은 모델 전체에서 정합니다. X 방향 일직선 그룹 수가 Y 방향 이상이면 <strong>Y축</strong>으로, 아니면 <strong>X축</strong>으로 나눕니다.</li>\r
        <li>분할된 그룹 번호는 <span class="val">원래번호 &times; 10 + (1 또는 2)</span> 입니다. Group 2 는 21, 22 가 됩니다.</li>\r
        <li><strong>이 분할이 6단계의 지지 형상을 바꿉니다.</strong> Trolley 2그룹이면 정점이 4개가 되어, 선(Line)이 아니라 다각형으로 평가됩니다.</li>\r
      </ul>\r
\r
      <div class="fix">\r
        <h4>판정</h4>\r
        <p>와이어 길이가 0 이하면 수정 필요입니다. 그 밖에는 항상 통과합니다.</p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s2">← 이전 · 2단계 형상 유효성 검증</a>\r
        <a href="#s4">다음 · 4단계 슬링 와이어 각도 →</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 4단계 ════════════════════════════════════════════ -->\r
    <section id="s4" class="stage" data-sev="fail">\r
      <header>\r
        <span class="num" aria-hidden="true">04</span>\r
        <h2>슬링 와이어 각도 <a class="anchor" href="#s4" aria-label="4단계로 가는 링크">#</a></h2>\r
        <span class="chip fail">수정 필요 가능</span>\r
      </header>\r
\r
      <p class="aim">각 와이어가 수평면과 이루는 각을 봅니다. 얕을수록 같은 무게에 장력이 급격히 커집니다.</p>\r
\r
      <div class="eq">각도 θ = atan( 정점과 러그의 높이차 ÷ 수평거리 )</div>\r
\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">슬링각</th><th class="w1">판정</th><th class="w1">장력 배수 1/sinθ</th><th>수평 성분 1/tanθ</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1"><span class="val">60° 이상</span></th><td class="w1"><span class="chip pass">통과</span></td><td class="w1"><span class="val">1.155 이하</span></td><td><span class="val">0.577 이하</span></td></tr>\r
            <tr><th class="w1"><span class="val">30° ~ 60°</span></th><td class="w1"><span class="chip warn">검토 필요</span></td><td class="w1"><span class="val">1.155 ~ 2.000</span></td><td><span class="val">0.577 ~ 1.732</span></td></tr>\r
            <tr><th class="w1"><span class="val">30° 미만</span></th><td class="w1"><span class="chip fail">수정 필요</span></td><td class="w1"><span class="val">2.000 초과</span></td><td><span class="val">1.732 초과</span></td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <p>\r
        결과에는 각도와 함께 <strong>장력 배수</strong>가 같이 나옵니다. 각도 숫자보다\r
        &ldquo;장력이 몇 배로 뛰는지&rdquo;가 실무에서 더 빨리 읽히기 때문입니다.\r
        45°면 1.414배, 30°면 정확히 2배입니다.\r
      </p>\r
\r
      <div class="note caution">\r
        <span class="lbl">수평 성분에 주의</span>\r
        <p>\r
          슬링각이 얕아지면 와이어의 수평 성분이 <strong>모듈 상현재를 안쪽으로 압축</strong>합니다.\r
          60°에서 수직하중의 0.577배, 30°에서는 1.732배입니다. 이 압축은 자세안정성 평가에 나타나지 않고\r
          <strong>단위 구조해석을 돌려야 드러납니다.</strong> 슬링각이 검토 필요로 나왔다면 구조해석 결과를 함께 보세요.\r
        </p>\r
      </div>\r
\r
      <div class="note">\r
        <span class="lbl">권상 위치 자동 선정과의 관계</span>\r
        <p>\r
          자동 선정은 후보를 넓게 찾기 위해 60° 기준을 일시적으로 풀고 탐색합니다.\r
          하지만 <strong>30° 절대 하한은 자동 선정에서도 풀리지 않습니다.</strong>\r
          하한까지 무시하면 하한을 둔 의미가 없어지기 때문입니다.\r
        </p>\r
      </div>\r
\r
      <div class="fix">\r
        <h4>걸리면</h4>\r
        <p>\r
          와이어 길이를 늘려 정점을 높이거나, 권상점을 안쪽으로 모아 수평 거리를 줄이세요.\r
          둘 중에는 와이어 길이를 늘리는 쪽이 다른 단계에 주는 영향이 적습니다.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s3">← 이전 · 3단계 권상 정점 산출</a>\r
        <a href="#s5">다음 · 5단계 와이어 간섭 →</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 5단계 ════════════════════════════════════════════ -->\r
    <section id="s5" class="stage" data-sev="warn">\r
      <header>\r
        <span class="num" aria-hidden="true">05</span>\r
        <h2>와이어-구조물 간섭 <a class="anchor" href="#s5" aria-label="5단계로 가는 링크">#</a></h2>\r
        <span class="chip warn">최대 검토 필요</span>\r
      </header>\r
\r
      <p class="aim">정점에서 러그까지 이은 와이어 직선이 모델의 다른 부재를 지나가는지 봅니다.</p>\r
\r
      <ul>\r
        <li>와이어 선분과 <strong>모델의 모든 요소</strong> 사이 최단거리를 계산합니다.</li>\r
        <li>러그 자신이 붙어 있는 요소는 제외합니다.</li>\r
        <li>러그로부터 <strong><span class="val">150 mm</span> 이내 구간은 무시</strong>합니다. 러그 주변에는 원래 부재가 붙어 있습니다.</li>\r
        <li>최단거리가 <strong>그 요소의 최대 단면치수보다 작으면</strong> 간섭으로 봅니다.</li>\r
      </ul>\r
\r
      <div class="note caution">\r
        <span class="lbl">이 단계는 수정 필요를 내지 않습니다</span>\r
        <p>\r
          간섭이 몇 건 나오든 최대 <strong>검토 필요</strong>까지입니다. 판정을 자동으로 막지 않으니,\r
          최소 거리 값을 직접 보고 실물 기준으로 판단해야 합니다.\r
        </p>\r
      </div>\r
\r
      <div class="note">\r
        <span class="lbl">근사 방식 · 반드시 알아둘 것</span>\r
        <p>\r
          <strong>와이어 굵기를 0으로 봅니다.</strong> 대신 요소 쪽 임계를 최대 단면치수로 크게 잡아\r
          보수적으로 상쇄하고 있습니다. 하지만 와이어 실제 지름과 최소 요구 이격(통상 50~100 mm)은\r
          반영돼 있지 않아 방향이 섞여 있습니다. 최소 거리가 작게 나온 건은 실제 와이어 굵기를 더해\r
          다시 확인하세요.\r
        </p>\r
      </div>\r
\r
      <div class="fix">\r
        <h4>걸리면</h4>\r
        <p>해당 러그 노드나 권상 정점을 옮겨 와이어 경로를 구조물 밖으로 확보합니다. 결과에는 간섭한 요소 번호와 최소 거리가 함께 나옵니다.</p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s4">← 이전 · 4단계 슬링 와이어 각도</a>\r
        <a href="#s6">다음 · 6단계 자세 안정성 →</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 6단계 ════════════════════════════════════════════ -->\r
    <section id="s6" class="stage" data-sev="fail">\r
      <header>\r
        <span class="num" aria-hidden="true">06</span>\r
        <h2>자세 안정성 (전도) <a class="anchor" href="#s6" aria-label="6단계로 가는 링크">#</a></h2>\r
        <span class="chip fail">수정 필요 가능</span>\r
        <span class="chip neut">완화 불가</span>\r
      </header>\r
\r
      <p class="aim">매달았을 때 모듈이 기울거나 뒤집히는지 봅니다. 이 평가의 핵심 단계입니다.</p>\r
\r
      <h3>① 먼저 높이를 봅니다</h3>\r
      <div class="eq">h = 정점 평면의 평균 높이 − 무게중심 높이</div>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">h</th><th class="w1">판정</th><th>이유</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1"><span class="val">h ≤ 0</span></th><td class="w1"><span class="chip fail">수정 필요</span></td><td>무게중심이 정점보다 높으면 매달린 물체는 뒤집힙니다. 여기서 평가를 즉시 끝냅니다.</td></tr>\r
            <tr><th class="w1"><span class="val">0 &lt; h &lt; 500 mm</span></th><td class="w1"><span class="chip warn">검토 필요</span></td><td>여유가 너무 얇습니다. 통과였더라도 한 단계 내립니다.</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h3>② 다음으로 지지 형상을 봅니다</h3>\r
      <p>정점을 XY 평면에 내려 그린 다음, 무게중심 투영점이 그 안에 있는지 봅니다.</p>\r
\r
      <h4>내 그룹 구성이면 어느 모드로 평가되나</h4>\r
      <p>\r
        규칙은 하나입니다. <strong>정점은 그룹마다 1개</strong>씩 생기고,\r
        <strong>Trolley 의 4점 그룹만 2개로 쪼개집니다</strong>(3단계 &plusmn;450 mm 분할).\r
        그 결과 나온 정점 개수가 평가 모드를 정합니다.\r
      </p>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th>그룹 구성</th><th class="c w1">정점 수</th><th class="w1">평가 모드</th><th>전도 여유</th></tr></thead>\r
          <tbody>\r
            <tr>\r
              <th>Crane (1그룹 고정)<br>Hook 1그룹<br>Trolley 2점 1그룹</th>\r
              <td class="c w1"><span class="val">1</span></td>\r
              <td class="w1"><span class="val">Point</span></td>\r
              <td>가장 까다롭습니다. 무게중심이 그 정점 <strong>바로 아래</strong>에 와야 합니다.</td>\r
            </tr>\r
            <tr>\r
              <th>Hook 2그룹<br>Trolley 2점 2그룹<br><strong>Trolley 4점 1그룹</strong></th>\r
              <td class="c w1"><span class="val">2</span></td>\r
              <td class="w1"><span class="val">Line</span></td>\r
              <td>선은 폭이 없습니다. 무게중심이 두 정점을 잇는 선에서 옆으로 벗어나면 바로 걸립니다.</td>\r
            </tr>\r
            <tr>\r
              <th>Hook 3그룹 이상<br>Trolley 2점 3그룹<br><strong>Trolley 4점 2그룹 이상</strong></th>\r
              <td class="c w1"><span class="val">3 이상</span></td>\r
              <td class="w1"><span class="val">ConvexPolygon</span></td>\r
              <td><strong>면적이 생깁니다.</strong> 무게중심이 그 다각형 안에 들어오면 어긋남이 0 이라 통과합니다.</td>\r
            </tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note">\r
        <span class="lbl">그룹을 늘리면 왜 유리한가</span>\r
        <p>\r
          정점이 1~2개면 지지 형상이 <strong>점이나 선</strong>이라 면적이 없습니다. 무게중심이 조금만 옆으로\r
          어긋나도 그대로 거리로 잡히고, 허용치는 모델 BBox 대각선의 1% 뿐입니다.\r
          정점이 3개 이상이 되면 지지 형상이 <strong>면</strong>이 되어, 무게중심이 그 안에 들어오기만 하면\r
          어긋남이 0 으로 계산됩니다.\r
        </p>\r
        <p>\r
          그래서 2그룹(Line)으로 전도가 걸릴 때는 두 정점을 잇는 선을 무게중심에 맞추려 애쓰는 것보다\r
          <strong>그룹을 하나 더 만들어 다각형으로 바꾸는 편이 대체로 빠릅니다.</strong>\r
          Trolley 는 4점 그룹 하나만 있어도 정점이 2개로 쪼개져 Line 이 되고, 두 그룹이면 바로 다각형이 됩니다.\r
        </p>\r
      </div>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">정점 수</th><th class="w1">모드</th><th>어긋남을 무엇으로 재는가</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1"><span class="val">1개</span></th><td class="w1"><span class="val">Point</span></td><td>무게중심에서 그 정점까지의 수평 거리</td></tr>\r
            <tr><th class="w1"><span class="val">2개</span></th><td class="w1"><span class="val">Line</span></td><td>두 정점을 잇는 선분까지의 수직 거리</td></tr>\r
            <tr><th class="w1"><span class="val">3개 이상</span></th><td class="w1"><span class="val">ConvexPolygon</span></td><td>정점들의 볼록 껍질 밖이면 가장 가까운 변까지의 거리, 안이면 0</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="eq">허용치 = 모델 BBox 대각선 × 1%\r
예) 대각 23,704 mm  →  허용 237 mm\r
\r
어긋남 ≤ 허용치  →  통과\r
어긋남 &gt; 허용치  →  수정 필요</div>\r
\r
      <p>\r
        정점이 3개 이상이고 무게중심이 다각형 <em>안</em>에 있으면, 결과에 경계까지의 실제 최단 거리가\r
        따로 나옵니다. 여러 후보를 비교할 때 &ldquo;얼마나 여유 있게 안에 들어와 있는지&rdquo;를 구분하기 위한 값입니다.\r
      </p>\r
\r
      <div class="fix">\r
        <h4>걸리면 · 모드별로 대응이 다릅니다</h4>\r
        <ul>\r
          <li><strong>Point</strong> &rarr; 그룹 중심이 무게중심 바로 위에 오도록 노드를 다시 고릅니다.</li>\r
          <li><strong>Line</strong> &rarr; 두 정점을 잇는 선이 화면의 분홍색 무게중심 마커를 지나가게 합니다. 맞추기 어려우면 그룹을 3개 이상으로 늘려 다각형 안에 들어오게 하는 편이 쉽습니다.</li>\r
          <li><strong>ConvexPolygon</strong> &rarr; 무게중심에서 가장 먼 쪽 그룹을 바깥으로 옮기거나 그룹을 추가합니다.</li>\r
        </ul>\r
      </div>\r
\r
      <div class="note">\r
        <span class="lbl">이 단계는 완화되지 않습니다</span>\r
        <p>\r
          <a href="#opt-strict">Strict 평가 토글</a>을 꺼도 6단계 전도는 그대로 수정 필요를 냅니다.\r
          형상이 조금 어긋난 것과 모듈이 실제로 넘어지는 것은 성격이 다르기 때문입니다.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s5">← 이전 · 5단계 와이어 간섭</a>\r
        <a href="#s7">다음 · 7단계 리깅 하중 →</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 7단계 ════════════════════════════════════════════ -->\r
    <section id="s7" class="stage" data-sev="fail">\r
      <header>\r
        <span class="num" aria-hidden="true">07</span>\r
        <h2>권상 리깅 하중 (슬링 장력 · SWL) <a class="anchor" href="#s7" aria-label="7단계로 가는 링크">#</a></h2>\r
        <span class="chip neut">선택 · 기본 꺼짐</span>\r
      </header>\r
\r
      <p class="aim">슬링·샤클·러그가 허용하중(SWL) 안에 드는지 봅니다. 허용하중을 입력해야만 실행됩니다.</p>\r
\r
      <h4>계산 순서</h4>\r
      <div class="eq">1. 설계하중 = 총질량 × 동하중계수(DAF) × (1 + 무게여유% ÷ 100)\r
\r
2. 정점 반력 분배\r
     정점 1개  : 전량 부담\r
     정점 2개  : 두 정점을 잇는 선상 레버로 분배\r
     정점 3개+ : 부정정 → 최소노름 해\r
\r
3. 최악 시나리오\r
     정상 1회 + 정점을 하나씩 빼고 N−1회\r
     → 슬링별로 전 시나리오 최댓값 채택\r
\r
4. 슬링 장력 = (정점 반력 ÷ 그 정점의 러그 수) ÷ sin(슬링각)\r
\r
5. 사용률 = 최대 장력 ÷ SWL\r
     와이어 · 샤클 · 러그 셋 중 가장 큰 값이 지배값</div>\r
\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">지배 사용률</th><th>판정</th></tr></thead>\r
          <tbody>\r
            <tr><th class="w1"><span class="val">0.90 미만</span></th><td><span class="chip pass">통과</span></td></tr>\r
            <tr><th class="w1"><span class="val">0.90 ~ 1.00</span></th><td><span class="chip warn">검토 필요</span></td></tr>\r
            <tr><th class="w1"><span class="val">1.00 초과</span></th><td><span class="chip fail">수정 필요</span></td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="note caution">\r
        <span class="lbl">N−1 시나리오가 판정을 뒤집는 경우가 많습니다</span>\r
        <p>\r
          실측 예(A505080, 가정 SWL 12/17/15 t): 두 정점이 정상적으로 나눠 지면\r
          최대 장력 <span class="val">9.588 t</span>, 사용률 <span class="val">0.799</span> 로 통과입니다.\r
          그런데 <strong>두 정점 중 하나가 슬랙되는 시나리오</strong>에서는\r
          <span class="val">40.301 ÷ 3 ÷ sin(71.6°) = 14.158 t</span>, 사용률\r
          <span class="val">1.180</span> 이 되어 불합격이 됩니다. 검사 하나가 결과를 바꿉니다.\r
        </p>\r
        <p>\r
          정점이 2개일 때의 N−1 은 보수적입니다. 실제로 한쪽이 슬랙되면 모듈이 크게 흔들리므로\r
          이를 정적 하중으로 다루는 것은 포락선 성격의 취급입니다.\r
        </p>\r
      </div>\r
\r
      <p>\r
        <strong>비워 둔 SWL 은 그 검사만 건너뜁니다.</strong> 셋 다 비우면 장력만 산출하고 판정은 통과로 둡니다.\r
        엔진은 임의의 안전값을 가정하지 않습니다. 입력한 SWL 이 곧 판정 기준입니다.\r
      </p>\r
\r
      <h4>7단계가 보지 않는 것</h4>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th>항목</th><th>담당</th></tr></thead>\r
          <tbody>\r
            <tr><th>러그 방향성, 면외하중, 핀홀 지압, 첵플레이트, 용접부</th><td><code>D_TypeLugCalculation</code></td></tr>\r
            <tr><th>와이어로프 종단 효율, 굽힘 감소계수</th><td>없음. 입력 SWL 을 그대로 신뢰합니다</td></tr>\r
            <tr><th>스프레더 빔 자체 검토</th><td>없음</td></tr>\r
            <tr><th>SWL 카탈로그 연동</th><td>없음. 전부 수기 입력입니다</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <div class="fix">\r
        <h4>걸리면</h4>\r
        <p>\r
          권상점을 재배치해 슬링각을 키우거나(수직에 가깝게), 그룹·슬링 수를 늘려 장력을 분산하고,\r
          필요하면 더 높은 SWL 등급의 리깅으로 바꿉니다.\r
        </p>\r
      </div>\r
\r
      <nav class="stage-nav" aria-label="단계 이동">\r
        <a href="#s6">← 이전 · 6단계 자세 안정성</a>\r
        <a href="#options">다음 · 선택 기능 3가지 →</a>\r
      </nav>\r
    </section>\r
\r
    <!-- ══ 선택 기능 ═════════════════════════════════════════ -->\r
    <section id="options">\r
      <h2 class="head">선택 기능 3가지</h2>\r
      <p>세 가지 모두 <strong>기본은 꺼짐</strong>입니다. 켜지 않으면 동작하지 않고, 결과도 켜기 전과 같습니다.</p>\r
\r
      <article class="opt" id="opt-strict">\r
        <header>\r
          <h3>Strict 평가 토글</h3>\r
          <span class="chip neut">기본 꺼짐 = 완화</span>\r
          <span class="where">위치 · Hoist 좌측 패널 상단</span>\r
        </header>\r
\r
        <div class="split">\r
          <div>\r
            <h4><span class="chip warn">완화됨</span></h4>\r
            <ul>\r
              <li><strong>1단계</strong> 형상 분류 전체</li>\r
              <li><strong>2단계</strong> Z단차, 볼록성, 평면도, Trolley 단변, 삼각형 내각</li>\r
              <li>수정 필요 대신 <strong>검토 필요</strong>로 내려갑니다.</li>\r
            </ul>\r
          </div>\r
          <div>\r
            <h4><span class="chip fail">완화 안 됨</span></h4>\r
            <ul>\r
              <li><strong>3단계</strong> 와이어 길이</li>\r
              <li><strong>6단계</strong> 전도</li>\r
              <li>둘은 항상 <strong>수정 필요</strong>입니다.</li>\r
            </ul>\r
          </div>\r
        </div>\r
\r
        <p>\r
          3단계는 정점 자체를 만들 수 없는 경우이고, 6단계는 모듈이 실제로 넘어지는 위험이라\r
          형상이 조금 어긋난 것과는 성격이 다릅니다.\r
        </p>\r
        <p>\r
          단위 구조해석은 통과와 검토 필요 양쪽에서 열리므로, 완화하면\r
          <strong>형상이 다소 어긋난 조합으로도 구조해석까지 진행할 수 있습니다.</strong>\r
          완화가 적용된 결과에는 화면에 상시 경고 배너가 붙고, 결과 파일에도 완화 여부가 기록됩니다.\r
        </p>\r
        <p>\r
          설정은 브라우저에 저장되어 세션이 바뀌어도 유지됩니다. 토글을 바꾸면 이전 엄격도로\r
          평가된 결과는 무효화됩니다.\r
        </p>\r
      </article>\r
\r
      <article class="opt" id="opt-cog">\r
        <header>\r
          <h3>무게중심 공차 (COG 포락선)</h3>\r
          <span class="chip neut">기본 꺼짐</span>\r
          <span class="where">위치 · Hoist 패널 &lsquo;정밀 검토 옵션&rsquo; (STEP 4 위)</span>\r
        </header>\r
\r
        <p>\r
          <strong>왜 필요한가.</strong> 질량은 빔 단면 &times; 길이 &times; 밀도에 모델링된 점질량을 더해 구합니다.\r
          FE 모델에 없는 배관, 케이블트레이, 보온, 그레이팅, 도장, 용접, 볼트는 통째로 빠져 있습니다.\r
          무게중심 한 점만 믿고 &ldquo;여유 20 mm 로 통과&rdquo;라고 하면 사실상 아무것도 보장하지 못합니다.\r
        </p>\r
        <ul>\r
          <li>켜면 XY 네 코너를 각각 평가해 <strong>가장 불리한 결과를 채택</strong>합니다.</li>\r
          <li>Z 는 여유가 줄어드는 방향(무게중심이 더 높은 쪽)으로 한 번만 적용합니다.</li>\r
          <li>제안 크기는 평면 치수의 2%, 높이의 1% 입니다.</li>\r
          <li>음수를 넣으면 절댓값으로 해석하고 기록을 남깁니다. 세 축이 모두 0 이면 공차 없음으로 봅니다.</li>\r
        </ul>\r
\r
        <h4>실측 차이 (A505080, 공차 &plusmn;369 / &plusmn;265 / 200 mm)</h4>\r
        <div class="tw">\r
          <table>\r
            <thead><tr><th class="w1">조건</th><th class="w1">어긋남</th><th class="w1">경사각</th><th>h</th></tr></thead>\r
            <tbody>\r
              <tr><th class="w1">공차 없음</th><td class="w1"><span class="val">1,095.5 mm</span></td><td class="w1"><span class="val">7.891°</span></td><td><span class="val">7,903.7 mm</span></td></tr>\r
              <tr><th class="w1">공차 있음</th><td class="w1"><span class="val">1,399.5 mm</span></td><td class="w1"><span class="val">10.297°</span></td><td><span class="val">7,703.7 mm</span></td></tr>\r
            </tbody>\r
          </table>\r
        </div>\r
\r
        <p><strong>끄면 후보가 무게중심 한 점뿐이라 켜기 전과 완전히 같은 결과가 나옵니다.</strong></p>\r
      </article>\r
\r
      <article class="opt" id="opt-rigging">\r
        <header>\r
          <h3>리깅 검토 (7단계)</h3>\r
          <span class="chip neut">기본 꺼짐</span>\r
          <span class="where">위치 · Hoist 패널 &lsquo;정밀 검토 옵션&rsquo; (STEP 4 위)</span>\r
        </header>\r
        <p>\r
          켠 다음 동하중계수(DAF), 무게 여유, SWL 을 입력해야 <a href="#s7">7단계</a>가 실행됩니다.\r
          끄면 7단계는 아예 수행되지 않고 결과 화면에서도 숨겨집니다.\r
        </p>\r
        <p>\r
          입력값은 전부 사용자 책임입니다. 엔진은 임의의 안전값을 가정하지 않으므로,\r
          비워 두면 그 검사를 조용히 건너뜁니다.\r
        </p>\r
      </article>\r
    </section>\r
\r
    <!-- ══ 참고 지표 ═════════════════════════════════════════ -->\r
    <section id="advisory">\r
      <h2 class="head">참고 지표 · 결과에 나오지만 판정에는 쓰이지 않습니다</h2>\r
\r
      <div class="note caution">\r
        <span class="lbl">먼저 알아둘 것</span>\r
        <p>\r
          아래 두 값은 결과에 표시되지만 <strong>합격과 불합격을 가르지 않습니다.</strong>\r
          기준값이 아직 사내 확정 기준이 아니라, 실제 모델들의 분포를 확인한 뒤 판정으로 옮기기 위한\r
          단계이기 때문입니다. 그래서 <strong>&ldquo;경사각은 불합격인데 종합 판정은 통과&rdquo;가 나올 수 있습니다.</strong>\r
        </p>\r
      </div>\r
\r
      <h3>경사각 <span class="mono">tiltAngleDeg</span> · 6단계</h3>\r
      <div class="eq">θ = atan( 어긋남 ÷ 정점평면과 무게중심의 수직거리 h )</div>\r
      <p>\r
        매달린 강체는 무게중심이 지지 합력 바로 아래로 올 때까지 회전하므로, 어긋남과 높이만 알면\r
        기울 각도가 나옵니다. 결과에는 각도와 함께 &ldquo;각도 기준이라면 어떤 판정이 나왔을지&rdquo;가\r
        같이 표시됩니다. 제안 기준은 <strong>1.0° 경고, 2.0° 불합격</strong>입니다.\r
      </p>\r
\r
      <h4>왜 필요한가</h4>\r
      <p>\r
        현재 판정 기준인 &ldquo;BBox 대각 &times; 1%&rdquo;는 허용 어긋남을 <em>물체의 크기</em>로 정규화합니다.\r
        그런데 크기는 기울어짐에 저항하는 기하가 아닙니다. 같은 비율이 케이스마다 전혀 다른 물리를 뜻하게 됩니다.\r
      </p>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th>조건 (A505080 기준)</th><th class="w1">허용치</th><th>실제 허용 경사각</th></tr></thead>\r
          <tbody>\r
            <tr><th>현재 · 와이어 8 m</th><td class="w1"><span class="val">237.0 mm</span></td><td><span class="val">1.72°</span></td></tr>\r
            <tr><th>같은 배치, 와이어만 24 m</th><td class="w1"><span class="val">237.0 mm</span></td><td><span class="val">0.57°</span> <span class="chip fail">3배 엄격</span></td></tr>\r
            <tr><th>같은 와이어, 평면 2배 모델</th><td class="w1"><span class="val">474.1 mm</span></td><td><span class="val">3.43°</span> <span class="chip warn">2배 관대</span></td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
      <p>\r
        둘 다 물리와 반대 방향입니다. 와이어가 길수록 같은 어긋남에 <em>덜</em> 기울어지는데 기준은 엄격해지고,\r
        큰 모듈일수록 같은 각도가 <em>더</em> 위험한데 기준은 관대해집니다. 30 m 모듈이 3.43° 기울면\r
        끝단이 902 mm 오르내립니다. 그래서 경사각 쪽이 물리에 더 가깝습니다. 종합 판정과 어긋나면 값을 참고하세요.\r
      </p>\r
\r
      <h3>편중계수 <span class="mono">skewFactor</span> · 7단계</h3>\r
      <p>\r
        한 정점에 슬링이 3본 이상이면 부정정인데, 현재 계산은 정점 반력을 러그 수로 <strong>균등 분배</strong>합니다.\r
        실제로는 슬링 길이 공차와 제작 오차 때문에 통상 대각 2본에 하중이 몰립니다.\r
        슬링이 2본이면 정정이라 편중 개념 자체가 없습니다.\r
      </p>\r
      <ul>\r
        <li>제안 계수는 <span class="val">1.25</span>, 슬링 <strong>3본 이상</strong>일 때만 적용합니다.</li>\r
        <li>편중을 반영한 장력과 사용률이 <strong>병기</strong>되고, 판정은 균등분배 기준으로 냅니다.</li>\r
        <li>판정에 넣으면 4점 권상의 사용률이 25% 올라 기존에 통과하던 리깅이 걸립니다. 실측 영향을 확인한 뒤 전환할 예정입니다.</li>\r
        <li>편중을 반영했다면 판정이 뒤집혔을 경우에만 별도 문구로 알립니다. 항상 붙이면 소음이 되기 때문입니다.</li>\r
      </ul>\r
    </section>\r
\r
    <!-- ══ 하지 않는 것 ══════════════════════════════════════ -->\r
    <section id="scope">\r
      <h2 class="head">이 평가가 하지 않는 것</h2>\r
      <p>\r
        <strong>누락과 의도적 제외는 다릅니다.</strong> 아래는 이 도구가 다루지 않기로 정한 것들이며,\r
        구분하지 못하면 결과를 과신하게 됩니다.\r
      </p>\r
\r
      <h3>전제</h3>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="w1">전제</th><th>뜻</th></tr></thead>\r
          <tbody>\r
            <tr>\r
              <th class="w1">정적 평가</th>\r
              <td>리프트오프 가속, 크레인 급정지, 진자 운동을 반영하지 않습니다. 동하중은 7단계 DAF 로 하중을 키우는 것이 전부이고, <strong>DAF 는 6단계 전도 판정에 아무 영향이 없습니다.</strong> 기하 판정이라 하중 배율과 무관합니다.</td>\r
            </tr>\r
            <tr><th class="w1">무풍</th><td>풍하중을 고려하지 않습니다. 실내 권상을 가정합니다.</td></tr>\r
            <tr><th class="w1">강체</th><td>모듈 자체의 변형을 다루지 않습니다. 부재 응력은 단위 구조해석의 몫입니다.</td></tr>\r
            <tr><th class="w1">와이어</th><td>늘어나지 않고 당기기만 합니다. 슬링 신율과 장력 이력은 모델링하지 않습니다.</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h3>다른 도구가 담당하는 것</h3>\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th>항목</th><th>담당</th></tr></thead>\r
          <tbody>\r
            <tr><th>러그(패드아이) 상세 설계 · 방향성, 면외하중, 핀홀 지압, 첵플레이트, 용접부</th><td><code>D_TypeLugCalculation</code></td></tr>\r
            <tr><th>모듈 부재 응력과 변형</th><td>Nastran 단위 구조해석</td></tr>\r
            <tr><th>크레인 용량, 양정, 주변 간섭</th><td>리프트 플래닝 (이 도구 범위 밖)</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
\r
      <h3>알려진 근사</h3>\r
      <ul>\r
        <li><strong>5단계 간섭</strong> · 와이어 반경을 0으로 보고 요소 최대 단면치수를 임계로 씁니다. 요소를 크게 잡는 쪽은 보수적이지만 와이어 굵기와 최소 요구 이격이 빠져 있어 방향이 섞여 있습니다.</li>\r
        <li><strong>3단계 Trolley &plusmn;450 mm</strong> · 고정값입니다. 실제 골리앗 트롤리 간격은 크레인마다 다르므로, 다른 장비를 쓴다면 이 값이 맞는지 확인이 필요합니다.</li>\r
      </ul>\r
    </section>\r
\r
    <!-- ══ 기준값 일람 ═══════════════════════════════════════ -->\r
    <section id="constants">\r
      <h2 class="head">기준값 일람</h2>\r
      <p>\r
        모든 기준값은 엔진의 <code>AnalysisConstants.cs</code> 한 곳에 모여 있습니다.\r
        사내 기준이 정해지면 이 파일만 고치면 전 단계에 반영됩니다.\r
      </p>\r
\r
      <div class="tw">\r
        <table>\r
          <thead><tr><th class="c w1">단계</th><th class="w1">기준</th><th class="w1">값</th><th>적용</th></tr></thead>\r
          <tbody>\r
            <tr><td class="c w1"><span class="val">1</span></td><th class="w1">일직선 판정 임계</th><td class="w1"><span class="val">0.9</span></td><td>약 26° 이내면 한 줄로 봅니다</td></tr>\r
            <tr><td class="c w1"><span class="val">1</span></td><th class="w1">3점 일직선 면적</th><td class="w1"><span class="val">1,000 mm²</span></td><td>이하면 거부</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">Z 단차</th><td class="w1"><span class="val">500 mm</span></td><td>4점 사각형과 3점 삼각형 공통</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">평면도</th><td class="w1"><span class="val">300 mm</span></td><td>4점 사각형</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">Trolley 단변 최소</th><td class="w1"><span class="val">900 mm</span></td><td>4점 사각형, Trolley 만</td></tr>\r
            <tr><td class="c w1"><span class="val">2</span></td><th class="w1">삼각형 최대 내각</th><td class="w1"><span class="val">120°</span></td><td>3점 삼각형</td></tr>\r
            <tr><td class="c w1"><span class="val">3</span></td><th class="w1">Trolley 분할 폭</th><td class="w1"><span class="val">±450 mm</span></td><td>4점 사각형과 일직선</td></tr>\r
            <tr><td class="c w1"><span class="val">4</span></td><th class="w1">슬링각 안전 기준</th><td class="w1"><span class="val">60°</span></td><td>미만이면 <span class="chip warn">검토 필요</span></td></tr>\r
            <tr><td class="c w1"><span class="val">4</span></td><th class="w1">슬링각 절대 하한</th><td class="w1"><span class="val">30°</span></td><td>미만이면 <span class="chip fail">수정 필요</span>. 자동 선정에서도 풀리지 않습니다</td></tr>\r
            <tr><td class="c w1"><span class="val">5</span></td><th class="w1">러그 인접 무시 거리</th><td class="w1"><span class="val">150 mm</span></td><td>이 구간의 간섭은 세지 않습니다</td></tr>\r
            <tr><td class="c w1"><span class="val">6</span></td><th class="w1">전도 허용치 비율</th><td class="w1"><span class="val">1%</span></td><td>모델 BBox 대각선 &times; 이 비율. 정점 수와 무관하게 동일</td></tr>\r
            <tr><td class="c w1"><span class="val">6</span></td><th class="w1">정점-무게중심 최소 높이</th><td class="w1"><span class="val">500 mm</span></td><td>미만이면 강등, <span class="val">h ≤ 0</span> 이면 <span class="chip fail">수정 필요</span></td></tr>\r
            <tr><td class="c w1"><span class="val">6</span></td><th class="w1">경사각 경고 / 불합격</th><td class="w1"><span class="val">1.0° / 2.0°</span></td><td><span class="chip neut">제안값 · 판정 미반영</span></td></tr>\r
            <tr><td class="c w1"><span class="val">7</span></td><th class="w1">사용률 경고 / 불합격</th><td class="w1"><span class="val">0.90 / 1.00</span></td><td>지배 사용률 기준</td></tr>\r
            <tr><td class="c w1"><span class="val">7</span></td><th class="w1">편중계수</th><td class="w1"><span class="val">1.25</span></td><td><span class="chip neut">제안값 · 판정 미반영</span>. 슬링 3본 이상</td></tr>\r
          </tbody>\r
        </table>\r
      </div>\r
    </section>\r
\r
  </main>\r
\r
  <footer class="colophon">\r
    <dl>\r
      <dt>기준값 원본</dt><dd>ModuleUnitAnalysis / src/ModuleAnalysis.Core/Utils/AnalysisConstants.cs</dd>\r
      <dt>기술 명세</dt><dd>ModuleUnitAnalysis / docs/stability-pipeline-spec.md (v0.4)</dd>\r
      <dt>불합격 기준 상세</dt><dd>ModuleUnitAnalysis / docs/fail-tolerance-reference.md</dd>\r
      <dt>실측 근거</dt><dd>tests/golden/A505080 · 3454-35020-A505080_20251021</dd>\r
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