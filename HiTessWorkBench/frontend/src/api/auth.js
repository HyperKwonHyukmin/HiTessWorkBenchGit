import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';
import { deviceActionMessage, deviceSignMessage } from '../utils/deviceLogin';

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

/**
 * 로그인 방식.
 * authMode — 'ad'(사번 + 회사 PC 비밀번호) | 'employee_id'(사번만). 옛 서버(404)면 사번만.
 * windowsLogin — 서버가 회사 PC 계정 자동 로그인을 받는지(2026-11-05 이후 서버만 true).
 */
export const getLoginOptions = async () => {
  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/login/options`, { timeout: 5000 });
    const authMode = data?.auth_mode === 'ad' ? 'ad' : 'employee_id';
    return {
      authMode,
      windowsLogin: authMode === 'ad' && data?.windows_login === true,
      // 회사 도메인에 없는 PC(계열사)의 등록한 PC 로그인 — 2026-11-10 이후 서버만 true
      deviceLogin: authMode === 'ad' && data?.device_login === true,
      // AD 에 없는 테스트 사번(2026-11-12) — 이 사번은 등록한 PC 화면에서도 비밀번호 칸을 연다
      passwordLoginIds: authMode === 'ad' && Array.isArray(data?.password_login_ids)
        ? data.password_login_ids.map((id) => String(id).toUpperCase()) : [],
    };
  } catch {
    return { authMode: 'employee_id', windowsLogin: false, deviceLogin: false, passwordLoginIds: [] };
  }
};

/**
 * 회사 PC 계정 자동 로그인 — Electron main 이 Windows 통합 인증으로 부른다(electron/windows-login.js).
 * 결과 { ok, status, data | detail }. 브라우저·옛 exe 는 null(지원 안 함).
 */
export const windowsLogin = async (employeeId = '') => {
  if (!window.electron?.invoke) return null;
  try {
    // employeeId 를 주면 서버가 Windows 계정과 같을 때만 세션을 만든다(다르면 403 windows_account_mismatch)
    return await window.electron.invoke('auth:windowsLogin', { serverUrl: API_BASE_URL, employeeId });
  } catch {
    return null; // 옛 exe — preload 에 채널이 없다
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

// ── 등록한 PC 로그인(회사 도메인에 없는 계열사 PC, 2026-11-10) ──────────────────
// 열쇠는 Electron main 이 다루고(electron/device-login.js), 서버 요청은 여기서 한다.

/** 이 PC 정보 { supported, localAccount, hostname, osUser }. 브라우저·옛 exe 면 null. */
export const getDeviceInfo = async () => {
  if (!window.electron?.invoke) return null;
  try {
    return await window.electron.invoke('device:info');
  } catch {
    return null; // 옛 exe — preload 에 채널이 없다
  }
};

const deviceOp = (op, employeeId, extra = {}) =>
  window.electron.invoke('device:op', { op, serverUrl: API_BASE_URL, employeeId, ...extra });

const errorOf = (error) => ({ status: error?.response?.status ?? 0, detail: error?.response?.data?.detail ?? '' });

/** 등록 요청(같은 열쇠면 같은 기기 번호와 지금 상태를 돌려준다). 결과 { ok, status, code, deviceId } | { ok:false, status, detail } */
export const enrollDevice = async (employeeId, info) => {
  const key = await deviceOp('ensure', employeeId);
  if (!key?.publicKey) return { ok: false, status: 0, detail: key?.error || 'key_failed' };
  try {
    const { data } = await axios.post(`${API_BASE_URL}/api/login/device/enroll`, {
      employee_id: employeeId, public_key: key.publicKey,
      hostname: info?.hostname || null, os_user: info?.osUser || null,
    });
    await deviceOp('setId', employeeId, { deviceId: data.device_id });
    return {
      ok: true, status: data.status, code: data.confirm_code, deviceId: data.device_id,
      // email = 회사 메일 코드로 직원이 직접 확인 · admin = 관리자 승인(메일 없음·발송 실패·옛 서버)
      verify: data.verify === 'email' ? 'email' : 'admin',
      emailHint: data.email_hint || '', mailFailed: data.mail_failed === true,
    };
  } catch (error) {
    const err = errorOf(error);
    // 해지·거절된 열쇠로 다시 요청 — 열쇠를 버린다(다음 요청은 새 열쇠)
    if (err.status === 409) await deviceOp('forget', employeeId);
    return { ok: false, ...err };
  }
};

/**
 * 등록한 PC 로 로그인. 결과
 *  { ok: true, data } — 세션
 *  { ok: false, status, detail, registered } — registered=false 면 이 PC 에 이 사번의 기기 번호가 없다
 */
export const deviceLogin = async (employeeId) => {
  const saved = await deviceOp('peek', employeeId);
  if (!saved?.deviceId) return { ok: false, status: 0, detail: '', registered: false };
  const attempt = async () => {
    try {
      const { data: challenge } = await axios.post(`${API_BASE_URL}/api/login/device/challenge`, { device_id: saved.deviceId });
      const signed = await deviceOp('sign', employeeId, { message: deviceSignMessage(saved.deviceId, challenge.nonce) });
      if (!signed?.signature) return { ok: false, status: 0, detail: signed?.error || 'sign_failed', registered: true };
      const { data } = await axios.post(`${API_BASE_URL}/api/login/device`, {
        device_id: saved.deviceId, nonce: challenge.nonce, signature: signed.signature,
      });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, registered: true, ...errorOf(error) };
    }
  };
  const first = await attempt();
  // 낡은 문제(409)·서명 불일치(401)는 새 문제로 한 번 더 — 한 번의 실패로 승인된 열쇠를 버리지 않는다.
  if (!first.ok && (first.status === 409 || first.status === 401)) return attempt();
  return first;
};

// 서명이 필요한 요청(메일 코드 확인·다시 보내기) — 문제를 받고 action 글을 서명해 보낸다.
const signedPost = async (employeeId, action, path, extra = {}) => {
  const saved = await deviceOp('peek', employeeId);
  if (!saved?.deviceId) return { ok: false, status: 0, detail: 'no_device' };
  try {
    const { data: challenge } = await axios.post(`${API_BASE_URL}/api/login/device/challenge`, { device_id: saved.deviceId });
    const signed = await deviceOp('sign', employeeId, { message: deviceActionMessage(action, saved.deviceId, challenge.nonce) });
    if (!signed?.signature) return { ok: false, status: 0, detail: signed?.error || 'sign_failed' };
    const { data } = await axios.post(`${API_BASE_URL}${path}`, {
      device_id: saved.deviceId, nonce: challenge.nonce, signature: signed.signature, ...extra,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, ...errorOf(error) };
  }
};

/** 회사 메일로 받은 6자리 코드 확인 → 승인되면 { ok: true } */
export const verifyDeviceCode = (employeeId, code) =>
  signedPost(employeeId, 'verify', '/api/login/device/verify', { code });

/** 코드 다시 보내기(60초에 한 번) → { ok, data: { verify, email_hint, mail_failed } } */
export const resendDeviceCode = (employeeId) =>
  signedPost(employeeId, 'resend', '/api/login/device/resend');

/** 이 PC 의 이 사번 열쇠를 버린다(해지·거절·만료 뒤 새로 등록하려고). */
export const forgetDevice = (employeeId) => deviceOp('forget', employeeId);
