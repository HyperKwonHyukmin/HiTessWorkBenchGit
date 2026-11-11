import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPastStructuralResult } from './pastStructuralResult.js';

const BODY = {
  analysisId: 7, name: 'M02_lifting.bdf', hullNo: '3469', createdAt: '2026-11-11T09:00:00',
  warnings: [], files: { model: { name: 'M02_edited.json' } }, model: { a: 1 }, result: { members: [] },
};

test('자료를 받아 Studio 창 IPC 에 그대로 넘긴다', async () => {
  let sent;
  const out = await openPastStructuralResult(7, {
    fetchSet: async () => ({ data: BODY }),
    invoke: async (ch, p) => { sent = { ch, p }; return { ok: true }; },
    serverUrl: 'https://x:9091',
  });
  assert.deepEqual(out, { ok: true, warnings: [] });
  assert.equal(sent.ch, 'viewer:openPastStructuralResult');
  assert.equal(sent.p.analysisId, 7);
  assert.deepEqual(sent.p.model, { a: 1 });
  assert.equal(sent.p.hullNo, '3469');
  assert.equal(sent.p.serverUrl, 'https://x:9091');
  assert.equal(sent.p.stability, null);
});

test('옛 exe(IPC 없음 → null)는 업데이트 안내', async () => {
  const out = await openPastStructuralResult(7, { fetchSet: async () => ({ data: BODY }), invoke: async () => null });
  assert.equal(out.ok, false);
  assert.match(out.error, /최신 버전/);
});

test('브라우저(electron 없음)는 서버를 부르지 않는다', async () => {
  let called = false;
  const out = await openPastStructuralResult(7, { fetchSet: async () => { called = true; }, invoke: undefined });
  assert.equal(out.ok, false);
  assert.equal(called, false);
});

test('서버 오류 문구를 그대로, 옛 서버(빈 404)는 업데이트 안내', async () => {
  const withDetail = await openPastStructuralResult(7, {
    fetchSet: async () => { throw { response: { status: 404, data: { detail: '모델 파일을 찾을 수 없습니다' } } }; },
    invoke: async () => ({ ok: true }),
  });
  assert.equal(withDetail.error, '모델 파일을 찾을 수 없습니다');
  const oldServer = await openPastStructuralResult(7, {
    fetchSet: async () => { throw { response: { status: 404, data: { detail: 'Not Found' } } }; },
    invoke: async () => ({ ok: true }),
  });
  assert.match(oldServer.error, /서버 업데이트/);
});
