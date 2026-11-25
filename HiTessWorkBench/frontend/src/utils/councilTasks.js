// 구조해석 자동화 협의체 과제 현황 — 화면 규칙(상태, 지연, 멈춤, 거르기, 묶기). 서버는 routers/council.py.
// 계획 docs/plans/2026-11-25-automation-council-tasks-plan.md

export const STATUS_ORDER = ['reviewing', 'developing', 'piloting', 'done', 'hold'];

/**
 * 과제 상태의 이름과 모양. 표시는 어디서나 '점 + 글자' 하나다(components/admin/council/councilUi StatusBadge).
 * 움직이는 상태(개발 중, 시험 운영)만 옅은 배경을 받고, 나머지는 점과 글자만 — 목록 대부분이 같은 상태일 때 화면이 알약으로 덮이지 않게.
 */
export const STATUS_META = {
  reviewing: { label: '검토 중', dot: '#94a3b8', text: 'text-slate-700', badge: '' },
  developing: { label: '개발 중', dot: '#2563eb', text: 'text-blue-800', badge: 'bg-blue-50 border-blue-200' },
  piloting: { label: '시험 운영', dot: '#0d9488', text: 'text-teal-800', badge: 'bg-teal-50 border-teal-200' },
  done: { label: '완료', dot: '#059669', text: 'text-slate-600', badge: '' },
  hold: { label: '보류', dot: '#a8a29e', text: 'text-slate-600', badge: '' },
};

/** 기록 종류. 옛 판의 '상태 변경' 기록은 서버가 내보내지 않는다(2026-11-25 사용자 결정 — 로그를 남기지 않는다). */
export const NOTE_KIND_META = {
  comment: { label: '의견', badge: 'bg-blue-50 text-blue-800' },
  progress: { label: '진행 기록', badge: 'bg-emerald-50 text-emerald-800' },
};

/** 날짜 표시는 한 가지: '11/27'. */
export const mdDate = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
export const NO_ASSIGNEE = '담당 미정';
export const assigneeOf = (item) => (item?.assignee || '').trim() || NO_ASSIGNEE;

/** 항목(과제 아래 할 일) 상태 — Team Planner 의 Task 와 같다. 상태 원을 누르면 NEXT 순서로 바뀐다. */
export const ITEM_STATUS = { todo: '예정', doing: '진행', done: '완료' };
export const ITEM_STATUS_ORDER = ['todo', 'doing', 'done'];
export const NEXT_ITEM_STATUS = { todo: 'doing', doing: 'done', done: 'todo' };
export const MILESTONE_PRESETS = ['착수', '요구 확인', '시제품 시연', '시험 운영 시작', '회의 보고', '완료 보고'];

/** 이 기간 동안 과제도 기록도 바뀌지 않으면 '멈춤'(Team Planner 와 같은 14일). */
export const STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export const isClosed = (status) => status === 'done' || status === 'hold';

const pad = (n) => String(n).padStart(2, '0');

/** 지역 시간 기준 YYYY-MM-DD. */
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const dayNumber = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : null;
};

/** 목표일 표시. 끝난(완료, 보류) 과제는 지연으로 치지 않는다. */
export function dueInfo(dueDate, status, now = new Date()) {
  const due = dayNumber(dueDate);
  if (due === null) return { text: '미정', late: false, soon: false };
  const diff = due - dayNumber(localDay(now));
  const closed = isClosed(status);
  if (closed) return { text: dueDate, late: false, soon: false };
  if (diff < 0) return { text: `${-diff}일 지남`, late: true, soon: false };
  if (diff === 0) return { text: '오늘', late: false, soon: true };
  return { text: `D-${diff}`, late: false, soon: diff <= 7 };
}

const toTime = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** 마지막으로 무언가 바뀐 시각(과제 수정, 기록 추가, 항목 변경 중 늦은 것). */
export function lastActivity(task) {
  const noteTimes = (task?.notes || []).map((n) => toTime(n.updated_at || n.created_at));
  const itemTimes = (task?.items || []).map((i) => toTime(i.updated_at || i.created_at));
  return Math.max(toTime(task?.updated_at), toTime(task?.created_at), ...noteTimes, ...itemTimes, 0);
}

/** 항목의 마감 표시: 완료는 날짜만, 나머지는 D-n, 오늘, n일 지남. */
export function itemDueInfo(item, now = new Date()) {
  const due = dayNumber(item?.due_date);
  if (due === null) return { text: '', late: false, soon: false };
  if (item.status === 'done') return { text: mdDate(item.due_date), late: false, soon: false };
  const diff = due - dayNumber(localDay(now));
  if (diff < 0) return { text: `${-diff}일 지남`, late: true, soon: false };
  if (diff === 0) return { text: '오늘', late: false, soon: true };
  return { text: `D-${diff}`, late: false, soon: diff <= 7 };
}

/** 과제의 항목 집계: 상태별 수, 지연 수, 다음 마감(안 끝난 것 중 가장 빠른 것). */
export function itemStats(task, now = new Date()) {
  const items = task?.items || [];
  const open = items.filter((i) => i.status !== 'done')
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '') || (a.id || 0) - (b.id || 0));
  return {
    total: items.length,
    todo: items.filter((i) => i.status === 'todo').length,
    doing: items.filter((i) => i.status === 'doing').length,
    done: items.filter((i) => i.status === 'done').length,
    late: open.filter((i) => itemDueInfo(i, now).late).length,
    next: open[0] || null,
  };
}

/** 과제가 늦었는가: 과제 목표일이 지났거나, 마감 지난 항목이 있다. 끝난(완료, 보류) 과제는 아니다. */
export function isTaskLate(task, now = new Date()) {
  if (!task || isClosed(task.status)) return false;
  return dueInfo(task.due_date, task.status, now).late || itemStats(task, now).late > 0;
}

/** 항목 목록 순서: 안 끝난 것 먼저(마감 빠른 순), 끝난 것은 아래(최근에 끝난 순). */
export function sortItems(items) {
  const open = (items || []).filter((i) => i.status !== 'done')
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '') || (a.id || 0) - (b.id || 0));
  const done = (items || []).filter((i) => i.status === 'done')
    .sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '') || (b.id || 0) - (a.id || 0));
  return [...open, ...done];
}

/** 담당 입력칸의 추천 목록: 과제 담당과 항목 담당으로 이미 쓴 이름. */
export function knownAssignees(tasks) {
  const names = new Set();
  for (const t of tasks || []) {
    if (t.owner) names.add(t.owner.trim());
    for (const i of t.items || []) if (i.assignee) names.add(i.assignee.trim());
  }
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
}

export function isStale(task, now = new Date()) {
  if (!task || isClosed(task.status)) return false;
  const last = lastActivity(task);
  return last > 0 && now.getTime() - last >= STALE_DAYS * DAY_MS;
}

export function noteCounts(task) {
  const counts = { comment: 0, progress: 0 };
  for (const n of task?.notes || []) if (n.kind in counts) counts[n.kind] += 1;
  return counts;
}

/** 위쪽 요약 줄: 상태별 건수 + 지연 + 멈춤. */
export function summarize(tasks, now = new Date()) {
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  let late = 0;
  let stale = 0;
  for (const t of tasks || []) {
    if (t.status in byStatus) byStatus[t.status] += 1;
    if (isTaskLate(t, now)) late += 1;
    if (isStale(t, now)) stale += 1;
  }
  return { total: (tasks || []).length, byStatus, late, stale };
}

/** 의뢰 부서 목록과 건수(많은 순, 같으면 이름순). */
export function departmentCounts(tasks) {
  const map = new Map();
  for (const t of tasks || []) {
    const name = (t.department || '').trim() || '부서 미정';
    map.set(name, (map.get(name) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}

/**
 * 거르기. filter = { status?: 상태 키 | 'late' | 'stale', department?: 이름, query?: 글자 }
 * 글자는 과제 이름, 부서, 요청자, 담당, 요청 내용, 다음 단계, 기록 본문에서 찾는다.
 */
export function filterTasks(tasks, filter = {}, now = new Date()) {
  const q = (filter.query || '').trim().toLowerCase();
  return (tasks || []).filter((t) => {
    if (filter.department && ((t.department || '').trim() || '부서 미정') !== filter.department) return false;
    if (filter.status === 'late') { if (!isTaskLate(t, now)) return false; }
    else if (filter.status === 'stale') { if (!isStale(t, now)) return false; }
    else if (filter.status && t.status !== filter.status) return false;
    if (!q) return true;
    const hay = [t.title, t.department, t.requester, t.owner, t.summary, t.next_step, t.source,
      ...(t.notes || []).map((n) => n.body),
      ...(t.items || []).flatMap((i) => [i.title, i.assignee]),
      ...(t.milestones || []).map((m) => m.title)].join('\n').toLowerCase();
    return hay.includes(q);
  });
}

/** 한 묶음 안의 순서: 끝난 과제는 아래, 그다음 중요, 지연, 목표일 빠른 순(미정은 뒤), 먼저 만든 순. */
export function compareTasks(a, b, now = new Date()) {
  const closed = Number(isClosed(a.status)) - Number(isClosed(b.status));
  if (closed) return closed;
  const imp = Number(!!b.important) - Number(!!a.important);
  if (imp) return imp;
  const late = Number(isTaskLate(b, now)) - Number(isTaskLate(a, now));
  if (late) return late;
  const da = dayNumber(a.due_date);
  const db = dayNumber(b.due_date);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }
  return (a.id || 0) - (b.id || 0);
}

/** 부서별 또는 상태별로 묶는다. 부서는 건수 많은 순, 상태는 STATUS_ORDER 순. 빈 묶음은 뺀다. */
export function groupTasks(tasks, by = 'department', now = new Date()) {
  const list = [...(tasks || [])].sort((a, b) => compareTasks(a, b, now));
  if (by === 'status') {
    return STATUS_ORDER
      .map((key) => ({ key, label: STATUS_META[key].label, tasks: list.filter((t) => t.status === key) }))
      .filter((g) => g.tasks.length > 0);
  }
  return departmentCounts(list).map(({ name }) => ({
    key: name,
    label: name,
    tasks: list.filter((t) => ((t.department || '').trim() || '부서 미정') === name),
  }));
}

/** 페이지 맨 위 '마지막 갱신'. 과제가 없으면 null. */
export function latestUpdate(tasks) {
  const t = Math.max(0, ...(tasks || []).map(lastActivity));
  return t > 0 ? new Date(t) : null;
}

/** 'YYYY-MM-DD HH:mm' (지역 시간). */
export function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 쓴 사람 표시: '홍길동 책임 (선장설계)'. 이름이 없으면 사번. */
export function authorLabel(note) {
  const name = [note?.author_name || note?.author_id || '알 수 없음', note?.author_position].filter(Boolean).join(' ');
  return note?.author_department ? `${name} (${note.author_department})` : name;
}

/** 서버로 보낼 과제 본문. 빈 칸은 빈 문자열로 보내 서버가 지우게 한다(PATCH 에서 '안 보냄'과 구분). */
export function taskPayload(form) {
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    title: text(form.title),
    department: text(form.department),
    requester: text(form.requester),
    owner: text(form.owner),
    status: STATUS_ORDER.includes(form.status) ? form.status : 'reviewing',
    important: !!form.important,
    summary: text(form.summary),
    next_step: text(form.next_step),
    start_date: text(form.start_date),
    due_date: text(form.due_date),
    source: text(form.source),
  };
}

/** 서버로 보낼 항목 본문. */
export function itemPayload(form) {
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    title: text(form.title),
    assignee: text(form.assignee),
    status: ITEM_STATUS_ORDER.includes(form.status) ? form.status : 'todo',
    start_date: text(form.start_date),
    due_date: text(form.due_date),
    note: text(form.note),
    important: !!form.important,
  };
}

export const EMPTY_ITEM_FORM = { title: '', assignee: '', status: 'todo', start_date: '', due_date: '', note: '', important: false };

export function formFromItem(item) {
  const form = { ...EMPTY_ITEM_FORM };
  for (const key of Object.keys(form)) {
    if (item?.[key] !== undefined && item?.[key] !== null) form[key] = item[key];
  }
  return form;
}

/** 보드에서 끝난 항목을 보여 주는 기간(Team Planner 와 같은 최근 2주). */
export const BOARD_DONE_DAYS = 14;

/**
 * 보드에 올릴 카드: 모든 과제의 항목을 펼쳐 { item, task } 로. 끝난 지 2주 넘은 완료 항목은 뺀다.
 * assignee 를 주면 그 담당 것만('담당 미정'도 이름처럼 쓴다).
 */
export function boardEntries(tasks, now = new Date(), assignee = '') {
  const cutoff = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - BOARD_DONE_DAYS));
  const out = [];
  for (const task of tasks || []) {
    for (const item of task.items || []) {
      if (assignee && assigneeOf(item) !== assignee) continue;
      if (item.status === 'done' && (item.done_at || item.due_date || '').slice(0, 10) < cutoff) continue;
      out.push({ item, task });
    }
  }
  return out;
}

/** 보드 한 칸의 카드 순서: 예정과 진행은 중요, 마감 빠른 순. 완료는 최근에 끝난 순. */
export function boardColumn(entries, status, assignee = '') {
  const list = entries.filter((e) => e.item.status === status && (!assignee || assigneeOf(e.item) === assignee));
  if (status === 'done') {
    return list.sort((a, b) => (b.item.done_at || '').localeCompare(a.item.done_at || '') || b.item.id - a.item.id);
  }
  return list.sort((a, b) => Number(!!b.item.important) - Number(!!a.item.important)
    || (a.item.due_date || '').localeCompare(b.item.due_date || '') || a.item.id - b.item.id);
}

/** 담당 이름 목록(가나다순, '담당 미정'은 맨 뒤). 보드의 담당별 줄과 타임라인의 담당 보기에 쓴다. */
export function assigneeLanes(tasks) {
  const names = new Set();
  let none = false;
  for (const t of tasks || []) for (const i of t.items || []) {
    const n = assigneeOf(i);
    if (n === NO_ASSIGNEE) none = true; else names.add(n);
  }
  const out = [...names].sort((a, b) => a.localeCompare(b, 'ko'));
  if (none) out.push(NO_ASSIGNEE);
  return out;
}

/** 끌어 옮긴 뒤 '되돌리기'에 쓸 값: patch 가 바꾼 칸의 이전 값(없던 값은 빈 문자열로 보내 서버가 지우게). */
export function undoPatch(item, patch) {
  const out = {};
  for (const key of Object.keys(patch)) out[key] = item[key] ?? '';
  // 끝난 항목으로 되돌릴 때는 원래 끝난 시각도 함께(안 보내면 서버가 지금 시각을 써서 '최근 완료' 맨 위로 올라온다).
  if ('status' in patch && item.status === 'done' && item.done_at) out.done_at = item.done_at;
  return out;
}

/** 빠른 추가의 기본 마감: 이번 주 금요일(이미 지났으면 다음 주 금요일). */
export function defaultItemDue(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (5 - d.getDay() + 7) % 7;      // 금요일 = 5, 오늘이 금요일이면 오늘
  d.setDate(d.getDate() + add);
  return localDay(d);
}

/**
 * 수정 폼에서 바뀐 칸만 고른다. 폼을 연 뒤 다른 관리자가 고친 칸을 내 저장이 옛 값으로 되돌리지 않게 하려는 것이다.
 * before, after 는 모두 taskPayload 결과.
 */
export function changedFields(before, after) {
  const out = {};
  for (const key of Object.keys(after)) {
    if (after[key] !== before[key]) out[key] = after[key];
  }
  return out;
}

export const EMPTY_TASK_FORM = {
  title: '', department: '', requester: '', owner: '', status: 'reviewing',
  important: false, summary: '', next_step: '', start_date: '', due_date: '', source: '',
};

export function formFromTask(task) {
  const form = { ...EMPTY_TASK_FORM };
  for (const key of Object.keys(form)) {
    if (task?.[key] !== undefined && task?.[key] !== null) form[key] = task[key];
  }
  return form;
}
