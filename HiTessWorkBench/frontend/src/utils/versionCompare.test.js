import test from 'node:test';
import assert from 'node:assert/strict';

import { compareVersions, isServerVersionNewer } from './versionCompare.js';

test('서버가 더 높을 때만 업데이트를 안내한다', () => {
  assert.equal(isServerVersionNewer('1.5.15', '1.5.14'), true);
  assert.equal(isServerVersionNewer('1.6.0', '1.5.99'), true);
  assert.equal(isServerVersionNewer('2.0.0', '1.9.9'), true);
});

test('클라이언트가 같거나 더 새로우면 막지 않는다 (exe 먼저 배포한 경우)', () => {
  assert.equal(isServerVersionNewer('1.5.14', '1.5.15'), false);
  assert.equal(isServerVersionNewer('1.5.15', '1.5.15'), false);
  assert.equal(isServerVersionNewer('', '1.5.15'), false);
  assert.equal(isServerVersionNewer(null, '1.5.15'), false);
});

test('숫자 비교 — 문자열 사전순이 아니다', () => {
  assert.ok(compareVersions('1.5.10', '1.5.9') > 0);
  assert.equal(compareVersions('v1.5.15', '1.5.15'), 0);
});

test('해석할 수 없는 형식은 예전처럼 다르면 안내한다', () => {
  assert.equal(compareVersions('dev', '1.5.15'), null);
  assert.equal(isServerVersionNewer('dev', '1.5.15'), true);
  assert.equal(isServerVersionNewer('dev', 'dev'), false);
});
