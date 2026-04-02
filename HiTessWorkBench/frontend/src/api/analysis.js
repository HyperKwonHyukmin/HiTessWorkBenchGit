import axios from 'axios';
import { API_BASE_URL } from '../config';

/** 사용자 해석 이력 조회 */
export const getAnalysisHistory = (employeeId) =>
  axios.get(`${API_BASE_URL}/api/analysis/history/${employeeId}`);

/** 전체 해석 이력 조회 (관리자용) */
export const getAllAnalysisHistory = () =>
  axios.get(`${API_BASE_URL}/api/analysis/all`);

/** 해석 작업 상태 조회 (폴링용) */
export const getJobStatus = (jobId) =>
  axios.get(`${API_BASE_URL}/api/analysis/status/${jobId}`);

/** Truss 해석 요청 */
export const requestTrussAnalysis = (formData) =>
  axios.post(`${API_BASE_URL}/api/analysis/truss/request`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

/** Truss Assessment 요청 */
export const requestAssessment = (formData) =>
  axios.post(`${API_BASE_URL}/api/analysis/assessment/request`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

/** Beam 해석 요청 */
export const requestBeamAnalysis = (formData) =>
  axios.post(`${API_BASE_URL}/api/analysis/beam/request`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

/** 파일 다운로드 (blob) */
export const downloadFileBlob = (filepath) =>
  axios.get(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(filepath)}`, {
    responseType: 'blob'
  });

/** 파일 다운로드 (text - BDF 등) */
export const downloadFileText = (filepath) =>
  axios.get(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(filepath)}`, {
    responseType: 'text'
  });

/** Assessment JSON → XLSX 변환 다운로드 (DRM 우회: 서버 메모리에서 생성) */
export const exportAssessmentXlsx = (jsonPath) =>
  axios.get(`${API_BASE_URL}/api/analysis/export-xlsx?json_path=${encodeURIComponent(jsonPath)}`, {
    responseType: 'blob'
  });
