import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findJobForMenu,
  isTerminalJobStatus,
  pruneExpiredJobs,
  removeJobsForMenu,
  upsertGlobalJob,
} from './globalJobs.js';

const job = (jobId, menu, extra = {}) => ({ jobId, menu, status: 'Running', ...extra });

// ── isTerminalJobStatus ────────────────────────────────────────────────
test('isTerminalJobStatus 는 종료 상태 3종만 true 로 본다', () => {
  assert.equal(isTerminalJobStatus('Success'), true);
  assert.equal(isTerminalJobStatus('Failed'), true);
  assert.equal(isTerminalJobStatus('Interrupted'), true);
  assert.equal(isTerminalJobStatus('Running'), false);
  assert.equal(isTerminalJobStatus('Pending'), false);
  assert.equal(isTerminalJobStatus(undefined), false);
});

// ── upsertGlobalJob — App 당 1개 규칙 ──────────────────────────────────
test('upsertGlobalJob 은 같은 App 의 이전 해석을 새 해석으로 교체한다', () => {
  const prev = [job('old', 'HiTESS Model Builder')];
  const next = upsertGlobalJob(prev, job('new', 'HiTESS Model Builder'));

  assert.equal(next.length, 1);
  assert.equal(next[0].jobId, 'new');
});

test('upsertGlobalJob 은 다른 App 의 해석은 그대로 둔다', () => {
  const prev = [job('gmu-1', 'Group & Module Unit 권상 구조 해석')];
  const next = upsertGlobalJob(prev, job('mb-1', 'HiTESS Model Builder'));

  assert.deepEqual(next.map((j) => j.jobId), ['mb-1', 'gmu-1']);
});

test('upsertGlobalJob 은 새 해석을 목록 맨 앞에 놓는다', () => {
  const prev = [job('a', 'App A'), job('b', 'App B')];
  const next = upsertGlobalJob(prev, job('c', 'App C'));

  assert.equal(next[0].jobId, 'c');
});

test('upsertGlobalJob 은 같은 jobId 를 중복해 쌓지 않는다', () => {
  const prev = [job('same', 'App A')];
  const next = upsertGlobalJob(prev, job('same', 'App A', { progress: 50 }));

  assert.equal(next.length, 1);
  assert.equal(next[0].progress, 50);
});

test('upsertGlobalJob 은 보관 한도를 넘으면 가장 오래된 것을 버린다', () => {
  const prev = [job('a', 'App A'), job('b', 'App B'), job('c', 'App C')];
  const next = upsertGlobalJob(prev, job('d', 'App D'), 3);

  assert.deepEqual(next.map((j) => j.jobId), ['d', 'a', 'b']);
});

// ── findJobForMenu — 다중 App 회귀 테스트 ─────────────────────────────
test('findJobForMenu 는 다른 App 해석이 더 최근이어도 자기 App 의 해석을 찾는다', () => {
  // Model Builder 실행 중 Module Unit 을 돌리면 GMU 가 맨 앞에 온다.
  // 이때 Model Builder 페이지가 자기 job 을 못 찾던 것이 복원 실패의 원인이었다.
  const jobs = [
    job('gmu-1', 'Group & Module Unit 권상 구조 해석'),
    job('mb-1', 'HiTESS Model Builder'),
  ];

  assert.equal(findJobForMenu(jobs, 'HiTESS Model Builder')?.jobId, 'mb-1');
});

test('findJobForMenu 는 해당 App 의 해석이 없으면 null 을 준다', () => {
  assert.equal(findJobForMenu([job('a', 'App A')], 'App B'), null);
});

test('findJobForMenu 는 목록이 비었거나 메뉴명이 없으면 null 을 준다', () => {
  assert.equal(findJobForMenu([], 'App A'), null);
  assert.equal(findJobForMenu([job('a', 'App A')], ''), null);
  assert.equal(findJobForMenu(undefined, 'App A'), null);
});

// ── removeJobsForMenu — 페이지 초기화 ─────────────────────────────────
test('removeJobsForMenu 는 해당 App 의 해석만 지운다', () => {
  const jobs = [job('mb-1', 'HiTESS Model Builder'), job('gmu-1', 'App B')];

  assert.deepEqual(removeJobsForMenu(jobs, 'HiTESS Model Builder').map((j) => j.jobId), ['gmu-1']);
});

test('removeJobsForMenu 는 메뉴명이 없으면 목록을 그대로 둔다', () => {
  // 페이지 초기화가 실수로 Job Center 전체를 비우면 안 된다.
  const jobs = [job('a', 'App A'), job('b', 'App B')];

  assert.equal(removeJobsForMenu(jobs, ''), jobs);
  assert.equal(removeJobsForMenu(jobs, undefined), jobs);
});

test('removeJobsForMenu 는 지울 것이 없으면 같은 배열을 그대로 돌려준다', () => {
  const jobs = [job('a', 'App A')];

  assert.equal(removeJobsForMenu(jobs, 'App B'), jobs);
});

// ── pruneExpiredJobs — 30분 만료 ──────────────────────────────────────
test('pruneExpiredJobs 는 만료 시각이 지난 해석을 지운다', () => {
  const now = 1_000_000;
  const jobs = [job('gone', 'App A', { expiresAt: now - 1 })];

  assert.deepEqual(pruneExpiredJobs(jobs, now), []);
});

test('pruneExpiredJobs 는 실행 중(만료 시각 없음)인 해석을 지우지 않는다', () => {
  const now = 1_000_000;
  const jobs = [job('running', 'App A', { expiresAt: null })];

  assert.deepEqual(pruneExpiredJobs(jobs, now).map((j) => j.jobId), ['running']);
});

test('pruneExpiredJobs 는 지울 것이 없으면 같은 배열을 그대로 돌려준다', () => {
  // 참조가 바뀌면 불필요한 리렌더가 발생하므로 동일 참조 유지가 중요하다.
  const jobs = [job('a', 'App A', { expiresAt: 2_000_000 })];

  assert.equal(pruneExpiredJobs(jobs, 1_000_000), jobs);
});
