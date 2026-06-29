# 권상 위치 자동 선정 (XY 구역 분할 + 권상 최적안 제안) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Module Unit Studio Hoist 탭에 "권상 위치 자동 선정" 버튼 + SVG XY 모달을 추가해, 무게중심 기준으로 모델을 구역 분할하고 각 구역의 권상 포인트(노드)를 권상 최적안으로 자동 제안·수정한다.

**Architecture:** 모든 기하/최적화 로직은 store·three 의존이 없는 순수 함수 모듈(`hoistAutoLayout.js`)에 두어 Node 환경 vitest로 단위 테스트한다. 상태는 기존 store와 분리된 `useHoistLayoutStore`(zustand v5)가 보유한다. SVG 모달 컴포넌트는 store 상태를 그리는 얇은 뷰이며(DOM 테스트 환경 부재 → build + 수동 체크), 모든 계산은 순수 함수/스토어에 위임한다. 기존 수동 Hoist 흐름(`hoistGroups`/posture-stability)은 건드리지 않는다.

**Tech Stack:** React 19 + zustand 5 + SVG(인라인 스타일) + lucide-react, vitest(Node 환경, DOM 없음). 좌표 단위 mm, 탑다운 = (x,y) 평면.

**스펙:** `docs/superpowers/specs/2026-06-29-hoist-auto-layout-design.md`

**작업 레포:** `C:\Coding\WorkBenchSubModule\ModuleUnitStudio` (별도 git 레포, `apps/module-unit-studio/src` 추적됨).
**스튜디오 앱 디렉터리(아래 `<APP>` 로 표기):** `C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio`
**테스트 실행:** `npm --prefix "<APP>" test -- <상대경로>` (= `vitest run <경로>`)
**커밋:** `git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add ... && git -C ... commit -m ...` (커밋 메시지 한국어, 끝에 Co-Authored-By 라인).

> **배포 주의:** 버전 bump·`npm run package`·StudioProgram 복사(zip 배포)는 **이 계획에 포함하지 않는다.** 모든 Task 완료·검증 후 **사용자 별도 승인** 시에만 수행한다(스펙 §12).

---

## 파일 구조

| 파일 | 종류 | 책임 |
|---|---|---|
| `<APP>/src/data/hoistAutoLayout.js` | 신규(순수함수) | 투영·변환·분할·구역배정·구역중심·이상배치·hull·점수·스냅·제안 |
| `<APP>/src/data/hoistAutoLayout.test.js` | 신규 | 순수함수 단위 테스트 |
| `<APP>/src/store/useHoistLayoutStore.js` | 신규(zustand) | 모달/분할/구역/제안/override 상태 + 액션 |
| `<APP>/src/store/useHoistLayoutStore.test.js` | 신규 | store 액션 테스트 |
| `<APP>/src/components/HoistAutoLayoutEditor.jsx` | 신규 | SVG 모달 UI(투영·분할선/마커 드래그·구역 입력) |
| `<APP>/src/components/HoistPositionPanel.jsx` | 수정 | "권상 위치 자동 선정" 버튼 + 요약 + 모달 마운트 |

함수 시그니처(전 Task 공통, self-review 일관성 기준):
- `projectNodesXY(stage) → {id,x,y}[]`
- `fitTransform(bbox,width,height,pad) → {scale,toScreen(x,y),toModel(sx,sy)}`
- `clampDivider(v,lo,hi) → number`
- `computeInitialDividers(bbox,cog,divX,divY) → {dividersX:number[],dividersY:number[]}`
- `splitRegions(bbox,dividersX,dividersY) → {id,col,row,minX,maxX,minY,maxY}[]`
- `assignNodesToRegions(projectedNodes,regions,dividersX,dividersY) → {[regionId]:number[]}`
- `regionCenter(regionNodes,massByNode?) → {x,y}|null`
- `idealTargets(center,n,region) → {x,y}[]`
- `convexHullArea(points) → number`
- `scoreLayout(points,center,region) → number`
- `snapToNearestNode(target,candidates,excludeIds?) → number|null`
- `suggestPointsForRegion(regionNodes,center,n,region,opts?) → {nodeIds:number[],warning:string|null}`

---

## Task 1: 순수 기하 코어 — 투영·변환·분할·구역배정

**Files:**
- Create: `<APP>/src/data/hoistAutoLayout.js`
- Test: `<APP>/src/data/hoistAutoLayout.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`<APP>/src/data/hoistAutoLayout.test.js`:
```js
import { describe, it, expect } from 'vitest'
import {
  projectNodesXY, clampDivider, computeInitialDividers, splitRegions,
  assignNodesToRegions, fitTransform,
} from './hoistAutoLayout.js'

const bbox = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: 0, maxZ: 0 }
const fakeStage = { nodeMap: new Map([
  [1, { x: 10, y: 10, z: 5 }],
  [2, { x: 90, y: 10, z: 5 }],
  [3, { x: 10, y: 90, z: 5 }],
  [4, { x: 90, y: 90, z: 5 }],
]) }

describe('projectNodesXY', () => {
  it('z 무시하고 id/x/y 보존', () => {
    const p = projectNodesXY(fakeStage)
    expect(p).toHaveLength(4)
    expect(p.find(n => n.id === 1)).toEqual({ id: 1, x: 10, y: 10 })
  })
  it('nodeMap 없으면 빈 배열', () => {
    expect(projectNodesXY(null)).toEqual([])
  })
})

describe('computeInitialDividers', () => {
  it('분할선 1개면 무게중심에 배치 (divX=2,divY=2)', () => {
    const { dividersX, dividersY } = computeInitialDividers(bbox, { x: 40, y: 60 }, 2, 2)
    expect(dividersX).toEqual([40]); expect(dividersY).toEqual([60])
  })
  it('칸 1개면 분할선 없음 (divX=1)', () => {
    const { dividersX, dividersY } = computeInitialDividers(bbox, { x: 40, y: 60 }, 1, 2)
    expect(dividersX).toEqual([]); expect(dividersY).toEqual([60])
  })
  it('분할선 2개 이상이면 균등 분할 (divX=3)', () => {
    const { dividersX } = computeInitialDividers(bbox, { x: 40, y: 60 }, 3, 1)
    expect(dividersX[0]).toBeCloseTo(100 / 3); expect(dividersX[1]).toBeCloseTo(200 / 3)
  })
  it('무게중심이 범위 밖이면 중앙 폴백', () => {
    const { dividersX } = computeInitialDividers(bbox, { x: 999, y: 0 }, 2, 1)
    expect(dividersX).toEqual([50])
  })
})

describe('splitRegions', () => {
  it('구역 개수 = divX*divY, 경계 정확', () => {
    const regions = splitRegions(bbox, [50], [50])
    expect(regions).toHaveLength(4)
    expect(regions.find(r => r.id === 'c0_r0')).toMatchObject({ minX: 0, maxX: 50, minY: 0, maxY: 50 })
    expect(regions.find(r => r.id === 'c1_r1')).toMatchObject({ minX: 50, maxX: 100, minY: 50, maxY: 100 })
  })
})

describe('assignNodesToRegions', () => {
  it('각 노드가 올바른 구역에', () => {
    const regions = splitRegions(bbox, [50], [50])
    const a = assignNodesToRegions(projectNodesXY(fakeStage), regions, [50], [50])
    expect(a['c0_r0']).toEqual([1])  // (10,10)
    expect(a['c1_r1']).toEqual([4])  // (90,90)
  })
  it('경계선 위 노드는 낮은 인덱스 구역', () => {
    const stage = { nodeMap: new Map([[1, { x: 50, y: 10, z: 0 }]]) }
    const regions = splitRegions(bbox, [50], [])
    const a = assignNodesToRegions(projectNodesXY(stage), regions, [50], [])
    expect(a['c0_r0']).toEqual([1])  // x=50 → 낮은 col 0
  })
})

describe('clampDivider', () => {
  it('범위로 클램프', () => {
    expect(clampDivider(5, 10, 20)).toBe(10)
    expect(clampDivider(25, 10, 20)).toBe(20)
    expect(clampDivider(15, 10, 20)).toBe(15)
  })
})

describe('fitTransform', () => {
  it('toScreen/toModel 라운드트립', () => {
    const t = fitTransform(bbox, 200, 200, 0)
    const s = t.toScreen(0, 0)
    const m = t.toModel(s.sx, s.sy)
    expect(m.x).toBeCloseTo(0); expect(m.y).toBeCloseTo(0)
  })
  it('y 반전 — 모델 maxY 가 화면 위쪽(작은 sy)', () => {
    const t = fitTransform(bbox, 200, 200, 0)
    expect(t.toScreen(0, 100).sy).toBeLessThan(t.toScreen(0, 0).sy)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" test -- src/data/hoistAutoLayout.test.js`
Expected: FAIL — `Failed to resolve import "./hoistAutoLayout.js"` (파일 없음).

- [ ] **Step 3: 최소 구현 작성**

`<APP>/src/data/hoistAutoLayout.js`:
```js
// 권상 위치 자동 선정 — 순수 기하/최적화 함수 모음.
// store/three 의존 없음 → Node 환경 vitest 로 단위 테스트한다. 좌표 단위 mm. 탑다운 = (x,y).

/** 모델 노드를 XY 평면으로 투영(z 무시). @param {{nodeMap:Map}} stage @returns {{id:number,x:number,y:number}[]} */
export function projectNodesXY(stage) {
  const out = []
  const nm = stage?.nodeMap
  if (!nm || typeof nm.forEach !== 'function') return out
  nm.forEach((n, id) => out.push({ id, x: n.x, y: n.y }))
  return out
}

/** [lo,hi] 로 클램프 (hi<=lo 면 lo). */
export function clampDivider(v, lo, hi) {
  if (!(hi > lo)) return lo
  return Math.min(hi, Math.max(lo, v))
}

// 한 축의 분할선 위치: 분할선 1개 → 무게중심(범위 밖이면 중앙), 2개 이상 → 균등 분할.
function axisDividers(lo, hi, cogVal, count) {
  const nLines = Math.max(0, Math.round(count) - 1)
  if (nLines === 0) return []
  if (nLines === 1) {
    const c = Number.isFinite(cogVal) && cogVal > lo && cogVal < hi ? cogVal : (lo + hi) / 2
    return [c]
  }
  const lines = []
  for (let i = 1; i <= nLines; i++) lines.push(lo + ((hi - lo) * i) / (nLines + 1))
  return lines
}

/**
 * 초기 분할선 위치.
 * @param {{minX,maxX,minY,maxY}} bbox @param {{x,y}} cog @param {number} divX @param {number} divY
 * @returns {{dividersX:number[], dividersY:number[]}}
 */
export function computeInitialDividers(bbox, cog, divX, divY) {
  return {
    dividersX: axisDividers(bbox.minX, bbox.maxX, cog?.x, divX),
    dividersY: axisDividers(bbox.minY, bbox.maxY, cog?.y, divY),
  }
}

/**
 * 분할선으로 구역 사각형 목록 생성. col=X 왼→오, row=Y 아래→위.
 * @returns {{id:string,col:number,row:number,minX,maxX,minY,maxY}[]}
 */
export function splitRegions(bbox, dividersX, dividersY) {
  const xs = [bbox.minX, ...[...dividersX].sort((a, b) => a - b), bbox.maxX]
  const ys = [bbox.minY, ...[...dividersY].sort((a, b) => a - b), bbox.maxY]
  const regions = []
  for (let col = 0; col < xs.length - 1; col++) {
    for (let row = 0; row < ys.length - 1; row++) {
      regions.push({
        id: `c${col}_r${row}`, col, row,
        minX: xs[col], maxX: xs[col + 1], minY: ys[row], maxY: ys[row + 1],
      })
    }
  }
  return regions
}

// value 보다 작은(strict) 분할선 개수 = 버킷 인덱스. 경계선 위 값은 낮은 인덱스로 귀속.
function bucketIndex(v, dividers) {
  let i = 0
  while (i < dividers.length && dividers[i] < v) i++
  return i
}

/**
 * 노드를 구역별로 배정(각 노드 정확히 1구역). 경계선 위 노드는 낮은 인덱스 구역.
 * @returns {{ [regionId:string]: number[] }}
 */
export function assignNodesToRegions(projectedNodes, regions, dividersX, dividersY) {
  const xs = [...dividersX].sort((a, b) => a - b)
  const ys = [...dividersY].sort((a, b) => a - b)
  const out = {}
  for (const r of regions) out[r.id] = []
  for (const p of projectedNodes) {
    const id = `c${bucketIndex(p.x, xs)}_r${bucketIndex(p.y, ys)}`
    if (out[id]) out[id].push(p.id)
  }
  return out
}

/**
 * 모델 XY(mm) ↔ 화면(px) 변환. y 반전(모델 y up → 화면 y down). bbox 를 여백 pad 안에 맞춤.
 * @returns {{scale:number, toScreen:(x,y)=>{sx,sy}, toModel:(sx,sy)=>{x,y}}}
 */
export function fitTransform(bbox, width, height, pad = 24) {
  const w = (bbox.maxX - bbox.minX) || 1
  const h = (bbox.maxY - bbox.minY) || 1
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h)
  const offX = pad + ((width - 2 * pad) - w * scale) / 2
  const offY = pad + ((height - 2 * pad) - h * scale) / 2
  return {
    scale,
    toScreen: (x, y) => ({ sx: offX + (x - bbox.minX) * scale, sy: height - (offY + (y - bbox.minY) * scale) }),
    toModel: (sx, sy) => ({ x: bbox.minX + (sx - offX) / scale, y: bbox.minY + ((height - sy) - offY) / scale }),
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" test -- src/data/hoistAutoLayout.test.js`
Expected: PASS (전 테스트 green).

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/data/hoistAutoLayout.js apps/module-unit-studio/src/data/hoistAutoLayout.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
feat(hoist-auto): 투영·분할·구역배정·좌표변환 순수함수

권상 위치 자동 선정 기반 기하 코어. projectNodesXY/computeInitialDividers
(분할선 1개=무게중심, 2개↑=균등)/splitRegions/assignNodesToRegions(경계=낮은
인덱스)/fitTransform(y반전 라운드트립)/clampDivider. 단위 테스트 포함.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 순수 — 구역중심·이상배치·hull·점수

**Files:**
- Modify: `<APP>/src/data/hoistAutoLayout.js` (함수 추가)
- Test: `<APP>/src/data/hoistAutoLayout.test.js` (describe 추가)

- [ ] **Step 1: 실패하는 테스트 추가** (파일 끝에 append)

```js
import 'vitest'  // (이미 import 됨 — 아래 describe 블록만 파일 끝에 추가)
```
실제로는 기존 import 줄에 `regionCenter, idealTargets, convexHullArea, scoreLayout` 를 추가하고, 아래 describe 들을 파일 끝에 추가한다. import 줄을 다음으로 교체:
```js
import {
  projectNodesXY, clampDivider, computeInitialDividers, splitRegions,
  assignNodesToRegions, fitTransform,
  regionCenter, idealTargets, convexHullArea, scoreLayout,
} from './hoistAutoLayout.js'
```
파일 끝에 추가:
```js
const region = { minX: 0, maxX: 100, minY: 0, maxY: 100 }

describe('regionCenter', () => {
  it('질량 없으면 기하평균', () => {
    const c = regionCenter([{ id: 1, x: 0, y: 0 }, { id: 2, x: 100, y: 0 }, { id: 3, x: 50, y: 90 }])
    expect(c.x).toBeCloseTo(50); expect(c.y).toBeCloseTo(30)
  })
  it('질량 있으면 가중평균', () => {
    const mass = new Map([[1, 3], [2, 1]])
    const c = regionCenter([{ id: 1, x: 0, y: 0 }, { id: 2, x: 100, y: 0 }], mass)
    expect(c.x).toBeCloseTo(25)
  })
  it('빈 입력이면 null', () => { expect(regionCenter([])).toBeNull() })
})

describe('idealTargets', () => {
  it('n=2 는 2점, 중심 대칭', () => {
    const t = idealTargets({ x: 50, y: 50 }, 2, region)
    expect(t).toHaveLength(2)
    expect((t[0].x + t[1].x) / 2).toBeCloseTo(50)
    expect((t[0].y + t[1].y) / 2).toBeCloseTo(50)
  })
  it('n=4 는 4점', () => { expect(idealTargets({ x: 50, y: 50 }, 4, region)).toHaveLength(4) })
})

describe('convexHullArea', () => {
  it('2점 이하/공선이면 0', () => {
    expect(convexHullArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0)
    expect(convexHullArea([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(0)
  })
  it('정사각형 면적', () => {
    expect(convexHullArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBeCloseTo(100)
  })
})

describe('scoreLayout', () => {
  it('균형(중심 일치) 배치가 치우친 배치보다 높음', () => {
    const center = { x: 50, y: 50 }
    const balanced = [{ x: 20, y: 50 }, { x: 80, y: 50 }]
    const skewed = [{ x: 20, y: 50 }, { x: 30, y: 50 }]
    expect(scoreLayout(balanced, center, region)).toBeGreaterThan(scoreLayout(skewed, center, region))
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" test -- src/data/hoistAutoLayout.test.js`
Expected: FAIL — `regionCenter is not a function` 등 (미구현 export).

- [ ] **Step 3: 구현 추가** (`hoistAutoLayout.js` 끝에 append)

```js
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v }

/**
 * 구역 중심. massByNode(nodeId→t) 가 있으면 질량가중, 없으면 기하평균.
 * @param {{id,x,y}[]} regionNodes @param {Map<number,number>} [massByNode] @returns {{x,y}|null}
 */
export function regionCenter(regionNodes, massByNode = null) {
  if (!regionNodes || regionNodes.length === 0) return null
  let tw = 0, cx = 0, cy = 0
  for (const p of regionNodes) {
    const w = massByNode?.get?.(p.id)
    if (Number.isFinite(w) && w > 0) { tw += w; cx += w * p.x; cy += w * p.y }
  }
  if (tw > 0) return { x: cx / tw, y: cy / tw }
  let gx = 0, gy = 0
  for (const p of regionNodes) { gx += p.x; gy += p.y }
  return { x: gx / regionNodes.length, y: gy / regionNodes.length }
}

/**
 * 구역 중심 C 주위로 n개 이상 배치. 반경 = 0.4 × min(반폭,반높이).
 * n=2: 장축 ±, n=4: 45° 오프셋 사각, 그 외 n≥3: 등각 링.
 * @returns {{x,y}[]}
 */
export function idealTargets(center, n, region) {
  const halfW = (region.maxX - region.minX) / 2
  const halfH = (region.maxY - region.minY) / 2
  const base = Math.min(halfW || halfH, halfH || halfW)
  const R = (base > 0 ? base : Math.max(halfW, halfH, 1)) * 0.4
  const cx = center.x, cy = center.y
  if (n <= 1) return [{ x: cx, y: cy }]
  if (n === 2) {
    return halfW >= halfH
      ? [{ x: cx - R, y: cy }, { x: cx + R, y: cy }]
      : [{ x: cx, y: cy - R }, { x: cx, y: cy + R }]
  }
  const offset = n === 4 ? Math.PI / 4 : -Math.PI / 2
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = offset + (2 * Math.PI * i) / n
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) })
  }
  return pts
}

/** 볼록껍질 면적(mm²). 점 2개 이하/공선이면 0. (monotonic chain) */
export function convexHullArea(points) {
  const pts = (points ?? []).filter(Boolean)
  if (pts.length < 3) return 0
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  if (hull.length < 3) return 0
  let area = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

/**
 * 권상 배치 점수(↑ = 좋음). 균형 0.6 + 분산 0.4 − 군집벌점 0.3.
 * @param {{x,y}[]} points @param {{x,y}} center @param {{minX,maxX,minY,maxY}} region
 */
export function scoreLayout(points, center, region) {
  const pts = (points ?? []).filter(Boolean)
  if (pts.length === 0) return -Infinity
  const D = Math.hypot(region.maxX - region.minX, region.maxY - region.minY) || 1
  const A = ((region.maxX - region.minX) * (region.maxY - region.minY)) || (D * D)
  let mx = 0, my = 0
  for (const p of pts) { mx += p.x; my += p.y }
  mx /= pts.length; my /= pts.length
  const eb = clamp01(Math.hypot(mx - center.x, my - center.y) / D)
  let spread
  if (pts.length <= 2) {
    spread = pts.length === 2 ? clamp01(Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / D) : 0
  } else {
    spread = clamp01(convexHullArea(pts) / A)
  }
  let minPair = Infinity
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      minPair = Math.min(minPair, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y))
  const cp = pts.length >= 2 ? clamp01(1 - minPair / (0.25 * D)) : 0
  return 0.6 * (1 - eb) + 0.4 * spread - 0.3 * cp
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" test -- src/data/hoistAutoLayout.test.js`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/data/hoistAutoLayout.js apps/module-unit-studio/src/data/hoistAutoLayout.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
feat(hoist-auto): 구역중심·이상배치·hull면적·권상 점수함수

regionCenter(질량가중/기하평균)·idealTargets(n별 대칭배치)·convexHullArea·
scoreLayout(균형+분산-군집). 단위 테스트 포함.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 순수 — 노드 스냅 + 권상 최적안 제안

**Files:**
- Modify: `<APP>/src/data/hoistAutoLayout.js`
- Test: `<APP>/src/data/hoistAutoLayout.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

import 줄에 `snapToNearestNode, suggestPointsForRegion` 추가(최종 import 줄):
```js
import {
  projectNodesXY, clampDivider, computeInitialDividers, splitRegions,
  assignNodesToRegions, fitTransform,
  regionCenter, idealTargets, convexHullArea, scoreLayout,
  snapToNearestNode, suggestPointsForRegion,
} from './hoistAutoLayout.js'
```
파일 끝에 추가:
```js
// 격자 노드 5x5 (열 우선: idx 0~4 = x=0, y=0..100 → 한 열에 몰림)
const gridNodes = []
{
  let gid = 1
  for (let gx = 0; gx <= 100; gx += 25) for (let gy = 0; gy <= 100; gy += 25) gridNodes.push({ id: gid++, x: gx, y: gy })
}

describe('snapToNearestNode', () => {
  it('가장 가까운 노드', () => {
    const origin = gridNodes.find(n => n.x === 0 && n.y === 0)
    expect(snapToNearestNode({ x: 1, y: 1 }, gridNodes)).toBe(origin.id)
  })
  it('제외 집합 반영', () => {
    const origin = gridNodes.find(n => n.x === 0 && n.y === 0)
    const ex = new Set([origin.id])
    expect(snapToNearestNode({ x: 1, y: 1 }, gridNodes, ex)).not.toBe(origin.id)
  })
  it('후보 없으면 null', () => { expect(snapToNearestNode({ x: 0, y: 0 }, [])).toBeNull() })
})

describe('suggestPointsForRegion', () => {
  it('요청 n개를 서로 다른 노드로 제안', () => {
    const c = regionCenter(gridNodes)
    const r = suggestPointsForRegion(gridNodes, c, 4, region)
    expect(r.nodeIds).toHaveLength(4)
    expect(new Set(r.nodeIds).size).toBe(4)
    expect(r.warning).toBeNull()
  })
  it('노드 부족이면 가능한 만큼 + 경고', () => {
    const few = gridNodes.slice(0, 1)
    const r = suggestPointsForRegion(few, regionCenter(few), 3, region)
    expect(r.nodeIds).toHaveLength(1)
    expect(r.warning).toMatch(/노드/)
  })
  it('빈 구역이면 빈 배열 + 경고', () => {
    const r = suggestPointsForRegion([], { x: 50, y: 50 }, 2, region)
    expect(r.nodeIds).toEqual([]); expect(r.warning).toMatch(/빈/)
  })
  it('제안 점수가 한 열에 몰린 4노드보다 좋음(균형/분산)', () => {
    const c = regionCenter(gridNodes)
    const r = suggestPointsForRegion(gridNodes, c, 4, region)
    const byId = new Map(gridNodes.map(n => [n.id, n]))
    const sSuggest = scoreLayout(r.nodeIds.map(id => byId.get(id)), c, region)
    const sColumn = scoreLayout(gridNodes.slice(0, 4), c, region)  // 첫 4개 = 한 열
    expect(sSuggest).toBeGreaterThan(sColumn)
  })
  it('결정적 — 동일 입력 동일 결과', () => {
    const c = regionCenter(gridNodes)
    const a = suggestPointsForRegion(gridNodes, c, 4, region).nodeIds
    const b = suggestPointsForRegion(gridNodes, c, 4, region).nodeIds
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" test -- src/data/hoistAutoLayout.test.js`
Expected: FAIL — `snapToNearestNode is not a function`.

- [ ] **Step 3: 구현 추가** (`hoistAutoLayout.js` 끝에 append)

```js
/**
 * target 에 가장 가까운 노드 id. excludeIds 제외. 후보 없으면 null.
 * @param {{x,y}} target @param {{id,x,y}[]} candidates @param {Set<number>} [excludeIds]
 */
export function snapToNearestNode(target, candidates, excludeIds = null) {
  let best = null, bestD = Infinity
  for (const c of candidates) {
    if (excludeIds && excludeIds.has(c.id)) continue
    const d = (c.x - target.x) ** 2 + (c.y - target.y) ** 2
    if (d < bestD) { bestD = d; best = c.id }
  }
  return best
}

// target 기준 최근접 k개 노드 id (결정적: 거리→id 정렬).
function nearestK(target, nodes, k) {
  return [...nodes]
    .map(p => ({ id: p.id, d: (p.x - target.x) ** 2 + (p.y - target.y) ** 2 }))
    .sort((a, b) => a.d - b.d || a.id - b.id)
    .slice(0, k)
    .map(o => o.id)
}

/**
 * 구역 권상 최적안: 이상배치 → 노드 스냅 → 그리디 국소개선. 결정적.
 * @param {{id,x,y}[]} regionNodes @param {{x,y}} center @param {number} n(>=2)
 * @param {{minX,maxX,minY,maxY}} region @param {{k?:number,maxIter?:number}} [opts]
 * @returns {{nodeIds:number[], warning:string|null}}
 */
export function suggestPointsForRegion(regionNodes, center, n, region, opts = {}) {
  const k = opts.k ?? 8
  const maxIter = opts.maxIter ?? 20
  if (!regionNodes || regionNodes.length === 0) return { nodeIds: [], warning: '빈 구역 — 노드 없음' }
  if (regionNodes.length <= n) {
    return { nodeIds: regionNodes.map(p => p.id), warning: regionNodes.length < n ? `노드 ${regionNodes.length}개 < 요청 ${n}개` : null }
  }
  const byId = new Map(regionNodes.map(p => [p.id, p]))
  const posOf = id => byId.get(id)
  const targets = idealTargets(center, n, region)
  const slotCands = targets.map(t => nearestK(t, regionNodes, k))
  const chosen = []
  const used = new Set()
  for (const cands of slotCands) {
    const pick = cands.find(id => !used.has(id)) ?? cands[0]
    chosen.push(pick); used.add(pick)
  }
  let curScore = scoreLayout(chosen.map(posOf), center, region)
  for (let iter = 0; iter < maxIter; iter++) {
    let improved = false
    for (let s = 0; s < chosen.length; s++) {
      for (const cand of slotCands[s]) {
        if (cand === chosen[s] || chosen.includes(cand)) continue
        const trial = chosen.slice(); trial[s] = cand
        const sc = scoreLayout(trial.map(posOf), center, region)
        if (sc > curScore + 1e-9) { chosen[s] = cand; curScore = sc; improved = true }
      }
    }
    if (!improved) break
  }
  return { nodeIds: chosen, warning: null }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" test -- src/data/hoistAutoLayout.test.js`
Expected: PASS (전 describe green).

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/data/hoistAutoLayout.js apps/module-unit-studio/src/data/hoistAutoLayout.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
feat(hoist-auto): 노드 스냅 + 권상 최적안 제안(결정적 그리디)

snapToNearestNode + suggestPointsForRegion(이상배치→스냅→국소개선).
부족/빈 구역 경고, 결정적 보장. 단위 테스트 포함.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 상태 스토어 — useHoistLayoutStore

**Files:**
- Create: `<APP>/src/store/useHoistLayoutStore.js`
- Test: `<APP>/src/store/useHoistLayoutStore.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`<APP>/src/store/useHoistLayoutStore.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import { useHoistLayoutStore } from './useHoistLayoutStore.js'
import { useStageStore } from './useStageStore.js'
import { StageData } from '../data/StageData.js'

const makeGridStage = () => {
  const nodes = []
  let id = 1
  for (let x = 0; x <= 100; x += 25) for (let y = 0; y <= 100; y += 25) nodes.push({ id: id++, x, y, z: 0, tags: [] })
  return new StageData({
    meta: { phase: 'C', stageName: 'C', unit: 'mm', schemaVersion: '1.1' },
    nodes, elements: [], rigids: [], properties: [], materials: [], pointMasses: [],
    healthMetrics: { totals: { bbox: { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: 0, maxZ: 0 } }, issues: {} },
  })
}

beforeEach(() => {
  useStageStore.setState({ stages: [makeGridStage()], stageSummary: null, pipeFluidEmptied: false, modelRotated: false })
  useHoistLayoutStore.setState({
    open: false, divX: 1, divY: 2, dividersX: [], dividersY: [], bbox: null, cog: null, cogSource: null,
    projectedNodes: [], massByNode: null, pointsPerRegion: {}, suggestions: {}, overrides: {}, warnings: {},
  })
})

describe('useHoistLayoutStore', () => {
  it('openEditor — 무게중심 기준 분할선 + 구역별 기본 2점 제안', () => {
    useHoistLayoutStore.getState().openEditor()
    const s = useHoistLayoutStore.getState()
    expect(s.open).toBe(true)
    expect(s.dividersY).toHaveLength(1)                 // divY=2 → 수평선 1
    expect(Object.keys(s.suggestions)).toHaveLength(2)  // 1x2 → 2구역
    for (const ids of Object.values(s.suggestions)) expect(ids.length).toBe(2)
  })
  it('setDivX(2) — 구역·맵 리셋, 분할선 재배치(2x2=4구역)', () => {
    useHoistLayoutStore.getState().openEditor()
    useHoistLayoutStore.getState().setDivX(2)
    const s = useHoistLayoutStore.getState()
    expect(s.dividersX).toHaveLength(1)
    expect(Object.keys(s.suggestions)).toHaveLength(4)
  })
  it('setDivX — 6 초과 클램프', () => {
    useHoistLayoutStore.getState().openEditor()
    useHoistLayoutStore.getState().setDivX(99)
    expect(useHoistLayoutStore.getState().divX).toBe(6)
  })
  it('setDividerX — 인접/bbox 클램프', () => {
    useHoistLayoutStore.setState({ bbox: { minX: 0, maxX: 100, minY: 0, maxY: 100 }, dividersX: [50], dividersY: [], projectedNodes: [] })
    useHoistLayoutStore.getState().setDividerX(0, 999)
    expect(useHoistLayoutStore.getState().dividersX[0]).toBe(100)
  })
  it('setRegionPointCount — 최소 2 강제', () => {
    useHoistLayoutStore.getState().openEditor()
    const rid = Object.keys(useHoistLayoutStore.getState().pointsPerRegion)[0]
    useHoistLayoutStore.getState().setRegionPointCount(rid, 1)
    expect(useHoistLayoutStore.getState().pointsPerRegion[rid]).toBe(2)
  })
  it('setRegionPoints — override 가 suggestions 에 즉시 반영', () => {
    useHoistLayoutStore.getState().openEditor()
    const rid = Object.keys(useHoistLayoutStore.getState().suggestions)[0]
    useHoistLayoutStore.getState().setRegionPoints(rid, [1, 2])
    expect(useHoistLayoutStore.getState().overrides[rid]).toEqual([1, 2])
    expect(useHoistLayoutStore.getState().suggestions[rid]).toEqual([1, 2])
    useHoistLayoutStore.getState().recomputeAll()
    expect(useHoistLayoutStore.getState().suggestions[rid]).toEqual([1, 2])  // override 보존
  })
  it('closeEditor — open=false, 상태 보존', () => {
    useHoistLayoutStore.getState().openEditor()
    useHoistLayoutStore.getState().closeEditor()
    const s = useHoistLayoutStore.getState()
    expect(s.open).toBe(false)
    expect(Object.keys(s.suggestions)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" test -- src/store/useHoistLayoutStore.test.js`
Expected: FAIL — `Failed to resolve import "./useHoistLayoutStore.js"`.

- [ ] **Step 3: 구현 작성**

`<APP>/src/store/useHoistLayoutStore.js`:
```js
import { create } from 'zustand'
import { useStageStore } from './useStageStore.js'
import { computeMassFallback } from './useEditStore.js'
import {
  projectNodesXY, computeInitialDividers, clampDivider, splitRegions,
  assignNodesToRegions, regionCenter, suggestPointsForRegion,
} from '../data/hoistAutoLayout.js'

const DIV_MIN = 1, DIV_MAX = 6, MIN_POINTS = 2
const clampDiv = (v) => Math.min(DIV_MAX, Math.max(DIV_MIN, Math.round(v || 1)))
const clampCount = (v) => Math.max(MIN_POINTS, Math.round(v || MIN_POINTS))

// 무게중심: stageSummary 우선(회전/유체비움 시 stale → 무시), 폴백 computeMassFallback, 최종 bbox 중심.
function resolveCog(stage) {
  const st = useStageStore.getState()
  const summary = (st.pipeFluidEmptied || st.modelRotated) ? null : st.stageSummary
  const c = summary?.massProperties?.centerOfGravityMm
  if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return { x: c.x, y: c.y, source: 'stageSummary' }
  const fb = computeMassFallback(stage)
  if (fb.centerOfGravityMm) return { x: fb.centerOfGravityMm.x, y: fb.centerOfGravityMm.y, source: fb.source }
  if (stage?.center) return { x: stage.center.x, y: stage.center.y, source: 'bboxCenter' }
  return { x: 0, y: 0, source: 'unavailable' }
}

function buildMassByNode(stage) {
  const m = new Map()
  for (const pm of stage?.pointMasses ?? []) {
    if (pm.mass > 0) m.set(pm.nodeId, (m.get(pm.nodeId) ?? 0) + pm.mass)
  }
  return m
}

export const useHoistLayoutStore = create((set, get) => ({
  open: false,
  divX: 1, divY: 2,
  dividersX: [], dividersY: [],
  bbox: null, cog: null, cogSource: null,
  projectedNodes: [], massByNode: null,
  pointsPerRegion: {}, suggestions: {}, overrides: {}, warnings: {},

  openEditor: () => {
    const stages = useStageStore.getState().stages
    const stage = Array.isArray(stages) && stages.length ? stages[stages.length - 1] : null
    if (!stage) { set({ open: true, bbox: null, cog: null, projectedNodes: [], suggestions: {}, warnings: {} }); return }
    const bbox = stage.bbox
    const cog = resolveCog(stage)
    const projectedNodes = projectNodesXY(stage)
    const massByNode = buildMassByNode(stage)
    const { divX, divY } = get()
    const { dividersX, dividersY } = computeInitialDividers(bbox, cog, divX, divY)
    set({ open: true, bbox, cog, cogSource: cog.source, projectedNodes, massByNode, dividersX, dividersY })
    get()._reseedCounts()
    get().recomputeAll()
  },

  closeEditor: () => set({ open: false }),

  setDivX: (n) => { set({ divX: clampDiv(n) }); get()._reanchor() },
  setDivY: (n) => { set({ divY: clampDiv(n) }); get()._reanchor() },

  setDividerX: (i, xMm) => {
    const { dividersX, bbox } = get()
    if (!bbox || i < 0 || i >= dividersX.length) return
    const lo = i === 0 ? bbox.minX : dividersX[i - 1]
    const hi = i === dividersX.length - 1 ? bbox.maxX : dividersX[i + 1]
    const next = dividersX.slice(); next[i] = clampDivider(xMm, lo, hi)
    set({ dividersX: next }); get().recomputeAll()
  },
  setDividerY: (i, yMm) => {
    const { dividersY, bbox } = get()
    if (!bbox || i < 0 || i >= dividersY.length) return
    const lo = i === 0 ? bbox.minY : dividersY[i - 1]
    const hi = i === dividersY.length - 1 ? bbox.maxY : dividersY[i + 1]
    const next = dividersY.slice(); next[i] = clampDivider(yMm, lo, hi)
    set({ dividersY: next }); get().recomputeAll()
  },

  setRegionPointCount: (regionId, n) => {
    const pointsPerRegion = { ...get().pointsPerRegion, [regionId]: clampCount(n) }
    const overrides = { ...get().overrides }; delete overrides[regionId]  // 개수 변경 → override 초기화
    set({ pointsPerRegion, overrides })
    get().recomputeAll()
  },

  setRegionPoints: (regionId, nodeIds) => {
    set({
      overrides: { ...get().overrides, [regionId]: [...nodeIds] },
      suggestions: { ...get().suggestions, [regionId]: [...nodeIds] },  // 즉시 반영(마커 드래그 피드백)
    })
  },

  // 내부: 분할선 재배치(무게중심 기준) + 맵 리셋 + 재제안
  _reanchor: () => {
    const { bbox, cog, divX, divY } = get()
    if (!bbox) return
    const { dividersX, dividersY } = computeInitialDividers(bbox, cog, divX, divY)
    set({ dividersX, dividersY })
    get()._reseedCounts()
    get().recomputeAll()
  },

  // 내부: 현재 분할선 기준 구역들의 포인트 개수를 2(또는 기존값)로 시드, override/제안 비움
  _reseedCounts: () => {
    const { bbox, dividersX, dividersY, pointsPerRegion: prev } = get()
    const regions = bbox ? splitRegions(bbox, dividersX, dividersY) : []
    const pointsPerRegion = {}
    for (const r of regions) pointsPerRegion[r.id] = clampCount(prev[r.id] ?? MIN_POINTS)
    set({ pointsPerRegion, suggestions: {}, overrides: {}, warnings: {} })
  },

  recomputeAll: () => {
    const { bbox, dividersX, dividersY, projectedNodes, massByNode, pointsPerRegion, overrides } = get()
    if (!bbox) { set({ suggestions: {}, warnings: {} }); return }
    const regions = splitRegions(bbox, dividersX, dividersY)
    const assign = assignNodesToRegions(projectedNodes, regions, dividersX, dividersY)
    const byId = new Map(projectedNodes.map(p => [p.id, p]))
    const suggestions = {}, warnings = {}
    for (const r of regions) {
      if (overrides[r.id]) { suggestions[r.id] = overrides[r.id]; continue }
      const nodes = (assign[r.id] ?? []).map(id => byId.get(id)).filter(Boolean)
      const center = regionCenter(nodes, massByNode) ?? { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }
      const n = clampCount(pointsPerRegion[r.id] ?? MIN_POINTS)
      const res = suggestPointsForRegion(nodes, center, n, r)
      suggestions[r.id] = res.nodeIds
      if (res.warning) warnings[r.id] = res.warning
    }
    set({ suggestions, warnings })
  },
}))
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" test -- src/store/useHoistLayoutStore.test.js`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/store/useHoistLayoutStore.js apps/module-unit-studio/src/store/useHoistLayoutStore.test.js
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
feat(hoist-auto): useHoistLayoutStore — 분할/구역/제안/override 상태

openEditor(무게중심 분할선+기본 2점 제안)/setDivX·Y(리셋·재배치,1~6)/
setDividerX·Y(클램프)/setRegionPointCount(최소2)/setRegionPoints(즉시반영)/
recomputeAll. computeMassFallback 재사용. 단위 테스트 포함.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: SVG 모달 컴포넌트 — HoistAutoLayoutEditor.jsx

**Files:**
- Create: `<APP>/src/components/HoistAutoLayoutEditor.jsx`

> **테스트:** DOM 환경(jsdom)·testing-library 부재로 컴포넌트 렌더 단위 테스트는 두지 않는다. 모든 로직은 Task 1~4(순수함수+스토어)에서 검증됨. 본 컴포넌트는 **build 통과 + 수동 체크**로 검증한다.

- [ ] **Step 1: 컴포넌트 작성**

`<APP>/src/components/HoistAutoLayoutEditor.jsx`:
```jsx
import { useRef } from 'react'
import { X, Sparkles } from 'lucide-react'
import { useHoistLayoutStore } from '../store/useHoistLayoutStore.js'
import { splitRegions, assignNodesToRegions, fitTransform, snapToNearestNode } from '../data/hoistAutoLayout.js'

const SVG_W = 1040, SVG_H = 600, PAD = 40
const NODE_CAP = 4000  // 너무 많은 노드는 표시용으로만 샘플링

export default function HoistAutoLayoutEditor() {
  const open = useHoistLayoutStore(s => s.open)
  const divX = useHoistLayoutStore(s => s.divX)
  const divY = useHoistLayoutStore(s => s.divY)
  const dividersX = useHoistLayoutStore(s => s.dividersX)
  const dividersY = useHoistLayoutStore(s => s.dividersY)
  const bbox = useHoistLayoutStore(s => s.bbox)
  const cog = useHoistLayoutStore(s => s.cog)
  const cogSource = useHoistLayoutStore(s => s.cogSource)
  const projectedNodes = useHoistLayoutStore(s => s.projectedNodes)
  const suggestions = useHoistLayoutStore(s => s.suggestions)
  const warnings = useHoistLayoutStore(s => s.warnings)
  const pointsPerRegion = useHoistLayoutStore(s => s.pointsPerRegion)
  const setDivX = useHoistLayoutStore(s => s.setDivX)
  const setDivY = useHoistLayoutStore(s => s.setDivY)
  const setDividerX = useHoistLayoutStore(s => s.setDividerX)
  const setDividerY = useHoistLayoutStore(s => s.setDividerY)
  const setRegionPointCount = useHoistLayoutStore(s => s.setRegionPointCount)
  const setRegionPoints = useHoistLayoutStore(s => s.setRegionPoints)
  const closeEditor = useHoistLayoutStore(s => s.closeEditor)

  const svgRef = useRef(null)
  const dragRef = useRef(null)  // {type:'divX'|'divY'|'marker', index?, regionId?, slot?}

  if (!open) return null

  const ready = !!bbox && Array.isArray(projectedNodes) && projectedNodes.length > 0
  const t = ready ? fitTransform(bbox, SVG_W, SVG_H, PAD) : null
  const regions = ready ? splitRegions(bbox, dividersX, dividersY) : []
  const assign = ready ? assignNodesToRegions(projectedNodes, regions, dividersX, dividersY) : {}
  const byId = new Map((projectedNodes ?? []).map(p => [p.id, p]))
  const shownNodes = ready && projectedNodes.length > NODE_CAP
    ? projectedNodes.filter((_, i) => i % Math.ceil(projectedNodes.length / NODE_CAP) === 0)
    : (projectedNodes ?? [])
  const totalPoints = Object.values(suggestions).reduce((s, ids) => s + (ids?.length ?? 0), 0)

  const clientToModel = (evt) => {
    const svg = svgRef.current
    if (!svg || !t) return null
    const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY
    const m = svg.getScreenCTM(); if (!m) return null
    const p = pt.matrixTransform(m.inverse())
    return t.toModel(p.x, p.y)
  }
  const startDrag = (evt, payload) => {
    evt.stopPropagation()
    dragRef.current = payload
    try { svgRef.current.setPointerCapture(evt.pointerId) } catch { /* noop */ }
  }
  const onPointerMove = (evt) => {
    const d = dragRef.current
    if (!d) return
    const mp = clientToModel(evt); if (!mp) return
    if (d.type === 'divX') setDividerX(d.index, mp.x)
    else if (d.type === 'divY') setDividerY(d.index, mp.y)
    else if (d.type === 'marker') {
      const cands = (assign[d.regionId] ?? []).map(id => byId.get(id)).filter(Boolean)
      const snapId = snapToNearestNode(mp, cands)
      if (snapId != null) {
        const cur = (suggestions[d.regionId] ?? []).slice()
        if (cur[d.slot] !== snapId && !cur.includes(snapId)) { cur[d.slot] = snapId; setRegionPoints(d.regionId, cur) }
      }
    }
  }
  const endDrag = (evt) => {
    if (dragRef.current && svgRef.current) { try { svgRef.current.releasePointerCapture(evt.pointerId) } catch { /* noop */ } }
    dragRef.current = null
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(4,4,16,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 'min(1160px, 94vw)', height: 'min(800px, 92vh)', background: '#0b0b1e',
        border: '1px solid #25254a', borderRadius: 12, boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', userSelect: 'none',
      }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid #1e1e38' }}>
          <Sparkles size={16} color="#90E8FF" />
          <span style={{ fontSize: 14, fontWeight: 900, color: '#90E8FF', letterSpacing: 0.6 }}>권상 위치 자동 선정</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
            <label style={{ fontSize: 11, color: '#8aa0b8' }}>X 구역</label>
            <input type="number" min={1} max={6} value={divX}
              onChange={e => setDivX(Number(e.target.value))}
              style={numInput} />
            <span style={{ color: '#60708a' }}>×</span>
            <label style={{ fontSize: 11, color: '#8aa0b8' }}>Y 구역</label>
            <input type="number" min={1} max={6} value={divY}
              onChange={e => setDivY(Number(e.target.value))}
              style={numInput} />
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: '#60708a' }}>
            무게중심: {cogSource === 'bboxCenter' ? 'bbox 중심(질량 미확인)' : cogSource === 'unavailable' ? '없음' : '질량 기준'}
          </span>
          <button onClick={closeEditor} aria-label="닫기" style={iconBtn}><X size={16} /></button>
        </div>

        {/* SVG 영역 */}
        <div style={{ flex: 1, minHeight: 0, padding: 10, display: 'flex' }}>
          {!ready ? (
            <div style={{ margin: 'auto', color: '#8aa0b8', fontSize: 13 }}>
              모델을 먼저 로드하세요. (노드가 있어야 구역 분할이 가능합니다)
            </div>
          ) : (
            <svg ref={svgRef} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              style={{ width: '100%', height: '100%', background: '#07071a', borderRadius: 8, touchAction: 'none' }}
              onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
              {/* bbox */}
              {(() => { const a = t.toScreen(bbox.minX, bbox.maxY), b = t.toScreen(bbox.maxX, bbox.minY)
                return <rect x={a.sx} y={a.sy} width={b.sx - a.sx} height={b.sy - a.sy} fill="none" stroke="#1e2a44" strokeWidth={1} /> })()}
              {/* 노드 점 */}
              {shownNodes.map(p => { const s = t.toScreen(p.x, p.y)
                return <circle key={p.id} cx={s.sx} cy={s.sy} r={1.4} fill="#3a4566" /> })}
              {/* 구역 사각형 + 라벨/입력 */}
              {regions.map((r, i) => {
                const tl = t.toScreen(r.minX, r.maxY), br = t.toScreen(r.maxX, r.minY)
                const c = t.toScreen((r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2)
                const warn = warnings[r.id]
                return (
                  <g key={r.id}>
                    <rect x={tl.sx} y={tl.sy} width={br.sx - tl.sx} height={br.sy - tl.sy}
                      fill={i % 2 ? 'rgba(0,209,255,0.03)' : 'rgba(181,124,255,0.03)'} stroke="#2a2a4a" strokeWidth={1} />
                    <foreignObject x={c.sx - 52} y={c.sy - 18} width={104} height={36}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: '100%' }}>
                        <span style={{ fontSize: 10, color: '#8aa0b8', whiteSpace: 'nowrap' }}>구역 {i + 1}</span>
                        <input type="number" min={2} value={pointsPerRegion[r.id] ?? 2}
                          onChange={e => setRegionPointCount(r.id, Number(e.target.value))}
                          title="권상 포인트 개수(최소 2)"
                          style={{ width: 38, ...numInput, padding: '2px 4px' }} />
                        {warn && <span title={warn} style={{ color: '#FFC857', fontSize: 12 }}>⚠</span>}
                      </div>
                    </foreignObject>
                  </g>
                )
              })}
              {/* 수직 분할선(드래그) */}
              {dividersX.map((xv, i) => { const s = t.toScreen(xv, 0)
                return (
                  <g key={`vx${i}`} style={{ cursor: 'ew-resize' }}>
                    <line x1={s.sx} y1={t.toScreen(0, bbox.maxY).sy} x2={s.sx} y2={t.toScreen(0, bbox.minY).sy} stroke="#00D1FF" strokeWidth={1.5} />
                    <line x1={s.sx} y1={0} x2={s.sx} y2={SVG_H} stroke="transparent" strokeWidth={14}
                      onPointerDown={e => startDrag(e, { type: 'divX', index: i })} />
                  </g>
                )
              })}
              {/* 수평 분할선(드래그) */}
              {dividersY.map((yv, i) => { const s = t.toScreen(0, yv)
                return (
                  <g key={`hy${i}`} style={{ cursor: 'ns-resize' }}>
                    <line x1={t.toScreen(bbox.minX, 0).sx} y1={s.sy} x2={t.toScreen(bbox.maxX, 0).sx} y2={s.sy} stroke="#00D1FF" strokeWidth={1.5} />
                    <line x1={0} y1={s.sy} x2={SVG_W} y2={s.sy} stroke="transparent" strokeWidth={14}
                      onPointerDown={e => startDrag(e, { type: 'divY', index: i })} />
                  </g>
                )
              })}
              {/* 무게중심 G */}
              {cog && (() => { const s = t.toScreen(cog.x, cog.y)
                return (
                  <g>
                    <line x1={s.sx - 9} y1={s.sy} x2={s.sx + 9} y2={s.sy} stroke="#FFD700" strokeWidth={1.5} />
                    <line x1={s.sx} y1={s.sy - 9} x2={s.sx} y2={s.sy + 9} stroke="#FFD700" strokeWidth={1.5} />
                    <circle cx={s.sx} cy={s.sy} r={5} fill="none" stroke="#FFD700" strokeWidth={2} />
                    <text x={s.sx + 8} y={s.sy - 8} fontSize={11} fill="#FFD700" fontWeight={800}>G</text>
                  </g>
                )
              })()}
              {/* 제안 권상 포인트(드래그=노드 재스냅) */}
              {regions.map(r => (suggestions[r.id] ?? []).map((nid, slot) => {
                const p = byId.get(nid); if (!p) return null
                const s = t.toScreen(p.x, p.y)
                return (
                  <g key={`${r.id}_${slot}`} style={{ cursor: 'grab' }}
                    onPointerDown={e => startDrag(e, { type: 'marker', regionId: r.id, slot })}>
                    <rect x={s.sx - 5} y={s.sy - 5} width={10} height={10} transform={`rotate(45 ${s.sx} ${s.sy})`}
                      fill="#FF66AA" stroke="#fff" strokeWidth={1} />
                  </g>
                )
              }))}
            </svg>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', borderTop: '1px solid #1e1e38', fontSize: 11, color: '#8aa0b8' }}>
          <span>· 노드</span><span style={{ color: '#FFD700' }}>● 무게중심 G</span>
          <span style={{ color: '#00D1FF' }}>─ 분할선(드래그)</span>
          <span style={{ color: '#FF66AA' }}>◆ 권상 포인트(드래그=노드 재스냅)</span>
          <div style={{ flex: 1 }} />
          <span>총 {regions.length}구역 · 권상 포인트 {totalPoints}개</span>
          <button onClick={closeEditor} style={primaryBtn}>닫기</button>
        </div>
      </div>
    </div>
  )
}

const numInput = {
  width: 46, background: '#101024', color: '#E8FBFF', border: '1px solid #2a2a4a',
  borderRadius: 5, padding: '3px 6px', fontSize: 11, textAlign: 'center',
}
const iconBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
  background: '#101024', color: '#8aa0b8', border: '1px solid #2a2a4a', borderRadius: 6, cursor: 'pointer',
}
const primaryBtn = {
  background: 'rgba(0,209,255,0.16)', color: '#E8FBFF', border: '1px solid #00D1FF',
  borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
}
```

- [ ] **Step 2: build 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run build`
Expected: SUCCESS (`vite build` 에러 없이 dist 생성). lucide-react `X`/`Sparkles` import 해소 확인.

- [ ] **Step 3: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/components/HoistAutoLayoutEditor.jsx
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
feat(hoist-auto): HoistAutoLayoutEditor SVG 모달

XY 투영·무게중심·드래그 분할선·구역별 포인트 입력·제안 마커(드래그 재스냅).
좌표는 fitTransform/순수함수에 위임, getScreenCTM 으로 정확한 포인터 매핑.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Hoist 패널 연결 — 버튼 + 요약 + 모달 마운트

**Files:**
- Modify: `<APP>/src/components/HoistPositionPanel.jsx`

> **테스트:** 패널은 store 호출/모달 마운트 wiring 뿐. build + 수동 체크로 검증.

- [ ] **Step 1: import 추가** (`HoistPositionPanel.jsx` 상단)

`import Tooltip from './Tooltip.jsx'` 줄(13행) 바로 아래에 추가:
```jsx
import { useHoistLayoutStore } from '../store/useHoistLayoutStore.js'
import HoistAutoLayoutEditor from './HoistAutoLayoutEditor.jsx'
```
그리고 1행의 lucide 아이콘 import 에 `Sparkles` 추가 — 1행을 다음으로 교체:
```jsx
import { ClipboardList, Loader2, Play, Plus, Sparkles, Trash2, X } from 'lucide-react'
```

- [ ] **Step 2: store 훅 + 핸들러 추가**

`export default function HoistPositionPanel() {` 본문에서 기존 마지막 훅 줄
`const openStabilityPanel = useStabilityStore(s => s.openPanel)` (83행 부근) 바로 아래에 추가:
```jsx
  const openAutoLayout = useHoistLayoutStore(s => s.openEditor)
  const autoRegionCount = useHoistLayoutStore(s => Object.keys(s.suggestions).length)
  const autoPointCount = useHoistLayoutStore(s => Object.values(s.suggestions).reduce((n, ids) => n + (ids?.length ?? 0), 0))
  const hasModel = (stages?.length ?? 0) > 0
```

- [ ] **Step 3: 버튼 블록 + 모달 마운트 삽입**

제목 div(권상(Hoisting) 위치 설정, 152~154행)의 닫는 `</div>` 바로 아래, `<StepFlow .../>` (157행) 위에 삽입:
```jsx
      {/* ── 권상 위치 자동 선정 (독립 도구) ── */}
      <button
        onClick={() => { if (hasModel) openAutoLayout() }}
        disabled={!hasModel}
        title={hasModel ? 'XY 구역 분할 + 권상 최적안 자동 제안' : '모델을 먼저 로드하세요'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '7px 10px', borderRadius: 7, width: '100%',
          background: hasModel ? 'linear-gradient(90deg, rgba(0,209,255,0.18), rgba(181,124,255,0.18))' : '#101024',
          color: hasModel ? '#E8FBFF' : '#4a5a72',
          border: `1px solid ${hasModel ? '#00D1FF' : '#2a2a4a'}`,
          cursor: hasModel ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 800,
        }}>
        <Sparkles size={14} /> 권상 위치 자동 선정
      </button>
      {autoRegionCount > 0 && (
        <div style={{ fontSize: 10.5, color: '#8aa0b8', textAlign: 'center', marginTop: -2 }}>
          자동 선정: {autoRegionCount}구역 · 권상 포인트 {autoPointCount}개
        </div>
      )}

      {/* XY 모달 — open 상태일 때만 렌더 */}
      <HoistAutoLayoutEditor />
```

- [ ] **Step 4: build 통과 확인**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run build`
Expected: SUCCESS.

- [ ] **Step 5: 전체 테스트 재확인 (회귀 없음)**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" test`
Expected: PASS — 기존 + 신규(hoistAutoLayout, useHoistLayoutStore) 전부 green.

- [ ] **Step 6: 커밋**

```bash
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" add apps/module-unit-studio/src/components/HoistPositionPanel.jsx
git -C "C:/Coding/WorkBenchSubModule/ModuleUnitStudio" commit -m "$(cat <<'EOF'
feat(hoist-auto): Hoist 패널에 "권상 위치 자동 선정" 버튼·요약·모달 연결

모델 로드 시 활성, 클릭→XY 모달. 자동 선정 구역/포인트 수 요약 표시.
기존 수동 Hoist 흐름은 불변.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 수동 검증 체크리스트 (dev 서버)

**Files:** (없음 — 검증만)

> 자동 테스트로 커버 불가한 인터랙션을 dev 서버에서 직접 확인한다. WorkBench 앱이 아니라 스튜디오 단독 dev 로 빠르게 확인 가능.

- [ ] **Step 1: dev 서버 기동**

Run: `npm --prefix "C:/Coding/WorkBenchSubModule/ModuleUnitStudio/apps/module-unit-studio" run dev`
(브라우저에서 표시된 로컬 URL 열기. 모델 JSON 폴더/파일 로드)

- [ ] **Step 2: 기능 수동 확인**

다음을 차례로 확인:
- Hoist 탭 → "권상 위치 자동 선정" 버튼 클릭 → 모달 오픈, 모델 풋프린트·무게중심 G·노드 점 표시.
- X 구역=1, Y 구역=2 기본 → 수평 분할선 1개가 무게중심 Y 에 위치, 2구역.
- 각 구역에 ◆ 권상 포인트 2개가 균형 잡히게(양쪽) 표시.
- 수평 분할선을 위/아래로 드래그 → 구역·제안이 실시간 갱신.
- X 구역=2 로 변경 → 2×2=4구역, 분할선 교점이 무게중심 부근.
- 한 구역 포인트 수를 3 또는 4 로 변경 → 그 구역 제안이 즉시 재계산(삼각/사각).
- ◆ 마커를 드래그 → 그 구역 내 가장 가까운 노드로 스냅 이동.
- 닫기 → 패널에 "자동 선정: N구역 · 권상 포인트 M개" 요약 표시. 다시 열면 상태 복원.

- [ ] **Step 3: dev 서버 종료**

(터미널 Ctrl+C 로 종료. 코드 변경 없음 → 커밋 없음.)

---

## 자체 검토 (writing-plans self-review 결과)

**1. 스펙 커버리지**
- §4 좌표/투영 → Task1 `projectNodesXY`/`fitTransform`. §5 분할 의미·초기위치·드래그 클램프 → Task1 `computeInitialDividers`/`clampDivider` + Task4 `setDividerX/Y`. §6 구역모델/regionId/노드배정 → Task1 `splitRegions`/`assignNodesToRegions`. §7 최적안(중심·점수·탐색) → Task2+Task3. §8 편집모델(개수·드래그·보존) → Task4 `setRegionPointCount`/`setRegionPoints` + Task5 마커 드래그. §9 파일/store/컴포넌트 → Task1~6. §10 엣지(미로드·CoG폴백·빈구역·클램프) → Task4 `resolveCog`/`recomputeAll`, Task5 ready 가드, Task6 disabled. §11 테스트 → Task1~4. §12 배포 → 계획 외(승인 게이트) 명시. **갭 없음.**

**2. Placeholder 스캔:** "TBD/추후/적절히" 없음. 모든 코드/명령/기대출력 구체.

**3. 타입/이름 일관성:** 함수 시그니처 표와 Task 내 정의·호출이 일치(`assignNodesToRegions(projectedNodes,regions,dividersX,dividersY)`, `suggestPointsForRegion(...,{nodeIds,warning})`, store 키 `pointsPerRegion/suggestions/overrides/warnings`). regionId 체계 `c{col}_r{row}` 전 Task 동일.

---

## 실행 후 (모든 Task 완료 시)

배포(버전 bump·`npm run package`·StudioProgram 로컬+UNC 복사)는 **사용자 별도 승인 후** 진행한다(스펙 §12). 스튜디오 zip 배포는 git pull 로 안 따라오므로 수동 복사 대상임을 보고할 것.
