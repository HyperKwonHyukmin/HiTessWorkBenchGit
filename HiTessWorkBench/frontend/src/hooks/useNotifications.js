/**
 * 알림 센터 폴링 훅 — 30초 주기(POLLING_POLICY.notificationsIntervalMs), WebSocket 없음.
 *
 *  - 첫 폴링: since 없이 50건 → 전체 목록. baseline 이므로 onNew 를 부르지 않는다(ChatDock 과 동일).
 *  - 이후: since=latest_id 델타만 받아 mergeNotifications 로 합치고, 새 항목이 있으면 onNew(items).
 *  - 창이 다시 보이거나(visibilitychange) 포커스를 받으면 즉시 1회(5초 스로틀).
 *  - 읽음/삭제는 낙관적 갱신 후 API. 실패해도 되돌리지 않는다(다음 폴링이 unread_count 를 서버 값으로 맞춘다).
 *
 * currentUserId 가 없으면 아무것도 하지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications';
import { POLLING_POLICY } from './pollingPolicy';
import { mergeNotifications } from '../utils/notificationLink';

const FOCUS_POLL_THROTTLE_MS = 5000;
const DEFAULT_PREFS = { muted_kinds: [], desktop_toast: true };

export function useNotifications({ currentUserId, onNew }) {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loading, setLoading] = useState(false);

  // null = 아직 첫 폴링 전(무음 baseline). 이후엔 서버 latest_id.
  const latestIdRef = useRef(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  const lastPollAtRef = useRef(0);
  const inFlightRef = useRef(false);

  const poll = useCallback(async ({ full = false } = {}) => {
    if (!currentUserId || inFlightRef.current) return;
    inFlightRef.current = true;
    lastPollAtRef.current = Date.now();
    const since = full ? null : latestIdRef.current;
    try {
      if (full) setLoading(true);
      const res = await getNotifications(since == null ? {} : { since });
      const data = res.data || {};
      const fresh = Array.isArray(data.items) ? data.items : [];
      setUnreadCount(Number(data.unread_count) || 0);
      if (data.prefs && typeof data.prefs === 'object') {
        setPrefs({ ...DEFAULT_PREFS, ...data.prefs });
      }
      if (since == null) {
        setItems(fresh);
      } else if (fresh.length > 0) {
        setItems(prev => mergeNotifications(prev, fresh));
        onNewRef.current?.(fresh);
      }
      latestIdRef.current = Math.max(Number(data.latest_id) || 0, since || 0);
    } catch {
      // 폴링 실패는 조용히 무시 — 다음 주기에 복구.
    } finally {
      inFlightRef.current = false;
      if (full) setLoading(false);
    }
  }, [currentUserId]);

  // 주기 폴링 + 창 복귀 시 즉시 폴링.
  useEffect(() => {
    if (!currentUserId) {
      latestIdRef.current = null;
      setItems([]);
      setUnreadCount(0);
      return undefined;
    }
    latestIdRef.current = null;
    poll({ full: true });
    const timer = setInterval(() => poll(), POLLING_POLICY.notificationsIntervalMs);

    const onResume = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (Date.now() - lastPollAtRef.current < FOCUS_POLL_THROTTLE_MS) return;
      poll();
    };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [currentUserId, poll]);

  /** 패널을 열 때 전체 목록을 다시 받는다(다른 창에서 읽음 처리한 상태 반영). */
  const reload = useCallback(() => poll({ full: true }), [poll]);

  const markRead = useCallback(async (id) => {
    const now = new Date().toISOString();
    let changed = false;
    setItems(prev => prev.map(n => {
      if (n.id !== id || n.is_read) return n;
      changed = true;
      return { ...n, is_read: true, read_at: now };
    }));
    if (changed) setUnreadCount(c => Math.max(0, c - 1));
    try { await markNotificationRead(id); } catch { /* 다음 폴링이 맞춘다 */ }
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => (n.is_read ? n : { ...n, is_read: true, read_at: now })));
    setUnreadCount(0);
    try { await markAllNotificationsRead(); } catch { /* 다음 폴링이 맞춘다 */ }
  }, []);

  const remove = useCallback(async (id) => {
    let wasUnread = false;
    setItems(prev => prev.filter(n => {
      if (n.id !== id) return true;
      wasUnread = !n.is_read;
      return false;
    }));
    if (wasUnread) setUnreadCount(c => Math.max(0, c - 1));
    try { await deleteNotification(id); } catch { /* 다음 폴링이 맞춘다 */ }
  }, []);

  return { items, unreadCount, prefs, loading, reload, markRead, markAllRead, remove };
}
