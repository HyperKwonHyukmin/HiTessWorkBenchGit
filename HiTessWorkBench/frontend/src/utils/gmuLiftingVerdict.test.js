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

test('BDF 구간 경계 오류는 무엇이 문제인지와 자동 수정 가능 여부를 실패 사유 맨 앞에 말한다', () => {
  const v = computeGmuVerdict({ step1Data: {
    status: 'error', summary: { totalErrors: 1 },
    deckIssues: [
      { code: 'case_control_in_bulk', severity: 'error', title: 'Bulk 구간에 해석 설정 줄', fixable: true },
      { code: 'missing_begin_bulk', severity: 'warning', title: 'BEGIN BULK 줄 없음', fixable: true },
    ],
  } });
  assert.equal(v.level, 'fail');
  assert.equal(v.reasons[0].text, 'Bulk 구간에 해석 설정 줄 — 자동 수정할 수 있습니다');
  assert.equal(v.reasons.filter(r => r.code.startsWith('deck-')).length, 1); // 경고는 실패 사유가 아니다
});

test('경고 등급 BDF 형식 문제(BEGIN BULK 누락)는 통과가 아니라 검토 필요', () => {
  const v = computeGmuVerdict({ step1Data: {
    status: 'warning', summary: { totalErrors: 0, totalWarnings: 1 }, parsingSummary: { disconnectedGroupCount: 2 },
    deckIssues: [{ code: 'missing_begin_bulk', severity: 'warning', title: 'BEGIN BULK 줄 없음', fixable: true }],
  } });
  assert.equal(v.level, 'review');
  assert.deepEqual(v.reasons.map(r => r.code), ['deck-missing_begin_bulk', 'disconnected']);
});
