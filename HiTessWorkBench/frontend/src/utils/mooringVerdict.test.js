import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMooringVerdict, summarizeMooringRawAudit, extractEngineAlerts } from './mooringVerdict.js';

const okRaw = {
  meta: {
    counts: { mf: 2, plate: 3, loadCase: 2 },
    integrity: { structureTotalLines: 6, structureAccountedFor: 6, loadTotalLines: 3, loadAccountedFor: 3 },
  },
  structure: { mf: [{ id: 'MF1', lineNumber: 2 }, { id: 'MF2', lineNumber: 3 }] },
  winch: { loadCases: [{ loadId: 'LC1', lineNumber: 2 }] },
  skips: [
    { kind: 'Structure', rowType: 'Comment', lineNumber: 1 },
    { kind: 'Winch', rowType: 'EMPTY_LOADCASE', lineNumber: 4 },
  ],
};
const okValidation = { summary: { overall: 'PASSED', passed: 5, warning: 0, error: 0 } };
const success = { jobState: 'success', result: { out_dir: 'C:/x/out' }, rawJson: okRaw, validationJson: okValidation };

test('실행 전·실행 중·결과 읽는 중에는 판정이 없다', () => {
  assert.equal(computeMooringVerdict({}).level, null);
  assert.equal(computeMooringVerdict({ jobState: 'running' }).level, null);
  assert.equal(computeMooringVerdict({ jobState: 'success', result: {}, artifactsLoading: true }).level, null);
});

test('작업 실패·out 폴더 없음은 실패', () => {
  const v = computeMooringVerdict({ jobState: 'failed', jobMessage: '시간 초과' });
  assert.equal(v.level, 'fail');
  assert.equal(v.reasons[0].text, '시간 초과');
  assert.equal(computeMooringVerdict({ jobState: 'success', result: { _artifacts_missing: true } }).level, 'fail');
});

test('경고 없는 결과는 통과 — 빈 LOADCASE·주석 행은 판정에 쓰지 않는다', () => {
  const v = computeMooringVerdict(success);
  assert.equal(v.level, 'pass');
  assert.equal(v.basis, 'build');
});

test('최종 검증 오류는 실패, 경고는 검토 필요', () => {
  assert.equal(computeMooringVerdict({ ...success, validationJson: { summary: { overall: 'FAILED', error: 2 } } }).level, 'fail');
  assert.equal(computeMooringVerdict({ ...success, validationJson: { summary: { overall: 'PASSED', warning: 1 } } }).level, 'review');
});

test('CSV 파싱 실패 행은 검토 필요이고 같은 사실의 INPUT_ROW_DROPPED 진단은 겹쳐 쓰지 않는다', () => {
  const raw = { ...okRaw, skips: [...okRaw.skips, { kind: 'Structure', rowType: 'MF', reason: 'bad number', lineNumber: 5 }] };
  const diagnosis = { findings: [{ code: 'INPUT_ROW_DROPPED', confidence: '확정', message: '입력 CSV 1행이 반영되지 않았습니다.' }] };
  const v = computeMooringVerdict({ ...success, rawJson: raw, diagnosis });
  assert.equal(v.level, 'review');
  assert.deepEqual(v.reasons.map(r => r.code), ['csv-parse-failed']);
});

test('하중 없음 진단(확정)은 실패, 참고 진단은 판정 미반영', () => {
  const fail = computeMooringVerdict({ ...success, diagnosis: { findings: [{ code: 'LOAD_NONE', confidence: '확정', message: 'MF 하중 입력이 0건' }] } });
  assert.equal(fail.level, 'fail');
  const ref = computeMooringVerdict({ ...success, diagnosis: { findings: [{ code: 'LOAD_NONE', confidence: '참고', message: 'Winch 0건' }] } });
  assert.equal(ref.level, 'pass');
  const likely = computeMooringVerdict({ ...success, diagnosis: { findings: [{ code: 'MODEL_UNTRACED', confidence: '유력', message: '출신 추적 실패' }] } });
  assert.equal(likely.level, 'review');
});

test('검증 JSON 을 읽지 못하면 근거 없음으로 검토 필요', () => {
  const v = computeMooringVerdict({ jobState: 'success', result: { out_dir: 'x' }, artifactsError: 'HTTP 404' });
  assert.equal(v.level, 'review');
  assert.match(v.reasons[0].text, /HTTP 404/);
});

test('사유는 3줄 안쪽으로 줄인다', () => {
  const findings = ['A', 'B', 'C', 'D'].map(c => ({ code: c, confidence: '유력', message: c }));
  const v = computeMooringVerdict({ ...success, diagnosis: { findings } });
  assert.equal(v.reasons.length, 3);
  assert.equal(v.reasons[2].code, 'more');
});

test('구조해석 요약이 있으면 그것이 판정 — 대시보드 OK/NG 와 같은 기준', () => {
  assert.equal(computeMooringVerdict({ solveSummary: { ok: true, globalMaxUsage: 0.8 } }).level, 'pass');
  const ng = computeMooringVerdict({ solveSummary: { ok: false, globalMaxUsage: 1.3 } });
  assert.equal(ng.level, 'fail');
  assert.equal(ng.basis, 'solve');
  assert.equal(computeMooringVerdict({ solveSummary: { ok: false, verdictCounts: { NOT_OK: 0, MATERIAL_CHANGE: 3 } } }).level, 'review');
});

test('CSV 감사 요약 — 변환·제외·경고·실패 수', () => {
  const a = summarizeMooringRawAudit(okRaw);
  assert.equal(a.summary.convertedRows, 7);
  assert.equal(a.summary.ignoredRows, 1);
  assert.equal(a.summary.warningRows, 1);
  assert.equal(a.summary.parseFailedRows, 0);
  assert.equal(a.summary.hasAccountingMismatch, false);
  assert.equal(summarizeMooringRawAudit(null), null);
});

test('엔진 경고 줄만 골라낸다', () => {
  const log = 'start\r\n   [Warning] 절점 없음\nok\n[부재 제거] E12\n';
  assert.deepEqual(extractEngineAlerts(log), ['[Warning] 절점 없음', '[부재 제거] E12']);
  assert.deepEqual(extractEngineAlerts(null), []);
});
