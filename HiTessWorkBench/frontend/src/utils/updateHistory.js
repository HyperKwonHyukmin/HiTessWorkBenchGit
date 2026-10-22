/**
 * 업데이트 이력(관리자 Update History)·솔버별 개발 이력(ChangelogModal) 공용 규칙.
 * - '새 항목' = 이 PC 에서 지난번에 본 맨 위 항목보다 앞(위)에 있는 것. 처음 보는 PC 는 모두 본 것으로 친다.
 * - 열쇠는 날짜|버전|제목 — 같은 날 여러 번 배포해도 구분된다.
 */

export const UPDATE_KINDS = ['기능', '개선', '수정', '정리', '운영'];

export const itemKey = (it) => [it?.date || '', it?.version || '', it?.title || ''].join('|');

export function readSeen(storageKey) {
  try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
}

export function writeSeen(storageKey, value) {
  try { localStorage.setItem(storageKey, value); } catch { /* 저장소가 막혀도 화면은 그대로 */ }
}

/** 새 항목의 인덱스 집합. seen 항목이 목록에서 빠졌으면 날짜로 판단한다. */
export function newIndexes(items, seen, keyFn = itemKey) {
  const fresh = new Set();
  if (!seen || !Array.isArray(items)) return fresh;
  const at = items.map(keyFn).indexOf(seen);
  const seenDate = seen.split('|')[0];
  items.forEach((it, i) => {
    if (at >= 0 ? i < at : (it?.date || '') > seenDate) fresh.add(i);
  });
  return fresh;
}

/** 최근 기간 단추(LogBook 46 과 같은 구성). 최근 7일 = 오늘 포함 7일. */
export const RECENT_PERIODS = {
  d7: { days: 7, label: '최근 7일' },
  d30: { days: 30, label: '최근 30일' },
};

const pad2 = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * 기간 = ''(전체) | 'd7'·'d30'(최근, 이 PC 날짜 기준) | 'YYYY'(해) | 'YYYY-MM'(달).
 * today 는 테스트용(기본 지금).
 */
export function inPeriod(it, period, today = new Date()) {
  if (!period) return true;
  const date = it?.date || '';
  const recent = RECENT_PERIODS[period];
  if (recent) {
    const from = new Date(today);
    from.setDate(from.getDate() - (recent.days - 1));
    return date >= localDate(from) && date <= localDate(today);
  }
  return period.length === 4 ? date.slice(0, 4) === period : date.slice(0, 7) === period;
}

/** 기간·찾기 글자·분류 필터. 찾기는 제목·설명·버전·화면·날짜·분류·요청자·세부 줄. */
export function matchesUpdate(it, { period = '', today, kind = '', q = '' } = {}) {
  if (!inPeriod(it, period, today)) return false;
  if (kind && it.kind !== kind) return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [it.title, it.summary, it.version ? `v${it.version}` : '', it.screen, it.date, it.kind,
    it.requester, ...(it.points || [])].join(' ').toLowerCase().includes(needle);
}

export function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-');
  return y && m ? `${y}년 ${Number(m)}월` : '날짜 없음';
}

/** 기록이 있는 달 목록(최근 달 먼저) — [{ month:'2026-10', label:'2026년 10월', count }]. */
export function listMonths(items) {
  const counts = new Map();
  (items || []).forEach((it) => {
    const month = (it?.date || '').slice(0, 7);
    if (month) counts.set(month, (counts.get(month) || 0) + 1);
  });
  return [...counts.keys()].sort().reverse().map((month) => ({ month, label: monthLabel(month), count: counts.get(month) }));
}

/** 기록이 있는 해(최근 해 먼저) — ['2026', '2025']. */
export function listYears(items) {
  return [...new Set(listMonths(items).map((m) => m.month.slice(0, 4)))];
}

/** 둘째 단에 보일 해 — 해·달을 골랐으면 그 해, 아니면 마지막으로 본 해(없으면 가장 최근 해). */
export function viewYearFor(period, lastYear, years) {
  if (period && !RECENT_PERIODS[period]) return period.slice(0, 4);
  return years.includes(lastYear) ? lastYear : (years[0] || '');
}

/** [{ month:'2026-10', label:'2026년 10월', rows:[{ it, index }] }] — 들어온 순서(최신 먼저)를 유지한다. */
export function groupByMonth(rows) {
  const groups = [];
  const byMonth = new Map();
  rows.forEach((row) => {
    const month = (row.it.date || '').slice(0, 7);
    if (!byMonth.has(month)) {
      const group = { month, label: monthLabel(month), rows: [] };
      byMonth.set(month, group);
      groups.push(group);
    }
    byMonth.get(month).rows.push(row);
  });
  return groups;
}

/** 찾은 글자를 강조할 조각 — [{ text, hit }]. */
export function splitHits(text, q) {
  const source = String(text ?? '');
  const needle = q.trim().toLowerCase();
  if (!needle) return [{ text: source, hit: false }];
  const parts = [];
  const low = source.toLowerCase();
  let at = 0;
  let i;
  while ((i = low.indexOf(needle, at)) !== -1) {
    if (i > at) parts.push({ text: source.slice(at, i), hit: false });
    parts.push({ text: source.slice(i, i + needle.length), hit: true });
    at = i + needle.length;
  }
  if (at < source.length) parts.push({ text: source.slice(at), hit: false });
  return parts;
}
