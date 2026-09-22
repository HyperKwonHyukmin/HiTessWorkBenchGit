/**
 * 환경설정 — 부수효과 없는 정규화·병합·기본값 유틸.
 * 백엔드 `user_preferences_service.py` 의 규약을 그대로 지킨다(스펙 §4.2).
 * node --test 로 검증된다(src/utils/preferenceMerge.test.js).
 */

export const PREFERENCE_KEYS = Object.freeze(['favorites', 'recent_apps', 'notifications', 'landing_menu']);

const MAX_FAVORITES = 50;
const MAX_RECENT_APPS = 8;
const LANDING_MENU_MAX_LEN = 200;

// 프론트 폴백 어휘. constants/notificationKinds.js 가 이 목록과 같다.
const KNOWN_NOTIFICATION_KINDS = new Set([
  'job.completed', 'job.failed', 'job.cancelled',
  'retention.expired',
  'batch.completed', 'share.received',
  'feature_request.status_changed', 'notice.published',
]);

export const DEFAULT_PREFS = Object.freeze({
  favorites: Object.freeze([]),
  recent_apps: Object.freeze([]),
  notifications: Object.freeze({ muted_kinds: Object.freeze([]), desktop_toast: true }),
  landing_menu: null,
});

export function defaultPrefs() {
  return {
    favorites: [],
    recent_apps: [],
    notifications: { muted_kinds: [], desktop_toast: true },
    landing_menu: null,
  };
}

export function normalizeFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const v = item.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.slice(0, MAX_FAVORITES);
}

export function normalizeRecentApps(raw) {
  if (!Array.isArray(raw)) return [];
  const byMenu = new Map();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const menu = typeof item.menu === 'string' ? item.menu.trim() : '';
    if (!menu) continue;
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : menu;
    const mode = typeof item.mode === 'string' ? item.mode : '';
    const category = typeof item.category === 'string' ? item.category : '';
    const rawAt = Number(item.at);
    const at = Number.isFinite(rawAt) && rawAt >= 0 ? Math.floor(rawAt) : 0;
    const prev = byMenu.get(menu);
    if (!prev || at > prev.at) {
      byMenu.set(menu, { menu, label, mode, category, at });
    }
  }
  return [...byMenu.values()].sort((a, b) => b.at - a.at).slice(0, MAX_RECENT_APPS);
}

export function normalizeNotifications(raw) {
  const base = { muted_kinds: [], desktop_toast: true };
  if (!raw || typeof raw !== 'object') return base;
  if (Array.isArray(raw.muted_kinds)) {
    const seen = new Set();
    for (const k of raw.muted_kinds) {
      if (typeof k !== 'string') continue;
      if (!KNOWN_NOTIFICATION_KINDS.has(k)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      base.muted_kinds.push(k);
    }
    base.muted_kinds.sort();
  }
  if (typeof raw.desktop_toast === 'boolean') base.desktop_toast = raw.desktop_toast;
  return base;
}

export function normalizeLandingMenu(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  if (v.length > LANDING_MENU_MAX_LEN) return null;
  return v;
}

export function effectivePrefs(stored) {
  const out = defaultPrefs();
  if (!stored || typeof stored !== 'object') return out;
  out.favorites = normalizeFavorites(stored.favorites);
  out.recent_apps = normalizeRecentApps(stored.recent_apps);
  out.notifications = normalizeNotifications(stored.notifications);
  out.landing_menu = normalizeLandingMenu(stored.landing_menu);
  return out;
}

/** PUT 이 화이트리스트만 보내도록 걸러 낸다. accepted 는 원값 그대로(서버가 정규화). */
export function filterWhitelist(payload) {
  const accepted = {};
  const ignored = [];
  if (!payload || typeof payload !== 'object') return { accepted, ignored };
  for (const [k, v] of Object.entries(payload)) {
    if (PREFERENCE_KEYS.includes(k)) accepted[k] = v;
    else ignored.push(k);
  }
  return { accepted, ignored };
}

/** 서버 우선 병합의 '비어 있음' 판정(spec D2). */
export function isEmptyValue(key, value) {
  if (key === 'favorites' || key === 'recent_apps') {
    return !Array.isArray(value) || value.length === 0;
  }
  if (key === 'landing_menu') {
    return value == null || (typeof value === 'string' && value.trim() === '');
  }
  if (key === 'notifications') {
    const n = normalizeNotifications(value);
    return n.muted_kinds.length === 0 && n.desktop_toast === true;
  }
  return true;
}

/**
 * 로그인 시 한 번: 서버 값이 비어 있지 않으면 서버, 비어 있으면 로컬 → 그 키만 시드로 서버에 올린다.
 * @param {object} serverPrefs — GET 응답의 prefs (4키). null/undefined 안전.
 * @param {object} localPrefs  — 로컬 캐시(사번별). 4키가 없어도 됨.
 * @returns {{ merged: object, seed: object }}
 *   merged: 4키를 모두 갖는 실효값. seed: 서버로 올릴 부분 payload(비어 있으면 {}).
 */
export function mergeServerAndLocal(serverPrefs, localPrefs) {
  const server = effectivePrefs(serverPrefs || {});
  const local  = effectivePrefs(localPrefs  || {});
  const merged = defaultPrefs();
  const seed = {};
  for (const key of PREFERENCE_KEYS) {
    if (!isEmptyValue(key, server[key])) {
      merged[key] = server[key];
    } else if (!isEmptyValue(key, local[key])) {
      merged[key] = local[key];
      seed[key] = local[key];
    } else {
      merged[key] = defaultPrefs()[key];
    }
  }
  return { merged, seed };
}
