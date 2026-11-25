import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, diffDays, weekday, isWeekend, mondayOf, eachDay, visibleDays, monthSpans, spanCols, stackLanes,
  deptColor, rowContent, rangeLabel, shortDate, snapCol, layoutBars, KR_HOLIDAYS,
} from './councilTimeline.js';

test('날짜 계산', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(diffDays('2026-11-25', '2026-12-25'), 30);
  assert.equal(weekday('2026-11-25'), 3);              // 수요일
  assert.equal(isWeekend('2026-11-28'), true);
  assert.equal(mondayOf('2026-11-25'), '2026-11-23');
  assert.equal(mondayOf('2026-11-29'), '2026-11-23');  // 일요일도 그 주 월요일
  assert.equal(eachDay('2026-11-29', '2026-12-01').length, 3);
  assert.equal(shortDate('2026-12-05'), '12/5');
  assert.equal(KR_HOLIDAYS['2026-12-25'], '성탄절');
  assert.equal(KR_HOLIDAYS['2026-07-17'], '제헌절');        // 2026년부터 다시 공휴일
  assert.equal(KR_HOLIDAYS['2026-05-01'], '노동절');
  assert.equal(KR_HOLIDAYS['2026-09-28'], undefined);       // 추석 연휴가 일요일과 겹치지 않아 대체공휴일 아님
});

test('보이는 날: 확대 단계와 주말 숨기기', () => {
  assert.equal(visibleDays('2026-11-23', 'week').length, 14);
  assert.equal(visibleDays('2026-11-23', 'week', true).length, 10);
  assert.equal(visibleDays('2026-11-23', 'quarter').length, 91);
  assert.deepEqual(monthSpans(visibleDays('2026-11-23', 'week')), [{ label: '2026. 11월', n: 8 }, { label: '2026. 12월', n: 6 }]);
});

test('기간 → 칸: 범위 밖, 잘림, 주말 숨김', () => {
  const days = visibleDays('2026-11-23', 'week');
  assert.deepEqual(spanCols(days, '2026-11-25', '2026-11-27'), [2, 4]);
  assert.deepEqual(spanCols(days, '2026-11-01', '2026-11-24'), [0, 1]);      // 앞이 잘림
  assert.deepEqual(spanCols(days, '2026-12-05', '2026-12-30'), [12, 13]);    // 뒤가 잘림
  assert.equal(spanCols(days, '2026-12-10', '2026-12-12'), null);
  const weekdays = visibleDays('2026-11-23', 'week', true);
  assert.deepEqual(spanCols(weekdays, '2026-11-28', '2026-12-01'), [5, 6]);  // 토요일 시작 → 월요일부터
  assert.equal(spanCols(weekdays, '2026-11-28', '2026-11-28'), null);
  assert.deepEqual(spanCols(weekdays, '2026-11-28', '2026-11-28', true), [4, 4]);  // 하루짜리는 금요일에 붙임
  assert.deepEqual(spanCols(weekdays, '2026-11-28', '2026-11-29', true), [4, 4]);  // 토 ~ 일 막대도 금요일에 붙임
  assert.equal(snapCol(weekdays, '2026-11-29'), 4);                                // 일요일 마일스톤 → 금요일
  assert.equal(snapCol(weekdays, '2026-11-30'), 5);
  assert.equal(snapCol(weekdays, '2026-12-20'), -1);
  assert.equal(snapCol(days, '2026-11-22'), -1);
});

test('겹치는 막대는 줄을 나눈다', () => {
  const { lane, count } = stackLanes([
    { id: 'a', start: '2026-11-23', end: '2026-11-27' },
    { id: 'b', start: '2026-11-25', end: '2026-11-30' },
    { id: 'c', start: '2026-11-28', end: '2026-12-02' },
  ]);
  assert.equal(count, 2);
  assert.equal(lane.get('a'), 0);
  assert.equal(lane.get('b'), 1);
  assert.equal(lane.get('c'), 0);
  assert.equal(stackLanes([]).count, 1);
});

test('주말을 숨겨도 기간 끝의 토, 일 항목이 금요일에 붙고, 화면에서 겹치는 것은 줄을 나눈다', () => {
  const weekdays = visibleDays('2026-11-23', 'week', true);   // 마지막 보이는 날 = 12-04(금), 진짜 끝 = 12-06(일)
  const rangeEnd = '2026-12-06';
  assert.equal(spanCols(weekdays, '2026-12-05', '2026-12-05', true), null);              // 진짜 끝을 안 주면 빠진다
  assert.deepEqual(spanCols(weekdays, '2026-12-05', '2026-12-05', true, rangeEnd), [9, 9]);
  assert.equal(snapCol(weekdays, '2026-12-06', rangeEnd), 9);
  assert.equal(snapCol(weekdays, '2026-12-07', rangeEnd), -1);
  // 11-27(금) 하루 막대와 11-28(토) 마감 점은 같은 금요일 칸에 놓이므로 줄이 달라야 한다
  const bars = [
    { id: 'a', start: '2026-11-27', end: '2026-11-27', point: false },
    { id: 'b', start: '2026-11-28', end: '2026-11-28', point: true },
  ];
  const { placed, count } = layoutBars(bars, weekdays, rangeEnd, 2);
  assert.equal(count, 2);
  assert.deepEqual(placed.map((p) => [p.id, p.i]), [['a', 4], ['b', 4]]);
  assert.notEqual(placed[0].lane, placed[1].lane);
  // 오른쪽 끝의 점은 왼쪽으로 펼치고, 그 자리의 막대와 줄을 나눈다
  const edge = layoutBars([
    { id: 'bar', start: '2026-12-02', end: '2026-12-03', point: false },
    { id: 'pt', start: '2026-12-04', end: '2026-12-04', point: true },
  ], weekdays, rangeEnd, 3);
  assert.equal(edge.placed.find((p) => p.id === 'pt').flip, true);
  assert.equal(edge.count, 2);
  assert.equal(layoutBars([], weekdays, rangeEnd, 3).count, 1);
});

test('부서 색은 이름으로 정해져 늘 같다', () => {
  assert.equal(deptColor('선장설계'), deptColor('선장설계'));
  assert.match(deptColor('기장설계'), /^#[0-9A-F]{6}$/i);
  assert.match(deptColor(''), /^#/);
});

test('한 줄에 그릴 것: 막대, 기간 앞의 지연, 마일스톤', () => {
  const task = {
    items: [
      { id: 1, title: '기간 항목', status: 'doing', start_date: '2026-11-24', due_date: '2026-11-27' },
      { id: 2, title: '점 항목', status: 'todo', start_date: null, due_date: '2026-12-01' },
      { id: 3, title: '끝난 항목', status: 'done', start_date: null, due_date: '2026-11-26' },
      { id: 4, title: '옛 지연', status: 'todo', start_date: null, due_date: '2026-11-10' },
      { id: 5, title: '옛 완료', status: 'done', start_date: null, due_date: '2026-11-10' },
      { id: 6, title: '먼 미래', status: 'todo', start_date: null, due_date: '2027-03-01' },
    ],
    milestones: [{ id: 1, date: '2026-12-02', title: '시연' }, { id: 2, date: '2027-01-10', title: '완료 보고' }],
  };
  const r = rowContent(task, '2026-11-23', '2026-12-06', '2026-11-25');
  assert.deepEqual(r.bars.map((b) => [b.item.id, b.point]), [[1, false], [2, true]]);
  assert.deepEqual(r.lateBefore.map((i) => i.id), [4]);
  assert.deepEqual(r.milestones.map((m) => m.title), ['시연']);
  const withDone = rowContent(task, '2026-11-23', '2026-12-06', '2026-11-25', true);
  assert.deepEqual(withDone.bars.map((b) => b.item.id), [1, 2, 3]);
  assert.deepEqual(rowContent({}, '2026-11-23', '2026-12-06', '2026-11-25'), { bars: [], lateBefore: [], milestones: [] });
});

test('기간 표시', () => {
  assert.equal(rangeLabel('2026-11-23', '2026-12-06'), '2026. 11. 23 ~ 12. 6');
  assert.equal(rangeLabel('2026-12-21', '2027-01-03'), '2026. 12. 21 ~ 2027. 1. 3');
});
