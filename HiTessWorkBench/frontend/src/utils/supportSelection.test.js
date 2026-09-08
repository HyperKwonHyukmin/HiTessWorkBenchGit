import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSupportSelection, selectionPoints, selectionNodeIds, DEGENERATE_AREA_MM2,
  rigidDependentIndices,
} from './supportSelection.js';

const codes = (r) => r.issues.map(i => i.code);

test('선택이 비면 실행 불가', () => {
  const r = evaluateSupportSelection([]);
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['EMPTY']);
});

test('한 직선 위의 지지점은 차단한다 — 이번 사고의 실제 배치', () => {
  // 실측: 자동 탐지가 고른 5개 절점은 전부 Y=-19099 였다.
  const pts = [138450, 140550, 143550, 147450, 149550]
    .map(x => ({ x, y: -19099, z: 29262 }));
  const r = evaluateSupportSelection(pts);
  assert.equal(r.collinear, true);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('COLLINEAR'));
  assert.equal(r.hullAreaMm2, 0);
});

test('3점 미만은 개수로 먼저 막는다', () => {
  const r = evaluateSupportSelection([{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }]);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('TOO_FEW'));
  // 개수 문제일 때 공선 메시지까지 겹쳐 내면 사용자가 조치를 헷갈린다.
  assert.ok(!codes(r).includes('COLLINEAR'));
});

test('넓게 퍼진 4점 + 내부 무게중심이면 통과', () => {
  const pts = [
    { x: 0, y: 0, z: 0 }, { x: 10000, y: 0, z: 0 },
    { x: 10000, y: 8000, z: 0 }, { x: 0, y: 8000, z: 0 },
  ];
  const r = evaluateSupportSelection(pts, { cogMm: { x: 5000, y: 4000 } });
  assert.equal(r.ok, true);
  assert.equal(r.collinear, false);
  assert.equal(r.supportsCentroid, true);
  assert.equal(r.issues.length, 0);
  assert.equal(Math.round(r.hullAreaMm2), 80000000);
  assert.deepEqual(r.spanMm, [10000, 8000]);
});

test('무게중심이 지지 다각형 밖이면 경고(차단은 아님)', () => {
  const pts = [
    { x: 0, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }, { x: 5000, y: 5000, z: 0 },
  ];
  const r = evaluateSupportSelection(pts, { cogMm: { x: 100, y: 4500 } });
  assert.equal(r.supportsCentroid, false);
  assert.ok(codes(r).includes('COG_OUTSIDE'));
  assert.equal(r.ok, true, '전도 경고는 알리되 사용자 판단에 맡긴다');
});

test('거의 찌부러진 다각형도 공선으로 본다', () => {
  // 11m 길이에 폭 0.5mm — 면적은 있지만 회전을 막지 못한다.
  const pts = [
    { x: 0, y: 0, z: 0 }, { x: 11000, y: 0, z: 0 }, { x: 5500, y: 0.5, z: 0 },
  ];
  const r = evaluateSupportSelection(pts);
  assert.ok(r.hullAreaMm2 > 0);
  assert.ok(r.hullAreaMm2 < DEGENERATE_AREA_MM2);
  assert.equal(r.collinear, true);
  assert.equal(r.ok, false);
});

test('지지점 높이 차이는 스툴 높이로 안내한다', () => {
  const pts = [
    { x: 0, y: 0, z: 0 }, { x: 10000, y: 0, z: 191 },
    { x: 10000, y: 8000, z: 338 }, { x: 0, y: 8000, z: 76 },
  ];
  const r = evaluateSupportSelection(pts, { cogMm: { x: 5000, y: 4000 } });
  assert.equal(r.zRangeMm, 338);
  const z = r.issues.find(i => i.code === 'Z_SPREAD');
  assert.ok(z && z.level === 'info');
  assert.match(z.message, /338mm/);
  assert.equal(r.ok, true, '높이 차이는 스툴로 해결되므로 막지 않는다');
});

test('같은 높이면 스툴 안내를 내지 않는다', () => {
  const pts = [
    { x: 0, y: 0, z: 100 }, { x: 10000, y: 0, z: 100 },
    { x: 10000, y: 8000, z: 100 }, { x: 0, y: 8000, z: 100 },
  ];
  const r = evaluateSupportSelection(pts, { cogMm: { x: 5000, y: 4000 } });
  assert.ok(!codes(r).includes('Z_SPREAD'));
});

test('선택 인덱스를 모델 좌표와 BDF 절점 ID 로 푼다', () => {
  const model = {
    positions: [0, 0, 0, 100, 200, 300, 400, 500, 600],
    nodeIds: [11, 22, 33],
  };
  const sel = new Set([2, 0]);
  const pts = selectionPoints(model, sel);
  assert.equal(pts.length, 2);
  assert.deepEqual(pts.map(p => p.i).sort(), [0, 2]);
  assert.deepEqual(selectionNodeIds(model, sel).sort((a, b) => a - b), [11, 33]);
});

test('범위 밖 인덱스는 조용히 버린다 — 모델이 바뀐 뒤의 낡은 선택', () => {
  const model = { positions: [0, 0, 0], nodeIds: [11] };
  assert.equal(selectionPoints(model, new Set([5])).length, 0);
  assert.deepEqual(selectionNodeIds(model, new Set([5])), []);
});

test('rigids 배열에서 종속 절점 인덱스만 뽑는다', () => {
  // [독립, 종속, 독립, 종속, ...] 평탄 배열이다.
  const dep = rigidDependentIndices({ rigids: [5, 6, 5, 7, 9, 10] });
  assert.deepEqual([...dep].sort((a, b) => a - b), [6, 7, 10]);
  assert.equal(rigidDependentIndices({}).size, 0);
});

test('★ RBE2 종속 절점도 지지점으로 쓸 수 있다 — 막지 않고 알리기만 한다', () => {
  // 합본에서 지지점은 SPC 가 아니라 지지 RBE2 의 **독립 절점**이다. 한 절점이 다른
  // RBE2 의 종속이면서 새 RBE2 의 독립인 것은 Nastran 이 허용한다(실측 확인).
  const pts = [
    { i: 0, x: 0, y: 0, z: 0 }, { i: 1, x: 10000, y: 0, z: 0 },
    { i: 2, x: 10000, y: 8000, z: 0 }, { i: 3, x: 0, y: 8000, z: 0 },
  ];
  const r = evaluateSupportSelection(pts, { rigidDependent: new Set([2]) });
  assert.equal(r.rigidDependentCount, 1);
  const issue = r.issues.find(i => i.code === 'RIGID_DEPENDENT');
  assert.ok(issue && issue.level === 'info', '경고나 차단이 아니라 안내다');
  assert.doesNotMatch(issue.message, /제외/, '해석에서 빠진다는 말은 사실이 아니다');
  assert.equal(r.ok, true);
});

test('★ 전부 RBE2 종속이어도 차단하지 않는다', () => {
  const pts = [
    { i: 0, x: 0, y: 0, z: 0 }, { i: 1, x: 10000, y: 0, z: 0 }, { i: 2, x: 5000, y: 8000, z: 0 },
  ];
  const r = evaluateSupportSelection(pts, { rigidDependent: new Set([0, 1, 2]) });
  assert.equal(r.ok, true, '남는 지지점이 없다는 판정은 SPC 시절의 잔재였다');
  assert.equal(r.issues.find(i => i.code === 'RIGID_DEPENDENT').level, 'info');
});
