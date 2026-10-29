import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupByMonth, inPeriod, itemKey, listMonths, listStudios, listYears, matchesUpdate, monthLabel, newIndexes, splitHits,
  studioLabel, viewYearFor,
} from './updateHistory.js';
import { CHANGELOG, CHANGELOG_TYPE_META, changelogKey } from '../constants/changelog.js';

const items = [
  { date: '2026-10-21', version: '1.6.22', kind: '기능', title: 'C', summary: '3D 미리보기' },
  { date: '2026-10-21', version: '1.6.21', kind: '수정', title: 'B', summary: '목록' },
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

test('필터: 분류·찾기(세부 줄·버전·요청자 포함)', () => {
  assert.equal(matchesUpdate({ ...items[0], requester: '김도현 선임' }, { q: '김도현' }), true);
  assert.equal(matchesUpdate(items[0], { q: '김도현' }), false);
  assert.equal(items.filter((it) => matchesUpdate(it, { kind: '수정' })).length, 1);
  assert.equal(items.filter((it) => matchesUpdate(it, { q: '내 작업' })).length, 1);
  assert.equal(items.filter((it) => matchesUpdate(it, { q: 'v1.6.22' })).length, 1);
  assert.equal(items.filter((it) => matchesUpdate(it, {})).length, 3);
});

test('대상 필터: 전체·WorkBench 본체·Studio, 찾기는 Studio 이름도', () => {
  const list = [
    ...items,
    { date: '2026-10-29', version: '0.1.0', studio: 'model-studio', kind: '기능', title: 'D', summary: '단면 변경' },
    { date: '2026-10-28', version: '0.0.174', studio: 'module-unit-studio', kind: '기능', title: 'E', summary: 'RBE' },
  ];
  const count = (target) => list.filter((it) => matchesUpdate(it, { target })).length;
  assert.equal(count(''), 5);
  assert.equal(count('workbench'), 3);
  assert.equal(count('model-studio'), 1);
  assert.equal(count('plate-studio'), 0);
  assert.equal(list.filter((it) => matchesUpdate(it, { q: 'model builder studio' })).length, 1);
  assert.deepEqual(listStudios([list[4], list[3], list[0]]), ['model-studio', 'module-unit-studio']);
  assert.equal(studioLabel('model-studio'), 'Model Builder Studio');
  assert.equal(studioLabel('new-studio'), 'new-studio');
});

test('달·해 목록은 최근 것 먼저, 건수와 함께', () => {
  assert.deepEqual(listMonths(items), [
    { month: '2026-10', label: '2026년 10월', count: 2 },
    { month: '2026-09', label: '2026년 9월', count: 1 },
  ]);
  assert.deepEqual(listMonths([]), []);
  assert.deepEqual(listYears([...items, { date: '2025-12-31' }]), ['2026', '2025']);
});

test('기간 필터: 전체·해·달·최근 7일/30일(오늘 포함)', () => {
  const today = new Date(2026, 9, 22);   // 2026-10-22
  const count = (period) => items.filter((it) => matchesUpdate(it, { period, today })).length;
  assert.equal(count(''), 3);
  assert.equal(count('2026'), 3);
  assert.equal(count('2025'), 0);
  assert.equal(count('2026-09'), 1);
  assert.equal(count('d7'), 2);   // 10-16 ~ 10-22
  assert.equal(count('d30'), 3);  // 09-23 ~ 10-22
  assert.equal(inPeriod({ date: '2026-10-16' }, 'd7', today), true);
  assert.equal(inPeriod({ date: '2026-10-15' }, 'd7', today), false);
  assert.equal(items.filter((it) => matchesUpdate(it, { period: '2026-10', kind: '수정' })).length, 1);
});

test('둘째 단의 해: 고른 해·달의 해 > 마지막으로 본 해 > 가장 최근 해', () => {
  const years = ['2026', '2025'];
  assert.equal(viewYearFor('2025-03', '2026', years), '2025');
  assert.equal(viewYearFor('2025', '2026', years), '2025');
  assert.equal(viewYearFor('d7', '2025', years), '2025');
  assert.equal(viewYearFor('', '', years), '2026');
  assert.equal(viewYearFor('', '1999', years), '2026');
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
