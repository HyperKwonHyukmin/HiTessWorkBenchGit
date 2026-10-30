import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bracketLabel, fieldError, weldError, governingCaseBySection, rowMaxUsage, sanitizeDraftInputs, toPayload,
} from './dTypeLug.js';

const DEFAULTS = {
  load: { force_N: '1000000' },
  geometry: { l1: '850', w1: '6', w2: '8' },
  material: { yield_base_MPa: '235', yield_weld_MPa: '291.76' },
};

test("W1'·W2' 는 항상 0 으로 보낸다", () => {
  const p = toPayload(DEFAULTS);
  assert.equal(p.geometry.w1_prime, 0);
  assert.equal(p.geometry.w2_prime, 0);
  assert.equal(p.geometry.l1, 850);
  assert.equal(p.load.force_N, 1000000);
});

test("예전 Draft 의 W1'=12 는 걷어 낸다", () => {
  const draft = { ...DEFAULTS, geometry: { l1: '900', w1_prime: '12', w2_prime: '3' } };
  const g = sanitizeDraftInputs(draft, DEFAULTS).geometry;
  assert.equal(g.l1, '900');
  assert.equal(g.w1, '6');
  assert.ok(!('w1_prime' in g));
  assert.equal(toPayload({ ...DEFAULTS, geometry: g }).geometry.w1_prime, 0);
});

test('입력 검사', () => {
  assert.equal(fieldError(''), '값을 입력하세요');
  assert.equal(fieldError('abc'), '숫자를 입력하세요');
  assert.equal(fieldError('-1'), '0 이상이어야 합니다');
  assert.equal(fieldError('0'), null);
  assert.equal(fieldError('0', { positive: true }), '0보다 커야 합니다');
});

test('단면별 지배 케이스', () => {
  const rows = [
    { index: 0, usage_factor: { A: 0.2, E: 0.5 } },
    { index: 5, usage_factor: { A: 0.4, E: 0.3 } },
  ];
  const g = governingCaseBySection(rows);
  assert.deepEqual(g.A, { value: 0.4, index: 5 });
  assert.deepEqual(g.E, { value: 0.5, index: 0 });
  assert.equal(g.B, null);
  assert.equal(rowMaxUsage(rows[0]), 0.5);
});

test('형식 이름', () => {
  assert.equal(bracketLabel('bracket_2EA_double'), 'Bracket 2EA (Opposite side)');
  assert.equal(bracketLabel('bracket_2EA_single'), 'Bracket 2EA (Same side)');
});

test('W1·W2 가 둘 다 0 이면 막는다', () => {
  assert.equal(weldError({ w1: '0', w2: '0' }), 'W1·W2 중 하나는 0보다 커야 합니다');
  assert.equal(weldError({ w1: '0', w2: '8' }), null);
  assert.equal(weldError({ w1: '', w2: '0' }), null);
});
