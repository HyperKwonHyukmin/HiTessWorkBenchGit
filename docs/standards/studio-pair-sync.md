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
| 1 | 2026-11-10 | MU → MB | `components/edit/textEntry.js` `isOutsideEntry` — 작업 패널 단축키가 찾기 바 같은 바깥 입력칸의 키를 가로채지 않게 하는 검사(MU 패널 8곳이 씀) | 보류 | 도입. MB 에 같은 증상이 실제로 있는지는 확인 안 함 |
| 2 | 2026-11-10 | MU → MB | `components/edit/useSectionPick.js` `lockChoice` — 단면 적용 뒤 기본값이 다음 PID 로 넘어가지 않게 고정 | 보류 | 도입(같은 패널 구조) |
| 3 | 2026-11-10 | MB → MU | `main.jsx` 의 `ErrorBoundary` — 화면 오류 때 빈 화면 대신 안내. MU 에는 컴포넌트 자체가 없다 | 보류 | 도입 |
| 4 | 2026-11-10 | MB ↔ MU | `utils/groupPalette.js` — MB 는 그룹을 전부 따로 보이고, MU 는 11개 이상이면 상위 10개 + '기타' 로 묶는다 | 보류 | **사용자 결정** — MB 방식으로 맞출지 |
| 5 | 2026-11-10 | MU → MB | `three/rigidClassification.js` — U-bolt RBE 판별 한 곳. MB 는 같은 함수가 `RigidMesh`·`UboltMarkers`·`UboltDofLabels` 세 파일에 따로 있다 | 보류 | 도입(정리, 동작 변화 없음, 급하지 않음) |
| 6 | 2026-11-10 | MB → MU | `MessagesTab`·`HelpCenter`·`HelpModeLayer`·`HelpTopicBody`·`GuideRunner` 5개가 테마 읽는 줄만 다르다(MB 밝은/어두운, MU 어두운 화면만) | 보류 | MU 가 MB 판을 그대로 써도 되는지 확인 후 `same` 으로(MU `palette()` 는 인자를 무시, MU 저장소에 `theme` 값 없음) |
| 7 | 2026-11-10 | MB ↔ MU | `three/orthoPan.js` — 코드는 같고 주석만 다르다 | 보류 | 한쪽으로 맞추고 `same` 으로 |
| 8 | 2026-11-10 | MU → MB | `data/sectionChoices.js` — PROD·PBAR 등 PBEAML 이 아닌 단면을 선택지에서 뺌 | 보류 | 해당 없음 후보(MB 입력은 CSV 라 그 카드가 없다). 넣어도 해는 없음 |
| 9 | 2026-11-10 | MB → MU | 작업 패널을 뷰포트 그릇 안에 그림 — `edit/WorkPanelFrame.jsx` 가 `data-viewport-root`(ViewportContainer)로 portal, 떠 있는 동안 조작 안내줄 숨김(`useViewerStore.workPanelCount`). 예전 화면 고정 좌표는 아래 도크·오른쪽 도크를 몰라 좁은 창에서 3D 밖으로 나갔다 | 도입함(MU 0.0.206) | MU `edit/WorkPanelFrame.jsx`·`ViewportContainer`·`useViewerStore.workPanelCount`. 패널 9종이 같은 틀이라 한 곳만 고침 |
| 10 | 2026-11-10 | MB → MU | 편집 선택 = 흰색 + 어두운 외곽(`three/SelectionHighlight.js` `EDIT_SEL_COLOR`) · 그룹 색 1번(본 구조) = 회청색, 목록 이름 '그룹 1 · 본 구조'(`utils/groupPalette.js`) | 도입함(MU 0.0.206) | 부재 선택 굵기도 화면 픽셀 기준으로. '기타' 묶음 색은 노랑(4번 — 묶는 방식 자체 — 은 그대로 보류). Hoist 탭 권상점 표식은 다른 부품이라 영향 없음 |
| 11 | 2026-11-10 | MB → MU | 3D 위 자리 규칙 — 범례는 늘 아래 줄 위(bottom 46), 조작 안내줄 한 줄 + 말줄임, 편집 선택 바는 좌표축·범례 자리를 뺀 영역의 가운데, '표시' 도크 자동 펼침은 창 폭 1400px 이상만(`ViewportContainer`·`ThreeViewport`·`shell/EditSelectionBar`·`shell/RightDock`) | 도입함(MU 0.0.206) | 도크 자동 펼침 1400px·조작 안내줄 한 줄·패널 뜬 동안 숨김·뷰포트 머리 `N: E:` 삭제만. 범례·선택 바 자리는 해당 없음(MU 에 3D 범례가 없다) |
| 12 | 2026-11-10 | MB → MU | 뷰포트 알림 칩(`components/ViewportNotices.jsx`, MB 에만 있는 새 파일) — 분리 그룹·장비 COG·CSV 추적을 뷰 도구줄 아래 줄의 칩으로 | 도입함(MU 0.0.206) | MU `components/ViewportNotices.jsx` — 분리 그룹 칩 하나만(도구줄 두 줄 아래). 파일 이름은 같지만 내용은 Studio 마다 다르다(`same` 아님) |
| 13 | 2026-11-10 | MB | 다크 전용 전환(테마 단추 삭제, `utils/theme.js` `palette()` 가 인자 무시, `store/useViewerStore.js` `theme` 은 늘 dark) · `EDIT MODE` 배지 삭제 · Analysis 위쪽 안내줄 삭제 · 아래 도크 머리 건수 하나로(`dock/AuditTab`·`shell/BottomDock`) | 해당 없음 | MU 는 이미 다크 전용·BDF 입력이라 감사 건수가 없다. 6번(테마 읽는 줄만 다른 5개)을 `same` 으로 묶기 쉬워졌다. `EDIT MODE` 배지는 MU 에 남아 있는지 `/studio-sync` 때 확인 |
| 14 | 2026-11-10 | MB → MU | Model Check — 떨어진 그룹이 있으면 '자동 연결'을 그룹 목록 위에 펼쳐 둠(MB `panels/ModelCheckPanel.jsx` ↔ MU `panels/ModelCheckPanelDock.jsx`, 경로가 달라 검사에는 안 잡힌다) · Model 탭 안내 카드 '처음 쓰신다면 — 따라하기' · Edit '선택' 설명 한 문장 · 그룹 목록 '그룹 1 · 본 구조' | 도입함(MU 0.0.206) | MB 의 '검증 진단 한 줄로'는 MU 에 그 구역이 없어(FEM 건전성 표) 해당 없음 |
| 15 | 2026-11-10 | MB → MU | 그룹 목록 모양(Model Check·Edit 둘 다) — [전체 표시] [전체 숨김] + 그룹 색 카드 한 줄(줄 전체 = 표시/숨김, 눈 아이콘), Edit 는 오른쪽에 휴지통(삭제 예약 ↔ 되돌리기). MU 는 '그룹 관리' 상자(기준 전환·확인·단독·그룹 새로고침)라 그룹 하나가 두 줄이었다(MB `panels/ModelCheckPanel.jsx`·`panels/EditPanelDock.jsx` ↔ MU `panels/ModelCheckPanelDock.jsx` `GroupCheckList`·`components/GroupManager.jsx`) | 도입함(MU 0.0.207 Model Check · 0.0.208 Edit) | 사용자 요청 '모델 빌더 스타일로 다'. MU 에서 없앤 것 = 단독 보기 단추([전체 숨김] 뒤 한 줄 누르기로 대신)·그룹 새로고침·기준 전환. 부재 종류(구조·배관) 삭제는 MU 에만 있는 기능이라 목록 아래 '부재 종류로 지우기'로 남김. Edit 구역 이름 '그룹 관리' → '그룹'. [전체 표시·숨김]은 MB Edit 에 없다 — MB 로 옮길 후보 |

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
