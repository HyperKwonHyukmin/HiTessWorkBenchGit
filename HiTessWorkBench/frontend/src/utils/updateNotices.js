// 업데이트 안내를 대시보드에 띄우는 규칙(2026-11-12). 순수 함수 — 테스트 updateNotices.test.js.

export const STRIP_WITHIN_DAYS = 30;   // 이 기간 안의 최신 안내만 대시보드 줄에 띄운다
export const NEW_WITHIN_DAYS = 14;     // 이 기간 안이고 이 PC 에서 안 연 안내 = NEW

const DAY_MS = 86400000;

function dayStart(dateText) {
  const t = Date.parse(`${dateText}T00:00:00`);
  return Number.isFinite(t) ? t : null;
}

/**
 * 대시보드 줄에 보일 안내와 NEW 수.
 * test=true 안내는 개발 화면(includeTest)에서만 — 시험용 내용이 운영 사용자 대시보드에 뜨지 않게.
 * @returns {{ entry: object|null, newCount: number }}
 */
export function pickStripEntry(entries, { now = Date.now(), seenIds = [], includeTest = false } = {}) {
  const seen = new Set(seenIds);
  const shown = (entries || []).filter(e => e && e.id && (includeTest || !e.test) && dayStart(e.date) !== null);
  const recent = shown.filter(e => now - dayStart(e.date) <= STRIP_WITHIN_DAYS * DAY_MS);
  const newCount = recent.filter(e => now - dayStart(e.date) <= NEW_WITHIN_DAYS * DAY_MS && !seen.has(e.id)).length;
  return { entry: recent[0] ?? null, newCount };
}

/** 이 PC 에서 연 안내 id 목록의 저장 키 — 사번별(같은 PC 를 여럿이 쓸 때). */
export function seenStorageKey(employeeId) {
  return `workbench:update-seen:${String(employeeId || 'anon').toUpperCase()}`;
}

/** 안내 페이지(iframe)가 보낸 기록 메시지인지 — 모양만 본다(출처 확인은 받는 쪽). */
export function readBeaconMessage(data) {
  if (!data || data.type !== 'hitess-update-beacon') return null;
  const p = data.payload;
  if (!p || typeof p.entry !== 'string' || (p.type !== 'view' && p.type !== 'measure')) return null;
  return p;
}
