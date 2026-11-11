import test from 'node:test';
import assert from 'node:assert/strict';

import { LUG_FAMILIES, bookItemState, codeKey, familyFigure, familyRepresentative, figureViewBox, filterBookItems, groupCounts, matchesQuery, swlOptions } from './drawingBook.js';

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

test('계열 대표 쪽 = 하중이 가운데쯤인 쪽, 하중 없으면 맨 앞, 없으면 null', () => {
  // L: 16·25 → 가운데(아래쪽) 16 / D: 2·50 → 2
  assert.equal(familyRepresentative(items, 'L').code, 'L-16');
  assert.equal(familyRepresentative(items, 'D').code, 'D-2, D-2A, D-2P');
  const more = [
    { code: 'T-5', family: 'T', swl_t: 5, bookPage: 30 },
    { code: 'T-20', family: 'T', swl_t: 20, bookPage: 33 },
    { code: 'T-50', family: 'T', swl_t: 50, bookPage: 36 },
    { code: 'RB-35', family: 'BKT', swl_t: null, bookPage: 77 },
    { code: 'RB1', family: 'BKT', swl_t: null, bookPage: 76 },
  ];
  assert.equal(familyRepresentative(more, 'T').code, 'T-20');
  assert.equal(familyRepresentative(more, 'BKT').code, 'RB1');
  assert.equal(familyRepresentative(more, 'X'), null);
});

test('도우미 그림 = 정해 둔 기호의 쪽 + 상자, 없으면 하중 가운데 쪽(상자 없음)', () => {
  const L = LUG_FAMILIES.find((f) => f.id === 'L');
  const withL30 = [...items, { code: 'L-30', aliases: ['L-30'], family: 'L', swl_t: 30, bookPage: 23, pdfPage: 34 }];
  assert.deepEqual(familyFigure(withL30, L), { item: withL30.at(-1), box: L.figure.box });
  assert.equal(familyFigure(items, L).item.code, 'L-16');      // L-30 이 없으면 대신
  assert.equal(familyFigure(items, L).box, null);
  assert.equal(familyFigure([], L), null);
  // 모든 계열 상자는 0~1 안의 바른 사각형
  for (const f of LUG_FAMILIES) {
    const [x0, y0, x1, y1] = f.figure.box;
    assert.ok(0 <= x0 && x0 < x1 && x1 <= 1 && 0 <= y0 && y0 < y1 && y1 <= 1, f.id);
  }
});

test('상자 → 큰 그림 viewBox (small 은 쪽 높이 2~54%)', () => {
  assert.equal(figureViewBox([0, 0, 1, 1]), '0 16.8 595 437.8');
  assert.equal(figureViewBox([0.5, 0.5, 1, 1]), '297.5 235.8 297.5 218.9');
});
