import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFindQuery, elementPathNodes, computeGroupOffsets, resolveFind,
} from './doublePipeFind.js';

test('찾는 글: 쉼표·공백 구분, 앞글자 N/E, 번호만은 기본 종류', () => {
  const { items, invalid } = parseFindQuery('E46, 47 n12,  N12; x9', 'element');
  assert.deepEqual(items.map(i => i.label), ['E46', 'E47', 'N12']);
  assert.deepEqual(invalid, ['x9']);
  assert.deepEqual(parseFindQuery('5', 'node').items.map(i => i.label), ['N5']);
});

test('ELBOW 의 곡률 중심 Node 는 선에 넣지 않는다', () => {
  assert.deepEqual(elementPathNodes({ type: 'ELBOW31B', nodes: [2, 85, 84] }), [2, 85]);
  assert.deepEqual(elementPathNodes({ type: 'B32', nodes: [3, 150, 40] }), [3, 150, 40]);
});

// 실제 엔진 inp 모양: 외관은 내관 옆(Y +5)으로 옮겨져 있고, 화면 CSV 는 외관이 Y +15000.
const model = {
  nodes: {
    1: [0, 5, 0], 2: [1000, 5, 0],          // 외관
    3: [0, 0, 0], 4: [1000, 0, 0],          // 내관
  },
  elements: {
    10: { type: 'B32', group: 'outer', nodes: [1, 2] },
    20: { type: 'B32', group: 'inner', nodes: [3, 4] },
    30: { type: 'CONN3D2', group: 'connector', nodes: [3, 1] },
  },
};
const csvPoints = {
  outer: [[0, 15000, 0], [1000, 15000, 0]],
  inner: [[0, 0, 0], [1000, 0, 0]],
};

test('관별 이동 거리 = 두 모델 범위의 차', () => {
  const off = computeGroupOffsets(model, csvPoints);
  assert.deepEqual(off.outer, [0, 14995, 0]);
  assert.deepEqual(off.inner, [0, 0, 0]);
});

test('찾은 대상은 화면 좌표, 없는 번호는 missing', () => {
  const off = computeGroupOffsets(model, csvPoints);
  const { items } = parseFindQuery('E10, E30, N2, E99, N77');
  const res = resolveFind(items, model, off);
  assert.deepEqual(res.elements[0].path, [[0, 15000, 0], [1000, 15000, 0]]);
  // 연결 요소는 내관 Node 와 외관 Node 를 각자 화면 자리에 잇는다.
  assert.deepEqual(res.elements[1].path, [[0, 0, 0], [0, 15000, 0]]);
  assert.deepEqual(res.nodes[0].pos, [1000, 15000, 0]);
  assert.deepEqual(res.missing, ['E99', 'N77']);
});

test('연결 요소에만 쓰인 지지 고정점은 짝 Node 의 관을 따라 옮긴다', () => {
  const m = {
    nodes: { ...model.nodes, 9: [0, 5, 0] },
    elements: { ...model.elements, 40: { type: 'CONN3D2', group: 'connector', nodes: [1, 9] } },
  };
  const off = computeGroupOffsets(m, csvPoints);
  const res = resolveFind(parseFindQuery('N9').items, m, off);
  assert.deepEqual(res.nodes[0].pos, [0, 15000, 0]);
});
