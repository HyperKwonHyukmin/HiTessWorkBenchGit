import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 사용자 해석 이력 조회 */
export const getAnalysisHistory = (employeeId, skip = 0, limit = 200) =>
  axios.get(`${API_BASE_URL}/api/analysis/history/${employeeId}`, { params: { skip, limit }, headers: getAuthHeaders() });

/** 전체 해석 이력 조회 (관리자용) */
export const getAllAnalysisHistory = (limit = 200) =>
  axios.get(`${API_BASE_URL}/api/analysis/all`, { params: { limit }, headers: getAuthHeaders() });

/** 해석 작업 상태 조회 (폴링용) */
export const getJobStatus = (jobId) =>
  axios.get(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });

/** Truss 해석 요청 */
export const requestTrussAnalysis = (formData) =>
  axios.post(`${API_BASE_URL}/api/analysis/truss/request`, formData, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' }
  });

/** Truss Assessment 요청 */
export const requestAssessment = (formData) =>
  axios.post(`${API_BASE_URL}/api/analysis/assessment/request`, formData, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' }
  });

/** Beam 해석 요청 */
export const requestBeamAnalysis = (formData) =>
  axios.post(`${API_BASE_URL}/api/analysis/beam/request`, formData, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' }
  });

/** BDF Scanner 요청 */
export const requestBdfScanner = (formData) =>
  axios.post(`${API_BASE_URL}/api/analysis/bdfscanner/request`, formData, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' }
  });

/** F06 Parser 요청 */
export const requestF06Parser = (formData) =>
  axios.post(`${API_BASE_URL}/api/analysis/f06parser/request`, formData, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' }
  });

/** 파일 다운로드 (blob) */
export const downloadFileBlob = (filepath) =>
  axios.get(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(filepath)}`, {
    responseType: 'blob',
    headers: getAuthHeaders()
  });

/** 파일 다운로드 (text - BDF 등) */
export const downloadFileText = (filepath) =>
  axios.get(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(filepath)}`, {
    responseType: 'text',
    headers: getAuthHeaders()
  });

/** Assessment JSON → XLSX 변환 다운로드 (DRM 우회: 서버 메모리에서 생성) */
export const exportAssessmentXlsx = (jsonPath) =>
  axios.get(`${API_BASE_URL}/api/analysis/export-xlsx?json_path=${encodeURIComponent(jsonPath)}`, {
    responseType: 'blob',
    headers: getAuthHeaders()
  });

/** 프로그램별 사용 건수 집계 (days=0이면 전체 기간) */
export const getTopPrograms = (days = 30, limit = 10) =>
  axios.get(`${API_BASE_URL}/api/analysis/stats/top-programs`, { params: { days, limit } });

/** 특정 Analysis ID로 단건 조회 */
export const getAnalysisById = (id) =>
  axios.get(`${API_BASE_URL}/api/analysis/${id}`, { headers: getAuthHeaders() });

/** 사용자 당월 해석 수행 건수 조회 (limit 제약 없음) */
export const getMonthlyAnalysisCount = (employeeId, year, month) =>
  axios.get(`${API_BASE_URL}/api/analysis/stats/monthly`, {
    params: { employee_id: employeeId, year, month },
    headers: getAuthHeaders()
  });
