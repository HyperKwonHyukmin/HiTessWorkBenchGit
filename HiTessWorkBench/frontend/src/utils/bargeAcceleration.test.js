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
  // 정반 A 실측 COG z=4,584.8 / Unit 은 배치 후 world z. 합산 COG 는 정반 쪽으로 크게 쏠린다
  // (정반이 질량의 84%) — 이 쏠림이 바로 예전 기준 불일치가 놓치던 부분이다.
  const SAMPLE_MASS = {
    deck: { massTon: 83.5507, cogMm: { x: 27486, y: 35.1, z: 4584.8 } },
    module: { massTon: 16.3811, cogMm: { x: 27000, y: 0, z: 9700 } },
    total: { massTon: 99.9318, cogMm: { x: 27406.3, y: 29.4, z: 5423.6 } },
    includes: { deck: true, module: true },
  };

  it('화물 = 정반+Unit 스택 — 중량과 VCG 를 같은 기준으로 낸다', () => {
    // 화물 바닥 = 정반 최하단(z=-125). VCG = (5423.6 + 125)/1000.
    assert.deepEqual(
      moduleCargoAccelerationInputs(SAMPLE_MODULE, SAMPLE_MASS, { deckBottomZMm: -125 }),
      { cargoWeightT: 99.9318, cargoVcgFromBottomM: 5.5486, supportHeightM: 0 },
    );
  });

  it('★ 중량과 VCG 의 기준이 어긋나지 않는다 — 합산 COG 를 쓴다', () => {
    // Unit 자체 VCG(Unit 바닥 기준 7.38 m)를 쓰면 정반 질량 84% 를 무시한 값이 된다.
    // 스택 기준은 그보다 낮아야 한다 — 합산 무게중심이 정반 쪽에 있기 때문이다.
    const out = moduleCargoAccelerationInputs(
      SAMPLE_MODULE, SAMPLE_MASS, { deckBottomZMm: -125 });
    const unitOwnVcgM = (SAMPLE_MODULE.massProperties.centerOfGravityMm.z
      - SAMPLE_MODULE.bounds.min[2]) / 1000;
    assert.ok(out.cargoVcgFromBottomM < unitOwnVcgM,
      '스택 기준 VCG 는 Unit 자체 VCG 보다 낮아야 한다');
    // Support Height 는 0 이다 — 정반이 곧 화물이라 그 아래 받침이 따로 없다.
    assert.equal(out.supportHeightM, 0);
  });

  it('배치가 없으면 VCG 기준을 세울 수 없으므로 중량만 가져온다', () => {
    const noSeat = moduleCargoAccelerationInputs(SAMPLE_MODULE, SAMPLE_MASS);
    assert.deepEqual(noSeat, { cargoWeightT: 99.9318 });
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
