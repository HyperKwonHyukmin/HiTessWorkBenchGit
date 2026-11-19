# MU 권상 Studio 개선 3건 — 평가 모드 3단계, U-bolt 독립/종속 전환, 그룹 일괄 삭제 (2026-11-18 계획)

대상: Module Unit Studio(`module-unit-studio`, 연결 메뉴 Group & Module Unit 권상 구조 해석) + WorkBench 판정과 보고서.
진행 순서(합의): ③ 그룹 일괄 삭제 → ① 평가 모드 3단계 → ② 독립/종속 전환(원인 확인부터).

## 착수 전

- MU Studio 저장소에 미커밋 파일 57개(다른 세션 0.0.209~0.0.223 작업)가 있다. 기준점 커밋 여부를 사용자에게 확인한 뒤 시작한다.
- MU 코드를 고치면 버전 bump, zip 재배포, `MODULE_STUDIO_VERSION` 핀 동기화(MU 버전 정책).

## ① 평가 모드 3단계 (Strict / Standard / Advisory)

### 결정

| 모드 | 엔진 형상 판정(Stage 1, 2) | 구조 해석 진행 |
|---|---|---|
| Strict | 엄격 | pass, warn |
| Standard (지금의 Strict OFF) | 완화(warn) | pass, warn |
| Advisory | Standard 와 같음 | fail 이어도 진행 |

- **엔진 판정은 바꾸지 않는다.** Advisory 는 `_posture.json` 에 `strictEvaluation:false` 를 그대로 보내고, 진행 조건만 푼다.
  결과 JSON 과 보고서에 실제 fail 이 남아 '미충족'의 근거가 되고, 엔진 exe 교체가 없다.
- Advisory 에서도 막는 것: **Stage 3 Wire 꼭짓점 없음**(Wire BDF 를 만들 수 없음, bridge `SystemExit`).
- Stage 6 전도 fail 은 진행을 허용하되 표시한다 — Wire BDF 의 앵커 `SPC 12`(COG 근처 노드 1개)가 기울어지려는 힘을 받아
  그 주변 응력이 실제와 다르다. 결과 화면과 보고서에 그 사실을 적고, 가능하면 앵커 반력 크기를 보인다(SPCFORCE 출력 여부 확인 필요).
- 기본값 Standard.

### 설정 유지 (사용자 결정 2026-11-18: 한 번 바꾼 모드는 계속 유지)

- 설정 파일로 둔다. **위치는 Studio 설치 폴더 밖** = `<userData>/viewer-settings/module-unit-studio.json`.
  설치 폴더(`<userData>/viewers/module-unit-studio/`)는 새 버전을 받을 때 `rmSync` 로 통째로 지워져(`electron/index.js` 설치 함수) 안에 두면 업데이트마다 사라진다.
- 없으면 기본값으로 만들고, 있으면 Studio 시작 때 읽는다. 내용 예: `{ "version": 1, "evaluationMode": "standard" }`.
  모르는 키는 보존하고, 깨진 파일은 기본값으로 읽되 덮어쓰기 전에 `.bak` 로 남긴다.
- 통로: Electron IPC `viewer:getSettings` / `viewer:setSettings`(viewerId 는 기존 `getViewerDir` 와 같은 글자 제한) → preload `workbenchAPI.getStudioSettings/setStudioSettings`.
  **새 exe 가 필요하다.** 옛 exe 는 IPC 가 없으므로 Studio 가 localStorage(`mu.hoist.strictEvaluation.v1` 를 이어받는 새 키)로 대신한다.
- 옛 localStorage 값 이전: true → strict, false → standard. 파일이 있으면 파일이 우선.
- 기억되는 모드라 Advisory 일 때는 Hoist 패널 배너와 3D 상단 칩으로 늘 보인다(조용히 남지 않게).
- 다른 Studio 설정도 같은 파일에 넣을 수 있게 키 이름은 일반적으로 둔다(이번에는 evaluationMode 만).

### 바꿀 곳

1. Studio store: `strictEvaluation`(boolean) → `evaluationMode`. 엔진 전달값은 `strictEvaluation = mode === 'strict'` + `evaluationMode` 추가.
   모드를 바꾸면 기존처럼 평가 결과를 무효화(`useStabilityStore.reset()`). Standard ↔ Advisory 는 엔진 입력이 같아 결과를 지우지 않아도 된다.
2. Studio 화면: 3단 선택 컨트롤(`StrictEvaluationControl` 대체), 진행 조건 4곳 —
   `hooks/useUnitStructuralRunner.js`, `HoistPositionPanel` 푸터, `UnitStructuralPanel`, `utils/structuralDownloads.js`(Wire BDF 받기).
   진행 조건 규칙은 순수 함수 하나로 모으고 시험(`data/evaluationMode.js`).
3. Studio 결과: 결과 도크와 판정 패널에 '자세안정성 미충족 상태로 진행(Advisory)' 띠, 전도 fail 이면 앵커 안내.
4. WorkBench `utils/gmuLiftingVerdict.js` ↔ Electron `viewer:runUnitStructural` status 계산(사본): Advisory + 자세안정성 fail 이면 최소 '검토 필요'.
5. 보고서 `unit_lifting_report/collector.py`·`builder.py`, 결과 레포트(사내 서식): posture JSON 의 `evaluationMode` 를 읽어 요약에 미충족 표시.
   결과 레포트 1페이지 여유가 작아(높이 20pt) 넣을 자리는 실제 PDF 로 확인한다.
6. 지난 해석 보기, 실적 보기 창도 같은 띠(결과 세트의 stability 로 판단).

## ② U-bolt 종속 노드를 체결 위치로 고를 때 독립/종속 자동 전환

### 먼저 원인 확인

- 신고: U-bolt RBE 의 종속 노드를 체결 위치로 고르면 '경계조건 중복 FATAL'.
- 코드상 Wire BDF 는 lug 에 SPC 를 직접 두지 않고, 앵커 후보에서도 lug 와 RBE 노드를 뺀다. 어떤 FATAL(2101, 5289 등)인지 모른다.
  70 권상 F06 7개에는 사례 없음. → 145 진단 기록(`scripts/pull_diagnostics.py`) 또는 신고 작업 폴더의 F06 확보, 재현 BDF 로 확인한 뒤 구현.

### 구현 (원인이 전환으로 풀리는 경우)

- 권상점 확정 시점(Shift+클릭 추가, 자동 추천 적용, 권상점 옮기기)에 그 노드가 RBE 종속이면 intent `swapRigidIndependent { rigidId, newIndependent }` 를 같은 `batchId` 로 추가.
  권상점을 빼면 전환도 함께 취소. MU 는 Studio JS 가 `_edited.json` 에 반영(`data/nodeEdits.js` 의 RBE 편집 경로) — bridge, C# 수정 없음.
- **자동 전환 조건**: `cm=123456` 이거나 종속이 그 노드 하나뿐인 RBE2. 이때는 바꿔도 같은 강체다.
- **그 밖(부분 cm + 종속 여러 개)** 은 전환하면 다른 종속들이 lug 를 따르게 돼 같은 모델이 아니다 → 자동 전환 대신 '그 RBE 의 독립 노드를 체결 위치로 쓰기' 안내.
- 전환 불가: 새 독립 노드가 다른 RBE 의 종속이기도 한 경우(종속 중복) → 안내만.
- 화면: 권상점 칩과 3D 에 'U-bolt RBE 독립 노드로 바꿈' 표시, 수정 내역에 한 줄.
- 짝 MB: 권상 없음 → 싱크 대장 '해당 없음'.

## ③ 연결 그룹 일괄 삭제

- Edit 탭 그룹 목록에 체크박스 + [전체 선택] [선택 해제] [선택한 N개 삭제]. 기존 `deleteGroup` intent 를 그룹마다 하나씩, 같은 `batchId`(Ctrl+Z 한 번).
- [전체 선택] 은 그룹 1(본 구조)을 뺀다. 직접 체크는 허용.
- 확인 창은 앱 안 `confirmAction`(네이티브 창 금지). 권상점이 있는 그룹이 섞이면 '평가 결과가 지워짐' 을 확인 창에 적는다(`invalidateHoistResults` 기존 규칙).
- 이미 삭제 예약된 그룹은 체크 대상에서 빼고, 휴지통 단추(하나씩 삭제, 되살리기)는 그대로 둔다.
- Model Check 그룹 목록에는 넣지 않는다(그쪽 클릭 = 숨김, 11-10 숨김을 삭제로 안 사고).
- 짝 MB: 같은 그룹 목록 → 싱크 대장 보류, MB 공개 뒤 `/studio-sync`.

## 진행 기록

- 2026-11-18 기준점 커밋 MU `238b2a3`(0.0.206~0.0.223 미커밋 작업, 시험 1037).
- 2026-11-18 ③ 구현(MU 미커밋, 버전 bump 와 배포 전): `data/groupBulkDelete.js`(+시험 4) · `useEditStore.deleteConnGroups` · `components/GroupManager.jsx`.
  고를 그룹이 2개 미만이면 체크박스를 숨긴다(첫 화면 점검에서 그룹 1개 샘플에 체크박스가 혼자 뜸).
  확인: 시험 1041 · eslint · 빌드 · 헤드리스(`outputs/MU-manual/source/smoke_group_bulk.mjs`, MB 샘플 3454 그룹 9개 = `model/MB3454.json`) —
  [전체 선택] 8/9(본 구조 제외), 확인 창 문구, 같은 batchId 8건, Ctrl+Z 한 번에 0건. 권상점이 든 그룹 문구와 WorkBench 앱 안 화면은 확인 안 함.
  싱크 대장 48번 보류.

- 2026-11-18 ① 구현(MU, WorkBench 미커밋, 버전 bump 와 배포 전):
  - Studio: `data/evaluationMode.js`(+시험 7, 규칙 원본 — `stabilityGate`·`advisoryNotice`·`hasWireApex`) · 스토어 `evaluationMode`(엔진 값 `strictEvaluation` 은 계산) ·
    `hydrateEvaluationMode`(App 시작 때 설정 파일) · host `getStudioSettings/setStudioSettings` · Hoist 3단 선택(`StrictEvaluationControl` 자리) ·
    진행 조건 = `useUnitStructuralRunner`, Hoist 푸터, `structuralDownloads.liftingBdfAvailability(gate)` · Analysis `AdvisoryBanner` · `_posture.json evaluationMode` · 화면의 'Strict OFF' 문구를 Standard 로.
    `UnitStructuralPanel.jsx` 는 어디서도 쓰지 않아(옛 floating 패널) 문구만 바꿨다.
  - Electron: `electron/studio-settings.js`(+시험 4) · IPC `viewer:getStudioSettings`/`viewer:setStudioSettings`(viewerId 는 창 세션에서) · preload ·
    `viewer:runUnitStructural` status 에 `resultInfo.stabilityGate.unmet` → 최소 WARN(프론트 `gmuLiftingVerdict` 사본).
  - 서버: `services/stability_gate.py`(+시험 5) — 구조 해석 결과 `result_info.stabilityGate = {overall, evaluationMode, failingStages, tippingFail, unmet}`
    (모드 = stability JSON `meta.sourceFiles.posture` 의 `evaluationMode`, 없으면 `strictEvaluation`). Studio 요청은 바꾸지 않았다.
  - WorkBench 판정 `utils/gmuLiftingVerdict.js`: unmet 이면 구조 PASS 도 '검토 필요 · 자세안정성 미충족', 사유 맨 앞 줄(+시험 3). 재진입은 DB `stabilityGate` 를 넘긴다.
  - 보고서: collector `StabilityInfo.evaluation_mode`·`advisory_unmet`, '먼저 확인할 사항' 맨 앞 줄, 상세 1.5 판정 기준 '평가 모드', 3.3 주석(전도 fail 이면 앵커 주석),
    결과 레포트 주의 사항 5행 = `NOTICE_ADVISORY_LINE`(사용자 입력 줄은 싣지 못하고 경고로 알림 — 서식 1페이지 높이 여유가 없어 줄을 늘리지 않음)(+시험 4).
  - 확인: Studio 시험 1053 · 빌드 · 바꾼 파일 eslint(실행 훅의 예전 오류 3건은 그대로) · WorkBench 유틸 시험 562 · 프론트 빌드 · Electron 시험 67 ·
    서버 보고서와 판정 시험 · 헤드리스(`smoke_eval_mode.mjs`): 3단 선택, 새로고침 뒤 유지(localStorage), Advisory 전도 FAIL → 다음 단추와 구조 해석 단추 열림, 배너, Standard 면 막힘, Strict 로 바꾸면 결과 무효화.
  - 확인 안 함: 실제 Electron 에서 설정 파일 쓰기와 다시 읽기(대역과 단위 시험만), Advisory 로 실제 Nastran 해석, 결과 레포트 PDF 모양, 지난 해석 보기와 실적 보기 창의 Advisory 표시(그 창은 지금 사용자의 모드로 판단 — 손대지 않음).

- 2026-11-18~19 ② 결론과 바꾼 요청: 신고된 FATAL 은 실제 사고가 아니었다(사용자). 70 에서 재현을 시도했다 — 3469 M02 Wire BDF 에서 권상점 N2016, N535 가 RBE2 종속 노드인데
  Nastran 정상 종료(FATAL 0), U-bolt 처럼 cm=123 으로 바꿔도 정상, RBE 917 의 독립·종속을 바꿔도 정상이고 Wire 축력·전 절점 변위가 같았다(`outputs/ubolt-dep-node-test/`).
  이유: Wire 는 구속이 아니라 요소(CROD)라 종속 자유도를 두 번 없애지 않는다. 구속은 Wire 반대쪽 훅 꼭짓점과 COG 앵커(RBE 노드 제외)에만 있다. FATAL 은 체결 위치에 SPC 를 직접 걸거나(2101) RBE 거미줄로 훅을 묶을 때(5289) 난다.
  → 자동 전환은 넣지 않고, 사용자 요청대로 **수동 '독립 · 종속 바꾸기' 도구**를 만들었다(`docs/apps/module-unit-studio.md`).

- 2026-11-19 마무리: MU 0.0.225, MB 0.1.14·0.1.15 를 145 에 공개(`9a84c3d`, `c39b8aa`, `1e2405e`), 업데이트 안내 2건(`43fab3e`, 새 명령 `/update-notice`), 커밋 WorkBench `aaac783` · MU `cacb90a` · MB `a2c2a77`.
  남은 일과 확인 안 한 것은 `docs/apps/module-unit-studio.md` 해당 절 '상태'.

## 확인 계획

- 순수 함수 시험: 진행 조건(모드 × stage 상태), 설정 파일 읽기와 이전, 전환 조건, 일괄 삭제 batch.
- 헤드리스 Chrome + `workbenchAPI` 대역: 모드 전환과 유지, Advisory fail 진행, 일괄 삭제와 Ctrl+Z.
- Advisory + 전도 fail 모델로 실제 Wire BDF Nastran 1회(앵커 반력 확인), 보고서 PDF 1회.
- ② 는 재현 BDF 로 전환 전 FATAL, 전환 뒤 FATAL 0.

## 배포 영향

- MU zip(70 로컬) → `/studio-release module-unit-studio` 로 145 공개.
- WorkBench: 판정, 보고서 = 145 `git pull + 재시작` · Electron IPC(설정 파일, status 계산) = 새 exe.
- 엔진, InHouse 교체 없음.
