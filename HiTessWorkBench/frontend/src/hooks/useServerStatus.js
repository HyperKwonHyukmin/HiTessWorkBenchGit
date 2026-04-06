/**
 * @fileoverview 백엔드 서버 연결 상태를 주기적으로 체크하는 훅.
 * 5초마다 /version 엔드포인트에 요청하여 온라인/오프라인 상태를 반환합니다.
 */
import { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config';

export function useServerStatus(intervalMs = 5000) {
  const [isOnline, setIsOnline] = useState(true);
  const timerRef = useRef(null);

  const check = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${API_BASE_URL}/api/version`, { signal: controller.signal });
      clearTimeout(timeoutId);
      setIsOnline(res.ok);
    } catch {
      setIsOnline(false);
    }
  };

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [intervalMs]);

  return isOnline;
}
