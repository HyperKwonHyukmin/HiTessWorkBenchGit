import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findGmuWorkspaceByAnalysisId,
  gmuWorkspaceKit as kit,
  gmuWorkspaceLabel,
  gmuWorkspaceStatus,
  gmuWorkspaceTitle,
  isGmuWorkspaceIdle,
  isOwnStructuralEvent,
} from './gmuLiftingWorkspaces.js';

function storeWith(...states) {
  let store = kit.normalize(null);
  store = kit.save(store, store.activeId, states[0]);
  for (const st of states.slice(1)) {
    store = kit.add(store);
    store = kit.save(store, store.activeId, st);
  }
  return store;
}

test('입력 BDF·연계 BDF·검증 기록이 하나라도 있으면 빈 탭이 아니다', () => {
  assert.equal(isGmuWorkspaceIdle(null), true);
  assert.equal(isGmuWorkspaceIdle({ useNastran: true, activeIdx: 0 }), true);
  assert.equal(isGmuWorkspaceIdle({ bdfFile: { name: 'a.bdf' } }), false);
  assert.equal(isGmuWorkspaceIdle({ handoffBdfPath: 'C:/x/a.bdf' }), false);
  assert.equal(isGmuWorkspaceIdle({ validating: true }), false);
  assert.equal(isGmuWorkspaceIdle({ bdfAnalysisId: 12 }), false);
});

test('메뉴로 다시 들어와도 검증한 탭은 남고 빈 탭이 열린다', () => {
  const s = storeWith({ bdfPath: 'C:/a/A.bdf', bdfAnalysisId: 1 }, null);
  const next = kit.freshEntry(s);
  assert.equal(next.workspaces.length, 2);
  assert.ok(isGmuWorkspaceIdle(next.states[next.activeId]));
});

test('탭 제목은 올린 BDF → 연계 BDF → 검증한 BDF → 새 작업 순서이고 확장자를 뗀다', () => {
  assert.equal(gmuWorkspaceLabel({ bdfFile: { name: '3496-A508372.bdf' } }), '3496-A508372');
  assert.equal(gmuWorkspaceLabel({ handoffBdfPath: 'C:\\out\\M04_edit.BDF' }), 'M04_edit');
  assert.equal(gmuWorkspaceLabel({ bdfPath: '/srv/u/B.dat' }), 'B');
  assert.equal(gmuWorkspaceLabel(null), '새 작업');
  const s = storeWith({ bdfFile: { name: 'A.bdf' } });
  assert.equal(gmuWorkspaceTitle(s.workspaces[0], s.states[s.activeId]), '작업 1 · A');
});

test('상태 점 — 검증 중 > 실패 > 산출물 받음 > 검토 단계 > 입력', () => {
  assert.equal(gmuWorkspaceStatus({ validating: true }), 'running');
  assert.equal(gmuWorkspaceStatus({ validFailed: true }), 'failed');
  assert.equal(gmuWorkspaceStatus({ step1Data: {}, analysisResult: { status: 'ERROR' } }), 'failed');
  assert.equal(gmuWorkspaceStatus({ step1Data: {}, delivered: true }), 'delivered');
  assert.equal(gmuWorkspaceStatus({ step1Data: {} }), 'ready');
  assert.equal(gmuWorkspaceStatus(null), 'idle');
});

test('Studio 구조 해석 완료 이벤트는 같은 검증 기록 id 의 탭만 받는다', () => {
  const s = storeWith({ bdfAnalysisId: 101 }, { bdfAnalysisId: 202 }, null);
  assert.equal(findGmuWorkspaceByAnalysisId(s, 202)?.id, s.workspaces[1].id);
  assert.equal(findGmuWorkspaceByAnalysisId(s, '101')?.id, s.workspaces[0].id);
  assert.equal(findGmuWorkspaceByAnalysisId(s, 999), null);
  assert.equal(findGmuWorkspaceByAnalysisId(s, null), null);
});

test('검증 기록 id 가 없는 탭은 어떤 완료 이벤트도 받지 않는다(다른 탭 결과가 섞이지 않게)', () => {
  assert.equal(isOwnStructuralEvent({ parentAnalysisId: 5 }, null), false);
  assert.equal(isOwnStructuralEvent({ parentAnalysisId: null }, 5), false);
  assert.equal(isOwnStructuralEvent({ parentAnalysisId: 5 }, 6), false);
  assert.equal(isOwnStructuralEvent({ parentAnalysisId: '5' }, 5), true);
});
