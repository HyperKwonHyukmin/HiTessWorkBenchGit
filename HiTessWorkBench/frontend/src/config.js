// frontend/src/config.js
// 서버 주소는 앱 첫 실행 시 사용자가 설정하거나, 기본값(빌드 시 지정된 주소)을 사용합니다.
// localStorage의 'server_url' 키에 저장된 값이 있으면 해당 값을 우선 사용합니다.

const DEFAULT_API_BASE_URL = "http://10.14.42.145:8000";

function getApiBaseUrl() {
  try {
    const stored = localStorage.getItem('server_url');
    if (stored && stored.trim()) return stored.trim().replace(/\/$/, '');
  } catch (_) { /* localStorage 접근 불가 환경 */ }
  return DEFAULT_API_BASE_URL;
}

export let API_BASE_URL = getApiBaseUrl();

/** 런타임에 서버 주소를 변경하고 localStorage에 저장합니다. */
export function setApiBaseUrl(url) {
  const normalized = url.trim().replace(/\/$/, '');
  localStorage.setItem('server_url', normalized);
  API_BASE_URL = normalized;
}

export { DEFAULT_API_BASE_URL };
