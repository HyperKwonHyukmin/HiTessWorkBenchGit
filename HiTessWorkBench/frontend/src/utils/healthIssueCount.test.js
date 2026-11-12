import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueCount } from './healthIssueCount.js';

test('엔진이 주는 숫자를 그대로 쓴다', () => {
  assert.equal(issueCount(403), 403);
  assert.equal(issueCount(0, 7), 0);
});

test('옛 형식(목록)은 길이', () => {
  assert.equal(issueCount([1, 2, 3]), 3);
});

test('앞 값이 없으면 다음 후보', () => {
  assert.equal(issueCount(undefined, null, 5), 5);
  assert.equal(issueCount(undefined, undefined), undefined);
});
