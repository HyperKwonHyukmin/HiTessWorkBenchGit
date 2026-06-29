# Module Unit Studio — Analysis 탭 "가서포트(보강) 추가" 재해석 설계

- 작성일: 2026-06-29
- 대상: Module Unit Studio (`C:\Coding\WorkBenchSubModule\ModuleUnitStudio\apps\module-unit-studio`) + HiTESS WorkBench 백엔드(검증 한정)
- 관련 파이프라인: Group & Module Unit 권상 구조 해석 (GroupModuleUnit → ModuleStability → UnitStructuralAnalysis)

## 1. 목적 / 요청

1. **(텍스트)** 상단 리본 탭 `Analyze` → `Analysis` 로 라벨 변경.
2. **(기능)** Analysis 리본 메뉴에 **"가서포트 추가"** 버튼을 만들고, 버튼이 활성인 상태에서 **Shift + Node 2개**를 선택하면 두 노드를 잇는 **100×100 L 단면(두께 10t) beam** 을 설치한다. 가서포트를 설치한 뒤 **"구조 해석 실행"** 을 다시 누르면 **L beam 이 추가된 보강 조건**으로 Module Unit 을 재해석한다.

### 확정된 결정 (사용자 선택)

| 항목 | 결정 |
|------|------|
| L 단면 치수 | **고정** 100×100×10t (등변 앵글, 재질은 모델 기존 구조용 강재 재사용) |
| 재해석 트리거 | **자동** — 가서포트 추가 시 직전 결과 리셋 + 실행 시 `_edited.json` 자동 재업로드 후 lift-run |
| 자중 / COG | **구조해석만 재실행, COG 고정** — 가서포트 자중은 Nastran 중력해석엔 포함되나 권상 밸런스 COG엔 미반영(가벼운 보강재, 보수적) |
| 단면 방향(orientation) | **기본 방향 자동** — 부재축에 수직인 비퇴화 orientation 벡터 자동 산출 |

## 2. 접근 방식

**채택 — Approach A: 프론트엔드 intent 주입 (백엔드 무수정).**

가서포트를 새 edit intent `addSupportBeam` 으로 만들고, 기존 `buildEditedStageJson` 이 편집 모델 JSON(`_edited.json`)에 **CBEAM 1개 + PBEAML `L` 단면 property 1개**를 주입한다. 백엔드 `nastran_bridge.convert_json_to_bdf` 는 이미 PBEAML L · CBEAM 출력을 지원(`nastran_bridge.py` 1955–1964, 1979–1981)하므로 **백엔드/nastran_bridge 코드 변경이 원칙적으로 없다.** 보강이 `_edited.json → _edited.bdf → lift-run → 최종 _lifting.bdf` 까지 그대로 흐른다.

**기각 — Approach B (백엔드 intent 적용):** Module Unit 의 `_edited.json` 은 얇은 intent 목록이 아니라 **이미 완성된 모델 JSON** 이며 백엔드는 JSON→BDF 변환만 수행한다. 백엔드에서 intent 를 해석하게 하려면 계약을 바꿔야 해 부적합.

## 3. 데이터 흐름

```
[Analysis 탭] "가서포트 추가" 토글 ON
  → 3D 뷰에서 Shift + Node A, Node B 클릭
  → useEditStore.pickSupportNode → 2개 도달 시 addIntent({kind:'addSupportBeam', params:{startNode,endNode,sectionKind:'L',dims:[100,100,10,10]}})
  → useUnitStructuralStore.reset()  // 재실행 잠금(isFinished) 해제
  → 3D 에 L beam 미리보기(별도 색) overlay

[Analysis 탭] "구조 해석 실행"
  → (NEW) buildEditedStageJson(stage, intents) 로 _edited.json 재생성
  → host.uploadEvaluationArtifact(buildEditedStageFileName(stage), json)   // Hoist 가 쓰던 동일 경로
  → host.runUnitStructural({ stabilityPath, safetyFactor, allowableMpa })
  → 백엔드 unit_structural_service: _edited.json → _edited.bdf → lift-run(prepare) → Nastran SOL101 → lift-result
  → WorkBench Step3 ResultArtifactsCard 에서 최종 _lifting.bdf 다운로드(가서포트 포함)
```

## 4. 변경 파일별 설계

### A. 텍스트 `Analyze` → `Analysis`
- `components/TopMenuBar.jsx`: `TABS` 의 `{ key:'analyze', label:'Analyze' }` → `label:'Analysis'`. **key=`analyze` 식별자는 유지**(activeMode 분기 영향 0).
- `components/AnalyzePanel.jsx`: 헤더 텍스트 `해석 (Analyze)` → `해석 (Analysis)`.

### B. 새 intent kind `addSupportBeam` — `data/EditIntent.js`
- `VALID_KINDS` 에 `'addSupportBeam'` 추가.
- params: `{ startNode:int, endNode:int, sectionKind:'L', dims:[100,100,10,10] }` (W, H, tw, tf — mm).
- `validateAddSupportBeam(params, stageData, existingIntents, errors, warnings)`:
  - startNode/endNode 정수, nodeMap 존재, 서로 상이.
  - 동일 (startNode,endNode) 쌍(무순서) 중복 차단.
  - (선택) 두 노드가 이미 BEAM 으로 직접 연결돼 있으면 "이미 직접 연결됨" warning.
- `summarizeIntent`: `가서포트 L100×100×10t (N{A}↔N{B})`.

### C. 모델 주입 — `data/applyEditedModel.js` (`buildEditedStageJson`) + `data/applyEditIntents.js`
- `computeDeleteMask` 결과에 `addedSupportBeams[]` 노출(미리보기/카운트용, addRigid 패턴과 동일).
- `buildEditedStageJson` 에서 각 `addSupportBeam` intent 마다:
  - **재질 선택**: category=`Structure` 인 대표 BEAM 의 property.materialId 재사용. 폴백: 첫 property.materialId → materials[0].id. 재질 전무 시 해당 intent skip + 콘솔 warn.
  - **property 추가**: `{ id: maxPropertyId+1, card:'PBEAML', kind:'L', dims:[100,100,10,10], materialId }`. (id 는 추가분마다 증가)
  - **element 추가**: `{ id: max(모든 elementId ∪ 모든 rigidId)+1, type:'CBEAM', startNode, endNode, propertyId, orientation, category:'Structure', modelPart:'stru' }`.
  - **orientation 자동**: `d = normalize(posB − posA)`; `up = |d·[0,0,1]| > 0.9 ? [1,0,0] : [0,0,1]`; `orientation = normalize(up − (up·d)·d)` → 부재축에 수직인 비퇴화 벡터(수직 부재 G0=0 FATAL 회피).
  - 추가 element/property 는 connectivity·healthMetrics 재계산(기존 tempStage 경로)에 자연 반영.

### D. Store — `store/useEditStore.js`
- 상태: `supportPickActive:boolean`, `supportPickNodes:number[]`(≤2).
- 액션:
  - `toggleSupportPick()` — 켜고 끔(끄면 supportPickNodes 비움).
  - `pickSupportNode(id)` — 토글 추가; 2개 도달 시 `addIntent({kind:'addSupportBeam', params})` 호출, 성공이면 supportPickNodes 비움 + `flashHoistGuide('가서포트 설치됨', 'success')` 류 토스트, `useUnitStructuralStore.getState().reset()`.
  - `addSupportBeam(a,b)` — 프로그램적 추가(테스트/대체 진입점).
  - `removeSupportBeam`/기존 `removeIntent` 로 삭제 시에도 `useUnitStructuralStore.reset()`.
- `reset()` 에 `supportPickActive:false, supportPickNodes:[]` 추가.

### E. UI — `components/AnalyzePanel.jsx`
- "Unit 구조 해석" 섹션 위에 **"가서포트(보강) 추가"** 토글 버튼.
  - 활성 시 강조 + 안내문: "Shift + Node 2개 선택 → L100×100×10t 설치".
  - 설치된 가서포트 개수/목록(각 행 N{A}↔N{B}, 삭제 버튼).
- 토글은 `activeMode==='analyze'` 에서만 노출.

### F. 3D 픽킹·미리보기 — `components/ThreeViewport.jsx`
- `editState` memo 에 `supportPickActive`, `pickSupportNode`, `supportPickNodes` 포함.
- `onPointerDown` 분기 추가(기존 hoistPickMode/rigidPickMode 사이):
  `supportPickMode = activeMode==='analyze' && editState.supportPickActive && editState.isTarget && e.shiftKey` → 노드 히트 시 `editState.pickSupportNode(nodeId)`.
- overlay: `supportPickNodes` 하이라이트 + 각 `addSupportBeam` intent 를 **별도 색 선/튜브**로 미리보기(addRigid overlay 빌더 재사용/유사).

### G. 자동 재해석 — `hooks/useUnitStructuralRunner.js`
- `handleRun` 에서 `host.runUnitStructural` **호출 전** 단계 추가:
  - `stage = useStageStore.getState()...`(currentStage), `intents = useEditStore.getState().intents`.
  - 편집 intent 가 1개 이상이거나 **이번 세션에 편집 모델을 이미 업로드한 이력**이 있으면:
    `json = JSON.stringify(buildEditedStageJson(stage, intents))`; `name = buildEditedStageFileName(stage)`; `r = await host.uploadEvaluationArtifact(name, json)`; 실패 시 `setFailure('보강 모델 업로드 실패: …')` 후 return.
  - 성공 후 기존 `runUnitStructural` 호출.
- 세션 업로드 이력 플래그로 "가서포트 전체 삭제 후에도 잔존 `_edited.json`" 문제를 방지(0개여도 재빌드 업로드 → 백엔드 동기화).

## 5. 엣지 케이스 / 리스크

1. **파일명 stem 정합(구현 1순위 검증)**: 백엔드 `unit_structural_service.py` 는 `<bdf_stem>_edited.json` 을 찾고, 스튜디오는 `<stage.sourceFileName>_edited.json` 을 업로드한다. 기존 Hoist 편집 흐름이 이 경로로 이미 동작하므로 정합 가정. **불일치 확인 시** 백엔드에 `*_edited.json` glob 폴백(약 3줄, git-tracked) 추가 → 145 `git pull`+재시작.
2. **수직 부재 orientation 퇴화** → §4-C 자동 perpendicular 로 회피(G0=0 FATAL 방지).
3. **가서포트 전체 삭제 후 잔존 `_edited.json`** → §4-G 세션 업로드 이력 플래그로 0개여도 재동기화.
4. **COG 고정** → 가서포트 자중은 권상 밸런스 COG 미반영(의도된 보수적 단순화).
5. **재질 전무 모델** → intent skip + warn(실모델엔 구조용 MAT1 존재 가정).

## 6. 테스트

- `data/EditIntent.test.js`: `addSupportBeam` 검증(존재/상이/중복/이미연결 warning).
- `data/applyEditedModel.test.js`(또는 신규): 주입 후 element/property 1개씩 증가, kind=`L`, dims=[100,100,10,10], orientation 비퇴화, `computeCrossSectionAreaMm2` 로 L 면적 = `100*10 + (100-10)*10 = 1900 mm²` 검증(등변 앵글 단면적).
- (선택) nastran_bridge 라운드트립: 가서포트 포함 `_edited.json` → BDF 에 `PBEAML … L` + `CBEAM` 라인 출력 확인.

> 면적 주: L 단면적 공식 `W*tf + (H-tf)*tw` = `100*10 + 90*10 = 1900 mm²` (computeCrossSectionAreaMm2 의 L 케이스와 일치).

## 7. 배포

- **스튜디오(React)**: `apps/module-unit-studio` 에서 `npm run package` → `release/module-unit-studio-<ver>.zip`(+`.sha256`). `package.json` 버전 bump **전에** StudioProgram 양쪽 배포본 버전 먼저 확인. zip 을 **로컬 `HiTessWorkBenchBackEnd\StudioProgram\`(1순위) + UNC** 두 곳 모두 복사(`Copy-Item -LiteralPath … -Destination '<경로>' -Force`).
- **백엔드**: 원칙적으로 **무수정**. 리스크 #1 검증 결과 필요 시에만 `unit_structural_service.py`(git-tracked) glob 폴백 → 서버(145) `git pull`+재시작. **nastran_bridge/InHouseProgram 변경 없음**(이미 L 단면 지원).
- `config.js` 는 절대 스테이징하지 않음(로컬 전용).
