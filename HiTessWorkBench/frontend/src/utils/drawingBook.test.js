import test from 'node:test';
import assert from 'node:assert/strict';

import { bookItemState, codeKey, filterBookItems, groupCounts, matchesQuery, swlOptions } from './drawingBook.js';

const items = [
  { code: 'D-50', aliases: ['D-50'], name: 'LIFTING LUG', group: 'lug', groupLabel: 'LIFTING LUG', bookPage: 7, family: 'D', swl_t: 50, analysable: true },
  { code: 'L-25', aliases: ['L-25'], name: 'LIFTING LUG', group: 'lug', groupLabel: 'LIFTING LUG', bookPage: 22, family: 'L', swl_t: 25, analysable: true, convertible: true },
  { code: 'L-16', aliases: ['L-16'], name: 'LIFTING LUG', group: 'lug', groupLabel: 'LIFTING LUG', bookPage: 21, family: 'L', swl_t: 16, analysable: true },
  { code: 'D-2, D-2A, D-2P', aliases: ['D-2', 'D-2A', 'D-2P'], name: 'LIFTING LUG', group: 'lug', groupLabel: 'LIFTING LUG', bookPage: 1, family: 'D', swl_t: 2, analysable: true },
  { code: 'SH-12, -16', aliases: ['SH-12', 'SH-16'], name: 'U-SHACKLE', group: 'rigging', groupLabel: 'LIFTING 기자재', bookPage: 47, analysable: false },
  { code: 'NCB - 1', aliases: ['NCB-1'], name: '콘크리트 반목 (DOCK용)', group: 'dunnage', groupLabel: '반목', bookPage: 127, analysable: false },
  { code: 'AS - 011', aliases: ['AS-011'], name: 'LASHING 용 PIECE', group: 'erection_piece', groupLabel: '탑재용 PIECE', bookPage: 87, analysable: true },
];

test('기호는 띄어쓰기·하이픈·대소문자를 가리지 않는다', () => {
  assert.equal(codeKey('d 50'), 'D50');
  for (const q of ['D-50', 'd50', 'D 50', 'd-5']) assert.ok(matchesQuery(items[0], q), q);
  assert.ok(matchesQuery(items[3], 'd2p'));              // 별칭
  assert.ok(matchesQuery(items[6], 'as011'));             // 'AS - 011' 처럼 띄어 쓴 원문
  assert.ok(!matchesQuery(items[1], 'D-50'));
});

test('명칭·한글 낱말로도 찾는다', () => {
  assert.ok(matchesQuery(items[0], '러그'));
  assert.ok(matchesQuery(items[4], '샤클'));
  assert.ok(matchesQuery(items[5], '반목'));
  assert.ok(matchesQuery(items[6], 'lashing piece'));
  assert.ok(!matchesQuery(items[5], '러그'));
});

test('거르기 조합과 쪽 순서', () => {
  assert.deepEqual(filterBookItems(items, { group: 'lug' }).map((i) => i.bookPage), [1, 7, 21, 22]);
  assert.deepEqual(filterBookItems(items, { family: 'L', swl: 25 }).map((i) => i.code), ['L-25']);
  assert.deepEqual(filterBookItems(items, { convertibleOnly: true }).map((i) => i.code), ['L-25']);
  assert.deepEqual(filterBookItems(items, { query: '러그', family: 'D' }).map((i) => i.code), ['D-2, D-2A, D-2P', 'D-50']);
});

test('하중 칩·묶음 개수', () => {
  assert.deepEqual(swlOptions(items, 'L'), [16, 25]);
  assert.deepEqual(swlOptions(items, 'B'), []);
  assert.equal(groupCounts(items).lug, 4);
});

test('상태 글자와 변환 가능 여부', () => {
  assert.deepEqual(bookItemState(items[1]), { id: 'ready', label: '바로 변환', canRun: true });
  assert.equal(bookItemState(items[0]).id, 'drawing');
  assert.equal(bookItemState(items[5]).canRun, false);
});
