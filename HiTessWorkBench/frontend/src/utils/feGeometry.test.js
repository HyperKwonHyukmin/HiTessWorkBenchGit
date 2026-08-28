import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTriangleIndices,
  buildShellEdgeIndices,
  toIndexArray,
  computeModulePlacement,
  buildDeckSurface,
  isOnPlate,
  deckSurfaceZAt,
  prepareModuleFootprint,
  computeSeating,
  convexHull2D,
  polygonArea,
  pointInPolygon,
  transformModulePoint,
  combineMassProperties,
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

/* ── 적치(seating) ──────────────────────────────────────────────────────── */

test('정반에서 상판과 높이맵을 뽑는다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  assert.equal(s.topZ, 8026);
  // 상판만 접촉 대상이다 — 6m 아래 하단은 포함되지 않는다.
  assert.deepEqual(s.plateBBox, [0, 0, 1000, 2000]);
  assert.equal(s.plateIsSolidRect, true);
});

test('상판 판정은 상판 영역에만 참이다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  assert.equal(isOnPlate(s, 500, 1000), true);
  assert.equal(isOnPlate(s, -500, 1000), false);   // 하단 위
  assert.equal(isOnPlate(s, 5000, 1000), false);   // 정반 밖
});

test('높이맵은 2단 정반의 단차를 그대로 돌려준다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  assert.equal(deckSurfaceZAt(s, 500, 1000), 8026);
  assert.equal(deckSurfaceZAt(s, -500, 1000), 2020);   // 상판 아니라 하단
  assert.equal(deckSurfaceZAt(s, 9999, 1000), null);   // 허공
});

test('상판 위 최저 절점이 상판에 닿도록 gapMm 을 정한다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  // 스키드(z=0)가 상판 위에 오도록 배치 — 내릴 것이 없으므로 gap 0.
  const r = computeSeating(s, f, { deckCenter: [500, 1000], rotationZDeg: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.gapMm, 0);
  assert.equal(r.contacts.length, 4);
  assert.equal(r.penetrationCount, 0);
});

test('상판 밖 부분이 단차 위로 내밀려도 관통이 아니다', () => {
  // 축소 모형에서 상판은 X 0~1000. 모듈을 X=1000 근처에 두면 절반이 상판 밖(허공/하단)이다.
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [900, 1000], rotationZDeg: 0 });
  assert.equal(r.ok, true);
  assert.ok(r.offPlateCount > 0);
  // 상판에 앉았을 뿐 하단(2020)까지 내려가지 않았다.
  assert.equal(r.penetrationCount, 0);
});

test('상판 위에 절점이 하나도 없으면 실패로 알린다', () => {
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const r = computeSeating(s, f, { deckCenter: [-600, 1000], rotationZDeg: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.onPlateCount, 0);
  assert.match(r.reason, /상판 위에 놓인 절점이 없습니다/);
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

test('완전 대칭 배치에서는 거울상 두 각도가 모든 지표에서 동점이다', () => {
  // 이때는 코드가 고를 근거가 없다 — 그래서 자동 적용 대신 후보를 나열해 사용자가 고른다.
  const s = buildDeckSurface(makeTwoLevelDeck());
  const f = prepareModuleFootprint(makeEdgeSkidModule());
  const a = computeSeating(s, f, { deckCenter: [500, 1000], rotationZDeg: 90 });
  const b = computeSeating(s, f, { deckCenter: [500, 1000], rotationZDeg: 270 });
  assert.equal(Math.round(a.contactEdgeMarginMm), Math.round(b.contactEdgeMarginMm));
  assert.equal(a.onPlateRatio, b.onPlateRatio);
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
