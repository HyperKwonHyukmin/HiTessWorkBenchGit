// 구조해석 자동화 협의체 과제 현황 — 화면 규칙(상태, 지연, 멈춤, 거르기, 묶기). 서버는 routers/council.py.
// 계획 docs/plans/2026-11-25-automation-council-tasks-plan.md

export const STATUS_ORDER = ['reviewing', 'developing', 'piloting', 'done', 'hold'];

/** 상태 이름표와 색. 색은 상태에만 쓴다(빨강은 지연, 황토는 중요와 멈춤에만). */
export const STATUS_META = {
  reviewing: { label: '검토 중', pill: 'bg-slate-100 text-slate-700 ring-slate-300' },
  developing: { label: '개발 중', pill: 'bg-blue-50 text-blue-800 ring-blue-200' },
  piloting: { label: '시험 운영', pill: 'bg-teal-50 text-teal-800 ring-teal-200' },
  done: { label: '완료', pill: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  hold: { label: '보류', pill: 'bg-stone-100 text-stone-600 ring-stone-300' },
};

export const NOTE_KIND_META = {
  comment: { label: '의견', badge: 'bg-blue-50 text-blue-800' },
  progress: { label: '진행 기록', badge: 'bg-emerald-50 text-emerald-800' },
  status: { label: '상태 변경', badge: 'bg-slate-100 text-slate-600' },
};

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

/** 마지막으로 무언가 바뀐 시각(과제 수정, 기록 추가 중 늦은 것). */
export function lastActivity(task) {
  const noteTimes = (task?.notes || []).map((n) => toTime(n.updated_at || n.created_at));
  return Math.max(toTime(task?.updated_at), toTime(task?.created_at), ...noteTimes, 0);
}

export function isStale(task, now = new Date()) {
  if (!task || isClosed(task.status)) return false;
  const last = lastActivity(task);
  return last > 0 && now.getTime() - last >= STALE_DAYS * DAY_MS;
}

export function noteCounts(task) {
  const counts = { comment: 0, progress: 0, status: 0 };
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
    if (dueInfo(t.due_date, t.status, now).late) late += 1;
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
    if (filter.status === 'late') { if (!dueInfo(t.due_date, t.status, now).late) return false; }
    else if (filter.status === 'stale') { if (!isStale(t, now)) return false; }
    else if (filter.status && t.status !== filter.status) return false;
    if (!q) return true;
    const hay = [t.title, t.department, t.requester, t.owner, t.summary, t.next_step, t.source,
      ...(t.notes || []).map((n) => n.body)].join('\n').toLowerCase();
    return hay.includes(q);
  });
}

/** 한 묶음 안의 순서: 끝난 과제는 아래, 그다음 중요, 지연, 목표일 빠른 순(미정은 뒤), 먼저 만든 순. */
export function compareTasks(a, b, now = new Date()) {
  const closed = Number(isClosed(a.status)) - Number(isClosed(b.status));
  if (closed) return closed;
  const imp = Number(!!b.important) - Number(!!a.important);
  if (imp) return imp;
  const late = Number(dueInfo(b.due_date, b.status, now).late) - Number(dueInfo(a.due_date, a.status, now).late);
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
    due_date: text(form.due_date),
    source: text(form.source),
  };
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
  important: false, summary: '', next_step: '', due_date: '', source: '',
};

export function formFromTask(task) {
  const form = { ...EMPTY_TASK_FORM };
  for (const key of Object.keys(form)) {
    if (task?.[key] !== undefined && task?.[key] !== null) form[key] = task[key];
  }
  return form;
}
