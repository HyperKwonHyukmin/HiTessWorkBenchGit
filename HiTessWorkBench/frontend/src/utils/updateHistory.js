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

/** 달·찾기 글자·분류·확인 남음 거르기. month = 'YYYY-MM'(빈 값이면 전체 기간). */
export function matchesUpdate(it, { month = '', kind = '', q = '', pending = false } = {}) {
  if (month && (it.date || '').slice(0, 7) !== month) return false;
  if (kind && it.kind !== kind) return false;
  if (pending && !it.status) return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [it.title, it.summary, it.version ? `v${it.version}` : '', it.status, it.screen, it.date, it.kind,
    ...(it.points || [])].join(' ').toLowerCase().includes(needle);
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
