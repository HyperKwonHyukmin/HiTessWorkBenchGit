// 관리자 웹 콘솔 로그인 — 브라우저용.
// ① Windows 계정(POST /api/login/windows, 크롬이 Negotiate 를 대신 처리) ② 안 되면 사번 + 회사 PC 비밀번호.
// Windows 로그인은 145 가 이 PC 의 '로컬 인트라넷'에 있어야 크롬이 자격 증명을 보낸다. 그 전에 자동으로 시도하면
// 크롬이 로그인 창을 띄울 수 있어, 한 번 성공한 뒤부터만 화면이 열릴 때 자동으로 시도한다.
import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, Monitor, ShieldCheck } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { login } from '../api/auth';
import { AD_LOGIN_MESSAGES } from '../utils/loginMessages';
import { SAVED_EMPLOYEE_ID_KEY } from '../contexts/AuthContext';
import { LOGGED_OUT_KEY, WINDOWS_LOGIN_OK_KEY } from '../utils/adminConsole';

const readLocal = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const readSession = (key) => { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } };

async function windowsLoginInBrowser() {
  // 본문을 싣지 않는다 — 본문이 있으면 NTLM 세 번째 메시지가 안 가는 경우가 있었다(CLAUDE.md 기록).
  const res = await fetch(`${API_BASE_URL}/api/login/windows`, { method: 'POST', credentials: 'include' });
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  return { ok: res.ok, status: res.status, data };
}

const errorText = (status, detail) => {
  if (AD_LOGIN_MESSAGES[detail]) return AD_LOGIN_MESSAGES[detail];
  if (status === 403) return '승인되지 않은 사용자입니다.';
  if (status === 404) return '등록되지 않은 사번입니다.';
  if (!status) return '서버에 연결하지 못했습니다.';
  return `로그인 오류: ${status}`;
};

export default function AdminLogin({ onSuccess }) {
  const [employeeId, setEmployeeId] = useState(() => readLocal(SAVED_EMPLOYEE_ID_KEY));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');       // '' | 'windows' | 'password'
  const [error, setError] = useState('');
  const triedAuto = useRef(false);

  const finish = (data) => {
    const { token, ...user } = data || {};
    if (!token) { setError('서버 응답에 세션이 없습니다.'); return; }
    try {
      localStorage.setItem(SAVED_EMPLOYEE_ID_KEY, user.employee_id || employeeId.trim());
      sessionStorage.removeItem(LOGGED_OUT_KEY);
    } catch { /* 저장 못 해도 로그인은 진행 */ }
    onSuccess(user, token);
  };

  const tryWindows = async () => {
    setBusy('windows');
    setError('');
    try {
      const res = await windowsLoginInBrowser();
      if (res.ok) {
        try { localStorage.setItem(WINDOWS_LOGIN_OK_KEY, '1'); } catch { /* 무시 */ }
        finish(res.data);
        return;
      }
      try { localStorage.removeItem(WINDOWS_LOGIN_OK_KEY); } catch { /* 무시 */ }
      setError(res.status === 401
        ? 'Windows 계정으로 확인하지 못했습니다. 145 가 이 PC 의 로컬 인트라넷에 등록됐는지 보거나 비밀번호로 로그인하세요.'
        : errorText(res.status, res.data?.detail));
    } catch {
      setError('서버에 연결하지 못했습니다.');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (triedAuto.current) return;
    triedAuto.current = true;
    // 직접 로그아웃한 뒤에는 이 탭에서 다시 자동으로 들어가지 않는다(다른 계정으로 바꿀 수 있게).
    if (readLocal(WINDOWS_LOGIN_OK_KEY) === '1' && readSession(LOGGED_OUT_KEY) !== '1') tryWindows();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitPassword = async (e) => {
    e.preventDefault();
    if (!employeeId.trim() || !password) { setError('사번과 비밀번호를 입력하세요.'); return; }
    setBusy('password');
    setError('');
    try {
      const res = await login(employeeId.trim().toUpperCase(), password);
      setPassword('');
      finish(res.data);
    } catch (err) {
      setPassword('');
      setError(errorText(err?.response?.status, err?.response?.data?.detail));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="flex items-center gap-2 text-brand-blue">
          <ShieldCheck size={22} />
          <h1 className="text-lg font-extrabold">Hi-TESS 관리</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">WorkBench 관리자 전용 페이지입니다.</p>

        <button
          type="button"
          onClick={tryWindows}
          disabled={!!busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-blue-light disabled:opacity-60 cursor-pointer"
        >
          <Monitor size={16} />
          {busy === 'windows' ? '확인 중…' : 'Windows 계정으로 로그인'}
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
          <span className="h-px flex-1 bg-slate-200" />비밀번호로<span className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={submitPassword} className="space-y-3">
          <label className="block text-xs font-bold text-slate-600">
            사번
            <input
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 focus:border-brand-blue focus:outline-none"
            />
          </label>
          <label className="block text-xs font-bold text-slate-600">
            회사 PC 비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 focus:border-brand-blue focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={!!busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <KeyRound size={16} />
            {busy === 'password' ? '확인 중…' : '로그인'}
          </button>
        </form>

        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
