# Module Unit Studio — Analysis 탭 가서포트(보강) 추가 재해석 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Module Unit Studio 의 Analysis 탭에서 "가서포트 추가" 버튼으로 Shift+Node 2개를 선택해 두 노드를 잇는 L100×100×10t 보강 beam 을 설치하고, "구조 해석 실행" 시 그 보강이 반영된 모델로 Unit 구조해석을 자동 재실행한다.

**Architecture:** 가서포트를 새 edit intent `addSupportBeam` 으로 표현한다. 기존 `buildEditedStageJson` 이 `_edited.json` 에 CBEAM + PBEAML L property 를 주입하고, 백엔드 `nastran_bridge.convert_json_to_bdf` 가 이를 그대로 BDF 로 출력한다(백엔드 무수정). 구조해석 실행 직전 runner 가 `_edited.json` 을 재업로드해 보강을 동기화한다.

**Tech Stack:** React 19 + Zustand 5 + Three.js (module-unit-studio), Vitest. 백엔드 FastAPI(검증 한정).

**작업 위치(studio):** `C:\Coding\WorkBenchSubModule\ModuleUnitStudio\apps\module-unit-studio` — 이하 파일 경로는 이 디렉터리 기준 상대경로. 모든 `npx vitest`/`npm` 명령의 cwd 도 이 디렉터리.

**설계 문서:** `C:\Coding\WorkBench\docs\superpowers\specs\2026-06-29-module-unit-analysis-support-beam-design.md`

---

### Task 0: 사전 검증 (환경/기존 테스트/버전)

**Files:** 없음(검증만)

- [ ] **Step 1: studio 가 git 저장소인지 확인**

Run: `git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" rev-parse --is-inside-work-tree`
- 결과가 `true` 면 이후 커밋 step 은 `git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add/commit` 로 수행.
- `fatal`(미추적) 이면 **커밋 step 은 건너뛰고**(스튜디오 src 가 git 미추적), 대신 각 Task 종료 시 `npx vitest run` + `npm run build` 통과만 확인. 배포는 Task 11 의 zip 으로만 반영.

- [ ] **Step 2: 기존 테스트가 green 인지 확인**

Run: `npm test` (cwd = `apps/module-unit-studio`)
Expected: 전부 PASS (기존 EditIntent/applyEditedModel/useEditStore 등). 실패가 있으면 먼저 원인 파악 후 진행.

- [ ] **Step 3: 현재 배포 버전 확인 (배포 전 함정 방지)**

Run: `git -C "C:/Coding/WorkBench" --no-pager log -1 --oneline` (참고용) 및 아래 폴더의 기존 zip 버전 확인
- 로컬: `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\StudioProgram\module-unit-studio-*.zip`
- UNC: `\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram\module-unit-studio-*.zip`
Expected: 현재 `package.json` 버전(0.0.65)과 비교해 **배포본 최고 버전 ≥ 로컬** 인지 확인. Task 11 에서 (배포 최고 버전 + 1) 로 bump.

---

### Task 1: 리본 텍스트 `Analyze` → `Analysis`

**Files:**
- Modify: `src/components/TopMenuBar.jsx:16`
- Modify: `src/components/AnalyzePanel.jsx:77`

- [ ] **Step 1: TopMenuBar 탭 라벨 변경 (key 는 유지)**

`src/components/TopMenuBar.jsx` 의 TABS 배열에서:
```jsx
  { key: 'analyze',    label: 'Analysis',   Icon: Activity },
```
(기존 `label: 'Analyze'` → `'Analysis'`. `key: 'analyze'` 는 절대 변경 금지 — activeMode 분기 전체가 이 key 를 참조.)

- [ ] **Step 2: AnalyzePanel 헤더 텍스트 변경**

`src/components/AnalyzePanel.jsx` 의 헤더 span(라인 77 부근):
```jsx
        <span style={{ fontSize: 12, fontWeight: 900, color: '#e6f1ff', letterSpacing: 0.5 }}>
          해석 (Analysis)
        </span>
```
(`해석 (Analyze)` → `해석 (Analysis)`.)

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공(에러 0).

- [ ] **Step 4: 커밋** (Task 0 에서 git 저장소 확인된 경우에만)

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/components/TopMenuBar.jsx apps/module-unit-studio/src/components/AnalyzePanel.jsx
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "feat: 리본 탭 Analyze→Analysis 라벨 변경"
```

---

### Task 2: `addSupportBeam` intent 정의 + 검증

**Files:**
- Modify: `src/data/EditIntent.js`
- Test: `src/data/EditIntent.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/data/EditIntent.test.js` 끝에 추가(파일 상단 import 에 이미 `createIntent, validateIntent, summarizeIntent` 포함됨). `makeStage` 는 파일 상단 헬퍼 사용(node 1~4, BEAM 101: 1-2, 102: 2-3 존재):
```js
// ── validateIntent: addSupportBeam ────────────────────────────
describe('validateIntent — addSupportBeam', () => {
  const params = (a, b) => ({ startNode: a, endNode: b, sectionKind: 'L', dims: [100, 100, 10, 10] })

  it('정상 케이스(연결 안 된 두 노드) → ok', () => {
    const stage = makeStage()
    const intent = createIntent('addSupportBeam', params(1, 4))
    const v = validateIntent(intent, stage, [])
    expect(v.status).toBe('ok')
    expect(v.errors).toEqual([])
  })

  it('두 노드가 동일 → error', () => {
    const stage = makeStage()
    const v = validateIntent(createIntent('addSupportBeam', params(2, 2)), stage, [])
    expect(v.status).toBe('error')
    expect(v.errors.some(e => e.includes('동일'))).toBe(true)
  })

  it('존재하지 않는 노드 → error', () => {
    const stage = makeStage()
    const v = validateIntent(createIntent('addSupportBeam', params(1, 999)), stage, [])
    expect(v.status).toBe('error')
  })

  it('이미 직접 연결된 두 노드(1-2) → warning(추가는 허용)', () => {
    const stage = makeStage()
    const v = validateIntent(createIntent('addSupportBeam', params(1, 2)), stage, [])
    expect(v.status).toBe('warning')
  })

  it('동일 쌍 중복(무순서) → error', () => {
    const stage = makeStage()
    const existing = [createIntent('addSupportBeam', params(1, 4))]
    const v = validateIntent(createIntent('addSupportBeam', params(4, 1)), stage, existing)
    expect(v.status).toBe('error')
    expect(v.errors.some(e => e.includes('이미'))).toBe(true)
  })

  it('summarizeIntent 라벨', () => {
    const s = summarizeIntent(createIntent('addSupportBeam', params(1, 4)))
    expect(s).toContain('가서포트')
    expect(s).toContain('N1')
    expect(s).toContain('N4')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/data/EditIntent.test.js`
Expected: FAIL — `Unknown EditIntent kind: addSupportBeam` (createIntent throw) 또는 `알 수 없는 intent kind`.

- [ ] **Step 3: 구현**

`src/data/EditIntent.js`:

(3-1) `VALID_KINDS` 에 `'addSupportBeam'` 추가:
```js
const VALID_KINDS = new Set(['addRigid', 'deleteGroup', 'deleteElement', 'deleteCategory', 'deleteOrphanNodes', 'emptyPipeFluid', 'rotateModel', 'addSupportBeam'])
```

(3-2) `validateIntent` 의 분기 체인에 추가(`rotateModel` else-if 다음, 최종 else 앞):
```js
  } else if (intent.kind === 'addSupportBeam') {
    validateAddSupportBeam(intent.params, stageData, existingIntents, errors, warnings)
```

(3-3) 검증 함수 추가(파일 하단, 다른 validate* 들과 함께):
```js
// 가서포트(보강) L beam — 두 노드를 잇는 신규 CBEAM. 동일 쌍(무순서) 중복 차단,
// 이미 직접 BEAM 으로 연결된 노드쌍이면 redundant warning(추가는 허용).
function validateAddSupportBeam(params, stageData, existingIntents, errors, warnings) {
  const a = params?.startNode
  const b = params?.endNode
  if (a == null || !Number.isInteger(a) || b == null || !Number.isInteger(b)) {
    errors.push('가서포트 노드(startNode/endNode)가 정수가 아닙니다.')
    return
  }
  if (a === b) {
    errors.push('가서포트 두 노드가 동일합니다.')
    return
  }
  if (stageData?.nodeMap) {
    if (!stageData.nodeMap.has(a)) errors.push(`가서포트 노드 #${a} 가 StageData 에 존재하지 않습니다.`)
    if (!stageData.nodeMap.has(b)) errors.push(`가서포트 노드 #${b} 가 StageData 에 존재하지 않습니다.`)
    if (errors.length > 0) return
  }
  const key = [a, b].sort((x, y) => x - y).join('-')
  for (const ex of existingIntents) {
    if (ex.kind !== 'addSupportBeam') continue
    const exKey = [ex.params?.startNode, ex.params?.endNode].sort((x, y) => x - y).join('-')
    if (exKey === key) {
      errors.push(`동일한 가서포트(N${a}↔N${b})가 이미 추가되어 있습니다.`)
      return
    }
  }
  // 이미 BEAM 으로 직접 연결돼 있으면 보강 의미가 약함 — 경고만.
  if (stageData?.elements) {
    const connected = stageData.elements.some(e =>
      e.type === 'BEAM' &&
      ((e.startNode === a && e.endNode === b) || (e.startNode === b && e.endNode === a))
    )
    if (connected) warnings.push(`두 노드(N${a}, N${b})는 이미 직접 연결되어 있습니다.`)
  }
}
```

(3-4) `summarizeIntent` 에 분기 추가(`rotateModel` 분기 부근):
```js
  if (intent.kind === 'addSupportBeam') {
    const { startNode, endNode } = intent.params ?? {}
    return `가서포트 L100×100×10t (N${startNode}↔N${endNode})`
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/data/EditIntent.test.js`
Expected: PASS (신규 6개 + 기존 전부).

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/data/EditIntent.js apps/module-unit-studio/src/data/EditIntent.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "feat: addSupportBeam edit intent 정의 + 검증/요약 추가"
```

---

### Task 3: 편집 모델에 가서포트 주입 (mask 카운트 + buildEditedStageJson)

**Files:**
- Modify: `src/data/applyEditIntents.js`
- Modify: `src/data/applyEditedModel.js`
- Test: `src/data/applyEditedModel.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/data/applyEditedModel.test.js` 의 `describe('buildEditedStageJson', ...)` 안에 추가. `baseJson()` 헬퍼 사용(properties[1]=Bar, materials[1]=STEEL; Structure BEAM 100/101 의 propertyId=1). **단, baseJson 의 property 1 에는 materialId 가 없으므로** 재질 폴백(materials[0].id=1)이 선택돼야 한다:
```js
  it('addSupportBeam intent 가 CBEAM + PBEAML L 로 주입된다', () => {
    const stage = new StageData(baseJson())
    const intents = [
      { id: 'sb1', kind: 'addSupportBeam',
        params: { startNode: 1, endNode: 4, sectionKind: 'L', dims: [100, 100, 10, 10] },
        validation: { status: 'ok' } },
    ]
    const out = buildEditedStageJson(stage, intents)

    // element +1 (원본 3 → 4), property +1 (원본 2 → 3)
    expect(out.elements).toHaveLength(4)
    expect(out.properties).toHaveLength(3)

    const beam = out.elements.find(e => e.startNode === 1 && e.endNode === 4)
    expect(beam).toBeTruthy()
    expect(beam.type).toBe('CBEAM')
    expect(beam.category).toBe('Structure')
    // 신규 element id 는 기존 element/rigid id 최대값 초과 (200, rigid 50 → 201)
    expect(beam.id).toBeGreaterThan(200)
    // orientation 비퇴화(길이>0)
    const olen = Math.hypot(beam.orientation[0], beam.orientation[1], beam.orientation[2])
    expect(olen).toBeGreaterThan(0.5)

    const prop = out.properties.find(p => p.id === beam.propertyId)
    expect(prop).toBeTruthy()
    expect(prop.card).toBe('PBEAML')
    expect(prop.kind).toBe('L')
    expect(prop.dims).toEqual([100, 100, 10, 10])
    expect(prop.materialId).toBe(1)   // 재질 폴백 = materials[0].id
  })

  it('수직(±Z) 부재의 orientation 은 [0,0,1] 과 평행하지 않다(퇴화 회피)', () => {
    const json = baseJson()
    json.nodes.push({ id: 7, x: 0, y: 0, z: 0, tags: [] })
    json.nodes.push({ id: 8, x: 0, y: 0, z: 1000, tags: [] })  // 수직 부재
    const stage = new StageData(json)
    const intents = [
      { id: 'sb2', kind: 'addSupportBeam',
        params: { startNode: 7, endNode: 8, sectionKind: 'L', dims: [100, 100, 10, 10] },
        validation: { status: 'ok' } },
    ]
    const out = buildEditedStageJson(stage, intents)
    const beam = out.elements.find(e => e.startNode === 7 && e.endNode === 8)
    // 부재축이 [0,0,1] 이므로 orientation 의 z 성분은 0 에 가깝고 수평 성분이 있어야 함
    expect(Math.abs(beam.orientation[2])).toBeLessThan(0.5)
    expect(Math.hypot(beam.orientation[0], beam.orientation[1])).toBeGreaterThan(0.5)
  })
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/data/applyEditedModel.test.js`
Expected: FAIL — `out.elements` 가 3 (주입 미구현).

- [ ] **Step 3: 구현 — applyEditIntents.js (mask 에 addedSupportBeams 노출)**

`src/data/applyEditIntents.js`:

(3-1) `EMPTY` 에 필드 추가:
```js
  addedSupportBeams:      [],   // [{ intentId, startNode, endNode, dims }]
```

(3-2) 빈 intents fast-path(`computeDeleteMask` 의 `if (!stageData || ... length === 0)` 블록) 의 반환 객체에 `addedSupportBeams: [],` 추가(기존 `addedRigids: []` 옆).

(3-3) `addedRigids` 수집 루프 다음에 support 수집 루프 추가:
```js
  // addSupportBeam intents — 미리보기/카운트용. 노드 존재 여부만 확인.
  const addedSupportBeams = []
  for (const intent of intents) {
    if (intent.kind !== 'addSupportBeam') continue
    const { startNode, endNode, dims } = intent.params ?? {}
    if (!Number.isInteger(startNode) || !Number.isInteger(endNode)) continue
    if (!stageData.nodeMap?.has(startNode) || !stageData.nodeMap?.has(endNode)) continue
    addedSupportBeams.push({ intentId: intent.id, startNode, endNode, dims: dims ?? [100, 100, 10, 10] })
  }
```

(3-4) 최종 `return` 객체에 `addedSupportBeams,` 추가하고, `derivedElementCount` 에 보강 수 반영:
```js
    addedSupportBeams,
    derivedElementCount:   Math.max(0, totalBeams  - deletedElementIds.size) + addedSupportBeams.length,
```

- [ ] **Step 4: 구현 — applyEditedModel.js (실제 주입)**

`src/data/applyEditedModel.js`:

(4-1) `buildEditedStageJson` 안에서 `properties` 를 가변 배열로 만든다. 기존 `const mask = computeDeleteMask(...)` 다음에:
```js
  const properties = [...(stageData.properties ?? [])]
```

(4-2) rigids 블록(addRigid 반영, `for (const ar of mask.addedRigids ...)` 끝) **다음**에 support 주입 블록 추가:
```js
  // ── addSupportBeam 주입 (CBEAM + PBEAML L) ────────────────────────────
  // element id 는 기존 element/rigid(최종, addRigid 포함) 와 충돌하지 않게 그 최대값+1 부터.
  const usedEid = new Set()
  for (const e of elements) if (e.id != null) usedEid.add(e.id)
  for (const r of rigids)   if (r.id != null) usedEid.add(r.id)
  let nextElementId = (usedEid.size ? Math.max(...usedEid) : 0) + 1
  let nextPropertyId = (properties.length ? Math.max(...properties.map(p => p.id ?? 0)) : 0) + 1
  const supportMaterialId = resolveSupportMaterialId(stageData)
  for (const sb of mask.addedSupportBeams ?? []) {
    const propId = nextPropertyId++
    properties.push({
      id: propId, card: 'PBEAML', kind: 'L',
      dims: [...(sb.dims ?? [100, 100, 10, 10])],
      materialId: supportMaterialId,
    })
    elements.push({
      id: nextElementId++, type: 'CBEAM',
      startNode: sb.startNode, endNode: sb.endNode,
      propertyId: propId,
      orientation: computeSupportOrientation(stageData, sb.startNode, sb.endNode),
      category: 'Structure', modelPart: 'stru',
      remark: '가서포트',
    })
  }
```

(4-3) tempStage 생성과 최종 return 의 `properties: stageData.properties ?? []` 를 **둘 다** 주입된 `properties` 로 교체:
- tempStage 의 `properties: stageData.properties ?? [],` → `properties,`
- return 의 `properties: stageData.properties ?? [],` → `properties,`

(4-4) 파일 하단에 헬퍼 2개 추가:
```js
/**
 * 가서포트가 재사용할 재질 id 결정.
 * 1) category=Structure BEAM 의 property.materialId → 2) 첫 property.materialId → 3) 첫 material id.
 */
function resolveSupportMaterialId(stageData) {
  for (const e of stageData.elements ?? []) {
    if (e.type === 'BEAM' && e.category === 'Structure') {
      const prop = stageData.propertyMap?.get?.(e.propertyId)
      if (prop?.materialId != null) return prop.materialId
    }
  }
  for (const p of stageData.properties ?? []) {
    if (p.materialId != null) return p.materialId
  }
  return stageData.materials?.[0]?.id ?? null
}

/**
 * 부재축에 수직인 비퇴화 orientation 벡터 산출(수직 부재 G0=0 FATAL 회피).
 * up = 부재가 거의 ±Z 면 [1,0,0], 아니면 [0,0,1]; up 의 축수직 성분을 정규화.
 */
function computeSupportOrientation(stageData, startNode, endNode) {
  const a = stageData.nodeMap?.get?.(startNode)
  const b = stageData.nodeMap?.get?.(endNode)
  if (!a || !b) return [0, 0, 1]
  let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
  const len = Math.hypot(dx, dy, dz) || 1
  dx /= len; dy /= len; dz /= len
  const up = Math.abs(dz) > 0.9 ? [1, 0, 0] : [0, 0, 1]
  const dot = up[0] * dx + up[1] * dy + up[2] * dz
  let ox = up[0] - dot * dx, oy = up[1] - dot * dy, oz = up[2] - dot * dz
  const olen = Math.hypot(ox, oy, oz) || 1
  return [ox / olen, oy / olen, oz / olen]
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/data/applyEditedModel.test.js`
Expected: PASS(신규 2개 + 기존 전부). 기존 "intents 가 비어 있으면 …" 테스트도 통과 유지(빈 intents → addedSupportBeams=[]).

- [ ] **Step 6: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/data/applyEditIntents.js apps/module-unit-studio/src/data/applyEditedModel.js apps/module-unit-studio/src/data/applyEditedModel.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "feat: 편집 모델에 가서포트(CBEAM+PBEAML L) 주입 + mask 카운트"
```

---

### Task 4: useEditStore — 가서포트 픽 상태/액션

**Files:**
- Modify: `src/store/useEditStore.js`
- Test: `src/store/useEditStore.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/store/useEditStore.test.js` 에 추가(기존 import/헬퍼 활용). 스토어 직접 호출 패턴은 기존 테스트를 따른다. stage 가 필요하면 기존 테스트의 stage 주입 헬퍼 사용(없으면 useStageStore.setState 로 stages 주입):
```js
import { useStageStore } from '../store/useStageStore.js'
import { StageData } from '../data/StageData.js'
import { useUnitStructuralStore } from '../store/useUnitStructuralStore.js'

function seedStage() {
  const stage = new StageData({
    meta: { phase: 'C', stageName: 'C_Final' },
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 1000, y: 0, z: 0 },
      { id: 3, x: 2000, y: 0, z: 0 }, { id: 4, x: 3000, y: 0, z: 0 },
    ],
    elements: [{ id: 10, type: 'BEAM', startNode: 1, endNode: 2, category: 'Structure', propertyId: 1 }],
    rigids: [], properties: [{ id: 1, kind: 'Bar', dims: [50, 50], materialId: 1 }],
    materials: [{ id: 1, E: 210000, nu: 0.3, rho: 7.85e-9 }], pointMasses: [],
    connectivity: null, healthMetrics: null,
  })
  stage.sourceFileName = '06_Validation.json'
  useStageStore.setState({ stages: [stage] })
  return stage
}

describe('useEditStore — 가서포트', () => {
  it('pickSupportNode 2개 → addSupportBeam intent 생성 + 선택 비움 + 구조store reset', () => {
    seedStage()
    const s = useEditStore.getState()
    s.reset()
    useUnitStructuralStore.setState({ status: 'Success' })  // 잠금 상태 가정
    s.toggleSupportPick()
    expect(useEditStore.getState().supportPickActive).toBe(true)
    s.pickSupportNode(1)
    expect(useEditStore.getState().supportPickNodes).toEqual([1])
    s.pickSupportNode(4)
    const st = useEditStore.getState()
    expect(st.supportPickNodes).toEqual([])
    expect(st.intents.filter(i => i.kind === 'addSupportBeam')).toHaveLength(1)
    expect(useUnitStructuralStore.getState().status).toBe(null)  // reset 됨
  })

  it('같은 노드 재클릭 → 선택 해제', () => {
    seedStage()
    const s = useEditStore.getState()
    s.reset(); s.toggleSupportPick()
    s.pickSupportNode(1)
    s.pickSupportNode(1)
    expect(useEditStore.getState().supportPickNodes).toEqual([])
    expect(useEditStore.getState().intents).toHaveLength(0)
  })

  it('removeSupportBeam → intent 제거 + 구조store reset', () => {
    seedStage()
    const s = useEditStore.getState()
    s.reset(); s.toggleSupportPick()
    s.pickSupportNode(1); s.pickSupportNode(4)
    const id = useEditStore.getState().intents.find(i => i.kind === 'addSupportBeam').id
    useUnitStructuralStore.setState({ status: 'Success' })
    useEditStore.getState().removeSupportBeam(id)
    expect(useEditStore.getState().intents).toHaveLength(0)
    expect(useUnitStructuralStore.getState().status).toBe(null)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/store/useEditStore.test.js`
Expected: FAIL — `toggleSupportPick is not a function`.

- [ ] **Step 3: 구현**

`src/store/useEditStore.js`:

(3-1) 상단 import 에 추가:
```js
import { useUnitStructuralStore } from './useUnitStructuralStore.js'
```

(3-2) 상태 초기값 추가(`pendingNodeSelection: []` 부근):
```js
  // 가서포트(보강) 픽 모드 — Analysis 탭 전용. Shift+Node 2개 선택 시 addSupportBeam intent 생성.
  supportPickActive: false,
  supportPickNodes: [],
  // 이번 세션에 편집 모델(_edited.json)을 백엔드에 업로드한 적이 있는지 — 재해석 동기화 게이트.
  editedModelUploaded: false,
```

(3-3) 액션 추가(`addIntent` 부근):
```js
  toggleSupportPick: () => set(s => ({
    supportPickActive: !s.supportPickActive,
    supportPickNodes: [],
  })),

  pickSupportNode: (nodeId) => {
    if (nodeId == null) return
    const stage = currentStage()
    if (stage?.nodeMap && !stage.nodeMap.has(nodeId)) return
    const cur = get().supportPickNodes
    if (cur.includes(nodeId)) {
      set({ supportPickNodes: cur.filter(n => n !== nodeId) })
      return
    }
    const next = [...cur, nodeId]
    if (next.length < 2) { set({ supportPickNodes: next }); return }
    const [a, b] = next
    const res = get().addIntent({
      kind: 'addSupportBeam',
      params: { startNode: a, endNode: b, sectionKind: 'L', dims: [100, 100, 10, 10] },
    })
    set({ supportPickNodes: [] })
    if (res.ok) {
      get().flashHoistGuide(`가서포트 설치됨 (N${a}↔N${b})`, 'success')
      useUnitStructuralStore.getState().reset()
    } else {
      get().flashHoistGuide(res.validation?.errors?.[0] ?? '가서포트 추가 실패', 'error')
    }
  },

  // 프로그램적 추가(테스트/대체 진입점) — 검증 통과 시 구조 결과 reset.
  addSupportBeam: (a, b) => {
    const res = get().addIntent({
      kind: 'addSupportBeam',
      params: { startNode: a, endNode: b, sectionKind: 'L', dims: [100, 100, 10, 10] },
    })
    if (res.ok) useUnitStructuralStore.getState().reset()
    return res
  },

  removeSupportBeam: (intentId) => {
    get().removeIntent(intentId)
    useUnitStructuralStore.getState().reset()
  },

  markEditedModelUploaded: () => set({ editedModelUploaded: true }),
```

(3-4) `reset()` 의 set 객체에 추가:
```js
    supportPickActive: false,
    supportPickNodes: [],
    editedModelUploaded: false,
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/store/useEditStore.test.js`
Expected: PASS(신규 3개 + 기존 전부).

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/store/useEditStore.js apps/module-unit-studio/src/store/useEditStore.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "feat: useEditStore 가서포트 픽 상태/액션(pickSupportNode 등)"
```

---

### Task 5: 가서포트 3D 미리보기 빌더

**Files:**
- Create: `src/three/SupportBeamPreview.js`
- Test: `src/three/SupportBeamPreview.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/three/SupportBeamPreview.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { StageData } from '../data/StageData.js'
import { buildSupportBeamPreview } from './SupportBeamPreview.js'

const stage = () => new StageData({
  meta: {}, nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 4, x: 3000, y: 0, z: 0 },
  ], elements: [], rigids: [], properties: [], materials: [], pointMasses: [],
  connectivity: null, healthMetrics: null,
})

describe('buildSupportBeamPreview', () => {
  it('빈 목록 → null', () => {
    expect(buildSupportBeamPreview(stage(), [])).toBe(null)
  })
  it('가서포트 1개 → LineSegments(2점)', () => {
    const line = buildSupportBeamPreview(stage(), [{ startNode: 1, endNode: 4 }])
    expect(line).toBeTruthy()
    expect(line.geometry.getAttribute('position').count).toBe(2)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/three/SupportBeamPreview.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/three/SupportBeamPreview.js` (AddRigidPreview.js 패턴을 따르되 실선·청록색으로 "보강"을 구분):
```js
import * as THREE from 'three'

/**
 * 가서포트(addSupportBeam) 미리보기 — 두 노드를 잇는 청록 실선 LineSegments.
 * 기존 부재/RBE 와 색으로 구분되어 "추가된 보강재" 임을 즉시 전달.
 *
 * @param {import('../data/StageData.js').StageData} stageData
 * @param {Array<{ startNode:number, endNode:number }>} supportBeams
 * @returns {THREE.LineSegments|null}
 */
export function buildSupportBeamPreview(stageData, supportBeams) {
  if (!stageData || !Array.isArray(supportBeams) || supportBeams.length === 0) return null
  const positions = []
  for (const sb of supportBeams) {
    const a = stageData.getNodePos(sb.startNode)
    const b = stageData.getNodePos(sb.endNode)
    if (!a || !b) continue
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
  if (positions.length === 0) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.LineBasicMaterial({
    color: 0x2DD4BF, linewidth: 3, transparent: true, opacity: 0.95,
    depthTest: false, depthWrite: false,
  })
  const line = new THREE.LineSegments(geo, mat)
  line.renderOrder = 999
  return line
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/three/SupportBeamPreview.test.js`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/three/SupportBeamPreview.js apps/module-unit-studio/src/three/SupportBeamPreview.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "feat: 가서포트 3D 미리보기 빌더(SupportBeamPreview)"
```

---

### Task 6: ThreeViewport — 가서포트 픽 분기 + 미리보기 overlay

**Files:**
- Modify: `src/components/ThreeViewport.jsx`

> 3D/이벤트 코드라 단위테스트 대신 빌드 + 수동 검증(Task 10)으로 확인.

- [ ] **Step 1: prop + store 구독 추가**

(1-1) 컴포넌트 시그니처(라인 61)에 prop 추가:
```jsx
export default function ThreeViewport({ stageData, layers, onReady, onPick, onHover, colorMode = 'category', freeNodeFilters, groupFilters, selectedEntity, isolateSelection = false, renderMode = 'cylinder', displayStyle = 'shaded', pickFilters, isEditTargetStage = true, hoistPickEnabled = false, supportPickEnabled = false }) {
```

(1-2) import 추가(파일 상단, AddRigidPreview import 부근):
```jsx
import { buildSupportBeamPreview } from '../three/SupportBeamPreview.js'
```

(1-3) store 구독 추가(`addHoistNode` 구독 라인 부근, 라인 111 아래):
```jsx
  const supportPickActive      = useEditStore(s => s.supportPickActive)
  const supportPickNodes       = useEditStore(s => s.supportPickNodes)
  const pickSupportNode        = useEditStore(s => s.pickSupportNode)
```

- [ ] **Step 2: editStateRef 에 가서포트 상태 주입**

`editStateRef.current = { ... }`(라인 125~139) 에 필드 추가하고 deps 배열도 갱신:
```jsx
      hoistPickEnabled,
      supportPickEnabled,
      supportPickActive,
      pickSupportNode,
```
deps 배열(라인 140) 끝에 추가: `, supportPickEnabled, supportPickActive, pickSupportNode`

- [ ] **Step 3: support 미리보기 overlay ref 추가**

`const addRigidRef = useRef(null)`(라인 144) 다음:
```jsx
  const supportBeamRef = useRef(null)   // 가서포트 미리보기 overlay (청록 실선)
```

- [ ] **Step 4: onPointerUp 픽 분기 추가**

(4-1) 모드 계산부(라인 501~503)에 supportPickMode 추가:
```jsx
      const hoistPickMode = editState.isTarget && editState.hoistPickEnabled && editState.hoistMode && e.shiftKey
      const supportPickMode = !hoistPickMode && editState.isTarget && editState.supportPickEnabled && editState.supportPickActive && e.shiftKey
      const rigidPickMode = !hoistPickMode && !supportPickMode && editState.enabled && editState.isTarget && (e.shiftKey || editState.hasPendingNodes)
      const nodeOnlyPickMode = hoistPickMode || supportPickMode || rigidPickMode
```

(4-2) node 히트 처리에서 hoistPickMode 분기(라인 540~545) **다음**에 추가:
```jsx
        if (supportPickMode && nodeId != null) {
          editState.pickSupportNode(nodeId)
          return
        }
```

- [ ] **Step 5: 씬 리빌드 cleanup 에 supportBeamRef 정리 추가**

addRigidRef cleanup(라인 735~738) 바로 아래에 동일 패턴 추가:
```jsx
    if (supportBeamRef.current) {
      scene.remove(supportBeamRef.current)
      disposeScene(supportBeamRef.current)
      supportBeamRef.current = null
    }
```

- [ ] **Step 6: 가서포트 미리보기 effect 추가**

addRigid overlay effect(라인 953~971) **다음**에 추가:
```jsx
  // ── 가서포트 미리보기 overlay (청록 실선) ──────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (supportBeamRef.current) {
      scene.remove(supportBeamRef.current)
      disposeScene(supportBeamRef.current)
      supportBeamRef.current = null
    }
    const supports = deleteMask?.addedSupportBeams ?? []
    if (!stageData || supports.length === 0) { requestRender(); return }
    const line = buildSupportBeamPreview(stageData, supports)
    if (line) {
      scene.add(line)
      supportBeamRef.current = line
    }
    requestRender()
  }, [deleteMask, stageData, renderMode, colorMode, requestRender])
```

> 진행 중 선택(1개 찍힌 상태)의 노드 하이라이트는 기존 `pendingNodeSelection` overlay(`buildMultiSelectionHighlight`)와 별개다. 1차 구현에서는 설치 완료된 가서포트 실선 미리보기로 충분하며, 부분 선택 표시는 토스트(`가서포트 설치됨`)와 패널 카운트로 대체한다. (추가 강조가 필요하면 후속 작업.)

- [ ] **Step 7: 빌드 확인**

Run: `npm run build`
Expected: 성공(에러 0).

- [ ] **Step 8: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/components/ThreeViewport.jsx
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "feat: ThreeViewport 가서포트 Shift+픽 분기 + 청록 미리보기 overlay"
```

---

### Task 7: ViewportContainer — supportPickEnabled prop 전달

**Files:**
- Modify: `src/components/ViewportContainer.jsx`

- [ ] **Step 1: analyze 활성 + supportPickActive 계산**

`const hoistActive = activeMode === 'hoist'`(라인 29) 다음에 추가:
```jsx
  const analyzeActive = activeMode === 'analyze'
  const supportPickActive = useEditStore(s => s.supportPickActive)
```
(`useEditStore` 는 라인 15 에서 이미 import 됨.)

- [ ] **Step 2: ThreeViewport 에 prop 전달**

`hoistPickEnabled={hoistActive}`(라인 184) 다음에 추가:
```jsx
                  supportPickEnabled={analyzeActive && supportPickActive}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/components/ViewportContainer.jsx
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "feat: ViewportContainer supportPickEnabled prop 전달"
```

---

### Task 8: AnalyzePanel — "가서포트 추가" 버튼 + 목록

**Files:**
- Modify: `src/components/AnalyzePanel.jsx`

- [ ] **Step 1: import + store 구독 추가**

(1-1) 상단 import 에 추가:
```jsx
import { Wrench, Trash2 } from 'lucide-react'
import { useEditStore } from '../store/useEditStore.js'
```
(`useStabilityStore`, `useUnitStructuralStore` 등 기존 import 유지. 이미 import 된 아이콘과 중복되지 않게 합치기.)

(1-2) `AnalyzePanel()` 본문 상단(`const us = useUnitStructuralRunner()` 부근)에 추가:
```jsx
  const supportPickActive = useEditStore(s => s.supportPickActive)
  const toggleSupportPick = useEditStore(s => s.toggleSupportPick)
  const removeSupportBeam = useEditStore(s => s.removeSupportBeam)
  const supportBeams = useEditStore(s => s.intents.filter(i => i.kind === 'addSupportBeam'))
```

- [ ] **Step 2: "가서포트(보강)" 섹션 추가**

`{/* ── 섹션 2: Unit 구조 해석 ... */}` 의 `<Section label="Unit 구조 해석">` **바로 앞**에 새 Section 삽입:
```jsx
      {/* ── 섹션: 가서포트(보강) 추가 ─────────────────── */}
      <Section label="가서포트(보강)">
        <button
          type="button"
          onClick={toggleSupportPick}
          title="버튼을 켠 뒤 3D 뷰에서 Shift + Node 2개를 클릭하면 L100×100×10t 보강재가 설치됩니다."
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            width: '100%', padding: '8px 10px', borderRadius: 6,
            fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, cursor: 'pointer',
            background: supportPickActive ? 'rgba(45,212,191,0.18)' : '#0f0f1e',
            color: supportPickActive ? '#5eead4' : '#ccd8e8',
            border: `1px solid ${supportPickActive ? '#2DD4BF' : '#2a2a40'}`,
            transition: 'all 0.15s ease',
          }}
        >
          <Wrench size={14} />
          {supportPickActive ? '가서포트 설치 모드 — Shift+Node 2개' : '가서포트 추가'}
        </button>
        {supportPickActive && (
          <Hint>Shift + Node 2개를 선택하면 두 노드를 잇는 L100×100×10t 보강재가 설치됩니다.</Hint>
        )}
        {supportBeams.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {supportBeams.map((sb) => (
              <div key={sb.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                padding: '5px 8px', background: 'rgba(45,212,191,0.08)',
                border: '1px solid rgba(45,212,191,0.35)', borderRadius: 6,
              }}>
                <span style={{ fontSize: 10.5, color: '#bfe9d8', fontWeight: 700 }}>
                  L100×100×10t · N{sb.params?.startNode}↔N{sb.params?.endNode}
                </span>
                <button
                  type="button"
                  onClick={() => removeSupportBeam(sb.id)}
                  title="이 가서포트 제거"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: 5, cursor: 'pointer',
                    background: 'transparent', border: '1px solid #2a2a4a', color: '#FF8090',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {supportBeams.length > 0 && (
          <Hint>보강 후 아래 "구조 해석 실행"을 누르면 가서포트가 반영되어 재해석됩니다.</Hint>
        )}
      </Section>
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/components/AnalyzePanel.jsx
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "feat: AnalyzePanel 가서포트 추가 버튼 + 설치 목록"
```

---

### Task 9: useUnitStructuralRunner — 실행 직전 `_edited.json` 재업로드

**Files:**
- Modify: `src/hooks/useUnitStructuralRunner.js`

- [ ] **Step 1: import 추가**

상단 import 에 추가:
```jsx
import { useEditStore } from '../store/useEditStore.js'
import { useStageStore } from '../store/useStageStore.js'
import { buildEditedStageJson, buildEditedStageFileName } from '../data/applyEditedModel.js'
```

- [ ] **Step 2: 업로드 헬퍼 추가**

`export function useUnitStructuralRunner() {` 위(모듈 스코프)에 헬퍼 추가:
```jsx
// 구조해석 실행 직전, 현재 편집(가서포트 포함) 모델을 _edited.json 으로 백엔드에 재업로드한다.
// 반환: null(업로드 불필요) | { ok:true } | { ok:false, error }
async function syncEditedModel(host) {
  const editState = useEditStore.getState()
  const intents = editState.intents ?? []
  // 편집이 한 번도 없었으면(원본 그대로) 업로드 생략 — 백엔드는 원본 BDF 를 쓴다.
  if (intents.length === 0 && !editState.editedModelUploaded) return null
  if (typeof host.uploadEvaluationArtifact !== 'function') return null
  const stages = useStageStore.getState().stages
  const stage = stages?.[stages.length - 1]
  if (!stage) return null
  try {
    const json = JSON.stringify(buildEditedStageJson(stage, intents))
    const name = buildEditedStageFileName(stage, () => String(Date.now()))
    const r = await host.uploadEvaluationArtifact(name, json)
    if (r?.ok) { editState.markEditedModelUploaded?.(); return { ok: true } }
    return { ok: false, error: r?.error ?? '편집 모델 업로드 실패' }
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}
```

- [ ] **Step 3: handleRun 에서 업로드 후 실행**

`handleRun` 의 `setStarted()` 다음, `host.runUnitStructural` 호출 **전**에 삽입:
```jsx
  const handleRun = async () => {
    if (!canRun) return
    setStarted()
    try {
      const sync = await syncEditedModel(host)
      if (sync && !sync.ok) { setFailure({ message: `보강 모델 반영 실패: ${sync.error}` }); return }
      const r = await host.runUnitStructural({ stabilityPath, safetyFactor, allowableMpa })
      if (!r) { setFailure('응답 없음'); return }
      // ... (이하 기존 코드 동일)
```
(기존 `try` 블록의 나머지는 그대로 둔다 — `r.ok` 분기 등.)

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/hooks/useUnitStructuralRunner.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "feat: 구조해석 실행 직전 가서포트 반영 _edited.json 재업로드"
```

---

### Task 10: 전체 검증 (테스트 + 빌드 + stem 정합 + 수동 E2E)

**Files:** 없음(검증). 필요 시 `HiTessWorkBenchBackEnd/app/services/unit_structural_service.py` 수정.

- [ ] **Step 1: 전체 단위테스트 green**

Run: `npm test`
Expected: 전부 PASS.

- [ ] **Step 2: 프로덕션 빌드 green**

Run: `npm run build`
Expected: 성공(경고는 기존 수준 허용).

- [ ] **Step 3: 파일명 stem 정합 실측 (핵심 리스크)**

목적: 스튜디오가 올리는 `<stage.sourceFileName>_edited.json` 이 백엔드가 찾는 `<bdf_stem>_edited.json` 과 일치하는지 확인.
- 실제 `userConnection/<ts>_<사번>_GroupModuleUnit/` 폴더에서 parent BDF 파일명(stem)과, Studio 가 로드한 마지막 stage 의 sourceFileName(stem) 을 비교.
- 일치하면 추가 작업 없음.
- **불일치 시**: `HiTessWorkBenchBackEnd/app/services/unit_structural_service.py` 의 edited_json 탐지(라인 117) 직후에 glob 폴백 추가:
```python
        if not os.path.exists(edited_json):
            import glob as _glob
            cands = sorted(_glob.glob(os.path.join(bdf_dir, "*_edited.json")))
            if cands:
                edited_json = cands[-1]
```
  → 이 경우 백엔드는 git-tracked 이므로 서버(145) `git pull` + 백엔드 재시작 필요(Task 11 보고에 명시).

- [ ] **Step 4: 수동 E2E (dev 환경)**

cwd `apps/module-unit-studio` 에서 `npm run dev` 후 WorkBench(Electron) 연동 또는 dev 호스트로:
1. GroupModuleUnit BDF 검증 → Studio 진입 → Hoist 권상 설정 → 자세안정성 평가 실행(PASS/WARN).
2. Analysis 탭 → 구조 해석 실행 → (의도적으로 허용응력 초과 케이스) 결과 확인.
3. Analysis 탭 → "가서포트 추가" ON → 3D 에서 Shift+Node 2개 → 청록 실선 미리보기 + 목록 1개 + 토스트 확인.
4. "구조 해석 실행" 재클릭 → 재해석 후 부재 초과 수가 달라지는지(보강 반영) 확인.
5. WorkBench "Group & Module Unit 권상 구조 해석" Step3 → 최종 `_lifting.bdf` 다운로드 → 텍스트에 `PBEAML ... L` + 신규 `CBEAM` 라인 포함 확인.

- [ ] **Step 5: (선택) nastran_bridge 라운드트립 스팟 체크**

가서포트 포함 `_edited.json` 1건을 백엔드 폴더에 두고:
Run(백엔드 cwd): `python InHouseProgram/NastranBridge/nastran_bridge.py <edited.json> -o <out.bdf>`
Expected: `<out.bdf>` 에 `PBEAML`+`L` 및 신규 `CBEAM` 라인 존재.

---

### Task 11: 배포 (studio zip → 로컬 StudioProgram + UNC, 버전 bump)

**Files:**
- Modify: `apps/module-unit-studio/package.json` (version)

- [ ] **Step 1: 버전 bump**

Task 0-Step3 에서 확인한 **배포본 최고 버전 + 1** 로 `package.json` 의 `"version"` 수정(예: 배포 최고 0.0.65 → `0.0.66`). 배포본이 로컬보다 높을 수 있으니 반드시 배포본 기준으로 올린다.

- [ ] **Step 2: 패키지 빌드**

Run: `npm run package` (cwd = `apps/module-unit-studio`)
Expected: `release/module-unit-studio-<ver>.zip` + `.sha256` 생성.

- [ ] **Step 3: 로컬 백엔드 StudioProgram(1순위) 복사**

```powershell
Copy-Item -LiteralPath "release/module-unit-studio-<ver>.zip" -Destination "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\StudioProgram\" -Force
Copy-Item -LiteralPath "release/module-unit-studio-<ver>.zip.sha256" -Destination "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\StudioProgram\" -Force
```

- [ ] **Step 4: UNC 아카이브 복사**

```powershell
Copy-Item -LiteralPath "release/module-unit-studio-<ver>.zip" -Destination "\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram" -Force
Copy-Item -LiteralPath "release/module-unit-studio-<ver>.zip.sha256" -Destination "\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram" -Force
```

- [ ] **Step 5: 배포 보고 작성(필수)**

커밋/완료 보고에 다음을 명시:
- 스튜디오 zip 버전 `<ver>` 을 로컬 `HiTessWorkBenchBackEnd\StudioProgram\` + UNC 양쪽 복사 완료.
- 서버(145) 반영: **스튜디오 zip 은 서버 `HiTessWorkBenchBackEnd\StudioProgram\` 에 수동 복사 필요**.
- 백엔드(`unit_structural_service.py`): Task 10-Step3 에서 glob 폴백을 **추가했다면** git-tracked → 서버 `git pull` + 백엔드 재시작 필요. **추가 안 했다면 백엔드 무변경**(git pull 불필요).
- **InHouseProgram/nastran_bridge 변경 없음**(이미 PBEAML L 지원).

---

## Self-Review

**Spec coverage:**
- 요청1 텍스트 변경 → Task 1 ✓
- "가서포트 추가" 버튼 → Task 8 ✓
- Shift+Node 2개 → L 설치 → Task 4(pickSupportNode) + Task 6(픽 분기) + Task 3(주입) ✓
- 자동 재해석 → Task 9 ✓
- 고정 100×100×10t / COG 고정 / 기본 orientation → Task 3(dims 고정, orientation 자동; COG 미변경=stability 재실행 없음) ✓
- 다운로드 최종 BDF 포함 → 주입이 _edited.bdf→lifting.bdf 로 흐름(Task 3 + Task 10-Step4.5 검증) ✓
- 리스크(stem 정합/orientation 퇴화/잔존 edited.json) → Task 10-Step3 / Task 3 helper / Task 9(editedModelUploaded) ✓
- 배포 → Task 11 ✓

**Placeholder scan:** 모든 코드 step 에 실제 코드 포함. "TBD/적절히 처리" 없음.

**Type consistency:**
- intent kind 문자열 `'addSupportBeam'` 일관(EditIntent/applyEditIntents/useEditStore/AnalyzePanel).
- params 키 `startNode/endNode/sectionKind/dims` 일관.
- mask 필드 `addedSupportBeams` 일관(applyEditIntents 생산 → applyEditedModel/ThreeViewport 소비).
- 액션명 `toggleSupportPick/pickSupportNode/addSupportBeam/removeSupportBeam/markEditedModelUploaded` 일관(store 정의 ↔ 컴포넌트 호출).
- 프리미티브 `Section/Hint` 는 AnalyzePanel 기존 정의 재사용(신규 정의 불필요).
