// 관리자 웹 콘솔 — WorkBench.exe 없이 크롬에서 관리 화면을 쓴다(145 /admin/).
// 화면은 exe 와 같은 페이지 컴포넌트를 그대로 쓰고, 틀(사이드바·머리)만 콘솔 전용이다.
// 입구 검사 = GET /api/admin-console/access (is_admin + ADMIN_CONSOLE_VIEWERS). 관리 API 는 exe 와 같아 is_admin 만 본다.
// exe 의 관리자 비밀번호 게이트(AdminPasswordGateModal)는 넣지 않는다 — 화면 쪽 확인일 뿐이고 입구 검사가 더 좁다.
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  BarChart3, FolderSearch, History, Lightbulb, LineChart, LogOut, Megaphone,
  RefreshCw, Settings, ShieldAlert, ShieldX, SlidersHorizontal,
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import { getAuthHeaders, getSessionToken } from '../utils/auth';
import { isWorkbenchAxiosRequest } from '../utils/workbenchRequest';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { NavigationProvider, useNavigation } from '../contexts/NavigationContext';
import { ToastProvider } from '../contexts/ToastContext';
import { NetworkProvider } from '../contexts/NetworkContext';
import { PreferencesProvider } from '../contexts/PreferencesContext';
import { RecentActivityProvider } from '../contexts/RecentActivityContext';
import { DashboardProvider } from '../contexts/DashboardContext';
import ChatDock from '../components/chat/ChatDock';
import {
  CONSOLE_SECTIONS, LAST_MENU_KEY, LOGGED_OUT_KEY,
  activeConsoleItem, consoleTitle, isConsoleMenu, resolveStartMenu,
} from '../utils/adminConsole';
import AdminLogin from './AdminLogin';

const UserManagement = lazy(() => import('../pages/Administration/UserManagement'));
const AnalysisManagement = lazy(() => import('../pages/Administration/AnalysisManagement'));
const AllProjects = lazy(() => import('../pages/Administration/AllProjects'));
const UsageReports = lazy(() => import('../pages/Administration/UsageReports'));
const SystemSettings = lazy(() => import('../pages/Administration/SystemSettings'));
const AppSettings = lazy(() => import('../pages/Administration/AppSettings'));
const AppCommunityManagement = lazy(() => import('../pages/Administration/AppCommunityManagement'));
const ApiApps = lazy(() => import('../pages/Administration/ApiApps'));
const UpdateHistory = lazy(() => import('../pages/Administration/UpdateHistory'));
const DevelopmentHistory = lazy(() => import('../pages/Administration/DevelopmentHistory'));
const AdminTabHub = lazy(() => import('../components/admin/AdminTabHub'));
const NoticeBoard = lazy(() => import('../pages/Support/NoticeBoard'));
const UserRequests = lazy(() => import('../pages/Support/UserRequests'));

const ICONS = {
  'User Management': ShieldAlert,
  'Analysis Management': BarChart3,
  'All Projects': FolderSearch,
  'Usage Reports': LineChart,
  'System Management': Settings,
  'App Settings': SlidersHorizontal,
  History,
  'Notice & Updates': Megaphone,
  'User Requests': Lightbulb,
};

const PENDING_POLL_MS = 60 * 1000;
const PHASE = { LOGIN: 'login', CHECKING: 'checking', DENIED: 'denied', MAIN: 'main' };

const readLocal = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

function renderPage(menu) {
  switch (menu) {
    case 'User Management': return <UserManagement />;
    case 'Analysis Management': return <AnalysisManagement />;
    case 'All Projects': return <AllProjects />;
    case 'Usage Reports': return <UsageReports />;
    case 'System Management': return <SystemSettings />;
    case 'App Settings':
    case 'App Community':
    case 'API Apps':
      return (
        <AdminTabHub
          group="App Settings"
          renderTab={(tab) => {
            if (tab === 'App Community') return <AppCommunityManagement />;
            if (tab === 'API Apps') return <ApiApps />;
            return <AppSettings />;
          }}
        />
      );
    case 'History':
    case 'Update History':
    case 'Development History':
      return (
        <AdminTabHub
          group="History"
          renderTab={(tab) => (tab === 'Development History' ? <DevelopmentHistory /> : <UpdateHistory />)}
        />
      );
    case 'Notice & Updates': return <NoticeBoard />;
    case 'Feature Requests':
    case 'User Requests': return <UserRequests />;
    default: return <UserManagement />;
  }
}

const PageFallback = () => (
  <div className="flex h-full min-h-[360px] items-center justify-center text-sm text-slate-500">
    화면을 불러오는 중입니다…
  </div>
);

function ConsoleShell({ user, pending, onLogout }) {
  const { currentMenu, setCurrentMenu } = useNavigation();
  const active = activeConsoleItem(currentMenu);

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800">
      <aside className="flex w-56 shrink-0 flex-col bg-brand-blue text-white">
        <div className="flex h-14 items-center gap-2 border-b border-brand-blue-dark px-4">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-7 w-7 object-contain" />
          <span className="text-sm font-extrabold">Hi-TESS 관리</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-4" aria-label="관리 메뉴">
          {CONSOLE_SECTIONS.map((section) => (
            <div key={section.category} className="mb-4">
              <div className="px-5 pb-1.5 text-[11px] font-bold text-slate-300">{section.category}</div>
              <ul>
                {section.items.map((menu) => {
                  const Icon = ICONS[menu] || Settings;
                  const isActive = active === menu;
                  const badge = menu === 'User Management' ? pending : 0;
                  return (
                    <li key={menu}>
                      <button
                        type="button"
                        onClick={() => setCurrentMenu(menu)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`relative flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-accent/70 ${
                          isActive ? 'bg-white/10 font-bold text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-brand-accent" />}
                        <Icon size={18} className={isActive ? 'text-brand-accent' : ''} />
                        <span className="truncate">{menu}</span>
                        {badge > 0 && (
                          <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-none text-white">
                            {badge > 99 ? '99+' : badge}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-brand-blue-dark p-3 text-xs text-slate-300">
          <div className="truncate font-bold text-white">{user?.name || user?.employee_id}</div>
          <div className="truncate">{user?.employee_id}</div>
          <button
            type="button"
            onClick={onLogout}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded bg-white/5 px-2 py-1.5 text-white transition-colors hover:bg-white/10 cursor-pointer"
          >
            <LogOut size={14} /> 로그아웃
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Suspense fallback={<PageFallback />}>{renderPage(currentMenu)}</Suspense>
      </main>
      <ChatDock currentUserId={user?.employee_id} isAdmin />
    </div>
  );
}

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

function ConsoleInner() {
  const { user, login: authLogin, logout: authLogout } = useAuth();
  const { currentMenu, resetNavigation } = useNavigation();
  const [phase, setPhase] = useState(() => (user && getSessionToken() ? PHASE.CHECKING : PHASE.LOGIN));
  const [pending, setPending] = useState(0);
  const [checkError, setCheckError] = useState('');

  const logout = useCallback(({ manual = false } = {}) => {
    if (manual) {
      // /api/logout 이 아니라 콘솔 토큰 하나만 지운다 — /api/logout 은 exe 의 외부 App 세션·접속 표시까지 닫는다.
      axios.post(`${API_BASE_URL}/api/admin-console/logout`, null, { headers: getAuthHeaders() }).catch(() => {});
      try { sessionStorage.setItem(LOGGED_OUT_KEY, '1'); } catch { /* 무시 */ }
    }
    authLogout();
    setPending(0);
    setPhase(PHASE.LOGIN);
  }, [authLogout]);

  // 입구 검사 — 로그인 직후와 새로 고침 때.
  const checkAccess = useCallback(async () => {
    setPhase(PHASE.CHECKING);
    setCheckError('');
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/admin-console/access`, { headers: getAuthHeaders() });
      if (!data?.allowed) { setPhase(PHASE.DENIED); return; }
      resetNavigation(resolveStartMenu(window.location.search, readLocal(LAST_MENU_KEY)));
      // 주소의 ?menu= 는 한 번만 쓴다(새로 고침 때 마지막 화면이 이기게).
      if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
      setPhase(PHASE.MAIN);
    } catch (err) {
      if (err?.response?.status === 401) { logout(); return; }
      setCheckError(err?.response ? `서버 오류 ${err.response.status}` : '서버에 연결하지 못했습니다.');
    }
  }, [logout, resetNavigation]);

  useEffect(() => {
    if (phase === PHASE.CHECKING && !checkError) checkAccess();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // WorkBench 요청에 세션 토큰을 붙이고, 401 이면 로그인 화면으로(exe App.jsx 와 같은 규칙).
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
      if (error.response?.status === 401 && isWorkbenchAxiosRequest(error.config, API_BASE_URL) && phase === PHASE.MAIN) {
        logout();
      }
      return Promise.reject(error);
    });
    const onExpired = () => { if (phase === PHASE.MAIN) logout(); };
    window.addEventListener('session-expired', onExpired);
    return () => {
      axios.interceptors.request.eject(req);
      axios.interceptors.response.eject(res);
      window.removeEventListener('session-expired', onExpired);
    };
  }, [phase, logout]);

  // 가입 승인 대기 수 — 사이드바 배지와 탭 제목.
  const refreshPending = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/admin-console/pending-count`, { headers: getAuthHeaders() });
      setPending(Number(data?.pending) || 0);
    } catch { /* 다음 주기에 다시 */ }
  }, []);

  useEffect(() => {
    if (phase !== PHASE.MAIN) return undefined;
    refreshPending();
    const timer = setInterval(refreshPending, PENDING_POLL_MS);
    const onChanged = () => refreshPending();
    window.addEventListener('workbench:pending-users-changed', onChanged);
    window.addEventListener('focus', onChanged);
    return () => {
      clearInterval(timer);
      window.removeEventListener('workbench:pending-users-changed', onChanged);
      window.removeEventListener('focus', onChanged);
    };
  }, [phase, refreshPending]);

  // 접속 하트비트는 보내지 않는다 — 접속 표시·이력이 사용자당 한 줄이라 exe 와 번갈아 덮어써
  // 화면별 사용 시간이 섞인다(커밋 전 리뷰 2026-11-18). 그래서 콘솔에 있는 동안은 '접속 중'에 안 보일 수 있다.

  // 화면이 다른 화면으로 보내는 이벤트(토스트 '승인하러 가기' 등) — 콘솔 메뉴만 받는다.
  const { setCurrentMenu } = useNavigation();
  useEffect(() => {
    const onNavigate = (e) => {
      const menu = e.detail?.menu;
      if (isConsoleMenu(menu)) setCurrentMenu(menu);
    };
    window.addEventListener('workbench:navigate', onNavigate);
    return () => window.removeEventListener('workbench:navigate', onNavigate);
  }, [setCurrentMenu]);

  useEffect(() => {
    if (phase !== PHASE.MAIN) return;
    if (isConsoleMenu(currentMenu)) {
      try { localStorage.setItem(LAST_MENU_KEY, currentMenu); } catch { /* 무시 */ }
    }
    document.title = consoleTitle(currentMenu, pending);
  }, [phase, currentMenu, pending]);

  if (phase === PHASE.LOGIN) {
    return (
      <AdminLogin
        onSuccess={(userObj, token) => {
          authLogin(userObj, token);
          checkAccess();
        }}
      />
    );
  }
  if (phase === PHASE.CHECKING) {
    return (
      <Centered
        icon={checkError ? RefreshCw : null}
        title={checkError ? '권한을 확인하지 못했습니다' : '권한을 확인하는 중입니다…'}
        body={checkError}
      >
        {checkError && (
          <button type="button" onClick={checkAccess} className="mt-4 rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white cursor-pointer">
            다시 시도
          </button>
        )}
      </Centered>
    );
  }
  if (phase === PHASE.DENIED) {
    return (
      <Centered icon={ShieldX} title="이 페이지를 쓸 권한이 없습니다" body="관리 기능은 WorkBench 앱의 관리자 메뉴를 쓰세요.">
        <button type="button" onClick={() => logout({ manual: true })} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 cursor-pointer">
          로그아웃
        </button>
      </Centered>
    );
  }
  return <ConsoleShell user={user} pending={pending} onLogout={() => logout({ manual: true })} />;
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <NavigationProvider>
        <ToastProvider>
          <NetworkProvider>
            <PreferencesProvider>
              <RecentActivityProvider>
                <DashboardProvider>
                  <ConsoleInner />
                </DashboardProvider>
              </RecentActivityProvider>
            </PreferencesProvider>
          </NetworkProvider>
        </ToastProvider>
      </NavigationProvider>
    </AuthProvider>
  );
}
