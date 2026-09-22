import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * 내 환경설정을 서버에서 읽는다.
 * 응답: { prefs: {favorites, recent_apps, notifications, landing_menu}, updated_at: ISO|null }
 * 행이 없어도 서버가 기본값을 채워 4키를 돌려준다(스펙 §4.3).
 */
export const getPreferences = () =>
  axios.get(`${API_BASE_URL}/api/preferences`, { headers: getAuthHeaders() });

/**
 * 내 환경설정을 부분 저장한다.
 * @param {object} payload — {favorites?, recent_apps?, notifications?, landing_menu?}
 * 화이트리스트 밖 키는 서버가 무시하고 응답 `ignored_keys` 로 알려 준다.
 * 값 형식 오류는 422 — 호출자는 조용히 실패 처리(로컬 캐시는 이미 갱신됨).
 * 응답: { prefs, updated_at, ignored_keys }
 */
export const putPreferences = (payload) =>
  axios.put(`${API_BASE_URL}/api/preferences`, payload || {}, { headers: getAuthHeaders() });
