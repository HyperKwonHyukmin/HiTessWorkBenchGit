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

/**
 * 외부 접속 App(백엔드 프록시로 여는 타 개발자 웹앱)의 접속 주소 목록 (관리자 전용).
 * 각 항목: { app_key, proxy_path, default_host, default_port, host, port, overridden }
 */
export const getExternalAppEndpoints = () =>
  axios.get(`${API_BASE_URL}/api/admin/app-settings/external-apps`, { headers: getAuthHeaders() });

/**
 * App Settings 에서 등록한 외부 앱 목록 — 카탈로그용(로그인 사용자 전체, 접속 주소 없음).
 * 각 항목: { slug, title, description, mode, category, art, tags, contributor, dev_status, proxy_path }
 */
export const getRegisteredApps = () =>
  axios.get(`${API_BASE_URL}/api/external-app-registry`, { headers: getAuthHeaders() });

const REGISTRY_ADMIN_URL = () => `${API_BASE_URL}/api/admin/external-app-registry`;

/** 외부 앱 등록 (관리자 전용) — 성공하면 곧바로 카드와 실행 입구가 생긴다. */
export const createRegisteredApp = (payload) =>
  axios.post(REGISTRY_ADMIN_URL(), payload, { headers: getAuthHeaders() });

/** 등록 외부 앱 부분 수정 (slug·title 은 바꿀 수 없다) */
export const updateRegisteredApp = (slug, payload) =>
  axios.put(`${REGISTRY_ADMIN_URL()}/${encodeURIComponent(slug)}`, payload, { headers: getAuthHeaders() });

/** 등록 외부 앱 삭제 — 카드·입구·App Settings 설정이 함께 사라진다. */
export const deleteRegisteredApp = (slug) =>
  axios.delete(`${REGISTRY_ADMIN_URL()}/${encodeURIComponent(slug)}`, { headers: getAuthHeaders() });

/** 등록 전 연결 확인: { ok, url, status?, message } */
export const probeExternalApp = (host, port) =>
  axios.post(`${REGISTRY_ADMIN_URL()}/probe`, { host, port }, { headers: getAuthHeaders() });

/** 등록 외부 앱 전체(관리자 전용, 접속 주소 포함) */
export const getAdminRegisteredApps = () =>
  axios.get(REGISTRY_ADMIN_URL(), { headers: getAuthHeaders() });
