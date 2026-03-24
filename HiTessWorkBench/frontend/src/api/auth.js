import axios from 'axios';
import { API_BASE_URL } from '../config';

/** 서버 버전 확인 */
export const checkVersion = () =>
  axios.get(`${API_BASE_URL}/api/version`);

/** 로그인 */
export const login = (employee_id) =>
  axios.post(`${API_BASE_URL}/api/login`, { employee_id });

/** 회원가입 */
export const register = (payload) =>
  axios.post(`${API_BASE_URL}/api/register`, payload);
