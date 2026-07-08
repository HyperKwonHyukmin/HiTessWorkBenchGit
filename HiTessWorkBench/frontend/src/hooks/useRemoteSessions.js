import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

export function useRemoteSessions(intervalMs = 30000, options = {}) {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState({
    isLoading: true,
    hasRemoteUser: false,
    hasActiveRemoteUser: false,
    remoteSessions: [],
    allSessions: [],
    activeRdpClientIps: [],
    activeRdpClients: [],
    supported: true,
    checkedAt: null,
    ipLookupStatus: '',
    error: '',
  });
  const timerRef = useRef(null);
  const disposedRef = useRef(false);

  const checkNow = useCallback(async (force = false) => {
    if (!enabled) return;
    try {
      const url = `${API_BASE_URL}/api/system/remote-sessions${force ? '?fresh=1' : ''}`;
      const res = await axios.get(url, {
        headers: getAuthHeaders(),
        timeout: 20000,
      });
      if (disposedRef.current) return;
      setState({
        isLoading: false,
        hasRemoteUser: !!res.data?.has_remote_user,
        hasActiveRemoteUser: !!res.data?.has_active_remote_user,
        remoteSessions: res.data?.remote_sessions || [],
        allSessions: res.data?.all_sessions || [],
        activeRdpClientIps: res.data?.active_rdp_client_ips || [],
        activeRdpClients: res.data?.active_rdp_clients || [],
        supported: res.data?.supported !== false,
        checkedAt: res.data?.checked_at || null,
        ipLookupStatus: res.data?.ip_lookup_status || '',
        error: res.data?.error || '',
      });
    } catch (err) {
      if (disposedRef.current) return;
      // 조회 실패(서버 다운 등) 시 이전 '사용중' 상태를 그대로 두면 stale 배지가 남는다 → 초기화.
      setState(prev => ({
        ...prev,
        isLoading: false,
        hasRemoteUser: false,
        hasActiveRemoteUser: false,
        remoteSessions: [],
        allSessions: [],
        activeRdpClientIps: [],
        activeRdpClients: [],
        error: err?.response?.data?.detail || '원격 접속 상태 확인 실패',
      }));
    }
  }, [enabled]);

  useEffect(() => {
    disposedRef.current = false;
    if (!enabled) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        hasRemoteUser: false,
        hasActiveRemoteUser: false,
        remoteSessions: [],
        allSessions: [],
        activeRdpClientIps: [],
        activeRdpClients: [],
        error: '',
      }));
      return () => {
        disposedRef.current = true;
      };
    }
    checkNow(false);
    // 주기 폴링은 캐시 활용(force=false). setInterval 콜백 인자가 force로 새지 않도록 래핑.
    timerRef.current = setInterval(() => checkNow(false), intervalMs);
    return () => {
      disposedRef.current = true;
      clearInterval(timerRef.current);
    };
  }, [checkNow, enabled, intervalMs]);

  return { ...state, checkNow };
}
