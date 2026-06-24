import test from 'node:test';
import assert from 'node:assert/strict';

import { getRuleAxisMaxima } from './hullAcceleration.js';

test('returns each axis maximum with its own loading condition', () => {
  const rule = {
    x: {
      max: 8,
      max_lc: 2,
      per_condition: [
        { condition_no: 1, value: 4 },
        { condition_no: 2, value: 8 },
      ],
    },
    y: {
      max: 12,
      max_lc: 1,
      per_condition: [
        { condition_no: 1, value: 12 },
        { condition_no: 2, value: 3 },
      ],
    },
    z: {
      max: 6,
      max_lc: 2,
      per_condition: [
        { condition_no: 1, value: 5 },
        { condition_no: 2, value: 6 },
      ],
    },
  };

  assert.deepEqual(getRuleAxisMaxima(rule), {
    x: { value: 8, conditionNo: 2 },
    y: { value: 12, conditionNo: 1 },
    z: { value: 6, conditionNo: 2 },
  });
});
