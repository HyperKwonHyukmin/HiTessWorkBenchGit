import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders, getSessionToken } from '../utils/auth';

/** 접속 상태 하트비트 전송 — 현재 페이지 + 유휴 경과초 + 앱 버전을 함께 보고. 실패는 조용히 무시. */
export const sendHeartbeat = (page, idleSeconds = 0, appVersion = null) =>
  axios.post(`${API_BASE_URL}/api/presence/heartbeat`, {
    page,
    idle_seconds: idleSeconds,
    app_version: appVersion,
  }, {
    headers: getAuthHeaders(),
  }).catch(() => {});

/** 현재 접속 중인 사용자 목록 조회 (관리자 전용) */
export const getOnlineUsers = () =>
  axios.get(`${API_BASE_URL}/api/presence/online`, { headers: getAuthHeaders() });

/** 특정 사용자의 모든 세션을 무효화하고 오프라인 처리 (관리자 전용) */
export const forceLogoutUser = (employeeId) =>
  axios.post(
    `${API_BASE_URL}/api/presence/force-logout/${encodeURIComponent(employeeId)}`,
    {},
    { headers: getAuthHeaders() },
  );

/**
 * 앱 종료(pagehide) 시 navigator.sendBeacon 으로 즉시 오프라인 신호를 보낸다.
 * sendBeacon 은 커스텀 헤더를 실을 수 없으므로 세션 토큰을 본문(text/plain)에 담는다.
 * text/plain 은 CORS-safelisted 라 preflight 없이 전송되어 종료 시점에도 안정적으로 도착한다.
 */
export const beaconOffline = () => {
  try {
    const token = getSessionToken();
    if (!token || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    const blob = new Blob([token], { type: 'text/plain' });
    navigator.sendBeacon(`${API_BASE_URL}/api/presence/offline`, blob);
  } catch {
    // 종료 경로라 실패는 무시한다.
  }
};
