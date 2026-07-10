import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 접속 상태 하트비트 전송 — 현재 보고 있는 페이지를 함께 보고. 실패는 조용히 무시. */
export const sendHeartbeat = (page) =>
  axios.post(`${API_BASE_URL}/api/presence/heartbeat`, { page }, {
    headers: getAuthHeaders(),
  }).catch(() => {});

/** 현재 접속 중인 사용자 목록 조회 (관리자 전용) */
export const getOnlineUsers = () =>
  axios.get(`${API_BASE_URL}/api/presence/online`, { headers: getAuthHeaders() });
