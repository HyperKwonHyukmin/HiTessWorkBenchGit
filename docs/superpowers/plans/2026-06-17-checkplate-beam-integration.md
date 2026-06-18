# Check Plate ↔ 1D Beam 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check Plate(2D shell)를 측면 보강빔과는 노드 분할로 공유하고, ~12mm 아래 하부 지지빔과는 RBE2 강체 스티치로 연결한다.

**Architecture:** 통합 변환은 두 materialize 경로(스튜디오 `bdfExport.js` JS / 백엔드 `nastran_bridge.py` Python)에 동일 알고리즘으로 들어간다. JS는 순수 모듈 `beamIntegrate.js` 신설, Python은 기존 `add_checkplate_mesh`를 in-plane/offset 분리로 고친다. `gridDetect.js ↔ resolve_grid_lines` 미러 패턴을 따른다.

**Tech Stack:** React 19 / Three.js / Zustand 스튜디오 + Vitest 4. Python 3.14 `nastran_bridge.py` + pytest. 검증 기준 파일 `C:\Coding\WorkBenchSubModule\SidePassage\RawBdf\studioResult.bdf`.

**Spec:** `docs/superpowers/specs/2026-06-17-checkplate-beam-integration-design.md`

---

## 사전 사실 (실측, 구현 시 그대로 사용)

studioResult.bdf(free-field, GRID `id,,X,Y,Z`):
```
CBAR,2913,10,1896,200,0.0,0.0,-1.0            # 측면빔(Problem A)
GRID,200 ,, 114295.0, 14887.0, 30272.0
GRID,2747,, 114383.0, 14887.0, 30272.0        # 빔 위 내부점(미공유)
GRID,1896,, 114470.0, 14887.0, 30272.0
CBAR,2800,8,1814,125,0.0,0.0,-1.0             # 지지빔(Problem B)
GRID,1814,, 113830.0, 15191.6, 30260.0        # Z=30260 (plate Z=30272 → 12mm 아래)
GRID,125 ,, 113830.0, 15364.3, 30260.0
```

핵심 사실:
- 스튜디오 `bdfExport.buildBdf`는 `stage.elements`의 `type==='BEAM'`만 CBAR로 emit하고 **빔 분할/RBE2를 안 함** → 미분할 원인.
- 스튜디오 export는 **현재 미리보기 plate 1장**(`getCheckPlateMeshForExport`)만 다룬다.
- 백엔드 `split_beams_on_grid`는 plate 격자 교차에서 분할 → 백엔드 plate 노드=격자 교차이므로 **Problem A는 이미 처리**(확인용 테스트로 lock-in).
- 백엔드 `add_checkplate_mesh`의 `z_tol=max(tol,50)`은 12mm 지지빔까지 `support_ids`에 넣어 **plate z로 끌어올려 분할** → Problem B 왜곡 버그(고쳐야 함).
- 백엔드 RBE2 = `data['rigids']`에 `{id, independentNode, dependentNodes[], cm}` append → `convert_json_to_bdf`(1526–1529)가 `rbe2_fixed_lines`로 emit. dedup 패턴은 2335–2340 참고.

---

## File Structure

| 파일 | 책임 | Phase |
|------|------|-------|
| `apps/side-passage-studio/src/data/beamIntegrate.js` (**신규**) | 순수 함수 `integrateBeams` — 빔 분할 + RBE2 계산 | 1,2 |
| `apps/side-passage-studio/src/data/beamIntegrate.test.js` (**신규**) | vitest | 1,2 |
| `apps/side-passage-studio/src/data/bdfExport.js` | mesh gid 할당 후 `integrateBeams` 호출, 분할 CBAR + RBE2 + 신규 GRID emit | 1,2 |
| `apps/side-passage-studio/src/data/bdfExport.test.js` | 통합 회귀 | 1,2 |
| `WorkBenchSubModule/Nastran_bridge/nastran_bridge.py` | `add_checkplate_mesh` in-plane/offset 분리 + `stitch_support_beam` | 1,2 |
| `WorkBenchSubModule/Nastran_bridge/tests/test_beam_integration.py` (**신규**) | pytest | 1,2 |
| `HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py` | 위 소스의 **미러**(동시 갱신) | 2 |

모든 경로 base: 스튜디오 `C:\Coding\WorkBenchSubModule\SidePassageStudio\`, 백엔드 `C:\Coding\WorkBenchSubModule\Nastran_bridge\`.

`integrateBeams` 계약(후속 task가 의존 — 시그니처 고정):
```js
/**
 * @param {{
 *   beams: Array<{eid:number,pid:number,startNode:number,endNode:number,a:{x,y,z},b:{x,y,z}}>,
 *   plateNodes: Array<{gid:number,x:number,y:number,z:number}>,   // 해결된 GRID id, plate z
 *   startNodeId: number,                                          // 신규 노드 채번 시작
 *   opts?: {splitTolMm?:number, planeTolMm?:number, offsetBandMm?:number, rbe2Cm?:string}
 * }} arg
 * @returns {{
 *   splits: Map<number, number[]>,                 // eid -> 정렬된 내부 분할 노드 gid 목록(ga..gb 사이)
 *   rbe2: Array<{indep:number, dep:number, cm:string}>,
 *   newNodes: Array<{gid:number,x:number,y:number,z:number}>,  // 지지빔 z 에 생성한 스티치 분할점
 *   nextNodeId: number
 * }}
 */
```

---

# PHASE 1 — 측면빔 분할 (Problem A)

## Task 1: `integrateBeams` (분할만)

**Files:**
- Create: `apps/side-passage-studio/src/data/beamIntegrate.js`
- Test: `apps/side-passage-studio/src/data/beamIntegrate.test.js`

- [ ] **Step 1: 실패 테스트 작성** (`beamIntegrate.test.js`)

```js
import { describe, it, expect } from 'vitest'
import { integrateBeams } from './beamIntegrate.js'

const Z = 30272
// 측면빔 1896→200, 그 사이 plate 내부점 2747
const beams = [{ eid: 2913, pid: 10, startNode: 1896, endNode: 200,
  a: { x: 114470, y: 14887, z: Z }, b: { x: 114295, y: 14887, z: Z } }]
const plateNodes = [
  { gid: 1896, x: 114470, y: 14887, z: Z },
  { gid: 2747, x: 114383, y: 14887, z: Z },
  { gid: 200,  x: 114295, y: 14887, z: Z },
  { gid: 2746, x: 114383, y: 14776.4, z: Z }, // 빔 밖(경계 아래) — 분할 금지
]

describe('integrateBeams — Problem A (측면빔 분할)', () => {
  it('빔 위 내부 plate 노드에서 분할한다', () => {
    const r = integrateBeams({ beams, plateNodes, startNodeId: 9000 })
    expect(r.splits.get(2913)).toEqual([2747])     // 내부점 1개
    expect(r.rbe2).toEqual([])                       // Phase1: RBE2 없음
    expect(r.newNodes).toEqual([])                   // 새 노드 없음(기존 plate 노드 사용)
  })
  it('빔 끝점/빔 밖 노드는 분할하지 않는다(멱등)', () => {
    const r = integrateBeams({ beams, plateNodes, startNodeId: 9000 })
    const r2 = integrateBeams({ beams, plateNodes, startNodeId: 9000 })
    expect(r.splits.get(2913)).toEqual(r2.splits.get(2913))   // 멱등
    expect(r.splits.get(2913)).not.toContain(1896)            // 끝점 제외
    expect(r.splits.get(2913)).not.toContain(2746)            // 빔 밖 제외
  })
  it('빔 위 내부점이 없으면 splits 에 항목이 없다', () => {
    const r = integrateBeams({ beams: [{ ...beams[0], eid: 5 }],
      plateNodes: [{ gid: 2746, x: 114383, y: 14776.4, z: Z }], startNodeId: 9000 })
    expect(r.splits.has(5)).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/side-passage-studio && npx vitest run src/data/beamIntegrate.test.js`
Expected: FAIL — `integrateBeams is not a function`.

- [ ] **Step 3: 구현** (`beamIntegrate.js`)

```js
/**
 * beamIntegrate — Check Plate mesh 와 1D beam 의 통합(분할 + RBE2)을 계산하는 순수 함수.
 * 좌표 mm. 수평 데크 가정(offset 방향 = -Z). 백엔드 add_checkplate_mesh 와 동작 미러.
 */

const dist3 = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)

/** 점 P 가 선분 A-B 의 내부에 공선으로 놓이는지. 반환 {t, perp, dzAtT} 또는 null. */
function projectOnBeam(P, A, B, splitTolMm) {
  const ax = B.x - A.x, ay = B.y - A.y, az = B.z - A.z
  const L2 = ax * ax + ay * ay + az * az
  if (L2 < 1e-9) return null
  const t = ((P.x - A.x) * ax + (P.y - A.y) * ay + (P.z - A.z) * az) / L2
  // 끝점 제외 여유
  const eps = splitTolMm / Math.sqrt(L2)
  if (!(t > eps && t < 1 - eps)) return null
  // XY 공선 거리(데크 평면 기준; z 는 분류로 따로 본다)
  const px = A.x + ax * t, py = A.y + ay * t
  const perpXY = Math.hypot(P.x - px, P.y - py)
  if (perpXY > splitTolMm) return null
  const beamZatT = A.z + az * t
  return { t, dz: P.z - beamZatT }
}

export function integrateBeams({ beams, plateNodes, startNodeId, opts = {} }) {
  const splitTolMm = opts.splitTolMm ?? 1.0
  const planeTolMm = opts.planeTolMm ?? 1.0
  const offsetBandMm = opts.offsetBandMm ?? 50.0
  const rbe2Cm = opts.rbe2Cm ?? '123456'

  const splits = new Map()
  const rbe2 = []
  const newNodes = []
  const usedDep = new Set()           // plate 노드 중복 종속 방지
  let nextNodeId = startNodeId

  for (const beam of beams) {
    const A = beam.a, B = beam.b
    const inPlane = []                 // {gid, t}  (Problem A)
    for (const P of plateNodes) {
      // 이미 끝점이면 스킵(공유됨)
      if (dist3(P, A) <= splitTolMm || dist3(P, B) <= splitTolMm) continue
      const pr = projectOnBeam(P, A, B, splitTolMm)
      if (!pr) continue
      if (Math.abs(pr.dz) <= planeTolMm) {
        inPlane.push({ gid: P.gid, t: pr.t })
      } else if (pr.dz > planeTolMm && pr.dz <= offsetBandMm) {
        // Problem B — Phase 2 에서 처리(여기서는 무시)
      }
    }
    if (inPlane.length) {
      inPlane.sort((u, v) => u.t - v.t)
      splits.set(beam.eid, inPlane.map(n => n.gid))
    }
  }
  return { splits, rbe2, newNodes, nextNodeId }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/data/beamIntegrate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/side-passage-studio/src/data/beamIntegrate.js apps/side-passage-studio/src/data/beamIntegrate.test.js
git commit -m "feat: integrateBeams — 측면빔 plate 노드 분할(Problem A)"
```

---

## Task 2: `bdfExport.js` 에 분할 배선

**Files:**
- Modify: `apps/side-passage-studio/src/data/bdfExport.js` (CBAR 루프를 mesh gid 할당 후로 이동, 분할 emit)
- Test: `apps/side-passage-studio/src/data/bdfExport.test.js`

- [ ] **Step 1: 실패 테스트 추가** (`bdfExport.test.js` 끝에)

```js
import { integrateBeams } from './beamIntegrate.js' // (이미 export 됨 — import 추가)

describe('buildBdf — 측면빔 분할(Problem A)', () => {
  it('plate 내부점에서 측면빔이 분할되어 노드를 공유한다', () => {
    const Z = 30272
    const stage = {
      nodeMap: new Map([
        [1896, { x: 114470, y: 14887, z: Z }],
        [200,  { x: 114295, y: 14887, z: Z }],
      ]),
      elements: [{ id: 2913, type: 'BEAM', startNode: 1896, endNode: 200, propertyId: 10 }],
      properties: [{ id: 10, kind: 'Bar', dims: [50, 50] }],
      materials: [], 
    }
    // 미리보기 mesh: 끝점 2개 공유 + 내부점 2747(신규)
    const mesh = {
      nodes: [
        { x: 114470, y: 14887, z: Z, id: 1896, shared: true },
        { x: 114383, y: 14887, z: Z, id: null, shared: false }, // 2747 자리(신규 GRID)
        { x: 114295, y: 14887, z: Z, id: 200, shared: true },
        { x: 114383, y: 14776.4, z: Z, id: null, shared: false },
      ],
      quads: [[0, 1, 3, 3]], triangles: [], sharedNodeIds: [1896, 200],
    }
    const out = buildBdf({ stage, mesh })
    const cbars = out.text.split('\n').filter(l => l.startsWith('CBAR,'))
    // 원본 1개 → 분할 2개
    expect(cbars.length).toBe(2)
    // 분할점(신규 GRID id)이 양쪽 CBAR 에 공유로 등장
    const midGrid = out.text.split('\n').find(l => l.startsWith('GRID,') && l.includes('114383') && l.includes('14887'))
    const midId = midGrid.split(',')[1]
    expect(cbars.filter(l => l.split(',').includes(midId)).length).toBe(2)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/data/bdfExport.test.js`
Expected: FAIL — CBAR 1개(미분할).

- [ ] **Step 3: 구현** — `bdfExport.js` 의 CBAR 섹션(현재 145–156)과 shell 섹션(158–194) 순서를 바꾸고 통합을 끼운다.

`buildBdf` 안에서 다음으로 교체한다(파일 상단에 `import { integrateBeams } from './beamIntegrate.js'` 추가):

1) **CBAR 루프(145–156)를 삭제**하고, 그 자리에는 빔 메타만 수집:
```js
  // ── 1D beam 메타 수집(분할은 mesh gid 확정 후) ──
  const beamMeta = []
  for (const e of stage.elements ?? []) {
    if (e.type !== 'BEAM') continue
    const a = stage.nodeMap.get(e.startNode)
    const b = stage.nodeMap.get(e.endNode)
    if (!a || !b) continue
    const pid = propSet.has(e.propertyId) ? e.propertyId : DEFAULT_PID
    beamMeta.push({ eid: e.id, pid, startNode: e.startNode, endNode: e.endNode,
      a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z } })
  }
```

2) **shell 섹션의 mesh gid 할당 직후**(현재 177 직후, quad emit 전)에 통합 호출과 plate 노드 수집:
```js
    const plateNodes = mesh.nodes.map((n, i) => ({ gid: gid[i], x: n.x, y: n.y, z: n.z }))
    const integ = integrateBeams({ beams: beamMeta, plateNodes, startNodeId: nextGridId })
    nextGridId = integ.nextNodeId
    for (const nn of integ.newNodes) {        // 지지빔 z 스티치 분할점(Phase2)
      bulk.push(`GRID,${nn.gid},,${fnum(nn.x)},${fnum(nn.y)},${fnum(nn.z)}`)
      newGridCount++
    }
```
(mesh 가 없을 때 대비: `integ` 는 mesh 블록 밖에서도 쓰이므로, mesh 블록 진입 전에 `let integ = { splits: new Map(), rbe2: [], newNodes: [] }` 로 기본값 선언하고, 위 호출은 mesh 블록 안에서 재할당.)

3) **CBAR emit 을 shell 섹션 뒤로 이동**(분할 적용):
```js
  // ── CBAR emit(분할 적용) ──
  let beamCount = 0
  for (const bm of beamMeta) {
    const a = stage.nodeMap.get(bm.startNode), b = stage.nodeMap.get(bm.endNode)
    const v = beamOrient(a, b)
    const mids = integ.splits.get(bm.eid)
    if (mids && mids.length) {
      const chain = [bm.startNode, ...mids, bm.endNode]
      for (let k = 0; k < chain.length - 1; k++) {
        bulk.push(`CBAR,${nextEid++},${bm.pid},${chain[k]},${chain[k + 1]},${fnum(v[0])},${fnum(v[1])},${fnum(v[2])}`)
        beamCount++
      }
    } else {
      bulk.push(`CBAR,${bm.eid},${bm.pid},${bm.startNode},${bm.endNode},${fnum(v[0])},${fnum(v[1])},${fnum(v[2])}`)
      beamCount++
    }
  }
  // ── RBE2 emit(Phase2) ──
  for (const r of integ.rbe2) {
    bulk.push(`RBE2,${nextEid++},${r.indep},${r.cm},${r.dep}`)
  }
```

> 주의: `beamCount`/`beamMeta`/`integ` 선언 위치를 정리해 `bulk` push 순서가 GRID→MAT1→PBAR→(shell)→CBAR→RBE2 가 되게 한다. CBAR 가 shell 뒤로 가도 BDF 유효(카드 순서 무관).

- [ ] **Step 4: 통과 + 회귀 확인**

Run: `npx vitest run src/data/bdfExport.test.js src/components/TopMenuBar.test.jsx`
Expected: PASS (신규 + 기존 회귀).

- [ ] **Step 5: 전체 회귀**

Run: `npx vitest run`
Expected: PASS (기존 252 + 신규). 실패 시 mesh 없는 경로(`integ` 기본값) 확인.

- [ ] **Step 6: 커밋**

```bash
git add apps/side-passage-studio/src/data/bdfExport.js apps/side-passage-studio/src/data/bdfExport.test.js
git commit -m "feat: bdfExport 측면빔 분할 배선(Problem A)"
```

---

## Task 3: 백엔드 Problem A lock-in 테스트

**Files:**
- Create: `WorkBenchSubModule/Nastran_bridge/tests/test_beam_integration.py`
- Modify(필요 시): `nastran_bridge.py` `split_beams_on_grid` 일반화

- [ ] **Step 1: lock-in 테스트 작성**

```python
# tests/test_beam_integration.py
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location(
    "nb", pathlib.Path(__file__).resolve().parents[1] / "nastran_bridge.py")
nb = importlib.util.module_from_spec(spec); spec.loader.exec_module(nb)

def _model():
    Z = 30272.0
    return {
        "nodes": [
            {"id": 1896, "x": 114470.0, "y": 14887.0, "z": Z},
            {"id": 200,  "x": 114295.0, "y": 14887.0, "z": Z},
            {"id": 11,   "x": 114295.0, "y": 14776.4, "z": Z},
            {"id": 12,   "x": 114470.0, "y": 14776.4, "z": Z},
        ],
        "elements": [
            {"id": 2913, "type": "CBAR", "startNode": 1896, "endNode": 200,
             "propertyId": 10, "orientation": [0.0, 0.0, -1.0]},
        ],
        "materials": [{"id": 1, "E": 206000.0, "nu": 0.3, "rho": 7.85e-9}],
        "properties": [], "rigids": [],
    }

def test_side_beam_split_at_plate_node():
    data = _model()
    spec = {"cornerNodeIds": [200, 12, 1896, 11], "gridLines": None,
            "elementSizeMm": 87.0,  # 114295..114470 을 2분할 → 내부 X=114383 격자선
            "thicknessMm": 6.0, "material": {"E": 206000.0, "nu": 0.3, "rho": 7.85e-9}}
    nb.add_checkplate_mesh(data, spec)
    cbars = [e for e in data["elements"] if e.get("type") == "CBAR"]
    # 2913 이 X=114383, Y=14887 격자 교차에서 분할 → CBAR 2개, 끝점 보존, EID 유일
    assert len(cbars) == 2
    eids = [e["id"] for e in cbars]
    assert len(set(eids)) == 2
    # 중간 노드(114383,14887) 가 양쪽 빔에 공유
    mid = next(n["id"] for n in data["nodes"]
               if abs(n["x"] - 114383) < 1 and abs(n["y"] - 14887) < 1)
    touching = [e for e in cbars if mid in (e["startNode"], e["endNode"])]
    assert len(touching) == 2
```

- [ ] **Step 2: 실행**

Run: `cd WorkBenchSubModule/Nastran_bridge && python -m pytest tests/test_beam_integration.py -v`
Expected: PASS(이미 동작 시) 또는 FAIL(분할 누락 시).

- [ ] **Step 3: FAIL 이면 일반화** — `split_beams_on_grid` 가 plate 격자 교차를 모두 처리하도록 `_first_grid_crossing` 호출 루프를 점검(대개 이미 통과). 끝점 근처 격자선이 분할을 막으면 `tol` 일관성 확인.

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `python -m pytest tests/ -v`
Expected: PASS (기존 21 + 신규).

- [ ] **Step 5: 커밋**

```bash
git add WorkBenchSubModule/Nastran_bridge/tests/test_beam_integration.py
git commit -m "test: 백엔드 측면빔 분할 lock-in(Problem A)"
```

---

# PHASE 2 — 하부 지지빔 RBE2 스티치 (Problem B)

## Task 4: `integrateBeams` 에 offset 지지빔 탐지 + RBE2

**Files:**
- Modify: `apps/side-passage-studio/src/data/beamIntegrate.js`
- Test: `apps/side-passage-studio/src/data/beamIntegrate.test.js`

- [ ] **Step 1: 실패 테스트 추가**

```js
describe('integrateBeams — Problem B (지지빔 RBE2)', () => {
  const Zp = 30272, Zb = 30260   // plate / beam (-12mm)
  // 지지빔 1814→125 (Y방향, X=113830, Z=30260)
  const beams = [{ eid: 2800, pid: 8, startNode: 1814, endNode: 125,
    a: { x: 113830, y: 15191.6, z: Zb }, b: { x: 113830, y: 15364.3, z: Zb } }]
  // plate 노드가 지지빔 바로 위(Z=30272)에 정렬
  const plateNodes = [
    { gid: 700, x: 113830, y: 15191.6, z: Zp },
    { gid: 701, x: 113830, y: 15278.0, z: Zp },   // 빔 내부점 위
    { gid: 702, x: 113830, y: 15364.3, z: Zp },
  ]
  it('plate 아래 지지빔을 빔 z 에서 분할하고 RBE2 로 스티치한다', () => {
    const r = integrateBeams({ beams, plateNodes, startNodeId: 9000 })
    // 빔 내부점(701) 위 → 빔 z 에 새 노드 1개 생성 + 분할
    expect(r.newNodes.length).toBe(1)
    const nn = r.newNodes[0]
    expect(nn.z).toBeCloseTo(Zb)                 // 빔 z (plate z 아님!)
    expect(Math.abs(nn.y - 15278.0)).toBeLessThan(1)
    expect(r.splits.get(2800)).toEqual([nn.gid]) // 빔이 새 노드에서 분할
    // RBE2: independent=새 빔노드, dependent=위 plate 노드(701), cm=123456
    expect(r.rbe2).toEqual([{ indep: nn.gid, dep: 701, cm: '123456' }])
  })
  it('한 plate 노드는 1개 RBE2 의 dependent 로만(중복 종속 금지)', () => {
    const twoBeams = [beams[0], { ...beams[0], eid: 2801 }] // 같은 위치 가정
    const r = integrateBeams({ beams: twoBeams, plateNodes, startNodeId: 9000 })
    const deps = r.rbe2.map(x => x.dep)
    expect(new Set(deps).size).toBe(deps.length)  // dep 유일
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/data/beamIntegrate.test.js`
Expected: FAIL — `newNodes`/`rbe2` 비어있음.

- [ ] **Step 3: 구현** — `integrateBeams` 의 빔 루프에서 Problem B 분기를 채운다. inPlane 처리 뒤에 offset 처리 추가:

```js
    // ── Problem B: plate 아래 지지빔 → 빔 z 분할 + RBE2 ──
    const offset = []   // {dep(plate gid), t, x, y, z(beam)}
    for (const P of plateNodes) {
      if (usedDep.has(P.gid)) continue
      if (dist3(P, A) <= splitTolMm || dist3(P, B) <= splitTolMm) continue
      const pr = projectOnBeam(P, A, B, splitTolMm)
      if (!pr) continue
      if (pr.dz > planeTolMm && pr.dz <= offsetBandMm) {
        const x = A.x + (B.x - A.x) * pr.t
        const y = A.y + (B.y - A.y) * pr.t
        const z = A.z + (B.z - A.z) * pr.t        // 빔 z
        offset.push({ dep: P.gid, t: pr.t, x, y, z })
      }
    }
    if (offset.length) {
      offset.sort((u, v) => u.t - v.t)
      const mids = []
      for (const o of offset) {
        const gid = nextNodeId++
        newNodes.push({ gid, x: o.x, y: o.y, z: o.z })
        mids.push(gid)
        rbe2.push({ indep: gid, dep: o.dep, cm: rbe2Cm })
        usedDep.add(o.dep)
      }
      // 기존 inPlane 분할과 합쳐 정렬(같은 빔에 A/B 혼재 가능)
      const prev = splits.get(beam.eid) || []
      const merged = [...prev.map(g => ({ gid: g, t: tOf(g, plateNodes, A, B) })),
                      ...offset.map((o, i) => ({ gid: mids[i], t: o.t }))]
        .sort((u, v) => u.t - v.t).map(m => m.gid)
      splits.set(beam.eid, merged)
    }
```
헬퍼(파일 내 추가):
```js
function tOf(gid, plateNodes, A, B) {
  const P = plateNodes.find(n => n.gid === gid); if (!P) return 0
  const ax = B.x - A.x, ay = B.y - A.y, az = B.z - A.z
  const L2 = ax*ax + ay*ay + az*az || 1
  return ((P.x-A.x)*ax + (P.y-A.y)*ay + (P.z-A.z)*az) / L2
}
```
> in-plane 과 offset 이 한 빔에 동시 발생하는 경우는 드물지만, `merged` 정렬로 분할 순서를 보존한다. 단순 케이스(둘 중 하나만)에서도 정상.

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `npx vitest run src/data/beamIntegrate.test.js`
Expected: PASS (Phase1 + Phase2 전부).

- [ ] **Step 5: 커밋**

```bash
git add apps/side-passage-studio/src/data/beamIntegrate.js apps/side-passage-studio/src/data/beamIntegrate.test.js
git commit -m "feat: integrateBeams 지지빔 RBE2 스티치(Problem B)"
```

---

## Task 5: `bdfExport.js` RBE2 + 신규 GRID 검증

**Files:**
- Modify(검증 위주, Task2 에서 emit 코드 이미 추가): `apps/side-passage-studio/src/data/bdfExport.js`
- Test: `apps/side-passage-studio/src/data/bdfExport.test.js`

- [ ] **Step 1: 실패/검증 테스트 추가**

```js
describe('buildBdf — 지지빔 RBE2(Problem B)', () => {
  it('plate 아래 지지빔에 RBE2 카드와 빔 z 분할 노드를 emit 한다', () => {
    const Zp = 30272, Zb = 30260
    const stage = {
      nodeMap: new Map([
        [1814, { x: 113830, y: 15191.6, z: Zb }],
        [125,  { x: 113830, y: 15364.3, z: Zb }],
      ]),
      elements: [{ id: 2800, type: 'BEAM', startNode: 1814, endNode: 125, propertyId: 8 }],
      properties: [{ id: 8, kind: 'Bar', dims: [50, 50] }], materials: [],
    }
    const mesh = {
      nodes: [
        { x: 113830, y: 15191.6, z: Zp, id: null, shared: false },
        { x: 113830, y: 15278.0, z: Zp, id: null, shared: false },
        { x: 113830, y: 15364.3, z: Zp, id: null, shared: false },
        { x: 113900, y: 15278.0, z: Zp, id: null, shared: false },
      ],
      quads: [[0, 1, 3, 3]], triangles: [], sharedNodeIds: [],
    }
    const out = buildBdf({ stage, mesh })
    const rbe2 = out.text.split('\n').filter(l => l.startsWith('RBE2,'))
    expect(rbe2.length).toBeGreaterThanOrEqual(1)
    expect(rbe2[0]).toContain('123456')
    // 분할 노드는 빔 z(30260)에 — plate z(30272) 아님
    const beamZGrid = out.text.split('\n').filter(l =>
      l.startsWith('GRID,') && l.includes('30260'))
    expect(beamZGrid.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: 실행** — Task2 의 emit 코드가 이미 `integ.rbe2`/`integ.newNodes` 를 처리하므로 대개 통과.

Run: `npx vitest run src/data/bdfExport.test.js`
Expected: PASS. FAIL 시 Task2 의 `integ` 기본값/emit 순서 점검.

- [ ] **Step 3: 전체 회귀**

Run: `npx vitest run`
Expected: PASS (252 + 신규 전부).

- [ ] **Step 4: 커밋**

```bash
git add apps/side-passage-studio/src/data/bdfExport.test.js
git commit -m "test: bdfExport 지지빔 RBE2 검증(Problem B)"
```

---

## Task 6: 백엔드 `add_checkplate_mesh` in-plane/offset 분리 + `stitch_support_beam`

**Files:**
- Modify: `WorkBenchSubModule/Nastran_bridge/nastran_bridge.py` (`add_checkplate_mesh` 1318–1378, 신규 `stitch_support_beam`)
- Test: `WorkBenchSubModule/Nastran_bridge/tests/test_beam_integration.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
def test_support_beam_rbe2_offset():
    Zp, Zb = 30272.0, 30260.0     # -12mm
    data = {
        "nodes": [
            {"id": 1814, "x": 113830.0, "y": 15191.6, "z": Zb},
            {"id": 125,  "x": 113830.0, "y": 15364.3, "z": Zb},
        ],
        "elements": [
            {"id": 2800, "type": "CBAR", "startNode": 1814, "endNode": 125,
             "propertyId": 8, "orientation": [0.0, 0.0, -1.0]},
        ],
        "materials": [{"id": 1, "E": 206000.0, "nu": 0.3, "rho": 7.85e-9}],
        "properties": [], "rigids": [],
    }
    # plate(코너 4개)를 지지빔 바로 위(Zp)에 — 코너 노드부터 생성
    for nid, x, y in [(900, 113830.0, 15191.6), (901, 113900.0, 15191.6),
                      (902, 113900.0, 15364.3), (903, 113830.0, 15364.3)]:
        data["nodes"].append({"id": nid, "x": x, "y": y, "z": Zp})
    spec = {"cornerNodeIds": [900, 901, 902, 903], "gridLines": {"x": None, "y": [15278.0]},
            "elementSizeMm": 90.0, "thicknessMm": 6.0,
            "material": {"E": 206000.0, "nu": 0.3, "rho": 7.85e-9}}
    nb.add_checkplate_mesh(data, spec)
    # 지지빔은 빔 z 에서 분할(노드가 plate z 로 끌려가지 않음)
    beam_node_zs = []
    for e in data["elements"]:
        if e.get("type") == "CBAR":
            for nid in (e["startNode"], e["endNode"]):
                n = next(nn for nn in data["nodes"] if nn["id"] == nid)
                beam_node_zs.append(n["z"])
    assert all(abs(z - Zb) < 1 for z in beam_node_zs)     # 전부 빔 z
    # RBE2 가 생성되고 dependent(plate 노드)는 유일
    assert len(data["rigids"]) >= 1
    deps = [d for r in data["rigids"] for d in r["dependentNodes"]]
    assert len(deps) == len(set(deps))
    assert all(r.get("cm") == "123456" for r in data["rigids"])
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_beam_integration.py::test_support_beam_rbe2_offset -v`
Expected: FAIL — 현재는 지지빔이 plate z 로 끌려가고 RBE2 없음.

- [ ] **Step 3: 구현** — `add_checkplate_mesh` 의 지지빔 처리(1341–1362)를 분류로 교체:

```python
    # 2) 영역 내 빔을 in-plane / offset 로 분류
    x0, x1 = min(p[0] for p in corners2), max(p[0] for p in corners2)
    y0, y1 = min(p[1] for p in corners2), max(p[1] for p in corners2)
    band = 50.0          # offsetBandMm
    plane_tol = 1.0      # planeTolMm

    def _xy_in(n):
        return (n is not None
                and x0 - tol <= as_float(n.get("x")) <= x1 + tol
                and y0 - tol <= as_float(n.get("y")) <= y1 + tol)

    in_plane_ids, offset_specs = [], []   # offset_specs: (bid, beam_z)
    for e in data.get("elements", []):
        if str(e.get("type", "")).upper() not in {"CBEAM", "CBAR"}:
            continue
        s = index.get(as_int(e.get("startNode")))
        t = index.get(as_int(e.get("endNode")))
        if not (_xy_in(s) and _xy_in(t)):
            continue
        beam_z = (as_float(s.get("z")) + as_float(t.get("z"))) / 2.0
        dz = z - beam_z                    # plate 가 위 → 양수
        if abs(dz) <= plane_tol:
            in_plane_ids.append(as_int(e.get("id")))
        elif plane_tol < dz <= band:
            offset_specs.append((as_int(e.get("id")), beam_z))

    # 3a) in-plane 지지빔: 격자 교차에서 분할(절점 공유, 기존 동작)
    split_beams_on_grid(data, index, in_plane_ids, xs, ys, z, tol)

    # 4) PSHELL/MAT + 5) quad(격자 절점은 plate z 에 생성)
    pid = ensure_pshell(data, thickness=as_float(spec.get("thicknessMm"), 6.0),
                        material=spec.get("material"), material_id=as_int(spec.get("materialId")))
    nodes_before = len(data.get("nodes", []))
    quad_ids = build_plate_quads(data, index, xs, ys, z, pid, tol)

    # 3b) offset 지지빔: 빔 z 에서 분할 + plate 노드와 RBE2
    for bid, beam_z in offset_specs:
        stitch_support_beam(data, index, bid, xs, ys, z, beam_z, tol)
```

신규 함수(`split_beams_on_grid` 근처에 추가):
```python
def stitch_support_beam(data, index, beam_id, xs, ys, z_plate, beam_z, tol=1.0):
    """offset 지지빔을 격자선 교점에서 (빔 z 로) 분할하고, 바로 위 plate 노드와 RBE2 로 잇는다."""
    rigids = data.setdefault("rigids", [])
    used_dep = {d for r in rigids for d in (r.get("dependentNodes") or [])}
    queue = [beam_id]
    guard = 0
    while queue and guard < 10000:
        guard += 1
        bid = queue.pop(0)
        beam = next((e for e in data.get("elements", []) if as_int(e.get("id")) == bid), None)
        if beam is None:
            continue
        s = index.get(as_int(beam.get("startNode"))); e = index.get(as_int(beam.get("endNode")))
        if not s or not e:
            continue
        cut = _first_grid_crossing(as_float(s.get("x")), as_float(s.get("y")),
                                   as_float(e.get("x")), as_float(e.get("y")), xs, ys, tol)
        if cut is None:
            continue
        cx, cy = cut
        beam_node = find_or_create_node(data, index, cx, cy, beam_z, tol)   # 빔 z!
        plate_node = find_or_create_node(data, index, cx, cy, z_plate, tol) # plate z(이미 quad 가 만든 노드 공유)
        new_ids = split_beam_at_node(data, bid, beam_node)
        queue.extend(new_ids)
        if plate_node not in used_dep and plate_node != beam_node:
            rid = _next_id(rigids)
            rigids.append({"id": rid, "independentNode": beam_node,
                           "dependentNodes": [plate_node], "cm": "123456"})
            used_dep.add(plate_node)
```
> EID/RID 채번: `rigids` 의 `_next_id` 는 element id 와 별개 리스트라 충돌 가능 → RBE2 EID 도 element id 공간과 겹치면 FATAL. **안전책:** `rid = max(_next_id(data["elements"]), _next_id(rigids))` 로 element+rigid 통합 최대값 사용. 구현 시 이 한 줄로 교체.

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `python -m pytest tests/ -v`
Expected: PASS (기존 21 + Problem A + Problem B). offset 빔이 plate z 로 안 끌려가고 RBE2 dependent 유일 확인.

- [ ] **Step 5: 커밋**

```bash
git add WorkBenchSubModule/Nastran_bridge/nastran_bridge.py WorkBenchSubModule/Nastran_bridge/tests/test_beam_integration.py
git commit -m "feat: 백엔드 지지빔 RBE2 스티치 + in-plane/offset 분리(Problem B)"
```

---

## Task 7: 미러 동기 · 전체 검증 · 버전 bump

**Files:**
- Modify: `HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py` (소스 미러)
- Modify: `apps/side-passage-studio/package.json` (version)

- [ ] **Step 1: 백엔드 미러 동기** — 소스를 InHouseProgram 으로 복사

```bash
cp C:/Coding/WorkBenchSubModule/Nastran_bridge/nastran_bridge.py \
   C:/Coding/WorkBench/HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py
```
검증: 두 파일 동일

```bash
diff C:/Coding/WorkBenchSubModule/Nastran_bridge/nastran_bridge.py \
     C:/Coding/WorkBench/HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py && echo IDENTICAL
```
Expected: `IDENTICAL`

- [ ] **Step 2: 전체 테스트 재확인**

Run(스튜디오): `cd apps/side-passage-studio && npx vitest run` → PASS
Run(백엔드): `cd WorkBenchSubModule/Nastran_bridge && python -m pytest tests/ -v` → PASS

- [ ] **Step 3: 스튜디오 버전 bump + 빌드** — `package.json` `version` 0.0.52 → 0.0.53

Run: `npx vite build`
Expected: 빌드 성공(에러 0).

- [ ] **Step 4: 커밋**

```bash
git add HiTessWorkBenchBackEnd/InHouseProgram/NastranBridge/nastran_bridge.py apps/side-passage-studio/package.json
git commit -m "chore: nastran_bridge 미러 동기 + 스튜디오 0.0.53 bump"
```

- [ ] **Step 5: 배포(수동, 별도 보고)** — 본 plan 에서는 코드까지만. 배포 시:
  - 스튜디오: `npm run package` → `release/side-passage-studio-0.0.53.zip` → 백엔드-로컬 `StudioProgram/` + UNC 양쪽 복사.
  - 서버(145): `nastran_bridge.py` 는 git 미추적 → **수동 교체 + 백엔드 재시작 필요**(커밋 보고에 명시).

---

## 최종 검증 (모든 task 후)

- [ ] 스튜디오 `npx vitest run` 전부 PASS
- [ ] 백엔드 `python -m pytest tests/ -v` 전부 PASS
- [ ] `studioResult.bdf` 재현 입력으로 export → E2913 이 2747 에서 분할(CBAR 2개) + 지지빔 있는 plate 에 RBE2 생성 육안 확인
- [ ] 멱등: 동일 입력 2회 export 결과 동일(EID/노드 중복 0)
- [ ] 미러 `diff` IDENTICAL
- [ ] 최종 code review(subagent-driven 의 final reviewer)
