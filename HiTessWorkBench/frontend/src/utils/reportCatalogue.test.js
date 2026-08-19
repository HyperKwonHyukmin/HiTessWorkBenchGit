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

test('capabilities 에 없는 App 은 사유와 함께 막힌다', () => {
  // 미등록 App 을 기본 허용하면 신규 App 이 아무 검토 없이 빈 계산서를 뱉는다.
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: '처음 보는 App', status: 'Success' }],
    CAPS,
  );
  assert.equal(rows[0].reportable, false);
  assert.equal(rows[0].hasTemplate, false);
  assert.match(rows[0].blockedReason, /계산서/);
});

test('계산서 대상이 아닌 App 은 백엔드가 준 사유를 그대로 보여 준다', () => {
  // 조용히 목록에서 지우면 '내 해석이 왜 없지?' 가 된다 — 이유를 보이게 둔다.
  const caps = {
    'hitess-model-builder': {
      reportable: false,
      scope: 'not-applicable',
      reason: '모델을 만드는 App 이라 계산서 대상이 아닙니다.',
      displayName: 'HiTessModelBuilder',
      aliases: ['HiTessModelBuilder', 'HiTESS Model Builder'],
    },
  };
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: 'HiTessModelBuilder', status: 'Success' }],
    caps,
  );
  assert.equal(rows[0].reportable, false);
  assert.equal(rows[0].blockedReason, '모델을 만드는 App 이라 계산서 대상이 아닙니다.');
});

test('완료되지 않은 이력은 대상 App 이어도 상태 사유가 먼저 나온다', () => {
  // 두 사유가 겹칠 때 사용자가 먼저 고칠 수 있는 쪽을 보여 준다.
  const rows = decorateHistoryForReport(
    [{ id: 1, program_name: 'Truss Assessment', status: 'Failed' }],
    CAPS,
  );
  assert.equal(rows[0].blockedReason, '완료된 해석만 리포트를 만들 수 있습니다.');
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
