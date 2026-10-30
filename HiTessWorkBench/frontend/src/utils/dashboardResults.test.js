import test from 'node:test';
import assert from 'node:assert/strict';

import { addAcknowledgedFailures, groupConsecutiveRuns, resultHighlight, unresolvedFailures } from './dashboardResults.js';

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

test('unresolvedFailures — 사용자가 확인한 실패는 뺀다', () => {
  const failures = [run(1, 'MB', 'a', 'Failed', '2026-09-29T10:00:00'), run(2, 'GMU', 'b', 'Failed', '2026-09-29T11:00:00')];
  assert.deepEqual(unresolvedFailures(failures, [], [1]).map(f => f.id), [2]);
  assert.deepEqual(unresolvedFailures(failures, []).map(f => f.id), [1, 2]);
});

test('addAcknowledgedFailures — 중복 없이 뒤에 더하고 상한을 넘으면 오래된 것부터 버린다', () => {
  assert.deepEqual(addAcknowledgedFailures([1, 2], [2, 3]), [1, 2, 3]);
  assert.deepEqual(addAcknowledgedFailures([1, 2, 3], [4], 3), [2, 3, 4]);
  assert.deepEqual(addAcknowledgedFailures(null, [5]), [5]);
});

test('실패 사유 — 진행 문구는 원인으로 쓰지 않는다', async () => {
  const { failureReason } = await import('./dashboardResults.js');
  assert.deepEqual(failureReason({ job_message: 'Nastran 해석 실행 중...' }), { text: 'Nastran 해석 실행 중...', kind: 'last' });
  assert.deepEqual(failureReason({ job_message: '진행 45%', result_info: { error: 'FATAL 9050' } }), { text: 'FATAL 9050', kind: 'reason' });
  assert.deepEqual(failureReason({ job_message: '해석 실패', result_info: { error: 'f06 없음' } }), { text: 'f06 없음', kind: 'reason' });
  assert.deepEqual(failureReason({ job_message: 'Analysis Failed', result_info: '{"diagnostic":{"message":"BDF 오류"}}' }), { text: 'BDF 오류', kind: 'reason' });
  assert.deepEqual(failureReason({ job_message: '해석 실패' }), { text: '해석 실패', kind: 'reason' });
  assert.deepEqual(failureReason({ job_message: 'Nastran 해석 중 FATAL 오류가 발생했습니다. 경계조건/하중을 확인하세요.' }).kind, 'reason');
  assert.deepEqual(failureReason({ job_message: '서버 재시작으로 작업 상태가 중단되었습니다.' }).kind, 'reason');
  // 번호가 붙은 진행 문구(Model Builder 편집 적용)도 원인이 아니다
  assert.equal(failureReason({ job_message: '편집 적용 중 (1/3)...' }).kind, 'last');
  assert.equal(failureReason({ job_message: 'F06 결과 파싱 중 (3/3)...' }).kind, 'last');
  // %가 든 진짜 원인은 그대로 사유
  assert.equal(failureReason({ job_message: '디스크 사용률 98% 로 저장 실패' }).kind, 'reason');
  assert.equal(failureReason({}), null);
});
