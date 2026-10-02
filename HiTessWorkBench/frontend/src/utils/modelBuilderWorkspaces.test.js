import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MODEL_BUILDER_WORKSPACES,
  activateWorkspace,
  addWorkspace,
  canAddWorkspace,
  closeWorkspace,
  findWorkspaceByOutputDir,
  freshEntryWorkspaces,
  isWorkspaceIdle,
  normalizeWorkspaceStore,
  saveWorkspaceState,
  workspaceLabel,
  workspaceTitle,
  workspaceStatus,
} from './modelBuilderWorkspaces.js';

const busy = (extra = {}) => ({ hasRunOnce: true, ...extra });

function storeWith(...states) {
  let store = normalizeWorkspaceStore(null);
  store = saveWorkspaceState(store, store.activeId, states[0]);
  for (const st of states.slice(1)) {
    store = addWorkspace(store);
    store = saveWorkspaceState(store, store.activeId, st);
  }
  return store;
}

// ── normalize ─────────────────────────────────────────────────────────
test('저장값이 없으면 빈 탭 1개로 시작한다', () => {
  const s = normalizeWorkspaceStore(null);
  assert.equal(s.workspaces.length, 1);
  assert.equal(s.activeId, s.workspaces[0].id);
  assert.equal(s.workspaces[0].seq, 1);
});

test('예전 단일 페이지 상태는 첫 탭의 상태로 옮긴다', () => {
  const legacy = { hasRunOnce: true, meshSize: '300' };
  const s = normalizeWorkspaceStore(legacy);
  assert.equal(s.workspaces.length, 1);
  assert.deepEqual(s.states[s.activeId], legacy);
});

test('활성 탭 id 가 없어진 탭을 가리키면 첫 탭으로 돌린다', () => {
  const s = storeWith(busy(), busy());
  const fixed = normalizeWorkspaceStore({ ...s, activeId: 'gone' });
  assert.equal(fixed.activeId, s.workspaces[0].id);
});

// ── fresh entry ───────────────────────────────────────────────────────
test('메뉴로 다시 들어와도 진행 중·결과 있는 탭은 남고 빈 탭이 하나 열린다', () => {
  const s = storeWith(busy({ jobStatus: { status: 'Running' } }), busy({ bdfResult: { outputDir: 'C:/a' } }));
  const next = freshEntryWorkspaces(s);
  assert.equal(next.workspaces.length, 3);
  assert.ok(isWorkspaceIdle(next.states[next.activeId]));
  assert.equal(next.activeId, next.workspaces[2].id);
});

test('메뉴로 다시 들어오면 빈 탭은 정리하고 하나만 새로 연다', () => {
  const s = storeWith(busy(), null, null);
  const next = freshEntryWorkspaces(s);
  assert.equal(next.workspaces.length, 2);
});

test('탭이 가득 차 있으면 새로 열지 않는다', () => {
  const states = Array.from({ length: MAX_MODEL_BUILDER_WORKSPACES }, () => busy());
  const s = storeWith(...states);
  const next = freshEntryWorkspaces(s);
  assert.equal(next.workspaces.length, MAX_MODEL_BUILDER_WORKSPACES);
  assert.equal(isWorkspaceIdle(next.states[next.activeId]), false);
});

// ── add / close / activate ────────────────────────────────────────────
test('탭 추가는 상한까지만 된다', () => {
  let s = normalizeWorkspaceStore(null);
  for (let i = 0; i < 10; i += 1) s = addWorkspace(s);
  assert.equal(s.workspaces.length, MAX_MODEL_BUILDER_WORKSPACES);
  assert.equal(canAddWorkspace(s), false);
});

test('탭 번호(seq)는 닫아도 재사용하지 않는다', () => {
  let s = storeWith(busy(), busy());
  s = closeWorkspace(s, s.workspaces[1].id);
  s = addWorkspace(s);
  assert.deepEqual(s.workspaces.map(ws => ws.seq), [1, 3]);
});

test('활성 탭을 닫으면 오른쪽 이웃, 없으면 왼쪽 이웃으로 간다', () => {
  let s = storeWith(busy(), busy(), busy());
  const [a, b, c] = s.workspaces.map(ws => ws.id);
  s = activateWorkspace(s, b);
  s = closeWorkspace(s, b);
  assert.equal(s.activeId, c);
  s = closeWorkspace(s, c);
  assert.equal(s.activeId, a);
});

test('마지막 탭을 닫으면 빈 탭 하나가 남는다', () => {
  let s = storeWith(busy());
  s = closeWorkspace(s, s.activeId);
  assert.equal(s.workspaces.length, 1);
  assert.ok(isWorkspaceIdle(s.states[s.activeId]));
});

test('닫힌 탭의 늦은 저장은 무시한다(탭이 되살아나지 않게)', () => {
  let s = storeWith(busy(), busy());
  const closedId = s.workspaces[0].id;
  s = closeWorkspace(s, closedId);
  const after = saveWorkspaceState(s, closedId, busy());
  assert.equal(after.states[closedId], undefined);
  assert.equal(after.workspaces.length, 1);
});

// ── 탭 표시 ───────────────────────────────────────────────────────────
test('탭 제목은 구조 CSV → 배관 CSV → 서버 입력명 → 새 작업 순서다', () => {
  assert.equal(workspaceLabel({ struFile: { name: 'A508372_stru.csv' } }, 1), 'A508372_stru');
  assert.equal(workspaceLabel({ pipeFile: { name: 'p.CSV' } }, 1), 'p');
  assert.equal(workspaceLabel({ serverInputs: { stru: 'C:\\x\\B_stru.csv' } }, 1), 'B_stru');
  assert.equal(workspaceLabel(null), '새 작업');
});

test('작업 번호는 1부터 붙고, 닫아도 다른 탭의 번호는 그대로이며 빈 번호를 다시 쓴다', () => {
  let s = storeWith(busy(), busy(), busy());
  assert.deepEqual(s.workspaces.map(ws => ws.slotNo), [1, 2, 3]);
  s = closeWorkspace(s, s.workspaces[0].id);
  assert.deepEqual(s.workspaces.map(ws => ws.slotNo), [2, 3]);
  s = addWorkspace(s);
  assert.deepEqual(s.workspaces.map(ws => ws.slotNo), [2, 3, 1]);
});

test('작업 번호가 없는 예전 저장값에는 빈 번호를 채운다', () => {
  const legacy = {
    activeId: 'a', nextSeq: 3,
    workspaces: [{ id: 'a', seq: 1 }, { id: 'b', seq: 2, slotNo: 1 }],
    states: {},
  };
  assert.deepEqual(normalizeWorkspaceStore(legacy).workspaces.map(ws => ws.slotNo), [2, 1]);
});

test('작업 이름은 작업 번호 + 탭 제목이다(같은 샘플을 두 탭에서 돌려도 구분된다)', () => {
  const sample = { serverInputs: { stru: '사내 표준 샘플' } };
  const s = storeWith(sample, sample);
  assert.deepEqual(
    s.workspaces.map(ws => workspaceTitle(ws, s.states[ws.id])),
    ['작업 1 · 사내 표준 샘플', '작업 2 · 사내 표준 샘플'],
  );
});

test('상태 점은 실행 중 > 실패 > 전달 완료 > 모델 있음 > 입력 순서로 판정한다', () => {
  assert.equal(workspaceStatus({ jobStatus: { status: 'Running' } }), 'running');
  assert.equal(workspaceStatus({ jobStatus: { status: 'Failed' } }), 'failed');
  const steps = [{ status: 'done' }, { status: 'done' }, { status: 'done' }];
  assert.equal(workspaceStatus({ jobStatus: { status: 'Success' }, bdfResult: {}, steps }), 'delivered');
  assert.equal(workspaceStatus({ jobStatus: { status: 'Success' }, bdfResult: {} }), 'ready');
  assert.equal(workspaceStatus(null), 'idle');
});

// ── Studio 편집 적용 요청 → 탭 찾기 ───────────────────────────────────
test('산출 폴더로 탭을 찾는다(경로 표기 차이 무시)', () => {
  const s = storeWith(
    busy({ bdfResult: { outputDir: 'C:\\userConnection\\A\\out' } }),
    busy({ bdfResult: { outputDir: 'C:\\userConnection\\B\\out' } }),
  );
  assert.equal(findWorkspaceByOutputDir(s, 'c:/userconnection/b/out/')?.id, s.workspaces[1].id);
  assert.equal(findWorkspaceByOutputDir(s, 'C:/other'), null);
  assert.equal(findWorkspaceByOutputDir(s, null), null);
});
