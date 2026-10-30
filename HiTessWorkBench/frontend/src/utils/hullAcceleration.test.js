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

import {
  EMPTY_MANUAL_DIMENSIONS,
  buildManualDimensionsPayload,
  isManualDimensionsComplete,
  prefillManualDimensions,
} from './hullAcceleration.js';

test('manual dimensions payload keeps only positive numbers', () => {
  assert.equal(buildManualDimensionsPayload(EMPTY_MANUAL_DIMENSIONS), null);
  assert.deepEqual(
    buildManualDimensionsPayload({ length: '235.45', breadth: '0', depth: 'abc', scantling_draft: '12.4' }),
    { length: 235.45, scantling_draft: 12.4 },
  );
});

test('prefill keeps user input and fills blanks from PDF values only', () => {
  const next = prefillManualDimensions(
    { ...EMPTY_MANUAL_DIMENSIONS, depth: '24' },
    { lbp: 235.45, breadth: 32.25, depth: 23.85 },
  );
  assert.deepEqual(next, { length: '235.45', breadth: '32.25', depth: '24', scantling_draft: '' });
  assert.equal(isManualDimensionsComplete(next), false);
  assert.equal(isManualDimensionsComplete({ ...next, scantling_draft: '12.4' }), true);
});
