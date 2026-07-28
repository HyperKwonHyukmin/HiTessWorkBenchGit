/**
 * App별 관리자 설정 API.
 *
 * 앱 카탈로그의 원본은 DashboardContext 의 ANALYSIS_DATA(코드)이고, 여기서
 * 받아오는 값은 그 위에 덮는 '오버라이드'다. 응답에 없는 앱은 코드 기본값을 쓴다.
 */
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 오버라이드가 설정된 App 목록 (로그인 사용자 전체 조회 가능) */
export const getAppSettings = () =>
  axios.get(`${API_BASE_URL}/api/app-settings`, { headers: getAuthHeaders() });

/**
 * App 오버라이드 생성/부분 갱신 (관리자 전용).
 * 요청에 담은 필드만 반영되고, 명시적 null 은 해당 오버라이드를 해제한다.
 */
export const updateAppSetting = (appKey, payload) =>
  axios.put(
    `${API_BASE_URL}/api/admin/app-settings/${encodeURIComponent(appKey)}`,
    payload,
    { headers: getAuthHeaders() },
  );

/** App 오버라이드 삭제 = 코드 기본값으로 초기화 (관리자 전용) */
export const resetAppSetting = (appKey) =>
  axios.delete(
    `${API_BASE_URL}/api/admin/app-settings/${encodeURIComponent(appKey)}`,
    { headers: getAuthHeaders() },
  );
