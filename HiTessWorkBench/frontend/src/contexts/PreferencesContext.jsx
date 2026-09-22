/**
 * @fileoverview 사용자 환경설정 컨텍스트(스펙 §5.1).
 *
 *  - 로그인 상태에서만 서버와 통신. 로그아웃 시 사번별 캐시는 남기되 서버 통신은 멈춘다.
 *  - 로컬 캐시 키 = `hitess_prefs:<employee_id>`(사번별). 옛 `favorites` / `hitess_recent_apps`
 *    는 사번별 캐시가 없을 때 1회 마이그레이션 시드로 읽고 `hitess_prefs_legacy_migrated=1` 를 남긴다.
 *    공용 PC 에서 앞 사람 값이 다른 사번의 서버에 시드되는 사고를 막는다(spec D4).
 *  - hydration 카운터: 서버 GET 이 끝날 때마다 +1. 소비자(DashboardContext / RecentActivityContext)는
 *    이 값이 바뀔 때만 서버 값을 자기 state 에 반영해 자기 변경의 메아리 루프를 끊는다.
 *  - updatePrefs(partial): 화이트리스트만 걸러 (a) prefs 즉시 갱신 (b) 사번별 캐시 즉시 저장
 *    (c) 로그인 상태면 pending 에 합쳐 500ms 디바운스로 PUT. 실패 시 30초 재시도.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useAuth } from './AuthContext';
import { getPreferences, putPreferences } from '../api/preferences';
import { POLLING_POLICY } from '../hooks/pollingPolicy';
import {
  defaultPrefs,
  effectivePrefs,
  filterWhitelist,
  mergeServerAndLocal,
} from '../utils/preferenceMerge';

const PreferencesContext = createContext(null);

const LEGACY_FAVORITES_KEY = 'favorites';
const LEGACY_RECENT_APPS_KEY = 'hitess_recent_apps';
const LEGACY_MIGRATED_FLAG = 'hitess_prefs_legacy_migrated';

function cacheKeyFor(employeeId) {
  return `hitess_prefs:${employeeId}`;
}

function readSessionCache(employeeId) {
  if (!employeeId) return null;
  try {
    const raw = localStorage.getItem(cacheKeyFor(employeeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeSessionCache(employeeId, prefs) {
  if (!employeeId) return;
  try {
    localStorage.setItem(cacheKeyFor(employeeId), JSON.stringify(prefs));
  } catch { /* 저장소 접근이 막힌 환경 무시 */ }
}

function readLegacySeed() {
  const seed = {};
  try {
    const rawFav = localStorage.getItem(LEGACY_FAVORITES_KEY);
    if (rawFav) {
      const parsed = JSON.parse(rawFav);
      if (Array.isArray(parsed)) seed.favorites = parsed.filter(x => typeof x === 'string');
    }
  } catch { /* ignore */ }
  try {
    const rawRecent = localStorage.getItem(LEGACY_RECENT_APPS_KEY);
    if (rawRecent) {
      const parsed = JSON.parse(rawRecent);
      if (Array.isArray(parsed)) seed.recent_apps = parsed.filter(x => x?.menu);
    }
  } catch { /* ignore */ }
  return seed;
}

function markLegacyMigrated() {
  try { localStorage.setItem(LEGACY_MIGRATED_FLAG, '1'); } catch { /* ignore */ }
}

function isLegacyMigrated() {
  try { return localStorage.getItem(LEGACY_MIGRATED_FLAG) === '1'; } catch { return false; }
}

export function PreferencesProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const employeeId = user?.employee_id || null;

  // 4키를 모두 갖는 실효값. 초기값은 사번별 캐시 + legacy 시드 + 기본값.
  const [prefs, setPrefs] = useState(() => {
    const cached = employeeId ? readSessionCache(employeeId) : null;
    if (cached) return effectivePrefs(cached);
    if (!isLegacyMigrated()) return effectivePrefs(readLegacySeed());
    return defaultPrefs();
  });
  const [status, setStatus] = useState('idle');           // idle | loading | ready | offline
  const [hydration, setHydration] = useState(0);          // 서버 GET 성공 시 +1

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const pendingRef = useRef({});                          // 다음 PUT 에 포함할 payload
  const debounceTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const isMountedRef = useRef(false);

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  const persistCache = useCallback((next) => {
    if (!employeeId) return;
    writeSessionCache(employeeId, next);
  }, [employeeId]);

  const flushPending = useCallback(async () => {
    if (!employeeId) return;
    const payload = pendingRef.current;
    if (!payload || Object.keys(payload).length === 0) return;
    const { accepted } = filterWhitelist(payload);
    if (Object.keys(accepted).length === 0) {
      pendingRef.current = {};
      return;
    }
    try {
      const res = await putPreferences(accepted);
      if (!isMountedRef.current) return;
      const nextPrefs = effectivePrefs(res?.data?.prefs);
      setPrefs(nextPrefs);
      persistCache(nextPrefs);
      setStatus('ready');
      pendingRef.current = {};
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    } catch {
      // 실패 시 pending 유지, 다음 재시도 예약.
      if (!isMountedRef.current) return;
      setStatus('offline');
      if (!retryTimerRef.current) {
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          flushPending();
        }, POLLING_POLICY.preferencesRetryMs);
      }
    }
  }, [employeeId, persistCache]);

  const scheduleFlush = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      flushPending();
    }, POLLING_POLICY.preferencesDebounceMs);
  }, [flushPending]);

  const updatePrefs = useCallback((partial) => {
    const { accepted, ignored } = filterWhitelist(partial || {});
    if (Object.keys(accepted).length === 0) return { ignored };
    // (1) prefs 즉시 갱신 — 지연 없이 화면에 반영
    const nextPrefs = effectivePrefs({ ...prefsRef.current, ...accepted });
    setPrefs(nextPrefs);
    persistCache(nextPrefs);
    if (isAuthenticated && employeeId) {
      // (2) pending 병합 + 디바운스 예약
      pendingRef.current = { ...pendingRef.current, ...accepted };
      scheduleFlush();
    }
    return { ignored };
  }, [employeeId, isAuthenticated, persistCache, scheduleFlush]);

  // 로그인 하이드레이션 — 사번이 바뀌거나 로그인 상태가 바뀔 때 1회.
  useEffect(() => {
    if (!isAuthenticated || !employeeId) {
      setStatus('idle');
      return undefined;
    }
    let cancelled = false;
    let offlineSeeded = false;   // 오프라인 시드·hydration 신호는 사번당 1회만.
    setStatus('loading');

    const hydrate = async () => {
      try {
        const res = await getPreferences();
        if (cancelled) return;
        const server = res?.data?.prefs ?? {};
        const cached = readSessionCache(employeeId);
        const local = cached || readLegacySeed();
        const { merged, seed } = mergeServerAndLocal(server, local);

        setPrefs(merged);
        persistCache(merged);
        setStatus('ready');
        setHydration(h => h + 1);

        if (Object.keys(seed).length > 0) {
          pendingRef.current = { ...pendingRef.current, ...seed };
          scheduleFlush();
        }
        markLegacyMigrated();
      } catch {
        if (cancelled) return;
        setStatus('offline');
        if (!offlineSeeded) {
          offlineSeeded = true;
          // ⚠ 서버를 못 읽었을 때 prefs 가 기본값(빈 배열)이면 소비자가 그 빈 값을 '서버 진실'로
          //   받아 localStorage 의 즐겨찾기·최근 앱까지 지운다. 사번별 캐시(없으면 legacy)로 먼저 되살린다.
          //   Provider 마운트 시점에 employeeId 가 아직 null 이면 useState 초기화가 캐시를 못 읽는다.
          const cached = readSessionCache(employeeId);
          const local = cached || (isLegacyMigrated() ? null : readLegacySeed());
          if (local) setPrefs(effectivePrefs(local));
          // 로컬 값으로도 소비자가 초기화되도록 신호는 준다(재시도마다 반복하면 사용자의 최신 변경을 되돌린다).
          setHydration(h => h + 1);
        }
        // 30초 뒤 재시도
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          hydrate();
        }, POLLING_POLICY.preferencesRetryMs);
      }
    };
    hydrate();
    return () => {
      cancelled = true;
      if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    };
  }, [employeeId, isAuthenticated, persistCache, scheduleFlush]);

  // 창 unload 직전 pending 을 한 번 더 시도.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (Object.keys(pendingRef.current).length > 0) {
        // navigator.sendBeacon 은 axios 헤더가 붙지 않아 인증이 안 된다 — best-effort 로만 시도.
        try { flushPending(); } catch { /* ignore */ }
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushPending]);

  const value = useMemo(() => ({
    prefs, status, hydration, updatePrefs,
  }), [prefs, status, hydration, updatePrefs]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used within <PreferencesProvider>');
  }
  return ctx;
}
