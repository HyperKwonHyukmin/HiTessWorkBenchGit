import test from 'node:test';
import assert from 'node:assert/strict';

import { UNCATEGORIZED_LABEL, formatDuration, formatTotalMinutes, groupVideos } from './videoCatalog.js';

test('category 별로 묶고 처음 나온 순서를 지킨다, 분류 없는 영상은 맨 뒤', () => {
  const groups = groupVideos([
    { id: 'x', category: '' },
    { id: 'a', category: '소개' },
    { id: 'b', category: '해석' },
    { id: 'c', category: '소개' },
  ]);
  assert.deepEqual(groups.map(g => g.label), ['소개', '해석', UNCATEGORIZED_LABEL]);
  assert.deepEqual(groups[0].videos.map(v => v.id), ['a', 'c']);
});

test('목록이 아니면 빈 묶음', () => {
  assert.deepEqual(groupVideos(null), []);
});

test('재생 시간 표기', () => {
  assert.equal(formatDuration(60.1), '1:00');
  assert.equal(formatDuration(377.2), '6:17');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(null), '');
  assert.equal(formatTotalMinutes([{ durationSeconds: 60 }, { durationSeconds: 377 }, {}]), '약 7분');
  assert.equal(formatTotalMinutes([{}]), '');
});
