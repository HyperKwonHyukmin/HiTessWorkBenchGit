// 구조해석 자동화 협의체 과제 현황 — 브라우저 틀(로그인, 권한 확인, 머리 띠). 화면 본체는 pages/Administration/AutomationCouncil.jsx(앱과 같음).
// 입구 검사 = GET /api/council/access (is_admin 만). 관리자 콘솔(/admin/)과 달리 ADMIN_CONSOLE_VIEWERS 는 보지 않는다.
import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { LogOut, RefreshCw, ShieldX } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { getAuthHeaders, getSessionToken } from '../utils/auth';
import { isWorkbenchAxiosRequest } from '../utils/workbenchRequest';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { LOGGED_OUT_KEY } from '../utils/adminConsole';
import AdminLogin from '../admin/AdminLogin';
import AutomationCouncil from '../pages/Administration/AutomationCouncil';

const PHASE = { LOGIN: 'login', CHECKING: 'checking', DENIED: 'denied', MAIN: 'main' };

function Centered({ icon: Icon, title, body, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
        {Icon && <Icon size={32} className="mx-auto text-slate-400" />}
        <p className="mt-3 text-base font-bold text-slate-800">{title}</p>
        {body && <p className="mt-1 text-sm text-slate-500">{body}</p>}
        {children}
      </div>
    </div>
  );
}

function CouncilInner() {
  const { user, login: authLogin, logout: authLogout } = useAuth();
  const [phase, setPhase] = useState(() => (user && getSessionToken() ? PHASE.CHECKING : PHASE.LOGIN));
  const [checkError, setCheckError] = useState('');

  const logout = useCallback(({ manual = false } = {}) => {
    if (manual) {
      // 이 토큰 하나만 지운다(/api/logout 은 exe 의 외부 App 세션까지 닫는다 — 관리자 콘솔과 같은 이유).
      axios.post(`${API_BASE_URL}/api/admin-console/logout`, null, { headers: getAuthHeaders() }).catch(() => {});
      try { sessionStorage.setItem(LOGGED_OUT_KEY, '1'); } catch { /* 무시 */ }
    }
    authLogout();
    setPhase(PHASE.LOGIN);
  }, [authLogout]);

  const checkAccess = useCallback(async () => {
    setPhase(PHASE.CHECKING);
    setCheckError('');
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/council/access`, { headers: getAuthHeaders() });
      setPhase(data?.allowed ? PHASE.MAIN : PHASE.DENIED);
    } catch (err) {
      if (err?.response?.status === 401) { logout(); return; }
      setCheckError(err?.response ? `서버 오류 ${err.response.status}` : '서버에 연결하지 못했습니다.');
    }
  }, [logout]);

  useEffect(() => {
    if (phase === PHASE.CHECKING && !checkError) checkAccess();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 요청에 세션 토큰을 붙이고, 401 이면 로그인 화면으로.
  useEffect(() => {
    const req = axios.interceptors.request.use((config) => {
      const token = getSessionToken();
      if (token && isWorkbenchAxiosRequest(config, API_BASE_URL)) {
        config.headers = config.headers || {};
        if (!config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
    const res = axios.interceptors.response.use((r) => r, (error) => {
      if (error.response?.status === 401 && isWorkbenchAxiosRequest(error.config, API_BASE_URL) && phase === PHASE.MAIN) logout();
      return Promise.reject(error);
    });
    return () => {
      axios.interceptors.request.eject(req);
      axios.interceptors.response.eject(res);
    };
  }, [phase, logout]);

  if (phase === PHASE.LOGIN) {
    return (
      <AdminLogin
        title="자동화 협의체 과제 현황"
        subtitle="구조해석 자동화 협의체 과제를 보고 의견을 남기는 페이지입니다. 관리자 계정만 열 수 있습니다."
        onSuccess={(userObj, token) => { authLogin(userObj, token); checkAccess(); }}
      />
    );
  }
  if (phase === PHASE.CHECKING) {
    return (
      <Centered icon={checkError ? RefreshCw : null} title={checkError ? '권한을 확인하지 못했습니다' : '권한을 확인하는 중입니다…'} body={checkError}>
        {checkError && (
          <button type="button" onClick={checkAccess} className="mt-4 rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white cursor-pointer">다시 시도</button>
        )}
      </Centered>
    );
  }
  if (phase === PHASE.DENIED) {
    return (
      <Centered icon={ShieldX} title="이 페이지를 볼 권한이 없습니다" body="관리자 계정만 열 수 있습니다. 권한이 필요하면 Hi-TESS 담당자에게 요청해 주세요.">
        <button type="button" onClick={() => logout({ manual: true })} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 cursor-pointer">로그아웃</button>
      </Centered>
    );
  }
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-brand-blue px-5 text-white">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-7 w-7 object-contain" />
        <span className="text-sm font-extrabold">구조해석 자동화 협의체</span>
        <span className="ml-auto text-xs text-blue-100">{user?.name || user?.employee_id}{user?.position ? ' ' + user.position : ''}</span>
        <button type="button" onClick={() => logout({ manual: true })} className="flex items-center gap-1.5 rounded bg-white/10 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-white/20 cursor-pointer">
          <LogOut size={14} /> 로그아웃
        </button>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-6">
        <AutomationCouncil browser />
      </main>
    </div>
  );
}

export default function CouncilApp() {
  return (
    <AuthProvider>
      <CouncilInner />
    </AuthProvider>
  );
}
