import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

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
  const [recentApps, setRecentApps] = useState(() => readRecentApps());

  const recordAppVisit = useCallback((menu, label = menu, meta = {}) => {
    if (!menu || !label) return;
    setRecentApps(prev => {
      const nextItem = {
        menu,
        label,
        mode: meta.mode || '',
        category: meta.category || '',
        at: Date.now(),
      };
      const next = [nextItem, ...prev.filter(item => item.menu !== menu)].slice(0, MAX_RECENT_APPS);
      writeRecentApps(next);
      return next;
    });
  }, []);

  const clearRecentApps = useCallback(() => {
    writeRecentApps([]);
    setRecentApps([]);
  }, []);

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
