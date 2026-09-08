import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_BARGE_ACCEL_INPUT,
  bargeAccelerationInputKey,
  getBargeAccelerationInputIssues,
  moduleCargoAccelerationInputs,
} from './bargeAcceleration.js';


describe('bargeAcceleration', () => {
  it('keeps the workbook defaults as the initial input', () => {
    assert.deepEqual(DEFAULT_BARGE_ACCEL_INPUT, {
      significantWaveHeightM: 2,
      criticalDampingPct: 3,
      cargoPosition: 'single-center',
      cargoWeightT: 207.7,
      cargoVcgFromBottomM: 1.2,
      bargeDepthM: 4.5,
      supportHeightM: 3.4,
      loadCase: 'LC1',
    });
  });

  it('makes an old calculation stale when any input or LC changes', () => {
    const before = bargeAccelerationInputKey(DEFAULT_BARGE_ACCEL_INPUT);
    const after = bargeAccelerationInputKey({
      ...DEFAULT_BARGE_ACCEL_INPUT,
      loadCase: 'LC2',
    });
    assert.notEqual(after, before);
  });

  const SAMPLE_MODULE = {
    bounds: { min: [137102, -19586, 29262] },
    massProperties: { centerOfGravityMm: { x: 144023.4, y: -12839.4, z: 36642.8 } },
  };
  const SAMPLE_MASS = {
    deck: { massTon: 83.5507 },
    module: { massTon: 16.3811 },
    total: { massTon: 99.9318 },
    includes: { deck: true, module: true },
  };

  it('uses the sample deck + Unit total mass and Unit-bottom VCG for Excel inputs', () => {
    assert.deepEqual(moduleCargoAccelerationInputs(SAMPLE_MODULE, SAMPLE_MASS), {
      cargoWeightT: 99.9318,
      cargoVcgFromBottomM: 7.3808,
    });
  });

  it('★ 2단 정반에서는 Support Height 를 배치에서 읽어 온다', () => {
    // 정반 A 실측: 바닥 z=-125. 하단 적치면(2020)+스툴 300 이면 Unit 바닥 world z=2320.
    const low = moduleCargoAccelerationInputs(SAMPLE_MODULE, SAMPLE_MASS,
      { unitBottomZMm: 2320, deckBottomZMm: -125 });
    assert.equal(low.supportHeightM, 2.445);

    // 같은 정반이라도 상단 적치면(8026)에 앉으면 6m 넘게 달라진다.
    const high = moduleCargoAccelerationInputs(SAMPLE_MODULE, SAMPLE_MASS,
      { unitBottomZMm: 8326, deckBottomZMm: -125 });
    assert.equal(high.supportHeightM, 8.451);
  });

  it('leaves Support Height alone when the placement is not seated yet', () => {
    const noSeat = moduleCargoAccelerationInputs(SAMPLE_MODULE, SAMPLE_MASS,
      { unitBottomZMm: -Infinity, deckBottomZMm: -125 });
    assert.equal('supportHeightM' in noSeat, false);
    assert.equal(noSeat.cargoWeightT, 99.9318);
  });

  it('does not invent cargo inputs unless both deck and Unit masses are included', () => {
    const model = {
      bounds: { min: [0, 0, 0] },
      massProperties: { centerOfGravityMm: { x: 0, y: 0, z: 1000 } },
    };
    assert.equal(moduleCargoAccelerationInputs(model, {
      total: { massTon: 16.3811 },
      includes: { deck: false, module: true },
    }), null);
  });

  it('identifies the exact Excel limit that blocks the screenshot input', () => {
    const issues = getBargeAccelerationInputIssues({
      ...DEFAULT_BARGE_ACCEL_INPUT,
      cargoWeightT: 16.3811,
      cargoVcgFromBottomM: 7.3808,
    });

    assert.deepEqual(issues, [{
      field: 'cargoWeightT',
      message: '화물 총중량 16.3811 ton은 Excel 계산 범위 50~1,200 ton보다 작습니다.',
    }]);
  });

  it('accepts the workbook default input without blockers', () => {
    assert.deepEqual(getBargeAccelerationInputIssues(DEFAULT_BARGE_ACCEL_INPUT), []);
  });
});
