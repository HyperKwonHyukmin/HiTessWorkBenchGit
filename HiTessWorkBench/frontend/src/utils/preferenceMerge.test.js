import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PREFERENCE_KEYS,
  DEFAULT_PREFS,
  defaultPrefs,
  filterWhitelist,
  isEmptyValue,
  mergeServerAndLocal,
  normalizeFavorites,
  normalizeRecentApps,
  normalizeLandingMenu,
  normalizeNotifications,
  effectivePrefs,
} from './preferenceMerge.js';

test('화이트리스트 키 4개(순서 고정)', () => {
  assert.deepEqual([...PREFERENCE_KEYS],
    ['favorites', 'recent_apps', 'notifications', 'landing_menu']);
});

test('defaultPrefs 는 항상 새 객체', () => {
  const a = defaultPrefs();
  const b = defaultPrefs();
  a.favorites.push('X');
  assert.deepEqual(b.favorites, []);
  assert.deepEqual(a.notifications, DEFAULT_PREFS.notifications);
});

test('filterWhitelist 는 화이트리스트 밖을 지운다', () => {
  const { accepted, ignored } = filterWhitelist({
    favorites: ['A'], dark_mode: true, notifications: { desktop_toast: false }, x: 1,
  });
  assert.deepEqual(accepted, {
    favorites: ['A'], notifications: { desktop_toast: false },
  });
  assert.deepEqual(ignored.sort(), ['dark_mode', 'x']);
});

test('normalizeFavorites — trim / dedupe / cap 50', () => {
  assert.deepEqual(normalizeFavorites(['A ', ' B', 'A', '']), ['A', 'B']);
  const many = Array.from({ length: 55 }, (_, i) => `F${i}`);
  assert.equal(normalizeFavorites(many).length, 50);
  assert.deepEqual(normalizeFavorites('not a list'), []);
});

test('normalizeRecentApps — menu 유일 · 최신순 · 8개', () => {
  const rows = [
    { menu: 'A', at: 100 },
    { menu: 'A', at: 500 },
    { menu: 'B', at: 200 },
    { menu: '  ', at: 999 },
  ];
  const got = normalizeRecentApps(rows);
  assert.deepEqual(got.map(r => r.menu), ['A', 'B']);
  assert.equal(got[0].at, 500);
  const many = Array.from({ length: 20 }, (_, i) => ({ menu: `M${i}`, at: i }));
  assert.equal(normalizeRecentApps(many).length, 8);
});

test('normalizeNotifications 는 잘못된 값을 기본값으로 흡수', () => {
  assert.deepEqual(
    normalizeNotifications({ muted_kinds: ['job.completed', 'unknown'], desktop_toast: 'yes' }),
    { muted_kinds: ['job.completed'], desktop_toast: true }
  );
});

test('normalizeLandingMenu', () => {
  assert.equal(normalizeLandingMenu(' My Projects '), 'My Projects');
  assert.equal(normalizeLandingMenu(''), null);
  assert.equal(normalizeLandingMenu(null), null);
  assert.equal(normalizeLandingMenu('M'.repeat(201)), null);
});

test('effectivePrefs — 저장값 위에 기본값을 채워 4키를 모두 갖는다', () => {
  const eff = effectivePrefs({ favorites: ['A', 'A', 'B '], landing_menu: 'Dashboard' });
  assert.deepEqual(eff.favorites, ['A', 'B']);
  assert.deepEqual(eff.recent_apps, []);
  assert.deepEqual(eff.notifications, { muted_kinds: [], desktop_toast: true });
  assert.equal(eff.landing_menu, 'Dashboard');
});

test('isEmptyValue — 서버 시드 판정용', () => {
  assert.equal(isEmptyValue('favorites', []), true);
  assert.equal(isEmptyValue('favorites', ['A']), false);
  assert.equal(isEmptyValue('recent_apps', []), true);
  assert.equal(isEmptyValue('notifications', { muted_kinds: [], desktop_toast: true }), true);
  assert.equal(isEmptyValue('notifications', { muted_kinds: ['job.failed'], desktop_toast: true }), false);
  assert.equal(isEmptyValue('landing_menu', null), true);
  assert.equal(isEmptyValue('landing_menu', ''), true);
  assert.equal(isEmptyValue('landing_menu', 'Dashboard'), false);
});

test('mergeServerAndLocal — 서버 값이 비어 있지 않으면 서버 우선', () => {
  const server = { favorites: ['S1', 'S2'], notifications: { muted_kinds: [], desktop_toast: false } };
  const local  = { favorites: ['L1'],       notifications: { muted_kinds: ['job.failed'], desktop_toast: true },
                   recent_apps: [{ menu: 'A', label: 'A', at: 10 }] };
  const { merged, seed } = mergeServerAndLocal(server, local);
  // favorites: 서버가 채워져 있으므로 서버 우선. seed 에서 빠진다.
  assert.deepEqual(merged.favorites, ['S1', 'S2']);
  assert.equal(seed.favorites, undefined);
  // notifications: 서버가 채워짐(desktop_toast:false 는 기본값과 달라 '비어 있지 않음').
  assert.equal(merged.notifications.desktop_toast, false);
  assert.equal(seed.notifications, undefined);
  // recent_apps: 서버 비어 있음 → 로컬 사용 + seed 에 실림.
  assert.deepEqual(merged.recent_apps, normalizeRecentApps(local.recent_apps));
  assert.deepEqual(seed.recent_apps, normalizeRecentApps(local.recent_apps));
});

test('mergeServerAndLocal — 로컬도 비면 seed 는 없다', () => {
  const { merged, seed } = mergeServerAndLocal({}, {});
  assert.deepEqual(merged, defaultPrefs());
  assert.deepEqual(seed, {});
});
