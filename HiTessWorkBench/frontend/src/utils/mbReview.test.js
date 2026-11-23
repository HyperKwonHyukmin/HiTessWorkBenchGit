import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingReview, reviewReasonText, reviewDownloadNote } from './mbReview.js';

const units = (kinds, state = 'pending') => kinds.map((kind, i) => ({ id: i + 1, kind, state }));

test('엔진이 쓴 required 는 남은 단위를 종류별로 센다', () => {
  const p = pendingReview({ status: 'required', unitCount: 4,
    units: units(['floating_group', 'floating_group', 'auto_rbe_assembly', 'auto_rbe']) });
  assert.equal(p.status, 'required');
  assert.equal(p.count, 4);
  assert.deepEqual(p.byKind, [{ label: '떨어진 그룹', count: 2 }, { label: '추정 연결', count: 2 }]);
  assert.match(reviewReasonText(p), /^승인 필요 4건/);
  assert.match(reviewDownloadNote(p), /승인 필요 4건/);
});

test('none, done, 파일 없음(옛 엔진)은 null', () => {
  assert.equal(pendingReview(null), null);
  assert.equal(pendingReview({ status: 'none', unitCount: 0, units: [] }), null);
  assert.equal(pendingReview({ status: 'done', unitCount: 3, units: units(['auto_rbe'], 'approved') }), null);
});

test('승인된 단위는 빼고, 모두 승인됐으면 null', () => {
  const doc = { status: 'required', unitCount: 2, units: [
    { id: 1, kind: 'auto_rbe', state: 'approved' }, { id: 2, kind: 'floating_group', state: 'pending' }] };
  assert.equal(pendingReview(doc).count, 1);
  assert.equal(pendingReview({ ...doc, units: units(['auto_rbe'], 'approved') }), null);
});

test('manual 은 손으로 고칠 단위만 센다', () => {
  const p = pendingReview({ status: 'manual', unitCount: 2,
    units: [{ kind: 'ubolt_unsupported', state: 'manual' }, { kind: 'auto_rbe', state: 'approved' }] });
  assert.equal(p.count, 1);
  assert.match(reviewReasonText(p), /손으로 고칠 것 1건/);
});

test('종류가 넷 이상이면 셋까지 쓰고 외', () => {
  const p = pendingReview({ status: 'required',
    units: units(['floating_group', 'point_mass_moved', 'ubolt_unsupported', 'group_translate']) });
  assert.match(reviewReasonText(p), / 외\)/);
});

test('BDF 머리 표시 설명', async () => {
  const { mbReviewFileText } = await import('./mbReview.js');
  assert.match(mbReviewFileText({ status: 'REQUIRED', items: 7 }), /7건/);
  assert.match(mbReviewFileText({ status: 'MANUAL', items: 2 }), /손으로 고칠 것 2건/);
  assert.equal(mbReviewFileText(null), '');
});

test('2.0 결과는 엔진이 실은 이름표를 쓴다(분류는 엔진 ReviewCatalog 한 곳)', () => {
  const p = pendingReview({ status: 'required', unitCount: 2, units: [
    { id: 1, kind: 'pipe_rest', label: 'U-bolt 없는 배관 받침', state: 'pending' },
    { id: 2, kind: 'new_kind_from_engine', label: '엔진 새 종류', state: 'pending' },
  ] });
  assert.deepEqual(p.byKind.map(k => k.label).sort(), ['U-bolt 없는 배관 받침', '엔진 새 종류'].sort());
  assert.match(reviewReasonText(p), /승인 필요 2건/);
});
