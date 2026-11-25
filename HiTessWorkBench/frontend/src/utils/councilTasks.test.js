import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dueInfo, isStale, summarize, departmentCounts, filterTasks, groupTasks, compareTasks,
  latestUpdate, authorLabel, taskPayload, formFromTask, noteCounts, localDay, changedFields,
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
  assert.deepEqual(noteCounts(t), { comment: 1, progress: 0, status: 1 });
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
