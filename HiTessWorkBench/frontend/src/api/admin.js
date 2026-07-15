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

/** 현재 실행 중/대기 중 해석 작업 상세 목록 */
export const getActiveJobs = () =>
  axios.get(`${API_BASE_URL}/api/system/jobs/active`, { headers: getAuthHeaders() });

// ==================== Storage ====================

/** 정리 대상(30일 초과) 폴더 미리보기 (dry-run) */
export const getStoragePreview = () =>
  axios.get(`${API_BASE_URL}/api/system/storage/preview`, { headers: getAuthHeaders() });

/** 30일 초과 폴더 즉시 삭제 (관리자 수동 실행) */
export const runStorageCleanup = () =>
  axios.post(`${API_BASE_URL}/api/system/storage/cleanup`, {}, { headers: getAuthHeaders() });

// ==================== Notices ====================

/** 공지사항 목록 조회 */
export const getNotices = () =>
  axios.get(`${API_BASE_URL}/api/notices`, { headers: getAuthHeaders() });

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

// ==================== App Community (AppSpace) 관리 ====================

/** App 커뮤니티 공간 전체 목록(비활성 포함) + 공지/게시글 집계 */
export const getAppSpaces = () =>
  axios.get(`${API_BASE_URL}/api/admin/app-spaces`, { headers: getAuthHeaders() });

/** App 커뮤니티 공간 생성 */
export const createAppSpace = (payload) =>
  axios.post(`${API_BASE_URL}/api/admin/app-spaces`, payload, { headers: getAuthHeaders() });

/** App 커뮤니티 공간 부분 갱신(이름/공지·게시판·활성 토글) */
export const updateAppSpace = (appKey, payload) =>
  axios.put(`${API_BASE_URL}/api/admin/app-spaces/${encodeURIComponent(appKey)}`, payload, { headers: getAuthHeaders() });

/** App 커뮤니티 공간 삭제 */
export const deleteAppSpace = (appKey) =>
  axios.delete(`${API_BASE_URL}/api/admin/app-spaces/${encodeURIComponent(appKey)}`, { headers: getAuthHeaders() });

/** 특정 App의 공지 목록(비공개/예약 포함) + 확인 수 */
export const getAppSpaceNotices = (appKey) =>
  axios.get(`${API_BASE_URL}/api/admin/app-spaces/${encodeURIComponent(appKey)}/notices`, { headers: getAuthHeaders() });

/** 특정 App의 요청 게시글 전체 */
export const getAppSpaceRequests = (appKey) =>
  axios.get(`${API_BASE_URL}/api/admin/app-spaces/${encodeURIComponent(appKey)}/requests`, { headers: getAuthHeaders() });

/** 진입 공지 확인(ack) 사용자 명단 리포트 */
export const getNoticeReadReport = (noticeId) =>
  axios.get(`${API_BASE_URL}/api/admin/notices/${noticeId}/reads`, { headers: getAuthHeaders() });

// ==================== Admin Gate ====================

/** 관리자 게이트 비밀번호 검증 */
export const verifyAdminGate = (password) =>
  axios.post(`${API_BASE_URL}/api/admin/verify-gate`, { password }, { headers: getAuthHeaders() });
