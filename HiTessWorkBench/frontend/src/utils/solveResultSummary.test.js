import test from 'node:test';
import assert from 'node:assert/strict';

import { lugCaseLabel, summarizeSubcases, governingCase } from './solveResultSummary.js';

const sub = (id, vms, disps) => ({
  subcaseId: id,
  quadStresses: vms.map(([e, v]) => ({ elementId: e, vonMises: v })),
  displacements: disps.map(([n, t1, t2, t3]) => ({ pointId: n, t1, t2, t3 })),
});

test('summarizeSubcases: 케이스마다 최대 응력 요소와 최대 변위 절점', () => {
  const rows = summarizeSubcases([
    sub(1, [[10, 50], [11, 120.5], [12, 80]], [[1, 0, 0, 0.1], [2, 0.3, 0, 0.4]]),
    sub(2, [[10, 200], [11, 10]], [[1, 0, 0, 2]]),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].maxVm, rows[0].maxVmElem], [120.5, 11]);
  assert.equal(rows[0].maxU, 0.5);
  assert.equal(rows[0].maxUNode, 2);
  assert.deepEqual([rows[1].maxVm, rows[1].maxVmElem, rows[1].maxU], [200, 10, 2]);
});

test('summarizeSubcases: 삼각 요소 응력도 넣고, 값이 없으면 null', () => {
  const rows = summarizeSubcases([
    { subcaseId: 1, quadStresses: [{ elementId: 1, vonMises: 5 }], triaStresses: [{ elementId: 9, vonMises: 7 }] },
    { subcaseId: 2 },
  ]);
  assert.deepEqual([rows[0].maxVm, rows[0].maxVmElem], [7, 9]);
  assert.equal(rows[1].maxVm, null);
  assert.equal(rows[1].maxU, null);
});

test('governingCase: 최대 응력이 가장 큰 케이스 번호', () => {
  assert.equal(governingCase([{ maxVm: 10 }, { maxVm: 30 }, { maxVm: null }]), 1);
  assert.equal(governingCase([]), -1);
});

test('lugCaseLabel: 러그 케이스 각도로 이름, 케이스 정보가 없으면 SUBCASE 번호', () => {
  assert.equal(lugCaseLabel({ id: 'LC1_vertical', alpha_deg: 0, beta_deg: 0 }, 0), 'LC1 수직');
  assert.equal(lugCaseLabel({ id: 'LC1_axial', alpha_deg: 0, beta_deg: 0 }, 0), 'LC1 축방향');
  assert.equal(lugCaseLabel({ id: 'LC5_user', alpha_deg: 0, beta_deg: 0 }, 4), 'LC5 0°');
  assert.equal(lugCaseLabel({ alpha_deg: 180, beta_deg: 0 }, 2), 'LC3 면내 180°');
  assert.equal(lugCaseLabel({ alpha_deg: 0, beta_deg: 15 }, 3), 'LC4 면외 15°');
  assert.equal(lugCaseLabel({ alpha_deg: 45, beta_deg: 10 }, 1), 'LC2 면내 45° 면외 10°');
  assert.equal(lugCaseLabel(null, 1, 7), 'SUBCASE 7');
});
