import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTriangleIndices,
  buildShellEdgeIndices,
  toIndexArray,
  computeModulePlacement,
} from './feGeometry.js';

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
