import test from 'node:test';
import assert from 'node:assert/strict';
import { sweep, loopPoints, designToPlates, plateBounds, parseFieldValue, changedFields, boundaryLines, designLoadSummary } from './lugGeometry.js';
import { lugshellLoadArrows, validateLugshellForm, initialLugshellForm } from './lugshellEdits.js';

test('sweep: 엔진 geom.sweep 와 같은 방향 규칙', () => {
  const [a0, a1] = sweep([1, 0], [-1, 0], [0, 0], true);
  assert.ok(Math.abs(a1 - a0 - Math.PI) < 1e-9);       // 반시계 반바퀴
  const [b0, b1] = sweep([1, 0], [0, -1], [0, 0], false);
  assert.ok(Math.abs(b1 - b0 + Math.PI / 2) < 1e-9);   // 시계 1/4
});

test('loopPoints: 반원 위쪽을 지나고 닫는 점은 빼다', () => {
  const loop = { start: [-10, 0], segments: [{ line: [10, 0] }, { arc: [-10, 0], center: [0, 0], ccw: true }] };
  const pts = loopPoints(loop, 10);
  assert.deepEqual(pts[0], [-10, 0]);
  assert.ok(pts.some(([x, y]) => Math.abs(x) < 1e-6 && Math.abs(y - 10) < 1e-6));   // 꼭대기
  assert.ok(pts.every(([, y]) => y >= -1e-9));                                   // 아래로 안 감
  const last = pts[pts.length - 1];
  assert.notDeepEqual(last, pts[0]);
});

test('designToPlates: 핀 구멍을 판 좌표로 옮기고 브래킷 판은 구멍 없음', () => {
  const design = {
    plates: [
      { id: 'main', role: 'main', t: 20, plane: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
        outline: { start: [-50, 0], segments: [{ line: [50, 0] }, { line: [50, 100] }, { line: [-50, 100] }, { line: [-50, 0] }] } },
      { id: 'br', role: 'stiffener', t: 20, plane: { origin: [30, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
        outline: { start: [0, 0], segments: [{ line: [40, 0] }, { line: [0, 50] }, { line: [0, 0] }] } },
    ],
    pin: { center: [0, 0, 60], hole_d: 20, plates: ['main'] },
  };
  const [main, br] = designToPlates(design, 30);
  assert.equal(main.holes.length, 1);
  const hx = main.holes[0].map((p) => p[0]);
  const hy = main.holes[0].map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...hx) - 10) < 1e-9 && Math.abs((Math.max(...hy) + Math.min(...hy)) / 2 - 60) < 1e-9);
  assert.equal(br.holes.length, 0);
  assert.deepEqual(br.n, [1, 0, 0]);   // u=Y × v=Z = +X
  const b = plateBounds([main, br]);
  assert.deepEqual(b.min, [-50, 0, 0]);
  assert.equal(b.size, 100);
});

test('parseFieldValue · changedFields', () => {
  assert.equal(parseFieldValue({ kind: 'length' }, '12,5'), 12.5);
  assert.equal(parseFieldValue({ kind: 'length' }, ''), null);
  assert.equal(parseFieldValue({ kind: 'length' }, 'abc'), null);
  assert.equal(parseFieldValue({ kind: 'text' }, ' SWS400B '), 'SWS400B');
  assert.deepEqual(changedFields({ a: 1, b: 2 }, { a: 1, b: 3 }), ['b']);
});

const D_BOX = {
  plates: [
    { id: 'main', role: 'main', t: 20, plane: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
      outline: { start: [-100, 0], segments: [{ line: [100, 0] }, { line: [100, 200] }, { line: [-100, 200] }, { line: [-100, 0] }] } },
    { id: 'br', role: 'stiffener', t: 10, plane: { origin: [50, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
      outline: { start: [10, 0], segments: [{ line: [60, 0] }, { line: [10, 80] }, { line: [10, 0] }] } },
  ],
  pin: { center: [0, 0, 150], axis: [0, 1, 0], hole_d: 40, pin_d: 39, plates: ['main'] },
  boundary: [{ kind: 'fixed', plate: 'main', where: 'region', v_max: 0 }, { kind: 'fixed', plate: 'br', where: 'region', v_max: 0 }],
  load_cases: [{ id: 'LC1', swl_t: 5, daf: 1.2, alpha_deg: 0, beta_deg: 0 }, { id: 'LC2', swl_t: 5, daf: 1.2, alpha_deg: 90, beta_deg: 0 }],
  analysis: { g: 9.81 },
};

test('boundaryLines: 고정 판마다 바닥 선 하나 (전역 좌표)', () => {
  const lines = boundaryLines(D_BOX);
  assert.deepEqual(lines.map((l) => l.plate), ['main', 'br']);
  assert.deepEqual(lines[0].line, [[-100, 0, 0], [100, 0, 0]]);
  assert.deepEqual(lines[1].line, [[50, 10, 0], [50, 60, 0]]);
});

test('designLoadSummary: 결과 화면 하중 고치기와 같은 검사와 화살표 규칙에 넣을 수 있다', () => {
  const s = designLoadSummary(D_BOX);
  const form = initialLugshellForm(s);
  assert.equal(form.swl_t, '5');
  assert.equal(form.pin_d, '39');
  assert.deepEqual(validateLugshellForm(form, 40), {});
  const arrows = lugshellLoadArrows(s, form);
  assert.equal(arrows.length, 2);
  assert.deepEqual(arrows[0].dir.map((x) => Math.round(x * 1e9) / 1e9), [0, 0, 1]);   // 수직 = 위
  assert.ok(Math.abs(arrows[1].dir[0] - 1) < 1e-9);                                      // α 90 = 판 면 안 옆
  assert.ok(Math.abs(arrows[0].magN - 5 * 1000 * 9.81 * 1.2) < 1e-6);
});

test('케이스별 하중 크기(kN): 넣은 케이스만 그 크기, 빈 칸은 안전하중 × g × DAF, 잘못된 값은 오류', () => {
  const s = designLoadSummary(D_BOX);
  const form = initialLugshellForm(s);
  form.cases[1].p_kn = '300';
  assert.deepEqual(validateLugshellForm(form, 40), {});
  const arrows = lugshellLoadArrows(s, form);
  assert.ok(Math.abs(arrows[0].magN - 5 * 1000 * 9.81 * 1.2) < 1e-6);
  assert.equal(arrows[1].magN, 300000);
  assert.equal(arrows[1].kN, '300 kN');
  assert.ok(arrows[1].edited && arrows[1].ownForce && !arrows[0].ownForce);
  form.cases[1].p_kn = '0';
  assert.ok(validateLugshellForm(form, 40)['LC2.p_kn']);
});
