import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeSendOutcome, initialPlanChecks, isBulkLiftingProgram, summarizePlan,
} from './bulkLogbookSend.js';

const items = [
  { id: 1, ok: true, totalBytes: 100, hasResult: true },
  { id: 2, ok: true, totalBytes: 50, hasResult: false },
  { id: 3, ok: true, totalBytes: 70, hasResult: true, olderRunOf: 1 },
  { id: 4, ok: false, reason: '파일 보관 기간이 지났습니다' },
];

test('권상 App 만 여러 건 보내기', () => {
  assert.equal(isBulkLiftingProgram('GroupModuleUnit'), true);
  assert.equal(isBulkLiftingProgram('SidePassage'), true);
  assert.equal(isBulkLiftingProgram('TrussAssessment'), false);
});

test('처음 체크 — 보낼 수 있고 옛 실행이 아닌 것만', () => {
  assert.deepEqual([...initialPlanChecks(items)].sort(), [1, 2]);
});

test('요약 — 체크한 것만 센다', () => {
  assert.deepEqual(summarizePlan(items, new Set([1, 2, 4])), { count: 2, bytes: 150, withResult: 1, blocked: 1 });
});

test('보내기 결과 한 줄', () => {
  assert.deepEqual(describeSendOutcome({ data: { state: 'staged', file_count: 7, rejected: [{}] } }),
    { state: 'sent', text: '7개 파일 보냄 · DRM 파일 1개 제외' });
  assert.equal(describeSendOutcome({ data: { state: 'blocked' } }).state, 'duplicate');
  assert.deepEqual(describeSendOutcome({ error: { response: { data: { detail: 'LogBook 연동이 꺼져 있습니다' } } } }),
    { state: 'failed', text: 'LogBook 연동이 꺼져 있습니다' });
});
