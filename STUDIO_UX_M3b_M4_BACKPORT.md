# Studio UX (M2–M4) 역이식 가이드 — SidePassage → ModelBuilder(및 타 Studio)

> SidePassage Studio v0.0.74–0.0.78 에서 구현·검증한 **3D 뷰어 공통 UX 개선**을 다른 Studio(특히 ModelBuilderStudio)에 **역이식**하기 위한 작업 명세.
> 모든 항목은 SidePassage `apps/side-passage-studio/src` 에서 빌드·289+4 테스트·ESLint 0·UNC 배포까지 검증 완료(2026-06-19).
> 표준 근거: `STUDIO_DETAIL.md §5(카메라)·§6(선택)·부록 A.6/B.4`, `STUDIO_PIPELINE_STANDARD.md §S4`.

## 역이식 대상 Studio 공통 메모

| 항목 | SidePassage | ModelBuilder 차이(역이식 시 주의) |
|---|---|---|
| 뷰어 store | `store/useViewerStore.js` | 동일 구조(테마/레이어/renderMode/isolateSelection 이미 존재). 신규 필드만 추가 |
| 편집 store | `store/useEditStore.js` (intents + **권상 hoist**) | **hoist 상태 없음** — Undo/Redo 스냅샷은 `intents` 만. pushHistory 호출처도 intents/connectRigid 계열만 |
| 뷰포트 | `components/ThreeViewport.jsx` (mega) | 동일 패턴(TrackballControls·NodePoints·SceneBuilder·SelectionHighlight). 함수/effect 위치만 대응 |
| 노드 빌더 | `three/NodePoints.js` `NODE_RADIUS=0.0381` | `NODE_RADIUS=0.0448`. nodeScale 인자 추가는 동일 |
| pickables | cyl `{structure,pipe,nodes,masses,rigidLines}` / sec3d `{beams,nodes,masses,rigidLines}` | 동일 |
| 패널 마운트 | `ViewportContainer.jsx` | 동일(글로벌 1회 렌더 위치) |

> ⚠️ ModelBuilder `src/` 도 **git 미추적**일 수 있음 — 편집 전 `src` 백업 권장(`Copy-Item -Recurse`). **백업은 앱 폴더 밖**에 둘 것(안에 두면 vitest 가 백업본 `*.test.js` 까지 수집해 테스트 수가 2배가 됨 — 실제 겪음).

---

## M2 — 카메라 편의 (v0.0.74)

### 2-1. 온스크린 뷰 프리셋 + 핏 버튼 + 조작 힌트
- **무엇**: 뷰포트 좌상단 `평면/정면/측면/등각` + `전체/선택` 버튼, 좌하단 조작 힌트(× 닫기, localStorage 유지). 초심자 발견성.
- **SidePassage 위치**: `ThreeViewport.jsx` — `setStandardView(view)`/`fitAll()`/`fitSelection()` useCallback + `showCamHints` state(`localStorage 'spv_hide_cam_hints'`) + JSX 좌상단 바/좌하단 힌트.
- **역이식**: ModelBuilder 엔 이미 `A/S/D/F` 키 단축키 존재(부록 A.2). 동일 동작을 버튼으로 노출만 추가. `setStandardView` 는 `fitStateRef.position.length()` 로 dist 산출 → top `(0,0,d) up(1,0,0)` / front `(0,-d,0) up(0,0,1)` / side `(d,0,0) up(0,0,1)` / iso `(d·0.7,-d·0.55,d·0.47)`.

### 2-2. 선택만 보기(isolate) 버튼
- **무엇**: 선택 객체가 있을 때 우하단 「선택만 보기」 토글.
- **위치**: `ViewportContainer.jsx` — `toggleIsolateSelection`/`isolateSelection`(이미 store 에 존재) 연동 버튼.
- **역이식**: ModelBuilder store 에 `isolateSelection`/`toggleIsolateSelection` 이미 있음(부록 C.1). 버튼만 추가.

---

## M3a — Hover 미리강조 (v0.0.75)

- **무엇**: 마우스 올린 노드/부재/질량/RBE 를 클릭 전 **흰 외곽**으로 미리 강조.
- **SidePassage 위치**: `three/SelectionHighlight.js` `buildHoverHighlight(pickInfo, stageData)` + `_hoverMat(wire)`(흰색, wireframe/저투명, depthTest/Write false, renderOrder 18). `ThreeViewport.jsx` — `hoverHlRef`/`hoverKeyRef`, `updateHoverHighlight(info)`(키 비교 후 변경 시만 재빌드), hover RAF 에서 호출, `onPointerLeave` 에서 clear, 언마운트 dispose.
- **역이식**: ModelBuilder 의 `computeHoverPick`(있으면) 결과를 그대로 전달. pickInfo 형태 `{type:'node'|'mass'|'element'|'rigid', nodeId?|startNode/endNode?|independentNode/dependentNodes?}`.

---

## M3b-add — 휠 줌 먼쪽 확대 막힘 수정 (v0.0.76) ★중요

- **무엇**: 휠 zoom-to-cursor 가 **현재 피벗의 초점평면** 위 점으로만 dolly → 좌우로 긴 모델에서 커서를 먼쪽에 둬도 확대가 막히던 문제.
- **해법**: 휠 커서 광선을 **실제 지오메트리에 레이캐스트**해 진짜 표면 점을 초점으로(빈 곳만 초점평면 폴백) + 연속 스크롤 140ms 초점 재사용.
- **SidePassage 위치**: `ThreeViewport.jsx` `onWheelZoom` — `raycastScenePoint(ray)` 헬퍼(hover/더블클릭과 동일 타깃·가시성 필터, `ray.intersectObjects(...)[0].point`), `wheelFocus`/`wheelFocusTime` 클로저 변수.
- **역이식**: ⚠️ ModelBuilder v0.0.38 구현은 **초점평면 단독(=버그 그대로)**. 동일 `raycastScenePoint` 패턴으로 교체. `pickables` 키만 맞추면 그대로 이식 가능.

```js
// onWheelZoom 안, p(초점) 결정부 핵심
const now = performance.now()
const reuse = wheelFocus && (now - wheelFocusTime) < 140
const hitPoint = reuse ? wheelFocus : raycastScenePoint(ray)
wheelFocusTime = now
if (hitPoint) { wheelFocus = hitPoint; p.copy(hitPoint) }
else { wheelFocus = null; /* 초점평면 교점 폴백(기존 코드) */ }
// 이후: camera/target 을 동시에 p 쪽으로 (1-scale) 이동 → |eye| = dist*scale
```

---

## M3b — 선택/편집 강화 (v0.0.78)

### 3b-1. 선택 외곽선 명료화 (가림 방지)
- **무엇**: 선택 하이라이트(시안)에 **어두운 외곽 셸**을 덧대 밝은/시안(U-bolt) 배경에서도 또렷.
- **SidePassage 위치**: `three/SelectionHighlight.js` — `_shellMat()`(`0x001318`, opacity 0.5, depthTest false). `buildElementsHighlight`/`buildNodesHighlight` 가 core(시안, renderOrder 17) + shell(어두움, ×1.8 cyl / ×1.45 sphere, renderOrder 15) 2개 InstancedMesh 를 그룹에 추가.
- **역이식**: 함수 시그니처 불변(호출처 영향 없음). ModelBuilder 동일 함수에 셸 추가만.

### 3b-2. 박스(드래그) 선택
- **무엇**: 좌드래그 사각형 안의 노드를 일괄 선택 → 편집 다중선택(pendingNodeSelection) / 권상 그룹에 합집합 추가.
- **SidePassage 위치**:
  - store `useViewerStore.js`: `boxSelect`, `toggleBoxSelect`, `setBoxSelect`.
  - `ThreeViewport.jsx`:
    - 구독 `boxSelect`, `editStateRef.current.boxSelect` 에 포함.
    - effect: `controls.noRotate = boxSelect`(좌드래그 회전 비활성), 언마운트 복구.
    - `onPointerDown`: boxSelect+좌버튼 → `boxDragRef={x0,y0,rect}` + `setBoxRect`.
    - `onPointerMove`: boxDragRef 있으면 사각형만 갱신 후 `return`(hover 무시).
    - `onPointerUp`: boxDragRef 있으면 `finishBoxSelect(drag,e)` 후 일반 픽 skip.
    - `finishBoxSelect`: 노드 `pos.project(camera)` → NDC→스크린 변환, 사각형 안 + `z∈[-1,1]` + 비삭제 노드 수집 → `es.hoistPickEnabled` 면 `addHoistNode`, `es.enabled` 면 `setNodeSelection(합집합)`.
    - JSX: 컨테이너 `cursor: boxSelect?'crosshair'`, 박스 div(점선 시안 `rgba(0,229,255,.12)` zIndex13), 좌상단 편집바의 `▭ 박스` 토글.
- **역이식**: ModelBuilder 는 권상 분기 없음 → `enabled`(편집) 일 때 `setNodeSelection` 만. nodePositions/nodeIds 는 `pickables.nodes.userData`(NodePoints 가 채움) 그대로 사용.

### 3b-3. 노드 가독성 (크기 + ID 라벨)
- **무엇**: 노드 구 크기 `작게0.6/보통1/크게1.6` + 카메라 **근처** 노드/부재 ID 라벨(종류별 상한 110, 카메라 멈출 때 갱신).
- **SidePassage 위치**:
  - 크기: store `nodeScale`/`setNodeScale`. `NodePoints.buildNodePoints(...,nodeScale)` → `SphereGeometry(NODE_RADIUS*nodeScale,...)`. `SceneBuilder.buildScene(...,nodeScale)` 패스스루. `ThreeViewport` 씬 재빌드 effect deps 에 `nodeScale` 추가 + `buildScene(...,nodeScale)`.
  - 라벨: `three/LabelOverlay.js` `buildIdLabels(stageData, sceneData, labels, target, sceneRadius, deletedMask)` — 타깃 기준 `sceneRadius*0.22` 이내, 종류별 가까운 110개만 스프라이트. store `labels{nodes,elements}`/`toggleLabel`. `ThreeViewport` effect 가 `controls 'change'` 디바운스(140ms)로 재빌드.
- **역이식**: ⚠️ nodeScale 을 씬 재빌드 deps 에 넣으면 **fitCamera 재프레이밍**됨(colorMode/renderMode 와 동일 기존 동작). 거슬리면 ModelBuilder 에선 stageData 변경 시에만 fitCamera 하도록 분리 가능(선택).

### 3b-4. Undo/Redo
- **무엇**: 편집 intents(+SidePassage 는 권상) 변경을 `Ctrl+Z`/`Ctrl+Y`(또는 `Ctrl+Shift+Z`) + 버튼으로 되돌리기/다시.
- **SidePassage 위치**:
  - store `useEditStore.js`: `snapshotEditable(s)`(JSON 깊은복사 of `intents,hoistGroups,hoistGroupCount,activeHoistGroupId,wireLengthM`), `_past[]`/`_future[]`, `pushHistory()`/`undo()`/`redo()`(undo 시 selection 류 초기화). `reset()` 에 `_past:[],_future:[]`.
  - **pushHistory 호출처(액션 시작부)**: `addIntent`(검증 통과 후), `removeIntent`, `clearIntents`, `importFromJson`, `addHoistNode`(실제 추가될 때만), `removeHoistNode`, `clearHoistGroup`, `removeHoistGroup`, `setHoistGroupCount`. (per-keystroke `setWireLength`/`updateRigidIntentParams` 는 제외 — 이력 폭주 방지.)
  - `ThreeViewport.jsx`: 구독 `canUndo=s._past.length>0`/`canRedo`. `onKeyDown` 에 Ctrl+Z/Y 처리(입력창 포커스 가드 추가). 좌상단 편집바 `↶`/`↷` 버튼(disabled by canUndo/canRedo).
- **역이식**: ModelBuilder 는 **hoist 없음** → `snapshotEditable = { intents }` 만. pushHistory 호출처 = `addIntent/removeIntent/clearIntents/connectRigid/importFromJson` (ModelBuilder 의 RBE 병합 `connectRigid` 포함). 키보드/버튼 동일.
- **테스트**: `useEditStore.test.js` 에 4 케이스 추가(add→undo→redo, hoist undo/redo, undo후 새 변경이 future 비움, 빈 이력 no-op). ModelBuilder 는 hoist 케이스 빼고 이식.

---

## M4 — 가시성/뷰 도구 (v0.0.77) — `ViewToolsPanel.jsx`

신규 컴포넌트 `components/ViewToolsPanel.jsx`(우상단 floating, `ViewportContainer` 에 1회 마운트)에 모음. store 는 전부 `useViewerStore`(전역 → 모든 viewport 동시 적용).

### 4-1. 와이어프레임 모드
- store `wireframe`/`toggleWireframe`. `ThreeViewport` effect(deps `[wireframe,stageData,renderMode]`)가 `applyWireframe(sceneData,on)` — `layers.structure/pipe` + `pickables.beams` 의 `material.wireframe=on`. 노드/RBE/질량 제외.

### 4-2. 클리핑 단면
- store `clip{enabled,axis,pos,flip}`/`setClip`. `ThreeViewport` effect → `applyClip(sceneData,clip,sceneRadius,renderer)`: `renderer.localClippingEnabled=true`, 평면 `c=(pos-0.5)*r`, 법선 `±axis`(flip), `eachModelMaterial(...).clippingPlanes=[plane]`. 비활성 시 `[]`.
- 씬은 bbox 중심 정렬이라 좌표 ≈ `[-r/2, r/2]`(r=sceneRadius=최대 변).

### 4-3. 회전 피벗 모드
- store `pivotMode`('auto'|'selection'|'center')/`setPivotMode`. `ThreeViewport` effect(deps `[pivotMode,selectedEntity]`): `center`→`target=(0,0,0)`, `selection`→`entityScenePos(selectedEntity,stageData)` 로 target 이동(카메라 고정). `auto`=기존(더블클릭/맞춤).

### 4-4. ID 라벨 토글
- M3b-3 의 `labels{nodes,elements}` 토글을 ViewToolsPanel 에도 노출(동일 구현 공유).

### 4-5. 표시 프리셋
- store `displayPresets`(localStorage `sps-display-presets`)/`saveDisplayPreset(name)`/`applyDisplayPreset(i)`/`deleteDisplayPreset(i)`. 프리셋 = `{name,layers,renderMode,wireframe,clip}`. `reset()` 시 보존(사용자 저장본).

### ThreeViewport 모듈 헬퍼(역이식 복붙 대상)
`entityScenePos(entity,stageData)`, `applyWireframe(sceneData,on)`, `eachModelMaterial(sceneData,fn)`, `applyClip(sceneData,clip,sceneRadius,renderer)` + 모듈 상수 `_clipPlane`,`_axisVec`.

---

## 검증/배포 체크리스트(각 Studio 역이식 시 반복)
1. `src` 백업(앱 폴더 **밖**).
2. `npx eslint <changed>` → 0 errors.
3. `npm run test` → 기존 + undo/redo 케이스 green(테스트 수 2배면 백업이 앱 안에 있는 것).
4. `npm run build` → OK(`INEFFECTIVE_DYNAMIC_IMPORT` 경고는 양성).
5. `npm run package` → `release/<id>-<ver>.zip` + `.sha256`(package.json 버전만 bump).
6. 배포: ModelBuilder 는 **백엔드-로컬 `StudioProgram/` + UNC 둘 다** 복사(SidePassage 와 달리 백엔드-로컬 우선 스캔). `Copy-Item -LiteralPath`. UNC 무결성 검증(Get-FileHash MATCH + ZipFile.OpenRead).
7. 서버(145): 스튜디오 zip 은 `git pull` 로 안 따라옴 → 수동 복사.

## 파일 변경 요약(SidePassage)
| 파일 | 변경 |
|---|---|
| `store/useViewerStore.js` | wireframe/clip/pivotMode/labels/nodeScale/boxSelect/displayPresets(+actions), reset 반영 |
| `store/useEditStore.js` | Undo/Redo(snapshotEditable,_past,_future,pushHistory,undo,redo) + 9개 액션에 pushHistory |
| `store/useEditStore.test.js` | undo/redo 4 케이스 |
| `three/SelectionHighlight.js` | 선택 외곽 셸(_shellMat, elem/node 2-pass) |
| `three/LabelOverlay.js` | **신규** buildIdLabels(근접+상한 ID 라벨) |
| `three/NodePoints.js` | buildNodePoints nodeScale 인자 |
| `three/SceneBuilder.js` | buildScene nodeScale 패스스루 |
| `components/ThreeViewport.jsx` | 박스선택·라벨·Undo/Redo·와이어/클립/피벗 effect·헬퍼·JSX 바 |
| `components/ViewToolsPanel.jsx` | **신규** M4 패널(와이어/클립/피벗/라벨/노드크기/프리셋) |
| `components/ViewportContainer.jsx` | ViewToolsPanel 마운트 |

*작성: 2026-06-19, SidePassage v0.0.78 기준.*

---

## ✅ ModelBuilder(model-studio) 적용 완료 — v0.0.41 (2026-06-19)

8개 기능 전부 ModelBuilder 실제 코드에 맞춰 적응·이식 완료. ESLint 0 · **162 테스트**(undo/redo 3건 추가) · 빌드 OK. **백엔드-로컬 `StudioProgram\` + UNC 양쪽 배포**(UNC MATCH True/ZIP OK).

| 기능 | 상태 | ModelBuilder 적응 포인트 |
|---|---|---|
| 휠 줌 수정 | DONE | onWheelZoom 이 SidePassage 수정 전과 동일(초점평면) → raycastScenePoint 동일 이식 |
| 카메라 프리셋/힌트/isolate | DONE | A/S/D/F 키 기존 존재 → 온스크린 바 추가. isolate 버튼은 ViewportContainer 에 신규 |
| Hover 미리강조 | DONE | ★ModelBuilder 엔 hover 인프라 없었음 → onPointerMove RAF + computeHoverPick + onPointerLeave 신규 추가 |
| 선택 외곽선 셸 | DONE | buildElementsHighlight/buildNodesHighlight 2-pass 셸 |
| 박스 선택 | DONE | hoist 없음 → 편집(enabled) 분기만. setNodeSelection 합집합 |
| 노드 크기+라벨 | DONE | buildNodePoints/buildScene nodeScale(렌더모드 인자 없음 주의) + LabelOverlay.js 신규 |
| Undo/Redo | DONE | ★스냅샷 = intents 만. pushHistory @ addIntent/connectRigid/removeIntent/clearIntents/importFromJson. undo/redo 시 groupPreview 재계산(nextGroupPreview) |
| 뷰 도구 패널 | DONE | ViewToolsPanel.jsx 신규(토큰 동일) + ViewportContainer 마운트 + wireframe/clip/pivot effect |

**서버(145) 반영**: model-studio zip 은 git 미추적 → `git pull` 로 안 따라옴. 운영 서버 `HiTessWorkBenchBackEnd\StudioProgram\` 에 `model-studio-0.0.41.zip`(+`.sha256`) **수동 복사** 필요(백엔드 재시작 불필요 — 정적 zip 서빙).
**롤백**: 양쪽 StudioProgram 에서 `model-studio-0.0.41.zip`(+sha256) 삭제 시 0.0.40 으로 자동 환원.
