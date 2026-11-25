import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dueInfo, isStale, summarize, departmentCounts, filterTasks, groupTasks, compareTasks,
  latestUpdate, authorLabel, taskPayload, formFromTask, noteCounts, localDay, changedFields,
  itemDueInfo, itemStats, isTaskLate, sortItems, knownAssignees, itemPayload, formFromItem, defaultItemDue,
  boardEntries, boardColumn, assigneeLanes, undoPatch, mdDate, STATUS_META, NO_ASSIGNEE,
} from './councilTasks.js';

const NOW = new Date(2026, 10, 25, 9, 0);   // 2026-11-25 09:00 지역 시간

const task = (over = {}) => ({
  id: 1, title: '과제', department: '선장설계', status: 'reviewing', important: false,
  due_date: null, updated_at: '2026-11-24T10:00:00', created_at: '2026-11-24T10:00:00', notes: [],
  ...over,
});

test('목표일: 미정, D-n, 오늘, 지남, 끝난 과제는 지연 아님', () => {
  assert.deepEqual(dueInfo(null, 'reviewing', NOW), { text: '미정', late: false, soon: false });
  assert.equal(dueInfo('2026-11-28', 'reviewing', NOW).text, 'D-3');
  assert.equal(dueInfo('2026-11-28', 'reviewing', NOW).soon, true);
  assert.equal(dueInfo('2026-11-25', 'developing', NOW).text, '오늘');
  assert.deepEqual(dueInfo('2026-11-20', 'developing', NOW), { text: '5일 지남', late: true, soon: false });
  assert.equal(dueInfo('2026-11-20', 'done', NOW).late, false);
  assert.equal(dueInfo('2026-11-20', 'hold', NOW).text, '2026-11-20');
});

test('멈춤: 14일 동안 과제도 기록도 안 바뀐 진행 과제만', () => {
  const old = task({ updated_at: '2026-11-01T09:00:00', created_at: '2026-11-01T09:00:00' });
  assert.equal(isStale(old, NOW), true);
  assert.equal(isStale({ ...old, status: 'done' }, NOW), false);
  const withNote = { ...old, notes: [{ kind: 'comment', body: 'x', created_at: '2026-11-20T09:00:00' }] };
  assert.equal(isStale(withNote, NOW), false);
  assert.equal(isStale(task(), NOW), false);
});

test('요약, 부서 건수', () => {
  const tasks = [
    task({ id: 1, status: 'developing', due_date: '2026-11-01' }),
    task({ id: 2, department: '기장설계' }),
    task({ id: 3, department: '기장설계', status: 'done' }),
    task({ id: 4, department: ' ' }),
  ];
  const s = summarize(tasks, NOW);
  assert.equal(s.total, 4);
  assert.equal(s.byStatus.developing, 1);
  assert.equal(s.byStatus.done, 1);
  assert.equal(s.late, 1);
  assert.deepEqual(departmentCounts(tasks), [
    { name: '기장설계', count: 2 }, { name: '부서 미정', count: 1 }, { name: '선장설계', count: 1 },
  ]);
});

test('거르기: 상태, 지연, 부서, 글자(기록 본문 포함)', () => {
  const tasks = [
    task({ id: 1, status: 'developing', due_date: '2026-11-01', owner: '권혁민 책임' }),
    task({ id: 2, department: '기장설계', notes: [{ kind: 'comment', body: '우선순위 높음' }] }),
  ];
  assert.deepEqual(filterTasks(tasks, { status: 'late' }, NOW).map((t) => t.id), [1]);
  assert.deepEqual(filterTasks(tasks, { status: 'reviewing' }, NOW).map((t) => t.id), [2]);
  assert.deepEqual(filterTasks(tasks, { department: '기장설계' }, NOW).map((t) => t.id), [2]);
  assert.deepEqual(filterTasks(tasks, { query: '우선순위' }, NOW).map((t) => t.id), [2]);
  assert.deepEqual(filterTasks(tasks, { query: '권혁민' }, NOW).map((t) => t.id), [1]);
});

test('순서: 끝난 과제 아래, 중요, 지연, 목표일, 미정은 뒤', () => {
  const a = task({ id: 1, due_date: '2026-12-10' });
  const b = task({ id: 2, important: true });
  const c = task({ id: 3, due_date: '2026-11-01' });
  const d = task({ id: 4, status: 'done', important: true });
  const e = task({ id: 5 });
  const sorted = [a, b, c, d, e].sort((x, y) => compareTasks(x, y, NOW)).map((t) => t.id);
  assert.deepEqual(sorted, [2, 3, 1, 5, 4]);
});

test('묶기: 부서별, 상태별', () => {
  const tasks = [task({ id: 1 }), task({ id: 2, department: '기장설계', status: 'done' }), task({ id: 3 })];
  assert.deepEqual(groupTasks(tasks, 'department', NOW).map((g) => [g.label, g.tasks.length]), [['선장설계', 2], ['기장설계', 1]]);
  assert.deepEqual(groupTasks(tasks, 'status', NOW).map((g) => g.label), ['검토 중', '완료']);
});

test('마지막 갱신, 쓴 사람, 기록 건수', () => {
  assert.equal(latestUpdate([]), null);
  const t = task({ notes: [{ kind: 'comment', created_at: '2026-11-25T08:30:00' }, { kind: 'status', created_at: '2026-11-24T11:00:00' }] });
  assert.equal(localDay(latestUpdate([t])), '2026-11-25');
  assert.deepEqual(noteCounts(t), { comment: 1, progress: 0 });
  assert.equal(authorLabel({ author_name: '조혜민', author_position: '책임', author_department: '선장설계' }), '조혜민 책임 (선장설계)');
  assert.equal(authorLabel({ author_id: 'A1' }), 'A1');
});

test('폼과 서버 본문: 빈 칸은 빈 문자열, 모르는 상태는 검토 중', () => {
  const form = formFromTask(task({ requester: null, due_date: '2026-12-01' }));
  assert.equal(form.requester, '');
  assert.equal(form.due_date, '2026-12-01');
  const body = taskPayload({ ...form, title: '  새 이름 ', status: 'x' });
  assert.equal(body.title, '새 이름');
  assert.equal(body.status, 'reviewing');
  assert.equal(body.requester, '');
});

test('수정 폼은 바뀐 칸만 보낸다(다른 관리자의 수정을 덮지 않게)', () => {
  const t = task({ owner: '김한별 책임', status: 'developing' });
  const before = taskPayload(formFromTask(t));
  const after = taskPayload({ ...formFromTask(t), summary: '새 요청 내용' });
  assert.deepEqual(changedFields(before, after), { summary: '새 요청 내용' });
  assert.deepEqual(changedFields(before, before), {});
  assert.deepEqual(changedFields(before, { ...before, owner: '' }), { owner: '' });
});

test('항목 마감 표시와 집계', () => {
  assert.deepEqual(itemDueInfo({ due_date: '2026-11-20', status: 'todo' }, NOW), { text: '5일 지남', late: true, soon: false });
  assert.equal(itemDueInfo({ due_date: '2026-11-25', status: 'doing' }, NOW).text, '오늘');
  assert.equal(itemDueInfo({ due_date: '2026-12-10', status: 'todo' }, NOW).text, 'D-15');
  assert.deepEqual(itemDueInfo({ due_date: '2026-11-20', status: 'done' }, NOW), { text: '11/20', late: false, soon: false });
  const t = task({ items: [
    { id: 1, status: 'todo', due_date: '2026-12-10' },
    { id: 2, status: 'doing', due_date: '2026-11-20' },
    { id: 3, status: 'done', due_date: '2026-11-10' },
    { id: 4, status: 'todo', due_date: '2026-11-28' },
  ] });
  const s = itemStats(t, NOW);
  assert.deepEqual([s.total, s.todo, s.doing, s.done, s.late], [4, 2, 1, 1, 1]);
  assert.equal(s.next.id, 2);
  assert.equal(itemStats(task(), NOW).next, null);
});

test('과제 지연: 목표일이 지났거나 지연 항목이 있을 때, 끝난 과제는 아님', () => {
  const lateItem = { id: 1, status: 'todo', due_date: '2026-11-20' };
  assert.equal(isTaskLate(task({ items: [lateItem] }), NOW), true);
  assert.equal(isTaskLate(task({ due_date: '2026-11-01' }), NOW), true);
  assert.equal(isTaskLate(task({ items: [lateItem], status: 'hold' }), NOW), false);
  assert.equal(isTaskLate(task({ items: [{ ...lateItem, status: 'done' }] }), NOW), false);
  assert.equal(summarize([task({ items: [lateItem] }), task({ id: 2 })], NOW).late, 1);
  assert.deepEqual(filterTasks([task({ items: [lateItem] }), task({ id: 2 })], { status: 'late' }, NOW).map((x) => x.id), [1]);
});

test('항목이 바뀌면 멈춤이 풀린다, 항목 이름으로도 찾는다', () => {
  const old = task({ updated_at: '2026-11-01T09:00:00', created_at: '2026-11-01T09:00:00' });
  assert.equal(isStale(old, NOW), true);
  assert.equal(isStale({ ...old, items: [{ id: 1, status: 'todo', due_date: '2026-12-01', updated_at: '2026-11-24T09:00:00' }] }, NOW), false);
  const tasks = [task({ items: [{ id: 1, title: '입력 양식 정리', assignee: '임우람 책임', status: 'todo', due_date: '2026-12-01' }] }), task({ id: 2 })];
  assert.deepEqual(filterTasks(tasks, { query: '양식' }, NOW).map((x) => x.id), [1]);
  assert.deepEqual(filterTasks(tasks, { query: '임우람' }, NOW).map((x) => x.id), [1]);
});

test('항목 순서, 담당 추천, 항목 본문, 기본 마감', () => {
  const sorted = sortItems([
    { id: 1, status: 'done', due_date: '2026-11-01', done_at: '2026-11-02T10:00:00' },
    { id: 2, status: 'todo', due_date: '2026-12-10' },
    { id: 3, status: 'doing', due_date: '2026-11-28' },
    { id: 4, status: 'done', due_date: '2026-11-05', done_at: '2026-11-20T10:00:00' },
  ]).map((i) => i.id);
  assert.deepEqual(sorted, [3, 2, 4, 1]);
  assert.deepEqual(knownAssignees([task({ owner: '권혁민 책임', items: [{ assignee: '김한별 책임' }, { assignee: ' 권혁민 책임 ' }] })]), ['권혁민 책임', '김한별 책임']);
  const body = itemPayload({ ...formFromItem({ title: ' a ', status: 'x', start_date: null, due_date: '2026-12-01' }) });
  assert.deepEqual(body, { title: 'a', assignee: '', status: 'todo', start_date: '', due_date: '2026-12-01', note: '', important: false });
  assert.equal(defaultItemDue(NOW), '2026-11-27');                       // 수요일 → 그 주 금요일
  assert.equal(defaultItemDue(new Date(2026, 10, 28, 9, 0)), '2026-12-04');  // 토요일 → 다음 주 금요일
  assert.equal(defaultItemDue(new Date(2026, 10, 27, 9, 0)), '2026-11-27');  // 금요일은 오늘
  assert.equal(taskPayload(formFromTask(task({ start_date: '2026-11-25' }))).start_date, '2026-11-25');
});

test('보드: 카드 펼치기, 끝난 지 2주 넘은 것은 빼기, 칸 순서, 담당별 줄', () => {
  const tasks = [
    task({ id: 1, items: [
      { id: 1, title: 'a', status: 'todo', due_date: '2026-12-10', assignee: '김한별 책임' },
      { id: 2, title: 'b', status: 'todo', due_date: '2026-12-20', important: true, assignee: '권혁민 책임' },
      { id: 3, title: 'c', status: 'done', due_date: '2026-11-01', done_at: '2026-11-02T09:00:00' },   // 3주 전 완료
      { id: 4, title: 'd', status: 'done', due_date: '2026-11-20', done_at: '2026-11-20T09:00:00', assignee: '김한별 책임' },
    ] }),
    task({ id: 2, items: [{ id: 5, title: 'e', status: 'doing', due_date: '2026-11-30' }, { id: 6, title: 'f', status: 'done', due_date: '2026-11-24', done_at: '2026-11-24T09:00:00' }] }),
  ];
  const all = boardEntries(tasks, NOW);
  assert.deepEqual(all.map((e) => e.item.id), [1, 2, 4, 5, 6]);
  assert.equal(all[0].task.id, 1);
  assert.deepEqual(boardColumn(all, 'todo').map((e) => e.item.id), [2, 1]);        // 중요 먼저
  assert.deepEqual(boardColumn(all, 'done').map((e) => e.item.id), [6, 4]);        // 최근에 끝난 순
  assert.deepEqual(boardColumn(all, 'todo', '김한별 책임').map((e) => e.item.id), [1]);
  assert.deepEqual(boardEntries(tasks, NOW, NO_ASSIGNEE).map((e) => e.item.id), [5, 6]);
  assert.deepEqual(assigneeLanes(tasks), ['권혁민 책임', '김한별 책임', NO_ASSIGNEE]);
});

test('되돌리기 값, 날짜 표기, 상태 모양', () => {
  const item = { id: 1, status: 'todo', assignee: null, start_date: null, due_date: '2026-12-01' };
  assert.deepEqual(undoPatch(item, { status: 'doing', assignee: '김한별 책임' }), { status: 'todo', assignee: '' });
  assert.deepEqual(undoPatch(item, { start_date: '2026-11-28', due_date: '2026-12-03' }), { start_date: '', due_date: '2026-12-01' });
  assert.deepEqual(undoPatch({ ...item, status: 'done', done_at: '2026-11-01T09:00:00' }, { status: 'todo' }), { status: 'done', done_at: '2026-11-01T09:00:00' });
  assert.equal(mdDate('2026-11-07'), '11/7');
  assert.equal(mdDate('2026-11-07T10:00:00'), '11/7');
  for (const key of ['reviewing', 'developing', 'piloting', 'done', 'hold']) {
    assert.ok(STATUS_META[key].label && STATUS_META[key].dot && STATUS_META[key].text, key);
  }
});
