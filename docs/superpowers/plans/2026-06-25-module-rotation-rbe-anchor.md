# Module Unit Studio — RBE 인지 anchor + 모델 회전 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자세/구조 anchor 노드 선정에서 RBE(independent+dependent) 연결 노드를 제외하고, Model 모드에 축(X/Y/Z)+각도 모델 회전 기능을 추가해 뷰어·자세안정성·구조해석·BDF 출력에 일관 반영한다.

**Architecture:** 회전은 **프론트 인메모리 변환(Approach A)** — `useStageStore.rotateModel`이 모든 stage 의 `nodeMap` 좌표와 CBEAM/CBAR `orientation` 벡터를 CoG 피벗 기준으로 회전시키고, 세 소비처(뷰어/`buildPostureStabilityPayload`/`buildEditedStageJson`→BDF)가 같은 인메모리 geometry 를 읽어 자동 일관. anchor RBE 제외는 백엔드 `nastran_bridge._pick_anti_rigid_body_anchor` 단일 함수 변경.

**Tech Stack:** React 19 + Zustand + Three.js + vitest (frontend, `C:\Coding\WorkBenchSubModule\ModuleUnitStudio\apps\module-unit-studio`), Python 3 (backend `nastran_bridge.py`).

**커밋 규칙:** 프론트 커밋은 `git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio"` 로 `feat/hoist-candidate-nodes` 브랜치에. 특정 파일만 stage(`git add -A` 금지), `config.js`·`LayerPanel.jsx` 스테이징 금지. 백엔드 `nastran_bridge.py`는 git 미추적 → 커밋 없음, **서버(145) 수동 교체 대상**. 메시지 한국어 + 이모지 prefix + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**경로 약어:** `FE = C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio/src`

---

## Part A — Feature 1: 백엔드 anchor RBE 제외 + 폴백 (독립 기능)

### Task 1: `_pick_anti_rigid_body_anchor` 가 RBE independent+dependent 노드를 모두 제외하고, 후보가 없으면 폴백

**Files:**
- Modify: `C:/Coding/WorkBench/HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py:3562-3631`
- Test: `C:/Users/HHI/AppData/Local/Temp/claude/C--Coding-WorkBench/0036da02-2ae3-4309-be07-4f947890871f/scratchpad/test_anchor_rbe_exclusion.py` (standalone, 기존 verify_*.py 방식)

- [ ] **Step 1: 실패하는 테스트 작성**

Create the test script (runtime nastran_bridge.py 를 직접 import):

```python
import importlib.util, os, sys

BRIDGE = r"C:/Coding/WorkBench/HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py"
spec = importlib.util.spec_from_file_location("nastran_bridge", BRIDGE)
nb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nb)

def make_model():
    # CoG=(0,0,0). node1=RBE independent(최근접), node3=RBE dependent, node2=순수 구조.
    return {
        "nodes": [
            {"id": 1, "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": 2, "x": 1.0, "y": 0.0, "z": 0.0},
            {"id": 3, "x": 5.0, "y": 0.0, "z": 0.0},
        ],
        "elements": [
            {"id": 1, "type": "CBEAM", "startNode": 1, "endNode": 2, "propertyId": 10},
            {"id": 2, "type": "CBEAM", "startNode": 2, "endNode": 3, "propertyId": 10},
        ],
        "properties": [{"id": 10, "kind": "TUBE", "dims": [50.0, 40.0]}],
        "rigids": [{"id": 1, "independentNode": 1, "dependentNodes": [3]}],
    }

def test_excludes_independent_rbe_node():
    nid, meta = nb._pick_anti_rigid_body_anchor(make_model(), (0.0, 0.0, 0.0), set())
    # node1(RBE indep, 최근접)·node3(RBE dep) 모두 제외 → node2 선택돼야 함
    assert nid == 2, f"expected 2, got {nid} (meta={meta})"
    assert meta["rbeIndependentExcludedCount"] == 1, meta
    assert meta["rigidDependentExcludedCount"] == 1, meta
    assert meta["rbeExclusionRelaxed"] is False, meta

def test_fallback_when_all_near_nodes_are_rbe():
    # 모든 후보가 RBE 연결 → 폴백(완화)로 최근접(node1) 선택
    model = {
        "nodes": [{"id": 1, "x": 0.0, "y": 0.0, "z": 0.0}, {"id": 2, "x": 1.0, "y": 0.0, "z": 0.0}],
        "elements": [{"id": 1, "type": "CBEAM", "startNode": 1, "endNode": 2, "propertyId": 10}],
        "properties": [{"id": 10, "kind": "TUBE", "dims": [50.0, 40.0]}],
        "rigids": [{"id": 1, "independentNode": 1, "dependentNodes": [2]}],
    }
    nid, meta = nb._pick_anti_rigid_body_anchor(model, (0.0, 0.0, 0.0), set())
    assert nid is not None, meta
    assert meta["rbeExclusionRelaxed"] is True, meta

if __name__ == "__main__":
    test_excludes_independent_rbe_node()
    test_fallback_when_all_near_nodes_are_rbe()
    print("OK: anchor RBE exclusion + fallback")
```

- [ ] **Step 2: 실패 확인**

Run: `python "C:/Users/HHI/AppData/Local/Temp/claude/C--Coding-WorkBench/0036da02-2ae3-4309-be07-4f947890871f/scratchpad/test_anchor_rbe_exclusion.py"`
Expected: FAIL — `AssertionError: expected 2, got 1` (현재 코드는 dependent 만 제외 → node1 선택) 또는 `KeyError: 'rbeIndependentExcludedCount'`.

- [ ] **Step 3: 구현 — RBE 제외 집합 확장 + 폴백**

In `nastran_bridge.py`, replace lines 3562-3586 (현재 `rigid_dependent_nodes` 수집 ~ `if not distances` 직전) 까지를 아래로 교체:

```python
    # RBE2/RBE3 의 independent + dependent 노드 모두 제외.
    #  - dependent: m-set 충돌(USER FATAL 2101) 방지(기존 동작)
    #  - independent: RBE 허브/하중 도입점에는 anchor 를 두지 않는다(사용자 요구)
    rbe_independent_nodes: set[int] = set()
    rbe_dependent_nodes: set[int] = set()
    for rigid in model.get("rigids", []) or []:
        ind = rigid.get("independentNode")
        if isinstance(ind, int):
            rbe_independent_nodes.add(ind)
        for nid in (rigid.get("dependentNodes", []) or []):
            if isinstance(nid, int):
                rbe_dependent_nodes.add(nid)
    rbe_nodes = rbe_independent_nodes | rbe_dependent_nodes

    cx, cy, cz = cog_xyz

    def _collect(exclude_rbe: bool) -> list[tuple[float, int, float, float, float]]:
        out: list[tuple[float, int, float, float, float]] = []
        for node in nodes:
            nid = as_int(node.get("id"))
            if nid is None or nid in excluded_node_ids:
                continue
            if has_pipe_classification and nid not in structural_node_ids:
                continue  # 배관 전용 노드 제외
            if exclude_rbe and nid in rbe_nodes:
                continue  # RBE 연결 노드 제외 (independent+dependent)
            nx = as_float(node.get("x")) or 0.0
            ny = as_float(node.get("y")) or 0.0
            nz = as_float(node.get("z")) or 0.0
            d = math.dist((nx, ny, nz), (cx, cy, cz))
            out.append((d, nid, nx, ny, nz))
        return out

    distances = _collect(exclude_rbe=True)
    rbe_exclusion_relaxed = False
    if not distances:
        # CoG 근처에 RBE-비연결 구조 노드가 없음 → 폴백: RBE 제외를 완화하고 최근접 구조 노드 사용.
        # (anchor 누락 시 강체운동 USER FATAL 9050 위험 방지)
        distances = _collect(exclude_rbe=False)
        rbe_exclusion_relaxed = True

    if not distances:
        return None, {"reason": "no-eligible-nodes"}
```

Then update the return-meta dict (현재 lines ~3623-3631) — `rigidDependentExcludedCount` 유지 + 2개 키 추가:

```python
    return best_nid, {
        "candidatePoolSize": len(candidates),
        "pipeFilterApplied": has_pipe_classification,
        "structuralNodeCount": len(structural_node_ids) if has_pipe_classification else None,
        "rigidDependentExcludedCount": len(rbe_dependent_nodes),
        "rbeIndependentExcludedCount": len(rbe_independent_nodes),
        "rbeExclusionRelaxed": rbe_exclusion_relaxed,
        "selectedDistanceMm": compact_number(best_dist) if best_nid is not None else None,
        "selectedMaxDimMm": compact_number(best_dim) if best_nid is not None and best_dim > 0 else None,
        "selectedNodeXyzMm": [compact_number(v) for v in best_xyz] if best_nid is not None else None,
    }
```

Also update the docstring rule (2) 의 "dependent 노드 제외" 를 "independent+dependent 노드 제외 (없으면 폴백)" 로 바꾼다.

- [ ] **Step 4: 통과 확인**

Run: `python "C:/Users/HHI/AppData/Local/Temp/claude/C--Coding-WorkBench/0036da02-2ae3-4309-be07-4f947890871f/scratchpad/test_anchor_rbe_exclusion.py"`
Expected: `OK: anchor RBE exclusion + fallback`

- [ ] **Step 5: WorkBenchSubModule 미러 확인**

Run: `ls "C:/Coding/WorkBenchSubModule/Nastran_bridge/nastran_bridge.py" 2>/dev/null && echo EXISTS || echo NONE`
- `EXISTS` 면 동일 변경을 그 파일에도 반영(버전 드리프트 방지). `NONE` 이면 InHouseProgram 본만 작업 대상.

- [ ] **Step 6: 커밋 없음 — 서버 교체 메모만**

`nastran_bridge.py` 는 git 미추적이라 커밋 대상 아님. 최종 보고에 **"서버(145) `InHouseProgram/NastranBridge/nastran_bridge.py` 수동 교체 + 백엔드 재시작"** 을 명시(직전 emptyPipeFluid 핸들러 미반영분과 함께 1회 교체 권장).

---

## Part B — Feature 2~4: 모델 회전 (프론트)

### Task 2: `geometry.js` — 순수 회전 수학 + 테스트

**Files:**
- Create: `FE/data/geometry.js`
- Test: `FE/data/geometry.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `FE/data/geometry.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { rotatePointAboutAxis, rotateDirectionAboutAxis, isValidAxis } from './geometry.js'

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

describe('geometry — 축 회전', () => {
  it('Z축 90°: (1,0,0) → (0,1,0)', () => {
    const [x, y, z] = rotatePointAboutAxis(1, 0, 0, 'Z', 90)
    expect(near(x, 0)).toBe(true)
    expect(near(y, 1)).toBe(true)
    expect(near(z, 0)).toBe(true)
  })

  it('X축 90° 방향벡터: (0,0,1) → (0,-1,0)', () => {
    const [x, y, z] = rotateDirectionAboutAxis(0, 0, 1, 'X', 90)
    expect(near(x, 0)).toBe(true)
    expect(near(y, -1)).toBe(true)
    expect(near(z, 0)).toBe(true)
  })

  it('pivot 기준 Z축 90°: pivot(1,1,0), 점(2,1,0) → (1,2,0)', () => {
    const [x, y, z] = rotatePointAboutAxis(2, 1, 0, 'Z', 90, { x: 1, y: 1, z: 0 })
    expect(near(x, 1)).toBe(true)
    expect(near(y, 2)).toBe(true)
    expect(near(z, 0)).toBe(true)
  })

  it('360° 회전은 원점 복귀(부동소수 허용)', () => {
    const [x, y, z] = rotatePointAboutAxis(3, -4, 5, 'Y', 360)
    expect(near(x, 3, 1e-6)).toBe(true)
    expect(near(y, -4, 1e-6)).toBe(true)
    expect(near(z, 5, 1e-6)).toBe(true)
  })

  it('isValidAxis', () => {
    expect(isValidAxis('X')).toBe(true)
    expect(isValidAxis('W')).toBe(false)
  })

  it('알 수 없는 축은 throw', () => {
    expect(() => rotatePointAboutAxis(1, 0, 0, 'W', 90)).toThrow()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- geometry`
Expected: FAIL — `Failed to resolve import "./geometry.js"`.

- [ ] **Step 3: 구현**

Create `FE/data/geometry.js`:

```js
/**
 * 표준축(X/Y/Z) 기준 강체 회전 수학. 오른손 좌표계, 양각 = CCW.
 * - 점: pivot 기준 회전 (translation 포함)
 * - 방향벡터: pivot 무시(순수 방향 회전) — CBEAM/CBAR orientation 벡터용
 */

const AXES = new Set(['X', 'Y', 'Z'])

export function isValidAxis(axis) {
  return AXES.has(axis)
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180
}

/**
 * 점 (x,y,z) 를 axis 중심·pivot 기준으로 angleDeg 회전.
 * @returns {[number, number, number]}
 */
export function rotatePointAboutAxis(x, y, z, axis, angleDeg, pivot = { x: 0, y: 0, z: 0 }) {
  if (!AXES.has(axis)) throw new Error(`알 수 없는 회전축: ${axis}`)
  const r = degToRad(angleDeg)
  const c = Math.cos(r)
  const s = Math.sin(r)
  const px = pivot?.x ?? 0, py = pivot?.y ?? 0, pz = pivot?.z ?? 0
  const dx = x - px, dy = y - py, dz = z - pz
  let rx = dx, ry = dy, rz = dz
  if (axis === 'X') {
    ry = dy * c - dz * s
    rz = dy * s + dz * c
  } else if (axis === 'Y') {
    rz = dz * c - dx * s
    rx = dz * s + dx * c
  } else { // 'Z'
    rx = dx * c - dy * s
    ry = dx * s + dy * c
  }
  return [rx + px, ry + py, rz + pz]
}

/**
 * 방향 벡터 (vx,vy,vz) 를 axis 중심으로 angleDeg 회전 (pivot 평행이동 없음).
 * @returns {[number, number, number]}
 */
export function rotateDirectionAboutAxis(vx, vy, vz, axis, angleDeg) {
  return rotatePointAboutAxis(vx, vy, vz, axis, angleDeg, { x: 0, y: 0, z: 0 })
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- geometry`
Expected: PASS (6 tests).

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/data/geometry.js apps/module-unit-studio/src/data/geometry.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
✨ feat: 표준축 회전 수학 모듈(geometry.js) 추가

점/방향벡터를 X/Y/Z 축·pivot 기준으로 회전하는 순수 함수 + 단위 테스트.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `StageData.applyRotation` — 노드+orientation 회전 + bbox/center 갱신

**Files:**
- Modify: `FE/data/StageData.js` (import 추가 + 메서드 추가)
- Test: `FE/data/geometry.test.js` (describe 블록 추가)

- [ ] **Step 1: 실패하는 테스트 작성 (geometry.test.js 끝에 추가)**

```js
import { StageData } from './StageData.js'

describe('StageData.applyRotation', () => {
  const makeStage = () => new StageData({
    meta: { phase: 'C', stageName: 'C', unit: 'mm', schemaVersion: '1.1' },
    nodes: [
      { id: 1, x: 0, y: 0, z: 0, tags: [] },
      { id: 2, x: 100, y: 0, z: 0, tags: [] },
    ],
    elements: [
      { id: 1, type: 'CBEAM', startNode: 1, endNode: 2, propertyId: 10, orientation: [0, 0, 1] },
    ],
    rigids: [], properties: [{ id: 10, kind: 'TUBE', dims: [50, 40] }],
    materials: [], pointMasses: [],
  })

  it('Z축 90°: node2 (100,0,0) → (0,100,0)', () => {
    const s = makeStage()
    const count = s.applyRotation('Z', 90, { x: 0, y: 0, z: 0 })
    expect(count).toBe(2)
    const n2 = s.nodeMap.get(2)
    expect(Math.abs(n2.x - 0) < 1e-6).toBe(true)
    expect(Math.abs(n2.y - 100) < 1e-6).toBe(true)
  })

  it('X축 90°: orientation [0,0,1] → [0,-1,0]', () => {
    const s = makeStage()
    s.applyRotation('X', 90, { x: 0, y: 0, z: 0 })
    const o = s.elements[0].orientation
    expect(Math.abs(o[0] - 0) < 1e-6).toBe(true)
    expect(Math.abs(o[1] - (-1)) < 1e-6).toBe(true)
    expect(Math.abs(o[2] - 0) < 1e-6).toBe(true)
  })

  it('회전 후 bbox/center 재계산', () => {
    const s = makeStage()
    s.applyRotation('Z', 90, { x: 0, y: 0, z: 0 })
    // (0,0,0)~(0,100,0) → center y = 50
    expect(Math.abs(s.center.y - 50) < 1e-6).toBe(true)
    expect(Math.abs(s.center.x - 0) < 1e-6).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- geometry`
Expected: FAIL — `s.applyRotation is not a function`.

- [ ] **Step 3: 구현 — import + 메서드**

In `FE/data/StageData.js`, line 1 아래에 import 추가:

```js
import { rotatePointAboutAxis, rotateDirectionAboutAxis } from './geometry.js'
```

In the `StageData` class (예: `getNodePos` 메서드 뒤, line ~113 다음)에 메서드 추가:

```js
  /**
   * 모델 전체를 axis(X/Y/Z) 중심·pivot 기준으로 angleDeg 회전한다 (in-place mutate).
   * - 모든 노드 좌표(mm) 회전
   * - 모든 CBEAM/CBAR orientation 벡터(방향) 회전 — 단면 방향/응력 일관 유지
   * - 좌표 의존 캐시(bbox/center) 재계산 (topology 캐시는 노드 ID 기반이라 유지)
   * @param {'X'|'Y'|'Z'} axis
   * @param {number} angleDeg
   * @param {{x:number,y:number,z:number}} pivot  회전 기준점(보통 CoG)
   * @returns {number} 회전한 노드 수
   */
  applyRotation(axis, angleDeg, pivot) {
    const p = pivot ?? this.center ?? { x: 0, y: 0, z: 0 }
    let count = 0
    for (const n of this.nodeMap.values()) {
      const [x, y, z] = rotatePointAboutAxis(n.x, n.y, n.z, axis, angleDeg, p)
      n.x = x; n.y = y; n.z = z
      count++
    }
    for (const e of this.elements ?? []) {
      if (Array.isArray(e.orientation) && e.orientation.length === 3) {
        const [vx, vy, vz] = rotateDirectionAboutAxis(e.orientation[0], e.orientation[1], e.orientation[2], axis, angleDeg)
        e.orientation = [vx, vy, vz]
      }
    }
    // 좌표 의존 파생값 갱신 (getNodePos 가 center 를 사용하므로 회전 후 반드시 재계산)
    this.bbox = this._computeBbox([...this.nodeMap.values()])
    this.center = {
      x: (this.bbox.minX + this.bbox.maxX) / 2,
      y: (this.bbox.minY + this.bbox.maxY) / 2,
      z: (this.bbox.minZ + this.bbox.maxZ) / 2,
    }
    return count
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- geometry`
Expected: PASS (9 tests).

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/data/StageData.js apps/module-unit-studio/src/data/geometry.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
✨ feat: StageData.applyRotation — 노드+빔 orientation 회전 + bbox 갱신

모델 전체를 축·pivot 기준 회전하고 좌표 의존 파생값(bbox/center)을 재계산.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `EditIntent.js` — `rotateModel` kind/검증/요약 + 테스트

**Files:**
- Modify: `FE/data/EditIntent.js:23,55-73,240-277` (VALID_KINDS / dispatch / summarize + 신규 validate 함수)
- Test: `FE/data/EditIntent.test.js`

- [ ] **Step 1: 실패하는 테스트 작성 (EditIntent.test.js 에 describe 추가)**

```js
import { createIntent, validateIntent, summarizeIntent } from './EditIntent.js'

describe('rotateModel intent', () => {
  it('정상 파라미터 검증 통과', () => {
    const d = createIntent('rotateModel', { axis: 'Z', angleDeg: 45 })
    const v = validateIntent(d, null, [])
    expect(v.status).toBe('ok')
  })

  it('잘못된 축은 error', () => {
    const d = createIntent('rotateModel', { axis: 'W', angleDeg: 45 })
    const v = validateIntent(d, null, [])
    expect(v.status).toBe('error')
  })

  it('비수치 각도는 error', () => {
    const d = createIntent('rotateModel', { axis: 'X', angleDeg: 'abc' })
    const v = validateIntent(d, null, [])
    expect(v.status).toBe('error')
  })

  it('누적 허용 — 같은 kind 두 번이어도 error 아님', () => {
    const first = createIntent('rotateModel', { axis: 'Z', angleDeg: 10 })
    const second = createIntent('rotateModel', { axis: 'Z', angleDeg: 20 })
    const v = validateIntent(second, null, [first])
    expect(v.status).toBe('ok')
  })

  it('summarizeIntent 라벨', () => {
    const d = createIntent('rotateModel', { axis: 'Y', angleDeg: 30 })
    expect(summarizeIntent(d)).toBe('모델 회전 (Y축 30°)')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- EditIntent`
Expected: FAIL — `Unknown EditIntent kind: rotateModel` (createIntent throw).

- [ ] **Step 3: 구현**

(a) `EditIntent.js:23` VALID_KINDS 에 `'rotateModel'` 추가:

```js
const VALID_KINDS = new Set(['addRigid', 'deleteGroup', 'deleteElement', 'deleteCategory', 'deleteOrphanNodes', 'emptyPipeFluid', 'rotateModel'])
```

(b) `validateIntent` dispatch (line ~69 `emptyPipeFluid` 분기 뒤)에 추가:

```js
  } else if (intent.kind === 'rotateModel') {
    validateRotateModel(intent.params, stageData, existingIntents, errors, warnings)
```

(c) `summarizeIntent` (line ~272 emptyPipeFluid 블록 뒤)에 추가:

```js
  if (intent.kind === 'rotateModel') {
    const { axis, angleDeg } = intent.params ?? {}
    return `모델 회전 (${axis}축 ${angleDeg}°)`
  }
```

(d) 신규 검증 함수 (파일 하단 `validateEmptyPipeFluid` 뒤)에 추가:

```js
function validateRotateModel(params, stageData, existingIntents, errors, warnings) {
  const axis = params?.axis
  const angleDeg = params?.angleDeg
  if (axis !== 'X' && axis !== 'Y' && axis !== 'Z') {
    errors.push(`회전축이 X/Y/Z 가 아닙니다: ${axis}`)
  }
  if (typeof angleDeg !== 'number' || !Number.isFinite(angleDeg)) {
    errors.push('회전 각도(angleDeg) 가 유한한 숫자가 아닙니다.')
  }
  // 누적 회전 허용 — 같은 kind 중복은 막지 않는다.
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- EditIntent`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/data/EditIntent.js apps/module-unit-studio/src/data/EditIntent.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
✨ feat: rotateModel edit intent (axis/angleDeg) 추가

VALID_KINDS·검증(axis∈X/Y/Z, 유한 각도)·요약 라벨. 누적 허용.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `useStageStore.rotateModel` 액션 + `modelRotated` 플래그 + 무효화

**Files:**
- Modify: `FE/store/useStageStore.js` (state 추가 + reset/loadStages 초기화 + rotateModel 액션)
- Test: `FE/store/useStageStore.test.js`

- [ ] **Step 1: 실패하는 테스트 작성 (useStageStore.test.js 에 describe 추가)**

기존 import 에 StageData 추가(파일 상단): `import { StageData } from '../data/StageData.js'`

```js
describe('useStageStore.rotateModel', () => {
  const makeStageData = () => new StageData({
    meta: { phase: 'C', stageName: 'C', unit: 'mm', schemaVersion: '1.1' },
    nodes: [{ id: 1, x: 0, y: 0, z: 0, tags: [] }, { id: 2, x: 100, y: 0, z: 0, tags: [] }],
    elements: [{ id: 1, type: 'CBEAM', startNode: 1, endNode: 2, propertyId: 10, orientation: [0, 0, 1] }],
    rigids: [], properties: [{ id: 10, kind: 'TUBE', dims: [50, 40] }], materials: [], pointMasses: [],
  })

  beforeEach(() => {
    useStageStore.setState({ stages: [], pipeFluidEmptied: false, modelRotated: false })
    useStabilityStore.getState().reset()
    useUnitStructuralStore.getState().reset()
  })

  it('기본 modelRotated 는 false', () => {
    expect(useStageStore.getState().modelRotated).toBe(false)
  })

  it('Z축 90° 회전: node2 → (0,100,0), modelRotated=true', () => {
    const s = makeStageData()
    useStageStore.setState({ stages: [s] })
    const r = useStageStore.getState().rotateModel({ axis: 'Z', angleDeg: 90, pivot: { x: 0, y: 0, z: 0 } })
    expect(r.changedNodeCount).toBe(2)
    const n2 = s.nodeMap.get(2)
    expect(Math.abs(n2.x) < 1e-6).toBe(true)
    expect(Math.abs(n2.y - 100) < 1e-6).toBe(true)
    expect(useStageStore.getState().modelRotated).toBe(true)
  })

  it('회전 시 기존 자세안정성/구조해석 결과 무효화', () => {
    const s = makeStageData()
    useStageStore.setState({ stages: [s] })
    useStabilityStore.setState({ report: { stages: [] }, stabilityPath: '/x', overallStatus: 'pass' })
    useUnitStructuralStore.setState({ status: 'Success', result: { ok: 1 } })
    const r = useStageStore.getState().rotateModel({ axis: 'X', angleDeg: 30, pivot: { x: 0, y: 0, z: 0 } })
    expect(r.invalidatedStability).toBe(true)
    expect(useStabilityStore.getState().report).toBe(null)
    expect(useUnitStructuralStore.getState().status).toBe(null)
  })

  it('stages 비면 no-op', () => {
    const r = useStageStore.getState().rotateModel({ axis: 'Z', angleDeg: 90 })
    expect(r.changedNodeCount).toBe(0)
    expect(useStageStore.getState().modelRotated).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- useStageStore`
Expected: FAIL — `rotateModel is not a function`.

- [ ] **Step 3: 구현**

(a) `useStageStore.js` initial state (line ~15 `pipeFluidEmptied: false,` 뒤)에 추가:

```js
  // 모델 회전 적용 여부 (누적). 새 폴더 로드/reset 시 false. stale stageSummary 게이트에 사용.
  modelRotated: false,
```

(b) `reset()` (line 28) 에 `modelRotated: false` 추가:

```js
  reset: () => set({ stages: [], inputAudit: null, stageSummary: null, loading: false, error: null, loadSummary: emptyLoadSummary(), sourceFolderRef: null, pipeFluidEmptied: false, modelRotated: false }),
```

(c) `loadStages` 성공 set (line 38) 에 `modelRotated: false` 추가:

```js
      set({ stages, inputAudit, stageSummary, loading: false, loadSummary: summary, pipeFluidEmptied: false, modelRotated: false })
```

(d) `emptyPipeFluid` 액션 뒤(line ~81 닫는 `},` 다음)에 `rotateModel` 추가:

```js
  /**
   * 모델 전체를 axis(X/Y/Z) 중심으로 angleDeg 회전한다 (누적, in-place).
   * - pivot 미지정 시 최종 stage 의 bbox center 로 폴백 (호출자 Sidebar 가 CoG 를 전달).
   * - 모든 stage 를 같은 pivot 으로 회전해 phase 간 정합 유지.
   * - 회전으로 형상이 바뀌므로 기존 자세안정성/구조해석 결과는 무효화(재평가 강제).
   * @param {{axis:'X'|'Y'|'Z', angleDeg:number, pivot?:{x,y,z}}} arg
   * @returns {{ axis, angleDeg, changedNodeCount, invalidatedStability }}
   */
  rotateModel: ({ axis, angleDeg, pivot = null }) => {
    const stages = useStageStore.getState().stages
    if (!Array.isArray(stages) || stages.length === 0) {
      return { axis, angleDeg, changedNodeCount: 0, invalidatedStability: false }
    }
    const last = stages[stages.length - 1]
    const p = pivot ?? last.center ?? { x: 0, y: 0, z: 0 }
    let changedNodeCount = 0
    for (const st of stages) {
      if (typeof st.applyRotation === 'function') {
        changedNodeCount += st.applyRotation(axis, angleDeg, p)
      }
    }
    set({ stages: [...stages], modelRotated: true })

    let invalidatedStability = false
    const stab = useStabilityStore.getState()
    if (stab.report || stab.stabilityPath || stab.overallStatus) {
      stab.reset()
      invalidatedStability = true
    }
    const us = useUnitStructuralStore.getState()
    if (us.status || us.result) us.reset()

    return { axis, angleDeg, changedNodeCount, invalidatedStability }
  },
```

(`useStabilityStore`·`useUnitStructuralStore` 는 useStageStore.js 상단에 이미 import 되어 있음 — 추가 import 불필요.)

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- useStageStore`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/store/useStageStore.js apps/module-unit-studio/src/store/useStageStore.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
✨ feat: useStageStore.rotateModel — 누적 회전 + 결과 무효화

modelRotated 플래그 + 모든 stage 를 CoG pivot 기준 회전, 기존 자세안정성/
구조해석 결과 무효화(재평가 강제).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `buildPostureStabilityPayload` stale 게이트에 `modelRotated` 추가

**Files:**
- Modify: `FE/store/useEditStore.js:821`
- Test: `FE/store/useEditStore.test.js`

- [ ] **Step 1: 실패하는 테스트 작성 (useEditStore.test.js 에 추가)**

기존 `buildPostureStabilityPayload` describe 블록 근처에 추가(import 에 `buildPostureStabilityPayload` 이미 포함됨):

```js
describe('buildPostureStabilityPayload — 모델 회전 시 stageSummary 무시', () => {
  it('modelRotated=true 면 stageSummary 무시하고 재계산 CoG 사용', () => {
    const stage = new StageData({
      meta: { phase: 'C', stageName: 'C', unit: 'mm', schemaVersion: '1.1' },
      nodes: [{ id: 1, x: 100, y: 0, z: 0, tags: [] }],
      elements: [], rigids: [], properties: [], materials: [],
      pointMasses: [{ id: 1, nodeId: 1, mass: 2 }],
    })
    // stale stageSummary (CoG=9999) 가 있어도 회전 후엔 무시되어야 함
    useStageStore.setState({
      stages: [stage], pipeFluidEmptied: false, modelRotated: true,
      stageSummary: { massProperties: { totalMassTon: 5, centerOfGravityMm: { x: 9999, y: 9999, z: 9999 } } },
    })
    const hoisting = { mode: 'wire', groupCount: 0, groups: [] }
    const payload = buildPostureStabilityPayload({}, hoisting, stage, null)
    expect(payload.model.centerOfGravityMm.x).toBe(100) // pointMass 위치 = 재계산 CoG
    expect(payload.model.massSource).not.toBe('stageSummary')
  })

  it('modelRotated=false 면 stageSummary CoG 사용(기존)', () => {
    const stage = new StageData({
      meta: { phase: 'C', stageName: 'C', unit: 'mm', schemaVersion: '1.1' },
      nodes: [{ id: 1, x: 100, y: 0, z: 0, tags: [] }],
      elements: [], rigids: [], properties: [], materials: [],
      pointMasses: [{ id: 1, nodeId: 1, mass: 2 }],
    })
    useStageStore.setState({
      stages: [stage], pipeFluidEmptied: false, modelRotated: false,
      stageSummary: { massProperties: { totalMassTon: 5, centerOfGravityMm: { x: 9999, y: 9999, z: 9999 } } },
    })
    const hoisting = { mode: 'wire', groupCount: 0, groups: [] }
    const payload = buildPostureStabilityPayload({}, hoisting, stage, null)
    expect(payload.model.centerOfGravityMm.x).toBe(9999)
    expect(payload.model.massSource).toBe('stageSummary')
  })
})
```

(파일 상단 import 에 `StageData` 필요 — 기존 useEditStore.test.js 에 이미 `import { StageData } from '../data/StageData.js'` 있음. 없으면 추가.)

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- useEditStore`
Expected: FAIL — 첫 테스트에서 `centerOfGravityMm.x` 가 9999 (modelRotated 게이트 없음).

- [ ] **Step 3: 구현**

`FE/store/useEditStore.js:821` 한 줄 변경:

```js
  const summary = (stageState.pipeFluidEmptied || stageState.modelRotated) ? null : stageState.stageSummary
```

그리고 line 817-819 의 주석에 회전 사유 한 줄 보완:

```js
  // ★ 배관 유체 비움(pipeFluidEmptied) 또는 모델 회전(modelRotated) 시 stageSummary 는
  //    회전/유체 전 상태로 계산된 stale 값이므로 무시하고 computeMassFallback 으로 재계산한다.
```

- [ ] **Step 4: 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test -- useEditStore`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/store/useEditStore.js apps/module-unit-studio/src/store/useEditStore.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
🐛 fix: 모델 회전 시 posture CoG stale 수정 (modelRotated 게이트)

buildPostureStabilityPayload 가 회전 후 옛 stageSummary CoG 대신 재계산
CoG 를 쓰도록 게이트에 modelRotated 추가.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `RotateModelDialog.jsx` 신규 입력 다이얼로그

**Files:**
- Create: `FE/components/RotateModelDialog.jsx`

- [ ] **Step 1: 구현 (UI 컴포넌트 — 단위 테스트 대신 Task 9 통합 + 수동 확인)**

Create `FE/components/RotateModelDialog.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { useStageStore } from '../store/useStageStore.js'
import { useEditStore, computeMassFallback } from '../store/useEditStore.js'

/**
 * 모델 회전 다이얼로그 — 축(X/Y/Z) + 각도(deg) 입력 → CoG 피벗 기준 회전.
 *  props.onClose()        : 닫기
 *  props.onApplied(result): 회전 적용 후 결과 전달 ({axis, angleDeg, changedNodeCount, invalidatedStability})
 */
export default function RotateModelDialog({ onClose, onApplied }) {
  const [axis, setAxis] = useState('Z')
  const [angleText, setAngleText] = useState('90')

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose?.() }
  }, [onClose])
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const angleDeg = Number(angleText)
  const angleValid = angleText.trim() !== '' && Number.isFinite(angleDeg)
  const hasError = !angleValid

  const handleApply = () => {
    if (hasError) return
    const stages = useStageStore.getState().stages
    if (!stages.length) { onClose?.(); return }
    const last = stages[stages.length - 1]
    const pivot = computeMassFallback(last)?.centerOfGravityMm ?? null
    const result = useStageStore.getState().rotateModel({ axis, angleDeg, pivot })
    useEditStore.getState().addIntent({ kind: 'rotateModel', params: { axis, angleDeg } })
    onApplied?.(result)
    onClose?.()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 360, maxWidth: '90vw',
          background: '#0d0d22', border: '1px solid rgba(255, 184, 0, 0.45)',
          borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 12,
          boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#FFB800', letterSpacing: 1.4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={13} /> 모델 회전
          </div>
          <button onClick={onClose} title="닫기"
            style={{ background: 'transparent', border: 'none', color: '#7070a0', cursor: 'pointer', padding: 2 }}>
            <X size={14} />
          </button>
        </div>

        <Section title="회전 축">
          <div style={{ display: 'flex', gap: 6 }}>
            {['X', 'Y', 'Z'].map(a => (
              <label key={a} style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '6px 8px', cursor: 'pointer',
                background: a === axis ? 'rgba(255,184,0,0.18)' : '#0f0f22',
                border: `1px solid ${a === axis ? 'rgba(255,184,0,0.6)' : '#2e2e50'}`,
                borderRadius: 5, fontSize: 12, color: '#cad8e8', fontWeight: 700,
              }}>
                <input type="radio" name="rot-axis" checked={a === axis} onChange={() => setAxis(a)} />
                {a}축
              </label>
            ))}
          </div>
        </Section>

        <Section title="회전 각도 (°)">
          <input type="number" value={angleText} onChange={e => setAngleText(e.target.value)} step="1" placeholder="90"
            style={inputStyle} />
          <div style={{ fontSize: 9, color: '#7a8aaa' }}>
            무게중심(CoG) 기준으로 회전합니다. 회전은 누적되며 되돌리려면 모델을 다시 로드하세요.
          </div>
        </Section>

        {hasError && (
          <div style={{
            border: '1px solid #FF8866', background: 'rgba(255,136,102,0.08)',
            borderRadius: 5, padding: '6px 9px', fontSize: 10, color: '#FFB3A8',
          }}>
            ⛔ 회전 각도를 숫자로 입력하세요.
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelBtnStyle}>취소</button>
          <button
            onClick={handleApply}
            disabled={hasError}
            style={{
              ...applyBtnStyle,
              background: hasError ? '#3a2a1a' : '#FFB80022',
              color:      hasError ? '#5a5a80' : '#FFE8A0',
              borderColor: hasError ? '#3a3a50' : 'rgba(255,184,0,0.6)',
              cursor: hasError ? 'not-allowed' : 'pointer',
            }}
          >
            <RotateCcw size={12} /> 회전 적용
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', background: '#0f0f22', color: '#e0e0e0',
  border: '1px solid #2e2e50', borderRadius: 4, padding: '5px 8px',
  fontSize: 11, fontFamily: 'monospace',
}
const cancelBtnStyle = {
  background: 'transparent', color: '#7070a0', border: '1px solid #2e2e50',
  borderRadius: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
}
const applyBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 5, border: '1px solid',
  borderRadius: 5, padding: '5px 12px', fontSize: 11, fontWeight: 700,
}

function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: 9, color: '#7ab2d4', letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 800 }}>
        {title}
      </div>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: 빌드로 구문 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run build`
Expected: 빌드 성공 (RotateModelDialog 구문 오류 없음). 아직 미사용 경고는 무방.

- [ ] **Step 3: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/components/RotateModelDialog.jsx
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
✨ feat: RotateModelDialog — 축(X/Y/Z)+각도 입력 회전 다이얼로그

CoG 피벗 기준 회전. rotateModel 호출 + rotateModel intent 기록.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `Sidebar.jsx` — "모델 회전" 버튼 + 다이얼로그 마운트 + 회전 후 안내

**Files:**
- Modify: `FE/components/Sidebar.jsx` (import, state, 버튼, 다이얼로그, 안내)

- [ ] **Step 1: 구현**

(a) import 추가 (line 10 `import { collectPipeMaterialIds, ... }` 뒤):

```js
import RotateModelDialog from './RotateModelDialog.jsx'
```

(b) state 추가 (line 70 `const [emptyResult, setEmptyResult] = useState(null)` 뒤):

```js
  const [showRotateDialog, setShowRotateDialog] = useState(false)
  const [rotateResult, setRotateResult] = useState(null) // { axis, angleDeg, changedNodeCount, invalidatedStability }
```

(c) "모델 조작" Section 안, 기존 "Pipe 내부 유체 비우기" 버튼 블록 **바로 아래**에 회전 버튼 추가(아래 JSX 를 해당 Section 내부에 삽입 — `lastStage` 가 있을 때만 활성):

```jsx
          <Tooltip text="모델을 X/Y/Z 축 중심(무게중심 기준)으로 회전합니다. 회전된 모델로 자세안정성·구조해석·BDF 출력이 모두 수행됩니다.">
            <button
              onClick={() => setShowRotateDialog(true)}
              disabled={!lastStage}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 10px', marginTop: 6,
                background: lastStage ? '#12122c' : '#0c0c1c',
                border: '1px solid #2e2e50', borderRadius: 6,
                color: lastStage ? '#cad8e8' : '#54546e',
                fontSize: 11, fontWeight: 700, cursor: lastStage ? 'pointer' : 'not-allowed',
              }}
            >
              <RotateCcw size={13} /> 모델 회전
            </button>
          </Tooltip>
          {rotateResult && (
            <div style={{ fontSize: 10, color: '#9fd0ff', marginTop: 4, lineHeight: 1.4 }}>
              ↻ {rotateResult.axis}축 {rotateResult.angleDeg}° 회전 적용 ({rotateResult.changedNodeCount} 노드)
            </div>
          )}
          {rotateResult?.invalidatedStability && (
            <div style={{ fontSize: 10, color: '#ffcc66', marginTop: 2, lineHeight: 1.4 }}>
              ⚠ 형상이 바뀌어 자세안정성/구조해석 결과를 초기화했습니다. 자세안정성 평가를 다시 실행하세요.
            </div>
          )}
```

(`RotateCcw` 는 line 2 lucide-react import 에 이미 포함됨.)

(d) 다이얼로그 마운트 — 컴포넌트 return 의 최상위 래퍼 끝부분(다른 오버레이/마지막 `</...>` 직전)에 추가:

```jsx
      {showRotateDialog && (
        <RotateModelDialog
          onClose={() => setShowRotateDialog(false)}
          onApplied={setRotateResult}
        />
      )}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run build`
Expected: 빌드 성공.

- [ ] **Step 3: 전체 테스트 확인 (회귀 없음)**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run test`
Expected: 모든 테스트 PASS (기존 230 + 신규 추가분).

- [ ] **Step 4: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/components/Sidebar.jsx
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
✨ feat: Sidebar 에 '모델 회전' 버튼 + 회전 후 재평가 안내

모델 조작 섹션에 회전 다이얼로그 트리거 + 회전 결과/자세안정성 초기화 안내.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 수동 검증 (npm run dev) — 회전 일관성 확인

**Files:** 없음 (실행 검증)

- [ ] **Step 1: dev 서버 실행 후 시나리오 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run dev`
확인 항목:
1. Model 모드 → "모델 회전" → Z축 90° 적용 → 3D 뷰가 회전된다(노드/빔/orientation).
2. 회전 후 "자세안정성 초기화" 안내가 뜨고, 기존 자세안정성/구조 결과 dock 이 사라진다.
3. 자세안정성 재평가 실행 → CoG 마커가 회전된 형상에 맞다.
4. 구조해석 실행 → 회전된 모델로 돌고, anchor SPC 가 회전된 CoG 근처(RBE 제외)에 잡힌다.
5. BDF 출력 → GRID 좌표가 회전 반영된다.

(자동화 불가한 통합 확인 — 문제 발견 시 해당 Task 로 회귀.)

---

### Task 10: 배포 (사용자 명시 승인 후에만)

**Files:**
- Modify: `FE/../package.json` (version)

- [ ] **Step 1: 사용자에게 배포 승인 요청** — "0.0.56 으로 빌드/배포할까요?" 확인 전까지 진행 금지.

- [ ] **Step 2: 버전 bump**

`apps/module-unit-studio/package.json` version `0.0.55` → `0.0.56`.

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/package.json
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
🔖 release: Module Unit Studio 0.0.56

RBE 인지 anchor(백엔드) + 모델 회전(축/각도, CoG 피벗) 기능.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: 패키지 빌드**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run package`
Expected: `release/module-unit-studio-0.0.56.zip` + `.sha256` 생성.

- [ ] **Step 4: 양쪽 StudioProgram 복사 (한글·대괄호 → LiteralPath)**

PowerShell:
```powershell
$src = "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio/release"
Copy-Item -LiteralPath "$src/module-unit-studio-0.0.56.zip" -Destination "C:/Coding/WorkBench/HiTessWorkBenchBackEnd/StudioProgram/" -Force
Copy-Item -LiteralPath "$src/module-unit-studio-0.0.56.zip.sha256" -Destination "C:/Coding/WorkBench/HiTessWorkBenchBackEnd/StudioProgram/" -Force
Copy-Item -LiteralPath "$src/module-unit-studio-0.0.56.zip" -Destination '\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram' -Force
Copy-Item -LiteralPath "$src/module-unit-studio-0.0.56.zip.sha256" -Destination '\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram' -Force
```

- [ ] **Step 5: 양쪽 크기/존재 검증** — 로컬·UNC 의 zip 크기(byte) 동일 + .sha256 존재 확인.

---

## 자기 검토(작성자) 결과

- **스펙 커버리지:** Feature 1(anchor RBE 제외+폴백)=Task 1. 회전 수학=Task 2. geometry 변환+orientation+bbox=Task 3. intent=Task 4. store 액션+modelRotated+무효화=Task 5. posture stale 게이트=Task 6. UI 다이얼로그=Task 7. 리본 버튼/안내=Task 8. 일관성 수동검증=Task 9. 배포=Task 10. (스펙 §5.3 의 `applyEditIntents.js` 명시 무시 → 실제로 unknown kind 자연 무시 확인되어 **변경 불필요**, 별도 Task 제거.)
- **플레이스홀더:** 없음(모든 코드 블록 실제 코드).
- **타입/시그니처 일관성:** `rotateModel({axis, angleDeg, pivot})`, `applyRotation(axis, angleDeg, pivot)`, `rotatePointAboutAxis(x,y,z,axis,angleDeg,pivot)`, `centerOfGravityMm:{x,y,z}` — Task 2/3/5/7 간 일치. `modelRotated` 플래그명 Task 5/6 일치.
- **검증 게이트(스펙 §8):** OFFT basic 가정·CoG 일관·BDF 경유 경로는 Task 9 수동검증에서 실측 확인.

## 배포/서버 영향 요약

- **프론트(Task 2~8,10):** ModuleUnitStudio 레포 커밋 + 0.0.56 zip 양쪽 StudioProgram 복사. 팀 서버(145) 사용자는 서버 StudioProgram 에 수동 복사 필요.
- **백엔드(Task 1):** `nastran_bridge.py` git 미추적 → **서버(145) `InHouseProgram/NastranBridge/nastran_bridge.py` 수동 교체 + 백엔드 재시작 필수**(직전 emptyPipeFluid 핸들러 미반영분과 함께 1회 교체 권장).
