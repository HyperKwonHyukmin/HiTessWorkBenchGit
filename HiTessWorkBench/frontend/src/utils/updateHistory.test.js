import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupByMonth, itemKey, listMonths, matchesUpdate, monthLabel, newIndexes, splitHits,
} from './updateHistory.js';
import { CHANGELOG, CHANGELOG_TYPE_META, changelogKey } from '../constants/changelog.js';

const items = [
  { date: '2026-10-21', version: '1.6.22', kind: '기능', title: 'C', summary: '3D 미리보기' },
  { date: '2026-10-21', version: '1.6.21', kind: '수정', title: 'B', summary: '목록', status: '확인 남음' },
  { date: '2026-09-30', kind: '개선', title: 'A', summary: '대시보드', points: ['내 작업'] },
];

test('처음 보는 PC 는 새 항목이 없다', () => {
  assert.equal(newIndexes(items, '').size, 0);
});

test('지난번 맨 위 항목보다 위만 새 항목 — 같은 날 배포도 구분', () => {
  assert.deepEqual([...newIndexes(items, itemKey(items[1]))], [0]);
  assert.equal(newIndexes(items, itemKey(items[0])).size, 0);
});

test('본 항목이 목록에서 빠졌으면 날짜로 판단', () => {
  assert.deepEqual([...newIndexes(items, '2026-10-01|9.9.9|없어짐')], [0, 1]);
});

test('거르기: 분류·확인 남음·찾기(세부 줄·버전 포함)', () => {
  assert.equal(items.filter((it) => matchesUpdate(it, { kind: '수정' })).length, 1);
  assert.equal(items.filter((it) => matchesUpdate(it, { pending: true })).length, 1);
  assert.equal(items.filter((it) => matchesUpdate(it, { q: '내 작업' })).length, 1);
  assert.equal(items.filter((it) => matchesUpdate(it, { q: 'v1.6.22' })).length, 1);
  assert.equal(items.filter((it) => matchesUpdate(it, {})).length, 3);
});

test('달 목록은 최근 달 먼저, 건수와 함께 · 달로 거르기', () => {
  assert.deepEqual(listMonths(items), [
    { month: '2026-10', label: '2026년 10월', count: 2 },
    { month: '2026-09', label: '2026년 9월', count: 1 },
  ]);
  assert.equal(items.filter((it) => matchesUpdate(it, { month: '2026-09' })).length, 1);
  assert.equal(items.filter((it) => matchesUpdate(it, { month: '2026-10', kind: '수정' })).length, 1);
  assert.deepEqual(listMonths([]), []);
});

test('달 묶음은 순서를 지킨다', () => {
  const groups = groupByMonth(items.map((it, index) => ({ it, index })));
  assert.deepEqual(groups.map((g) => g.label), ['2026년 10월', '2026년 9월']);
  assert.equal(groups[0].rows.length, 2);
  assert.equal(monthLabel(''), '날짜 없음');
});

test('찾은 글자 강조 조각', () => {
  assert.deepEqual(splitHits('BDF 3D bdf', 'bdf'), [
    { text: 'BDF', hit: true }, { text: ' 3D ', hit: false }, { text: 'bdf', hit: true },
  ]);
  assert.deepEqual(splitHits('abc', ''), [{ text: 'abc', hit: false }]);
});

test('솔버별 개발 이력: 최신이 위, 분류가 정의돼 있고 문구에 em dash 가 없다', () => {
  for (const [program, entries] of Object.entries(CHANGELOG)) {
    const dates = entries.map((e) => e.date);
    assert.deepEqual(dates, [...dates].sort().reverse(), program);
    for (const e of entries) {
      assert.ok(CHANGELOG_TYPE_META[e.type], `${program} ${e.version} type`);
      assert.ok(e.changes.every((c) => !c.includes('—')), `${program} ${e.version} em dash`);
      assert.match(changelogKey(e), /^\d{4}-\d{2}-\d{2}\|/);
    }
  }
});
