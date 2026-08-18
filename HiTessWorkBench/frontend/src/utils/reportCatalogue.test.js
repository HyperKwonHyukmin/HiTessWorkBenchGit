import test from 'node:test';
import assert from 'node:assert/strict';

import { decorateHistoryForReport } from './reportCatalogue.js';

const CAPS = {
  'truss-assessment': { reportable: true, hasTemplate: false, displayName: 'Truss Assessment' },
  'carling-free': { reportable: true, hasTemplate: true, displayName: 'Carling Free Calculator' },
};

test('완료된 이력은 리포트 가능으로 표시된다', () => {
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: 'Truss Assessment', status: 'Success' }],
    CAPS,
  );
  assert.equal(rows[0].reportable, true);
  assert.equal(rows[0].blockedReason, null);
});

test('실패한 이력은 사유와 함께 차단된다', () => {
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: 'Truss Assessment', status: 'Failed' }],
    CAPS,
  );
  assert.equal(rows[0].reportable, false);
  assert.equal(rows[0].blockedReason, '완료된 해석만 리포트를 만들 수 있습니다.');
});

test('별칭으로 저장된 App 도 양식 보유 여부를 찾아낸다', () => {
  const caps = {
    'jib-rest': {
      reportable: true,
      hasTemplate: true,
      displayName: 'Jib Rest Assessment',
      aliases: ['Jib Rest Assessment', 'Jib Rest Assessment (1단)', 'Jib Rest Assessment (2단)'],
    },
  };
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: 'Jib Rest Assessment (1단)', status: 'Success' }],
    caps,
  );
  assert.equal(rows[0].hasTemplate, true);
});

test('capabilities 에 없는 App 도 범용 서식으로 생성 가능하다', () => {
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: '처음 보는 App', status: 'Success' }],
    CAPS,
  );
  assert.equal(rows[0].reportable, true);
  assert.equal(rows[0].hasTemplate, false);
});

test('양식 보유 여부가 표시된다', () => {
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: 'Carling Free Calculator', status: 'Success' }],
    CAPS,
  );
  assert.equal(rows[0].hasTemplate, true);
});

test('빈 입력은 빈 배열을 돌려준다', () => {
  assert.deepEqual(decorateHistoryForReport(null, CAPS), []);
  assert.deepEqual(decorateHistoryForReport([], null), []);
});
