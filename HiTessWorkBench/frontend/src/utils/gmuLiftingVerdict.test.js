import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStructuralResult, computeGmuVerdict } from './gmuLiftingVerdict.js';

const okValidation = { status: 'pass', summary: { totalErrors: 0, totalWarnings: 3 }, parsingSummary: { disconnectedGroupCount: 0 } };

test('검증 전에는 판정이 없다', () => {
  assert.equal(computeGmuVerdict({}).level, null);
});

test('오류 0 이면 경고가 있어도 입력 검증 통과', () => {
  const v = computeGmuVerdict({ step1Data: okValidation });
  assert.equal(v.level, 'pass');
  assert.equal(v.basis, 'validation');
});

test('BDF 오류·Nastran FATAL·작업 실패는 실패', () => {
  assert.equal(computeGmuVerdict({ step1Data: { ...okValidation, summary: { totalErrors: 2 } } }).level, 'fail');
  assert.equal(computeGmuVerdict({ step1Data: okValidation, step2Data: { summary: { f06Fatals: 1 } } }).level, 'fail');
  assert.equal(computeGmuVerdict({ jobFailed: true }).level, 'fail');
});

test('분리 그룹은 검토 필요', () => {
  const v = computeGmuVerdict({ step1Data: { ...okValidation, parsingSummary: { disconnectedGroupCount: 2 } } });
  assert.equal(v.level, 'review');
  assert.match(v.reasons[0].text, /2개/);
});

test('구조 해석 결과가 있으면 그 판정이 우선한다', () => {
  const pass = buildStructuralResult({ summary: { memberMaxStressMPa: 120 }, allowableMPa: 220 });
  assert.equal(pass.status, 'PASS');
  assert.equal(computeGmuVerdict({ step1Data: { ...okValidation, parsingSummary: { disconnectedGroupCount: 1 } }, structural: pass }).level, 'pass');

  const warn = buildStructuralResult({ summary: {}, warnings: ['a', 'b', 'c', 'd'] });
  const vw = computeGmuVerdict({ structural: warn });
  assert.equal(vw.level, 'review');
  assert.equal(vw.reasons.length, 4);

  const fail = buildStructuralResult({ summary: { memberExceedCount: 3, wireCompressionCount: 1 } });
  assert.equal(fail.status, 'FAIL');
  const vf = computeGmuVerdict({ structural: fail });
  assert.equal(vf.level, 'fail');
  assert.equal(vf.reasons.length, 2);

  assert.equal(computeGmuVerdict({ structural: { status: 'ERROR', error: 'x' } }).level, 'fail');
});
