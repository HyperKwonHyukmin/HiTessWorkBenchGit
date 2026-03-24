import axios from 'axios';
import { API_BASE_URL } from '../config';

// ==================== Users ====================

/** 전체 사용자 목록 조회 */
export const getUsers = () =>
  axios.get(`${API_BASE_URL}/api/users`);

/** 사용자 정보 수정 */
export const updateUser = (userId, data) =>
  axios.put(`${API_BASE_URL}/api/users/${userId}`, data);

/** 사용자 삭제 */
export const deleteUser = (userId) =>
  axios.delete(`${API_BASE_URL}/api/users/${userId}`);

// ==================== System ====================

/** 시스템 상태 조회 (CPU, 메모리, DB) */
export const getSystemStatus = () =>
  axios.get(`${API_BASE_URL}/api/system/status`);

/** 서버 큐 상태 조회 */
export const getQueueStatus = () =>
  axios.get(`${API_BASE_URL}/api/system/queue-status`);

// ==================== Notices ====================

/** 공지사항 목록 조회 */
export const getNotices = () =>
  axios.get(`${API_BASE_URL}/api/notices`);

/** 공지사항 생성 */
export const createNotice = (payload) =>
  axios.post(`${API_BASE_URL}/api/notices`, payload);

/** 공지사항 수정 */
export const updateNotice = (noticeId, payload) =>
  axios.put(`${API_BASE_URL}/api/notices/${noticeId}`, payload);

/** 공지사항 삭제 */
export const deleteNotice = (noticeId) =>
  axios.delete(`${API_BASE_URL}/api/notices/${noticeId}`);

// ==================== Feature Requests ====================

/** 기능요청 목록 조회 */
export const getFeatureRequests = () =>
  axios.get(`${API_BASE_URL}/api/feature-requests`);

/** 기능요청 생성 */
export const createFeatureRequest = (payload) =>
  axios.post(`${API_BASE_URL}/api/feature-requests`, payload);

/** 기능요청 추천 */
export const upvoteFeatureRequest = (reqId) =>
  axios.put(`${API_BASE_URL}/api/feature-requests/${reqId}/upvote`);

/** 기능요청 관리자 답변 */
export const commentFeatureRequest = (reqId, payload) =>
  axios.put(`${API_BASE_URL}/api/feature-requests/${reqId}/comment`, payload);

/** 기능요청 삭제 */
export const deleteFeatureRequest = (reqId) =>
  axios.delete(`${API_BASE_URL}/api/feature-requests/${reqId}`);

// ==================== User Guides ====================

/** 사용자 가이드 목록 조회 */
export const getUserGuides = () =>
  axios.get(`${API_BASE_URL}/api/user-guides`);

/** 사용자 가이드 생성 */
export const createUserGuide = (payload) =>
  axios.post(`${API_BASE_URL}/api/user-guides`, payload);

/** 사용자 가이드 수정 */
export const updateUserGuide = (guideId, payload) =>
  axios.put(`${API_BASE_URL}/api/user-guides/${guideId}`, payload);

/** 사용자 가이드 삭제 */
export const deleteUserGuide = (guideId) =>
  axios.delete(`${API_BASE_URL}/api/user-guides/${guideId}`);
