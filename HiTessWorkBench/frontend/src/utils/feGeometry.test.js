import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTriangleIndices,
  buildShellEdgeIndices,
  toIndexArray,
  computeModulePlacement,
  buildDeckSurface,
  isOnPlate,
  landingZAt,
  deckSurfaceZAt,
  prepareModuleFootprint,
  computeSeatGap,
  computeSeating,
  convexHull2D,
  polygonArea,
  pointInPolygon,
  transformModulePoint,
  combineMassProperties,
  compareSeatingCandidates,
  DECK_CLEARANCE_MM,
} from './feGeometry.js';

/**
 * 2단 정반 축소 모형 — 실제 A타입의 성질을 그대로 담았다.
 *   · 상판  z=8026, X 0~1000, Y 0~2000
 *   · 하단  z=2020, X -1000~0, Y 0~2000   (상판 옆 6m 아래 단차)
 * 두 면 모두 수평 쉘(CQUAD4) 하나씩.
 */
function makeTwoLevelDeck() {
  return {
    positions: [
      0, 0, 8026,  1000, 0, 8026,  1000, 2000, 8026,  0, 2000, 8026,      // 상판 0~3
      -1000, 0, 2020,  0, 0, 2020,  0, 2000, 2020,  -1000, 2000, 2020,    // 하단 4~7
    ],
    quads: [0, 1, 2, 3, 4, 5, 6, 7],
    trias: [],
    bounds: { min: [-1000, 0, 2020], max: [1000, 2000, 8026] },
  };
}

/** 바닥이 한쪽 모서리에만 있는 모듈 — 샘플 3521.bdf 의 성질(편심 스키드)을 본뜬 것. */
function makeEdgeSkidModule() {
  return {
    positions: [
      // 낮은 스키드 4점 (y = -400 쪽), z = 0
      -400, -400, 0,   400, -400, 0,   -400, -300, 0,   400, -300, 0,
      // 반대편은 500 높다
      -400, 400, 500,  400, 400, 500,
      // 상부
      -400, -400, 2000, 400, 400, 2000,
    ],
    quads: [], trias: [],
    bounds: { min: [-400, -400, 0], max: [400, 400, 2000] },
  };
}

/**
 * 2단 정반에 맞춰 **바닥이 단차진** 모듈 — 실제 3521 의 성질(하단 5점 + 상단 다수,
 * 단차 6,276mm)을 줄인 것. 낮은 발은 하단 정반에, 높은 발은 상단 정반에 앉는다.
 */
function makeSteppedModule() {
  return {
    positions: [
      -600, 100, 0,     -600, 300, 0,          // 0,1 — 하단에 앉는 발
       600, 100, 6106,   600, 300, 6106,       // 2,3 — 상단에 앉는 발
    ],
    quads: [], trias: [],
    bounds: { min: [-600, 100, 0], max: [600, 300, 6106] },
  };
}

/** 단층 대칭 정반 — 거울상 각도가 실제로 동점이 되는지 볼 때만 쓴다. */
function makeFlatDeck() {
  return {
    positions: [-1000, 0, 8026, 1000, 0, 8026, 1000, 2000, 8026, -1000, 2000, 8026],
    quads: [0, 1, 2, 3], trias: [],
    bounds: { min: [-1000, 0, 8026], max: [1000, 2000, 8026] },
  };
}

test('CQUAD4 는 대각선으로 두 삼각형이 된다', () => {
  assert.deepEqual(buildTriangleIndices([0, 1, 2, 3], []), [0, 1, 2, 0, 2, 3]);
});

test('CTRIA3 는 그대로 삼각형 하나다', () => {
  assert.deepEqual(buildTriangleIndices([], [4, 5, 6]), [4, 5, 6]);
});

test('연결도가 모자란 꼬리는 삼각형을 만들지 않는다', () => {
  // 마지막 3개는 쿼드를 이루지 못한다 — 잘린 배열이 들어와도 인덱스를 지어내지 않아야 한다.
  assert.deepEqual(buildTriangleIndices([0, 1, 2, 3, 4, 5, 6], []), [0, 1, 2, 0, 2, 3]);
});

test('인접 요소가 공유하는 변은 한 번만 그린다', () => {
  // 변 (1,2) 를 공유하는 쿼드 두 개 → 총 변 8개 중 공유변 1개가 접혀 7개.
  const edges = buildShellEdgeIndices([0, 1, 2, 3, 1, 4, 5, 2], [], 6);
  assert.equal(edges.length / 2, 7);
});

test('경계선 정점쌍은 방향과 무관하게 같은 변으로 접힌다', () => {
  const forward = buildShellEdgeIndices([0, 1, 2, 3], [], 4);
  const reversed = buildShellEdgeIndices([3, 2, 1, 0], [], 4);
  const key = (arr) => {
    const pairs = [];
    for (let i = 0; i < arr.length; i += 2) pairs.push(`${arr[i]}-${arr[i + 1]}`);
    return pairs.sort().join('|');
  };
  assert.equal(key(forward), key(reversed));
});

test('퇴화한 변(같은 절점 반복)은 선분이 되지 않는다', () => {
  // 코너 두 개가 겹친 쿼드 → 길이 0 인 변은 버려야 한다.
  const edges = buildShellEdgeIndices([0, 1, 1, 2], [], 3);
  for (let i = 0; i < edges.length; i += 2) {
    assert.notEqual(edges[i], edges[i + 1]);
  }
});

test('절점이 65,535 개를 넘으면 Uint32 인덱스를 쓴다', () => {
  // 정반만 66,816 절점이다. Uint16 으로 잘리면 모델이 조용히 엉뚱하게 이어진다.
  assert.ok(toIndexArray([0, 1], 65535) instanceof Uint16Array);
  assert.ok(toIndexArray([0, 1], 65536) instanceof Uint32Array);

  const big = toIndexArray([70000], 66816);
  assert.equal(big[0], 70000);
});

test('기본 배치는 정반 XY 중심 정렬 + 정반 상면 기준 높이다', () => {
  // 실제 정반 바운딩박스 값.
  const deck = { min: [20010, -8800, -125], max: [57710, 8800, 8026] };
  const module_ = { min: [1000, -2000, 500], max: [9000, 2000, 6500] };

  const p = computeModulePlacement(deck, module_, { gapMm: 5000, offsetXMm: 0, offsetYMm: 0 });

  assert.equal(p.deckTopZ, 8026);
  assert.deepEqual(p.deckCenter, [38860, 0]);
  // anchor 는 Module Unit 의 XY 중심 + 바닥면 → 회전축이자 배치 기준점.
  assert.deepEqual(p.anchor, [5000, 0, 500]);
  assert.deepEqual(p.position, [38860, 0, 13026]);
  assert.equal(p.moduleBottomZ, 13026);
  assert.equal(p.moduleTopZ, 13026 + 6000);
  assert.deepEqual(p.moduleSize, [8000, 4000, 6000]);
});

test('오프셋은 정반 중심 기준으로 더해진다', () => {
  const deck = { min: [0, 0, 0], max: [100, 200, 50] };
  const module_ = { min: [0, 0, 0], max: [10, 10, 10] };

  const p = computeModulePlacement(deck, module_, { gapMm: 5, offsetXMm: -30, offsetYMm: 15 });

  assert.deepEqual(p.position, [50 - 30, 100 + 15, 55]);
});

test('Module Unit 이 아직 없으면 정반 정보만 돌려준다', () => {
  const deck = { min: [0, 0, 0], max: [100, 200, 50] };
  const p = computeModulePlacement(deck, null, { gapMm: 5000, offsetXMm: 0, offsetYMm: 0 });

  assert.equal(p.deckTopZ, 50);
  assert.equal(p.position, null);
  assert.equal(p.anchor, null);
});

test('정반 바운딩박스가 없으면 배치를 계산하지 않는다', () => {
  assert.equal(computeModulePlacement(null, null, {}), null);
});

test('배치 기준은 정반 bbox 가 아니라 상판 중심이다', () => {
  // 실제 B타입 정반: bbox X 38360~57710(중심 48035) 이지만 상판은 X 38360~51460(중심 44910).
  // 2단 정반이라 3,125mm 어긋난다. bbox 에 맞추면 모듈이 상판 밖으로 밀려나고,
  // 지지점이 상판을 벗어나면 내림량 계산에서 빠져 Leg 가 아닌 부재가 상판에 닿는다.
  const deck = { min: [38360, -8800, -125], max: [57710, 8800, 8026] };
  const module_ = { min: [0, -5000, 0], max: [10000, 5000, 8000] };
  const surface = { plateBBox: [38360, -8800, 51460, 8800], topZ: 8026 };

  const p = computeModulePlacement(deck, module_, { gapMm: 0, offsetXMm: 0, offsetYMm: 0 }, surface);

  assert.deepEqual(p.deckCenter, [44910, 0]);
  assert.equal(p.position[0], 44910);
  assert.equal(p.deckTopZ, 8026);
});

test('상판 정보가 없으면 bbox 중심으로 폴백한다', () => {
  // 상판을 못 찾은 정반은 적치 자체가 불가능하다 — 배치라도 그려 주고 화면에서 막는다.
  const deck = { min: [38360, -8800, -125], max: [57710, 8800, 8026] };
  const module_ = { min: [0, -5000, 0], max: [10000, 5000, 8000] };

  const p = computeModulePlacement(deck, module_, { gapMm: 0, offsetXMm: 0, offsetYMm: 0 });

  assert.deepEqual(p.deckCenter, [48035, 0]);
});

/* ── 적치(seating) ──────────────────────────────────────────────────────── */

test('★ 정반의 적치면은 두 층 모두다 — 상단 하나만 보면 하단에 앉을 지지점이 막힌다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  assert.equal(s.topZ, 8026);
  assert.deepEqual(s.levels.map(l => l.z), [8026, 2020], '높이 내림차순');
  assert.deepEqual(s.levels.map(l => l.bbox), [[0, 0, 1000, 2000], [-1000, 0, 0, 2000]]);
  // 배치 기준면은 면적이 가장 넓은 층(같으면 높은 쪽) — deckCenter 가 여기서 나온다.
  assert.equal(s.primary.z, 8026);
  assert.deepEqual(s.plateBBox, [0, 0, 1000, 2000]);
  assert.deepEqual(s.landingBBox, [-1000, 0, 1000, 2000]);
});

test('면적이 미미한 수평면은 적치면이 아니다 — 실제 정반의 베이스 플레이트(전체의 0.6%)가 그렇다', () => {
  const deck = makeTwoLevelDeck();
  // z=-25 에 아주 작은 수평 쉘 하나를 덧붙인다(전체 4,000,000㎟ 중 10,000㎟ = 0.25%).
  const base = deck.positions.length / 3;
  deck.positions.push(1500, 0, -25,  1600, 0, -25,  1600, 100, -25,  1500, 100, -25);
  deck.quads.push(base, base + 1, base + 2, base + 3);
  const s = buildDeckSurface(deck);
  assert.deepEqual(s.levels.map(l => l.z), [8026, 2020], '베이스 플레이트는 걸러진다');
  assert.equal(isOnPlate(s, 1550, 50), false, '적치면이 아니니 지지점을 세울 수 없다');
  // 그래도 높이맵에는 남아 이격 검사에는 쓰인다.
  assert.equal(deckSurfaceZAt(s, 1550, 50), -25);
});

test('적치면 판정은 두 층 모두에 참이고, 층 높이를 돌려준다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  assert.equal(isOnPlate(s, 500, 1000), true);
  assert.equal(isOnPlate(s, -500, 1000), true);    // 하단 정반도 적치면이다
  assert.equal(isOnPlate(s, 5000, 1000), false);   // 정반 밖
  assert.equal(landingZAt(s, 500, 1000), 8026);
  assert.equal(landingZAt(s, -500, 1000), 2020);
  assert.equal(landingZAt(s, 5000, 1000), null);
});

test('높이맵은 2단 정반의 단차를 그대로 돌려준다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  assert.equal(deckSurfaceZAt(s, 500, 1000), 8026);
  assert.equal(deckSurfaceZAt(s, -500, 1000), 2020);   // 상판 아니라 하단
  assert.equal(deckSurfaceZAt(s, 9999, 1000), null);   // 허공
});

test('지지점을 고르기 전에는 모듈 바닥이 상판 +이격에 놓인 미리보기다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [500, 1000], rotationZDeg: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.supportCount, 0);
  assert.equal(r.gapMm, DECK_CLEARANCE_MM);
  assert.ok(r.contacts.every(c => c.z === 8026 + DECK_CLEARANCE_MM));
  assert.equal(r.clearanceShortfallCount, 0);
});

test('★ 적치 높이를 정하는 것은 지지점이다 — 가장 빡빡한 지지점이 적치면 +이격에 온다', () => {
  // 스키드(local z 0) 대신 500mm 위 절점 4·5 를 지지점으로 고르면, 모듈은 그만큼
  // 내려와 스키드가 상판을 파고든다 — 이격 검사가 잡아야 한다(아래 테스트).
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [500, 1000], supportIndices: [4, 5] });
  assert.equal(r.supportCount, 2);
  assert.equal(r.gapMm, DECK_CLEARANCE_MM - 500, '지지점이 500 높으면 모듈은 500 내려온다');
  assert.equal(r.baseZMm, 8026 + DECK_CLEARANCE_MM - 500);
});

test('지지점이 여러 높이면 스툴 길이가 그만큼 달라진다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [500, 1000], supportIndices: [0, 1, 4] });
  assert.equal(r.stoolMinMm, DECK_CLEARANCE_MM);
  assert.equal(r.stoolMaxMm, DECK_CLEARANCE_MM + 500);
  assert.equal(r.supportLevels.length, 1, '셋 다 상단에 앉는다');
});

test('★ 2단 정반 — 지지점마다 자기 층을 찾아 앉고, 층별로 스툴 길이가 다르게 나온다', () => {
  // 이것이 실제 사용자 형상이다: 정반 A 는 상단 8026 / 하단 2020(단차 6,006),
  // 모듈 3521 은 바닥 단차 6,276 — 하단에 5점, 상단에 나머지가 앉도록 설계돼 있다.
  // 상단 하나만 '상판' 으로 보던 시절엔 하단에 앉을 5점이 "상판 밖" 이라 배치가 막혔다.
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeSteppedModule());
  const opt = { deckCenter: [500, 1000], offsetXMm: -500, supportIndices: [0, 1, 2, 3] };
  const r = computeSeating(s, f, opt);

  assert.equal(r.ok, true);
  assert.equal(r.supportsOffPlateCount, 0, '네 발 모두 발밑에 적치면이 있다');
  // baseZ = max(2020 + c - 0, 8026 + c - 6106) = 2020 + c → 하단이 빡빡한 쪽이다.
  // 하단 발은 스툴이 정확히 c, 상단 발은 (모듈 단차 6,106 − 정반 단차 6,006)=100 만큼 길다.
  const c = DECK_CLEARANCE_MM;
  assert.equal(r.baseZMm, 2020 + c);
  assert.deepEqual(r.supportLevels, [
    { landingZMm: 8026, count: 2, stoolMinMm: c + 100, stoolMaxMm: c + 100 },
    { landingZMm: 2020, count: 2, stoolMinMm: c, stoolMaxMm: c },
  ]);
  assert.equal(r.clearanceShortfallCount, 0, '두 층 모두 이격을 지킨다');
  // 값싼 경로(computeSeatGap)와 전체 평가가 같은 높이를 내야 한다 — 화면 미리보기가 이걸 쓴다.
  assert.equal(computeSeatGap(s, f, opt).gapMm, r.gapMm);
});

test('★ 지지점마다 자기 스툴을 돌려준다 — 뷰어가 스툴 기둥을 그리는 데 쓴다', () => {
  // 층별 요약(supportLevels)만으로는 "어느 자리 스툴이 긴가" 를 형상 위에서 못 짚는다.
  // 화면은 이 목록으로 지지점에서 발밑 적치면까지 선을 내려 그린다.
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeSteppedModule());
  const g = computeSeatGap(s, f, {
    deckCenter: [500, 1000], offsetXMm: -500, supportIndices: [0, 1, 2, 3],
  });

  assert.equal(g.supports.length, 4);
  // 하단(2020)에 앉은 두 발은 스툴이 이격값 그대로, 상단(8026)은 단차 차이 100 만큼 길다.
  const c = DECK_CLEARANCE_MM;
  const byLevel = new Map();
  for (const row of g.supports) byLevel.set(row.landingZMm, row.stoolMm);
  assert.deepEqual([...byLevel.entries()].sort((a, b) => b[0] - a[0]),
    [[8026, c + 100], [2020, c]]);
  // 각 행의 i 는 footprint(=positions) 인덱스라, 화면이 그 절점의 월드 좌표를 되짚을 수 있다.
  assert.deepEqual(g.supports.map(row => row.i).sort((a, b) => a - b), [0, 1, 2, 3]);
  // 층별 요약과 같은 값이어야 한다 — 두 경로가 갈리면 화면과 그림이 어긋난다.
  assert.equal(Math.min(...g.supports.map(r => r.stoolMm)), g.stoolMinMm);
  assert.equal(Math.max(...g.supports.map(r => r.stoolMm)), g.stoolMaxMm);
});

test('발밑에 적치면이 없는 지지점은 스툴 목록에서 빠진다 — 그릴 기둥이 없다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeSteppedModule());
  const g = computeSeatGap(s, f, {
    deckCenter: [500, 1000], offsetXMm: 100, supportIndices: [0, 1, 2, 3],
  });
  assert.deepEqual(g.supportsOffPlate, [2, 3]);
  assert.deepEqual(g.supports.map(row => row.i), [0, 1]);
});

test('★ 발밑에 적치면이 없는 지지점은 개수가 아니라 **어느 절점인지** 돌려준다', () => {
  // "5개가 상판 밖입니다" 만으로는 화면에서 찾을 수가 없다는 지적을 받은 자리다.
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeSteppedModule());
  // 정반 밖(x > 1000)으로 밀어 상단 발 2개를 허공에 띄운다.
  const r = computeSeating(s, f, {
    deckCenter: [500, 1000], offsetXMm: 100, supportIndices: [0, 1, 2, 3],
  });
  assert.deepEqual(r.supportsOffPlate, [2, 3]);
  assert.equal(r.supportsOffPlateCount, 2);
});

test('★ 지지점보다 낮은 부재가 상판 위에 있으면 이격 부족으로 잡는다', () => {
  // 사용자 결정: 이 경우는 막고 그 절점을 알려 준다.
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [500, 1000], supportIndices: [4, 5] });
  assert.ok(r.clearanceShortfallCount > 0, '스키드 4점이 상판에 너무 가깝다');
  // 이격이 음수 = 실제로 상판을 200mm 파고들었다.
  assert.ok(Math.abs(r.minDeckClearanceMm - (DECK_CLEARANCE_MM - 500)) < 1e-6,
            `이격 ${r.minDeckClearanceMm}`);
  assert.ok([0, 1, 2, 3].includes(r.worstClearanceIndex), '가장 가까운 절점은 스키드다');
});

test('이격 값을 바꾸면 그만큼 통째로 올라간다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [500, 1000], clearanceMm: 500 });
  assert.equal(r.gapMm, 500);
  assert.ok(r.contacts.every(c => c.z === 8026 + 500));
  assert.equal(r.clearanceShortfallCount, 0);
});

test('상판 밖 부분이 단차 위로 내밀려도 관통이 아니다', () => {
  // 축소 모형에서 상판은 X 0~1000. 모듈을 X=1000 근처에 두면 절반이 상판 밖(허공/하단)이다.
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [900, 1000], rotationZDeg: 0 });
  assert.equal(r.ok, true);
  assert.ok(r.offPlateCount > 0);
  // 상판 위에 떠 있을 뿐 하단(2020)까지 내려가지 않았다 — 이격은 상판 기준으로만 빡빡하다.
  assert.equal(r.clearanceShortfallCount, 0);
});

test('★ 지지점이 상판을 벗어나면 붙일 절점이 없다고 알린다', () => {
  // 사용자가 실제로 겪은 실패다 — B타입 정반 90° 에서 지지점이 상판 끝을 1,981mm 넘어갔다.
  // 관통으로는 안 잡힌다(벗어난 쪽 아래가 허공이라 겹치지 않는다).
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  // Y 를 내려 스키드(local y -400~-300)만 상판 밖으로 뺀다.
  const r = computeSeating(s, f, { deckCenter: [500, 250], supportIndices: [0, 1, 2, 3] });

  assert.equal(r.ok, true);
  assert.equal(r.supportCount, 4);
  assert.equal(r.supportsOffPlateCount, 4, '지지점 4개가 모두 상판 밖이다');
  assert.equal(r.clearanceShortfallCount, 0, '상판 밖이라 정반과 겹치지도 않는다');
});

test('지지점이 상판 안에 있으면 벗어난 지지점이 없다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [500, 1000], supportIndices: [0, 1, 2, 3] });
  assert.equal(r.supportsOffPlateCount, 0);
  assert.equal(r.clearanceShortfallCount, 0);
});

test('상판을 더 많이 덮는 배치가 앞선다 — 최하단 레일이 걸쳤는지보다 우선한다', () => {
  // 실측(정반 A, 샘플 3521): 최하단은 한쪽 모서리 레일 5점뿐이라, 그 5점만 상판에
  // 걸치는 90°(34.6% 점유)가 70.5% 를 덮는 270° 를 이겨 버렸다. 지지점은 최하단이
  // 아니라 상판 위 어느 절점에서든 고를 수 있으므로 점유율이 먼저다.
  const covers = {
    rotationZDeg: 270,
    seating: {
      supportsOffPlateCount: 0, clearanceShortfallCount: 0, supportsCentroid: false,
      contactHullArea: 0, contactSpan: [0, 0], contactEdgeMarginMm: 0, onPlateRatio: 0.705,
    },
  };
  const perches = {
    rotationZDeg: 90,
    seating: {
      supportsOffPlateCount: 0, clearanceShortfallCount: 0, supportsCentroid: false,
      contactHullArea: 0, contactSpan: [0, 11100], contactEdgeMarginMm: 3000, onPlateRatio: 0.346,
    },
  };
  assert.ok(compareSeatingCandidates(covers, perches) < 0, '많이 덮는 쪽이 앞');
  assert.ok(compareSeatingCandidates(perches, covers) > 0);
});

test('적치면 위 최하단 절점이 없어도 범위는 0 이다 — 화면에 -∞ 가 찍히면 안 된다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [500, 250], rotationZDeg: 0 });
  assert.equal(r.contacts.length, 0);
  assert.deepEqual(r.contactSpan, [0, 0]);
  assert.equal(r.contactHullArea, 0);
});

test('적치면 위에 절점이 하나도 없으면 실패로 알린다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [5000, 1000], rotationZDeg: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.onPlateCount, 0);
  assert.match(r.reason, /적치면 위에 놓인 절점이 없습니다/);
});

test('Z 회전은 절점의 z 를 바꾸지 않는다 — 바뀌는 것은 어느 절점이 상판 위에 오는가다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const a = computeSeating(s, f, { deckCenter: [500, 1000], rotationZDeg: 0 });
  const b = computeSeating(s, f, { deckCenter: [500, 1000], rotationZDeg: 90 });
  // 모듈 전체가 상판 안에 있으면 회전과 무관하게 같은 높이에 앉는다.
  assert.equal(a.gapMm, b.gapMm);
});

test('한 줄로만 닿으면 지지 다각형 면적이 0 이고 중심을 못 잡는다', () => {
  const mod = {
    positions: [-400, 0, 0,  400, 0, 0,  -400, 300, 900,  400, 300, 900],
    quads: [], trias: [],
    bounds: { min: [-400, 0, 0], max: [400, 300, 900] },
  };
  const s = buildDeckSurface(makeTwoLevelDeck());
  const r = computeSeating(s, prepareModuleFootprint(mod), { deckCenter: [500, 1000], contactTolMm: 10 });
  assert.equal(r.contacts.length, 2);
  assert.equal(r.contactHullArea, 0);
  assert.equal(r.supportsCentroid, false);
});

test('접촉 허용오차를 키우면 지지점이 더 잡힌다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const tight = computeSeating(s, f, { deckCenter: [500, 1000], contactTolMm: 10 });
  const loose = computeSeating(s, f, { deckCenter: [500, 1000], contactTolMm: 600 });
  assert.equal(tight.contacts.length, 4);
  assert.equal(loose.contacts.length, 6);   // 500mm 위 반대편 모서리까지 포함
});

test('볼록 껍질과 내부 판정', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }];
  const hull = convexHull2D(pts);
  assert.equal(hull.length, 4);            // 내부 점은 껍질에 들어가지 않는다
  assert.equal(polygonArea(hull), 100);
  assert.equal(pointInPolygon(5, 5, hull), true);
  assert.equal(pointInPolygon(15, 5, hull), false);
});

test('가장자리 여유는 거울상 배치(90도/270도)를 구분한다', () => {
  // 상판 X 0~1000 · Y 0~2000. 편심 스키드 모듈을 상판 중심에서 벗어나게 두면
  // 스키드가 어느 쪽으로 가느냐로 가장자리 여유가 갈린다 — 지지 넓이·벌어짐만
  // 보면 두 각도가 완전히 동점이라 이 값이 없으면 코드가 임의로 하나를 고르게 된다.
  // (상판 한가운데에 대칭으로 놓으면 거울상이라 여유까지 같아진다 — 아래 별도 테스트)
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const a = computeSeating(s, f, { deckCenter: [400, 1000], rotationZDeg: 90 });
  const b = computeSeating(s, f, { deckCenter: [400, 1000], rotationZDeg: 270 });
  assert.equal(a.contactHullArea, b.contactHullArea);              // 넓이는 동점
  assert.equal(a.contacts.length, b.contacts.length);              // 지지점 수도 동점
  assert.notEqual(                                                  // 여유는 다르다
    Math.round(a.contactEdgeMarginMm),
    Math.round(b.contactEdgeMarginMm),
  );
});

test('상판 점유 비율을 함께 돌려준다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [500, 1000] });
  assert.equal(r.onPlateRatio, 1);
  const half = computeSeating(s, f, { deckCenter: [950, 1000] });
  assert.ok(half.onPlateRatio > 0 && half.onPlateRatio < 1);
});

test('★ 스툴이 짧은 각도가 이긴다 — 단차 정반에서 12m 스툴은 몇 % 점유로 못 산다', () => {
  // 정반 A + 3521 실측: 270° 는 스툴 300~570mm, 90° 는 300~12,582mm 였다.
  // 모듈 단차와 정반 단차가 맞물리는 각도만 실제로 세울 수 있다.
  const short_ = { rotationZDeg: 270, seating: {
    supportsOffPlateCount: 0, clearanceShortfallCount: 0, stoolMaxMm: 570,
    onPlateRatio: 0.90, contactHullArea: 1e6, contactSpan: [1000, 1000],
    contactEdgeMarginMm: 500, supportsCentroid: true } };
  const tall = { rotationZDeg: 90, seating: {
    supportsOffPlateCount: 0, clearanceShortfallCount: 0, stoolMaxMm: 12582,
    onPlateRatio: 1.00, contactHullArea: 1e6, contactSpan: [1000, 1000],
    contactEdgeMarginMm: 500, supportsCentroid: true } };
  assert.ok(compareSeatingCandidates(short_, tall) < 0, '점유율이 더 높아도 12m 스툴은 진다');
});

test('완전 대칭 배치에서는 거울상 두 각도가 모든 지표에서 동점이다', () => {
  // 이때는 코드가 고를 근거가 없다 — 그래서 자동 적용 대신 후보를 나열해 사용자가 고른다.
  // 정반 자체가 대칭이어야 성립한다(2단 정반은 좌우가 다르다).
  const s = buildDeckSurface(makeFlatDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const a = computeSeating(s, f, { deckCenter: [0, 1000], rotationZDeg: 90 });
  const b = computeSeating(s, f, { deckCenter: [0, 1000], rotationZDeg: 270 });
  assert.equal(Math.round(a.contactEdgeMarginMm), Math.round(b.contactEdgeMarginMm));
  assert.equal(a.onPlateRatio, b.onPlateRatio);
});

test('contacts[] 각 원소는 원본 절점 인덱스 i 를 가진다 — 3단계가 nodeIds[i] 로 BDF 절점 ID 를 찾는 데 쓴다', () => {
  // 바닥이 평평한 4절점 모듈. 절점 0,1,2 는 z=0(접점), 절점 3 만 z=500(비접점).
  const model = {
    positions: [
      -100, -100, 0,     // 0 — 바닥
       100, -100, 0,     // 1 — 바닥
       100,  100, 0,     // 2 — 바닥
      -100,  100, 500,   // 3 — 위쪽, 접점 아님
    ],
    quads: [], trias: [],
    bounds: { min: [-100, -100, 0], max: [100, 100, 500] },
  };
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(model);
  const r = computeSeating(s, f, { deckCenter: [500, 1000], contactTolMm: 10, checkPenetration: false });
  assert.equal(r.ok, true);
  // i 는 model.positions 의 원본 절점 인덱스와 같아야 한다 — prepareModuleFootprint 가
  // 절점을 거르거나 재정렬하지 않고 그대로 펴기 때문이다(아래 별도 테스트로 고정).
  assert.deepEqual(r.contacts.map(c => c.i).sort((x, y) => x - y), [0, 1, 2]);
});

test('prepareModuleFootprint 는 절점을 거르거나 재정렬하지 않는다 — local[3*i] 가 곧 positions[3*i]', () => {
  const model = makeEdgeSkidModule();
  const f = prepareModuleFootprint(model);
  assert.equal(f.count, model.positions.length / 3);
  for (let i = 0; i < f.count; i += 1) {
    assert.equal(f.local[3 * i] + f.anchor[0], model.positions[3 * i]);
    assert.equal(f.local[3 * i + 1] + f.anchor[1], model.positions[3 * i + 1]);
    assert.equal(f.local[3 * i + 2] + f.anchor[2], model.positions[3 * i + 2]);
  }
});

/* ── 중량 / 무게중심 ──────────────────────────────────────────────────── */

const DECK_MASS = { totalMassTon: 100, centerOfGravityMm: { x: 1000, y: 0, z: 500 } };
const MOD_MASS = { totalMassTon: 20, centerOfGravityMm: { x: 50, y: 10, z: 300 } };
// anchor = 모듈 bbox 의 XY 중심 + 최저 Z. computeSeating 이 쓰는 것과 같은 규약.
const PLACEMENT = {
  anchor: [50, 10, 100], deckCenter: [1000, 0], deckTopZ: 800,
  offsetXMm: 0, offsetYMm: 0, rotationZDeg: 0, gapMm: 0,
};

test('transformModulePoint 는 computeSeating 의 절점 변환과 같은 결과를 낸다', () => {
  // 같은 변환이어야 COG 마커가 모델 위에 정확히 얹힌다.
  const s = buildDeckSurface(makeTwoLevelDeck());
  const model = makeEdgeSkidModule();
  const f = prepareModuleFootprint(model);
  const opt = { deckCenter: [500, 1000], rotationZDeg: 90, offsetXMm: 120, offsetYMm: -40 };
  const seat = computeSeating(s, f, opt);

  // 모델의 첫 절점을 두 경로로 각각 옮겨 비교한다.
  const p0 = { x: model.positions[0], y: model.positions[1], z: model.positions[2] };
  const viaUtil = transformModulePoint(p0, {
    anchor: f.anchor, deckCenter: opt.deckCenter, deckTopZ: s.topZ,
    offsetXMm: opt.offsetXMm, offsetYMm: opt.offsetYMm,
    rotationZDeg: opt.rotationZDeg, gapMm: seat.gapMm,
  });
  const th = (opt.rotationZDeg * Math.PI) / 180;
  const lx = f.local[0], ly = f.local[1], lz = f.local[2];
  assert.ok(Math.abs(viaUtil.x - (opt.deckCenter[0] + opt.offsetXMm + lx * Math.cos(th) - ly * Math.sin(th))) < 1e-9);
  assert.ok(Math.abs(viaUtil.y - (opt.deckCenter[1] + opt.offsetYMm + lx * Math.sin(th) + ly * Math.cos(th))) < 1e-9);
  assert.ok(Math.abs(viaUtil.z - (s.topZ + seat.gapMm + lz)) < 1e-9);
});

test('회전 0°·오프셋 0 이면 모듈 COG 는 정반 중심 위 gap 만큼 올라간 자리다', () => {
  const r = combineMassProperties({ deckMass: DECK_MASS, moduleMass: MOD_MASS, placement: PLACEMENT });
  assert.equal(r.module.cogMm.x, 1000);   // anchor 와 COG 의 XY 가 같으므로 deckCenter 그대로
  assert.equal(r.module.cogMm.y, 0);
  assert.equal(r.module.cogMm.z, 800 + (300 - 100));
});

test('합산 무게중심은 질량 가중 평균이다', () => {
  const r = combineMassProperties({ deckMass: DECK_MASS, moduleMass: MOD_MASS, placement: PLACEMENT });
  assert.equal(r.total.massTon, 120);
  // z: (100*500 + 20*1000) / 120
  assert.ok(Math.abs(r.total.cogMm.z - (100 * 500 + 20 * 1000) / 120) < 1e-9);
  // 무거운 정반 쪽에 가까워야 한다 — 단순 평균(750)이면 이 검사가 깨진다.
  assert.ok(r.total.cogMm.z < 750);
});

test('Z축 회전은 모듈 COG 의 높이를 바꾸지 않는다', () => {
  const base = combineMassProperties({ deckMass: DECK_MASS, moduleMass: MOD_MASS, placement: PLACEMENT });
  for (const deg of [90, 180, 270]) {
    const r = combineMassProperties({
      deckMass: DECK_MASS, moduleMass: MOD_MASS,
      placement: { ...PLACEMENT, rotationZDeg: deg },
    });
    assert.ok(Math.abs(r.module.cogMm.z - base.module.cogMm.z) < 1e-9, `${deg}°`);
  }
});

test('회전축에서 벗어난 COG 는 회전에 따라 XY 가 움직인다', () => {
  // anchor 에서 X 로 +500 떨어진 COG 를 90° 돌리면 Y 로 +500 이동해야 한다.
  const off = { totalMassTon: 20, centerOfGravityMm: { x: 550, y: 10, z: 300 } };
  const r = combineMassProperties({
    deckMass: DECK_MASS, moduleMass: off,
    placement: { ...PLACEMENT, rotationZDeg: 90 },
  });
  assert.ok(Math.abs(r.module.cogMm.x - 1000) < 1e-9);
  assert.ok(Math.abs(r.module.cogMm.y - 500) < 1e-9);
});

test('중량 여유는 질량만 키우고 그 물체의 COG 는 움직이지 않는다', () => {
  const plain = combineMassProperties({ deckMass: DECK_MASS, moduleMass: MOD_MASS, placement: PLACEMENT });
  const withPct = combineMassProperties({
    deckMass: DECK_MASS, moduleMass: MOD_MASS, placement: PLACEMENT,
    moduleContingencyPct: 10,
  });
  assert.equal(withPct.module.massTon, 22);
  assert.deepEqual(withPct.module.cogMm, plain.module.cogMm);
  assert.equal(withPct.total.massTon, 122);
  // 모듈이 무거워졌으니 합산 COG 는 모듈 쪽(위)으로 올라가야 한다.
  assert.ok(withPct.total.cogMm.z > plain.total.cogMm.z);
  assert.ok(Math.abs(withPct.contingencyMassTon - 2) < 1e-9);
});

test('여유 0% 면 합산 질량이 원본 그대로다', () => {
  const r = combineMassProperties({ deckMass: DECK_MASS, moduleMass: MOD_MASS, placement: PLACEMENT });
  assert.equal(r.contingencyMassTon, 0);
  assert.equal(r.baseMassTon, 120);
});

test('모듈이 아직 없으면 정반만으로 집계하고 includes 로 알린다', () => {
  const r = combineMassProperties({ deckMass: DECK_MASS });
  assert.equal(r.includes.module, false);
  assert.equal(r.total.massTon, 100);
  assert.deepEqual(r.total.cogMm, DECK_MASS.centerOfGravityMm);
});

test('배치 정보가 없으면 모듈은 좌표계가 달라 합산에서 빠진다', () => {
  // 모듈 COG 를 모델 좌표 그대로 섞으면 엉뚱한 값이 나온다 — 빼는 편이 옳다.
  const r = combineMassProperties({ deckMass: DECK_MASS, moduleMass: MOD_MASS });
  assert.equal(r.includes.module, false);
  assert.equal(r.total.massTon, 100);
});

test('질량이 계산되지 않은(unavailable) 페이로드는 0t 이 아니라 제외된다', () => {
  const none = { totalMassTon: null, centerOfGravityMm: null };
  assert.equal(combineMassProperties({ deckMass: none, moduleMass: none, placement: PLACEMENT }), null);
  const r = combineMassProperties({ deckMass: DECK_MASS, moduleMass: none, placement: PLACEMENT });
  assert.equal(r.includes.module, false);
  assert.equal(r.total.massTon, 100);
});

test('COG 좌표에 NaN 이 섞이면 그 항목을 버린다', () => {
  const bad = { totalMassTon: 20, centerOfGravityMm: { x: NaN, y: 0, z: 0 } };
  const r = combineMassProperties({ deckMass: DECK_MASS, moduleMass: bad, placement: PLACEMENT });
  assert.equal(r.includes.module, false);
});
