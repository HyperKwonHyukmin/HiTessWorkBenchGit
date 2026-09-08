import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLegReactionModel, buildLegBeamColors, buildReactionArrows,
  legIndexFromNodeIndex, legTopIndex, legBottomIndex, COG_INDEX, kN,
  legTopZ, DEFAULT_COLUMN_HEIGHT_MM, kNm,
} from './legReactionModel.js';

// 실제 정반 A — Leg(용접부) z=-125, Module Unit 을 받는 기둥 상단 z=2020.
const LEGS = [
  { index: 1, jungbanNodeId: 102723, spcNodeId: 102723, x: 20260, y: 5200, z: -125,
    zTopMm: 2020, fxN: 0, fyN: 0, fzN: 115761.3, resultantN: 115761.3 },
  { index: 2, jungbanNodeId: 102724, spcNodeId: 102724, x: 26260, y: -5200, z: -125,
    zTopMm: 2020, fxN: 1000, fyN: 0, fzN: 216547.7, resultantN: 216550.0089477948 },
];
const COG = [27494.6, 89.9, 5330.3];

test('CoG 하나 + Leg 마다 상단·하단 = 절점 2N+1', () => {
  const m = buildLegReactionModel(LEGS, COG);
  assert.equal(m.nodeCount, 5);
  assert.equal(m.positions.length, 15);
  assert.deepEqual(m.positions.slice(0, 3), COG);
});

test('기둥은 Leg(용접부)에서 위로 선다 — 하단이 SPC 자리다', () => {
  // 아래로 매달면 모멘트 지렛대가 실제의 1/4 이 된다(백엔드와 같은 함정).
  const m = buildLegReactionModel(LEGS, COG);
  const top = legTopIndex(0) * 3;
  const bot = legBottomIndex(0) * 3;
  assert.deepEqual(m.positions.slice(top, top + 3), [20260, 5200, 2020]);
  assert.deepEqual(m.positions.slice(bot, bot + 3), [20260, 5200, -125]);
});

test('zTopMm 이 없는 옛 결과는 실측 기본 높이로 그린다', () => {
  const legacy = LEGS.map(({ zTopMm, ...rest }) => rest);
  assert.equal(legTopZ(legacy[0]), -125 + DEFAULT_COLUMN_HEIGHT_MM);
  const m = buildLegReactionModel(legacy, COG);
  const top = legTopIndex(0) * 3;
  assert.equal(m.positions[top + 2], -125 + DEFAULT_COLUMN_HEIGHT_MM);
});

test('기둥은 빔, CoG-상단은 강체로 나간다', () => {
  const m = buildLegReactionModel(LEGS, COG);
  assert.deepEqual([...m.beams], [1, 2, 3, 4]);
  assert.deepEqual([...m.rigids], [0, 1, 0, 3]);
  assert.equal(m.beamCount, 2);
  assert.equal(m.rigidCount, 2);
});

test('절점 ID 는 실제 BDF ID 라 화면에 그대로 띄울 수 있다', () => {
  const m = buildLegReactionModel(LEGS, COG);
  assert.deepEqual(m.nodeIds, [9999, 102723, 102723, 102724, 102724]);
});

test('찍은 절점 인덱스를 Leg 순번으로 되짚는다 — 상단·하단 어느 쪽을 찍어도 같은 Leg', () => {
  assert.equal(legIndexFromNodeIndex(legTopIndex(0)), 0);
  assert.equal(legIndexFromNodeIndex(legBottomIndex(0)), 0);
  assert.equal(legIndexFromNodeIndex(legTopIndex(1)), 1);
  assert.equal(legIndexFromNodeIndex(legBottomIndex(1)), 1);
  assert.equal(legIndexFromNodeIndex(COG_INDEX), null, 'CoG 는 Leg 가 아니다');
});

test('bounds 는 CoG 까지 포함한다 — 카메라가 무게중심을 잘라내면 안 된다', () => {
  const m = buildLegReactionModel(LEGS, COG);
  assert.equal(m.bounds.max[2], COG[2]);
  assert.equal(m.bounds.min[2], -125);
  assert.equal(m.bounds.min[0], 20260);
  assert.equal(m.bounds.max[0], COG[0]);
});

test('Leg 가 없으면 null — 그릴 것이 없다', () => {
  assert.equal(buildLegReactionModel([], COG), null);
  assert.equal(buildLegReactionModel(LEGS, null), null);
});

test('기둥 색은 합력 크기를 따르고, 최대 Leg 가 램프 끝색이다', () => {
  const colors = buildLegBeamColors(LEGS);
  const rgb = (i, v = 0) => [0, 1, 2].map(j => Math.round(colors[i * 6 + v * 3 + j] * 255));
  // 색 범위는 0 ~ 최대합력이라, 최대인 Leg 만 램프 끝색이 된다.
  assert.deepEqual(rgb(1), [249, 115, 22]);
  assert.notDeepEqual(rgb(0), rgb(1), '덜 받는 Leg 는 다른 색이어야 한다');
  assert.deepEqual(rgb(0, 0), rgb(0, 1), '한 기둥의 두 정점은 같은 색');
  assert.equal(colors.length, LEGS.length * 6);
});

test('반력이 0 인 Leg 는 램프 시작색', () => {
  const colors = buildLegBeamColors([{ ...LEGS[0], resultantN: 0 }, LEGS[1]]);
  assert.deepEqual([0, 1, 2].map(j => Math.round(colors[j] * 255)), [37, 99, 235]);
});

test('선택한 Leg 는 흰색으로 짚는다', () => {
  const colors = buildLegBeamColors(LEGS, { selectedIndex: 0 });
  const rgb = [0, 1, 2].map(j => Math.round(colors[j] * 255));
  assert.deepEqual(rgb, [255, 255, 255]);
});

test('반력 화살표는 기둥 하단(SPC=용접부)에서 시작하고 최대 합력이 목표 길이가 된다', () => {
  const arrows = buildReactionArrows(LEGS, 2145, 1500);
  assert.equal(arrows.length, 2);
  assert.deepEqual(arrows[0].from, [20260, 5200, -125]);
  // 최대 Leg(2번) 의 화살표 길이가 목표치와 같아야 한다.
  const a = arrows[1];
  const len = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1], a.to[2] - a.from[2]);
  assert.ok(Math.abs(len - 1500) < 1e-6, `길이 ${len}`);
});

test('반력이 0 이어도 나눗셈이 폭주하지 않는다', () => {
  const zero = [{ ...LEGS[0], fxN: 0, fyN: 0, fzN: 0, resultantN: 0 }];
  const arrows = buildReactionArrows(zero, 2145);
  assert.deepEqual(arrows[0].to, arrows[0].from);
  assert.ok(buildLegBeamColors(zero));
});

test('kN 변환', () => {
  assert.equal(kN(115761.3), '115.8');
  assert.equal(kN(-1000), '-1');
});

test('★ 모멘트는 N·mm 라 kN·m 로 바꿀 때 1e6 으로 나눈다', () => {
  // kN() 을 쓰면 N·m 가 나오는데 화면 라벨은 kN·m 였다 — 1,000배 어긋난 실제 버그.
  assert.equal(kNm(1.0e6), '1');       // 1e6 N·mm = 1 kN·m
  assert.equal(kN(1.0e6), '1,000');    // 같은 값을 kN() 에 넣으면 1,000 이 나온다
  assert.equal(kNm(-2.5e6), '-2.5');
});
