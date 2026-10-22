import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * 관리자 업데이트 이력 — 서버 app/changelog/changelog.json 의 items(최신이 맨 앞).
 * 항목 = { date, version?, kind, title, summary, status?, screen?, points? }
 */
export const getAdminUpdates = ({ signal } = {}) =>
  axios.get(`${API_BASE_URL}/api/admin/updates`, { headers: getAuthHeaders(), signal });
