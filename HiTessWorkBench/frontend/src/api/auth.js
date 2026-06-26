import axios from 'axios';
import { API_BASE_URL } from '../config';

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

/** 로그인 */
export const login = (employee_id) =>
  axios.post(`${API_BASE_URL}/api/login`, { employee_id });

/** 회원가입 */
export const register = (payload) =>
  axios.post(`${API_BASE_URL}/api/register`, payload);
