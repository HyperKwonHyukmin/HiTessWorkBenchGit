import test from 'node:test';
import assert from 'node:assert/strict';

import { groupConsecutiveRuns, resultHighlight, unresolvedFailures } from './dashboardResults.js';

const run = (id, program, input, status = 'Success', created = `2026-09-30T0${id}:00:00`) => ({
  id, program_name: program, input, status, created_at: created,
});
const keyOf = r => r.input;
const ok = info => ({ status: 'Success', result_info: info });

test('같은 앱·같은 입력의 연속 실행을 한 묶음으로', () => {
  const groups = groupConsecutiveRuns([
    run(1, 'MB', 'a.csv'), run(2, 'MB', 'a.csv'), run(3, 'MB', 'a.csv'), run(4, 'GMU', 'm.bdf'),
  ], keyOf);
  assert.deepEqual(groups.map(g => g.runs.length), [3, 1]);
  assert.equal(groups[0].head.id, 1);
});

test('사이에 다른 작업이 끼면 묶지 않는다', () => {
  const groups = groupConsecutiveRuns([run(1, 'MB', 'a.csv'), run(2, 'GMU', 'm.bdf'), run(3, 'MB', 'a.csv')], keyOf);
  assert.equal(groups.length, 3);
});

test('입력이 다르거나 없으면 묶지 않는다', () => {
  assert.equal(groupConsecutiveRuns([run(1, 'MB', 'a.csv'), run(2, 'MB', 'b.csv')], keyOf).length, 2);
  assert.equal(groupConsecutiveRuns([run(1, 'MB', null), run(2, 'MB', null)], keyOf).length, 2);
});

test('실패는 묶지 않는다', () => {
  const groups = groupConsecutiveRuns([
    run(1, 'MB', 'a.csv', 'Failed'), run(2, 'MB', 'a.csv', 'Failed'), run(3, 'MB', 'a.csv'), run(4, 'MB', 'a.csv'),
  ], keyOf);
  assert.deepEqual(groups.map(g => g.runs.length), [1, 1, 2]);
});

test('resultHighlight — Mooring 판정과 최대 활용도', () => {
  assert.deepEqual(resultHighlight(ok({ summary: { ok: false, globalMaxUsage: 4.8523 } })), { tone: 'ng', label: 'NG · 최대 활용도 4.85' });
  assert.equal(resultHighlight(ok(JSON.stringify({ summary: { ok: true, globalMaxUsage: 0.71 } }))).tone, 'ok');
});

test('resultHighlight — 권상 검증 단계, 2단계가 있으면 2단계 우선', () => {
  assert.equal(resultHighlight(ok({ step1_status: 'error' })).label, '검증 오류');
  assert.equal(resultHighlight(ok({ step1_status: 'warning', step2_status: 'pass' })).tone, 'ok');
});

test('resultHighlight — 산출 값', () => {
  assert.equal(resultHighlight(ok({ maxWorkingLoadTon: 61.3 })).label, '허용 하중 61.3 t');
  assert.equal(resultHighlight(ok({ optimal: { weight_kg: 5.03808 } })).label, '최적안 5 kg');
});

test('resultHighlight — 판정 값이 없거나 성공이 아니면 null', () => {
  assert.equal(resultHighlight(ok({ bdf_path: 'x.bdf' })), null);
  assert.equal(resultHighlight({ status: 'Failed', result_info: { step1_status: 'pass' } }), null);
  assert.equal(resultHighlight(ok('not json')), null);
});

test('unresolvedFailures — 그 뒤로 같은 앱이 성공한 실패는 뺀다', () => {
  const failures = [run(1, 'MB', 'a', 'Failed', '2026-09-29T10:00:00'), run(2, 'GMU', 'b', 'Failed', '2026-09-29T11:00:00')];
  const history = [run(3, 'MB', 'a', 'Success', '2026-09-30T10:00:00')];
  assert.deepEqual(unresolvedFailures(failures, history).map(f => f.id), [2]);
});
