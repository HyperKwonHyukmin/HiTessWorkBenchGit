import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOGBOOK_SOURCE, canAcceptLogbookPick, decideLogbookPick, logbookErrorMessage,
  isLogbookPickFor, decideTrussLogbookPick, LOGBOOK_IMPORT_TARGET,
  TRUSS_LOGBOOK_BUSY_MESSAGE, TRUSS_LOGBOOK_STARTED_MESSAGE, logbookLevelOf,
} from './logbookLink.js';

const store = (entries) => ({
  workspaces: entries.map(([id, slotNo]) => ({ id, slotNo })),
  states: Object.fromEntries(entries.map(([id, , state]) => [id, state])),
});

test('작업 번호(slotNo)로 탭을 찾는다 — 위치 순번이 아니다', () => {
  const s = store([['a', 1, null], ['c', 3, null]]);
  assert.deepEqual(decideLogbookPick(s, 3), { ok: true, workspaceId: 'c' });
  assert.deepEqual(decideLogbookPick(s, 1), { ok: true, workspaceId: 'a' });
});

test('그 번호의 탭이 없으면 닫혀 있다고 알린다', () => {
  const r = decideLogbookPick(store([['a', 1, null]]), 2);
  assert.equal(r.ok, false);
  assert.equal(r.message, '작업 2 탭이 닫혀 있습니다.');
});

test('잘못된 번호는 거부', () => {
  assert.equal(decideLogbookPick(store([['a', 1, null]]), 0).ok, false);
  assert.equal(decideLogbookPick(store([['a', 1, null]]), 'x').ok, false);
});

test('검증 중·가져오는 중인 탭은 받지 않는다', () => {
  const s = store([['a', 1, { handoffBdfPath: '/x.bdf', validating: true }], ['b', 2, null]]);
  const r = decideLogbookPick(s, 1);
  assert.equal(r.ok, false);
  assert.match(r.message, /^작업 1은 진행 중입니다/);
  const r2 = decideLogbookPick(s, 2, new Set([2]));
  assert.equal(r2.ok, false);
  assert.match(r2.message, /^작업 2은 진행 중입니다/);
  assert.equal(decideLogbookPick(s, 2, [1]).ok, true);
});

test('다른 입력이 있는 탭은 받지 않고, LogBook 에서 받은 모델은 Studio 전까지 바꿔 받는다', () => {
  assert.equal(canAcceptLogbookPick(null), true);
  assert.equal(canAcceptLogbookPick({ bdfFile: { name: 'a.bdf' } }), false);
  assert.equal(canAcceptLogbookPick({ handoffSource: '최근 실행', handoffBdfPath: '/a.bdf' }), false);
  const fromLogbook = { handoffSource: LOGBOOK_SOURCE, handoffBdfPath: '/a.bdf', step1Data: {}, bdfPath: '/a.bdf' };
  assert.equal(canAcceptLogbookPick(fromLogbook), true);
  assert.equal(canAcceptLogbookPick({ ...fromLogbook, studioOpened: true }), false);
  assert.equal(canAcceptLogbookPick({ ...fromLogbook, analysisResult: { status: 'PASS' } }), false);
  assert.equal(canAcceptLogbookPick({ ...fromLogbook, validating: true }), false);
  const r = decideLogbookPick(store([['a', 1, { bdfFile: { name: 'a.bdf' } }]]), 1);
  assert.match(r.message, /빈 작업 탭/);
});

test('오류 코드를 한국어 문구로 바꾼다', () => {
  const err = (status, detail) => ({ response: { status, data: { detail } } });
  assert.equal(logbookErrorMessage(err(409, 'logbook_has_includes')), 'INCLUDE 파일이 있는 모델은 아직 가져올 수 없습니다.');
  assert.match(logbookErrorMessage(err(404, 'logbook_file_not_found')), /찾을 수 없거나/);
  assert.match(logbookErrorMessage(err(415, 'logbook_not_bdf')), /BDF/);
  assert.match(logbookErrorMessage(err(502, 'logbook_unreachable')), /연결할 수 없습니다/);
  assert.equal(logbookErrorMessage(err(503, 'logbook_integration_disabled')), 'LogBook 연동이 설정되지 않았습니다.');
  assert.match(logbookErrorMessage(err(401, '유효하지 않은 세션')), /로그인이 만료/);
  assert.equal(logbookErrorMessage(err(403, '이 앱은 점검 중입니다.')), '이 앱은 점검 중입니다.');
  assert.match(logbookErrorMessage({ request: {} }), /WorkBench 서버/);
  assert.equal(logbookErrorMessage(new Error('boom')), 'boom');
});

test('대상(target)이 다른 메시지는 그 페이지 몫이 아니다 — GMU 는 truss 를, Truss 는 gmu 를 무시', () => {
  const truss = { requestId: 'r1', target: 'truss', slot: 1, fileId: 3 };
  const gmu = { requestId: 'r2', target: 'gmu', slot: 2, fileId: 3 };
  assert.equal(isLogbookPickFor(truss, 'truss'), true);
  assert.equal(isLogbookPickFor(truss, 'gmu'), false);
  assert.equal(isLogbookPickFor(gmu, 'gmu'), true);
  assert.equal(isLogbookPickFor(gmu, 'truss'), false);
  assert.equal(isLogbookPickFor({ target: 'truss' }, 'truss'), false); // requestId 없으면 회신할 곳이 없다
  assert.equal(isLogbookPickFor(null, 'gmu'), false);
  assert.deepEqual(LOGBOOK_IMPORT_TARGET, { gmu: 'GroupModuleUnit', truss: 'TrussAssessment' });
});

test('Truss 화면은 해석 중이거나 가져오는 중이면 받지 않는다', () => {
  assert.deepEqual(decideTrussLogbookPick({}), { ok: true });
  assert.deepEqual(decideTrussLogbookPick({ isRunning: true }), { ok: false, message: TRUSS_LOGBOOK_BUSY_MESSAGE });
  assert.equal(TRUSS_LOGBOOK_BUSY_MESSAGE, 'Truss 해석이 진행 중입니다. 끝난 뒤 다시 보내 주세요.');
  const r = decideTrussLogbookPick({ inFlight: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /가져오는 중/);
  assert.equal(TRUSS_LOGBOOK_STARTED_MESSAGE, 'Truss Structural Assessment로 가져와 해석을 시작했습니다.');
});

test('분류 규칙 거절(logbook_target_not_allowed)은 고정 문구 + LogBook 사유', () => {
  const err = (data) => ({ response: { status: 409, data } });
  assert.equal(
    logbookErrorMessage(err({ detail: 'logbook_target_not_allowed' })),
    '이 앱에 보낼 수 있도록 분류되지 않은 모델입니다.',
  );
  assert.equal(
    logbookErrorMessage(err({ detail: 'logbook_target_not_allowed', message: 'Truss 구역이 아닙니다.' })),
    '이 앱에 보낼 수 있도록 분류되지 않은 모델입니다. (Truss 구역이 아닙니다.)',
  );
  // 같은 409 라도 INCLUDE 거절은 그대로.
  assert.match(logbookErrorMessage(err({ detail: 'logbook_has_includes' })), /INCLUDE/);
});

test('LogBook 등급 — WB 관리자는 자동 LV3, 저장값, 미접속은 LV1, 못 읽었으면 null', () => {
  const data = { labels: { 1: '게스트', 2: '일반', 3: '관리자' },
                 levels: { A100001: { level: 2 }, B100001: { level: 3 }, C100001: { level: 1 } } };
  assert.deepEqual(logbookLevelOf({ employee_id: 'a100001' }, data), { level: 2, label: '일반', auto: false, known: true });
  assert.deepEqual(logbookLevelOf({ employee_id: 'B100001' }, data), { level: 3, label: '관리자', auto: false, known: true });
  assert.deepEqual(logbookLevelOf({ employee_id: 'Z100001' }, data), { level: 1, label: '게스트', auto: false, known: false });
  assert.deepEqual(logbookLevelOf({ employee_id: 'C100001', is_admin: true }, data),
    { level: 3, label: '관리자', auto: true, known: true });
  assert.equal(logbookLevelOf({ employee_id: 'A100001' }, null), null);
});
