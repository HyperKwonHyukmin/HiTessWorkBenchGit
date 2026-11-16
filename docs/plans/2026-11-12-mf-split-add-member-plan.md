# Mooring Fitting Studio — 부재 나누기와 노드끼리 새 부재 넣기 계획 (2026-11-12)

현업 신고 5번: "해석 이후 프로그램 내부에서 부재를 SPLIT 후 NODE TO NODE 연결하여 새로운 부재를 넣을 수 있는 기능 추가".
예: 보강재를 하나 더 넣어 보려면 기존 부재 중간에 노드가 있어야 하고, 그 노드와 다른 노드를 잇는 부재를 만들어야 한다.

## 지금 상태 (조사 결과)

- **MF Studio 편집 도구** 5개: 단면, 재질(CSV 행) / 참조 복사 / RBE 연결 / RBE 수정 / 그룹 삭제. 노드와 부재를 만드는 도구는 없다.
  2026-11-03 에 'CSV 로 되돌릴 수 없는 노드 편집은 MF 에 넣지 않는다'고 정했다. 이번 요청은 이 결정을 바꾸는 일이다.
- **편집 적용 경로** = 백엔드 `analysis.py` → `nastran_bridge.apply_edit_json`(MF 는 bridge 가 기본 경로).
  bridge 가 아는 kind: `deleteGroup`, `addNode`, `addRigid`, `duplicateElement`, `changeElementProperty`, `deleteRigid`, `editRigidDependents`, `emptyPipeFluid`, `rotateModel` (+ 백엔드 `editCsvRow`).
  부재를 나누거나 두 노드 사이에 새 부재를 만드는 kind 는 없다.
- **해석 BDF 조립** `_build_solvable_edited_bdf`(`analysis.py`): 새 GRID 는 내보내지만, 새 요소는 **복제(reinforceOf)만** 원본 블록을 베껴 내보낸다.
  출처 없는 새 요소는 주석대로 건너뛴다("현재 범위는 duplicateElement 만"). 원본 요소의 양 끝 노드를 바꾸는 경로도 없다.
- **재질 판정**: 엔진 `MemberMaterialMap.LoadForModel` 이 `<bdf>.model.json` 의 `reinforceOf` 로 원본 재질을 물려준다. 새 요소는 재질표에 없으면 235 + '등급 미확인'.
  행 편집용 등급 덮어쓰기(`write_grade_overrides` → `<bdf>.grades.json`)가 이미 있다.
- **참고할 구현**: MB Studio 가 `addNode`(절대좌표, 기준 노드에서 변위, 두 노드의 중점), `addElement { elementId, startNode, endNode, propertyId }` 와
  작업 패널(`GeometryEditDialogs.jsx`, `edit/WorkPanelFrame.jsx`)을 갖고 있다. MF 에도 `edit/WorkPanelFrame` 이 있다. 부재 나누기는 MB 와 MU 모두 없다.

## 정할 것 (추천안 먼저)

| # | 질문 | 추천 | 이유 |
|---|------|------|------|
| D1 | 나누는 위치를 어떻게 정하나 | **부재 위 비율(0~1) 또는 한쪽 끝에서 거리(mm)**, 그리고 '다른 노드에서 내린 수선의 발' | 비율과 거리는 숫자 입력, 수선의 발은 새 부재를 직각으로 붙일 때 쓴다 |
| D2 | 새 부재의 단면 | **참조 부재를 골라 그 단면을 그대로 씀**(지금 '참조 복사'와 같은 방식) | 단면 치수를 새로 입력하면 갑판 유효폭, 부식 마진, 순두께 규칙을 사용자가 알아야 한다. 참조 부재는 엔진이 만든 단면이라 규칙이 이미 맞다 |
| D3 | 새 부재의 강재 등급 | **참조 부재 등급을 기본값**으로, 바꿀 수 있게 | 재질 판정(235/315/355)이 결과를 좌우한다. 등급 없이 두면 235 로 떨어진다 |
| D4 | 나눈 조각의 단면과 등급 | **원래 부재 그대로**(두 조각 모두) | 나누기는 모양만 바꾸는 일이다 |
| D5 | 나눈 조각과 CSV 행 | **원래 부재의 CSV 행을 따른다**(행 편집, CSV 표, 보고서 이름이 그대로 맞게) | 나누기 때문에 행 편집이 그 조각만 빼먹으면 안 된다 |
| D6 | CSV 로 내보내기 | **하지 않음.** 'CSV 로 안 돌아가는 수정'으로 세고 Save 탭에서 알린다 | CSV 형식에 '사용자가 넣은 부재'를 담을 칸이 없다 |
| D7 | 부재 방향(CBEAM 방향 벡터) | **참조 부재의 방향 벡터를 쓰고**, 새 부재 축과 거의 평행이면 엔진 규칙(수평 (0,0,1), 수직 (1,0,0))으로 바꾼다 | 방향 벡터가 축과 평행하면 Nastran 이 FATAL 을 낸다 |

## 단계

### 1. bridge — 새 intent 2개 (`InHouseProgram/NastranBridge/nastran_bridge.py`, 145 수동 교체 대상)
- `splitElement { elementId, newNodeId, newElementId, at: { ratio } | { x, y, z } }`
  - 새 GRID 를 부재 선 위에 만든다(좌표를 주면 선 위로 투영, 양 끝 1 mm 안이면 거절).
  - 원래 요소 = (A, 새 노드), 새 요소 = (새 노드, B). 새 요소는 원래 요소의 type, PID, 방향, category 를 복사하고 `splitOf` 를 남긴다.
- `addElement { elementId, startNode, endNode, refElementId, propertyId?, orientation? }` — MB 와 같은 이름으로 맞춘다.
  - 단면, 방향, category 는 참조 부재에서, `addedFrom = refElementId` 를 남긴다.
- 적용 순서: `addNode` → `splitElement` → `addElement` → 나머지(addElement 가 나눈 노드를 쓸 수 있게).
- 시험: 나눈 두 조각의 길이 합 = 원래 길이, 같은 노드 두 번 쓰기, 길이 0 부재 거절.

### 2. 백엔드 — 해석 BDF 와 재질
- `_build_solvable_edited_bdf`:
  - 나눈 원래 요소는 원본 블록의 GB(끝 노드)만 바꿔 내보낸다.
  - 새 요소는 `splitOf`, `addedFrom`, `reinforceOf` 중 있는 출처의 블록을 베껴 EID, GA, GB, PID, 방향 벡터만 바꾼다.
- 재질: 새 요소의 등급은 `<bdf>.grades.json` 에 싣는다(나눈 조각 = 원래 부재 등급, 새 부재 = 화면에서 고른 등급). 엔진은 바꾸지 않는다.
- 행 편집(`mooring_row_edit`): 대상 요소에 `splitOf` 로 이어진 조각도 넣는다(지금 `reinforceOf` 처리와 같은 자리).
- 시험: 나누기와 새 부재가 든 편집으로 실제 Nastran 실행 시 FATAL 0, 평형 잔차가 기준 안.

### 3. Studio — 도구 2개 (MooringFittingStudio)
- 도구 막대에 '부재 나누기', '부재 추가'. MB 작업 패널 방식(뷰포트 안 아래쪽 패널, 3D 클릭이 칸에 들어감, Esc, 적용 뒤 패널 유지)을 따른다.
  - 부재 나누기: 부재 클릭 → 위치(비율 / 거리 / 다른 노드의 수선의 발) → 미리보기 점 → [나누기].
  - 부재 추가: 노드 2개 클릭 → 참조 부재 클릭(단면, 등급 미리 채움) → 등급 확인 → [추가].
- 편집 미리보기: 새 노드와 새 부재를 뷰포트에 그린다(파생 모델, 원본 StageData 는 그대로).
- 수정 내역, Ctrl+Z, 낡은 결과 표시, 'CSV 로 안 돌아가는 수정' 수는 기존 장치를 그대로 쓴다.
- 정보 패널: 새 부재는 '사용자가 추가한 부재(참조 E…)', 나눈 조각은 '원래 E… 를 나눈 조각'.

### 4. 보고서
- 새 부재는 6장 표와 부록에 '(added)' 를 붙이고, 1.2 Scope 에 '사용자가 추가한 부재 N개, 나눈 부재 M개' 한 줄을 넣는다.
- 단면 이름(구조도 표기)은 참조 부재의 행 종류를 따른다.

### 5. 검증
- 샘플(NewCase_01)에서 부재 하나를 나누고, 그 노드와 옆 부재 노드를 잇는 새 부재를 넣은 뒤 Studio 해석 → FATAL 0, 새 부재에 응력과 판정이 나오는지 확인한다.
- 같은 편집을 저장한 뒤 다시 불러와 결과가 같은지, 행 편집과 함께 써도 나눈 조각이 따라가는지 확인한다.
- 헤드리스 Chrome 으로 패널 입력부터 해석까지 확인한다. WorkBench 앱 안 화면은 사용자 확인.

## 배포 영향
- bridge(`nastran_bridge.py`) → 70, 145 InHouse 수동 교체. 백엔드 → `git pull + 재시작`. Studio → `/studio-release mooring-fitting-studio`.
- 순서: bridge 와 백엔드를 먼저 → Studio. 옛 bridge 는 새 kind 를 모르므로 Studio 가 먼저 나가면 편집 적용이 실패한다(조용히 빠지지 않는지 1단계 시험에서 확인).
- 엔진(MooringFitting.exe)은 바꾸지 않는다.

## 규모
- bridge 와 백엔드 반나절, Studio 하루, 검증 반나절 정도로 본다.

## 진행 상태 (2026-11-12, D1~D7 추천안대로)

- **bridge**(`nastran_bridge.py`, InHouse 와 `WorkBenchSubModule/Nastran_bridge` 두 사본 같은 내용 — 70 백엔드는 SubModule 사본을 읽는다):
  `splitElement`, `addElement` 추가. 적용 순서 = rotate → addNode → splitElement → addElement → 나머지(Studio 가 정한 번호를 복제보다 먼저 잡게).
  기존 kind 처리는 그대로. 백업 `nastran_bridge.py.bak_20261112_before_split`(InHouse). 시험 `tests/test_bridge_split_add_element.py` 11건.
- **백엔드**: `_build_solvable_edited_bdf` 가 나눈 원래 부재의 GB 와 조각, 새 부재를 실제로 내보낸다(출처 = reinforceOf / splitOf / addedFrom 사슬, 새 부재는 방향 벡터까지).
  출처 없는 새 요소는 예전처럼 건너뛰지 않고 멈춘다. 등급 = `new_member_grade_overrides`(조각 = 원래 부재, 새 부재 = 화면에서 고른 값 또는 참조) → `<bdf>.grades.json`.
  행 편집이 조각(splitOf)을 따라간다. viewer-zip `element_names` 에 `plateGrade` 추가.
- **엔진**: 보고서 1.2 Scope 에 '스튜디오에서 넣은 부재 N개(beam 번호), 나눈 부재 M개' 문장(편집 모델 `<bdf>.model.json` 기준). 해석 규칙은 바꾸지 않았다.
- **Studio 0.1.91**: 도구 막대 '부재 분할'(비율 / 거리 / 다른 노드의 수선의 발), '부재 추가'(노드 2개 → 참조 부재 → 등급 확인).
  화면은 `data/editedStage.js` 의 파생 모델로 그려 나눈 점의 노드와 새 부재를 바로 누를 수 있다. 분할을 지우면 그 노드와 조각을 쓰는 수정도 함께 지운다(`withDependents`).
  정보 패널에 'E… 를 나눈 조각', '사용자가 추가한 부재 (참조 E…)'. 규칙 사본 `utils/memberEdits.js`(+시험).
- **확인**: NewCase_01 에서 E1940 을 가운데서 나누고 그 노드와 N2070 을 잇는 새 부재 → 실제 solve-bdf 성공, F06 FATAL 0, 결과 요소 1936(원래 1934), 새 부재 등급 AH(σy 315), 조각 등급 B(원래).
  Studio 헤드리스로 같은 조작을 하면 서버와 같은 번호(N2289, E900007, E900008)가 나오고, 분할을 지우면 새 부재까지 지워지고 Ctrl+Z 로 돌아온다.
  보고서에 문장이 들어간다. WorkBench 앱 안 화면과 실제 3D 마우스 클릭은 확인 안 함(스토어 동작으로 시험).
- **남은 것**: 보고서 표의 부재별 '(added)' 표시는 하지 않았다(Beam 칸이 숫자 형식). 새 부재의 3D 미리보기 전용 색은 없다(적용 뒤 일반 부재로 보임).

## 커밋 전 독립 리뷰 반영 (2026-11-12, 리뷰 2건 — WorkBench·bridge / 엔진·Studio)
- 막아야 함 1: 옛 bridge 면 분할·추가를 건너뛰고 '성공' → `_apply_mooring_edits` 가 'bridge 교체 필요' 로 멈춘다.
- 막아야 함 2: 참조 복사를 한 부재를 나누면 서버가 나누기를 먼저 적용해 한 조각에만 남는다 → Studio `commitSplit` 이 그 부재(같은 노드쌍 포함)에 참조 복사가 걸려 있으면 막는다. 나눈 뒤 조각에 참조 복사는 화면용 모델로 계산해 된다.
- 고치면 좋음 반영: `originElementId`(조각·새 부재의 원래 부재 번호, bridge·Studio 사본) · 해석 BDF 오류를 SystemExit 대신 ValueError · 'MF 만' 기록 재열기에서 빈 Load CSV 를 불러오지 않음 · 'Winch 만' 하중 0 진단 문구 · 부식 마진 '없거나 읽을 수 없음' 문구 · 보고서 부록 A 순두께와 6장 이름(총두께) 구분.
- 남김: 나눈 조각·새 부재는 연결 그룹 0(미분류)으로 보인다 · 겹친 부재 중 하나만 나누면 나머지는 나뉘지 않는다(같은 양 끝에서만 이어짐) · 보고서 표 부재별 '(added)' 표시 없음.
- 확인: 백엔드 전체 2218 통과 · 엔진 103 · Studio 64 · 프론트 유틸 481 · 실제 Nastran FATAL 0. Studio 0.1.92.
