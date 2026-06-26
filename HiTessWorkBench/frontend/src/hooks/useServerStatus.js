/**
 * @fileoverview 백엔드 서버 연결 상태를 주기적으로 체크하는 훅.
 * 5초마다 /version 엔드포인트에 요청하여 온라인/오프라인 상태를 반환합니다.
 * 순간적인 네트워크 지연/패킷 손실 때문에 서버가 살아 있는데 Offline으로 튀지 않도록
 * 연속 실패가 임계값을 넘을 때만 오프라인으로 전환합니다.
 */
import { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config';

function levelFromState({ failureCount, latencyMs, isOnline }) {
  if (!isOnline) return 'offline';
  if (failureCount >= 2) return 'unreliable';
  if (failureCount >= 1 || latencyMs > 2500) return 'degraded';
  return 'online';
}

const LEVEL_LABELS = {
  online: 'Online',
  degraded: 'Slow',
  unreliable: 'Unstable',
  offline: 'Offline',
};

export function useServerHealth(intervalMs = 5000, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
  const [health, setHealth] = useState({
    isOnline: true,
    level: 'online',
    label: LEVEL_LABELS.online,
    latencyMs: null,
    lastCheckedAt: null,
    serverVersion: '',
    error: '',
  });
  const timerRef = useRef(null);
  const failureCountRef = useRef(0);
  const checkNowRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    const check = async () => {
      let timeoutId = null;
      const startedAt = performance.now();

      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${API_BASE_URL}/api/version`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const latencyMs = Math.round(performance.now() - startedAt);
        const body = await res.json().catch(() => ({}));

        if (res.ok) {
          failureCountRef.current = 0;
          const level = levelFromState({ failureCount: 0, latencyMs, isOnline: true });
          if (!disposed) {
            setHealth({
              isOnline: true,
              level,
              label: LEVEL_LABELS[level],
              latencyMs,
              lastCheckedAt: new Date().toISOString(),
              serverVersion: body?.version || '',
              error: '',
            });
          }
          return;
        }

        failureCountRef.current += 1;
      } catch {
        failureCountRef.current += 1;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (!disposed) {
        const isOnline = failureCountRef.current < maxConsecutiveFailures;
        const level = levelFromState({
          failureCount: failureCountRef.current,
          latencyMs: Number.POSITIVE_INFINITY,
          isOnline,
        });
        setHealth(prev => ({
          ...prev,
          isOnline,
          level,
          label: LEVEL_LABELS[level],
          lastCheckedAt: new Date().toISOString(),
          error: isOnline
            ? `연속 실패 ${failureCountRef.current}/${maxConsecutiveFailures}`
            : '서버 상태 확인 실패',
        }));
      }
    };

    checkNowRef.current = check;
    check();
    timerRef.current = setInterval(check, intervalMs);
    return () => {
      disposed = true;
      clearInterval(timerRef.current);
    };
  }, [intervalMs, maxConsecutiveFailures, timeoutMs]);

  return {
    ...health,
    checkNow: () => checkNowRef.current?.(),
    failureCount: failureCountRef.current,
    serverUrl: API_BASE_URL,
  };
}

export function useServerStatus(intervalMs = 5000, options = {}) {
  return useServerHealth(intervalMs, options).isOnline;
}
