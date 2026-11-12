// 업데이트 안내(서버 공개 페이지 /updates, 백엔드 routers/updates_web.py)를 앱 안에서 쓸 때의 통로(2026-11-12).
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';
import { publicPageUrl } from '../utils/publicPageUrl';

/** 안내 목록(최신이 앞). 옛 서버(404)·네트워크 오류는 빈 목록 — fetch 로 묻는다(axios 404 가 앱의 네트워크 진단 경고로 쌓이지 않게). */
export async function fetchUpdateEntries({ signal } = {}) {
  try {
    const res = await fetch(`${API_BASE_URL}/updates/updates.json`, { signal, cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

/** 앱 안에서 연 안내 페이지(iframe)가 넘긴 기록을 로그인과 함께 보낸다 — 서버가 사번으로 센다. 실패는 조용히. */
export function sendUpdateBeacon(payload) {
  axios.post(`${API_BASE_URL}/api/updates/beacon`, payload, { headers: getAuthHeaders() }).catch(() => {});
}

/** 앱 안 iframe 주소. ?embed=1 이면 페이지가 머리 띠를 빼고 기록을 postMessage 로 넘긴다. */
export function updatePageUrl(entryId) {
  return `${API_BASE_URL}/updates/${entryId ? encodeURIComponent(entryId) : ''}?embed=1`;
}

/** 남에게 줄 안내 주소(메일, 메신저) — 앱의 https 대신 사내 브라우저가 경고 없이 여는 http://…:9091 (utils/publicPageUrl). */
export function updateShareUrl(entryId) {
  return publicPageUrl(API_BASE_URL, `/updates/${entryId ? encodeURIComponent(entryId) : ''}`);
}

/** 안내 주소를 시스템 브라우저로 — 앱(Electron) 본창의 window.open 은 앱 창을 하나 더 띄울 뿐이다. */
export function openUpdateInBrowser(entryId) {
  const url = updateShareUrl(entryId);
  if (window.electron?.send) window.electron.send('open-external', url);
  else window.open(url, '_blank', 'noopener');
}

/** 안내 주소를 클립보드로. 성공하면 주소, 실패하면 null. */
export async function copyUpdateLink(entryId) {
  const url = updateShareUrl(entryId);
  try {
    await navigator.clipboard.writeText(url);
    return url;
  } catch {
    return null;
  }
}
