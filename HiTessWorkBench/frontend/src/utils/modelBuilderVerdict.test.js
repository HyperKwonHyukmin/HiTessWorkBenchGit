import test from 'node:test';
import assert from 'node:assert/strict';

import { computeModelBuilderVerdict, massBearingExclusions } from './modelBuilderVerdict.js';

const stage = (health = {}, diagnostics = {}) => ({
  stageIndex: 6, stageName: 'Validation',
  health: { freeEndCount: 178, disconnectedGroupCount: 0, unresolvedUboltCount: 0, ...health },
  diagnostics: { error: 0, warning: 721, info: 5, ...diagnostics },
});
const summaryOf = (final, totalErrors = 0) => ({ summary: { totalErrors }, stages: [final] });
const row = (kind, status, reasonCode, mass) => ({
  kind, status, reasonCode, rawFields: mass === undefined ? {} : { mass },
});

test('실측 모델(질량 0 장비 제외·자유단·경고 다수)은 통과', () => {
  const audit = { rowAudit: [
    row('Equipment', 'ignored', 'zero_mass_equipment', '0'),
    row('Pipe', 'ignored', 'zero_mass_attachment'),
    row('Structure', 'ignored', 'zero_length_structure'),
    row('Pipe', 'converted', 'csv_row_accepted'),
  ] };
  const v = computeModelBuilderVerdict({ jobStatus: 'Success', summary: summaryOf(stage()), audit });
  assert.equal(v.level, 'pass');
  assert.deepEqual(v.reasons, []);
});

test('질량이 있는 행이 빠지면 검토 필요 — 종류별 건수를 알려준다', () => {
  const audit = { rowAudit: [
    row('Equipment', 'ignored', 'zero_mass_equipment', '1.25'),   // 코드와 달리 질량이 있으면 센다
    row('Pipe', 'error', 'pipe_outdia_zero'),
    row('Pipe', 'parseFailed', 'parse_failed'),
    row('Equipment', 'ignored', 'zero_mass_equipment', '0'),
  ] };
  assert.equal(massBearingExclusions(audit).length, 3);
  const v = computeModelBuilderVerdict({ jobStatus: 'Success', summary: summaryOf(stage()), audit });
  assert.equal(v.level, 'review');
  assert.equal(v.reasons[0].code, 'mass-excluded');
  assert.match(v.reasons[0].text, /장비 1건 · 배관 2건/);
});

test('분리 그룹·미해결 U-bolt 는 검토 필요', () => {
  const v = computeModelBuilderVerdict({
    jobStatus: 'Success',
    summary: summaryOf(stage({ disconnectedGroupCount: 2, unresolvedUboltCount: 1 })),
  });
  assert.equal(v.level, 'review');
  assert.deepEqual(v.reasons.map(r => r.code), ['disconnected-groups', 'unresolved-ubolt']);
});

test('편집 모델이 있으면 연결성은 편집 모델 기준', () => {
  const summary = summaryOf(stage({ disconnectedGroupCount: 3 }));
  const editedStage = { health: { disconnectedGroupCount: 0, unresolvedUboltCount: 0 }, diagnostics: { error: 0 } };
  const v = computeModelBuilderVerdict({ jobStatus: 'Success', summary, editedStage });
  assert.equal(v.level, 'pass');
  assert.equal(v.basis, 'edited');
});

test('진단 에러는 실패', () => {
  const v = computeModelBuilderVerdict({ jobStatus: 'Success', summary: summaryOf(stage({}, { error: 4 }), 4) });
  assert.equal(v.level, 'fail');
  assert.match(v.reasons[0].text, /4건/);
});

test('실행 실패·중단은 실패, 자료가 없으면 판정 보류', () => {
  assert.equal(computeModelBuilderVerdict({ jobStatus: 'Failed' }).level, 'fail');
  assert.equal(computeModelBuilderVerdict({ jobStatus: 'Cancelled' }).title, '실행 중단');
  assert.equal(computeModelBuilderVerdict({ jobStatus: 'Success' }).level, null);
  assert.equal(computeModelBuilderVerdict().level, null);
});
