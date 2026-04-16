import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

// ==================== Users ====================

/** 전체 사용자 목록 조회 */
export const getUsers = () =>
  axios.get(`${API_BASE_URL}/api/users`, { headers: getAuthHeaders() });

/** 사용자 정보 수정 */
export const updateUser = (userId, data) =>
  axios.put(`${API_BASE_URL}/api/users/${userId}`, data, { headers: getAuthHeaders() });

/** 사용자 삭제 */
export const deleteUser = (userId) =>
  axios.delete(`${API_BASE_URL}/api/users/${userId}`, { headers: getAuthHeaders() });

// ==================== System ====================

/** 시스템 상태 조회 (CPU, 메모리, DB) */
export const getSystemStatus = () =>
  axios.get(`${API_BASE_URL}/api/system/status`, { headers: getAuthHeaders() });

/** 서버 큐 상태 조회 */
export const getQueueStatus = () =>
  axios.get(`${API_BASE_URL}/api/system/queue-status`, { headers: getAuthHeaders() });

/** 유지보수 모드 상태 조회 */
export const getMaintenanceMode = () =>
  axios.get(`${API_BASE_URL}/api/system/maintenance`, { headers: getAuthHeaders() });

/** 유지보수 모드 설정 */
export const setMaintenanceMode = (maintenance) =>
  axios.post(`${API_BASE_URL}/api/system/maintenance`, { maintenance }, { headers: getAuthHeaders() });

// ==================== Notices ====================

/** 공지사항 목록 조회 */
export const getNotices = () =>
  axios.get(`${API_BASE_URL}/api/notices`);

/** 공지사항 생성 */
export const createNotice = (payload) =>
  axios.post(`${API_BASE_URL}/api/notices`, payload, { headers: getAuthHeaders() });

/** 공지사항 수정 */
export const updateNotice = (noticeId, payload) =>
  axios.put(`${API_BASE_URL}/api/notices/${noticeId}`, payload, { headers: getAuthHeaders() });

/** 공지사항 삭제 */
export const deleteNotice = (noticeId) =>
  axios.delete(`${API_BASE_URL}/api/notices/${noticeId}`, { headers: getAuthHeaders() });

// ==================== Feature Requests ====================

/** 기능요청 목록 조회 */
export const getFeatureRequests = () =>
  axios.get(`${API_BASE_URL}/api/feature-requests`);

/** 기능요청 생성 */
export const createFeatureRequest = (payload) =>
  axios.post(`${API_BASE_URL}/api/feature-requests`, payload, { headers: getAuthHeaders() });

/** 기능요청 추천 */
export const upvoteFeatureRequest = (reqId) =>
  axios.put(`${API_BASE_URL}/api/feature-requests/${reqId}/upvote`, {}, { headers: getAuthHeaders() });

/** 기능요청 관리자 답변 */
export const commentFeatureRequest = (reqId, payload) =>
  axios.put(`${API_BASE_URL}/api/feature-requests/${reqId}/comment`, payload, { headers: getAuthHeaders() });

/** 기능요청 삭제 */
export const deleteFeatureRequest = (reqId) =>
  axios.delete(`${API_BASE_URL}/api/feature-requests/${reqId}`, { headers: getAuthHeaders() });

// ==================== User Guides ====================

/** 사용자 가이드 목록 조회 */
export const getUserGuides = () =>
  axios.get(`${API_BASE_URL}/api/user-guides`);

/** 사용자 가이드 생성 */
export const createUserGuide = (payload) =>
  axios.post(`${API_BASE_URL}/api/user-guides`, payload, { headers: getAuthHeaders() });

/** 사용자 가이드 수정 */
export const updateUserGuide = (guideId, payload) =>
  axios.put(`${API_BASE_URL}/api/user-guides/${guideId}`, payload, { headers: getAuthHeaders() });

/** 사용자 가이드 삭제 */
export const deleteUserGuide = (guideId) =>
  axios.delete(`${API_BASE_URL}/api/user-guides/${guideId}`, { headers: getAuthHeaders() });

// ==================== Admin Gate ====================

/** 관리자 게이트 비밀번호 검증 */
export const verifyAdminGate = (password) =>
  axios.post(`${API_BASE_URL}/api/admin/verify-gate`, { password }, { headers: getAuthHeaders() });
