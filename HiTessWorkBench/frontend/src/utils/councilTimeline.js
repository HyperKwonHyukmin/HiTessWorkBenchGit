// 구조해석 자동화 협의체 과제 현황 — 타임라인 계산(날짜, 공휴일, 줄 나누기, 칸 위치).
// Team Planner(E:\Apps\team-planner shared/domain.ts, src/views/Timeline.tsx)의 계산을 옮긴 것이다.
// 날짜는 모두 'YYYY-MM-DD' 문자열, 기간의 끝은 그날을 포함한다.

const DAY = 86_400_000;
export const toDays = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / DAY);
export const fromDays = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (d, n) => fromDays(toDays(d) + n);
export const diffDays = (a, b) => toDays(b) - toDays(a);
/** 0=일 … 6=토 */
export const weekday = (d) => (toDays(d) + 4) % 7;
export const isWeekend = (d) => weekday(d) === 0 || weekday(d) === 6;
export const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
export const shortDate = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : '');

export function eachDay(start, end) {
  const out = [];
  for (let i = toDays(start), e = toDays(end); i <= e; i++) out.push(fromDays(i));
  return out;
}

/** 확대 단계: 보이는 날 수, 하루 칸의 최소 폭(px), 이전과 다음 단추가 옮기는 날 수. */
export const ZOOM = {
  week: { label: '2주', span: 14, width: 76, step: 7 },
  month: { label: '6주', span: 42, width: 34, step: 28 },
  quarter: { label: '분기', span: 91, width: 15, step: 91 },
};
export const ZOOM_ORDER = ['week', 'month', 'quarter'];

// 대한민국 공휴일(대체공휴일 포함). 정부 발표가 바뀌면 여기를 고친다.
// Team Planner 의 표에서 시작해 2026-11-25 에 고쳤다: 노동절(5/1)과 제헌절(7/17)이 2026년부터 공휴일이라 더했고,
// 2026-09-28 은 뺐다(추석 연휴 9/24 ~ 26 이 일요일과 겹치지 않아 대체공휴일이 아니다).
// 2027년 노동절, 제헌절의 대체공휴일 여부는 확인하지 못해 넣지 않았다.
export const KR_HOLIDAYS = {
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일(삼일절)',
  '2026-05-01': '노동절',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일(부처님오신날)',
  '2026-06-03': '전국동시지방선거',
  '2026-06-06': '현충일',
  '2026-07-17': '제헌절',
  '2026-08-15': '광복절', '2026-08-17': '대체공휴일(광복절)',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절', '2026-10-05': '대체공휴일(개천절)',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴', '2027-02-09': '대체공휴일(설날)',
  '2027-03-01': '삼일절',
  '2027-05-01': '노동절',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-07-17': '제헌절',
  '2027-08-15': '광복절', '2027-08-16': '대체공휴일(광복절)',
  '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절', '2027-10-04': '대체공휴일(개천절)',
  '2027-10-09': '한글날', '2027-10-11': '대체공휴일(한글날)',
  '2027-12-25': '성탄절', '2027-12-27': '대체공휴일(성탄절)',
};

/** 보이는 날 목록. 주말을 숨기면 평일만. */
export function visibleDays(start, zoom, hideWeekends = false) {
  const all = eachDay(start, addDays(start, (ZOOM[zoom] || ZOOM.month).span - 1));
  return hideWeekends ? all.filter((d) => !isWeekend(d)) : all;
}

/** 머리글의 달 묶음: [{ label: '2026. 11월', n: 칸 수 }] */
export function monthSpans(days) {
  const out = [];
  for (const d of days) {
    const label = `${d.slice(0, 4)}. ${Number(d.slice(5, 7))}월`;
    if (out.length && out[out.length - 1].label === label) out[out.length - 1].n += 1;
    else out.push({ label, n: 1 });
  }
  return out;
}

/** 날짜 → 보이는 칸. 숨긴 날(주말)이면 바로 앞의 보이는 날에 붙인다. 보이는 기간 밖이면 -1. */
export function snapCol(days, date, rangeEnd = days[days.length - 1]) {
  // rangeEnd = 숨긴 날까지 포함한 진짜 끝(주말을 숨기면 마지막 보이는 날은 금요일이지만 기간은 일요일까지다).
  if (!days.length || !date || date < days[0] || date > rangeEnd) return -1;
  let j = days.length - 1;
  while (j >= 0 && days[j] > date) j--;
  return j;
}

/**
 * 기간 → 보이는 칸 [i, j]. 범위 밖이면 null.
 * 주말을 숨겼을 때 주말에서 시작하거나 끝나는 막대는 가까운 평일로 붙고,
 * 통째로 숨긴 날 안에 든 것(토요일 하루, 토 ~ 일)은 snapPoint 일 때 앞 금요일에 붙여 사라지지 않게 한다.
 */
export function spanCols(days, start, end, snapPoint = false, rangeEnd = days[days.length - 1]) {
  if (!days.length) return null;
  const first = days[0];
  if (end < first || start > rangeEnd) return null;
  let i = 0;
  while (i < days.length && days[i] < start) i++;
  let j = days.length - 1;
  while (j >= 0 && days[j] > end) j--;
  if (i <= j) return [i, j];
  return snapPoint && j >= 0 ? [j, j] : null;
}

/** 겹치는 막대를 줄(lane)로 나눈다. 반환: lane(Map id → 줄 번호), count(줄 수, 최소 1). */
export function stackLanes(items) {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const laneEnds = [];
  const lane = new Map();
  for (const it of sorted) {
    let i = laneEnds.findIndex((e) => e < it.start);
    if (i < 0) i = laneEnds.length;
    laneEnds[i] = it.end;
    lane.set(it.id, i);
  }
  return { lane, count: Math.max(1, laneEnds.length) };
}

/**
 * 한 줄의 막대를 화면 칸 기준으로 놓는다(주말을 숨기면 날짜와 칸이 달라 날짜로 줄을 나누면 겹친다).
 * 점 항목(시작일 없음)은 이름이 옆으로 펼쳐지므로 pointCols 칸만큼 자리를 잡는다. 오른쪽 끝에 닿으면 왼쪽으로 펼친다(flip).
 * 반환: { placed: [{ ...bar, i, j, flip, lane }], count }
 */
export function layoutBars(bars, days, rangeEnd, pointCols) {
  const pad = (n) => String(n + 1000).padStart(6, '0');
  const placed = [];
  for (const b of bars) {
    const sp = spanCols(days, b.start, b.end, true, rangeEnd);
    if (!sp) continue;
    const [i, j] = sp;
    const flip = !!b.point && i + pointCols >= days.length;
    const from = b.point && flip ? i - pointCols : i;
    const to = b.point && !flip ? i + pointCols : j;
    placed.push({ ...b, i, j, flip, occupy: { id: b.id, start: pad(from), end: pad(to) } });
  }
  const { lane, count } = stackLanes(placed.map((p) => p.occupy));
  return { placed: placed.map(({ occupy, ...p }) => ({ ...p, lane: lane.get(p.id) || 0 })), count };
}

// 의뢰 부서 색: 바다와 선체 톤(Team Planner 의 과제 색). 이름으로 정해 과제 수가 바뀌어도 색이 그대로다.
export const DEPT_PALETTE = ['#003087', '#00707A', '#9A5B00', '#2D6FB0', '#7A4A2E', '#1F5F6B', '#6E5A48', '#3F5C73', '#8A6D1F', '#56708F'];
export function deptColor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return DEPT_PALETTE[h % DEPT_PALETTE.length];
}

/**
 * 과제 한 줄에 그릴 것을 고른다.
 * - bars: 보이는 기간에 걸친 항목(시작일이 없으면 마감일 하루짜리 점). showDone 이 꺼져 있으면 완료 항목은 뺀다.
 * - lateBefore: 보이는 기간보다 앞에 마감이 지난 미완료 항목(막대가 안 보이므로 줄 머리에 수로 알린다).
 * - milestones: 보이는 기간 안의 마일스톤.
 */
export function rowContent(task, first, last, today, showDone = false) {
  const items = (task.items || []).filter((i) => showDone || i.status !== 'done');
  const bars = [];
  const lateBefore = [];
  for (const it of items) {
    const start = it.start_date || it.due_date;
    const end = it.due_date;
    if (!end) continue;
    if (start <= last && end >= first) bars.push({ id: String(it.id), start, end, point: !it.start_date, item: it });
    else if (it.status !== 'done' && end < today && end < first) lateBefore.push(it);
  }
  const milestones = (task.milestones || []).filter((m) => m.date >= first && m.date <= last);
  return { bars, lateBefore, milestones };
}

/** 보이는 기간 표시: '2026. 11. 23 ~ 12. 6' */
export function rangeLabel(first, last) {
  const f = `${first.slice(0, 4)}. ${Number(first.slice(5, 7))}. ${Number(first.slice(8))}`;
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const l = `${sameYear ? '' : last.slice(0, 4) + '. '}${Number(last.slice(5, 7))}. ${Number(last.slice(8))}`;
  return `${f} ~ ${l}`;
}
