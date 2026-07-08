import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const NetworkContext = createContext(null);
const MAX_EVENTS = 20;

function classifyAxiosError(error) {
  if (!error?.response) {
    if (error?.code === 'ECONNABORTED') return { severity: 'warning', title: '요청 시간 초과' };
    return { severity: 'error', title: '네트워크 연결 실패' };
  }

  const status = error.response.status;
  if (status === 401) return { severity: 'warning', title: '세션 만료 또는 인증 실패' };
  if (status === 403) return { severity: 'warning', title: '권한 없음' };
  if (status === 404) return { severity: 'warning', title: 'API 또는 리소스 없음' };
  if (status === 408 || status === 429) return { severity: 'warning', title: '요청 지연 또는 제한' };
  if (status >= 500) return { severity: 'error', title: '서버 내부 오류' };
  return { severity: 'info', title: `HTTP ${status}` };
}

function sanitizeUrl(url = '') {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url || '').split('?')[0];
  }
}

export function NetworkProvider({ children }) {
  const [events, setEvents] = useState([]);

  const recordIssue = useCallback((payload) => {
    const event = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      ...payload,
    };
    setEvents(prev => [event, ...prev].slice(0, MAX_EVENTS));
    return event;
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        // 401(세션 만료/인증 실패)은 App.jsx 의 자동 로그아웃 인터셉터가 별도로 처리한다.
        // 진단 이벤트로 또 기록하면 상단 경고 배지·'환경 진단' 모달에 중복/과다 노출되므로 제외한다.
        if (error?.response?.status === 401) {
          return Promise.reject(error);
        }
        const config = error?.config || {};
        // 원격 세션 폴링(/api/system/remote-sessions)은 무거운 Windows 조회라 느리거나
        // 순간 실패가 잦다. 이 실패를 '네트워크 연결 실패/요청 시간 초과' 진단 이벤트로
        // 기록하면 서버는 멀쩡한데 네트워크가 끊긴 것처럼 오탐이 뜬다(배지는 훅이 자체 처리) → 제외.
        if (String(config.url || '').includes('/api/system/remote-sessions')) {
          return Promise.reject(error);
        }
        const { severity, title } = classifyAxiosError(error);
        recordIssue({
          severity,
          title,
          status: error?.response?.status ?? null,
          method: (config.method || 'GET').toUpperCase(),
          url: sanitizeUrl(config.url),
          message: error?.response?.data?.detail || error?.message || '요청 실패',
        });
        return Promise.reject(error);
      },
    );

    return () => axios.interceptors.response.eject(interceptor);
  }, [recordIssue]);

  const value = useMemo(() => ({
    events,
    recordIssue,
    clearEvents,
    latestIssue: events[0] || null,
    issueCount: events.length,
  }), [clearEvents, events, recordIssue]);

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error('useNetwork must be used within <NetworkProvider>');
  }
  return ctx;
}
