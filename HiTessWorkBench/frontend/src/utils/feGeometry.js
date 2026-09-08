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
 *  · 기본 배치 = **상판** XY 중심 정렬 + 정반 상면에서 gapMm 만큼 위.
 *
 * ⚠ 기준은 정반 전체 bbox 가 아니라 **기준 적치면(면적이 가장 넓은 층 = 상단)**이다.
 *   A·B 정반은 2단이라 상단이 bbox 중심에서 비켜 있다(A 상단 X 26260~33360 vs bbox 중심
 *   26685, B 상단 X 38360~51460 vs 48035). bbox 중심에 맞추면 모듈이 상단 밖으로 밀려
 *   나고, 사용자가 오프셋으로 되돌려야 할 거리가 그만큼 늘어난다.
 *
 * @param {{min:number[],max:number[]}} deckBounds   정반 바운딩박스
 * @param {{min:number[],max:number[]}|null} moduleBounds Module Unit 바운딩박스
 * @param {{gapMm:number,offsetXMm:number,offsetYMm:number}} arrangement
 * @param {{plateBBox:number[],topZ:number}|null} deckSurface buildDeckSurface 결과.
 *        없으면 bbox 로 폴백한다(상판을 못 찾은 정반은 어차피 적치도 못 한다).
 */
/** 배치 기준점 [x, y] — 기준 적치면(면적 최대 층)의 XY 중심. 적치면을 못 찾으면 bbox 중심. */
export function deckPlacementCenter(deckBounds, deckSurface = null) {
  const plate = deckSurface?.plateBBox;
  if (plate) return [(plate[0] + plate[2]) / 2, (plate[1] + plate[3]) / 2];
  if (!deckBounds?.min || !deckBounds?.max) return null;
  return [(deckBounds.min[0] + deckBounds.max[0]) / 2, (deckBounds.min[1] + deckBounds.max[1]) / 2];
}

export function computeModulePlacement(deckBounds, moduleBounds, arrangement, deckSurface = null) {
  if (!deckBounds?.min || !deckBounds?.max) return null;
  const { max: dMax } = deckBounds;
  const deckTopZ = Number.isFinite(deckSurface?.topZ) ? deckSurface.topZ : dMax[2];
  const deckCenter = deckPlacementCenter(deckBounds, deckSurface);

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

/** 적치면과 그 위에 앉는 지지점 사이의 고정 이격 [mm].
 *
 * 사용자 결정이다. 이 값이 고정이라 어떤 부재도 정반 쉘을 통과할 수 없고, 지지점은
 * 이 높이를 건너뛰는 RBE2 로 자기 발밑 적치면에 붙는다(= 스툴). 백엔드
 * module_ocean_merge.DEFAULT_CLEARANCE_MM 과 같은 값이어야 한다.
 *
 * 2026-09-08: 300 → 100 (사용자 결정). 이 값이 바뀌면 적치 높이·스툴 길이가 전부
 * 따라 움직이므로, 숫자를 여기저기 적지 말고 **반드시 이 상수를 참조**할 것.
 */
export const DECK_CLEARANCE_MM = 100;

/** 이격 비교의 부동소수 오차 여유 [mm]. 회전 행렬 round-off 로 이격값이 0.0001 모자라게 나온다. */
const CLEARANCE_EPS_MM = 1e-6;

/* ────────────────────────────────────────────────────────────────────────────
 * 적치(seating) — Module Unit 을 정반 적치면 위 고정 높이에 놓기
 *
 * 왜 절점만 검사해도 되나:
 *   접촉 상대가 수평 평면(정반 적치면)이면, 빔 선분이나 쉘 삼각형 위의 최저점은
 *   반드시 꼭짓점에서 발생한다(선형 보간). 그래서 절점 검사는 근사가 아니라 **정확**하다.
 *   삼각형-삼각형 교차나 물리엔진이 필요 없다.
 *
 * 왜 '적치면(levels)' 과 '높이맵(grid)' 을 나눠서 보나:
 *   적치면은 **스툴을 세울 수 있는 면**이다 — A·B 정반은 상단 z=8026 과 하단 z=2020
 *   두 층이고, 지지점은 그중 자기 발밑 층에 앉는다(모듈 3521 은 바닥이 6,276mm 단차라
 *   실제로 두 층에 걸쳐 앉는다). 높이맵은 **모든 수평면**이라 보강재 플랜지·베이스
 *   플레이트까지 들어 있고, 이격(관통) 검사에만 쓴다. 둘을 섞으면 보강재 위가
 *   적치면이 되거나, 반대로 하단 정반이 '정반 밖' 이 되어 멀쩡한 배치가 막힌다.
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
 *   · levels — 적치면 목록(높이 내림차순). 지지점이 실제로 앉을 수 있는 수평 평면들.
 *   · grid   — 모든 수평면을 XY 격자에 담은 높이맵. 이격 검사용.
 * 수직 웨브(|nz| 작음)는 수직 낙하를 막지 못하므로 둘 다에서 제외한다.
 *
 * ★ 적치면은 **여러 층**이다. A·B 정반은 2단이다 —
 *     A: 상단 z=8026(125㎡, X 26260~33360) + 하단 z=2020(106㎡, X 20260~26260)
 *     B: 상단 z=8026(231㎡, X 38360~51460) + 하단 z=2020(106㎡, X 51460~57460)
 *   예전에는 **가장 높은 면 하나만** 상판으로 봤다. 그래서 하단 위에 놓이는 지지점이
 *   전부 "상판 밖 — 붙일 절점이 없음" 이 되어 3단계가 막혔다. 그런데 모듈 3521 은
 *   바로 그 2단 정반에 맞춰 **바닥이 6,276mm 단차로 설계**돼 있다(아래 5점이 하단에,
 *   나머지가 상단에 앉는다). 단차 정반에 단차 모듈을 올리는 것이 원래 의도였다.
 *   z=-25 의 베이스 플레이트(전체 수평면적의 0.6%)는 면적비로 걸러진다.
 *
 * @param {object} deckModel 슬림 지오메트리(positions/quads/trias)
 */
export function buildDeckSurface(deckModel, {
  horizontalDot = 0.5,       // |nz|/|n| 이 이 값 이상이면 '수평면'으로 본다
  topTolMm = 1,              // 같은 적치면으로 묶을 z 허용오차
  cellMm = 400,              // 높이맵 격자 크기
  minLevelAreaRatio = 0.05,  // 평평한 수평면적 합의 이 비율 미만인 층은 적치면이 아니다
} = {}) {
  const P = deckModel?.positions;
  if (!P || P.length < 9) return null;

  const horiz = [];   // [ax,ay,az, bx,by,bz, cx,cy,cz]

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
  });

  if (!horiz.length) return null;

  // ── 적치면 후보 = 세 꼭짓점이 같은 높이인(=완전히 평평한) 삼각형을 z 로 묶은 것 ──
  const buckets = new Map();     // round(z/topTolMm) → {z, area, idx[]}
  let flatArea = 0;
  for (let i = 0; i < horiz.length; i += 9) {
    const az = horiz[i + 2], bz = horiz[i + 5], cz = horiz[i + 8];
    if (Math.max(az, bz, cz) - Math.min(az, bz, cz) > topTolMm) continue;
    const area = Math.abs((horiz[i + 3] - horiz[i]) * (horiz[i + 7] - horiz[i + 1])
                        - (horiz[i + 4] - horiz[i + 1]) * (horiz[i + 6] - horiz[i])) / 2;
    if (area <= 0) continue;
    const z = (az + bz + cz) / 3;
    const key = Math.round(z / topTolMm);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { z, area: 0, idx: [] }; buckets.set(key, bucket); }
    bucket.area += area;
    bucket.idx.push(i);
    flatArea += area;
  }
  if (!flatArea) return null;

  const levels = [];
  for (const bucket of buckets.values()) {
    if (bucket.area < flatArea * minLevelAreaRatio) continue;
    const tris = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of bucket.idx) {
      tris.push(horiz[i], horiz[i + 1], horiz[i + 3], horiz[i + 4], horiz[i + 6], horiz[i + 7]);
      x0 = Math.min(x0, horiz[i], horiz[i + 3], horiz[i + 6]);
      x1 = Math.max(x1, horiz[i], horiz[i + 3], horiz[i + 6]);
      y0 = Math.min(y0, horiz[i + 1], horiz[i + 4], horiz[i + 7]);
      y1 = Math.max(y1, horiz[i + 1], horiz[i + 4], horiz[i + 7]);
    }
    // 층이 bbox 를 꽉 채우면(현재 A·B 정반이 그렇다) 점 판정을 bbox 비교로 끝낼 수 있다.
    // 구멍이 뚫린 정반이 들어오면 자동으로 삼각형 판정으로 떨어진다.
    const bboxArea = (x1 - x0) * (y1 - y0);
    levels.push({
      z: bucket.z,
      area: bucket.area,
      tris,
      bbox: [x0, y0, x1, y1],
      solidRect: bboxArea > 0 && Math.abs(bucket.area - bboxArea) / bboxArea < 0.02,
    });
  }
  if (!levels.length) return null;
  levels.sort((a, b) => b.z - a.z);          // 위 → 아래. landingLevelAt 이 첫 일치를 쓴다.

  // 배치 기준면 = 면적이 가장 넓은 층(A·B 모두 상단). deckCenter 가 여기서 나온다.
  // 두 층이 같은 면적이면 높은 쪽 — 기준이 실행마다 흔들리면 안 된다.
  const primary = levels.reduce(
    (best, lv) => ((lv.area > best.area || (lv.area === best.area && lv.z > best.z)) ? lv : best),
    levels[0],
  );
  const landingBBox = [
    Math.min(...levels.map(lv => lv.bbox[0])), Math.min(...levels.map(lv => lv.bbox[1])),
    Math.max(...levels.map(lv => lv.bbox[2])), Math.max(...levels.map(lv => lv.bbox[3])),
  ];

  // 높이맵 — 수평면 삼각형을 XY 격자 칸에 등록한다(적치면이 아닌 면도 전부 넣는다).
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

  return {
    topZ: levels[0].z,          // 최상단 적치면. 배치 Z 의 기준점(gapMm 이 이 면 기준이다)
    levels, primary, landingBBox,
    // 기준면 별칭 — 배치(computeModulePlacement)가 쓰는 값이다.
    plateBBox: primary.bbox,
    horiz, grid, cellMm,
  };
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
 * 적치면 경계 판정의 여유 [mm].
 *
 * ⚠ 여유가 필요하다. 회전 행렬에 cos(270°) = -1.8e-16 같은 값이 들어가 적치면 끝에
 *   정확히 걸친 절점이 x = -7e-14 로 밀린다. 여유가 없으면 그 지지점이 통째로 빠져
 *   버려서, 거울상인 90°/270° 가 서로 다른 지지점 수를 갖는 것처럼 보인다.
 *   1e-6 mm 는 물리적으로 무의미한 크기라 판정을 왜곡하지 않는다.
 */
const PLATE_EPS_MM = 1e-6;

/**
 * (x, y) 를 받는 적치면. 여러 층이 겹치면 **가장 높은 층**이다(그 자리에 실제로 있는 면).
 * 어느 층에도 안 걸리면 null — 정반 밖이라 스툴을 세울 자리가 없다는 뜻이다.
 */
export function landingLevelAt(surface, x, y) {
  const levels = surface?.levels;
  if (!levels) return null;
  for (const lv of levels) {              // 높이 내림차순이라 첫 일치가 최상단이다
    const [x0, y0, x1, y1] = lv.bbox;
    if (x < x0 - PLATE_EPS_MM || x > x1 + PLATE_EPS_MM
        || y < y0 - PLATE_EPS_MM || y > y1 + PLATE_EPS_MM) continue;
    if (lv.solidRect) return lv;
    const t = lv.tris;
    for (let i = 0; i < t.length; i += 6) {
      if (pointInTri2D(x, y, t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4], t[i + 5])) return lv;
    }
  }
  return null;
}

/** (x, y) 를 받는 적치면의 높이. 없으면 null. */
export function landingZAt(surface, x, y) {
  const lv = landingLevelAt(surface, x, y);
  return lv ? lv.z : null;
}

/** (x, y) 위에 적치면이 있는가(= 스툴을 세울 수 있는가). */
export function isOnPlate(surface, x, y) {
  return landingLevelAt(surface, x, y) !== null;
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
 * 지지점 배치의 적치 높이를 정한다 — **여기가 "자동으로 내려앉는" 부분**이다.
 *
 * 규칙: 지지점마다 자기 발밑의 적치면에서 clearanceMm 이상 떠 있어야 하고,
 *       그중 가장 빡빡한 지지점이 정확히 clearanceMm 이 되도록 모듈 전체를 내린다.
 *
 *     baseZ = max over supports ( landingZ(지지점) + clearance - localZ(지지점) )
 *
 * 층이 하나면 예전 식(= clearance - 지지점 최하단)과 같은 값이 나온다. 층이 여럿이면
 * 층마다 다른 스툴 길이가 자동으로 계산된다 — 3521 은 하단 100mm / 상단 370mm 이다
 * (모듈 단차 6,276 vs 정반 단차 6,006 의 차이 270mm 가 그대로 상단 스툴에 붙는다).
 *
 * 절점 전체가 아니라 지지점만 훑기 때문에 싸다 — 화면이 오프셋을 바꿀 때마다
 * 실시간으로 불러도 된다.
 *
 * @returns {{gapMm:number, baseZMm:number, supportsOffPlate:number[],
 *            stoolMinMm:number, stoolMaxMm:number,
 *            supports:Array<{i:number,landingZMm:number,stoolMm:number}>,
 *            levels:Array<{landingZMm:number,count:number,stoolMinMm:number,stoolMaxMm:number}>}}
 */
export function computeSeatGap(surface, footprint, {
  deckCenter, offsetXMm = 0, offsetYMm = 0, rotationZDeg = 0,
  clearanceMm = DECK_CLEARANCE_MM, supportIndices = null,
} = {}) {
  const empty = {
    gapMm: clearanceMm, baseZMm: (surface?.topZ ?? 0) + clearanceMm,
    supportsOffPlate: [], stoolMinMm: clearanceMm, stoolMaxMm: clearanceMm,
    supports: [], levels: [],
  };
  if (!surface || !footprint || !deckCenter) return empty;

  const cx = deckCenter[0] + offsetXMm;
  const cy = deckCenter[1] + offsetYMm;
  const th = (rotationZDeg * Math.PI) / 180;
  const cs = Math.cos(th), sn = Math.sin(th);
  const { local, count } = footprint;

  const seated = [];                 // {i, landingZ, localZ}
  const supportsOffPlate = [];
  for (const i of supportIndices || []) {
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    const lx = local[3 * i], ly = local[3 * i + 1];
    const landingZ = landingZAt(surface, cx + lx * cs - ly * sn, cy + lx * sn + ly * cs);
    if (landingZ === null) supportsOffPlate.push(i);
    else seated.push({ i, landingZ, localZ: local[3 * i + 2] });
  }
  if (!seated.length) return { ...empty, supportsOffPlate };

  let baseZ = -Infinity;
  for (const s of seated) baseZ = Math.max(baseZ, s.landingZ + clearanceMm - s.localZ);

  const byLevel = new Map();
  const supports = [];
  let stoolMinMm = Infinity, stoolMaxMm = -Infinity;
  for (const s of seated) {
    const stool = baseZ + s.localZ - s.landingZ;
    stoolMinMm = Math.min(stoolMinMm, stool);
    stoolMaxMm = Math.max(stoolMaxMm, stool);
    // 지지점 하나하나의 스툴 — 화면이 뷰어에 스툴 기둥을 그리는 데 쓴다.
    // 층별 요약만으로는 "어느 자리 스툴이 긴가" 를 형상 위에서 짚을 수 없다.
    supports.push({ i: s.i, landingZMm: s.landingZ, stoolMm: stool });
    const row = byLevel.get(s.landingZ)
      || { landingZMm: s.landingZ, count: 0, stoolMinMm: stool, stoolMaxMm: stool };
    row.count += 1;
    row.stoolMinMm = Math.min(row.stoolMinMm, stool);
    row.stoolMaxMm = Math.max(row.stoolMaxMm, stool);
    byLevel.set(s.landingZ, row);
  }

  return {
    gapMm: baseZ - surface.topZ,
    baseZMm: baseZ,
    supportsOffPlate,
    stoolMinMm, stoolMaxMm,
    supports,
    levels: [...byLevel.values()].sort((a, b) => b.landingZMm - a.landingZMm),
  };
}

/**
 * 지정한 지지점이 각자의 적치면 위 clearanceMm 에 오도록 Module Unit 을 놓고, 그 배치를 평가한다.
 *
 * ★ 높이를 정하는 것은 **사용자가 고른 지지점**이다(모듈 최하단이 아니다).
 *   지지점마다 발밑 적치면을 찾아 그 위 clearanceMm 을 확보하고, 가장 빡빡한 쪽에 맞춰
 *   모듈 전체가 내려앉는다(computeSeatGap). 나머지 지지점의 스툴은 그만큼 길어진다.
 *
 *   한때 모듈 **최하단**을 기준으로 삼았는데 실패했다 — 샘플 3521 의 최하단 5점은
 *   지지점이 아니라 **하단 정반(z=2020)에 앉는 발**인데, 상판(z=8026) 하나만 적치면으로
 *   보던 시절엔 그 5점이 '상판 밖' 이라 멀쩡한 배치가 계속 막혔다.
 *
 * 이 함수가 답하는 질문은 셋이다.
 *   · 지지점 발밑에 적치면이 있는가            (없으면 스툴을 세울 자리가 없다 — 어느 절점인지 돌려준다)
 *   · 정반 위 어떤 절점도 clearance 안으로 들어오지 않는가 (지지점보다 낮은 부재가 있으면 걸린다)
 *   · 모듈이 적치면을 얼마나 덮는가            (회전 후보를 가르는 값)
 *
 * @returns {{
 *   ok: boolean, reason: string|null, gapMm: number, baseZMm: number, clearanceMm: number,
 *   onPlateCount: number, offPlateCount: number, onPlateRatio: number,
 *   supportCount: number, supportsOffPlateCount: number, supportsOffPlate: number[],
 *   stoolMinMm: number, stoolMaxMm: number,
 *   supportLevels: Array<{landingZMm:number,count:number,stoolMinMm:number,stoolMaxMm:number}>,
 *   minDeckClearanceMm: number|null, clearanceShortfallCount: number, worstClearanceIndex: number,
 *   contacts: Array<{i:number,x:number,y:number,z:number}>, contactSpan: [number,number],
 *   contactHullArea: number, supportsCentroid: boolean, contactEdgeMarginMm: number,
 * }|null}
 */
export function computeSeating(surface, footprint, {
  deckCenter,           // [x, y] — 배치 기준점(정반 기준 적치면 XY 중심)
  offsetXMm = 0,
  offsetYMm = 0,
  rotationZDeg = 0,
  contactTolMm = 50,
  clearanceMm = DECK_CLEARANCE_MM,
  supportIndices = null,     // 사용자가 고른 지지점의 footprint 인덱스(= positions 인덱스)
  checkClearance = true,
} = {}) {
  if (!surface || !footprint || !deckCenter) return null;

  const cx = deckCenter[0] + offsetXMm;
  const cy = deckCenter[1] + offsetYMm;
  const th = (rotationZDeg * Math.PI) / 180;
  const cs = Math.cos(th), sn = Math.sin(th);
  const { local, count } = footprint;

  // ── 1) 절점을 정반 좌표로 옮기고 발밑 적치면을 찾는다 ─────────────────
  let onPlate = 0;
  const worldX = new Float64Array(count);
  const worldY = new Float64Array(count);
  const landingZ = new Float64Array(count);      // NaN = 적치면 없음
  for (let i = 0; i < count; i += 1) {
    const lx = local[3 * i], ly = local[3 * i + 1];
    const X = cx + lx * cs - ly * sn;
    const Y = cy + lx * sn + ly * cs;
    worldX[i] = X; worldY[i] = Y;
    const lz = landingZAt(surface, X, Y);
    landingZ[i] = lz === null ? NaN : lz;
    if (lz !== null) onPlate += 1;
  }

  // ── 2) 적치 높이 — 지지점이 자기 적치면 위 clearance 에 오도록 내려앉는다 ──
  const supports = [];
  for (const i of supportIndices || []) {
    if (Number.isInteger(i) && i >= 0 && i < count) supports.push(i);
  }
  const seat = computeSeatGap(surface, footprint, {
    deckCenter, offsetXMm, offsetYMm, rotationZDeg, clearanceMm, supportIndices: supports,
  });
  const { gapMm, baseZMm } = seat;

  if (!onPlate) {
    return {
      ok: false, reason: '적치면 위에 놓인 절점이 없습니다. 회전이나 오프셋을 조정하세요.',
      gapMm, baseZMm, clearanceMm,
      onPlateCount: 0, offPlateCount: count, onPlateRatio: 0,
      supportCount: supports.length,
      supportsOffPlateCount: seat.supportsOffPlate.length,
      supportsOffPlate: seat.supportsOffPlate,
      stoolMinMm: seat.stoolMinMm, stoolMaxMm: seat.stoolMaxMm, supportLevels: seat.levels,
      minDeckClearanceMm: null, clearanceShortfallCount: 0, worstClearanceIndex: -1,
      contacts: [], contactSpan: [0, 0], contactHullArea: 0, supportsCentroid: false,
      contactEdgeMarginMm: 0,
    };
  }

  // ── 3) 지지 다각형 — 회전 후보를 가르는 형상 지표에만 쓴다 ────────────
  // 지지점이 있으면 지지점 자체가 지지 다각형이다. 2단 정반에 걸친 모듈은 '모듈
  // 최하단' 이 한쪽 층에만 몰려 있어서(3521 은 하단 5점), 바닥 절점으로 잡으면
  // 지지 다각형이 한 줄로 찌그러진다. 지지점을 고르기 전(미리보기)에만 바닥 절점을 쓴다.
  // i 는 footprint.local(=positions) 의 원본 절점 인덱스다 — prepareModuleFootprint 가
  // 절점을 거르거나 재정렬하지 않고 그대로 펴기 때문에 그대로 보존된다.
  const contactIdx = [];
  if (supports.length) {
    for (const i of supports) if (!Number.isNaN(landingZ[i])) contactIdx.push(i);
  } else {
    for (let i = 0; i < count; i += 1) {
      if (local[3 * i + 2] <= contactTolMm && !Number.isNaN(landingZ[i])) contactIdx.push(i);
    }
  }
  const contacts = contactIdx.map(i => ({
    i, x: worldX[i], y: worldY[i], z: baseZMm + local[3 * i + 2],
  }));

  // 접점이 없으면 -Infinity 가 나와 화면에 '-∞mm' 로 찍힌다. 0 으로 정규화한다.
  let sx0 = 0, sy0 = 0, sx1 = 0, sy1 = 0;
  if (contacts.length) {
    sx0 = sy0 = Infinity; sx1 = sy1 = -Infinity;
    for (const c of contacts) {
      sx0 = Math.min(sx0, c.x); sx1 = Math.max(sx1, c.x);
      sy0 = Math.min(sy0, c.y); sy1 = Math.max(sy1, c.y);
    }
  }
  const hull = convexHull2D(contacts);
  const contactHullArea = polygonArea(hull);
  const supportsCentroid = hull.length >= 3 && pointInPolygon(cx, cy, hull);

  // ── 4) 이격 검사 — 정반 실형상 높이맵에 절점마다 물어본다 ─────────────
  // "어떤 절점도 그 아래 정반면에서 clearance 안으로 들어오지 않는다" 하나로
  // 관통(음수 이격)과 여유 부족을 같이 잡는다. 적치면·보강재·허공을 구분해서
  // 규칙을 나눌 필요가 없다 — 각 절점 바로 아래 면에 직접 물어보기 때문이다.
  let minDeckClearanceMm = Infinity;
  let clearanceShortfallCount = 0;
  let worstClearanceIndex = -1;
  if (checkClearance) {
    for (let i = 0; i < count; i += 1) {
      const sz = deckSurfaceZAt(surface, worldX[i], worldY[i]);
      if (sz === null) continue;                 // 허공 — 아래에 아무것도 없다
      const room = (baseZMm + local[3 * i + 2]) - sz;
      if (room < minDeckClearanceMm) { minDeckClearanceMm = room; worstClearanceIndex = i; }
      if (room < clearanceMm - CLEARANCE_EPS_MM) clearanceShortfallCount += 1;
    }
  }

  // 접점이 적치면 가장자리에서 얼마나 안쪽에 있는가. 90° 와 270° 처럼 거울상이라
  // 지지 넓이·벌어짐이 똑같이 나오는 두 배치를 실제로 가르는 값이다.
  const [bx0, by0, bx1, by1] = surface.landingBBox || surface.plateBBox;
  let contactEdgeMarginMm = Infinity;
  for (const c of contacts) {
    contactEdgeMarginMm = Math.min(
      contactEdgeMarginMm,
      c.x - bx0, bx1 - c.x, c.y - by0, by1 - c.y,
    );
  }
  if (!contacts.length) contactEdgeMarginMm = 0;

  return {
    ok: true, reason: null, gapMm, baseZMm, clearanceMm,
    onPlateCount: onPlate, offPlateCount: count - onPlate,
    onPlateRatio: onPlate / count,
    // 지지점 — 발밑에 적치면이 없는 것이 하나라도 있으면 3단계가 막힌다.
    // supportsOffPlate 는 footprint 인덱스라, 화면이 절점 ID 로 되짚어 보여 준다.
    supportCount: supports.length,
    supportsOffPlateCount: seat.supportsOffPlate.length,
    supportsOffPlate: seat.supportsOffPlate,
    // 스툴 길이. 가장 빡빡한 지지점이 clearance, 나머지는 그 차이만큼 길어진다.
    stoolMinMm: seat.stoolMinMm, stoolMaxMm: seat.stoolMaxMm,
    supportLevels: seat.levels,
    // 정반면과의 최소 이격. clearance 보다 작으면 지지점보다 낮은 부재가 정반 위에 있다.
    minDeckClearanceMm: Number.isFinite(minDeckClearanceMm) ? minDeckClearanceMm : null,
    clearanceShortfallCount, worstClearanceIndex,
    contacts, contactSpan: [sx1 - sx0, sy1 - sy0], contactHullArea, supportsCentroid,
    contactEdgeMarginMm,
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
 * 비용 때문에 2단계로 나눈다 — 전체 각도는 이격 검사를 끄고 싸게 훑고,
 * 상위 후보만 이격까지 정확히 본다. (절점마다 정반 높이맵을 뒤지는 이 검사가 지배적으로 비싸다.)
 */
export function findBestSeatingRotation(surface, footprint, {
  deckCenter, offsetXMm = 0, offsetYMm = 0, contactTolMm = 50, stepDeg = 1,
  clearanceMm = DECK_CLEARANCE_MM, supportIndices = null,
  otherCount = 4, minSeparationDeg = 10,
} = {}) {
  if (!surface || !footprint || !deckCenter) return null;
  const base = { deckCenter, offsetXMm, offsetYMm, contactTolMm, clearanceMm, supportIndices };
  const evaluate = (deg, checkClearance) => ({
    rotationZDeg: deg,
    seating: computeSeating(surface, footprint, { ...base, rotationZDeg: deg, checkClearance }),
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
 * 순서: 지지점 발밑에 적치면 있음 > 이격 확보 > **스툴 길이** > 적치면 점유율 >
 *       중심 지지 > 지지 넓이 > 벌어짐 > 가장자리 여유 > 직각에 가까움 > 각도 작음.
 * 넓이·벌어짐은 버킷으로 뭉갠다 — 안 그러면 90° 와 98° 처럼 실질적으로 같은 배치가
 * 수 mm 차이로 갈려, 사용자에게 98° 같은 어정쩡한 각도를 권하게 된다.
 *
 * ⚠ 첫 기준을 '적치면 점유율' 로 두는 것은 실측 때문이다. 한때 '모듈 최하단이 상판 안인가'
 *   를 먼저 봤는데, 샘플 3521 의 최하단 5점은 **하단 정반에 앉는 발**이라 그 5점만
 *   상단에 걸치는 90° 가, 정작 제대로 앉는 270° 를 이겨 버렸다. 지지점은 최하단이
 *   아니라 적치면 위 어느 절점에서든 고를 수 있으므로(스툴 길이가 달라질 뿐이다),
 *   배치의 좋고 나쁨은 **모듈이 적치면을 얼마나 덮는가** 로 재는 것이 맞다.
 */
export function compareSeatingCandidates(a, b) {
  const areaBucket = (r) => Math.round((r.seating.contactHullArea || 0) / 1e4);      // 0.01 m2
  const spanBucket = (r) => Math.round(contactSpanLength(r.seating) / 100);          // 100 mm

  const cardinalDist = (deg) => { const m = ((deg % 90) + 90) % 90; return Math.min(m, 90 - m); };
  // 가장자리 여유·상판 점유도 버킷으로 뭉갠다 — 목적은 '실질적으로 다른 배치'만 가르는 것.
  const marginBucket = (r) => Math.round((r.seating.contactEdgeMarginMm || 0) / 100);   // 100 mm
  const onPlateBucket = (r) => Math.round((r.seating.onPlateRatio || 0) * 20);          // 5 %
  const blocked = (r) => ((r.seating.supportsOffPlateCount || 0) > 0 ? 1 : 0);
  const tooClose = (r) => ((r.seating.clearanceShortfallCount || 0) > 0 ? 1 : 0);
  // 스툴 길이 — 1m 단위. 단차 정반에서는 이것이 각도를 실제로 가른다. 정반 A + 3521 실측:
  // 270° 는 300~570mm 인데 90°/0°/180° 는 300~12,582mm 다(모듈 단차와 정반 단차가 어긋나
  // 한쪽 발이 허공에서 12m 를 내려와야 한다). 12m 스툴은 몇 % 더 덮는 것으로 살 수 없다.
  const stoolBucket = (r) => Math.round((r.seating.stoolMaxMm || 0) / 1000);            // 1 m
  return (
    // 3단계를 막는 두 조건이 먼저다 — 쓸 수 없는 배치를 위에 올려 놓을 이유가 없다.
    (blocked(a) - blocked(b)) ||
    (tooClose(a) - tooClose(b)) ||
    (stoolBucket(a) - stoolBucket(b)) ||
    (onPlateBucket(b) - onPlateBucket(a)) ||
    (b.seating.supportsCentroid ? 1 : 0) - (a.seating.supportsCentroid ? 1 : 0) ||
    (areaBucket(b) - areaBucket(a)) ||
    (spanBucket(b) - spanBucket(a)) ||
    (marginBucket(b) - marginBucket(a)) ||
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
