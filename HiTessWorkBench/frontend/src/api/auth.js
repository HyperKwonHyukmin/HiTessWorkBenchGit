import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 서버 버전 확인 */
export const checkVersion = async ({ retries = 2, timeout = 8000 } = {}) => {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await axios.get(`${API_BASE_URL}/api/version`, {
        timeout,
        headers: { 'Cache-Control': 'no-cache' },
      });
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError;
};

/** 로그인 방식 — 'ad'(사번 + 회사 PC 비밀번호) | 'employee_id'(사번만). 옛 서버(404)면 사번만. */
export const getLoginOptions = async () => {
  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/login/options`, { timeout: 5000 });
    return data?.auth_mode === 'ad' ? 'ad' : 'employee_id';
  } catch {
    return 'employee_id';
  }
};

/** 로그인 — password 는 AD 모드일 때만 보낸다(저장하지 않는다) */
export const login = (employee_id, password) =>
  axios.post(`${API_BASE_URL}/api/login`, password ? { employee_id, password } : { employee_id });

/** 회원가입 */
export const register = (payload) =>
  axios.post(`${API_BASE_URL}/api/register`, payload);

/** 현재 세션의 접속 컨텍스트(IP 등) */
export const getSessionContext = () =>
  axios.get(`${API_BASE_URL}/api/session/context`, { headers: getAuthHeaders() });
