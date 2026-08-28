/**
 * 유한요소 연결도 → 렌더링용 인덱스 변환 (순수 함수).
 *
 * FeModelViewer 에서 분리해 둔 이유는 두 가지다.
 *  1. 6만 요소 규모에서 인덱스가 하나만 어긋나도 화면이 조용히 깨진다 — 단위 테스트가 필요하다.
 *  2. three.js·React 의존 없이 Node 에서 그대로 돌릴 수 있다.
 *
 * 입력 연결도는 백엔드 슬림 페이로드의 **0-based 절점 인덱스**다(node id 가 아니다).
 */

/**
 * 쉘 연결도를 삼각형 인덱스로 변환한다. CQUAD4 는 대각선 (0-2) 로 두 삼각형으로 나눈다.
 *
 * @param {number[]} quads 4개씩 묶인 쿼드 연결도
 * @param {number[]} trias 3개씩 묶인 삼각형 연결도
 * @returns {number[]} 3개씩 묶인 삼각형 인덱스
 */
export function buildTriangleIndices(quads = [], trias = []) {
  const out = [];
  for (let i = 0; i + 3 < quads.length; i += 4) {
    const a = quads[i], b = quads[i + 1], c = quads[i + 2], d = quads[i + 3];
    out.push(a, b, c, a, c, d);
  }
  for (let i = 0; i + 2 < trias.length; i += 3) {
    out.push(trias[i], trias[i + 1], trias[i + 2]);
  }
  return out;
}

/**
 * 쉘 요소의 **요소 경계선**을 만든다.
 *
 * 인접한 두 요소가 공유하는 변은 한 번만 그린다. 중복을 남기면 63,392 CQUAD4 기준
 * 25만 선분이 겹쳐 그려져 GPU 낭비일 뿐 아니라, 반투명 표시에서 공유 변만 진하게 보인다.
 *
 * @param {number[]} quads
 * @param {number[]} trias
 * @param {number} nodeCount 절점 수 — 정점쌍을 하나의 정수 키로 접는 데 쓴다.
 * @returns {number[]} 2개씩 묶인 선분 인덱스
 */
export function buildShellEdgeIndices(quads = [], trias = [], nodeCount = 0) {
  const seen = new Set();
  const out = [];

  const push = (a, b) => {
    if (a === b) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    // 정점쌍 → 유일한 정수 키. nodeCount 를 진법으로 쓰면 (lo,hi) 조합이 충돌하지 않는다.
    const key = lo * nodeCount + hi;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(lo, hi);
  };

  for (let i = 0; i + 3 < quads.length; i += 4) {
    const a = quads[i], b = quads[i + 1], c = quads[i + 2], d = quads[i + 3];
    push(a, b); push(b, c); push(c, d); push(d, a);
  }
  for (let i = 0; i + 2 < trias.length; i += 3) {
    const a = trias[i], b = trias[i + 1], c = trias[i + 2];
    push(a, b); push(b, c); push(c, a);
  }
  return out;
}

/**
 * 인덱스 배열을 GPU 로 올릴 TypedArray 로 만든다.
 *
 * ⚠ 절점이 65,535 개를 넘으면 Uint16 으로는 표현할 수 없다(정반만 66,816 개).
 *   조용히 잘린 인덱스는 모델을 엉뚱하게 이어 붙인 형상으로 만들기 때문에 경계값이 중요하다.
 */
export function toIndexArray(indices, vertexCount) {
  return vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
}

/**
 * Module Unit 배치 좌표 계산.
 *
 * 규칙(사용자 확정):
 *  · Module Unit 은 자체 XY 중심·바닥면을 기준점(anchor)으로 삼는다 → 회전축이 자기 평면 중심이 된다.
 *  · 기본 배치 = 정반 전체 XY 중심 정렬 + 정반 상면에서 gapMm 만큼 위.
 *
 * @param {{min:number[],max:number[]}} deckBounds   정반 바운딩박스
 * @param {{min:number[],max:number[]}|null} moduleBounds Module Unit 바운딩박스
 * @param {{gapMm:number,offsetXMm:number,offsetYMm:number}} arrangement
 */
export function computeModulePlacement(deckBounds, moduleBounds, arrangement) {
  if (!deckBounds?.min || !deckBounds?.max) return null;
  const { min: dMin, max: dMax } = deckBounds;
  const deckTopZ = dMax[2];
  const deckCenter = [(dMin[0] + dMax[0]) / 2, (dMin[1] + dMax[1]) / 2];

  if (!moduleBounds?.min || !moduleBounds?.max) {
    return { deckTopZ, deckCenter, anchor: null, position: null, moduleSize: null };
  }

  const { min: mMin, max: mMax } = moduleBounds;
  const anchor = [(mMin[0] + mMax[0]) / 2, (mMin[1] + mMax[1]) / 2, mMin[2]];
  const position = [
    deckCenter[0] + (arrangement?.offsetXMm ?? 0),
    deckCenter[1] + (arrangement?.offsetYMm ?? 0),
    deckTopZ + (arrangement?.gapMm ?? 0),
  ];

  return {
    deckTopZ,
    deckCenter,
    anchor,
    position,
    moduleBottomZ: position[2],
    moduleTopZ: position[2] + (mMax[2] - mMin[2]),
    moduleSize: [mMax[0] - mMin[0], mMax[1] - mMin[1], mMax[2] - mMin[2]],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 적치(seating) — Module Unit 을 정반 상판에 내려 앉히기
 *
 * 왜 절점만 검사해도 되나:
 *   접촉 상대가 수평 평면(정반 상판)이면, 빔 선분이나 쉘 삼각형 위의 최저점은
 *   반드시 꼭짓점에서 발생한다(선형 보간). 그래서 절점 검사는 근사가 아니라 **정확**하다.
 *   삼각형-삼각형 교차나 물리엔진이 필요 없다.
 *
 * 왜 상판과 '정반 전체'를 나눠서 보나 (A타입은 2단 정반이다):
 *   내림량은 **상판 위 절점만으로** 정한다(적치 의도). 그러면 상판 밖으로 나간 부분이
 *   상판보다 아래로 내려가는데, A타입은 상판(Z=8026) 아래 6m 지점에 하단(Z=2020)이
 *   또 있어서 그 자체로는 관통이 아니다. 그래서 관통은 **정반 실형상 높이맵**에
 *   따로 물어본다. 이 둘을 섞으면(=아무 면에나 먼저 닿으면 정지) 지지부가 상판을
 *   비껴가는 순간 모듈이 6m 아래로 떨어져 적치가 성립하지 않는다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 삼각형 인덱스 배열을 (a,b,c) 3개씩 순회하며 콜백. 쉘이 없는 순수 빔 모델이면 아무것도 안 한다. */
function forEachShellTriangle(model, fn) {
  const quads = model?.quads || [];
  const trias = model?.trias || [];
  for (let i = 0; i + 3 < quads.length; i += 4) {
    const a = quads[i], b = quads[i + 1], c = quads[i + 2], d = quads[i + 3];
    fn(a, b, c); fn(a, c, d);
  }
  for (let i = 0; i + 2 < trias.length; i += 3) fn(trias[i], trias[i + 1], trias[i + 2]);
}

/**
 * 정반 모델에서 '적치면' 정보를 뽑는다. 정반 타입당 1회만 만들고 재사용할 것.
 *
 * 두 가지를 만든다.
 *   · plate  — 상판(가장 높은 수평면) 삼각형들. 내림량 계산의 접촉 대상.
 *   · grid   — 모든 수평면을 XY 격자에 담은 높이맵. 관통 검사용.
 * 수직 웨브(|nz| 작음)는 수직 낙하를 막지 못하므로 둘 다에서 제외한다.
 *
 * @param {object} deckModel 슬림 지오메트리(positions/quads/trias)
 */
export function buildDeckSurface(deckModel, {
  horizontalDot = 0.5,   // |nz|/|n| 이 이 값 이상이면 '수평면'으로 본다
  topTolMm = 1,          // 상판으로 묶을 z 허용오차
  cellMm = 400,          // 높이맵 격자 크기
} = {}) {
  const P = deckModel?.positions;
  if (!P || P.length < 9) return null;

  const horiz = [];   // [ax,ay,az, bx,by,bz, cx,cy,cz]
  let topZ = -Infinity;

  forEachShellTriangle(deckModel, (a, b, c) => {
    const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
    const bx = P[3 * b], by = P[3 * b + 1], bz = P[3 * b + 2];
    const cx = P[3 * c], cy = P[3 * c + 1], cz = P[3 * c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0 || Math.abs(nz) / len < horizontalDot) return;
    horiz.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const hi = Math.max(az, bz, cz);
    if (hi > topZ) topZ = hi;
  });

  if (!horiz.length) return null;

  // 상판 = 세 꼭짓점이 모두 최고 높이에 있는 삼각형.
  const plate = [];
  let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity, plateArea = 0;
  for (let i = 0; i < horiz.length; i += 9) {
    if (Math.abs(horiz[i + 2] - topZ) > topTolMm) continue;
    if (Math.abs(horiz[i + 5] - topZ) > topTolMm) continue;
    if (Math.abs(horiz[i + 8] - topZ) > topTolMm) continue;
    const ax = horiz[i], ay = horiz[i + 1];
    const bx = horiz[i + 3], by = horiz[i + 4];
    const cx = horiz[i + 6], cy = horiz[i + 7];
    plate.push(ax, ay, bx, by, cx, cy);
    plateArea += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    px0 = Math.min(px0, ax, bx, cx); px1 = Math.max(px1, ax, bx, cx);
    py0 = Math.min(py0, ay, by, cy); py1 = Math.max(py1, ay, by, cy);
  }
  if (!plate.length) return null;

  // 상판이 bbox 를 꽉 채우면(현재 A·B 정반이 그렇다) 점 판정을 bbox 비교로 끝낼 수 있다.
  // 구멍이 뚫린 정반이 들어오면 자동으로 삼각형 판정으로 떨어진다.
  const bboxArea = (px1 - px0) * (py1 - py0);
  const plateIsSolidRect = bboxArea > 0 && Math.abs(plateArea - bboxArea) / bboxArea < 0.02;

  // 높이맵 — 수평면 삼각형을 XY 격자 칸에 등록한다.
  const grid = new Map();
  for (let i = 0; i < horiz.length; i += 9) {
    const x0 = Math.min(horiz[i], horiz[i + 3], horiz[i + 6]);
    const x1 = Math.max(horiz[i], horiz[i + 3], horiz[i + 6]);
    const y0 = Math.min(horiz[i + 1], horiz[i + 4], horiz[i + 7]);
    const y1 = Math.max(horiz[i + 1], horiz[i + 4], horiz[i + 7]);
    for (let ix = Math.floor(x0 / cellMm); ix <= Math.floor(x1 / cellMm); ix += 1) {
      for (let iy = Math.floor(y0 / cellMm); iy <= Math.floor(y1 / cellMm); iy += 1) {
        const key = `${ix},${iy}`;
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(i);
      }
    }
  }

  return { topZ, plate, plateArea, plateIsSolidRect, plateBBox: [px0, py0, px1, py1], horiz, grid, cellMm };
}

/** 점 (x,y) 가 삼각형 (2D) 안인지. 경계 포함. */
function pointInTri2D(x, y, ax, ay, bx, by, cx, cy) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-9) return null;
  const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
  const w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
  const w3 = 1 - w1 - w2;
  if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) return null;
  return [w1, w2, w3];
}

/**
 * (x,y) 가 상판 영역 안인가.
 *
 * ⚠ 경계 판정에 여유(EPS)가 필요하다. 회전 행렬에 cos(270°) = -1.8e-16 같은 값이 들어가
 *   상판 끝에 정확히 걸친 절점이 x = -7e-14 로 밀린다. 여유가 없으면 그 지지점이 통째로
 *   빠져 버려서, 거울상인 90°/270° 가 서로 다른 지지점 수를 갖는 것처럼 보인다.
 *   1e-6 mm 는 물리적으로 무의미한 크기라 판정을 왜곡하지 않는다.
 */
const PLATE_EPS_MM = 1e-6;

export function isOnPlate(surface, x, y) {
  const [x0, y0, x1, y1] = surface.plateBBox;
  if (x < x0 - PLATE_EPS_MM || x > x1 + PLATE_EPS_MM
      || y < y0 - PLATE_EPS_MM || y > y1 + PLATE_EPS_MM) return false;
  if (surface.plateIsSolidRect) return true;
  const p = surface.plate;
  for (let i = 0; i < p.length; i += 6) {
    if (pointInTri2D(x, y, p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5])) return true;
  }
  return false;
}

/** (x,y) 바로 아래·위 정반 수평면 중 가장 높은 z. 아무것도 없으면 null(허공). */
export function deckSurfaceZAt(surface, x, y) {
  const bucket = surface.grid.get(`${Math.floor(x / surface.cellMm)},${Math.floor(y / surface.cellMm)}`);
  if (!bucket) return null;
  const H = surface.horiz;
  let best = null;
  for (let k = 0; k < bucket.length; k += 1) {
    const i = bucket[k];
    const w = pointInTri2D(x, y, H[i], H[i + 1], H[i + 3], H[i + 4], H[i + 6], H[i + 7]);
    if (!w) continue;
    const z = w[0] * H[i + 2] + w[1] * H[i + 5] + w[2] * H[i + 8];
    if (best === null || z > best) best = z;
  }
  return best;
}

/**
 * Module Unit 절점을 anchor 기준 로컬 좌표로 한 번만 펴 둔다.
 * 회전각을 스윕할 때 매번 다시 만들지 않기 위한 준비 단계다.
 */
export function prepareModuleFootprint(moduleModel) {
  const P = moduleModel?.positions;
  const b = moduleModel?.bounds;
  if (!P || !b?.min || !b?.max) return null;
  const ax = (b.min[0] + b.max[0]) / 2;
  const ay = (b.min[1] + b.max[1]) / 2;
  const az = b.min[2];
  const n = Math.floor(P.length / 3);
  const local = new Float64Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    local[3 * i] = P[3 * i] - ax;
    local[3 * i + 1] = P[3 * i + 1] - ay;
    local[3 * i + 2] = P[3 * i + 2] - az;
  }
  return { local, count: n, anchor: [ax, ay, az] };
}

/**
 * Module Unit 을 정반 상판에 앉힌다.
 *
 * 반환 gapMm 을 arrangement.gapMm 에 그대로 넣으면 상판에 접촉한 배치가 된다.
 * (기존 배치식이 position.z = deckTopZ + gapMm 이므로, 접촉 조건은 gapMm = -min(로컬z) 이다.)
 *
 * @returns {{
 *   ok: boolean, reason: string|null, gapMm: number,
 *   onPlateCount: number, offPlateCount: number,
 *   contacts: Array<{x:number,y:number,z:number}>, contactSpan: [number,number], contactHullArea: number,
 *   supportsCentroid: boolean,
 *   penetrationCount: number, penetrationMaxMm: number,
 * }|null}
 */
export function computeSeating(surface, footprint, {
  deckCenter,           // [x, y] — 배치 기준점(현재 앱은 정반 바운딩박스 XY 중심)
  offsetXMm = 0,
  offsetYMm = 0,
  rotationZDeg = 0,
  contactTolMm = 50,
  checkPenetration = true,
} = {}) {
  if (!surface || !footprint || !deckCenter) return null;

  const cx = deckCenter[0] + offsetXMm;
  const cy = deckCenter[1] + offsetYMm;
  const th = (rotationZDeg * Math.PI) / 180;
  const cs = Math.cos(th), sn = Math.sin(th);
  const { local, count } = footprint;

  // ── 1) 상판 위 절점만 모아 내림량을 정한다 ────────────────────────────
  let minLocalZ = Infinity;
  let onPlate = 0;
  const worldX = new Float64Array(count);
  const worldY = new Float64Array(count);
  const onPlateFlag = new Uint8Array(count);

  for (let i = 0; i < count; i += 1) {
    const lx = local[3 * i], ly = local[3 * i + 1], lz = local[3 * i + 2];
    const X = cx + lx * cs - ly * sn;
    const Y = cy + lx * sn + ly * cs;
    worldX[i] = X; worldY[i] = Y;
    if (isOnPlate(surface, X, Y)) {
      onPlateFlag[i] = 1;
      onPlate += 1;
      if (lz < minLocalZ) minLocalZ = lz;
    }
  }

  if (!onPlate) {
    return {
      ok: false, reason: '상판 위에 놓인 절점이 없습니다. 회전이나 오프셋을 조정하세요.',
      gapMm: 0, onPlateCount: 0, offPlateCount: count,
      contacts: [], contactSpan: [0, 0], contactHullArea: 0, supportsCentroid: false,
      penetrationCount: 0, penetrationMaxMm: 0,
    };
  }

  // minLocalZ 가 0 이면 -0 이 되어 UI 에 '-0mm' 로 찍힌다. 0 으로 정규화한다.
  const gapMm = minLocalZ ? -minLocalZ : 0;

  // ── 2) 접점 수집 ──────────────────────────────────────────────────────
  const contacts = [];
  for (let i = 0; i < count; i += 1) {
    if (!onPlateFlag[i]) continue;
    const rel = local[3 * i + 2] - minLocalZ;
    if (rel <= contactTolMm) contacts.push({ x: worldX[i], y: worldY[i], z: surface.topZ + rel });
  }

  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const c of contacts) {
    sx0 = Math.min(sx0, c.x); sx1 = Math.max(sx1, c.x);
    sy0 = Math.min(sy0, c.y); sy1 = Math.max(sy1, c.y);
  }
  const hull = convexHull2D(contacts);
  const contactHullArea = polygonArea(hull);
  // 지지 안정성 — 모듈 평면 중심이 접점들이 만드는 다각형 안에 있는가.
  const supportsCentroid = hull.length >= 3 && pointInPolygon(cx, cy, hull);

  // ── 3) 관통 검사 — 상판이 아니라 정반 실형상 높이맵에 물어본다 ─────────
  let penetrationCount = 0;
  let penetrationMaxMm = 0;
  if (checkPenetration) {
    for (let i = 0; i < count; i += 1) {
      const wz = surface.topZ + gapMm + local[3 * i + 2];
      const sz = deckSurfaceZAt(surface, worldX[i], worldY[i]);
      if (sz === null) continue;                 // 허공 — 아래에 아무것도 없다
      const depth = sz - wz;
      if (depth > 1) { penetrationCount += 1; if (depth > penetrationMaxMm) penetrationMaxMm = depth; }
    }
  }

  // 접점이 상판 가장자리에서 얼마나 안쪽에 있는가. 90° 와 270° 처럼 거울상이라
  // 지지 넓이·벌어짐이 똑같이 나오는 두 배치를 실제로 가르는 값이다.
  // (상판이 꽉 찬 사각형이 아니면 bbox 기준 근사다 — 현재 A·B 정반은 사각형이다.)
  const [bx0, by0, bx1, by1] = surface.plateBBox;
  let contactEdgeMarginMm = Infinity;
  for (const c of contacts) {
    contactEdgeMarginMm = Math.min(
      contactEdgeMarginMm,
      c.x - bx0, bx1 - c.x, c.y - by0, by1 - c.y,
    );
  }
  if (!contacts.length) contactEdgeMarginMm = 0;

  return {
    ok: true, reason: null, gapMm,
    onPlateCount: onPlate, offPlateCount: count - onPlate,
    onPlateRatio: onPlate / count,
    contacts, contactSpan: [sx1 - sx0, sy1 - sy0], contactHullArea, supportsCentroid,
    contactEdgeMarginMm,
    penetrationCount, penetrationMaxMm,
  };
}

/** 2D 볼록 껍질 (monotone chain). 접점이 만드는 지지 다각형을 구한다. */
export function convexHull2D(points) {
  if (points.length < 3) return points.map(p => [p.x, p.y]);
  const pts = points.map(p => [p.x, p.y]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** 다각형 면적(부호 없음). 점이 2개 이하(=접점이 한 줄)면 0 이다. */
export function polygonArea(poly) {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(a) / 2;
}

/** 점이 다각형 내부인가 (ray casting). 경계는 내부로 친다. */
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 상판 지지가 가장 안정적인 Z 회전각을 찾는다.
 *
 * 비용 때문에 2단계로 나눈다 — 전체 각도는 관통 검사를 끄고 싸게 훑고,
 * 상위 후보만 관통까지 정확히 본다. (관통 검사가 지배적으로 비싸다.)
 */
export function findBestSeatingRotation(surface, footprint, {
  deckCenter, offsetXMm = 0, offsetYMm = 0, contactTolMm = 50, stepDeg = 1,
  otherCount = 4, minSeparationDeg = 10,
} = {}) {
  if (!surface || !footprint || !deckCenter) return null;
  const base = { deckCenter, offsetXMm, offsetYMm, contactTolMm };
  const evaluate = (deg, checkPenetration) => ({
    rotationZDeg: deg,
    seating: computeSeating(surface, footprint, { ...base, rotationZDeg: deg, checkPenetration }),
  });

  // ── 직각 4방향 — 점수와 무관하게 항상, 먼저 보여 준다 ──────────────────
  // 적치는 축 정렬이 기본이라 사용자가 실제로 검토하는 건 이 넷이다.
  // 점수만으로 줄 세우면 274° 가 270° 를 여유 400mm 차이로 이기는데, 4° 비틀어
  // 여유를 조금 더 얻는 건 실무에서 나쁜 거래다. 그래서 두 그룹을 아예 분리한다.
  const cardinals = [0, 90, 180, 270]
    .map(deg => evaluate(deg, true))
    .filter(c => c.seating?.ok)
    .sort(compareSeatingCandidates)
    .map(c => ({ ...c, group: 'cardinal' }));

  // ── 그 외 후보 — 축에서 벗어난 각도 중 상위 몇 개만 ────────────────────
  const coarse = [];
  for (let deg = 0; deg < 360; deg += stepDeg) {
    if (deg % 90 === 0) continue;
    const c = evaluate(deg, false);
    if (c.seating?.ok) coarse.push(c);
  }
  coarse.sort(compareSeatingCandidates);

  // 269°·271°·272° 처럼 사실상 같은 배치가 목록을 채우지 않도록 간격을 둔다.
  const others = [];
  for (const c of coarse) {
    if (others.length >= otherCount) break;
    const tooClose = others.some((o) => {
      const d = Math.abs(o.rotationZDeg - c.rotationZDeg);
      return Math.min(d, 360 - d) < minSeparationDeg;
    });
    if (!tooClose) others.push(evaluate(c.rotationZDeg, true));
  }
  others.sort(compareSeatingCandidates);

  return {
    cardinals,
    others: others.map(c => ({ ...c, group: 'other' })),
    candidates: [...cardinals, ...others.map(c => ({ ...c, group: 'other' }))],
  };
}

/**
 * 적치 후보 비교. 좋은 쪽이 앞으로 온다.
 *
 * 순서: 관통 없음 > 중심 지지 > 지지 넓이 > 접점 벌어짐 > 직각에 가까움 > 각도 작음.
 * 넓이·벌어짐은 버킷으로 뭉갠다 — 안 그러면 90° 와 98° 처럼 실질적으로 같은 배치가
 * 수 mm 차이로 갈려, 사용자에게 98° 같은 어정쩡한 각도를 권하게 된다.
 */
export function compareSeatingCandidates(a, b) {
  const areaBucket = (r) => Math.round((r.seating.contactHullArea || 0) / 1e4);      // 0.01 m2
  const spanBucket = (r) => Math.round(contactSpanLength(r.seating) / 100);          // 100 mm
  const cardinalDist = (deg) => { const m = ((deg % 90) + 90) % 90; return Math.min(m, 90 - m); };
  // 가장자리 여유·상판 점유도 버킷으로 뭉갠다 — 목적은 '실질적으로 다른 배치'만 가르는 것.
  const marginBucket = (r) => Math.round((r.seating.contactEdgeMarginMm || 0) / 100);   // 100 mm
  const onPlateBucket = (r) => Math.round((r.seating.onPlateRatio || 0) * 20);          // 5 %
  return (
    (a.seating.penetrationCount === 0 ? 0 : 1) - (b.seating.penetrationCount === 0 ? 0 : 1) ||
    (b.seating.supportsCentroid ? 1 : 0) - (a.seating.supportsCentroid ? 1 : 0) ||
    (areaBucket(b) - areaBucket(a)) ||
    (spanBucket(b) - spanBucket(a)) ||
    (marginBucket(b) - marginBucket(a)) ||
    (onPlateBucket(b) - onPlateBucket(a)) ||
    (cardinalDist(a.rotationZDeg) - cardinalDist(b.rotationZDeg)) ||
    (a.rotationZDeg - b.rotationZDeg)
  );
}

/** 접점들이 벌어진 거리. 지지 다각형이 0(일직선)일 때 순위를 가르는 기준이다. */
export function contactSpanLength(seating) {
  if (!seating?.contactSpan) return 0;
  return Math.hypot(seating.contactSpan[0], seating.contactSpan[1]);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 중량 / 무게중심 (COG)
 *
 * 각 모델의 질량·무게중심은 백엔드가 계산해 뷰어 페이로드의 massProperties 로 내려준다
 * (PBEAML 치수·PSHELL 두께·MAT1 밀도·CONM2 는 슬림 지오메트리에 남지 않는다).
 * 여기서 하는 일은 두 가지뿐이다 —
 *   ① 모듈의 COG 를 현재 적치 배치(회전 + 오프셋 + 내림량)로 옮기고,
 *   ② 정반 것과 질량 가중 평균해 합산 COG 를 만든다.
 * 배치가 바뀔 때마다 서버를 다시 부르지 않으려고 프론트에서 변환한다.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 모듈 모델 좌표의 한 점 → 적치 후 월드(정반) 좌표.
 * computeSeating 이 절점에 쓰는 것과 **같은 변환**이어야 한다. 어긋나면 COG 마커가
 * 모델과 따로 논다.
 */
export function transformModulePoint(point, {
  anchor, deckCenter, deckTopZ,
  offsetXMm = 0, offsetYMm = 0, rotationZDeg = 0, gapMm = 0,
} = {}) {
  if (!point || !anchor || !deckCenter || !Number.isFinite(deckTopZ)) return null;
  const lx = point.x - anchor[0];
  const ly = point.y - anchor[1];
  const lz = point.z - anchor[2];
  const th = (rotationZDeg * Math.PI) / 180;
  const cs = Math.cos(th), sn = Math.sin(th);
  return {
    x: deckCenter[0] + offsetXMm + lx * cs - ly * sn,
    y: deckCenter[1] + offsetYMm + lx * sn + ly * cs,
    z: deckTopZ + gapMm + lz,
  };
}

/** massProperties 페이로드에서 쓸 수 있는 (질량, COG) 만 꺼낸다. 없으면 null. */
function usableMass(mp) {
  const m = mp?.totalMassTon;
  const c = mp?.centerOfGravityMm;
  if (!Number.isFinite(m) || m <= 0) return null;
  if (!c || ![c.x, c.y, c.z].every(Number.isFinite)) return null;
  return { massTon: m, cogMm: { x: c.x, y: c.y, z: c.z } };
}

/**
 * 정반 + 모듈 합산 중량·무게중심.
 *
 * 중량 여유(contingency)는 질량에만 곱한다 — 그 물체의 COG 는 움직이지 않는다
 * (전체를 균일하게 무겁게 보는 것이므로 1차 모멘트도 같은 비율로 커진다).
 *
 * @returns {{
 *   deck: {massTon:number, cogMm:{x,y,z}}|null,
 *   module: {massTon:number, cogMm:{x,y,z}}|null,
 *   total: {massTon:number, cogMm:{x,y,z}}|null,
 *   includes: {deck:boolean, module:boolean},
 *   baseMassTon: number, contingencyMassTon: number,
 * }|null}
 */
export function combineMassProperties({
  deckMass, moduleMass, placement,
  deckContingencyPct = 0, moduleContingencyPct = 0,
} = {}) {
  const d0 = usableMass(deckMass);
  const m0 = usableMass(moduleMass);
  if (!d0 && !m0) return null;

  const pct = (v) => (Number.isFinite(v) ? Math.max(-100, v) : 0);

  const deck = d0 ? {
    massTon: d0.massTon * (1 + pct(deckContingencyPct) / 100),
    cogMm: d0.cogMm,
    baseMassTon: d0.massTon,
  } : null;

  // 모듈 COG 는 모델 좌표라 배치 변환을 태워야 정반과 같은 좌표계가 된다.
  let mod = null;
  if (m0) {
    const world = placement ? transformModulePoint(m0.cogMm, placement) : null;
    if (world) {
      mod = {
        massTon: m0.massTon * (1 + pct(moduleContingencyPct) / 100),
        cogMm: world,
        baseMassTon: m0.massTon,
        modelCogMm: m0.cogMm,
      };
    }
  }

  const parts = [deck, mod].filter(Boolean);
  let total = null;
  if (parts.length) {
    const massTon = parts.reduce((s, p) => s + p.massTon, 0);
    total = massTon > 0 ? {
      massTon,
      cogMm: {
        x: parts.reduce((s, p) => s + p.massTon * p.cogMm.x, 0) / massTon,
        y: parts.reduce((s, p) => s + p.massTon * p.cogMm.y, 0) / massTon,
        z: parts.reduce((s, p) => s + p.massTon * p.cogMm.z, 0) / massTon,
      },
    } : null;
  }

  const baseMassTon = parts.reduce((s, p) => s + p.baseMassTon, 0);
  return {
    deck, module: mod, total,
    includes: { deck: !!deck, module: !!mod },
    baseMassTon,
    contingencyMassTon: (total?.massTon ?? 0) - baseMassTon,
  };
}
