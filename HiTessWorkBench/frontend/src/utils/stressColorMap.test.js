import test from 'node:test';
import assert from 'node:assert/strict';
import {
  usageColor, buildBeamColors, indexByElementId, elementMidpoint,
  OVER_COLOR, NO_DATA_COLOR, DIMMED_COLOR, HIGHLIGHT_COLOR,
  buildNodalBeamColors, nodalDisplacementArrays, deformedPositions, autoDeformScale,
} from './stressColorMap.js';

const rgbOf = (colors, segment, vertex = 0) => [
  Math.round(colors[segment * 6 + vertex * 3] * 255),
  Math.round(colors[segment * 6 + vertex * 3 + 1] * 255),
  Math.round(colors[segment * 6 + vertex * 3 + 2] * 255),
];

test('허용 초과는 보간 없이 빨강', () => {
  assert.deepEqual(usageColor(1.0001), OVER_COLOR);
  assert.deepEqual(usageColor(452), OVER_COLOR);
});

test('사용률 0 은 램프 시작색, 1.0 은 끝색', () => {
  assert.deepEqual(usageColor(0), [37, 99, 235]);
  assert.deepEqual(usageColor(1), [249, 115, 22]);
});

test('음수 사용률도 시작색으로 잘린다', () => {
  // 응력은 절대값이라 음수가 나오지 않지만, 방어가 없으면 램프 밖을 참조한다.
  assert.deepEqual(usageColor(-3), [37, 99, 235]);
});

test('색은 선분 순서를 따라간다 — 요소 ID 순이 아니다', () => {
  // beamIds 가 오름차순이 아닌 경우가 실제 모델의 기본이다.
  const beams = [0, 1, 1, 2, 2, 3];
  const beamIds = [77, 12, 90];
  const usageOf = indexByElementId([
    { elementId: 12, usage: 5 },     // 초과
    { elementId: 77, usage: 0 },     // 최저
    { elementId: 90, usage: 1 },     // 허용 도달
  ]);
  const colors = buildBeamColors(beams, beamIds, usageOf);
  assert.deepEqual(rgbOf(colors, 0), [37, 99, 235]);
  assert.deepEqual(rgbOf(colors, 1), OVER_COLOR);
  assert.deepEqual(rgbOf(colors, 2), [249, 115, 22]);
});

test('선분의 두 정점은 같은 색이다', () => {
  const colors = buildBeamColors([0, 1], [5], indexByElementId([{ elementId: 5, usage: 0.5 }]));
  assert.deepEqual(rgbOf(colors, 0, 0), rgbOf(colors, 0, 1));
  assert.equal(colors.length, 6);
});

test('응력 결과가 없는 요소는 회색', () => {
  const colors = buildBeamColors([0, 1], [999], indexByElementId([{ elementId: 5, usage: 0.5 }]));
  assert.deepEqual(rgbOf(colors, 0), NO_DATA_COLOR);
});

test('초과만 보기에서 합격 부재는 가라앉고 초과는 그대로', () => {
  const usageOf = indexByElementId([
    { elementId: 1, usage: 0.4 },
    { elementId: 2, usage: 2.0 },
  ]);
  const colors = buildBeamColors([0, 1, 1, 2], [1, 2], usageOf, { onlyExceed: true });
  assert.deepEqual(rgbOf(colors, 0), DIMMED_COLOR);
  assert.deepEqual(rgbOf(colors, 1), OVER_COLOR);
});

test('사용률 정확히 1.0 은 초과가 아니다', () => {
  // 백엔드 verdict 는 usage > 1.0 을 NG 로 본다 — 색도 같은 경계를 써야 한다.
  const colors = buildBeamColors([0, 1], [1], indexByElementId([{ elementId: 1, usage: 1.0 }]),
    { onlyExceed: true });
  assert.deepEqual(rgbOf(colors, 0), DIMMED_COLOR);
});

test('beamIds 길이가 어긋나면 조용히 그리지 않고 멈춘다', () => {
  // 한 칸만 밀려도 엉뚱한 부재가 붉어지는데 화면은 정상으로 보인다.
  assert.throws(
    () => buildBeamColors([0, 1, 1, 2], [1], new Map()),
    /개수가 다릅니다/,
  );
});

test('빔이 없으면 null — 색 없이 기본 렌더로 떨어진다', () => {
  assert.equal(buildBeamColors([], [], new Map()), null);
  assert.equal(buildBeamColors(undefined, undefined, new Map()), null);
});

test('최대 응력 부재의 중점을 모델 좌표로 돌려준다', () => {
  const model = {
    positions: [0, 0, 0, 100, 0, 0, 100, 200, 0],
    beams: [0, 1, 1, 2],
    beamIds: [10, 20],
  };
  assert.deepEqual(elementMidpoint(model, 20), { x: 100, y: 100, z: 0 });
  assert.equal(elementMidpoint(model, 999), null);
  assert.equal(elementMidpoint({}, 10), null);
});

test('표에서 고른 부재는 사용률과 무관하게 흰색으로 짚는다', () => {
  const usageOf = indexByElementId([
    { elementId: 1, usage: 0 },
    { elementId: 2, usage: 5.0 },
  ]);
  const colors = buildBeamColors([0, 1, 1, 2], [1, 2], usageOf, { highlightElementId: 2 });
  assert.deepEqual(rgbOf(colors, 0), [37, 99, 235], '고르지 않은 부재는 원래 색');
  assert.deepEqual(rgbOf(colors, 1), HIGHLIGHT_COLOR);
});

test('강조는 초과만 보기보다 우선한다 — 가라앉히면 고른 것을 못 본다', () => {
  const usageOf = indexByElementId([{ elementId: 1, usage: 0.2 }]);
  const colors = buildBeamColors([0, 1], [1], usageOf,
    { onlyExceed: true, highlightElementId: 1 });
  assert.deepEqual(rgbOf(colors, 0), HIGHLIGHT_COLOR);
});

// ── 변위 ──────────────────────────────────────────────────────────────

test('절점 변위를 positions 인덱스 순서로 푼다 — nodeIds 로 잇는다', () => {
  const model = { nodeIds: [101, 205, 309] };
  const { tx, ty, tz, mag } = nodalDisplacementArrays(model, [
    { nodeId: 309, t1: 1, t2: 2, t3: 2, mag: 3 },
    { nodeId: 101, t1: -1, t2: 0, t3: 0, mag: 1 },
  ]);
  assert.deepEqual([...tx], [-1, 0, 1]);
  assert.deepEqual([...ty], [0, 0, 2]);
  assert.deepEqual([...tz], [0, 0, 2]);
  assert.deepEqual([...mag], [1, 0, 3]);
});

test('모델에 없는 절점 변위는 조용히 버린다', () => {
  const { mag } = nodalDisplacementArrays({ nodeIds: [1] }, [{ nodeId: 999, t1: 5, t2: 0, t3: 0 }]);
  assert.deepEqual([...mag], [0]);
});

test('mag 가 없으면 성분에서 계산한다', () => {
  const { mag } = nodalDisplacementArrays({ nodeIds: [1] }, [{ nodeId: 1, t1: 3, t2: 4, t3: 0 }]);
  assert.equal(mag[0], 5);
});

test('변형 형상은 원형상 + 배율×변위', () => {
  const out = deformedPositions(
    [0, 0, 0, 10, 10, 10],
    { tx: new Float64Array([1, -1]), ty: new Float64Array([0, 2]), tz: new Float64Array([0, 0]) },
    10,
  );
  assert.deepEqual([...out], [10, 0, 0, 0, 30, 10]);
});

test('배율 0 이면 원형상 그대로 — 원본과 겹쳐 보기 위한 기준', () => {
  const src = [1, 2, 3];
  const out = deformedPositions(src, { tx: new Float64Array([9]), ty: new Float64Array([9]), tz: new Float64Array([9]) }, 0);
  assert.deepEqual([...out], src);
});

test('자동 배율은 최대 변위를 모델 대각선의 5% 로 만든다', () => {
  const bounds = { min: [0, 0, 0], max: [300, 400, 0] };   // 대각선 500
  assert.equal(autoDeformScale(bounds, 5), 5);            // 500*0.05/5 = 5
  assert.equal(autoDeformScale(bounds, 0), 1, '변위가 0 이면 과장할 것이 없다');
  assert.equal(autoDeformScale(null, 10), 1);
});

test('절점 색은 선분의 두 끝을 각각 칠한다 — 부재를 따라 색이 이어진다', () => {
  const colors = buildNodalBeamColors([0, 1], new Float64Array([0, 10]), { lo: 0, hi: 10 });
  assert.deepEqual(rgbOf(colors, 0, 0), [37, 99, 235]);    // 램프 시작
  assert.deepEqual(rgbOf(colors, 0, 1), [249, 115, 22]);   // 램프 끝
});

test('음수 성분도 lo..hi 범위로 펴서 칠한다', () => {
  // X 변위 -8 ~ +8 처럼 부호가 있는 성분.
  const colors = buildNodalBeamColors([0, 1], new Float64Array([-8, 8]), { lo: -8, hi: 8 });
  assert.deepEqual(rgbOf(colors, 0, 0), [37, 99, 235]);
  assert.deepEqual(rgbOf(colors, 0, 1), [249, 115, 22]);
});

test('범위가 0 폭이면 램프 시작색으로 떨어진다 — 나눗셈 폭주 방지', () => {
  const colors = buildNodalBeamColors([0, 1], new Float64Array([5, 5]), { lo: 5, hi: 5 });
  assert.deepEqual(rgbOf(colors, 0, 0), [37, 99, 235]);
});
