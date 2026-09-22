import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTIFICATION_LIST_CAP,
  formatNotificationTime,
  mergeNotifications,
  notificationKindMeta,
  resolveNotificationTarget,
  toastToneFor,
} from './notificationLink.js';

test('링크에서 메뉴·params·analysisId 를 꺼낸다', () => {
  const t = resolveNotificationTarget({ menu: ' My Projects ', params: { analysis_id: '12', job_id: 'j' } });
  assert.deepEqual(t, { menu: 'My Projects', params: { analysis_id: '12', job_id: 'j' }, analysisId: 12 });
});

test('menu 가 없거나 링크가 아니면 null', () => {
  assert.equal(resolveNotificationTarget(null), null);
  assert.equal(resolveNotificationTarget({ params: {} }), null);
  assert.equal(resolveNotificationTarget({ menu: '   ' }), null);
});

test('analysis_id 가 정수가 아니면 analysisId 는 null', () => {
  assert.equal(resolveNotificationTarget({ menu: 'My Projects', params: { analysis_id: 'abc' } }).analysisId, null);
  assert.equal(resolveNotificationTarget({ menu: 'My Projects', params: { analysis_id: 0 } }).analysisId, null);
  assert.deepEqual(resolveNotificationTarget({ menu: 'Dashboard' }).params, {});
});

test('병합은 새 항목 우선·id 내림차순·중복 제거·캡', () => {
  const prev = [{ id: 3, title: 'old3' }, { id: 1, title: 'old1' }];
  const fresh = [{ id: 5, title: 'n5' }, { id: 3, title: 'new3' }];
  const merged = mergeNotifications(prev, fresh);
  assert.deepEqual(merged.map(n => n.id), [5, 3, 1]);
  assert.equal(merged[1].title, 'new3');

  const many = Array.from({ length: NOTIFICATION_LIST_CAP + 20 }, (_, i) => ({ id: i + 1 }));
  assert.equal(mergeNotifications([], many).length, NOTIFICATION_LIST_CAP);
  assert.equal(mergeNotifications([], many)[0].id, NOTIFICATION_LIST_CAP + 20);
});

test('병합은 id 가 없는 쓰레기를 버린다', () => {
  assert.deepEqual(mergeNotifications([null, { id: 'x' }], [{ id: 2 }]), [{ id: 2 }]);
});

test('kind 메타와 토스트 톤', () => {
  assert.equal(notificationKindMeta('job.completed').tone, 'success');
  assert.equal(notificationKindMeta('job.failed').tone, 'error');
  assert.equal(notificationKindMeta('unknown.kind').label, '알림');
  assert.equal(toastToneFor('retention.expired'), 'info');   // neutral → info
  assert.equal(toastToneFor('job.failed'), 'error');
});

test('상대 시각', () => {
  const now = Date.parse('2026-09-18T10:00:00');
  assert.equal(formatNotificationTime('2026-09-18T09:59:40', now), '방금');
  assert.equal(formatNotificationTime('2026-09-18T09:30:00', now), '30분 전');
  assert.equal(formatNotificationTime('2026-09-18T07:00:00', now), '3시간 전');
  assert.equal(formatNotificationTime('2026-09-15T10:00:00', now), '3일 전');
  assert.equal(formatNotificationTime('2026-09-01T10:00:00', now), '9/1');
  assert.equal(formatNotificationTime('garbage', now), '');
});
