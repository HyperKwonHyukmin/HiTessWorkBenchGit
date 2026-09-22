import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react';
import { usePreferences } from './PreferencesContext';

const RecentActivityContext = createContext(null);
const RECENT_APPS_KEY = 'hitess_recent_apps';
const MAX_RECENT_APPS = 8;

function readRecentApps() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_APPS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item?.menu && item?.label) : [];
  } catch {
    return [];
  }
}

function writeRecentApps(items) {
  try {
    localStorage.setItem(RECENT_APPS_KEY, JSON.stringify(items.slice(0, MAX_RECENT_APPS)));
  } catch {
    // localStorage disabled; ignore
  }
}

export function RecentActivityProvider({ children }) {
  const { prefs: serverPrefs, hydration, updatePrefs } = usePreferences();
  const [recentApps, setRecentApps] = useState(() => readRecentApps());
  // 동기화는 effect 가 아니라 렌더 중에 한다 — effect 는 paint 뒤에 돌아서
  // 연속 방문(빠른 메뉴 이동)이 직전 기록을 놓친다.
  const recentRef = useRef(recentApps);
  recentRef.current = recentApps;

  // 서버 하이드레이션이 올 때마다 서버 값을 진실로 삼는다(로컬 캐시도 함께 갱신).
  useEffect(() => {
    if (hydration === 0) return;
    const next = Array.isArray(serverPrefs.recent_apps)
      ? serverPrefs.recent_apps.filter(item => item?.menu && item?.label).slice(0, MAX_RECENT_APPS)
      : [];
    setRecentApps(next);
    writeRecentApps(next);
  }, [hydration, serverPrefs.recent_apps]);

  const recordAppVisit = useCallback((menu, label = menu, meta = {}) => {
    if (!menu || !label) return;
    const nextItem = {
      menu,
      label,
      mode: meta.mode || '',
      category: meta.category || '',
      at: Date.now(),
    };
    const next = [nextItem, ...recentRef.current.filter(item => item.menu !== menu)].slice(0, MAX_RECENT_APPS);
    setRecentApps(next);
    writeRecentApps(next);
    updatePrefs({ recent_apps: next });
  }, [updatePrefs]);

  const clearRecentApps = useCallback(() => {
    setRecentApps([]);
    writeRecentApps([]);
    updatePrefs({ recent_apps: [] });
  }, [updatePrefs]);

  const value = useMemo(() => ({
    recentApps,
    recordAppVisit,
    clearRecentApps,
  }), [clearRecentApps, recentApps, recordAppVisit]);

  return <RecentActivityContext.Provider value={value}>{children}</RecentActivityContext.Provider>;
}

export function useRecentActivity() {
  const ctx = useContext(RecentActivityContext);
  if (!ctx) {
    throw new Error('useRecentActivity must be used within <RecentActivityProvider>');
  }
  return ctx;
}
