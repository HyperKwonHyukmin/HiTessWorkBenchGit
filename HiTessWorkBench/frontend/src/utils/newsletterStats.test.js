import test from 'node:test';
import assert from 'node:assert/strict';
import { pct, fmtDuration, fmtDelta } from './newsletterStats.js';

test('pct — 0 으로 나누지 않는다', () => {
  assert.equal(pct(1, 4), 25);
  assert.equal(pct(3, 0), 0);
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(42), '42초');
  assert.equal(fmtDuration(65), '1분 05초');
});

test('fmtDelta — 전이 0 이면 % 없음', () => {
  assert.equal(fmtDelta(10, 14), '+4 (+40%)');
  assert.equal(fmtDelta(5, 2), '−3 (−60%)');
  assert.equal(fmtDelta(0, 3), '+3');
  assert.equal(fmtDelta(2, 2), '변화 없음');
});
