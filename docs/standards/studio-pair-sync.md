# 짝 Studio 싱크 — 한쪽을 고치면 다른 쪽도 맞춘다

2026-11-10 시작. Model Builder Studio(MB)와 Module Unit Studio(MU)는 한 쌍이다 — 한쪽이 개선·수정되면 다른 쪽이 들여올 수 있는 부분은 함께 맞춘다(사용자 지시).
Studio 는 저장소가 따로라 공용 코드를 사본으로 나눠 갖는다. 예전에는 "한쪽을 고치면 다른 쪽도" 를 주석과 기억에만 맡겼다. 이 문서는 그 일을 장치로 옮긴 것이다.
짝은 MB·MU 에서 시작하지만 다른 Studio 로 늘릴 수 있게 만들었다(맨 아래 '짝을 늘릴 때').

## 싱크는 두 종류다

| 종류 | 뜻 | 누가 잡나 |
|---|---|---|
| 파일 싱크 | 두 Studio 에 같은 경로로 있는 사본. 그중 일부는 내용이 **같아야** 한다 | 검사 스크립트(기계) |
| 기능·규칙 싱크 | 파일은 이미 갈라졌거나 한쪽에만 있지만 사용법·기능은 같아야 하는 것(예: 한쪽에 새 편집 도구) | 사람·Claude 의 판정 → 아래 대장 |

## 장치 — 알아채는 것 세 개 + 옮기는 명령어 하나(`/studio-sync`, 아래 '언제 옮기나')

1. **규칙 + 검사** — `scripts/studio_pair.json`(규칙) · `scripts/studio_pair.py`(검사) · `scripts/studio_pair.lock.json`(지켜보는 짝을 마지막으로 살펴본 때의 지문, 스크립트가 쓴다).
   - `same` = 내용이 같아야 하는 파일(줄 끝 차이는 무시). 어긋나면 종료 코드 1.
   - `watch` = 짝이지만 달라도 되는 파일. `"auto"` 면 묶음의 모든 Studio 에 같은 경로로 있는 나머지 파일 전부다. 한쪽이 살펴본 뒤 바뀌면 "다른 쪽에 들여올지 검토" 로 알린다(종료 코드에는 영향 없음).
   - `ignore` = 경로는 같지만 일부러 따로 가는 파일(이유를 적는다).
2. **고치는 순간 알림** — 전역 훅 `~/.claude/hooks/workbench_guard.js`. Studio 소스를 Write/Edit 하면 그 파일의 짝을 알려 준다(`same` 이면 "짝에도 같은 내용으로", 그 밖의 짝이면 "들여올지 판단"). 같은 세션·같은 파일은 한 번만. 셸 명령으로 고친 파일은 못 잡는다 — 그건 3번이 잡는다.
3. **배포할 때 확인** — `/deploy` 스킬 `studio.md` 절차 0번. Studio 를 빌드하기 전에 검사를 돌리고, 판정을 아래 대장에 적는다.
   훅과 `/deploy` 스킬은 회사 PC(70)에만 있다(Studio 빌드가 70 에서만 이뤄진다). 규칙·검사·이 문서는 git 이라 두 PC 가 같다.

## 한 Studio 를 고쳤을 때

```
python scripts/studio_pair.py            # WorkBench 루트에서
```
1. **`SAME_MISMATCH` 가 0 이 아니면** 같아야 하는 파일이 어긋난 것이다. 같은 내용으로 맞추고 짝 Studio 도 함께 버전을 올려 배포한다. 일부러 갈라야 하면 `same` 에서 빼고(자동으로 watch 가 된다) 대장에 이유를 적는다.
2. **'바뀜' 목록**의 파일마다 짝 Studio 에 들여올지 판정한다.
   - **도입함** — 짝 Studio 도 고쳤다 → `python scripts/studio_pair.py --ack <경로>`
   - **해당 없음** — 그 Studio 에만 맞는 변경이다(이유 한 줄) → 같은 명령으로 닫는다
   - **보류** — 들여와야 하지만 지금은 아니다 → 닫지 않는다(다음 검사에 계속 뜬다)
3. 파일로 안 잡히는 변경(한쪽에만 있는 새 파일·새 기능)도 짝 Studio 에 쓸 만하면 대장에 적는다.
4. 판정을 대장에 한 줄 남긴다. 사용자가 정할 일이면 추천안을 말하고 묻는다.

`--ack --all` 은 "지금 상태를 전부 살펴봤다" 는 뜻이라 처음 기준선을 잡을 때만 쓴다.

## 언제 옮기나 — 기록은 그때그때, 옮기기는 묶어서

| 시점 | 하는 일 | 무엇이 챙기나 |
|---|---|---|
| 한쪽 Studio 개발 중 | 옮기지 않는다. 대장에 '보류' 로만 적는다 | 훅 알림 · `/deploy` 0번 |
| 같아야 하는 파일(`same`)을 고쳤을 때 | 그 자리에서 짝에도 복사한다 | 훅 알림 · 검사 종료 코드 |
| 그 Studio 를 145 에 공개한 뒤(`/studio-release`) | 쌓인 보류를 한 번에 반대쪽으로 옮긴다 | `/studio-release` 보고의 안내 줄 → **`/studio-sync`** |

- 70 로컬 버전은 화면을 보며 계속 고쳐진다. 확정(145 공개) 전에 옮기면 같은 수정을 두 Studio 에서 되풀이한다.
- 묶어서 옮기면 반대쪽 Studio 의 버전 올리기·배포가 한 번으로 끝난다.
- 한 Studio 를 두 세션이 동시에 고치지 않는다. `/studio-sync` 는 옮길 쪽 저장소에 진행 중인 변경이 있으면 멈춘다.

`/studio-sync`(`.claude/commands/studio-sync.md`) — 인자 없이 부르면 보류 전체를 추천과 함께 보여 주고 한 번 묻는다.
번호(`/studio-sync 1 2 3`)나 `all` 을 주면 묻지 않고 옮긴다. 글을 주면(`/studio-sync MB 0.1.9 힘 라벨을 MU 에도`) 대장에 없는 변경을 줄부터 만들어 옮긴다.
옮긴 Studio 의 테스트·lint·빌드, 대장 고치기, `--ack`, 70 로컬 배포까지 한다. 145 공개와 커밋은 하지 않는다.

## 싱크 대장

번호 순(새 줄은 맨 아래). 판정 = **보류** / **도입함**(옮긴 Studio 버전) / **해당 없음**(이유). 보류가 풀리면 그 줄의 판정을 고친다. 번호는 `/studio-sync` 인자로 쓴다.
기준선(2026-11-10) = MB 0.1.8(`56cac01`) · MU 0.0.205(`ee7fcb9`), same 20개 일치 · watch 87개.

| # | 날짜 | 있는 쪽 → 옮길 쪽 | 내용 | 판정 | 비고(추천) |
|---|---|---|---|---|---|
| 1 | 2026-11-10 | MU → MB | `components/edit/textEntry.js` `isOutsideEntry` — 작업 패널 단축키가 찾기 바 같은 바깥 입력칸의 키를 가로채지 않게 하는 검사(MU 패널 8곳이 씀) | 도입함(MB 0.1.11) | MB 패널 5곳(DeleteSelection·MassEdit·SectionChange·GeometryEdit·AddRigid)에 `isOutsideEntry`. `components/edit/textEntry.js` 는 `same` 으로 등록(2026-11-11 `/studio-sync`) |
| 2 | 2026-11-10 | MU → MB | `components/edit/useSectionPick.js` `lockChoice` — 단면 적용 뒤 기본값이 다음 PID 로 넘어가지 않게 고정 | 도입함(MB 0.1.11) | MB `SectionChangePanel` 적용 뒤 `pick.lockChoice()`. `components/edit/useSectionPick.js` 는 `same` |
| 3 | 2026-11-10 | MB → MU | `main.jsx` 의 `ErrorBoundary` — 화면 오류 때 빈 화면 대신 안내. MU 에는 컴포넌트 자체가 없다 | 도입함(MU 0.0.221) | MB `components/ErrorBoundary.jsx`·`main.jsx` 를 MU 에 그대로 — 둘 다 `same` |
| 4 | 2026-11-10 | MB ↔ MU | `utils/groupPalette.js` — MB 는 그룹을 전부 따로 보이고, MU 는 11개 이상이면 상위 10개 + '기타' 로 묶는다 | 도입함(MU 0.0.222, MB 방식) | 사용자 결정(2026-11-11): MB 방식으로 통일 — 모든 그룹을 따로 칠하고 따로 지울 수 있게(MU 의 '기타' 묶음은 11번째 이후 그룹을 지울 수 없었다). 색은 11색이 돌아가며 반복. `utils/groupPalette.js` 를 `same` 으로. MU 의 기타 처리 코드(GroupManager·ModelCheckPanelDock·GroupVisibility 의 'others')는 이제 타지 않는 옛 코드 |
| 5 | 2026-11-10 | MU → MB | `three/rigidClassification.js` — U-bolt RBE 판별 한 곳. MB 는 같은 함수가 `RigidMesh`·`UboltMarkers`·`UboltDofLabels` 세 파일에 따로 있다 | 도입함(MB 0.1.11) | MB 도 `three/rigidClassification.js` 한 곳으로 모음(세 파일의 같은 함수 제거). 규칙은 MB 그대로 — MU 와 규칙이 달라(MB = 이름에 UBOLT, MU = remark·cm) 그 파일은 `ignore` 에 이유와 함께 |
| 6 | 2026-11-10 | MB → MU | `MessagesTab`·`HelpCenter`·`HelpModeLayer`·`HelpTopicBody`·`GuideRunner` 5개가 테마 읽는 줄만 다르다(MB 밝은/어두운, MU 어두운 화면만) | 도입함(MB 0.1.11) | 방향을 바꿈 — MB 도 다크 전용(`palette()` 인자 무시)이라 MU 판(테마 줄 없음)을 MB 에 복사. 화면 동작 같음, 다섯 파일 모두 `same` |
| 7 | 2026-11-10 | MB ↔ MU | `three/orthoPan.js` — 코드는 같고 주석만 다르다 | 도입함(MU 0.0.221) | MB 판(한글 주석)을 MU 에 복사, `same` |
| 8 | 2026-11-10 | MU → MB | `data/sectionChoices.js` — PROD·PBAR 등 PBEAML 이 아닌 단면을 선택지에서 뺌 | 해당 없음 | MB 입력은 CSV 라 PROD·PBAR 카드가 없다(2026-11-11 `/studio-sync` 확정) |
| 9 | 2026-11-10 | MB → MU | 작업 패널을 뷰포트 그릇 안에 그림 — `edit/WorkPanelFrame.jsx` 가 `data-viewport-root`(ViewportContainer)로 portal, 떠 있는 동안 조작 안내줄 숨김(`useViewerStore.workPanelCount`). 예전 화면 고정 좌표는 아래 도크·오른쪽 도크를 몰라 좁은 창에서 3D 밖으로 나갔다 | 도입함(MU 0.0.206) | MU `edit/WorkPanelFrame.jsx`·`ViewportContainer`·`useViewerStore.workPanelCount`. 패널 9종이 같은 틀이라 한 곳만 고침 |
| 10 | 2026-11-10 | MB → MU | 편집 선택 = 흰색 + 어두운 외곽(`three/SelectionHighlight.js` `EDIT_SEL_COLOR`) · 그룹 색 1번(본 구조) = 회청색, 목록 이름 '그룹 1 · 본 구조'(`utils/groupPalette.js`) | 도입함(MU 0.0.206) | 부재 선택 굵기도 화면 픽셀 기준으로. '기타' 묶음 색은 노랑(4번 — 묶는 방식 자체 — 은 그대로 보류). Hoist 탭 권상점 표식은 다른 부품이라 영향 없음 |
| 11 | 2026-11-10 | MB → MU | 3D 위 자리 규칙 — 범례는 늘 아래 줄 위(bottom 46), 조작 안내줄 한 줄 + 말줄임, 편집 선택 바는 좌표축·범례 자리를 뺀 영역의 가운데, '표시' 도크 자동 펼침은 창 폭 1400px 이상만(`ViewportContainer`·`ThreeViewport`·`shell/EditSelectionBar`·`shell/RightDock`) | 도입함(MU 0.0.206) | 도크 자동 펼침 1400px·조작 안내줄 한 줄·패널 뜬 동안 숨김·뷰포트 머리 `N: E:` 삭제만. 범례·선택 바 자리는 해당 없음(MU 에 3D 범례가 없다) |
| 12 | 2026-11-10 | MB → MU | 뷰포트 알림 칩(`components/ViewportNotices.jsx`, MB 에만 있는 새 파일) — 분리 그룹·장비 COG·CSV 추적을 뷰 도구줄 아래 줄의 칩으로 | 도입함(MU 0.0.206) | MU `components/ViewportNotices.jsx` — 분리 그룹 칩 하나만(도구줄 두 줄 아래). 파일 이름은 같지만 내용은 Studio 마다 다르다(`same` 아님) |
| 13 | 2026-11-10 | MB | 다크 전용 전환(테마 단추 삭제, `utils/theme.js` `palette()` 가 인자 무시, `store/useViewerStore.js` `theme` 은 늘 dark) · `EDIT MODE` 배지 삭제 · Analysis 위쪽 안내줄 삭제 · 아래 도크 머리 건수 하나로(`dock/AuditTab`·`shell/BottomDock`) | 해당 없음 | MU 는 이미 다크 전용·BDF 입력이라 감사 건수가 없다. 6번(테마 읽는 줄만 다른 5개)을 `same` 으로 묶기 쉬워졌다. `EDIT MODE` 배지는 MU 에 남아 있는지 `/studio-sync` 때 확인 |
| 14 | 2026-11-10 | MB → MU | Model Check — 떨어진 그룹이 있으면 '자동 연결'을 그룹 목록 위에 펼쳐 둠(MB `panels/ModelCheckPanel.jsx` ↔ MU `panels/ModelCheckPanelDock.jsx`, 경로가 달라 검사에는 안 잡힌다) · Model 탭 안내 카드 '처음 쓰신다면 — 따라하기' · Edit '선택' 설명 한 문장 · 그룹 목록 '그룹 1 · 본 구조' | 도입함(MU 0.0.206) | MB 의 '검증 진단 한 줄로'는 MU 에 그 구역이 없어(FEM 건전성 표) 해당 없음 |
| 15 | 2026-11-10 | MB → MU | 그룹 목록 모양(Model Check·Edit 둘 다) — [전체 표시] [전체 숨김] + 그룹 색 카드 한 줄(줄 전체 = 표시/숨김, 눈 아이콘), Edit 는 오른쪽에 휴지통(삭제 예약 ↔ 되돌리기). MU 는 '그룹 관리' 상자(기준 전환·확인·단독·그룹 새로고침)라 그룹 하나가 두 줄이었다(MB `panels/ModelCheckPanel.jsx`·`panels/EditPanelDock.jsx` ↔ MU `panels/ModelCheckPanelDock.jsx` `GroupCheckList`·`components/GroupManager.jsx`) | 도입함(MU 0.0.207 Model Check · 0.0.208 Edit) | 사용자 요청 '모델 빌더 스타일로 다'. MU 에서 없앤 것 = 단독 보기 단추([전체 숨김] 뒤 한 줄 누르기로 대신)·그룹 새로고침·기준 전환. 부재 종류(구조·배관) 삭제는 MU 에만 있는 기능이라 목록 아래 '부재 종류로 지우기'로 남김. Edit 구역 이름 '그룹 관리' → '그룹'. [전체 표시·숨김]은 MB Edit 에 없다 — MB 로 옮길 후보 |
| 16 | 2026-11-11 | MU → MB | RBE 묶기 — 노드 위치 알기 쉽게(MU `components/AddRigidDialog.jsx`·`data/rigidAddCandidates.js`·`three/RigidEditHighlight.js`·`components/ThreeViewport.jsx`·`store/useEditStore.js`). 3D 에 독립(주황 + '독립 N… · 질량' 이름표)·종속(파랑 번호)·빠지는 노드(빨강), 패널 줄에 새 노드·질량·RBE 걸림·좌표 + [보기], 독립 기본값 = 질량 노드 → 새 노드 → 첫 노드(새 노드·질량이 있으면 그 방식으로 열림), 질량 노드가 독립이면 Remark 'MASS'. 화면 이동(`focusEntity`)이 떠 있는 작업 패널을 비켜 대상을 놓음(`shiftClearOfWorkPanel`). 이름표 크기 두 배 결함 수정(0.0.204 부터) | 도입함(MB 0.1.12) | MB 판: 줄마다 새 노드·질량·RBE 걸림(병합 흡수 노드는 '흡수')·좌표 + [보기]·[×], 줄 누르기·3D Alt+클릭·[3D 에서 독립 노드 고르기] = 독립(store `rigidIndependent`), 3D 초안(`three/RigidEditHighlight.js` MB 판 — 새 노드는 addedPos, 원근 카메라 크기 `three/screenMarker.js`), 독립 기본값 = 질량 노드 → 새 노드 → 병합 기본값(`data/rigidAddCandidates.js`+시험, 질량은 `data/liveMasses.js`), 3개 이상이면 방식 단추(고른 노드를 독립으로 / 무게중심에 새 노드), Remark 기본 MASS(질량 노드가 독립일 때만, MB 무게중심 RBE 에는 질량 칸이 없다), 작업 패널이 열린 동안 오른쪽 클릭 = 빼기. **안 옮긴 것**: [보기] 화면 이동이 아래쪽 작업 패널을 비켜 놓기(MU `ThreeViewport` `shiftClearOfWorkPanel` — MB 는 패널이 노드를 가린다, 헤드리스 확인) · 수정 내역이 바뀌어 없어진 노드 안내(`prunedNodeIds`, MB 는 선택에서 빼기만 이미 함). 필요하면 새 줄로 |
| 17 | 2026-11-11 | MU → MB | 추가한 질량 다시 보기·고치기 — 이번 편집에서 추가한 질량(addMasses)을 원본처럼 질량 상자로 그려 클릭으로 고르고(`three/MassMarkers.js` `syncMassMarkers`), 값 수정·삭제 대상에 넣음(`data/applyEditIntents.js` `collectLiveMasses`·추가 질량에 changeMasses/deleteMasses 반영, `data/EditIntent.js` 검증, `store/useEditStore.js` 선택), 정보 패널에 '이 노드의 질량'(`components/InspectorPanel.jsx`), 말풍선에 노드 질량·수정 반영 값(`components/PickTooltip.jsx`), `MassEditPanel` | 도입함(MB 0.1.11, 표시만) | MB 정보 패널 노드 상세에 '이 노드의 질량'(원본 + 추가, 값 수정·삭제 반영, `data/liveMasses.js`+시험). 3D 질량 상자에 추가 질량 그리기·추가 질량 값 수정/삭제 선택은 옮기지 않음(MB 는 C# 엔진·계약 시험까지 봐야 함) — 필요하면 새 줄로 |
| 18 | 2026-11-11 | MU → MB | 전체 초기화를 상단 메뉴 줄 [처음부터]로 옮김 — 어느 탭에서나 보임(예전 Model 탭 머리 작은 단추는 없앰). 로직은 `hooks/useFullReset.js`(+시험)로 분리, 확인 창 문구도 거기. `components/TopMenuBar.jsx`·`components/Sidebar.jsx` | 도입함(MB 0.1.11) | MB `hooks/useFullReset.js`(+시험) — 지우는 것 = 수정 내역·Analysis 입력·해석 결과, WorkBench 면 처음 모델 다시 불러옴. 상단 Save 탭 오른쪽 [처음부터], Model 탭 머리 작은 단추 삭제, 도움말 `top.reset`. 훅은 스토어가 달라 `ignore` |
| 19 | 2026-11-11 | MU | Hoist 권상점 옮기기 — 권상점 번호(N…)를 누르고 3D 에서 Shift+노드 클릭하면 그 자리만 바뀜(그룹 안 순서 유지, 다른 그룹 권상점·없는 노드는 거부, Esc 취소). 옮기면 자세안정성·구조 해석 결과를 비움. 칩 × = 빼기. `store/useEditStore.js` `startHoistMove`·`moveHoistNode`·`hoistMoveTarget`, `components/ThreeViewport.jsx`, `components/shell/ViewportHintBar.jsx`, `HoistPositionPanel.jsx` | 해당 없음 | MB 에는 Hoist(권상) 탭이 없다 |
| 20 | 2026-11-11 | MU → MB | 네이티브 `window.confirm`·`alert`·`prompt` 를 앱 안 확인 창으로(`store/useConfirmStore.js` `confirmAction`·`notify`·`askText` · `components/ConfirmDialog.jsx` · `store/nativeDialogs.test.js` — 세 파일 모두 `same` 으로 등록). Electron 에서 네이티브 창을 닫은 뒤 입력칸에 글자가 안 들어가던 문제 | 도입함(MU 0.0.217~0.0.218 9곳 · MB 0.1.10 9곳) | 같은 날 사용자 결정으로 MB 도 바로 옮김. WorkBench 프론트 10곳은 다음 exe 릴리스 때 |
| 21 | 2026-11-11 | MU | 노드 만들기·옮기기 등 편집으로 모델(파생 StageData)만 바뀌면 카메라를 무게중심으로 되돌리지 않음 — 회전 중심 고정 효과가 원본 모델·해석 결과·유체 비움·회전이 바뀔 때만 카메라를 옮긴다. `components/ThreeViewport.jsx` | 해당 없음 | MU 0.0.219. MB 뷰포트에는 회전 중심을 무게중심에 묶는 코드(`applyCogPivot`)가 없다 |
| 22 | 2026-11-11 | MU → MB | 질량을 '정보' 탭에서 바로 보이게 — 질량 추가·값 수정 뒤 첫 질량을 골라 '정보' 탭을 열고 완료 줄에 '오른쪽 정보 탭에 표시'. 질량점·질량 걸린 노드를 고르면 '표시' 를 보던 중이어도 '정보' 로 넘김(셸 규칙 6 의 예외, 그 밖은 점만). `components/shell/RightDock.jsx`·`components/MassEditPanel.jsx`·새 `data/infoDockFocus.js`(+시험) | 도입함(MB 0.1.15, 2026-11-19) | MU 0.0.220. MB 도 RightDock·MassEditPanel 이 같은 구조라 그대로 옮길 만함(추천: 도입, MB 공개 뒤 `/studio-sync`) · MB: `data/infoDockFocus.js`(+시험)를 같은 내용으로 복사해 `same` 에 올림, `RightDock` 은 MB `data/liveMasses.js` `collectLiveMasses` 로 판단, 질량 패널 적용 뒤 첫 질량을 골라 정보 탭 |
| 23 | 2026-11-12 | MU | 도구 막대 가서포트 › **제거** — 새 작업 패널 `components/SupportRemovePanel.jsx`(editDialog `removeSupports`, 줄마다 [보기]·[제거] + [모두 제거] 확인 창). `components/EditToolPalette.jsx`·`components/EditPanel.jsx` | 해당 없음 | MB 에는 가서포트가 없다(MU 고유 기능) |
| 24 | 2026-11-12 | MB·MU → MF | 노드 표시 — 화면 고정 크기 구(불투명, 옅은 테두리, 깊이 바이어스로 부재 앞), 정상 노드 중성색(MB `three/NodePoints.js`·`three/screenSpaceMaterial.js`). Edit 탭에서는 노드를 늘 켜고 결과 색 중에도 흐리게 하지 않음(MB `setActiveMode`) | 도입함(MF 0.1.93) | 사용자 지적 '노드가 안 보여 분할됐는지 알 수 없음'. MF `three/NodeMesh.js` 를 다시 씀(그룹별 InstancedMesh 유지), `screenSpaceMaterial.js` 는 MB 판을 그대로 복사(mm 단위라 바이어스 절대값만 1000 배). 노드 크기 조절(MB `nodePx` 슬라이더)은 옮기지 않음 |
| 25 | 2026-11-12 | MU → MF | 편집으로 화면용 모델만 바뀌면 카메라를 옮기지 않음(대장 21번, MU `_editBase`) + 이미 옮겨 준 [보기] 대상은 다시 옮기지 않음 | 도입함(MF 0.1.93) | 사용자 지적 '분할하면 뷰어가 리셋'. 원인 = 예전 [보기]·찾기 대상이 남아 화면용 모델이 바뀔 때마다 그 자리로 다시 이동(`ThreeViewport` 초점 effect). `data/editedStage.js` `_editBase` · `lastFocusRef` |
| 26 | 2026-11-12 | MB → MF | 새로 만든 노드·부재를 3D 에 따로 표시(MB `three/AddedNodesOverlay.js` 방식) — 새 노드 초록 구 + N번호, 나눈 부재 두 조각 청록 + E번호, 추가한 부재 초록 + E번호, 분할 미리보기 주황 점, 고른 노드 번호표 | 도입함(MF 0.1.93) | MF 새 파일 `three/MemberEditOverlay.js`(화면 고정 크기, 직교 카메라에서도 글자 크기 고정 `updateOverlayLabelScale`). Edit 탭에서만 |
| 27 | 2026-11-12 | MB → MF | 작업 패널 완료 결과 줄 — 무엇이 어떻게 바뀌었는지 줄로 + [보기] | 도입함(MF 0.1.93) | 사용자 지적 '어떤 부재가 어떻게 나뉘었는지 설명이 없음'. MF `components/edit/MemberEditPanels.jsx` `EditResult`(분할: 원래 번호 조각·새 조각·새 노드와 길이, 추가: 양 끝·참조·등급). MB 처럼 `WorkPanelFrame` 틀에 done 슬롯을 두는 것은 하지 않음 |
| 28 | 2026-11-12 | MU → MF | [보기]·찾기 화면 이동이 떠 있는 작업 패널을 비켜 대상을 놓음(MU `ThreeViewport` `shiftClearOfWorkPanel`, 대장 16번에서 MB 로는 안 옮긴 항목) | 도입함(MF 0.1.93) | 원근 카메라도 받게 1px 길이 계산만 넓힘. MB 에는 아직 없음 — MB 로 옮길 후보 |
| 29 | 2026-11-12 | MB → MF | 왼쪽 아래 조작 안내 한 줄(작업 패널이 떠 있으면 숨김) · 선택 바 해제에 Esc 표시와 [분할]·[부재로 잇기] 바로가기 · '표시' 도크 자동 펼침 1400px(대장 11번) | 도입함(MF 0.1.93) | 안내 문구는 MF 조작에 맞춤(더블클릭 = 그 자리로). 도움말 `view.camHints` |
| 30 | 2026-11-12 | MB·MU → MF | 남은 셸 차이 — 찾기 바 단계 추적판 · 뷰포트 안 실행취소 · 노드 크기 조절 · 위쪽 도구 안내(`ViewportHintBar`) | 보류 | 찾기 단계 추적은 MF 단계가 둘뿐이라 효과 작음. 범례 자리는 35번에서 옮김, 노드 크기는 36번(자동 맞춤)으로 대신해 조절 단추는 두지 않음, 말풍선은 42번에서 옮김 |
| 31 | 2026-11-12 | MB → MF | 편집 선택 강조 = 흰색 + 어두운 외곽, 굵기는 화면 픽셀(대장 10번, MB `three/SelectionHighlight.js` `EDIT_SEL_COLOR`) · 3D 단면 선택 발광도 흰색 | 도입함(MF 0.1.94) | MF `three/HighlightOverlay.js` `buildSelectedBeamOverlay`·`buildSelectedNodeOverlay`(예전 노랑 원통·구, 모델 크기 비례), `utils/colors.js` `selected`. RBE 연결·참조 복사 등 도구별 강조색은 그대로 |
| 32 | 2026-11-12 | MB → MF | 뷰포트 알림 칩(MB `components/ViewportNotices.jsx`, 셸 규칙 13 위쪽 가운데 금지) — Model Check 표식 알림을 위쪽 가운데 띠에서 칩으로, 연결 그룹 2개 이상 칩(Model 탭), 부재 분할·추가를 못 그린 칩(Edit 탭) | 도입함(MF 0.1.94) | MF `components/ViewportNotices.jsx`(내용은 MF 판, `same` 아님). 찾기 바가 열리면 거둠 |
| 33 | 2026-11-12 | MB → MF | 노드 레이어 기본 끔(MB `useViewerStore` `nodes: false`) — Edit 탭에서는 늘 켬(재빌드 뒤에도) | 도입함(MF 0.1.94) | 모델 전체를 볼 때 노드 구 1,600여 개가 부재를 덮었다(헤드리스 확인). '표시' 도크 Node 로 켤 수 있음 |
| 34 | 2026-11-12 | MU·MB → MF | 네이티브 `window.confirm` 을 앱 안 확인 창으로(대장 20번) — `components/ConfirmDialog.jsx`·`store/useConfirmStore.js` 를 MB 판 그대로 복사해 `same` 을 세 Studio 로 넓힘. MF 는 한 곳(Save › 수정 내역 불러오기, 다른 모델 경고) | 도입함(MF 0.1.95) | `store/nativeDialogs.test.js` 는 MF 가 node:test 라 내용만 같은 MF 판(`same` 아님). `utils/theme.js` 에 `btnBg`·`btnText` 이름표 추가 |
| 35 | 2026-11-12 | MB → MF | 3D 위 자리(셸 규칙 13, 대장 9·11번) — 작업 패널을 가운데 아래에서 왼쪽 아래(도구 막대 옆)로, 선택 바는 따로 가운데(`.selection-dock`), 범례는 축 기호 아래(3D 한가운데 오른쪽)에서 아래 오른쪽으로 + 불투명, 선택 바가 뜨면 조작 안내줄 숨김 | 도입함(MF 0.1.95) | 전반 검토(헤드리스 1600·1280 캡처)에서 작업 패널이 고칠 모델을 덮고, 범례가 하중 라벨을 덮고, 선택 바와 안내줄이 겹쳤다. MB 처럼 portal 로 옮기지는 않음(MF 는 패널이 이미 뷰포트 그릇 안) |
| 36 | 2026-11-12 | MF | 노드 화면 크기 자동 맞춤(`three/NodeMesh.js` `fitNodePx`) — 이웃 노드 간격이 화면에서 좁으면 6px 에서 1.6px 까지 줄임. 하중 화살표 머리는 화면 30px 상한(`three/arrowFit.js`) | MB·MU 로 옮길 후보(보류) | 모델 전체를 볼 때 노드 구가 1px 부재 선을 덮던 문제. MB·MU 는 `nodePx` 조절 단추로 사용자가 줄인다 — 자동 맞춤이 낫다고 보면 옮긴다(사용자 결정). 화살표는 MF 전용 |
| 37 | 2026-11-12 | MU → MF | 작업 패널이 열린 동안 3D 오른쪽 클릭(끌지 않음) = 빼기(대장 16번) · 수정 내역이 바뀌어 모델에서 없어진 노드와 부재를 고르던 칸과 선택에서 자동으로 뺌(MU `useEditStore` 끝 subscribe) | 도입함(MF 0.1.95) | MF `components/ThreeViewport.jsx`(RBE 연결, 부재 추가 노드 칸) · `store/pruneOnEdit.js` + `utils/memberEdits.js` `vanishedIds`(분할을 되돌리면 새 노드가 부재 추가 칸에 남아 적용 때 멈추던 것) |
| 38 | 2026-11-12 | MU → MF | RBE 묶기 — 어느 노드가 독립인지 3D 이름표로(대장 16번의 일부). MF 규칙: 2개 = `독립 N…`·`종속 N…`, 3개 이상 = 상자 중심에 `새 독립 노드` + 다른 RBE 에 속해 빠지는 노드 `빠짐 N…` | 도입함(MF 0.1.95) | MF `three/MemberEditOverlay.js`(`markNodes` 가 `{id,text}` 도 받음, `previewText`) · 이름표 높이 14 → 22px, 노드 번호는 위·부재 번호는 아래. MU 의 독립 노드 바꾸기(Alt+클릭, 줄 클릭)는 옮기지 않음 — MF 는 고른 순서가 규칙이고 서버(bridge)가 같은 규칙이라 intent 를 바꿔야 한다 |
| 39 | 2026-11-12 | MF | 아래 도크가 탭을 따라감 — Edit 에 들어오면 하중 표(MF·Winch·원본 입력)는 접고 Loads 에서 다시 폄. 구조 CSV·결과 표는 그대로 | 해당 없음(MB·MU 는 편집 중 도크가 원래 닫혀 있다) | MF 는 모델을 열면 하중 표를 한 번 펴 두는데 Edit 에서 창 높이의 3분의 1을 차지해 작업 패널이 모델을 덮었다(1280×760 에서 3D 420px). `shell/BottomDock.jsx`. ⚠ 사용법이 달라지는 변경 — 사용자에게 알림(2026-11-12 보고) |
| 40 | 2026-11-12 | MF | 화면 결함 수정(전반 검토) — 결과 표 머리줄이 도구줄 뒤에 숨거나 도구줄이 스크롤에 사라짐 · 흰 기본 스크롤 막대(`color-scheme: dark`) · 판정 필터와 `해석 전` 배지 줄바꿈 · 아래 도크 탭이 오른쪽 단추 밑으로 잘림 · Loads 탭 영문 단추(All·None·Invert) | 해당 없음 | MF 전용 화면. 어두운 화면의 기본 스크롤 막대는 MB `shell-conventions.md` 남은 것(P2)에도 있다 — MB 에서 고칠 때 같은 방법(`color-scheme`) |
| 41 | 2026-11-12 | MB·MU → MF | 검토하고 옮기지 않은 것 — [처음부터](18번) · Studio 안 사용 설명서 패널(`ManualDock`) · 그룹 자동 연결(`groupAutoConnect`) · 멀티 뷰포트 · 정보 도크 점 규칙(셸 규칙 6) | 해당 없음 / 보류 | [처음부터]: MF 는 수정 내역 [전체 비우기] 가 같은 일을 하고 권상점 같은 다른 상태가 없다. 설명서 패널: MF 설명서(문서버전 04, 0.1.87 기준)가 옛 내용이라 갱신 뒤(보류). 자동 연결: MF 엔진이 떨어진 부분에 구속을 넣어 풀고, RBE 로 이을지는 설계 판단(보류, 사용자 결정). 멀티 뷰포트와 정보 도크 규칙은 2026-11-03 MF 결정으로 뺌 |
| 42 | 2026-11-12 | MB → MF | 클릭하면 고정되는 말풍선(MB `components/PickTooltip.jsx`) — 누른 대상의 말풍선이 선택이 풀릴 때까지 남는다 | 도입함(MF 0.1.96) | 사용자 결정(2026-11-12 "진행해"). MF 는 마우스를 올리는 말풍선을 그대로 두고 고정을 더했다. MB 와 다른 점: 누른 화면 자리가 아니라 대상의 3D 점에 묶어 화면을 돌려도 따라온다(`three/pinnedTip.js`), 부재는 응력 줄(정응력 / 허용, 전단 / 허용, 판정)을 더 보이고 하중 케이스를 바꾸면 값이 바뀐다. 편집 도구를 열거나 Shift 로 여럿 고르면 거둔다. 3D 점에 묶는 방식은 MB·MU 로 옮길 후보 |
| 43 | 2026-11-13 | MU → MF | RBE 묶기를 MU 방식으로(대장 16번) — 고른 노드를 줄로 보임(좌표, 경계조건, 다른 RBE 꼬리표, [보기], [×]), 독립 노드 고르기(줄 클릭, 3D Alt+클릭, [3D 에서 독립 노드 고르기]), 3D 색은 독립 주황과 종속 파랑 | 도입함(MF 0.1.97) | 사용자 요청(2026-11-12 "RBE 추가와 제거, 다른 Edit 패널도 MU 컨셉으로"). MF 규칙: 2개 = 먼저 고른 노드가 독립, 3개 이상 = [중심에 새 독립 노드 \| 고른 노드를 독립으로] 를 고름. '고른 노드를 독립으로' 는 intent `addRigid { independentNode, dependentNodes[…] }` 이고 bridge `add_rigid_from_params` 가 이미 받아 서버 변경이 없다. 규칙 원본 `utils/rigidCheck.js` `connectShape`(패널, 3D 이름표, 적용이 같은 함수). `data/rigidEditColors.js` 는 MB, MU 와 내용이 같아 `same` 을 세 Studio 로 넓힘. MU 의 '질량 노드가 기본 독립' 과 Remark MASS 는 MF 에 질량 편집이 없어 뺌. 실제 마우스로 Alt+클릭과 오른쪽 클릭 확인(헤드리스) |
| 44 | 2026-11-13 | MU → MF | 원본 RBE 수정과 삭제 패널을 MU 방식으로(MU 0.0.202) — 진행 단계, RBE 번호로 고르기, 색 범례, 번호 칩으로 넣기와 빼기, [화면에서 보기], [처음 상태로], 결과 줄 | 도입함(MF 0.1.97) | intent 는 그대로(`editRigidDependents`, `deleteRigid`). 3D 색: 그대로 둘 종속 파랑, 넣을 노드 초록, 뺄 노드 빨강(`three/HighlightOverlay.js`). 분할, 참조 복사, 그룹 삭제 패널에도 [보기] 와 결과 줄을 넣고, 패널이 길면 머리와 주 버튼을 고정(`.work-panel` 62vh) |
| 45 | 2026-11-13 | MF | 부재 추가 — 단면을 목록에서 찾아 고르기([참조 부재 누르기 \| 단면 목록에서 찾기], 치수, 단면 번호, 부재 이름, 등급으로 검색) | 해당 없음(MB, MU 는 단면 카탈로그 `SectionPicker` 로 고른다) | 사용자 요청(2026-11-12). 서버 규칙(새 부재는 참조 부재의 단면과 출처를 따름)은 그대로 두고, Studio 가 새 부재 자리에 가장 가까운 같은 단면 부재를 참조로 고른다(`utils/propertyChoices.js` `nearestElementOfProperty`). 목록 이름은 구조도 표기(`utils/shipLabel.js`) |
| 46 | 2026-11-13 | MF | Edit 탭에서 노드가 보이는데 눌러 고를 수 없던 결함 수정(33번의 부작용, MF 0.1.94~0.1.96) | 해당 없음(MF 의 `resolvePick` 경로) | `ThreeViewport` `resolvePick` 이 Node 레이어가 꺼져 있으면 노드를 걸렀는데, Edit 탭은 레이어와 무관하게 노드를 그린다 → Edit 탭이면 고르기도 허용. 도구 패널을 연 상태의 노드 고르기는 원래 됐다 |
| 47 | 2026-11-17 | MB | Review 탭 — 엔진이 대신 정한 것(00_Review.json 검토 단위)을 승인, 거절, 나중에로 결정, 거절은 자기 번호로 남은 엔진 RBE 만 `deleteRigid`, 나머지는 '수동 수정 필요'. `useEditStore.addIntent` 가 `origin: {reviewUnit}` 를 남김 | 해당 없음(MU, MF 는 BDF 입력이라 엔진 검토 자료가 없다) | `data/reviewData.js`, `store/useReviewStore.js`, `hooks/useReviewSync.js`, `components/panels/ReviewPanel.jsx`. 계획서 6단계 |
| 48 | 2026-11-18 | MU | Edit › 그룹 체크박스 일괄 삭제 — [전체 선택](본 구조 제외), [선택 해제], [선택한 N개 그룹 삭제], 앱 안 확인 창(요소·노드 수, 권상점, 결과 지워짐), 그룹마다 `deleteGroup` 을 같은 batchId(Ctrl+Z 한 번). 고를 그룹이 2개 미만이면 체크박스 숨김 | 도입함(MB 0.1.14, 2026-11-19) | MB Edit 그룹 목록도 같은 모양이라 들여올 수 있다. 규칙 `data/groupBulkDelete.js`(+시험), 스토어 `deleteConnGroups`(중간 실패면 이번에 넣은 것 모두 뺌), `components/GroupManager.jsx`. MB 공개 뒤 `/studio-sync` · MB 는 이미 있던 `deleteGroups`(같은 batchId, 그 그룹 노드를 쓰던 추가 RBE 도 정리)를 그대로 쓰고 화면만 붙였다 — MB `data/groupBulkDelete.js`(줄 단위, RBE 병합 미리보기 줄 = 원본 그룹 여러 개), `hooks/useGroupDeletion.js` `deleteSources`, `components/panels/EditPanelDock.jsx`. 같은 경로 MU 파일과 내용이 달라 `same` 이 아님 |
| 49 | 2026-11-18 | MU | 자세안정성 평가 모드 3단계(Strict, Standard, Advisory) — `data/evaluationMode.js`, 스토어 `evaluationMode`·`setEvaluationMode`·`hydrateEvaluationMode`, host `getStudioSettings`·`setStudioSettings`(설정 파일), Hoist 3단 선택, 구조 해석 진행 조건, Analysis Advisory 배너 | 해당 없음(MB 에는 권상과 자세안정성 평가가 없다) | 설정 파일 통로(host `getStudioSettings`, Electron `viewer:getStudioSettings`)는 Studio 공통으로 만들어 두었다 — MB 에 사용자 설정이 생기면 같은 통로를 쓴다 |
| 50 | 2026-11-19 | MU | RBE 독립 · 종속 바꾸기 — intent `swapRigidNodes`, `data/rigidSwap.js`, `components/RigidSwapPanel.jsx`, `three/RigidSwapHighlight.js`, `RigidEditHighlight.js` 의 그리기 도우미 3개를 export, 뷰포트 클릭·강조 연결 | 보류 | MB 는 편집을 C# 엔진이 적용하므로 들여오려면 Studio 미리보기, C# `apply-edit-intent`, 계약 시험(`test_modelbuilder_edit_contract.py`) 3곳이 필요하다. MB 에서 같은 요청이 나오면 옮긴다 |
| 51 | 2026-11-19 | MU → MB | [보기]·찾기 화면 이동이 떠 있는 작업 패널을 비켜 대상을 놓음(MU `ThreeViewport` `shiftClearOfWorkPanel`, 16번에서 MB 로 안 옮긴 것, MF 는 28번) | 도입함(MB 0.1.15) | MB 는 화면 맞추기가 `three/viewportGeometry.js` `focusEntity` 에 있어 그 직교 카메라 갈래에 넣었다(캔버스를 인자로 받음). 원근 카메라는 그대로 |

1~8 은 기준선을 잡으며 '거의 같은' 파일 21개의 차이를 읽어 찾은 것이다(그때 이미 있던 차이라 검사의 '바뀜' 에는 안 뜬다).

## 짝을 늘릴 때

규칙 파일은 Studio 수에 묶이지 않는다. `studios` 에는 다섯 Studio 가 모두 등록돼 있고, 묶음(`groups`)만 더하면 된다.

1. `python scripts/studio_pair.py --scan <id> <id> [-v]` 로 두 Studio 를 훑는다(내용 같음 / 거의 같음 / 갈라짐 / 이름은 같고 경로가 다름).
2. `scripts/studio_pair.json` `groups` 에 묶음을 더한다 — `members`(둘 이상), `same`(내용 같음 중 계속 같게 둘 것), `"watch": "auto"`.
   - 세 Studio 가 같은 파일을 쓰면 한 줄에 `{"path": "…", "also": ["<다른 Studio id>"]}`(예: `data/findEntity.js` 는 MB·MU·MF 세 곳).
   - Studio 마다 경로가 다르면 `{"paths": {"<id>": "…", "<id>": "…"}}`.
3. `python scripts/studio_pair.py --group <묶음 id> --ack --all` 로 기준선을 잡고, 그때 본 차이는 대장에 '보류' 줄로 남긴다.
4. `pytest tests/test_studio_pair.py`(HiTessWorkBenchBackEnd/ 에서) — 규칙 파일 모양을 확인한다.

훑어 본 값(2026-11-10, 등록은 MB·MU 뿐):

| 쌍 | 경로가 같은 파일 | 내용 같음 | 거의 같음 | 메모 |
|---|---|---|---|---|
| MB ↔ MU | 106 | 20 | 21 | 등록됨(`mb-mu`) |
| MU ↔ SP | 96 | 23 | 17 | SP 는 MU 에서 갈라진 Studio 라 사본이 가장 많다 — 다음 묶음 후보 |
| MB ↔ SP | 79 | 13 | 14 | |
| MB ↔ MF | 38 | 1 | 5 | `data/findEntity.js` 만 같다(`also` 로 이미 검사) |
| MU ↔ MF | 34 | 3 | 3 | |
| MU ↔ PL · SP ↔ PL | 7 · 10 | 1 · 3 | 0 · 1 | 구조가 달라 짝으로 묶을 것이 거의 없다 |

## 하지 않기로 한 것

- 갈라진 파일을 다시 같게 맞추기 — 도메인이 달라 갈라진 것이 많다. 지켜보기만 한다.
- 공용 패키지(모노레포·서브트리)로 묶기 — 저장소·빌드·zip 배포가 Studio 마다 따로라 지금 규모(20개)에는 과하다. 같아야 하는 파일이 크게 늘면 다시 본다.
