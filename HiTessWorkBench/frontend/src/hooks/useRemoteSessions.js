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

  const checkNow = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await axios.get(`${API_BASE_URL}/api/system/remote-sessions`, {
        headers: getAuthHeaders(),
        timeout: 10000,
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
      setState(prev => ({
        ...prev,
        isLoading: false,
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
    checkNow();
    timerRef.current = setInterval(checkNow, intervalMs);
    return () => {
      disposedRef.current = true;
      clearInterval(timerRef.current);
    };
  }, [checkNow, enabled, intervalMs]);

  return { ...state, checkNow };
}
