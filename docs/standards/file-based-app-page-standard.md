# 파일 기반 해석 앱 페이지 표준 (runFrame v1)

> 확정: 2026-10-02 · 기준 구현 2개 = **HiTESS Model Builder**, **Group & Module Unit 권상 구조 해석**
> 새 해석 앱 페이지를 만들거나 기존 페이지를 고칠 때 이 문서와 두 기준 페이지에서 **더하고 빼서** 시작한다.
> 이 문서와 기준 페이지가 다르면 **기준 페이지가 맞다**(코드가 원본). 고친 내용은 여기에도 반영할 것.

| 기준 구현 | 파일 | 이 앱이 보여 주는 변형 |
|---|---|---|
| Model Builder | `HiTessWorkBench/frontend/src/pages/analysis/HiTessModelBuilder.jsx` | 다중 입력(CSV 3칸)·자동 배정·미리보기 표·실행 전 점검·옵션 여러 개·편집 적용(후속 작업)·재실행 옵션 덮어쓰기 |
| GMU 권상 | `HiTessWorkBench/frontend/src/pages/analysis/GroupModuleUnitLiftingAnalysis.jsx` | 단일 입력(BDF)·서버 경로 입력(handoff)·**판정 두 시점**(검증 → 외부 Studio 결과)·외부 프로그램 이벤트로 단계 진행·보고서 |

부품: `HiTessWorkBench/frontend/src/components/analysis/runFrame/` (`index.js` 에서 한 번에 import)

---

## 1. 화면 골격

```
┌ FileBasedPageBanner (제목·부제·사용 가이드·뒤로) ───────────────────────────────┐
├ (선택) AppCommunityHub — 앱 공지·게시판 한 줄                                   ┤
├─ 왼쪽 레일 aside (xl:w-80) ─┐ ┌─ 오른쪽 작업면 main (flex-1) ─────────────────┐
│ StepRail (단계 3개 안팎)     │ │ JobProgressCard   — 실행 중일 때만            │
│ InputSummary (입력 단계 밖)  │ │ VerdictHeader     — 판정이 있을 때만          │
│ ── 옵션 (체크·숫자·고급 접기) │ │ NextActionBar     — 지금 할 일 1개            │
│ [주 실행 버튼 1개]           │ │ ┌ section: "N. 단계 이름" ─────────────────┐ │
│  안내 한 줄 / Ctrl+Enter     │ │ │ 단계 본문 (입력 칸 · 결과 · Studio 카드…)  │ │
│  보조 링크: 새 입력·샘플     │ │ │ 첫 화면이면 RunStartPanel               │ │
│ ── (선택) 연계 링크 한 줄    │ │ └────────────────────────────────────────┘ │
│                              │ │ EngineLogPanel    — 실패했을 때만            │
└──────────────────────────────┘ └──────────────────────────────────────────────┘
```

- 페이지 루트: `relative mx-auto flex min-h-full max-w-[1400px] flex-col pb-28 animate-fade-in-up`
  - `pb-28` = 오른쪽 아래 전역 작업·메시지 도크가 마지막 버튼을 가리지 않게.
- 두 칸 컨테이너: `flex flex-col items-stretch gap-5 px-1 xl:flex-row` — **`flex-1` 을 주지 않는다**(화면 높이까지 늘리면 카드 안이 빈다).
- 레일: `rounded-xl border border-slate-200 bg-white px-4 py-4 xl:w-80 xl:shrink-0` + 첫 화면이 아니면 `xl:self-start`.
- 단계 section: `rounded-xl border border-slate-200 bg-white px-5 py-4`, 머리 = 아이콘 + `h2` "`{n}. {단계 이름}`" + 아래 구분선.
- 1366 폭에서도 확인한다(레일이 위로 쌓이는 `xl` 미만 포함).

## 2. 부품 카탈로그 (props)

| 부품 | 언제 | props |
|---|---|---|
| `StepRail` | 항상 | `steps=[{id,title,icon,status,hint?}]`, `activeIdx`, `onSelect`. status = `wait·running·done·review·error·disabled` (점 색 + 글자 라벨) |
| `InputSummary` | 입력 단계가 **아닐 때** | `items=[{key,label,fileName?,state:'ok'|'warn'|'error'|'empty',note?}]`, `footer?` |
| `JobProgressCard` | 실행 중 | `title, message, progress, elapsed, note`. 진행 표시는 **여기 한 곳**(+전역 작업 도크). 버튼 안 타이머·본문 스피너 금지 |
| `VerdictHeader` | 판정이 있을 때 | `level:'pass'|'review'|'fail'`, `title`, `summary?`, `reasons=[{code,text}]`(3줄 안쪽), `meta?`(판정 기준 표기) |
| `NextActionBar` | 단계마다 할 일이 있을 때 | `note`, `primary={label,icon,onClick,disabled?,busy?,title?}`, `secondary=[…]`(2개까지). **판정 머리 바로 아래**. sticky bottom 금지 |
| `KeyFigures` | 결과 핵심 수치 | `items=[{key,label,value,unit?,sub?,tone?}]`, `caption?` |
| `StudioLauncherCard` | Studio(뷰어)를 여는 단계 | `title, description, installed, status, progress, error, installedVersion, latestVersion, ready, locked, notReadyTitle, lockedTitle, onLaunch`. 앱마다 그라데이션 카드 새로 만들지 말 것 |
| `RunStartPanel` | **첫 화면** | `steps=[{title,detail}]`, `programName`, `onOpen(id)`, `onUseInput(record)`, `hasInput(record)`, `limit=5` |
| `EngineLogPanel` | 실행 실패 | `log`, `defaultOpen=false` |
| `RunLogPanel` | 예전 검은 콘솔(System/Execution Console)이 있던 앱 | `logs=[{time,message,type,block?}]`, `open`(실패 시 true), `actions=[{key,label,icon,onClick}]`, `note`. 접어 두고 실패하면 펼친다. block 리포트로 스크롤할 때 **기록 칸 안에서만** 움직인다(페이지를 밀면 판정 머리가 화면 밖으로 간다) |

공용이지만 runFrame 밖: `ResultArtifactsCard({parentAnalysisId,onDownloaded})`(산출물·보고서), `ValidationStepLog({…, bare})`(BDF 검증 본문 — 틀 안에서는 `bare`), `SampleRunButton variant="link"`, `PreflightIssueCenter compact`, `CsvPreviewPanel`.

## 3. 상태 규칙

### 3.1 단계 상태는 저장하지 않고 '사건'에서 매 렌더 계산한다
```js
const displaySteps = STEP_DEFS.map(def => {
  if (def.id === 'input') {
    if (running) return { ...def, status: 'running', hint: '검증 중' };
    if (verdict.level === 'fail') return { ...def, status: 'error', hint: '검증 실패' };
    if (verdict.level === 'review') return { ...def, status: 'review', hint: '…' };
    if (verdict.level === 'pass') return { ...def, status: 'done', hint: '검증 통과' };
    return { ...def, status: 'wait' };
  }
  …
});
```
- 완료로 바꾸는 사건 = 실행 성공 / 판정 통과·'확인함'·편집 적용 / 외부 결과 도착(Studio 이벤트) / **산출물·보고서를 실제로 받음**(`ResultArtifactsCard onDownloaded`).
- **탭을 열었다고 완료로 바꾸지 말 것.** 가짜 지연 완료(예전 600ms) 금지.
- `activeIdx` 만 상태로 둔다. 실행이 끝나면 **판정 화면(다음 단계)으로 이동**, 판정이 실패면 입력 단계에 남는다.

### 3.2 판정은 통과 / 검토 필요 / 실패 한 가지
- 판정 함수는 **순수 함수 + 테스트**: `utils/<app>Verdict.js` + `.test.js` (`node --test src/utils/*.test.js`).
  - 반환 모양: `{ level: 'pass'|'review'|'fail'|null, title, reasons:[{code,text}], basis }`
  - 기준: Model Builder = `utils/modelBuilderVerdict.js`, GMU = `utils/gmuLiftingVerdict.js`.
- 판정이 두 시점이면 `basis` 로 구분하고 나중 것이 우선(GMU: `validation` → `structural`). `VerdictHeader meta` 에 기준을 적는다.
- 경고 수처럼 판정에 쓰지 않는 값도 **숨기지 않는다** — `KeyFigures` 에 `sub: '판정 미반영'`.
- 외부 프로그램(Electron/Studio)과 판정 규칙을 공유하면 **두 곳을 같이 고친다**고 파일 머리 주석에 적는다.
- 엔진이 오류로 세지 않는 항목을 화면에서 빨간 '오류'로 그리지 말 것(판정 머리와 숫자가 어긋난다).

### 3.3 입력 전에는 오류를 띄우지 않는다
- 파일을 올리기 전: 실행 버튼만 잠그고 회색 안내 한 줄("BDF 를 올리면 열립니다.").
- '필수 파일 없음' 류 점검 항목은 사용자가 입력을 건드린 뒤(`inputTouched`)부터 보인다.

### 3.4 주 실행 버튼은 1개
- 라벨: 실행 전 `○○ 실행` → 결과가 생긴 뒤 `다시 검증`/`옵션 바꿔 다시 실행`.
- `runAction = { label, icon, onClick, enabled, title }` 객체 하나로 만들고 버튼과 단축키가 같이 쓴다.
- 아래: 입력 없으면 안내 한 줄, 있으면 `Ctrl + Enter 로도 실행합니다`. 그 아래 보조 링크(`새 입력으로 시작`, `샘플로 실행`).
- **Ctrl+Enter 는 `currentMenu === 자기 메뉴` 일 때만** — 앱 페이지가 전부 keep-alive 라 다른 화면에서 숨은 페이지가 실행된다.
  ```js
  const runActionRef = useRef(runAction); runActionRef.current = runAction;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      if (currentMenu !== MENU_NAME) return;
      const a = runActionRef.current; if (!a.enabled) return;
      e.preventDefault(); a.onClick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentMenu]);
  ```

### 3.5 긴 후속 작업
- 전체 화면 잠금 오버레이 금지. 해당 패널 안 `JobProgressCard` + 결과에 의존하는 버튼만 잠근다.
- 실패 시 원인·조치는 `VerdictHeader` 에, 원문 로그는 `EngineLogPanel`(접힘)에.

## 4. 첫 화면 (입력 전) — RunStartPanel

```js
const isStartScreen = activeStep.id === 'input' && !hasResult && !running && !failed; // 앱별 조건
```
- 첫 화면에서만 레일의 `xl:self-start` 를 풀고 단계 section 에 `flex-1` → **두 칸 아래 끝이 같다.**
- 입력 칸 아래(또는 빈 미리보기 자리)에 `RunStartPanel`:
  - **진행 순서** — `StepRail` 과 같은 단계 이름, 단계마다 "무엇을 보고 무엇이 나오는지" 1~2줄.
  - **내 최근 실행 5건** — `GET /api/analysis/history/{사번}?program_name=…`. 시각·입력 파일명·판정 칩·
    `[입력 불러오기]`·`[결과 열기]`. 판정 칩은 `utils/dashboardResults.resultHighlight()`(앱이 판정 값을 내면 거기 한 줄 추가).
- 빈 공간을 꾸밈(그라데이션·일러스트·가짜 수치)으로 채우지 않는다. 실제로 쓰는 정보만.

## 5. 다시 열기 · 다시 쓰기

| 기능 | 페이지에 둘 것 | 등록 |
|---|---|---|
| 결과 다시 열기 (My Projects·대시보드·최근 실행) | `applyResultReentry(analysisId)` — `GET /api/analysis/{id}` 의 `result_info` 로 결과 상태 복원 + `useResultReentry(MENU, applyResultReentry)` | `utils/resultReentry.js` 의 `RESULT_REENTRY_MENUS`(메뉴→program_name) + `RESULT_KEYS`(복원 기준 키) |
| 최근 실행 입력 불러오기 | `applyRecentInput(record)` — `input_info` 의 서버 경로로 입력 칸을 채운다. 결과는 열지 않는다. 실패한 실행도 허용 | `RunStartPanel onUseInput / hasInput` |
| 대시보드에서 파일 받기 | `useDashboardFileHandoff`(1개)/`useDashboardFilesHandoff`(여러 개) → 기존 업로드 처리 함수 | `FILE_HANDOFF_MENUS` |
| 대시보드 자동 실행 | `useDashboardAutoRun(menu, ready, run)` — 훅은 run·ready 변수 **선언 뒤** | — |

입력을 채우는 방식은 둘 중 하나:
- **서버 경로로 넘김**(GMU): `handoffBdfPath` + `handoffSource('최근 실행')` → `request-from-path`. 큰 파일을 다시 받지 않는다.
- **받아서 File 로**(Model Builder): `/api/download?filepath=` → `new File([blob], baseName)` → 슬롯 setter. 미리보기·점검·업로드 실행이 직접 올린 것과 같게 돈다. 옵션도 그 실행 값으로 맞춘다.

`handleReset()`(새 입력으로 시작)은 위 두 함수의 첫 줄에서 재사용한다 — 상태 초기화를 한 곳에 둔다.

## 6. 디자인 문법 (대시보드 2026-10 과 같음)

- 보조 텍스트 **최소 11px · slate-500 이상**(비활성 링크도 `disabled:text-slate-500`).
- 금지: 자간 대문자 라벨, 그라데이션 카드, 2px 색 테두리, 측면 색 띠, 이모지, 근거 없는 게이지·% 점수, 가짜 버튼(동작 없는 다운로드 등).
- 카드: `rounded-lg|xl border border-slate-200 bg-white`, 그림자 없음. 판정 색은 `VerdictHeader`/칩에만.
- 링크형 보조 동작: `text-xs font-semibold text-blue-700 underline-offset-2 hover:underline` + `focus-visible:ring-2`.
- 상태는 색 + 아이콘 + 글자를 함께(색만으로 구분하지 않는다).

## 7. 새 페이지 / 개편 체크리스트

1. 기준 페이지 중 가까운 쪽을 복사해 시작(다중 입력·옵션 많음 → Model Builder, 단일 BDF·외부 Studio → GMU).
2. `STEP_DEFS`(id·title·icon) 3개 안팎 + `STEP_INDEX`.
3. 판정 함수 `utils/<app>Verdict.js` + 테스트.
4. 레일: StepRail → InputSummary → 옵션 → 실행 버튼 → 보조 링크. 단축키 `currentMenu` 가드.
5. 작업면: JobProgressCard → VerdictHeader → NextActionBar → 단계 section → EngineLogPanel.
6. 첫 화면 `isStartScreen` + `RunStartPanel`(진행 순서 문구 작성, `programName`, 두 핸들러).
7. `RESULT_REENTRY_MENUS`·`RESULT_KEYS` 등록 + `applyResultReentry`·`applyRecentInput`.
8. 대시보드 파일 전달·자동 실행 훅(파일 입력 앱이면).
9. 판정 값을 내면 `resultHighlight()` 에 한 줄.
10. Studio 를 열면 `StudioLauncherCard` + 버전 핀 규칙(CLAUDE.md 해당 절).
11. 검증: `npx vite build` · `node --test src/utils/*.test.js` · Playwright **1920×1080 / 1366×768** 에서
    빈 화면(두 칸 끝선 같음) → 업로드 → 실행 중 → 완료(판정 화면 이동) → 결과 열기 · 입력 불러오기, 콘솔 오류 0.

## 7.1 적용 현황

| 앱 | 단계 | 판정 근거 | 비고 |
|---|---|---|---|
| HiTESS Model Builder | 입력 검증 → 모델 확인·보정 → BDF 저장·전달 | `modelBuilderVerdict` | 기준 구현 |
| GMU 권상 | BDF 입력 검증 → Studio 권상 검토 → 결과·보고서 | `gmuLiftingVerdict` | 기준 구현 |
| Truss Model Builder (메뉴 `Truss Analysis`) | CSV 입력 → 모델 확인(3D) → BDF 받기 | `trussVerdict.computeTrussBuilderVerdict` — 엔진에 판정 값이 없어 'BDF 가 만들어졌나'만 | 페이지 상태 키는 옛 `'Truss Model Builder'` 유지 |
| Truss Structural Assessment | BDF 입력 → 평가 결과 → 보고서 저장 | `trussVerdict.computeTrussAssessmentVerdict` — 엔진의 부재·하중분산판 `result`, Side Support 는 표와 같은 허용 반력 상수 | 상태는 `DashboardContext.assessmentPageState`(전역) 유지. 실패 리포트의 [원인]·[조치]를 판정 사유로 뽑는다(`parseFailureReport`) |

기존 기능을 옮길 때의 원칙(Truss 개편에서 쓴 방식): 업로드·자동 배정·대시보드 전달/자동 실행·샘플·폴링·전역 작업 동기화·
fresh-entry 초기화 함수는 **본문을 그대로 두고** 화면만 바꾼다. 개편 전에 같은 흐름을 Playwright 로 한 번 기록해 두고,
개편 후 같은 흐름(업로드 → 실행 → 결과 → 3D → 다운로드 → 실패 경로 → 다시 열기)을 다시 돌려 비교한다.

## 8. 하지 말 것 (실제 있었던 문제)

| 하지 말 것 | 이유 |
|---|---|
| 업로드 전 '필수 파일 없음' 오류 표시 | 사용자 지적(2026-10-01) — 입력 전 오류는 부적절 |
| 미리보기 패널에 `h-full` 상속 | 위 업로드 칸만큼 단계 상자 밖으로 밀려남 → 표가 있을 때만 고정 높이 |
| 두 칸 컨테이너에 `flex-1` | 화면 높이까지 늘어나 카드 안 아래가 빔 |
| NextActionBar sticky bottom | 전역 작업·메시지 도크가 주 버튼을 가림 |
| window 단축키에 메뉴 가드 없음 | keep-alive 로 숨은 페이지의 실행이 눌림 |
| 엔진이 세지 않는 항목을 '오류'로 표시 | 판정 '통과'와 숫자 '오류 4' 가 어긋남 |
| 완료 후 1단계로 되돌리기 / 경고 숨기기 | 2026-10-01 사용자가 뒤집은 옛 요구 — 되살리지 말 것 |
| 머리글 없는 CSV 의 첫 줄을 머리글로 쓰기 | Truss NODE/WAY CSV 는 `GRID,…`/`CBAR,…` 로 바로 시작 — 데이터 1줄이 머리글이 되고 개수가 1 적었다 |
| 실행 후 서버 BDF 를 다시 읽어 입력을 '샘플'로 바꾸기 | 직접 올린 BDF 로 '다시 해석'이 꺼졌다(Assessment). 올린 File 이 있으면 결과만 읽는다 |
