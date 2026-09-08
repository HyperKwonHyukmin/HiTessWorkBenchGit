import { convexHull2D, polygonArea, pointInPolygon } from './feGeometry.js';

/**
 * 사용자가 고른 지지점 집합의 품질 판정.
 *
 * 왜 필요한가: 자동 접촉 탐지가 고른 5개 절점은 **전부 한 직선 위**(Y=-19099)였고,
 * 11.8m 짜리 모듈이 그 선을 축으로 자유롭게 넘어가는 모델이 만들어졌다. 그 사실은
 * Nastran 을 다 돌린 뒤 사용률 10배라는 결과로만 드러났다.
 * 지지점을 고르는 그 자리에서 같은 판정을 해 준다.
 *
 * 판정은 **모델 좌표 XY** 로 한다 — Z 회전·오프셋을 해도 지지 다각형의 모양과
 * 무게중심의 상대 위치는 변하지 않으므로, 배치를 바꿔도 결론이 흔들리지 않는다.
 */

// 지지 다각형이 이보다 좁으면 사실상 선/점 지지로 본다.
// 실측: 공선인 5점의 hull 면적은 0, 정상 배치는 수십 m² 규모라 경계는 넉넉하다.
export const DEGENERATE_AREA_MM2 = 1.0e4;   // 100mm × 100mm

/**
 * 슬림 페이로드의 rigids(독립↔종속 인덱스 쌍)에서 **종속 절점 인덱스**만 뽑는다.
 *
 * ⚠ 예전에는 이 절점을 고르면 경고하고, 전부 종속이면 차단했다. **합본 방식에서는
 *   틀린 규칙이다.** 지지점은 더 이상 SPC 로 구속되지 않고 지지 RBE2 의 **GN(독립)**
 *   으로 쓰인다 — 한 절점이 다른 RBE2 의 종속이면서 새 RBE2 의 독립인 것은 Nastran 이
 *   허용한다(실측 확인). m-set 충돌이 나는 것은 **정반 쪽 절점**뿐이고 그건 백엔드
 *   pair_supports_to_plate 가 forbidden 으로 걸러 낸다.
 *   지금은 "하중이 강체를 거쳐 들어간다" 는 사실만 info 로 알린다.
 */
export function rigidDependentIndices(model) {
  const out = new Set();
  const r = model?.rigids || [];
  for (let k = 1; k < r.length; k += 2) out.add(r[k]);
  return out;
}

/**
 * @param {Array<{i?:number,x:number,y:number,z:number}>} points 선택한 절점의 모델 좌표
 * @param {{cogMm?: {x:number,y:number}, rigidDependent?: Set<number>}} opts
 */
export function evaluateSupportSelection(points, { cogMm, rigidDependent } = {}) {
  const count = points?.length || 0;
  const issues = [];

  if (count === 0) {
    return {
      count: 0, hullAreaMm2: 0, spanMm: [0, 0], zRangeMm: 0,
      collinear: false, supportsCentroid: false, rigidDependentCount: 0, ok: false,
      issues: [{ level: 'block', code: 'EMPTY', message: '지지점을 하나도 고르지 않았습니다.' }],
    };
  }

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const zs = points.map(p => p.z);
  const spanMm = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  const zRangeMm = Math.max(...zs) - Math.min(...zs);

  const hull = convexHull2D(points);
  const hullAreaMm2 = hull.length >= 3 ? Math.abs(polygonArea(hull)) : 0;
  // 2점 이하이거나 다각형이 찌부러졌으면 그 축으로 회전을 못 막는다.
  const collinear = count < 3 || hullAreaMm2 < DEGENERATE_AREA_MM2;

  const supportsCentroid = Boolean(
    cogMm && hull.length >= 3 && pointInPolygon(cogMm.x, cogMm.y, hull),
  );

  if (count < 3) {
    issues.push({
      level: 'block',
      code: 'TOO_FEW',
      message: `지지점이 ${count}개뿐입니다. 3점 이상이라야 모듈이 넘어지지 않습니다.`,
    });
  } else if (collinear) {
    issues.push({
      level: 'block',
      code: 'COLLINEAR',
      message: '지지점이 모두 한 직선 위에 있습니다. 모듈이 그 선을 축으로 회전하는 '
        + '모델이 되어 응력이 실제와 무관한 값으로 나옵니다.',
    });
  }

  if (cogMm && !supportsCentroid && !collinear) {
    issues.push({
      level: 'warn',
      code: 'COG_OUTSIDE',
      message: '무게중심이 지지 다각형 밖입니다. 실제로는 전도되는 배치입니다.',
    });
  }

  // 강체에 묶인 절점도 지지점으로 **쓸 수 있다**(합본에서는 RBE2 의 독립 절점이 된다).
  // 다만 하중이 그 강체를 거쳐 들어가므로, 어디를 받치는지 알고 고르라고 알린다.
  const rigidDependentCount = rigidDependent
    ? points.filter(p => rigidDependent.has(p.i)).length : 0;
  if (rigidDependentCount) {
    issues.push({
      level: 'info',
      code: 'RIGID_DEPENDENT',
      message: `선택 중 ${rigidDependentCount}개가 모델 자체 강체(RBE2)의 종속 절점입니다. `
        + '지지점으로 쓸 수 있지만, 스툴 하중이 부재가 아니라 그 강체를 거쳐 들어갑니다.',
    });
  }

  if (zRangeMm > 1.0) {
    issues.push({
      level: 'info',
      code: 'Z_SPREAD',
      message: `지지점 높이가 ${Math.round(zRangeMm).toLocaleString()}mm 차이 납니다. `
        + '실제로는 그만큼 높이가 다른 스툴이 필요합니다.',
    });
  }

  return {
    count, hullAreaMm2, spanMm, zRangeMm,
    collinear, supportsCentroid, rigidDependentCount,
    // block 이 하나라도 있으면 해석을 걸 수 없다.
    ok: !issues.some(i => i.level === 'block'),
    issues,
  };
}

/**
 * 선택 인덱스 집합 -> 모델 좌표 점 목록.
 * 인덱스는 뷰어 슬림 페이로드의 positions 인덱스이며, nodeIds 와 같은 순서다.
 */
export function selectionPoints(model, indices) {
  const out = [];
  if (!model?.positions) return out;
  indices.forEach((i) => {
    const base = i * 3;
    if (base + 2 >= model.positions.length) return;
    out.push({ i, x: model.positions[base], y: model.positions[base + 1], z: model.positions[base + 2] });
  });
  return out;
}

/** 선택 인덱스 -> BDF 절점 ID. 매핑이 없는 인덱스는 버린다. */
export function selectionNodeIds(model, indices) {
  const ids = model?.nodeIds || [];
  const out = [];
  indices.forEach((i) => {
    const id = ids[i];
    if (Number.isFinite(id)) out.push(id);
  });
  return out;
}
