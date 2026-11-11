import test from 'node:test';
import assert from 'node:assert/strict';

import { diffLugshellEdits, initialLugshellForm, validateLugshellForm } from './lugshellEdits.js';

const summary = {
  swl_t: 25, hole_d: 61, pin_d: 60,
  cases: [
    { id: 'LC1_axial', swl_t: 25, daf: 1, alpha_deg: 0, beta_deg: 0 },
    { id: 'LC2_inplane_30', swl_t: 25, daf: 1, alpha_deg: 30, beta_deg: 0 },
  ],
};

test('초깃값은 요약의 지금 값 (문자열 칸)', () => {
  const f = initialLugshellForm(summary);
  assert.deepEqual(f, {
    swl_t: '25', daf: '1', pin_d: '60',
    cases: [{ id: 'LC1_axial', alpha_deg: '0', beta_deg: '0' }, { id: 'LC2_inplane_30', alpha_deg: '30', beta_deg: '0' }],
  });
});

test('옛 서버 요약(cases·pin_d 없음)이면 SWL 만 채우고 케이스는 빈 목록', () => {
  const f = initialLugshellForm({ swl_t: 25 });
  assert.equal(f.swl_t, '25');
  assert.equal(f.daf, '');
  assert.deepEqual(f.cases, []);
});

test('바뀐 값만 보낸다, 같은 값(1 과 1.0)은 고친 것이 아니다', () => {
  const f = initialLugshellForm(summary);
  assert.equal(diffLugshellEdits(summary, { ...f, daf: '1.0' }), null);
  f.daf = '1.3';
  f.cases[1].alpha_deg = '45';
  assert.deepEqual(diffLugshellEdits(summary, f), { daf: 1.3, cases: [{ id: 'LC2_inplane_30', alpha_deg: 45 }] });
});

test('범위 밖·빈칸·핀 지름 ≥ 구멍은 칸별 오류', () => {
  const f = initialLugshellForm(summary);
  assert.deepEqual(validateLugshellForm(f, 61), {});
  f.daf = '0.9';
  f.swl_t = '';
  f.pin_d = '61';
  f.cases[0].beta_deg = '100';
  const e = validateLugshellForm(f, 61);
  assert.deepEqual(Object.keys(e).sort(), ['LC1_axial.beta_deg', 'daf', 'pin_d', 'swl_t']);
});

test('하중 화살표 = 엔진 lugshell/loads.py 와 같은 방향·크기', async () => {
  const { lugshellLoadArrows } = await import('./lugshellEdits.js');
  const s = { ...summary, pin_center: [0, 0, 80], g: 9.81 };
  const arr = lugshellLoadArrows(s);
  assert.equal(arr.length, 2);
  assert.deepEqual(arr[0].dir.map((v) => +v.toFixed(6)), [0, 0, 1]);
  const d2 = arr[1].dir;
  assert.ok(Math.abs(d2[0] - 0.5) < 1e-9 && Math.abs(d2[2] - Math.cos(Math.PI / 6)) < 1e-9);
  assert.equal(Math.round(arr[0].magN), 245250); // 25 t × 9.81 = 245,250 N (해석 반력 합과 같음)
  assert.match(arr[1].label, /^LC2 · 245 kN · 면내 30°$/);
  assert.equal(arr[0].tag, 'LC1');
  assert.equal(arr[1].tag, 'LC2 면내 30°');
  assert.equal(arr[0].edited, false);
});

test('입력 중인 값으로 화살표가 바뀌고, 숫자가 아닌 칸의 케이스는 뺀다', async () => {
  const { lugshellLoadArrows } = await import('./lugshellEdits.js');
  const s = { ...summary, pin_center: [0, 0, 80] };
  const f = initialLugshellForm(s);
  f.daf = '2';
  f.cases[0].beta_deg = '-';
  const arr = lugshellLoadArrows(s, f);
  assert.deepEqual(arr.map((a) => a.id), ['LC2_inplane_30']);
  assert.equal(Math.round(arr[0].magN), 490500);
  assert.equal(arr[0].edited, true);
  assert.deepEqual(lugshellLoadArrows({ ...summary }), []); // 옛 서버 요약(핀 중심 없음)
});
