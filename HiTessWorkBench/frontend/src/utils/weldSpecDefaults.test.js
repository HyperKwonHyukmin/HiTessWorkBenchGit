import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WELD_SPEC, WELD_SPEC_KEYS, normalizeWeldSpec, weldSpecEquals,
} from './weldSpecDefaults.js';

test('기본값은 백엔드 module_ocean_weld.DEFAULT_WELD_SPEC 과 같아야 한다', () => {
  // 백엔드 tests/test_module_ocean_weld.py 가 같은 값을 고정한다.
  // 한쪽만 고치면 화면에 보이는 사양과 실제 판정에 쓰인 사양이 갈라진다.
  assert.deepEqual({ ...DEFAULT_WELD_SPEC }, {
    yieldMPa: 450,
    safetyFactor: 3,
    plateHeightMm: 500,
    plateBreadthMm: 500,
    tackCount: 4,
    weldLengthMm: 268,
    weldLegMm: 10,
  });
});

test('사양 항목은 7개이며 순서가 화면 입력 순서다', () => {
  assert.deepEqual([...WELD_SPEC_KEYS],
    ['yieldMPa', 'safetyFactor', 'plateHeightMm', 'plateBreadthMm',
      'tackCount', 'weldLengthMm', 'weldLegMm']);
});

test('기본값은 얼어 있다 — 어느 화면에서 한 칸 고치면 다른 화면까지 바뀌면 안 된다', () => {
  assert.throws(() => { DEFAULT_WELD_SPEC.weldLegMm = 99; }, TypeError);
  assert.equal(DEFAULT_WELD_SPEC.weldLegMm, 10);
});

test('서버가 돌려준 float 사양을 같은 것으로 본다', () => {
  // 서버는 4 를 4.0 으로 돌려준다. 엄격 비교로 두면 매번 다르다고 나와
  // 재평가 요청이 무한히 돈다.
  const fromServer = {
    yieldMPa: 450.0, safetyFactor: 3.0, plateHeightMm: 500.0,
    plateBreadthMm: 500.0, tackCount: 4, weldLengthMm: 268.0, weldLegMm: 10.0,
  };
  assert.equal(weldSpecEquals(DEFAULT_WELD_SPEC, fromServer), true);
});

test('한 항목만 달라도 다른 사양이다', () => {
  assert.equal(
    weldSpecEquals(DEFAULT_WELD_SPEC, { ...DEFAULT_WELD_SPEC, weldLegMm: 12 }),
    false,
  );
});

test('한쪽이 없으면 같다고 하지 않는다 — 옛 결과는 재평가 대상이다', () => {
  assert.equal(weldSpecEquals(DEFAULT_WELD_SPEC, null), false);
  assert.equal(weldSpecEquals(null, DEFAULT_WELD_SPEC), false);
  assert.equal(weldSpecEquals(undefined, undefined), false);
});

test('사양에 없는 항목이 섞여 있어도 정의된 항목만 본다', () => {
  assert.equal(
    weldSpecEquals(DEFAULT_WELD_SPEC, { ...DEFAULT_WELD_SPEC, 무관한값: 1 }),
    true,
  );
});

test('normalizeWeldSpec은 예전 padSizeMm을 높이와 폭으로 변환한다', () => {
  assert.deepEqual(normalizeWeldSpec({
    ...DEFAULT_WELD_SPEC,
    plateHeightMm: undefined,
    plateBreadthMm: undefined,
    padSizeMm: 250,
    tackCount: 6,
  }), {
    ...DEFAULT_WELD_SPEC,
    plateHeightMm: 250,
    plateBreadthMm: 250,
    tackCount: 4,
  });
});
