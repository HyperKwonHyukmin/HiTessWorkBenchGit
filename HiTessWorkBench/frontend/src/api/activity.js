import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 버전 업데이트 이벤트 기록 */
export const reportVersionUpdate = (oldVersion, newVersion, employeeId = null) =>
  axios.post(`${API_BASE_URL}/api/activity/version-update`, {
    employee_id: employeeId,
    old_version: oldVersion,
    new_version: newVersion,
  }).catch(() => {});

/** 활동 로그 조회 (관리자용) */
export const getActivityLogs = (params = {}) =>
  axios.get(`${API_BASE_URL}/api/activity/logs`, { params, headers: getAuthHeaders() });

/** 활동 로그 CSV 내보내기 URL */
export const getActivityLogsExportUrl = (params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString();
  return `${API_BASE_URL}/api/activity/logs/export${qs ? '?' + qs : ''}`;
};

/** 로그아웃 이벤트 전송 */
export const callLogout = () =>
  axios.post(`${API_BASE_URL}/api/logout`, {}, { headers: getAuthHeaders() }).catch(() => {});
