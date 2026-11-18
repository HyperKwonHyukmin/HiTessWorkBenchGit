# Module Unit Studio (GMU 권상)

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### Module Unit Studio

viewer id=`module-unit-studio`, 연결 메뉴 = "Group & Module Unit 권상 구조 해석".
- ★ **MU Studio 개선 요청을 받으면 먼저 `ModuleUnitStudio/docs/plans/2026-10-29-mb-features-to-mu.md` 를 본다** (2026-10-29 사용자 지시).
  MB Studio 의 셸 규칙·편집 작업 패널·도움말·기본 모델 편집을 MU 로 넓히는 단계(0 저장소 정리 → 1 셸 → 2 편집 바탕 → 3 편집 기능 → 4 도움말)와 결정 대기 항목이 있다.
  요청이 그 항목과 겹치면 MB 구현을 기준으로 맞추고 문서의 '진행 상태' 표를 갱신한다.
  ⚠ MU 는 Studio 가 JS 로 편집을 적용해 `_edited.json` 을 올린다(`buildEditedStageJson`) — MB 처럼 C#·bridge 에 새 kind 를 넣는 작업이 아니다.
- ⭐ **버전 정책 (사용자 지시, 무조건):** Module Unit 코드를 고치면(스튜디오든 엔진 `ModuleUnitAnalysis`든) **항상 `module-unit-studio` 버전 bump → zip 재배포 → `GroupModuleUnitLiftingAnalysis.jsx` 의 `MODULE_STUDIO_VERSION` 동기화**를 세트로 한다. 핀은 표시용 기본값이고 받는 버전은 릴리스 표(`studio_release.json`)가 정한다(2026-10-29) — 그래도 화면 표시가 어긋나지 않게 같이 올린다. 절차는 `/deploy` 스킬.

#### MB 와 사용법 통일 (0.0.175~0.0.179, 2026-11-02)

셸 규칙·선택·작업 패널·도구 막대·도움말과 편집(삭제·질량·단면·부재·노드)을 MB 와 같은 사용법으로 맞췄다. 사용자 지시: **두 Studio 의 사용 방법은 일관돼야 한다.**
상세·결정·남은 일 = `ModuleUnitStudio/docs/plans/2026-10-29-mb-features-to-mu.md`. 커밋 `134ef8f`~. 릴리스 표 **0.0.180**(`251812a`, 2026-11-02, UNC 업로드·검증됨) — 145 ⟳ Update 는 사용자 몫, InHouse 교체 없음. 화면은 Chrome + `workbenchAPI` 대역(샘플의 실제 엔진·Nastran 결과)으로 편집 전 작업·패널 3D 고르기·가서포트 설치·평가·해석 버튼까지 실행했다. WorkBench 앱 안 실행·수정 뒤 실제 Nastran 재해석은 확인 안 함.
- ⚠ **유체 제외 intent 는 메모리 밀도와 짝이다 (0.0.180, 2026-11-02)** — 회전처럼 보호한다(`STATE_BOUND_INTENTS`: 전체 초기화·Ctrl+Z·수정 내역으로 안 지워짐, Hoist 복원은 `removeIntent(id, { force: true })`). 전에는 기록만 지워져 화면·자세안정성은 유체 제외, 구조 해석은 원본 BDF(유체 포함, 샘플 6.99 t ↔ 11.93 t)로 갈라졌다(0.0.174 부터 있던 문제).
  평가·추천에서 `_edited.json` 을 올리면 `editedModelUploaded` 를 세워 내역이 비어도 해석 전에 다시 올린다.
  **남은 문제**: 서버 `<stem>_edited.json` 은 지우는 곳이 없어, Studio 를 다시 열어 편집 0건이면 이전 세션 파일이 구조 해석에 쓰일 수 있다(코드 경로만 확인, 재현 안 함. 고치려면 백엔드 호출 필요). MB 유체 항목도 같은 구조인지 조사 안 함.
- 사용 설명서 = `outputs/MB-manual`·`outputs/MU-manual`(git 미추적). **문서 버전은 Studio 버전과 별개**(사용자 지시, 2026-11-02) — 개선할 때마다 `outputs/manual-tools` 의 `node make.mjs <MB|MU> --bump "변경 내용" [--studio X]` 로 올린다.
  **MU 설명서 사용자 제공 (2026-11-09, 사용자 결정: 모달 포함 · git 에 넣음)** — `make.mjs` 가 PDF + 웹판(한 파일 HTML)을 만들고 `publish.py MU` 가
  ① 백엔드 `Manuals/module-unit/`(manual.html · **manual.pdf.gz** · manual.json, git 추적) → `routers/manuals.py`(`/api/manuals/{id}`, `/web`, `/pdf`, 로그인 필요) →
  GMU 페이지 배너 'Studio 사용 설명서'(`components/ui/StudioManualButton.jsx`, 모달 iframe srcDoc + PDF 받기) ② Studio `public/manual/index.html` →
  **상단 탭 줄 바로 뒤 '설명서' 버튼(초록) → 3D 옆 오른쪽 패널** `components/help/ManualDock.jsx`(0.0.200~0.0.201, 2026-11-09 사용자 결정 —
  도움말 메뉴 안 모달은 숨어 있고 화면을 다 가려 버렸다. 오른쪽 끝 버튼도 못 찾아 탭 뒤로 옮김). 탭 따라가기(기본 켬)·목차/지금 탭·폭 끌기(localStorage),
  쪽 이동은 iframe 을 다시 읽지 않고 `postMessage({manualSection})`(`data/manualSections.js`). 탭 `?` 팝오버·도움말 메뉴도 이 패널을 연다(도움말 창의 설명서 탭은 없앰).
  웹판은 폭 ≤760px 에서 A4 틀을 풀고 글을 다시 흘린다(`web_build.py` `@media`, 표지 숨김 — 넓은 WorkBench 모달은 그대로). 별도 창은 모니터 2대일 때만 이득이라 보류(exe 변경 필요).
  설명서를 고치면 publish 뒤 **Studio 버전 bump·배포**가 따라야 Studio 안 설명서가 바뀐다.
  상태(2026-11-09): MU `a76b250` · 릴리스 표 0.0.201(`352db9d`) · WorkBench 1.7.11 exe(`048a358`, GMU 설명서 버튼·CSP 글꼴) 빌드. 145 ⟳ Update+재시작·exe 배포는 사용자 몫,
  WorkBench 앱 안 Studio 창·Electron PDF 저장 대화상자는 눈으로 확인 안 함. 다음 후보: 실적 '크게 보기' 패널과 함께 열면 서로 폭을 몰라 3D 가 좁아짐 · 패널 단추 data-help.
  **MB 도 같은 방식 (2026-11-09, 사용자 지시 'MU 와 동일하게')** — `publish.py MB` → 백엔드 `Manuals/model-builder/` + Studio `apps/model-studio/public/manual/`,
  HiTESS Model Builder 배너 버튼(`manualId="model-builder"`) · Studio 0.1.4 `ManualDock`(MU 사본, 색만 `palette(theme)` — MB 는 밝은/어두운 화면) · 쪽 대응 `data/manualSections.js`(탭 csv → `csv`).
  설명서 문서 버전 02(기준 0.1.4): 코드 대조 검토로 Ctrl+드래그 = 선택 빼기·`RBE 만들기 (노드 N개)`·정보 도크 자동 열림을 바로잡음. 전체 화면 그림은 캡처 원본 모델이 없어 새 버튼 조각만 합성(원본 `source/probe/overview_v01.png`).
  설명서 패널로 3D 가 좁아지면 뷰포트 위 CSV·COG 알림이 세로로 깨지던 것 수정(`ThreeViewport` 알림 최소 360px). 다시 찍기 = `MB-manual/source/caps_manual.mjs`(5199 dev 서버 + `MB_MODEL=<상대 경로>`, 저장소 샘플 3454).
  상태: Studio `29d82d8` · WorkBench `87e4ea5`(설명서·버튼) · 릴리스 표 0.1.4(`467316d`) · WorkBench 1.7.12 exe(`5ea7430`) 빌드. 145 ⟳ Update·exe 배포는 사용자 몫, Electron 앱 안 화면은 눈으로 확인 안 함.
  ⚠ PDF 를 평문으로 git 에 넣으면 안 된다 — 이름을 .bin 으로 바꿔도 DRM 이 1분 안에 내용(PDF)을 보고 다시 감싼다(실측). gzip 은 감싸지지 않아 `.pdf.gz` 로 두고 서버가 푼다(`test_repo_manual_is_plain_pdf`).
- ⚠ `/studio-release` 의 출처 `release` zip 도 DRM 에 감싸질 수 있다(크기 +4096, `HHIDRMC`, 검증 `MISMATCH CORRUPT`, 0.0.180 실례). `dist` 를 메모리에서 묶어 UNC 에 직접 쓴다(`outputs/MU-manual/source/zip_to_unc.mjs`).
- Hoist 탭은 그대로 Shift+클릭 = 권상점, Edit 탭은 MB 규칙(클릭 = 하나, Shift = 넣기/빼기, Shift+드래그 = 사각형).
- ⚠ 뷰포트의 `stageData` 는 파생 모델(`data/nodeEdits.js`)일 수 있다. 질량 기준값은 `baseStage()` 원본으로 낼 것 — 파생으로 내면 증감이 두 번 들어간다.
- ⚠ 커밋 전 eslint 를 돌릴 것 — 렌더 시험·빌드가 통과해도 no-undef 로 화면이 터지는 것을 eslint 만 잡았다.
- 지운 부재·그룹·질량, 질량·단면·부재·노드 편집은 자세안정성 입력 질량에 반영된다(엔진은 `_edited.json` 을 질량에 쓰지 않는다).
- **원본 RBE 수정·삭제 (0.0.202, 2026-11-10, 릴리스 표 `cbe3180`)** — 도구 막대 RBE › 수정 · 삭제. intent `deleteRigid`(MB 와 같은 kind)·`editRigidDependents`(Mooring 과 같은 kind).
  ⚠ 두 편집은 **파생 모델(`nodeEdits.applyNodeEdits`)의 `rigids`** 에 들어간다 — 편집과 함께 RBE 를 읽는 새 코드는 원본 `stage.rigids` 가 아니라 `mask.stage`·`applyNodeEdits` 를 볼 것.
  수정 내역 중간 삭제로 종속이 겹치면 뒤쪽 RBE 편집을 함께 취소한다. 상세·결정 = MU 계획 문서 '원본 RBE 수정·삭제'.
- **RBE 묶기 — 노드 위치·독립 노드 고르기 (0.0.210~0.0.211, 2026-11-11, 70 로컬만·미커밋)** — 사용자 지적: 패널이 `Node #1302` 번호만 보여 어느 노드인지 모름, 독립·종속을 자유롭게 바꾸기 어려움.
  3D 는 RBE 수정과 같은 그림(`three/RigidEditHighlight.js`, 아직 없는 중심점은 `hubPos`) — 독립 주황 + '독립 N… · 질량' 이름표, 종속 파랑 번호(점 아래), RBE 에 걸려 빠지는 노드 빨강.
  목록 줄 = 새 노드·질량·RBE 걸림 태그·좌표·[보기]·[×]. 독립 = store `rigidIndependent`(줄 클릭 · 3D Alt+클릭 · [3D 에서 독립 노드 고르기] 뒤 클릭 — 안 고른 노드면 넣으면서),
  기본값 = 질량 노드 → 새 노드 → 첫 노드(`data/rigidAddCandidates.js`), 질량 노드가 독립이면 Remark MASS. 실패 안내 [RBE 로 잇기]는 `openRigidDialog({ independentNode })`.
  **작업 패널이 열린 동안 3D 오른쪽 클릭(끌지 않음) = 빼기**(모든 패널, 오른쪽 끌기는 화면 이동 그대로). 수정 내역이 바뀌면 모델에 없어진 노드·질량을 선택에서 자동으로 뺀다(`useEditStore` 끝 subscribe — '종속 노드 2898 이 StageData 에 존재하지 않습니다' 의 원인).
  [보기]·찾기 화면 이동은 떠 있는 작업 패널을 비켜 대상을 놓는다(`ThreeViewport` `shiftClearOfWorkPanel`). 이름표 크기가 0.0.204 부터 두 배였던 결함도 고침(px 30·27).
  0.0.211 은 다른 세션 변경(실적 보기 Wire·Node 끄기)과 합친 판.
- **추가한 질량 다시 보기·고치기 (0.0.212, 2026-11-11, 70 로컬만·미커밋)** — 사용자 지적: 노드에 질량을 넣은 뒤 확인할 곳이 없음.
  '지금 살아 있는 질량' = `data/applyEditIntents.js` `collectLiveMasses`(원본 + addMasses, changeMasses·deleteMasses 반영) — 정보 패널 '이 노드의 질량'(`InspectorPanel`)·말풍선(`PickTooltip`)·값 수정 패널·선택·검증이 함께 쓴다.
  추가 질량도 changeMasses·deleteMasses 대상이고 `computeDeleteMask.addedMasses` 에 반영돼 `_edited.json`·질량 요약·자세안정성이 같은 값을 쓴다. 3D 는 질량 상자에 추가 질량을 함께 그려 클릭된다(`three/MassMarkers.js` `syncMassMarkers` — 장면 재빌드 없이 바꿈, '질량' 레이어가 꺼져 있어도 분홍 점은 남김).
  ⚠ 뷰포트 모델(`applyViewEdits`)의 `pointMasses` 에는 넣지 않았다 — 파생 모델로 질량을 내는 곳이 있으면 두 번 더해진다. `three/MassMarkers.js` 는 MB 와 `same` 이라 MB 에도 복사(인자 기본값, MB 동작 불변).
  확인: MU 시험 1023 · 헤드리스로 추가→3D 클릭 선택→값 수정→정보 패널·말풍선·질량 요약. WorkBench 앱 안 화면은 눈으로 확인 안 함. 145 공개(`/studio-release`)·커밋은 사용자 몫. 짝 싱크 대장 16·17번 보류.

#### 평가 모드 3단계 · 그룹 일괄 삭제 (MU 0.0.224, 2026-11-18, 70 로컬만 — 미커밋, 145 미공개)
계획과 진행 기록 = `docs/plans/2026-11-18-mu-evaluation-mode-rbe-swap-group-bulk.md`. 남은 일 = ② U-bolt 종속 노드를 체결 위치로 고를 때 독립/종속 전환(145 F06 로 FATAL 원인부터).
- **평가 모드 = Strict / Standard(기본, 옛 Strict OFF) / Advisory** — 'Strict 평가' 토글을 대신한다. 규칙 원본 = MU `data/evaluationMode.js`(`stabilityGate`).
  **엔진 판정은 바꾸지 않는다** — Advisory 는 엔진에 Standard 와 같은 값(`strictEvaluation:false`)을 보내고 진행 조건만 푼다(엔진 exe 교체 없음). Wire 꼭짓점(Stage 3)이 없으면 Advisory 도 막는다.
  고른 모드는 계속 유지(사용자 결정) — `<userData>/viewer-settings/<viewerId>.json`(Electron `studio-settings.js`, IPC `viewer:getStudioSettings/setStudioSettings`, **설치 폴더 밖** — 설치 폴더는 Studio 업데이트 때 지워진다). 옛 exe 는 localStorage.
  서버가 구조 해석 결과에 `result_info.stabilityGate`(`services/stability_gate.py`, 모드는 옆 posture JSON 에서) → WorkBench `gmuLiftingVerdict` 와 Electron status 사본이 unmet 이면 최소 '검토 필요' → 보고서(상세 '먼저 확인할 사항' 첫 줄, 결과 레포트 주의 사항 5행 — 사용자 입력 줄은 그때 빠지고 경고).
- **그룹 일괄 삭제** — Edit › 그룹 체크박스, [전체 선택](본 구조 제외), 같은 batchId(Ctrl+Z 한 번), 고를 그룹이 2개 미만이면 체크박스 숨김. 싱크 대장 48(보류)·49(해당 없음).
- 반영 = 145 `git pull + 재시작`(stabilityGate) · 새 exe(설정 파일 IPC, Electron 판정) · `/studio-release module-unit-studio`. 확인 안 함: 실제 Electron 설정 파일, Advisory 실제 Nastran, 결과 레포트 PDF 모양.

#### 가서포트 제거 (MU 0.0.223, 2026-11-12, 릴리스 표 `e955792` — 145 ⟳ Update 는 사용자 몫, MU 저장소 미커밋)
도구 막대 가서포트 › 제거 = `components/SupportRemovePanel.jsx`(줄마다 [보기]·[제거], [모두 제거] 확인 창). 가서포트는 3D 선택 대상이 아니라 목록에서 고른다. 제거 = 설치 intent 를 지움(Ctrl+Z 로 안 되살아남), 구조 해석 결과만 비움.
MB 에는 가서포트가 없어 싱크 대장 23번 '해당 없음'. 헤드리스 E2E 통과, WorkBench 앱 안 화면은 눈으로 확인 안 함.
⚠ 이 빌드의 `.sha256` 이 출처·70 로컬·UNC 세 곳 모두 97바이트 전부 NUL 이었다(zip 은 정상, 원인 미상 — 11-09 소스 NUL 사건과 같은 모양). `verify-studio-zips.ps1` 가 MISMATCH 로 잡았고 zip 해시로 다시 썼다. 빌드 뒤 `.sha256` 내용을 확인할 것.

#### 카메라 유지 · 질량 정보 탭 (MU 0.0.219~0.0.222 · MB 0.1.11~0.1.12, 2026-11-11, 릴리스 표 `cb0813e` — 145 ⟳ Update 는 사용자 몫, 두 Studio 저장소 미커밋)
- **편집으로 모델만 바뀌면 카메라를 옮기지 않는다** (MU `ThreeViewport`) — 노드 만들기(기준 노드에서 변위 등) 때마다 화면이 무게중심으로 튀었다(사용자 지적).
  원인: 편집이 파생 StageData 객체를 새로 만들 때마다 회전 중심 = 무게중심 효과가 다시 돌아 카메라를 끌어왔고, 더블클릭으로 정한 회전 중심도 풀렸다.
  이제 원본(`baseStage`)·해석 결과·유체 비움·회전이 바뀔 때만 카메라를 맞춘다. 화면 고정(fitCamera)은 이미 같은 규칙이었다. 헤드리스로 수정 전 37% → 수정 후 0% 화면 변화 확인. MB 에는 이 효과가 없다.
- **질량은 '정보' 탭에 바로 보인다** (MU `RightDock`·`MassEditPanel`·`data/infoDockFocus.js`) — 사용자 지적: 정보 탭에 질량이 있는지 어떻게 아나.
  질량 추가·값 수정 직후 첫 질량을 골라 '정보' 탭을 연다. 질량점·질량 걸린 노드를 고르면 '표시' 를 보던 중이어도 '정보' 로 넘긴다 — **셸 규칙 6('표시' 중엔 점만)의 예외는 질량뿐**, 다른 대상은 그대로 점만. MB 로는 아직 안 옮김(대장 22번).
- MB 는 같은 날 짝 싱크로 MU 기능을 받았다: RBE 묶기 노드 정보·독립 고르기(Alt+클릭·줄·3D 주황 이름표, 3개 이상이면 방식 단추) · [처음부터] · 정보 패널 '이 노드의 질량' · 작업 패널 중 오른쪽 클릭 = 빼기. 상세 = 싱크 대장 1~18번.
  MB 에 아직 없는 것: [보기] 화면 이동이 아래 작업 패널을 비켜 놓기(MU `shiftClearOfWorkPanel` — MB 는 패널이 노드를 가림).
- 확인: MU 시험 1035 · MB 시험 676 · 둘 다 빌드 · 헤드리스(MB 샘플 3454: [처음부터]·정보 패널 질량·RBE 묶기 패널). **WorkBench 앱 안 화면은 눈으로 확인 안 함**, Alt+클릭·오른쪽 클릭은 실제 마우스로 안 눌러 봄, 그룹 11개 넘는 MU 모델로 그룹 목록 안 봄.

#### 처음부터 · 권상점 옮기기 (0.0.213~0.0.218, 2026-11-11, 릴리스 표 `f0b721f`·Studio 저장소 미커밋)

- **전체 초기화 = 상단 탭 줄 Save 바로 오른쪽 [처음부터]**(0.0.216 사용자 지시 — 오른쪽 끝은 잘 안 보였다. 어느 탭에서나, 실적 보기 창은 숨김). 로직 `hooks/useFullReset.js`(+시험). Model 탭 머리의 작은 초기화 단추는 없앴다 — 되살리지 말 것(찾지 못했다). Hoist 패널의 '초기화'(권상점만)는 그대로.
- **권상점 옮기기** — 자동 추천 뒤 권상점 번호(N…)를 누르고 3D 에서 Shift+노드 클릭하면 그 자리만 바뀐다(순서 유지·다른 그룹 권상점 거부·Esc 취소, 칩 × = 빼기). 옮기면 자세안정성·구조 해석 결과를 비운다.
  0.0.214(사용자 결정): **권상점을 바꾸는 모든 동작**(Shift+클릭 더하기·빼기, × 빼기, 그룹 비우기, 권상점 있는 그룹 삭제, 옮기기)이 결과를 비운다 — `useEditStore` `invalidateHoistResults`.
  빈 그룹 삭제·바뀐 것이 없는 호출은 결과를 그대로 둔다(빈 그룹 삭제는 예전처럼 wire 재정렬만). 권상 방식 바꾸기(`setHoistMode`)는 이번에 손대지 않았다.
- **Hoist 3D 안내 = 오른쪽 위 여러 줄**(0.0.215, 사용자 요청 '조작 설명이 뷰어에 적혀 있어야') — `shell/ViewportHintBar.jsx` + 문구 `shell/hoistHint.js`(+시험):
  Shift+노드 = 추가 · 다시 Shift+클릭 = 해제 · 번호 클릭 → Shift+노드 = 옮기기, 옮기는 중엔 옮김·Esc 취소, 평가 결과가 있으면 '바꾸면 결과가 지워짐' 주의 줄.
  같은 자리에 겹치던 `HoistInstructionOverlay.jsx` 는 지웠다. 가운데 두면 왼쪽 위 보기 도구줄·배치 안내를 덮어 오른쪽 위로 옮김 — 좁은 창(≤1280)에서 도구줄과 닿는지는 확인 안 함.
- 확인: MU 시험 1031 · 빌드 · 헤드리스 Chrome 에서 번호 클릭 → Shift+클릭 → 옮김, Esc 취소, [처음부터] 확인 창 → Model 탭·모델 재로드, 탭 줄 1600·1280·1024 넘침 없음. WorkBench 앱 안 화면은 사용자 확인 중. 싱크 대장 18(보류)·19(해당 없음).
- **네이티브 확인 창 금지 (0.0.217)** — WorkBench(Electron, Windows) 에서 `window.confirm`·`alert` 를 닫으면 그 뒤 입력칸에 글자가 안 들어가는 경우가 있다
  (사용자 신고: [처음부터] 확인 → 노드 '기준 노드에서 변위' 칸 먹통. 헤드리스 Chrome 에서는 재현 안 됨 — Electron 의 알려진 포커스 문제로 판단, Electron 안 재현은 안 함).
  MU 의 9곳을 앱 안 확인 창으로 바꿨다 — `store/useConfirmStore.js`(`confirmAction`·`notify`, 열린 동안 키를 먼저 받아 작업 패널 Enter·Esc 로 새지 않게) + `components/ConfirmDialog.jsx`(SidePassage 판 이식).
  새 코드도 쓰지 말 것 — `store/nativeDialogs.test.js` 가 잡는다. **MB 도 같은 날 옮김(0.1.10, 9곳 + 뷰 프리셋 이름 `askText`)** — 세 파일은 짝 Studio `same`(싱크 대장 20).
  **WorkBench 프론트 10곳은 다음 exe 릴리스 때 같은 방식으로 바꾼다**(사용자 결정 2026-11-11 — exe 재빌드가 필요해서). MB 점검 = `outputs/MB-manual/source/smoke_confirm.mjs`.
- 화면 점검 스크립트(2026-11-11, git 미추적) — `outputs/MU-manual/source/smoke_inputs.mjs`(편집 도구 10개 패널 입력칸 47개에 글자 넣기) · `smoke_flow.mjs`(권상점 → 평가 → 옮기기 → 재평가 → 구조 해석 → 보고서 창 입력 → [처음부터] → 한 번 더).
  둘 다 처음 상태와 [처음부터] 뒤를 돌고 화면 오류·네이티브 창을 실패로 센다. 실행 = MU 폴더에서 `npx vite --port 5198 --strictPort --host 127.0.0.1` 후 `node smoke_*.mjs`(lib.mjs = 헤드리스 Chrome + 샘플 결과 대역).
  처음 돌렸을 때 찾은 것: 고르기 칸 테두리 `border`/`borderColor` 섞어 쓰기 React 경고(`edit/nodePick.jsx`) · 평가 뒤 ② 가 접혀 3D 안내의 '왼쪽 번호' 가 안 보임(안내에 ② 단계 이름 추가).
- 배포: 70 로컬 zip MU 0.0.218 · MB 0.1.10 · 핀 둘 다 동기화. 다른 세션의 미커밋 변경(0.0.209~0.0.212)도 이 zip 에 함께 들어 있다.
  **릴리스 표 MU 0.0.208 → 0.0.218 · MB 0.1.9 → 0.1.10**(`f0b721f`, 2026-11-11, UNC 업로드·검증 MATCH, Update History 2건) — 145 ⟳ Update 는 사용자 몫. 같은 푸시에 다른 세션의 `5af8bfd`(Drawing to Analysis)가 함께 나갔다(그 세션이 사용자 허락을 전달).
- 남은 일: 70 개발 앱에서 [처음부터] → 노드 변위 입력이 되는지 사용자 확인(Electron 안 재현 안 함) · MU·MB 저장소·WorkBench 핀·짝 장치 파일 커밋(커밋 전 독립 리뷰, MB 에는 다른 세션의 0.1.9 미커밋 변경도 있음) ·
  사용 설명서(`outputs/MU-manual/source/content.mjs` 104행 Model 탭 초기화 단추, 371·377행 '칩을 누르면 해제', 단축키 표, `hp_pick` 그림)가 아직 옛 동작 — 고친 뒤 `make.mjs MU --bump`·`publish.py MU`·Studio 재배포.

#### 다른 Unit 권상 Wire 참조 (Hoist 탭, 0.0.183, 2026-11-04)

Hoist 탭 STEP 2 아래 '다른 Unit 권상 참조' — LogBook 에 확정된 Wire 모델(`_lifting.bdf`)의 훅·lug·Wire 길이·슬링각을 평면 그림 카드로 본다(**보기 전용**, 노드 번호를 지금 모델에 적용하지 않는다).
경로 = Studio `host.searchLiftingReferences`·`getLiftingReference` → Electron `viewer:searchLiftingRefs`·`viewer:getLiftingRef` → 백엔드 `GET /api/logbook/lifting-refs[/{id}]`(`logbook_link.py`, as = 로그인 사번) → LogBook `/api/integration/lifting-refs*`(LogBook 계획 50).
⚠ LogBook 은 `as` 사번이 LogBook 활성 사용자가 아니면 목록부터 404 → Studio 에 'LogBook 에서 찾을 수 없거나 볼 권한이 없습니다'(2026-11-16 LogBook 에 한 번도 안 들어간 사용자).
LogBook `integration.py` `_reference_user` 가 권상 참조 세 경로에서 **행이 없을 때만** LV1 로 등록하도록 고쳤다(사용 중지 사용자는 그대로 막음, 시험 2건, 미커밋 → 145 LogBook pull+재시작). 반영 전 우회 = 그 사람이 LogBook 을 한 번 열기.
요약은 LogBook 이 BDF 구조로 만든다(apex = 병진 123 구속 + CROD 에만 쓰임) — JSON(`_lifting_meta.json`)에 기대지 않아 옛 자료도 찾는다. 계획·상태: `docs/plans/2026-11-04-mu-studio-logbook-wire-reference.md`.
상태(2026-11-04): 커밋 LogBook `43f0540` · WorkBench `63c2165` · MU `6311d7a` · 릴리스 표 0.0.183 `8460c44`(**미푸시, 사용자가 WorkBench 와 함께 푸시**). UNC 업로드·검증됨.
동작하려면 145 LogBook `git pull`+재시작(먼저) → WorkBench 백엔드 ⟳ Update+재시작 → **새 exe**(Electron IPC). 옛 exe 는 '업데이트 안내'만. WorkBench 앱 안 실행·실제 LogBook 연결은 확인 안 함.

**실적의 구조 해석 결과 보기 (0.0.190 · WorkBench 1.7.3 · LogBook 59, 2026-11-06)** — 실적 상세의 [해석 결과 화면으로 열기] → **별도 MU Studio 창, 읽기 전용 '실적 보기'**
(탭 Model·Model Check·Analysis 만, 상단 띠, 판정·숫자 패널 `ReferenceAnalysisPanel`, 3D 응력 색·결과 표는 보통 결과 화면 그대로, 전체 초기화 숨김).
- 재해석하지 않는다 — WorkBench 가 **Wire 모델과 함께 보낸 결과 세트**(결과 JSON + 해석에 쓴 모델 JSON(`_edited.json`, 없으면 `<stem>.json`) + F06)를 LogBook 이
  **같은 자료·같은 폴더·같은 stem**(대소문자 무시)으로 짝지어 `GET /api/integration/lifting-refs/{id}/result` 로 내준다(F06 내용은 안 줌). Studio 는 BDF·F06 을 못 읽어 모델 JSON 이 꼭 필요하다.
- Electron `viewer:openLiftingRefResult`(모델 JSON → `%TEMP%/hitess-lifting-ref/<id>/`, 결과는 세션 `reference`) · `viewer:getReferenceContext`. `viewer:open` 본체는 `openViewerSession(payload, extra)`.
  실적 창은 `parentAnalysisId` 가 없어 해석·업로드 IPC 가 거부된다. 판정은 `structuralVerdict`(FATAL 이면 실패, 문구는 실제 원인만 `referenceVerdictLabel`).
- 결과 세트 없이 Wire 모델만 보관된 실적은 '결과 없음' 한 줄. 2026-11-06 기준 LogBook 확정 실적 E000078 은 결과 없음(사용자가 WorkBench 결과를 전체 다시 보내기로 함).
- 계획·상태: `docs/plans/2026-11-06-mu-lifting-reference-stress-check.md`. 145 반영 확인(2026-11-06): 서버 1.7.4 · Studio 0.0.190 공개 · LogBook 결과 라우트 있음.
  WorkBench 앱 안에서 실적 창을 실제로 연 적은 없다(헤드리스 Chrome + 실제 3496 결과로만 확인).
- **후속 (2026-11-06 오후, 사용자 결정) — 상세·근거는 계획 문서 '후속' 단락**:
  - **열람 범위**: 권상 참조(목록·상세·결과)는 LogBook 레벨과 무관(LV1 포함)하게 확정 Wire 모델 전부, 차단(blocked)만 뺀다. LogBook 화면·BDF 받기 권한은 그대로(LogBook `lifting_refs.reference_visible*`). 결과 보기가 LV1 에게 모델 JSON 을 보이는 것도 사용자 확인.
  - **'내 모델' 탭** = All Projects 로 보낸 자료 중 실행자(origin.owner)·올린 사람·담당자가 나. LogBook `?mine=true` → 응답 `mine: true`(없으면 옛 서버 → Studio 가 막음), exe 표식 `liftingReferenceFeatures`(없으면 옛 exe → 탭 막음).
  - **결과는 같은 창에서**: 실적 3D 칸 [3D | 응력 | 평면 그림] — Electron `viewer:getLiftingRefResult`(1.7.10~) → Studio `referenceStressScene`. 초과 구역 확대(구역별 빨간 상자, ‹ ›). 새 창은 '결과 표까지 보기' 보조 링크, 창은 하나만 재사용(노란 테두리·`[실적 · 읽기 전용]` 제목).
    같은 창에서 내 모델과 바꿔치기하는 안은 버렸다(Studio 저장소가 창마다 하나라 사용자 편집·결과를 덮는다).
  - ⚠ 굵은 선(LineMaterial) 꼭짓점 색은 **선형**으로 넣는다(`utils/srgbToLinear.js`) — sRGB 그대로면 두 번 밝아져 초과 빨강이 분홍이 된다(실측).
  - 상태: Studio 0.0.197 · WorkBench 1.7.10 · LogBook `9d5a669` 커밋·푸시, 릴리스 표 0.0.197(`1dd61aa`). 145 반영(LogBook pull+재시작 → ⟳ Update+재시작 → 1.7.10 exe)은 사용자 몫. 실제 Studio 화면 안 버튼은 눈으로 확인 안 함.

**지난 구조 해석 결과 다시 보기 (2026-11-11, MU 0.0.211~ · `30bc8b6` · WorkBench 1.7.19, 사용자 결정: 읽기 전용)**
  커밋 전 독립 리뷰 '고치면 좋음'(미반영): Side Passage 기록의 [결과 보기]도 MU Studio 로 열림 · Studio 미설치·구버전 PC 안내가 '미설치' 한 줄뿐 · IPC 거절 때 안내 없음(`ResultArtifactsCard` catch 없음) · 실행별 사본 없는 옛 기록은 결과 JSON 도 작업 폴더본. — 산출물 카드(`ResultArtifactsCard`, GMU 3단계·My Projects 상세 공용)의
[Studio 에서 결과 보기] → `GET /api/analysis/unit-structural/{id}/result-set`(모델 JSON + 결과 JSON) → Electron `viewer:openPastStructuralResult`(본창만, 창 하나 `sourceKey unit-structural-past`)
→ 실적 보기와 같은 읽기 전용 창(`reference.kind = 'past'`, 띠 '지난 해석 보기 · … · 해석 #id'). 계획 `docs/plans/2026-11-11-mu-past-structural-result-view.md`.
- 모델은 **그 실행이 쓴 사본**(`lifting_reviews` manifest `editedModel`) → 편집 없음이면 원본 `<stem>.json` → manifest 없는 옛 기록만 작업 폴더 파일 + 경고(`unit_structural_result_set.py`). 작업 폴더 `_edited.json` 은 다음 해석에 덮어써져 쓰지 않는다.
- **Wire·훅은 자세안정성 결과로 그린다** — 응답에 그 실행의 `_stability.json` 사본(`stability`)을 싣고 Studio `App.jsx` 가 `useStabilityStore.setReport` 한다. 없으면 부재 응력만 + 경고.
  결과 창은 Node 레이어를 끈 채 연다(빨간 절점이 응력 색을 덮어 초과 부재처럼 보임 — 실적 보기 창도 같이).
  배포: 70 로컬 **0.0.211**(핀 0.0.211) = 이 기능 + 같은 날 다른 세션의 RBE 묶기 개선(싱크 대장 16번)을 합친 판. 0.0.209·0.0.210 은 Wire 가 빠진 판이라 쓰지 말 것. 이어서 0.0.212(다른 세션, 추가 질량 3D 표시)가 그 위에 올라갔다.
- 대상은 그 GMU 기록의 최근 성공 1건(artifacts `unitStructuralAnalysisId`). 30일 정리로 폴더가 지워진 기록은 404.
- 확인: 70 실제 기록 3건(3312·3164·3020) 라우트 200, 결과 부재 3,236 중 3,235 가 모델 요소와 맞음 · 헤드리스 Chrome + 대역으로 띠·판정 패널·결과 도크(응력·변위·Wire) 표시. 사용자가 70 개발 앱에서 버튼 → Wire 포함 응력 화면 확인(2026-11-11). ⚠ 서버·Electron 은 수정 뒤 재시작해야 한다(9091 `--reload` 가 다시 읽지 않아 Wire 가 빠진 채 보였던 일).
- 반영 = 145 `git pull + 재시작`(라우트) · 새 exe(IPC·버튼) · `/studio-release module-unit-studio`(Wire·문구, 70 로컬에만 0.0.211). 옛 exe 는 '앱 업데이트' 안내, 옛 서버는 '서버 업데이트' 안내.

#### 화면 배율 대응 — 셸을 `transform: scale()` 로 키우지 말 것 (0.0.148, 2026-09-09)

0.0.147 에 "1920×1080 을 논리 작업면으로 고정하고 셸 전체를 균일 확대"하는 발표 모드
(`utils/resolutionFrame.js`)가 들어갔다가 **폐기**됐다. Chromium/Electron 이 Windows 디스플레이
배율을 이미 `devicePixelRatio` 에 반영하므로 **배율이 두 번 곱해진다**:

- 상단 리본(42px)·좌측 도크(301px) 같은 고정 치수까지 확대돼 4K 에서 메뉴가 비정상적으로 커진다.
- 스케일된 셸의 CSS 박스와 실제 뷰포트가 어긋나 정보 패널 좌표가 밀린다.
- 렌더 픽셀비가 `dpr × scale` 이 돼 캔버스 버퍼가 과도하게 커진다.

현재 규약: 셸은 `width/height: 100%` 유동 레이아웃 + 미디어쿼리(폭 ≤1100·≤820, 높이 ≤680)만 쓰고,
3D 는 `utils/renderPixelRatio.js` 의 `studioRenderPixelRatio(devicePixelRatio)` = `min(max(dpr,1),2)`
로 **GPU 상한만** 건다. WorkBench `electron/index.js` 는 메인·뷰어 창 모두 `zoomFactor: 1.0` +
`did-finish-load` 재고정으로 Electron 확대가 겹치지 않게 한다.
검증은 빌드 산출물을 Playwright 로 띄워 셸 박스 == 뷰포트, 리본 높이 42(높이 ≤680 이면 36),
캔버스 버퍼 == CSS 크기 × min(dpr,2) 를 4K/QHD/일반 창에서 실측한다(`docs/display-scaling-0.0.148.md`).
⚠ 4K 를 Windows 배율 100% 로 쓰면 UI 가 작게 보이는 건 **의도된 동작**이다(실사용은 통상 150~200%).

#### 화면 구성 = ModelBuilderStudio 와 같은 셸 (0.0.150, 2026-09-11)

사용자 요청으로 **ModelBuilderStudio 의 공통 구성을 그대로 들여왔다.** 두 Studio 를 같이 고칠 때는
셸 코드를 한쪽에서 고치고 다른 쪽에 옮기는 것이 기본이다(파일명·prop 이름을 일부러 같게 뒀다).
상세: `ModuleUnitStudio/docs/shell-alignment-and-auto-connect-0.0.150.md`

- **탭 6개** — Model │ Model Check │ Edit │ Hoist │ Analysis │ Save. (ModuleUnit 고유 = Hoist 탭 + 탭별 상태 점)
- **좌측 `components/shell/TabPanel.jsx`** — 4구역 고정(헤더+목적 한 줄+`?` 팝오버 / 상태 스트립 /
  아코디언 본문 / 고정 액션 푸터), 폭 300. `StatusLine`·`Accordion`·`HelpList`·`FooterNote` 동봉.
  기존 패널의 지역 `Section` 은 **호출부를 그대로 두고 `Accordion` 위임으로만 교체**했다(Sidebar·AnalyzePanel).
- **우측 `shell/RightDock.jsx`** — 표시/정보 2탭, 세로 레일 36px ↔ 펼침 280px, `Ctrl+B`.
  질량·COG·인스펙터는 `embedded` prop 으로 여기 들어간다(3D 위 floating 은 걷었다).
  ⚠ **카메라 프리셋·내비게이션 모드는 뷰포트 좌상단 툴바에 그대로 둔다** — 뷰포트별 조작이라 3D 옆에 있어야 하고,
  분할 뷰에서 "어느 뷰에 적용되나"가 흐려진다. 도크에는 전역 설정(표시 방식·3D 단면·선택만 보기)만.
- **하단 `shell/BottomDock.jsx`** — 구조 해석 결과 / 입력 감사 / 메시지 3탭, `Ctrl+J`·`Ctrl+Shift+J`(최대화).
  예전엔 결과 도크(position:fixed)와 변환 감사 도크가 **따로 쌓여** 화면 아래를 두 겹으로 먹었다.
  `BottomReviewDock.jsx` 는 삭제됐고 내용은 `dock/AuditTab.jsx` 로 옮겼다. '메시지' = `store/useErrorLogStore.js`.
- ⚠ **`utils/theme.js` 는 다크 전용이다.** 라이트/다크 토글은 가져오지 않았다(사용자 결정). `palette()` 는
  인자를 무시하고 항상 같은 값을 준다 — 이식 코드가 `palette(theme)` 로 호출해도 되게 한 호환 장치다.
  색의 원본은 여전히 `utils/tokens.js` 이고 theme.js 는 그것을 셸 이름으로 다시 묶은 것뿐이다.
- **멀티뷰포트가 되살아났다** — `2f6281f`(2026-06-23) 에서 지웠던 뷰 추가/삭제·카메라 동기화를 복구.
  ⚠ `hooks/useCameraSync.js` 는 **ModelBuilder 판**(직교용 `camera.zoom` 동기화 포함)을 써야 한다.
  ModuleUnit 카메라는 Orthographic 이라 position/quaternion/up/target 만 맞추면 **배율이 어긋난다.**

#### Find(Ctrl+F) — Node/Element/RBE 를 ID 로 찾기 (ModuleUnit 0.0.167 · ModelBuilder 0.0.91, 2026-10-02)

뷰포트 우상단 찾기 바(툴바 `찾기` 또는 `Ctrl+F`). `data/findEntity.js`·`components/FindBar.jsx` 는 **두 Studio 에서 바이트 단위로 같다** —
한쪽을 고치면 복사하고 `diff` 로 확인할 것. 상세: `ModuleUnitStudio/docs/find-by-id-ctrl-f.md`.
- ⚠ ModuleUnit 뷰포트의 `focusEntity` API 는 회전 중심 고정 정책상 no-op 이고, **`source:'find'` 선택만** 카메라·회전 중심을 옮긴다.
  이 예외를 넓히면 결과 행 클릭이 카메라를 흔든다.
- 가서포트 Element 는 해석 스냅숏(`resultElements`)을 `extraElements` 로 넘겨 찾는다(원본 → 스냅숏 순).
- **다른 단계에만 있는 Element (ModelBuilder 0.0.97 · ModuleUnit 0.0.170, 2026-10-23)** — Find 는 활성 뷰포트 **단계 안에서만** 찾는다.
  진단 CSV(예: `HiTESS_ElementSplit_진단.csv` 의 SHORT_ELEMENT E3204)는 02 ElementSplit 에서 **분할로 생긴 번호**라 01 단계에선 "없음"이었다.
  이제 `traceElementAcrossStages()` 가 가장 가까운 단계에서 찾고 `parentElemId` 체인(목록에 없는 중간 번호는 그 단계 `trace` 의 `ElementSplit`/`ElementCreated`)으로
  현재 단계의 원래 요소를 잇는다 → 찾기 바에 [이 단계의 E81 보기] / [ElementSplit 단계로 이동]. 06 Validation 메시 조각은 원래 요소가 이미 쪼개져 '단계로 이동'만 된다.
  WorkBench 진단 카드도 같은 오해를 막는다(`utils/modelValidation.js` `describeElementOrigin`): 번호 옆 '(02 ElementSplit 결과 기준 번호)',
  '01 Preprocess에는 없는 번호입니다. 원래 요소는 E81이고, 부재 교차점에서 분할되어 생겼습니다 (N2384에서 E81·E2101 교차)', 진단 CSV 에 '원래 요소' 열.
  첫 단계 JSON 을 한 번 더 읽어 요소 번호 집합을 만든다(실패하면 그 줄만 빠짐).
  배포(2026-10-23): zip 은 로컬·UNC 반영, 핀 동기화, WorkBench v1.6.27(`d8b2d2c`) exe 빌드. **145 StudioProgram zip 수동 복사(exe 보다 먼저)·exe 배포는 사용자 몫,
  두 Studio 저장소(찾기 파일·package.json) 미커밋, 화면은 눈으로 확인 안 함.**

#### 독립 그룹 자동 연결 (Edit › 자동 연결, 0.0.150)

`data/groupAutoConnect.js`(+테스트 14건)를 ModelBuilderStudio 에서 **무수정 이식**했다 — 두 Studio 의
`StageData` 모양(nodeMap=원본 mm·propertyMap·finalGroups/groups·rigids·element.category/propertyId)이
같아서 그대로 통과한다. **한쪽을 고치면 다른 쪽도 같이 고칠 것.**

- 규칙: 요소 수 최대 그룹 = 주 구조. 소그룹의 **자유단(Free) 노드**를 반경(기본 450mm) 안 최근접
  **주 구조 Structure 부재 노드**에 RBE2(독립=주 구조, 종속=소그룹)로 잇는다.
  **배관(`category==='Pipe'`) 노드는 타깃 제외** — 배관에 묶으면 배관이 하중을 받는다.
- ⚠ **커밋 직전에 종속 중복을 다시 본다**(`useEditStore.applyGroupConnectProposals` → `collectDependentNodes`).
  후보 계산 이후 수동 RBE 가 생겼을 수 있고, 한 노드가 두 RBE2 의 종속이면 Nastran **FATAL 2101** 이다.
  한 번의 적용은 같은 `batchId` 라 Ctrl+Z 로 통째로 되돌아간다.
- ⚠ ModuleUnit 에는 ModelBuilder 의 `groupPreview`(적용 즉시 그룹 병합 표시)가 **없다.** 적용 결과 문구로
  "실제 반영은 Hoist 탭 자세안정성 평가 실행 시점"을 알린다(적용된 RBE 는 `AddRigidPreview` 노란 점선으로 보인다).
- 실측(주 구조 3,657 요소 + 소그룹 80/78/48/14/1): 후보 8건, 거리 190~211mm, 타깃 L·Rod.
  건너뜀 = 반경 밖 10 · 이미 RBE 20 · 소그룹 내부 노드 161.

#### 중심점 RBE + 집중질량 (Edit › RBE 생성, 0.0.171, 2026-10-28)

SidePassageStudio 의 Point Mass RBE 를 옮겼다(노드 3개 이상 → 평균점에 새 GRID + RBE2 + 선택 CONM2(ton)). 상세·결정표: `ModuleUnitStudio/docs/centroid-rigid-mass-0.0.171.md`.
- intent 는 SP 와 같은 `addRigid { createIndependentAtCentroid, independentCoord, mass }`. **기본 위치는 산술 평균**(SP·bridge 기본 = 경계상자 중심)이라 값을 항상 `independentCoord` 에 박는다.
- 백엔드·bridge 무수정 — `_edited.json` 에 GRID·RBE2·CONM2 가 들어가 권상 해석·Wire BDF 다운로드·Save 탭 BDF 에 모두 반영된다(실모델 Nastran 확인, 하중 +5 t 정확).
- ⚠ 자세안정성 엔진은 `_edited.json` pointMasses 를 안 읽는다 → Studio 가 `_posture.json` 질량·COG 에 편집 질량을 더한다(`withEditedMasses`, `massSource …+editedPointMass`).
  질량 패널·하중 조건·COG 마커·권상 후보도 같은 함수. 평가 결과에서 온 COG 에는 다시 더하지 말 것.
- 이미 RBE 에 걸린 노드(독립·종속)는 종속에서 뺀다. RBE2/RBE3 선택은 MB 확정 후 이식(위 'RBE 노드 공유 규칙').
- ⚠ `_posture.json` 에 편집 전 `baseTotalMassTon`·`baseCenterOfGravityMm` 을 함께 싣는다 — Studio 가 폴더의 posture/stability JSON 을 질량 요약으로 다시 읽을 때 이중 합산 방지.
- 화면(사용자 지적 반영, 0.0.172~0.0.174): 연결선 노란 실선, 중심점은 화면 고정 크기 점(월드 크기 구·상자는 확대 시 주변을 덮음),
  회전 중심(`applyCogPivot`)에는 편집 질량을 넣지 않음(넣으면 RBE 만들 때마다 카메라가 튐), Shift 다중 선택은 노드 번호 라벨 없이 편집 패널에 번호 나열.
- 배포 상태(2026-10-28 세션 끝): zip **0.0.174** 로컬·UNC + 핀 동기화. **145 미반영**(zip 수동 복사 → WorkBench 프론트 재배포, 백엔드 재시작 불필요).
  ModuleUnitStudio·WorkBench 핀·이 문서 **미커밋**. 독립 리뷰 1회(막아야 함 1건 수정) 후 0.0.172~174 화면 수정은 리뷰 안 함. 사용자가 화면을 보고 만족 확인(최종 0.0.174 의 라벨 변경은 눈으로 확인 안 함).

#### 가서포트 단면 3종 + 가서포트 CSV 내보내기 (Edit › 가서포트, 0.0.151)

상세: `ModuleUnitStudio/docs/support-sections-and-csv-0.0.151.md`

- **단면 카탈로그는 `data/supportSections.js` 한 곳** — `ANG_100x100x10`(기본) · `ANG_100x100x13` ·
  `ANG_130x130x12`. 사내 구조 CSV 의 `size` 열에 실재하는 규격만 연다. **임의 치수 입력을 열지 말 것** —
  CSV 로 되돌렸을 때 ModelBuilder 의 `ANG_<w>x<h>x<t>` 파서를 통과해야 한다.
- **dims 규약**: `FeModelBuilder.NormalizeDims` 가 L 의 3개 dims 를 `[d0,d1,d2,d2]` 로 늘리므로
  PBEAML L = [수평다리, 수직다리, tw, tf](두 두께 동일). `computeCrossSectionAreaMm2('L')`·`makeSection('L')`
  과 같은 순서다.
- 단면은 **설치 시점 값이 intent(`params.sectionId`+`dims`)에 박힌다.** 도중에 바꿔도 기존 부재는
  그대로라 한 모델에 규격을 섞을 수 있다. `sectionId` 가 없는 0.0.150 이전 intent 는
  `resolveSupportSection()` 이 dims → 기본값 순으로 해석한다(구 JSON 호환).
- ⚠ `applyEditedModel` 은 **규격별 PBEAML 을 1장만** 만들고 같은 규격끼리 PID 를 공유한다.
- ⚠ `three/SupportBeamPreview.buildSupportBeam3D` 의 반환형이 **InstancedMesh → Group** 으로 바뀌었다
  (치수별 InstancedMesh). InstancedMesh 는 geometry 가 하나뿐이라 한 덩어리로 묶으면 굵기가 다른
  앵글이 같은 굵기로 보인다. 그 Group 에는 **중심선도 함께** 들어간다 — 솔리드만 두면 100mm 앵글이
  주위 부재에 가려져 "3D 단면으로 바꾸면 사라진다"(0.0.153 수정). 선의 투명도를 낮추거나 솔리드를
  `depthTest:false` 로 만들지 말 것.
- ⚠ **가서포트 CSV 는 항상 저장 위치를 묻는다**(`saveTextFile(..., { askLocation: true })`, 0.0.153).
  사용자가 CAD 로 가져가는 산출물이라 모델 폴더 무단 저장 금지 — 편집 의도 JSON(폴더 직접 쓰기)과
  정책이 다르다. Electron 뷰어는 `file://` 이라 showSaveFilePicker 가 막힐 수 있는데, blob 다운로드가
  `will-download` 를 발화시켜 OS 저장 대화상자를 띄운다(실측). 저장 대화상자는 사용자 제스처가
  필요하므로 호출 직전에 `await` 를 끼우지 말 것.
- **CSV 내보내기** = `useEditStore.exportSupportCsv()` → `data/supportCsv.js`. 기준 구현은
  HiTessCloud `PythonModule/BdfToCsv.py`, 기준 출력은 `ModuleUnit/BDFtoCSV/3370_M04_csv.csv`.
  열은 ModelBuilder `Cmb.Io.Csv.StructureCsv` 와 1:1, CRLF + 마지막 줄 개행(pandas 동일).
  **BDF 를 거치지 않는다** — intent 에서 바로 만들어 구조 해석 전에도 뽑힌다.
  - ⚠ `name`(` =30137/384565`)·`stru`(`0.0308360511306552`)는 BdfToCsv.py 가 박아 둔 예시 CAD 참조라
    그대로 상수로 쓴다. 엔진은 `stru` 를 읽지 않고(`StructureCsv.ParentStru` 상수만 존재) `name` 은 라벨뿐.
  - ⚠ `ori` 는 국부축 **기준 벡터**(엔진이 직교화)라 축 단위벡터를 쓰되 **수직 부재(|dz|>0.9)에서는
    [1,0,0]** 으로 갈아탄다 — `0 0 1` 고정이면 축과 평행해 퇴화한다.
  - 저장 경로는 편집 의도 JSON 과 같은 `saveTextFile()` 3단 폴백(폴더 → 파일 선택 → 다운로드).
- **가서포트 PBEAML 의 PID 는 구조 구간 안 다음 번호다** (`suggestNextPropertyId`, 2026-11-02 MB 와 맞춤 — 예전 2026-09-17 결정 '최대값+1' 은
  배관 구간(≥101)으로 넘어가 보고서가 배관색으로 칠해 바꿨다). 레거시
  `BdfToCsv.py` 의 매직넘버 **PID 1000** 을 예약하지 않는다 — 기존 모델이 이미 그 번호를 쓰고
  있을 수 있고(실제로 `3370_M04.bdf` 의 1000 번이 그 모델의 가서포트다), 단면 3종이라 가서포트
  PBEAML 이 최대 3장이라 단일 번호로는 담기지도 않는다. 가서포트 식별은 요소의
  `remark: '가서포트'` 로 한다.
  ⚠ 그래서 **스튜디오가 낸 BDF 를 레거시 `BdfToCsv.py` 에 넣으면 가서포트를 못 찾는다.**
  그 경로 대신 스튜디오의 "가서포트 CSV 내보내기" 를 쓸 것.
- ⚠ **구조 해석 결과의 elementId 는 '편집 모델' 기준이다** (2026-09-28). 가서포트는 원본 `stageData.elements`
  에 없어서, 결과를 원본에서만 찾으면 응력 색·결과 표 행 클릭·3D 선택이 조용히 빠진다(실제 장애).
  해석 실행 순간 `snapshotResultElements()`(`data/resultElements.js`)가 편집 모델에만 있는 부재를 떠서
  `useUnitStructuralStore.resultElements` 에 결과와 함께 둔다 — 결과를 조회하는 곳은 **원본 → 이 스냅숏** 순으로
  찾을 것(`buildResultElementIndex`, `buildElementsHighlight` 의 `fallbackElements`, 오버레이 `pickTargets`).
  결과가 있는 가서포트는 청록 미리보기 선(renderOrder 999)을 빼야 응력 색이 보인다.

#### Wire 포함 BDF · 결과 OP2 다운로드 (Analysis/Save 탭, 2026-09-28)

- **Analysis 탭 '해석 파일'** = Wire 포함 BDF(자세안정성 PASS/WARN 후 활성) + 결과 OP2(구조 해석 성공 후).
  **Save 탭**에도 OP2. 편집 모델 BDF(Wire 없음, `BdfExportSection`)는 Save·Edit 탭에만 남겼다.
  활성 조건은 `utils/structuralDownloads.js`(순수 함수 + 테스트).
- 백엔드: `POST /api/analysis/unit-structural/lifting-bdf` · `GET /api/analysis/unit-structural/{id}/op2`.
  Electron IPC: `viewer:downloadLiftingBdf` · `viewer:downloadUnitOp2` (저장 대화상자는 main 이 띄운다).
- ⚠ **BDF 와 OP2 가 짝이 맞게 하는 규칙**: 해석 전 BDF 는 해석 실행과 **같은 함수**
  `unit_structural_service.build_lifting_bdf()` 로 **임시 하위 폴더**에 같은 파일명으로 만들어 내려준다
  (실측: 해석본 `_lifting.bdf` 와 바이트 동일). 해석 성공 후에는 `analysisId` 로 **실제로 푼** `_lifting.bdf`
  를 준다. Studio 는 해석 전 다운로드 때도 `syncEditedModel()` 로 현재 편집을 먼저 올린다 — 안 올리면
  서버의 옛 `_edited.json` 으로 만든 BDF 가 나간다. 임시 폴더를 `<stem>_lifting.*` 자리에 쓰지 말 것
  (해석 task 가 그 glob 으로 이전 산출물을 지운다).
- OP2 는 lifting BDF 의 `PARAM,POST,-1` 산출물(Nastran 이 **소문자 파일명**으로 씀 → `find_lifting_op2`
  가 대소문자 무시로 찾는다). `result_info.liftingOp2` 는 이 기능 이후 실행분부터 있고, 이전 결과는
  `liftingBdf` 옆에서 찾는다. 두 라우트 모두 `read()` 바이트로 응답한다(DRM Content-Length 함정).
- **WorkBench 쪽(Studio 를 안 거쳐도)**: Step 3 `ResultArtifactsCard` 와 **My Projects 상세 모달**
  (GroupModuleUnit/SidePassage 부모 프로젝트)이 같은 카드로 `GET .../groupmoduleunit/{id}/artifacts` 를 쓴다.
  Wire 해석 전이면 `scan_lifting_artifacts(source_bdf=…)` 가 원본 BDF 를 `sourceBdf` 로 대신 준다.
  구조 해석 자식 레코드(UnitStructuralAnalysis)는 My Projects 목록에서 숨겨져 있어 이 카드가 유일한 통로다.

#### 권상 위치 자동 선정 — 핵심 동작·함정 (2026-07-01 세션, ★ 넓은 면적/PASS 관련)

- **Z 밴드(tolMm) 이중 용도 분리**: `hoistToleranceMm`(UI "가상판 ±값")는 **수동 선택 강조용**일 뿐인데, 과거엔 이 좁은 값(모델높이×0.004 ≈ 10mm)이 **엔진 자동 최적화의 Z 클러스터링 tol** 로도 재사용돼 같은 데크의 근소 Z편차 노드가 서로 다른 레벨로 쪼개져 **좁고 작은 그룹만** 나왔다. → `useEditStore.js zoneSelectHoistPositions`는 이제 auto 시 **`tolMm: null`** 을 보내고(사용자가 명시하면 그 값 존중), 엔진(`HoistPositionOptimizer.RunRegionsSearch`)이 **Z 밴드 스윕**(`BuildZBandSweep` = {60,120,200,300}mm)을 돌려 **축적된 후보 중 랭킹으로 '가장 넓은 PASS'** 를 고른다. (payload 직렬화 시 `Number(null)===0` 함정 주의 — `opt.tolMm != null` 가드 필수.)
- **면적 vs 상태(비단조)**: 밴드를 넓힐수록 면적↑ 이지만 **너무 넓으면 `wireConflictCount`(와이어 간섭)↑ → warn**(stage6 안정성 margin 은 오히려 동일). 실측(3496-35210-A508372): tol 10mm→3.07㎡ pass, 100→12.78 pass, 200→**16.84㎡ pass**, 350→2.38(붕괴), 500→23.72㎡ **warn(간섭29)**. 단일 고정 밴드는 keep-K/greedy 클러스터 경계 때문에 **비단조**라 스윕으로 회피. 스윕은 **조기 종료 없음**(모든 밴드 시도 후 랭킹) — 백엔드 `--optimize` 타임아웃 **300s** 이내(실측 ~15s).
- **2D 방향 = 앱 3D '평면도(A키)' 와 동일 = 화면 →X(종, 가로)·↑Y(횡, 세로)** (2026-10-01 사용자 요청으로 변경). 평면도는 `STANDARD_VIEWS.top.up=+Y`·−Z 내려봄 — ModelBuilderStudio(`three/viewportGeometry.js`)·ModuleUnitStudio(`three/viewportFraming.js`) **둘 다 같은 값**이어야 한다. 후보 썸네일(`HoistCandidateThumbnail` + `planViewProjector`)·구역 미니맵(`buildZonePartitionView`)도 같은 방향이라 세 화면이 일치한다(이전엔 평면도·썸네일이 ↑X·←Y, 미니맵만 →X·↑Y 였다). 형상 지표(면적/정사각형도/축편차)는 화면방향과 무관한 모델좌표 계산이라 불변.

#### 'Strict 평가' 토글 — 형상 FAIL 완화 (2026-07-27 세션, 0.0.121)

Hoist 좌측 도크 패널 상단의 토글. **기본 OFF(= 완화)** 이며 `localStorage('mu.hoist.strictEvaluation.v1')` 로 세션 간 유지된다.

- **완화 O — Stage 1(형상 분류) · Stage 2(Z단차·convex·평면도·Trolley 단변·삼각형 내각) → `fail` 대신 `warn`.**
- **완화 X — Stage 3(`wireLengthMm ≤ 0`) · Stage 6(전도) 는 항상 `fail`.** 전자는 정점 자체를 못 만들고, 후자는 모듈이 실제로 넘어지는 위험이라 성격이 다르다(사용자 결정).
- 전달 경로: 스튜디오 `buildPostureStabilityPayload` → `_posture.json` 최상위 `strictEvaluation` → `Stage0_InputParser` → `StabilityContext.RelaxShapeGate` → Stage 1·2 판정 + `GroupShapeValidator.IsComboAcceptable(relaxShape)`. `WithGroups` 전파 필수(빠지면 후보를 strict 로 재평가해 전부 fail).
- ⚠️ **옵티마이저 게이트도 반드시 같이 열어야 한다.** `GroupShapeValidator` 는 평가 *이전에* 조합을 버리므로, 여기를 안 열면 스튜디오에서 완화해도 **고를 후보 자체가 생성되지 않는다.** 단 4점 왜곡 게이트(`ExtremeMinInteriorDeg`/squareness/`ExceedsQuadDistortionLimits`)는 형상 판정이 아니라 추천 품질 필터라 **완화하지 않는다**(열면 후보 폭증).
- ⚠️ **완화 표식을 Stage 0 `warningNotes` 에 넣지 말 것.** Stage 0 이 warn 이 되면 형상이 멀쩡한 후보까지 `overall=warn` 이 되어 옵티마이저의 **PASS/WARN 랭킹 계층이 무너진다.** 대신 상태를 바꾸지 않는 `summary` 에만 기록한다 — Stage 0 `strictEvaluation`, Stage 1·2 `shapeGateRelaxed`(실제 강등이 일어났을 때만 true).
- **단위 구조해석 게이트는 손대지 않았다.** `useUnitStructuralRunner.js` 의 `stabilityOk = pass || warn` 이 그대로라, Stage 1·2 가 warn 으로 내려오면 자동으로 열리고 전도 fail 은 계속 막힌다.
- 실측 검증(A505080 골든 모델, 배포 exe): 정점편차 1mm·Z단차 6868mm 4점 조합 → **Strict ON** stage2=fail·overall=fail(진행 불가) / **Strict OFF** stage2=warn·stage6=pass·overall=warn(**진행 가능**, apex/wire 산출). 전도가 실패하는 조합은 OFF 여도 overall=fail 로 막힘.
- 추적성: 화면 상시 경고 배너(`StrictEvaluationControl`) + `_posture.json` 플래그 + 단위 구조해석 준비 문구(`isShapeGateRelaxed(report)`). 토글을 바꾸면 이전 엄격도로 평가된 결과를 `useStabilityStore.reset()` 으로 무효화한다.

#### Unit 권상 구조 검토 보고서 (2026-09-08 전면 재구성)

`POST /api/analysis/unit-structural/report` (payload = `{analysisId, options}`) → `app/services/unit_lifting_report/` 패키지가 **결과 폴더 JSON 만으로** 다장(多章) xlsx 를 메모리에서 만든다. 표지·요약·목차·1~6장·부록 A/B/C + 데이터 시트 3개(`Members`/`Displacements`/`Wires`).

- **패키지 4모듈**: `collector.py`(JSON 7종 → `ReportData` dataclass) · `figures.py`(matplotlib 2D 도면 → PNG bytes) · `sheet.py`(openpyxl 레이아웃 프리미티브·두 패스 목차) · `builder.py`(장 조립). `unit_lifting_report_service.py` 는 위임 껍데기(라우터 import 경로 보존).
- ⚠️ **그림은 백엔드가 그린다 — Studio 3D 캡처를 쓰지 않는다.** 사용자 결정(Mooring 과 같은 철학). 그래서 Studio 가 안 떠 있어도, 서버에서도 재생성된다. codex 가 만들었던 캡처 경로(`ThreeViewport.captureReportViews`, `LiftingArrangementReport.js`, `DisplacementResultOverlay.js`, store `reportCapture`)는 **전부 삭제**했다.
- **3D 캡처(`solid3d.py` + `figures3d.py`, 2026-09-08 재구축)** — 결과 레포트(사내 서식) 캡처 4~6장과 상세 레포트의 `*_iso` 그림이 같은 코드다. 부재는 PBEAML 단면 치수대로 세운 각기둥, 와이어·COG(◆) 도 **솔리드**로 만들어 같은 `Poly3DCollection` 에 넣는다(scatter/line 은 깊이 정렬에 끼지 못해 부재에 가려지거나 항상 앞에 뜬다). 라벨(`G1·N34 77.9°`, `HOOK G1`, `COG`)·지지 다각형·좌표축은 3D→픽셀로 투영해 **2D 로 맨 위에** 그리고, 겹침 회피는 `figures.place_label` 을 그대로 쓴다.
  - ⚠️ **`Axes3D` 는 지정 영역 안에서 항상 정사각형으로 줄어든다**(`apply_aspect`). 가로로 넓은 자리를 채우려면 `render()` 처럼 축을 가시 영역보다 큰 정사각형으로 놓고 가시 영역 기준으로 zoom 을 '그려 보고 재서' 맞춰야 한다. `ax.set_position` 만 넓혀서는 절반밖에 안 쓴다(과거 증상: 모델이 슬롯의 45%).
  - ⚠️ 서식의 캡처 자리는 `TwoCellAnchor` 라 그림을 **자리 비율(1243:719)로 늘린다.** `fit_aspect()` 로 흰 여백을 덧대 비율을 먼저 맞춰야 왜곡이 없다(`test_result_figures_match_template_slot_ratio`).
  - 권상 배치 그림의 **와이어는 3D 솔리드에 더해 2D 중심선(`overlays`, `avoid=True`)을 겹쳐 그린다.** 평면도에서는 와이어가 거의 수직이라 솔리드가 눌려 흐릿해지기 때문이다. `avoid` 는 그 선을 따라 점유 상자를 깔아 **라벨이 권상 선을 덮지 못하게** 한다(사용자 요청: 선을 진하게, 라벨은 비켜서).
  - **라벨에 슬링각을 넣지 않는다**(사용자 요청 — 도면이 난잡해진다). 최소 슬링각은 부제에, 그룹별 전량은 상세 레포트 표 11 에 있다. 상세 레포트의 2D 평면도(`figures.py`)는 여백이 넉넉해 각도를 그대로 둔다.
  - 결과 그림(변위·응력·가서포트)의 와이어는 `clip_z` 로 모델 상단+12% 에서 잘라 훅을 생략한다 — 훅 정점(모델 위 수 m)까지 그리면 모델이 작아진다. 권상 배치 그림만 훅까지 그린다.
  - **배관은 둥근 기둥 + 붉은색**(2026-09-08 사용자 요청). ① 모양 — `section_profile()` 이 TUBE·ROD 를 `round=True` 로 돌려 `_tube()`(정8각기둥)로 세운다. ② ⚠ **TUBE·ROD 의 DIM1 은 반지름이라 지름 = 2·DIM1**(Studio `computeCrossSectionAreaMm2` 와 같은 규약, Hypermesh 질량 99% 일치로 검증). 과거엔 DIM1 을 지름으로 써서 배관을 **실제의 절반 굵기**로 그렸다. ③ 색 — `_pipe_colors()` 가 **PID ≥ 101**(`PIPE_PID_MIN`, ModelBuilder 의 배관 property 대역. 실제 모델은 1000번대이고 요소 `category=='Pipe'` 와 정확히 일치)만 붉은색으로 칠하고 구조·가서포트는 강재색(회색)으로 남긴다. **변위·응력 그림에는 적용하지 않는다** — 거기선 요소 색이 곧 해석 결과다(사용자 결정).
  - ⚡ **배치를 잡는 draw 동안 `Poly3DCollection` 을 숨긴다**(`render()` 의 `coll.set_visible(False)` → savefig 직전 True). 줌 맞춤 반복·범례/좌표축 계산에 쓰는 `fig.canvas.draw()` 는 투영 행렬만 필요한데, 3만 면을 매번 깊이 정렬해 그리고 있었다. 그림 1장 3.3s → 1.4s, 결과 레포트 14.4s → 6.2s, 상세 17.5s → 9.1s (출력 PNG 는 바이트까지 동일).
  - ⚠️ 마구리 면은 끄고(`TUBE_CAPS = False`) 옆면 8장만 그린다. 배관끼리 이어져 끝이 거의 안 보이는데 면 수가 3배(1장 렌더 3.4s → 6.7s)가 된다.
  - **체결 위치는 가득 찬 원(●), 훅은 빈 원(○)** — 2D 도면(`figures.py`)과 같은 기호다(사용자 요청, `Figure/1.png`·`2.png`). 솔리드 큐브·다이아는 평면도에서 부재에 묻혀 서로 구분이 안 됐다. `_Rig.meshes(solid_markers=False)` + `_Rig.points2d()` → `render(points2d=...)` 가 투영해 **2D 로 맨 위에** 찍고, 그 자리를 점유로 등록해 라벨이 마커를 덮지 않게 한다.
  - **결과 레포트 Hook/Trolley 표도 같은 표기**를 쓴다(`result_report._fill_hook_table`): 1열 = `G1`·`G2`·`G3`, 2열 = `G1-N34`·`G1-N2873`… (그룹+러그 절점). 그림 라벨(`G1·N34`)과 글자가 같아야 표의 한 줄이 그림의 어느 와이어인지 찾을 수 있다. 와이어가 없는 행은 2열을 비운다.
- **바닥글 '문의' 줄 = 보고서를 만든 WorkBench 로그인 사용자**(2026-09-08). 라우터가 `models.User` 에서 이름·직급(`position`)·부서를 읽어 `generator={name, position, department}` 로 넘기고, `collector.format_contact()` 가 `권혁민/책임연구원/구조시스템연구실` 로 조립한다(빠진 항목은 건너뛰고, 전부 없으면 사번). 표지 입력 폼의 '작성자/부서' 와는 **별개** — 폼에는 직급이 없다.
  - 결과 레포트는 페이지 바닥글이 `본 보고서는 Hi-TESS WorkBench를 통해 자동 생성되었습니다.
문의 | …   생성일 …` 두 줄.
  - ⚠️ 상세 레포트는 **표지의 '문의' 줄에만** 넣는다. 페이지 바닥글(`sheet._close_page`)은 8열(≈36자) 한 줄이 한계라 문의처를 붙이면 **줄바꿈되어 페이지 프레임 밖으로 새어 나온다**(실측).
#### 보고서 PDF 출력 — 서버 Excel 로 인쇄해 변환 (2026-09-17)

보고서는 여전히 **openpyxl 이 메모리에서 만든 xlsx 가 원본**이고, PDF 는 그 xlsx 를 서버의 MS Excel 로
열어 인쇄한 결과다(`app/services/xlsx_to_pdf.py`). 라우터 payload 에 `format: "pdf" | "xlsx"` 가 붙었고
**기본은 xlsx**(구 클라이언트 호환), 화면의 기본 선택은 **PDF** 다. 실측: 결과 2p·상세 21p, A4 세로,
한글 폰트 임베드, 프레임·그림·컬러바 그대로. 소요는 xlsx 생성 위에 **결과 +4s · 상세 +12s**(Excel 기동 2.6s 포함).

- 서식을 새로 그리지 않고 Excel 인쇄를 쓰는 이유: 이 보고서는 이미 `fitToPage=False + scale=100 +
  수동 페이지 나누기`로 **인쇄를 확정**해 둔 레이아웃이라(위 '고정 페이지 틀'), Excel 이 찍는 페이지가
  곧 설계한 프레임이다. reportlab 등으로 다시 그리는 건 `sheet.py` 전면 재작성이다.
- ⚠ **`Worksheets("Report")` 만 내보낸다.** 워크북째 `ExportAsFixedFormat` 하면 상세 레포트의
  데이터 시트(`Members`/`Displacements`/`Wires`)까지 인쇄돼 21p 가 **29p** 로 나온다(프레임 바닥글의
  "Page n / 21" 과 어긋남).
- ⚠ **회사 DRM 때문에 PDF 되읽기를 변환 함수 안에서 끝내야 한다.** 디스크에 쓴 파일은 `HHIDRMC`+4096B 로
  감싸지고 **평범한 python 프로세스는 암호문을 읽는다**. 그런데 **Excel COM 인스턴스를 띄운 프로세스**는
  DRM 훅이 붙어 `read()` 가 평문을 준다(실측 stat 466,080 / read 461,984 = `%PDF-1.7`). 경로만 밖으로
  넘기면 호출자가 암호문을 읽는다. 안전장치로 `%PDF` 매직을 확인하고 아니면 예외를 던진다.
- ⚠ Excel 은 동시 실행에 안전하지 않다 — 모듈 락으로 직렬화하고 인스턴스는 **호출마다 띄우고 닫는다**
  (상주시키면 대화상자 하나에 영구히 멈춘다). Excel 이 없으면 깨진 파일 대신 **503 + 사유**가 나간다.
- ⚠ **Excel 확장자 규칙**: `ExportAsFixedFormat` 는 대상이 `.pdf` 가 아니면 **아무 파일도 쓰지 않는다**
  (실측 `.pdfdata`/`.dat` 는 조용히 실패). DRM 회피용으로 확장자를 바꾸는 우회는 여기선 못 쓴다.
- `sheet.py` 는 openpyxl 기본 바닥글(`Page &P / &N`)을 **비운다** — 프레임 안에 자체 쪽번호가 있어
  PDF 에서 두 겹이 된다. 단 **결과 레포트는 사내 서식 템플릿(.bin)이 그 바닥글을 갖고 있어 그대로 둔다**
  (우리 레이아웃이 아니라 회사 서식이다).
- 진입점 양쪽 모두 형식 선택이 있다(PDF 기본): Studio `UnitStructuralReportDialog` ·
  WorkBench `UnitLiftingReportDialog`. 두 파일은 같은 선택지를 사본으로 갖는다 — **한쪽 고치면 양쪽 다.**
  서버 응답 헤더에 `X-Report-Format` 이 실린다.
- ⚠ **결과 레포트 그림은 절대 크기(OneCellAnchor + ext)로 붙인다** — `result_report._absolute_anchor`.
  서식의 캡처 자리는 TwoCellAnchor 인데, 이 서식은 1.71자짜리 좁은 열 56개라 Excel **인쇄** 엔진이 열 폭을
  화면(정수 px)과 다르게(소수 px) 계산해 셀 박스가 ~8% 넓어지고, 거기 늘려 붙은 3D 그림이 PDF 에서 옆으로
  **11% 늘어났다**(실측 1.731 → 1.932; 원본 서식도 동일). Zoom/맞춤 등 페이지 설정으로는 안 바뀐다(실측).
  셀 박스 px 는 Excel 규칙(열 `int((256w+int(128/7))/256·7)`, 행 `pt·96/72`)으로 계산하고, 그림은 그 안에
  비율을 지켜 가운데 놓는다. 1페이지 로고도 같은 이유로 함께 고정했다(1.10배 늘어났었다).
  표·박스 자체는 여전히 인쇄에서 ~8% 넓다 — 셀 폭은 우리가 못 고친다(Excel 반올림).
- ⚠ **상세 레포트는 다른 원인으로 같은 증상이 있었다** — `sheet.figure()` 가 `FIG_W×FIG_H`(640×410, 1.56)를
  표시 크기로 그대로 써서 3D 그림(1.73)·2D 도면(1.44)이 **xlsx 에서부터 ±10%** 눌려 있었다(인쇄 무관).
  이제 그 값은 **최대 상자**이고 그림은 항상 PNG 원본 비율이다(3D 640×369 · 2D 590×410). 21p 그대로.
- 서식 글자는 `_fit_form_text` 가 **shrinkToFit** 을 켠다(제목 O·HULL·UNIT·권상방식·부서 AS·주의사항 F행).
  주의사항 셋째 줄이 12pt 로는 박스를 넘쳐 테두리를 덮고 인쇄 영역 끝에서 잘렸다 → 10.8pt 로 줄어 들어간다.
  넘치지 않는 칸은 그대로다. 인쇄는 `_print_setup` 이 좌우 가운데 + 여백 L 0.22in/R 0.56in — 서식 왼쪽에
  빈 여백 열(A~C ≈ 23pt)이 있어 인쇄 영역을 그냥 가운데 맞추면 보이는 내용이 오른쪽으로 12pt 치우친다.
- **가서포트 배치 그림에서만 배관을 반투명(α 0.22)** 으로 누른다(사용자 요청, 2026-09-17) —
  `figures3d.PIPE_ALPHA_SUPPORT`, `solid3d.face_colors(alpha_per_element=…)` 가 (N,4) RGBA 를 돌려주고
  `render()` 는 모서리에도 같은 α 를 준다. 8각 기둥은 앞·뒷면이 겹쳐 체감 α 는 약 1.8배. 권상 배치·변위·응력
  그림은 그대로 불투명(RGB). 범례는 좁아서 '배관 (반투명)' 짧은 라벨을 쓴다('PID ≥ 101 · 반투명' 은 잘린다).
  테스트: `tests/test_unit_lifting_report_pdf_layout.py`.

- ⚠ **페이지 외곽선이 끊겨 보이던 원인은 두 보고서가 서로 달랐다** (사용자 신고·수정 2026-09-17).
  둘 다 `tests/test_unit_lifting_report_pdf_layout.py` 가 잡는다.
  - **상세 레포트 — 그림이 외곽선을 덮었다.** `sheet.py` 가 그림·로고를 문자열 앵커(`"A5"`)로 붙이면
    왼쪽 끝이 인쇄 원점(왼쪽 여백 0.4in = 28.8pt)과 **정확히 같아진다.** 그런데 A열의 왼쪽 medium
    테두리는 눈금선을 걸치고 그려져 28.32~30.24pt 를 차지하므로, 그림의 흰 배경이 그 선의 안쪽
    3/4 을 덮는다 → **그림이 있는 페이지에서만** 세로 외곽선이 토막난다(실측 21쪽 중 5·6·9·10·14·16·17쪽).
    이제 `ReportSheet._place()` 가 `OneCellAnchor` 로 `FRAME_CLEAR_PX`(3px) 만큼 안으로 밀어 붙인다.
    문자열 앵커를 다시 쓰지 말 것. 그림 폭은 여유(오른쪽 ~50pt)가 있어 밀어도 잘리지 않는다.
  - **결과 레포트 — 서식의 외곽선이 hairline 이었다.** 좌우 외곽선은 D열 오른쪽·BC열 왼쪽에
    있는데 머리글 블록(3~4행)만 thin(0.96pt)이고 나머지는 **hair(0.12pt)** 라, 한 선의 굵기가
    페이지 중간에서 8배 바뀌고 PDF 뷰어 배율에 따라 사라졌다 나타난다. `_solid_frame()` 이 hair 를
    thin 으로 올린다. ⚠ 같은 선이 **열 스타일**(`column_dimensions['D'].border`)과 **셀 테두리**
    (23~43행 등)에 나뉘어 있어 둘 다 봐야 한다 — 열 스타일은 openpyxl 의 셀 테두리 조회에 안 잡히고
    (Excel COM 으로만 보인다), 셀 테두리는 열 스타일을 덮는다. 한쪽만 고치면 가운데 토막만 남는다.

- **Studio 보고서 버튼은 전체 화면 안내막을 띄운다**(`ReportProgressOverlay.jsx`, 0.0.138~). 백엔드가 3D 그림을 그리는 동안 화면이 멀쩡해 보이면 사용자가 버튼을 다시 누른다. 예상 시간(결과 25s·상세 35s — dev PC 실측은 6.2s/9.1s 이고 서버·전송·저장을 감안한 값)과 경과를 보여 주고 `zIndex 4000` 으로 조작을 막는다. 진행률은 서버 값이 아니라 예상 대비 경과라 **95% 에서 멈추고** 초과 시 '마무리 중' 으로 바꾼다. WorkBench 쪽 버튼(`UnitLiftingReportDialog`)은 기존대로 제출 버튼 스피너만 쓴다.
- ⚠️ **신규 의존성 `matplotlib==3.10.7`** (`requirements.txt`). 서버(145)는 `git pull` 후 **1회 `pip install -r requirements.txt`** 필요. 한글 폰트는 `Malgun Gothic`.
- ⚠️ **절 제목 문자열은 `builder.toc_entries()` 와 `_write()` 가 글자 단위로 같아야** 목차 쪽번호가 채워진다(다르면 그 절이 0쪽으로 나옴). `tests/test_unit_lifting_report_builder.py::test_toc_pages_monotonic` 이 잡는다.
- **고정 페이지 틀** — 원본 사내 서식처럼 한 페이지가 (머리글 3행 + HULL/UNIT/권상방식 1행 + 본문 50행 + 바닥글 2행) = **57행 프레임**이고 외곽선·머리글·바닥글이 페이지마다 반복된다. `sheet.ReportSheet` 가 `_open_page`/`_close_page`/`_ensure(rows)` 로 관리하며, **모든 행 높이가 ROW_PT(13.5pt)로 같아야** '행 수 = 세로 공간' 이 성립한다(여러 줄 텍스트는 행 세로 병합).
- ⚠️ **인쇄 설정 3가지가 서로 맞물린다. 하나만 바꾸면 레이아웃이 깨진다.**
  1. `fitToPage` 를 켜면 Excel 이 **수동 페이지 나누기를 무시**해 프레임 2개가 한 장에 겹친다 → `ps.scale = 100` 고정.
  2. `ROW_PT` 는 픽셀에 정확히 떨어지는 값이어야 한다(13.5pt = 18px). 14pt 는 18.67px → 19px 로 반올림돼 프레임이 예상보다 높아지고 페이지가 쪼개진다.
  3. 프레임 높이(769.5pt)와 인쇄 높이(여백 0.42 → 781pt) 사이 여유에 **다음 페이지 첫 행이 비친다**. 그래서 로고는 프레임 첫 행이 아니라 **둘째 행에 앵커**한다.
- 그림은 폭 640px 고정(12열 ≈ 660px 을 넘으면 컬러바가 테두리를 뚫는다). 남은 공간이 부족하면 비율을 유지해 축소하고, `FIG_MIN_ROWS`(20행)보다도 좁으면 다음 페이지로 넘긴다. 표는 페이지를 넘어가면 머리행을 다시 그린다.
- 표 셀은 `wrap=False` 라 열 폭을 넘으면 **잘린다**. 긴 문자열(자세안정성 단계 요약 등)은 `collector._stage_metric` 에서 짧게 만들고 열 폭(`widths`, 합계 ≤ 12)을 함께 조정할 것.
- **진입점 2곳**: Studio `UnitStructuralReportButton`(→ `UnitStructuralReportDialog`) · WorkBench `ResultArtifactsCard` 의 "검토 보고서" 버튼(→ `UnitLiftingReportDialog`). 후자는 artifacts 응답의 **`unitStructuralAnalysisId`** 로 대상 해석을 찾는다(`GET /api/analysis/groupmoduleunit/{parent_id}/artifacts`).
- **입력 옵션 키**(백엔드 `ReportOptions.from_payload` 와 1:1): `hullNo, unitNo, drawingNo, revision, author, department, jigLimitTon`(기본 6.2) `, yieldStrengthMpa`(기본 275) `, notes, extraNotice`. 폼 로직은 `frontend/src/utils/unitLiftingReport.js` 와 Studio `src/utils/unitLiftingReportForm.js` 에 **같은 내용의 사본**으로 있다(저장소가 달라서) — 한쪽 고치면 양쪽 다.
- **판정**: σ허용 = σy × 0.8(결과 JSON 의 `structuralAllowableMPa` 우선), 활용도 > 1.0 이면 NG · 와이어 장력 > 지그 기준이면 "지그 필요" · **변위는 참고치(판정 없음)** · 자세안정성은 엔진 overall 그대로.
- 필수 JSON 은 `nastranResultJson`·`stabilityJson` 둘뿐. 나머지(posture·hoist_optimization·validation·edited·원본 json·f06)는 없으면 해당 절을 "자료 없음"으로 쓰고 경고에 남긴다 — **과거 결과에도 보고서가 나온다.** 그림 렌더 실패도 그 그림만 자리표시로 대체.
- 테스트: `tests/test_unit_lifting_report_{collector,figures,sheet,builder,service,route}.py` + `test_groupmoduleunit_artifacts_unit_id.py`. fixture 는 실측 결과를 축소한 `tests/fixtures/unit_lifting_report/`(`build_fixture.py` 로 재생성).

#### 결과 레포트 '주의 사항' 5줄 — 서식 1페이지를 재배치했다 (2026-09-17, 0.0.154)

사내 표준 서식의 주의 사항은 원래 3줄(`F7`·`F8`·`F9`, F~BA 병합)이었다. 여기에 고정 문구 1줄과
**사용자가 모달에 직접 적는 1줄**을 더해 5줄(`F7`~`F11`)로 만들었다.

- 문구 4행은 `result_report.NOTICE_ADDED_LINE` 상수다. **1~3행은 서식이 갖고 있는 문구라 코드에
  없다** — 그 세 줄을 고치려면 서식(.bin)을 고쳐야 하고, 4행은 여기만 고치면 된다.
- 5행은 `extraNotice` 옵션. **비면 그 행을 `hidden` 처리하고 박스 아랫변을 4행으로 올린다**
  (`_move_bottom_border`) — 빈 줄을 남기면 서식에 한 줄이 뚫린 것처럼 보인다(사용자 결정).
  글자 수 상한 **36자**(`collector.EXTRA_NOTICE_MAX_CHARS` = 프런트 `EXTRA_NOTICE_MAX`): 서식의
  F~BA 박스가 576px 이고 12pt 한글이 정확히 36자 들어간다. 넘으면 `_fit_form_text` 의 shrinkToFit
  이 글자를 줄여 다른 줄보다 작아 보인다. 프런트 `maxLength` 를 붙여넣기로 우회해도 백엔드가 자른다.
- ⚠ **서식(.bin) 1페이지를 실제로 재배치했다.** 행 수(1~54)와 페이지 나누기(54·108)는 그대로지만
  안쪽 배치가 바뀌었다 — 주의 사항 7~11행(높이 20.1 → **18.0pt**), 요약표 11~13행 → **13~15행**,
  각주 14 → 16행, 3D 그림 두 장은 16~33·34~51행 → **17~33·34~50행**(크기 17행 그대로, 각주 아래와
  두 그림 사이의 빈 행을 하나씩 내줬다). 그래서 `_fill_summary` 의 셀 좌표와 서식 수식
  (`V15=N15*0.8`, `AT15=IF(AL15<=V15…)`)·조건부 서식(`AT15:BA15`)도 같이 옮겼다.
  - 1페이지 높이 여유는 20pt 뿐이다(759.95 → **762.65pt**, 97% 배율 기준 상한 780pt). 주의 사항
    행 높이를 원래 20.1pt 로 두면 넘쳐서 페이지가 쪼개진다 — **18.0pt(24px)로 줄인 이유가 이것이다.**
  - ⚠ **바닥글 위 빈 행(51)을 없애지 말 것.** Excel 인쇄 엔진은 그림을 계산상 자리보다 ~9px 아래에
    찍어서, 등각 그림을 51행까지 끌어내리면 **바닥글 첫 줄이 그림 흰 배경에 덮인다**(실측).
  - 사내 서식이 새 버전으로 배포되면 이 재배치를 처음부터 다시 해야 한다. 재배치 스크립트는
    세션 스크래치패드에만 있으므로, 서식 갱신 시에는 위 좌표표를 보고 다시 만들 것.
- 검증: `tests/test_unit_lifting_result_report.py` 의 `test_notice_*` 2건 + PDF 실측(입력 있음/없음/
  36자 꽉참 세 경우 모두 **2쪽**, 박스가 닫히고 바닥글이 가려지지 않음).
