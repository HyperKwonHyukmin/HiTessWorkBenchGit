import test from 'node:test';
import assert from 'node:assert/strict';

import { formatSeconds } from './accessHistory.js';

test('초를 시간·분으로 읽기 쉽게 바꾼다', () => {
  assert.equal(formatSeconds(0), '0초');
  assert.equal(formatSeconds(45), '45초');
  assert.equal(formatSeconds(125), '2분');
  assert.equal(formatSeconds(3600), '1시간');
  assert.equal(formatSeconds(3600 * 3 + 12 * 60 + 5), '3시간 12분');
  assert.equal(formatSeconds(null), '0초');
});
