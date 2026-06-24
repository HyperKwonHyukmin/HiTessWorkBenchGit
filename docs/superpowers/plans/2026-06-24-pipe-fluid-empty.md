# Pipe 내부 유체 비우기 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Module Unit Studio 의 Model 좌측 패널 버튼으로 모든 Pipe material 밀도를 `7.85e-9` 로 비워, 모델 중량·무게중심을 전체 재계산하고 Nastran/BDF 구조해석까지 영구 반영한다.

**Architecture:** Studio 가 (1) in-memory stage 의 pipe material `rho` 를 mutate 해 뷰어 질량/무게중심을 즉시 재계산하고, (2) 같은 변경을 `emptyPipeFluid` edit intent 로 기록해 `_edit.json` → 백엔드 `apply_edit_json` → `convert_json_to_bdf` 경로로 Nastran BDF 까지 흘려보낸다. BDF→JSON 왕복에서 category/이름이 사라지므로 intent 에 **material ID 목록을 명시적으로** 싣는다(studio material id ↔ BDF MAT1 MID 는 동일 numbering, 검증 완료).

**Tech Stack:** React + Zustand + Three.js (studio, vitest), Python (nastran_bridge, pytest).

---

## 사전 확정 사실 (검증 완료)

- Pipe 식별: `element.category === 'Pipe'` → `propertyMap.get(propertyId).materialId` → `materialMap.get(materialId).rho`.
- 물 인코딩: pipe 전용 material `Steel_Fluid_*`, `rho > 7.85e-9` (구조용 `Steel` = `7.85e-9`).
- 질량/CoG 표시: `MassSummaryOverlay.jsx` (우선 `stageSummary`, 없으면 `computeMassFallback`), CoG 마커는 `ThreeViewport.jsx` 의 `getCogMm()`.
- `computeMassFallback(stage)` (`store/useEditStore.js` export) → `{ totalMassTon, centerOfGravityMm:{x,y,z}, beamMassTon, pointMassTon, source }` (BEAM 자중 = 단면적×길이×rho + PointMass).
- Edit intent: `createIntent(kind, params)` + `VALID_KINDS` (`data/EditIntent.js`), 추가는 `useEditStore.addIntent({kind, params})` (validate 후 `intents[]` push), export 는 `useEditStore.exportToFile()` 가 `serializeIntents(get().intents, ...)` 로 **모든 intents** 직렬화 → `<base>_edit.json`. 따라서 intent 만 추가하면 자동 반영.
- 백엔드 `apply_edit_json` (소스 `C:\Coding\WorkBenchSubModule\Nastran_bridge\nastran_bridge.py`, 런타임 `InHouseProgram/NastranBridge/nastran_bridge.py`) 의 intent 분기에 새 kind 추가. 미지원 kind 는 skip 처리되므로 하위호환.
- `as_int`/`as_float` 헬퍼 존재 (nastran_bridge.py:99,108). `apply_edit_json` 위치 ≈ line 3126.

## File Structure

Studio (`C:\Coding\WorkBenchSubModule\ModuleUnitStudio\apps\module-unit-studio\src\`):
- **Create** `data/pipeFluid.js` — 순수 헬퍼(`PIPE_STEEL_RHO`, `collectPipeMaterialIds`, `applyPipeFluidEmpty`).
- **Create** `data/pipeFluid.test.js`.
- **Modify** `data/EditIntent.js` — `emptyPipeFluid` kind/검증/요약.
- **Modify** `data/EditIntent.test.js` — emptyPipeFluid 테스트.
- **Modify** `store/useStageStore.js` — `pipeFluidEmptied` 플래그 + `emptyPipeFluid()` 액션.
- **Create** `store/useStageStore.test.js`.
- **Modify** `components/MassSummaryOverlay.jsx` — emptied 시 재계산 강제.
- **Modify** `components/ThreeViewport.jsx` — `getCogMm` 에 emptied 분기.
- **Modify** `components/Sidebar.jsx` — "모델 조작" 섹션 + 버튼 + 핸들러.
- **Modify** `package.json` — 버전 bump.

Backend:
- **Modify** `C:\Coding\WorkBenchSubModule\Nastran_bridge\nastran_bridge.py` — `apply_edit_json` 에 `emptyPipeFluid` 분기.
- **Create** `C:\Coding\WorkBenchSubModule\Nastran_bridge\tests\test_pipe_fluid_edit.py`.
- **Copy** 수정본을 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\NastranBridge\nastran_bridge.py` 로 미러.

---

## Task 1: pipeFluid 순수 헬퍼 (studio)

**Files:**
- Create: `apps/module-unit-studio/src/data/pipeFluid.js`
- Test: `apps/module-unit-studio/src/data/pipeFluid.test.js`

작업 디렉터리: `C:\Coding\WorkBenchSubModule\ModuleUnitStudio\apps\module-unit-studio`

- [ ] **Step 1: 실패 테스트 작성** — `src/data/pipeFluid.test.js`

```js
import { describe, it, expect } from 'vitest'
import { collectPipeMaterialIds, applyPipeFluidEmpty, PIPE_STEEL_RHO } from './pipeFluid.js'

function makeStage() {
  const materials = [
    { id: 1, name: 'Steel', rho: 7.85e-9 },
    { id: 2, name: 'Steel_Fluid_A', rho: 1.3e-8 },
    { id: 3, name: 'Steel_Fluid_B', rho: 1.6e-8 },
  ]
  const properties = [
    { id: 10, materialId: 1 }, // structure
    { id: 20, materialId: 2 }, // pipe
    { id: 30, materialId: 3 }, // pipe
  ]
  return {
    elements: [
      { id: 1, type: 'BEAM', category: 'Structure', propertyId: 10 },
      { id: 2, type: 'BEAM', category: 'Pipe', propertyId: 20 },
      { id: 3, type: 'BEAM', category: 'Pipe', propertyId: 30 },
    ],
    propertyMap: new Map(properties.map(p => [p.id, p])),
    materialMap: new Map(materials.map(m => [m.id, m])),
    materials,
  }
}

describe('collectPipeMaterialIds', () => {
  it('Pipe 요소가 참조하는 material id 만 수집', () => {
    expect([...collectPipeMaterialIds(makeStage())].sort()).toEqual([2, 3])
  })
  it('stage 가 없으면 빈 Set', () => {
    expect(collectPipeMaterialIds(null).size).toBe(0)
  })
})

describe('applyPipeFluidEmpty', () => {
  it('지정 material 의 rho 만 7.85e-9 로 변경, 구조 material 불변', () => {
    const stage = makeStage()
    const changed = applyPipeFluidEmpty([stage], collectPipeMaterialIds(stage))
    expect(changed).toBe(2)
    expect(stage.materialMap.get(2).rho).toBe(PIPE_STEEL_RHO)
    expect(stage.materialMap.get(3).rho).toBe(PIPE_STEEL_RHO)
    expect(stage.materials.find(m => m.id === 2).rho).toBe(PIPE_STEEL_RHO) // Map↔array 동일 ref
    expect(stage.materialMap.get(1).rho).toBe(7.85e-9)
  })
  it('이미 7.85e-9 면 changed 카운트에 포함 안 함', () => {
    const stage = makeStage()
    const changed = applyPipeFluidEmpty([stage], new Set([1]))
    expect(changed).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/data/pipeFluid.test.js`
Expected: FAIL — "Failed to resolve import './pipeFluid.js'".

- [ ] **Step 3: 구현** — `src/data/pipeFluid.js`

```js
/**
 * pipeFluid — 배관 내부 유체(물) 비우기 순수 헬퍼.
 *
 * 모델은 배관 내부 물을 강재 + 물 등가밀도(예: Steel_Fluid_*, rho > 7.85e-9)로 표현한다.
 * "비우기" = Pipe 요소가 참조하는 material 들의 rho 를 순수 강재값(7.85e-9)으로 되돌리는 것.
 */

// 순수 강재 밀도 (t/mm³, NASTRAN consistent units mm·N·s·t).
export const PIPE_STEEL_RHO = 7.85e-9

/**
 * stage 에서 category==='Pipe' 요소가 참조하는 material id 집합을 모은다.
 * @param {object|null} stage  StageData (elements/propertyMap 보유)
 * @returns {Set<number>}
 */
export function collectPipeMaterialIds(stage) {
  const ids = new Set()
  if (!stage) return ids
  for (const e of stage.elements ?? []) {
    if (e.category !== 'Pipe') continue
    const prop = stage.propertyMap?.get?.(e.propertyId)
    const mid = prop?.materialId
    if (mid != null) ids.add(mid)
  }
  return ids
}

/**
 * 여러 stage 의 materialMap 에서 materialIds 에 해당하는 material rho 를 rho 로 set (in-place).
 * StageData 의 materialMap 값과 materials 배열 항목은 동일 객체 참조라 둘 다 갱신된다.
 * @param {object[]} stages
 * @param {Iterable<number>} materialIds
 * @param {number} [rho]
 * @returns {number}  실제로 값이 바뀐 material 항목 수 (stage 합산)
 */
export function applyPipeFluidEmpty(stages, materialIds, rho = PIPE_STEEL_RHO) {
  if (!Array.isArray(stages) || !materialIds) return 0
  const idSet = materialIds instanceof Set ? materialIds : new Set(materialIds)
  let changed = 0
  for (const stage of stages) {
    for (const mid of idSet) {
      const mat = stage?.materialMap?.get?.(mid)
      if (mat && mat.rho !== rho) { mat.rho = rho; changed++ }
    }
  }
  return changed
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/data/pipeFluid.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/module-unit-studio/src/data/pipeFluid.js apps/module-unit-studio/src/data/pipeFluid.test.js
git commit -m "✨ feat(pipeFluid): 배관 유체 비우기 순수 헬퍼 추가"
```

---

## Task 2: emptyPipeFluid edit intent (studio)

**Files:**
- Modify: `apps/module-unit-studio/src/data/EditIntent.js`
- Test: `apps/module-unit-studio/src/data/EditIntent.test.js`

- [ ] **Step 1: 실패 테스트 추가** — `src/data/EditIntent.test.js` 끝에 append

```js
import { createIntent, validateIntent, summarizeIntent } from './EditIntent.js'

describe('emptyPipeFluid intent', () => {
  const stage = {
    materialMap: new Map([[2, { id: 2, rho: 1.3e-8 }], [3, { id: 3, rho: 1.6e-8 }]]),
  }
  it('정상 params 면 createIntent 성공 + validate ok', () => {
    const intent = createIntent('emptyPipeFluid', { materialIds: [2, 3], targetRho: 7.85e-9 })
    expect(intent.kind).toBe('emptyPipeFluid')
    expect(validateIntent(intent, stage, []).status).toBe('ok')
  })
  it('materialIds 가 비면 error', () => {
    const intent = createIntent('emptyPipeFluid', { materialIds: [], targetRho: 7.85e-9 })
    expect(validateIntent(intent, stage, []).status).toBe('error')
  })
  it('이미 emptyPipeFluid intent 가 있으면 중복 error (단방향)', () => {
    const existing = [createIntent('emptyPipeFluid', { materialIds: [2], targetRho: 7.85e-9 })]
    const intent = createIntent('emptyPipeFluid', { materialIds: [3], targetRho: 7.85e-9 })
    expect(validateIntent(intent, stage, existing).status).toBe('error')
  })
  it('summarizeIntent 가 material 개수를 표시', () => {
    const intent = createIntent('emptyPipeFluid', { materialIds: [2, 3], targetRho: 7.85e-9 })
    expect(summarizeIntent(intent)).toContain('2개')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/data/EditIntent.test.js`
Expected: FAIL — `createIntent` throws "Unknown EditIntent kind: emptyPipeFluid".

- [ ] **Step 3: 구현** — `src/data/EditIntent.js` 3곳 수정

(a) `VALID_KINDS` 에 추가 (파일 상단 근처):

```js
const VALID_KINDS = new Set(['addRigid', 'deleteGroup', 'deleteElement', 'deleteCategory', 'deleteOrphanNodes', 'emptyPipeFluid'])
```

(b) `validateIntent` 의 분기 체인에 추가 (`deleteOrphanNodes` else-if 다음, 최종 else 앞):

```js
  } else if (intent.kind === 'emptyPipeFluid') {
    validateEmptyPipeFluid(intent.params, stageData, existingIntents, errors, warnings)
```

(c) 새 검증 함수 추가 (`validateDeleteOrphanNodes` 함수 뒤):

```js
function validateEmptyPipeFluid(params, stageData, existingIntents, errors, warnings) {
  const ids = params?.materialIds
  if (!Array.isArray(ids) || ids.length === 0) {
    errors.push('materialIds 가 비어 있습니다 (비울 배관 material 없음).')
    return
  }
  if (ids.some(m => !Number.isInteger(m))) {
    errors.push('materialIds 배열에 정수가 아닌 값이 있습니다.')
    return
  }
  // 단방향 — 같은 intent 중복 추가 차단
  for (const ex of existingIntents) {
    if (ex.kind === 'emptyPipeFluid') {
      errors.push('배관 유체 비우기 intent 가 이미 추가되어 있습니다.')
      return
    }
  }
  // 현재 stage 에 없는 material 은 경고만 (다른 stage 기준일 수 있음)
  if (stageData?.materialMap) {
    const missing = ids.filter(m => !stageData.materialMap.has(m))
    if (missing.length > 0) {
      warnings.push(`material ${missing.slice(0, 5).join(',')} 가 현재 stage 에 없습니다.`)
    }
  }
}
```

(d) `summarizeIntent` 에 분기 추가 (`deleteOrphanNodes` 분기 뒤, 최종 return 앞):

```js
  if (intent.kind === 'emptyPipeFluid') {
    const ids = Array.isArray(intent.params?.materialIds) ? intent.params.materialIds : []
    return `배관 내부 유체 비우기 (${ids.length}개 material → ρ=7.85e-9)`
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/data/EditIntent.test.js`
Expected: PASS (기존 + 신규 4 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/module-unit-studio/src/data/EditIntent.js apps/module-unit-studio/src/data/EditIntent.test.js
git commit -m "✨ feat(EditIntent): emptyPipeFluid intent kind 추가"
```

---

## Task 3: useStageStore — pipeFluidEmptied 플래그 + emptyPipeFluid() 액션

**Files:**
- Modify: `apps/module-unit-studio/src/store/useStageStore.js`
- Test: `apps/module-unit-studio/src/store/useStageStore.test.js` (Create)

- [ ] **Step 1: 실패 테스트 작성** — `src/store/useStageStore.test.js`

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { useStageStore } from './useStageStore.js'
import { PIPE_STEEL_RHO } from '../data/pipeFluid.js'

function makeStage() {
  const materials = [
    { id: 1, name: 'Steel', rho: 7.85e-9 },
    { id: 2, name: 'Steel_Fluid_A', rho: 1.3e-8 },
  ]
  const properties = [{ id: 10, materialId: 1 }, { id: 20, materialId: 2 }]
  return {
    elements: [
      { id: 1, type: 'BEAM', category: 'Structure', propertyId: 10 },
      { id: 2, type: 'BEAM', category: 'Pipe', propertyId: 20 },
    ],
    propertyMap: new Map(properties.map(p => [p.id, p])),
    materialMap: new Map(materials.map(m => [m.id, m])),
    materials,
  }
}

describe('useStageStore.emptyPipeFluid', () => {
  beforeEach(() => { useStageStore.setState({ stages: [], pipeFluidEmptied: false }) })

  it('기본 pipeFluidEmptied 는 false', () => {
    expect(useStageStore.getState().pipeFluidEmptied).toBe(false)
  })

  it('pipe material rho 를 7.85e-9 로 바꾸고 플래그를 set, materialIds 반환', () => {
    const stage = makeStage()
    useStageStore.setState({ stages: [stage] })
    const { materialIds, changedCount } = useStageStore.getState().emptyPipeFluid()
    expect(materialIds).toEqual([2])
    expect(changedCount).toBe(1)
    expect(stage.materialMap.get(2).rho).toBe(PIPE_STEEL_RHO)
    expect(stage.materialMap.get(1).rho).toBe(7.85e-9)
    expect(useStageStore.getState().pipeFluidEmptied).toBe(true)
    expect(useStageStore.getState().stages).not.toBe([stage]) // 새 배열 참조
  })

  it('stages 가 비면 no-op', () => {
    const r = useStageStore.getState().emptyPipeFluid()
    expect(r.materialIds).toEqual([])
    expect(useStageStore.getState().pipeFluidEmptied).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/store/useStageStore.test.js`
Expected: FAIL — `emptyPipeFluid is not a function`.

- [ ] **Step 3: 구현** — `src/store/useStageStore.js`

(a) import 추가 (상단):

```js
import { collectPipeMaterialIds, applyPipeFluidEmpty, PIPE_STEEL_RHO } from '../data/pipeFluid.js'
```

(b) 초기 상태에 플래그 추가 (`stageSummary: null,` 근처):

```js
  // 배관 내부 유체 비우기 적용 여부 (단방향 false→true). 새 폴더 로드/reset 시 false.
  pipeFluidEmptied: false,
```

(c) `reset:` 의 set 객체에 `pipeFluidEmptied: false` 추가:

```js
  reset: () => set({ stages: [], inputAudit: null, stageSummary: null, loading: false, error: null, loadSummary: emptyLoadSummary(), sourceFolderRef: null, pipeFluidEmptied: false }),
```

(d) `loadStages` 성공 시 set 에 `pipeFluidEmptied: false` 추가:

```js
      set({ stages, inputAudit, stageSummary, loading: false, loadSummary: summary, pipeFluidEmptied: false })
```

(e) 새 액션 추가 (`loadStages` 뒤, store 객체 안):

```js
  /**
   * 모든 Pipe 요소가 참조하는 material 의 rho 를 7.85e-9 로 비운다 (단방향).
   * - in-memory stage 를 mutate 하고 stages 를 새 참조로 교체해 질량/무게중심 재계산을 유발.
   * - 호출자(Sidebar)가 반환된 materialIds 로 emptyPipeFluid edit intent 를 추가한다.
   * @returns {{ materialIds: number[], changedCount: number }}
   */
  emptyPipeFluid: () => {
    const stages = useStageStore.getState().stages
    if (!Array.isArray(stages) || stages.length === 0) {
      return { materialIds: [], changedCount: 0 }
    }
    const last = stages[stages.length - 1]
    const ids = collectPipeMaterialIds(last)
    const changedCount = applyPipeFluidEmpty(stages, ids, PIPE_STEEL_RHO)
    set({ stages: [...stages], pipeFluidEmptied: true })
    return { materialIds: [...ids], changedCount }
  },
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/store/useStageStore.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/module-unit-studio/src/store/useStageStore.js apps/module-unit-studio/src/store/useStageStore.test.js
git commit -m "✨ feat(useStageStore): pipeFluidEmptied 플래그 + emptyPipeFluid 액션"
```

---

## Task 4: MassSummaryOverlay — 비웠을 때 전체 재계산

**Files:**
- Modify: `apps/module-unit-studio/src/components/MassSummaryOverlay.jsx`

근거: 현재 `stageSummary.massProperties` 가 있으면 그 값을 쓰므로, 비워도 표시가 안 바뀐다. `pipeFluidEmptied` 면 stageSummary 를 무시하고 `computeMassFallback`(mutated last stage)로 강제 재계산한다.

- [ ] **Step 1: 구현** — `MassSummaryOverlay.jsx`

(a) `useStageStore` 구독에 플래그 추가 (컴포넌트 상단, 기존 `const stages = useStageStore(s => s.stages)` 뒤):

```js
  const pipeFluidEmptied = useStageStore(s => s.pipeFluidEmptied)
```

(b) `fallback` useMemo 수정 — emptied 면 stageSummary 무시:

```js
  const fallback = useMemo(() => {
    if (!pipeFluidEmptied && stageSummary?.massProperties) return null
    const last = stages.length > 0 ? stages[stages.length - 1] : null
    if (!last) return null
    return computeMassFallback(last)
  }, [stageSummary, stages, pipeFluidEmptied])
```

(c) `massData` 계산 시 emptied 면 summary 측 입력을 null 로:

```js
  const massData = pickMassData(pipeFluidEmptied ? null : stageSummary?.massProperties, fallback)
```

(d) title 문구 보강 (emptied 표시) — 기존 `title={...}` 삼항을 다음으로 교체:

```js
      title={
        pipeFluidEmptied
          ? '모델 전체 질량 / 권상 하중 / 무게중심 (배관 유체 비움 — 자동 재계산)'
          : massData.source === 'stageSummary'
            ? '모델 전체 질량 / 권상 하중 / 무게중심 (00_StageSummary.json 기준)'
            : `모델 전체 질량 / 권상 하중 / 무게중심 (자동 계산: ${massData.source})`
      }
```

- [ ] **Step 2: 수동 검증 (테스트 환경 없이 로직 확인)**

`pipeFluidEmptied===false` + stageSummary 존재 → 기존과 동일(summary 표시). `true` → fallback 표시. (Task 8 의 dev 실행에서 시각 확인.)

- [ ] **Step 3: 빌드 확인**

Run: `npx vitest run` (전체 — 회귀 없음 확인) 후 `npm run build`
Expected: 빌드 성공, 기존 테스트 PASS.

- [ ] **Step 4: 커밋**

```bash
git add apps/module-unit-studio/src/components/MassSummaryOverlay.jsx
git commit -m "✨ feat(MassSummary): 배관 유체 비움 시 질량/무게중심 전체 재계산"
```

---

## Task 5: ThreeViewport getCogMm — 비웠을 때 재계산 CoG 사용

**Files:**
- Modify: `apps/module-unit-studio/src/components/ThreeViewport.jsx`

근거: CoG 마커는 `getCogMm(stageSummary, stabilityReport, stageData)` 우선순위에서 stageSummary COG 를 먼저 쓴다. 비웠으면 `computeMassFallback(stageData).centerOfGravityMm` (BEAM 자중 포함)을 우선 사용해 MassSummaryOverlay 와 일치시킨다.

- [ ] **Step 1: 구현** — `ThreeViewport.jsx`

(a) import 추가 (상단 import 블록):

```js
import { computeMassFallback } from '../store/useEditStore.js'
```

(b) `pipeFluidEmptied` 구독 추가 (기존 `const stageSummary = useStageStore(s => s.stageSummary)` 근처):

```js
  const pipeFluidEmptied = useStageStore(s => s.pipeFluidEmptied)
```

(c) CoG effect 의 `getCogMm` 호출에 인자 추가 (현재 `const cogMm = getCogMm(stageSummary, stabilityReport, stageData)`):

```js
    const cogMm = getCogMm(stageSummary, stabilityReport, stageData, pipeFluidEmptied)
```

(d) 같은 effect 의 의존성 배열에 `pipeFluidEmptied` 추가:

```js
  }, [layers?.cog, stageData, stageSummary, stabilityReport, renderMode, colorMode, requestRender, pipeFluidEmptied])
```

(e) `getCogMm` 함수 시그니처/본문 수정 (파일 하단 함수):

```js
function getCogMm(stageSummary, stabilityReport, stageData, pipeFluidEmptied = false) {
  // 배관 유체를 비웠으면 mutated stage 기준 재계산값을 최우선 (BEAM 자중 포함).
  if (pipeFluidEmptied) {
    const recomputed = computeMassFallback(stageData)?.centerOfGravityMm
    if (isCog(recomputed)) return recomputed
  }

  const fromSummary = stageSummary?.massProperties?.centerOfGravityMm
  if (isCog(fromSummary)) return fromSummary

  const fromStability = stabilityReport?.input?.centerOfGravityMm
  if (isCog(fromStability)) return fromStability

  const fromPosture = stabilityReport?.model?.centerOfGravityMm
  if (isCog(fromPosture)) return fromPosture

  const fallback = computeStageCogFallback(stageData)
  return isCog(fallback) ? fallback : null
}
```

- [ ] **Step 2: 빌드/회귀 확인**

Run: `npx vitest run && npm run build`
Expected: 기존 테스트 PASS, 빌드 성공.

- [ ] **Step 3: 커밋**

```bash
git add apps/module-unit-studio/src/components/ThreeViewport.jsx
git commit -m "✨ feat(CoG): 배관 유체 비움 시 무게중심 마커 재계산값 사용"
```

---

## Task 6: Sidebar — "모델 조작" 섹션 + 버튼

**Files:**
- Modify: `apps/module-unit-studio/src/components/Sidebar.jsx`

스튜디오에 전역 toast 가 없으므로 결과는 섹션 내 인라인 텍스트 + 버튼 비활성/체크로 표시한다 (MassSummaryOverlay 가 즉시 갱신되므로 충분).

- [ ] **Step 1: 구현** — `Sidebar.jsx`

(a) import 추가:

```js
import { computeMassFallback } from '../store/useEditStore.js'
import { collectPipeMaterialIds, PIPE_STEEL_RHO } from '../data/pipeFluid.js'
import { Droplet } from 'lucide-react'
```

(b) 컴포넌트 본문 상단 — 구독 + 파생값 + 핸들러 추가 (기존 `const handleReset = ...` 근처):

```js
  const pipeFluidEmptied = useStageStore(s => s.pipeFluidEmptied)
  const stages = useStageStore(s => s.stages)
  const [emptyResult, setEmptyResult] = useState(null) // { delta:number|null, count:number }

  const pipeMaterialCount = (() => {
    const last = stages.length > 0 ? stages[stages.length - 1] : null
    return last ? collectPipeMaterialIds(last).size : 0
  })()

  const handleEmptyPipeFluid = useCallback(() => {
    const st = useStageStore.getState()
    const cur = st.stages
    if (!cur.length) return
    const ok = window.confirm(
      '모든 배관(Pipe) material 의 밀도를 7.85e-9 로 바꿔 내부 유체 중량을 제거합니다.\n' +
      '되돌리려면 모델을 다시 로드해야 합니다. 계속할까요?'
    )
    if (!ok) return
    const last = cur[cur.length - 1]
    const before = computeMassFallback(last)?.totalMassTon ?? null
    const { materialIds, changedCount } = st.emptyPipeFluid()
    const after = computeMassFallback(last)?.totalMassTon ?? null
    useEditStore.getState().addIntent({
      kind: 'emptyPipeFluid',
      params: { materialIds, targetRho: PIPE_STEEL_RHO },
    })
    const delta = (before != null && after != null) ? (before - after) : null
    setEmptyResult({ delta, count: changedCount })
  }, [])
```

(c) "레이어" `</Section>` 와 "초기화 버튼" 주석 사이에 새 섹션 추가:

```jsx
      {/* ── 섹션: 모델 조작 ─────────────────────────── */}
      <Section label="모델 조작">
        <Tooltip placement="right" content={<>
          <strong style={{ color: '#7ab2d4' }}>Pipe 내부 유체 비우기</strong><br/>
          모든 배관 material 의 밀도를 순수 강재(7.85e-9)로 되돌려 내부 물 중량을 제거합니다.
          모델 중량·무게중심이 즉시 재계산되고, 구조해석(Nastran) BDF 에도 반영됩니다.
          단방향이며 되돌리려면 모델을 다시 로드하세요.
        </>}>
          <button
            type="button"
            onClick={handleEmptyPipeFluid}
            disabled={pipeFluidEmptied || pipeMaterialCount === 0 || stages.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
              padding: '7px 10px', borderRadius: 7, cursor: (pipeFluidEmptied || pipeMaterialCount === 0) ? 'default' : 'pointer',
              fontSize: 12, fontWeight: 700,
              background: pipeFluidEmptied ? 'rgba(110,231,183,0.10)' : 'rgba(122,178,212,0.12)',
              color: pipeFluidEmptied ? '#6ee7b7' : '#bcd6e8',
              border: `1px solid ${pipeFluidEmptied ? 'rgba(110,231,183,0.45)' : 'rgba(122,178,212,0.35)'}`,
              opacity: (pipeMaterialCount === 0 && !pipeFluidEmptied) ? 0.5 : 1,
            }}
          >
            <Droplet size={14} />
            {pipeFluidEmptied ? '유체 비움 완료 ✓' : 'Pipe 내부 유체 비우기'}
          </button>
        </Tooltip>
        {pipeMaterialCount === 0 && !pipeFluidEmptied && (
          <div style={{ fontSize: 10, color: '#7a8aaa', marginTop: 4 }}>배관 부재가 없습니다.</div>
        )}
        {emptyResult && (
          <div style={{ fontSize: 10, color: '#9fd0b6', marginTop: 4 }}>
            material {emptyResult.count}개 비움{emptyResult.delta != null ? ` · −${emptyResult.delta.toFixed(1)} ton` : ''}, 무게중심 갱신됨
          </div>
        )}
      </Section>
```

- [ ] **Step 2: dev 실행 시각 검증 (Task 8 과 함께)**

모델 로드 → "모델 조작" 섹션 버튼 클릭 → 확인 → MassSummaryOverlay 의 Total Mass 감소 + 무게중심 좌표 변경 + 버튼이 "유체 비움 완료 ✓"로 비활성.

- [ ] **Step 3: 빌드/회귀 확인**

Run: `npx vitest run && npm run build`
Expected: PASS + 빌드 성공.

- [ ] **Step 4: 커밋**

```bash
git add apps/module-unit-studio/src/components/Sidebar.jsx
git commit -m "✨ feat(Sidebar): 'Pipe 내부 유체 비우기' 버튼 + 모델 조작 섹션"
```

---

## Task 7: 백엔드 nastran_bridge — emptyPipeFluid 적용

**Files:**
- Modify: `C:\Coding\WorkBenchSubModule\Nastran_bridge\nastran_bridge.py` (소스)
- Test: `C:\Coding\WorkBenchSubModule\Nastran_bridge\tests\test_pipe_fluid_edit.py` (Create)
- Copy: → `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\NastranBridge\nastran_bridge.py`

작업 디렉터리: `C:\Coding\WorkBenchSubModule\Nastran_bridge`

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_pipe_fluid_edit.py`

```python
import importlib.util, pathlib

_spec = importlib.util.spec_from_file_location(
    "nastran_bridge", pathlib.Path(__file__).resolve().parent.parent / "nastran_bridge.py"
)
nb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(nb)


def _base_model():
    return {
        "meta": {"stageName": "Model"},
        "nodes": [{"id": 1, "x": 0, "y": 0, "z": 0}],
        "elements": [],
        "properties": [{"id": 20, "materialId": 2}],
        "materials": [
            {"id": 1, "name": "Steel", "E": 206000, "nu": 0.3, "rho": 7.85e-9},
            {"id": 2, "name": "MAT1_2", "E": 206000, "nu": 0.3, "rho": 1.3e-8},
            {"id": 3, "name": "MAT1_3", "E": 206000, "nu": 0.3, "rho": 1.6e-8},
        ],
    }


def test_empty_pipe_fluid_sets_rho_for_listed_materials():
    edit = {
        "schemaVersion": "1.0",
        "intents": [
            {"id": "x", "kind": "emptyPipeFluid",
             "params": {"materialIds": [2, 3], "targetRho": 7.85e-9}},
        ],
    }
    model, summary = nb.apply_edit_json(_base_model(), edit)
    rho = {m["id"]: m["rho"] for m in model["materials"]}
    assert rho[2] == 7.85e-9
    assert rho[3] == 7.85e-9
    assert rho[1] == 7.85e-9      # 구조 material 불변
    assert summary["applied"] == 1
    assert summary.get("emptiedPipeMaterials") == 2


def test_empty_pipe_fluid_default_rho_when_missing():
    edit = {"schemaVersion": "1.0", "intents": [
        {"id": "x", "kind": "emptyPipeFluid", "params": {"materialIds": [2]}}]}
    model, summary = nb.apply_edit_json(_base_model(), edit)
    rho = {m["id"]: m["rho"] for m in model["materials"]}
    assert rho[2] == 7.85e-9
    assert summary["applied"] == 1
```

> 참고: `is_edit_json(edit_data)` 가 `intents` 키 존재로 판정하는지 확인. 아니면 위 edit dict 에 기존 통과 테스트(`test_sidepassage_edit_export.py`)가 쓰는 최소 헤더 필드를 맞춰 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Coding/WorkBenchSubModule/Nastran_bridge && python -m pytest tests/test_pipe_fluid_edit.py -v`
Expected: FAIL — emptyPipeFluid 가 skip 되어 `summary["applied"] == 0`, rho 미변경.

- [ ] **Step 3: 구현** — `nastran_bridge.py` `apply_edit_json` 의 intent 분기에 추가

`editRigidDependents` 분기 뒤, `else:` (Unsupported) 앞에 삽입:

```python
        elif kind == "emptyPipeFluid":
            # 배관 내부 유체 비우기 — 지정된 material 의 rho 를 순수 강재값으로 set.
            # BDF→JSON 왕복에서 category/이름이 사라지므로, studio 가 계산한 material ID 목록을
            # 그대로 신뢰한다(studio material id ↔ MAT1 MID 동일 numbering).
            target_rho = as_float(params.get("targetRho"))
            if target_rho is None:
                target_rho = 7.85e-9
            mids = {as_int(m) for m in params.get("materialIds", []) if as_int(m) is not None}
            changed = 0
            for mat in base_data.get("materials", []):
                if isinstance(mat, dict) and as_int(mat.get("id")) in mids:
                    mat["rho"] = target_rho
                    changed += 1
            if changed:
                summary["applied"] += 1
                summary["emptiedPipeMaterials"] = summary.get("emptiedPipeMaterials", 0) + changed
            else:
                summary["skipped"] += 1
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_pipe_fluid_edit.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: 전체 회귀 + 미러 복사**

```bash
cd /c/Coding/WorkBenchSubModule/Nastran_bridge && python -m pytest -q
cp nastran_bridge.py /c/Coding/WorkBench/HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py
sha256sum nastran_bridge.py /c/Coding/WorkBench/HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py
```
Expected: 전체 테스트 PASS, 두 파일 SHA256 동일.

- [ ] **Step 6: 커밋**

```bash
cd /c/Coding/WorkBenchSubModule/Nastran_bridge
git add nastran_bridge.py tests/test_pipe_fluid_edit.py
git commit -m "✨ feat(nastran_bridge): emptyPipeFluid edit intent — pipe MAT1 rho 비우기"
```
(InHouseProgram 사본은 git 미추적이므로 커밋 대상 아님 — 서버 수동 교체 대상으로 §배포에 기록.)

---

## Task 8: 버전 bump + 통합 검증 + 배포

**Files:**
- Modify: `apps/module-unit-studio/package.json`

- [ ] **Step 1: 현재 배포 버전 확인 후 bump**

StudioProgram 양쪽(로컬 백엔드 `HiTessWorkBenchBackEnd/StudioProgram/`, UNC)의 기존 최고 버전을 확인하고, 그보다 높게 `package.json` `version` 을 올린다 (드리프트 주의 — 메모리: 현재 소스 0.0.52, 로컬 배포 0.0.52까지 존재).

- [ ] **Step 2: 전체 테스트 + 빌드**

Run: `cd /c/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio && npx vitest run && npm run build`
Expected: 전체 PASS + 빌드 성공.

- [ ] **Step 3: dev 통합 검증 (수동)**

`npm run dev` → 모델 로드(배관 포함) → Model 탭 좌측 "모델 조작" → "Pipe 내부 유체 비우기" 클릭 →
확인 항목:
1. MassSummaryOverlay Total Mass 가 감소(BEAM 질량 줄어듦).
2. 무게중심 좌표(X/Y/Z) 및 3D CoG 마커 위치 변경.
3. 버튼이 "유체 비움 완료 ✓"로 비활성, 인라인 결과 표시.
4. (선택) 편집 export 시 `_edit.json` 에 `emptyPipeFluid` intent 포함 확인.

- [ ] **Step 4: 패키지 빌드**

Run: `npm run package`
Expected: `release/module-unit-studio-<ver>.zip` + `.sha256` 생성.

- [ ] **Step 5: 커밋 + 배포(사용자 확인 후)**

```bash
git add apps/module-unit-studio/package.json
git commit -m "🔖 release: module-unit-studio v<ver> — Pipe 내부 유체 비우기"
```
배포(★ 사용자 확인 필수):
1. zip + sha256 → `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\StudioProgram\` 복사.
2. zip + sha256 → UNC `\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram` 복사 (`Copy-Item -LiteralPath ... -Destination '<경로>' -Force`).

- [ ] **Step 6: 서버(145) 반영 보고 (필수)**

커밋 보고에 명시:
- **서버 수동 교체 대상:** `InHouseProgram/NastranBridge/nastran_bridge.py` (git 미추적) → 서버 동일 경로에 덮어쓰기 + **백엔드 재시작**.
- Studio zip: 서버 `HiTessWorkBenchBackEnd\StudioProgram\` 에 수동 복사.
- `git pull` 만으로 끝나지 않음 — nastran_bridge.py 수동 교체 + 재시작 필요.

---

## Self-Review (작성자 체크)

- **Spec 커버리지:** §4.1 플래그→T3 / §4.2 액션→T1,T3 / §4.3 질량 재계산→T4 / CoG→T5 / §4.4 intent→T2 / §4.5 UI→T6 / §5 백엔드→T7 / 배포→T8. 모든 스펙 항목에 대응 task 존재. ✓
- **§8 검증 항목:** ① material ID↔MID 동일(검증 완료, T7 주석 반영) ② CoG 소스(T5) ③ _edit.json 자동 포함(T6, exportToFile 가 모든 intents 직렬화). ✓
- **Placeholder:** 모든 코드 블록 실제 코드. "TBD/적절히 처리" 없음. ✓
- **타입 일관성:** `emptyPipeFluid` kind, `params.materialIds`/`targetRho`, `PIPE_STEEL_RHO`, `collectPipeMaterialIds`/`applyPipeFluidEmpty`, `computeMassFallback().centerOfGravityMm` — task 간 명칭 일치. ✓
- **유의:** T7 의 `is_edit_json` 판정 조건은 실패 테스트 단계에서 확인(주석). 불일치 시 edit dict 헤더를 기존 통과 테스트 기준으로 맞춘다.
