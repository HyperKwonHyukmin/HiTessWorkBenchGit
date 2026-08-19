/// <summary>
/// React 애플리케이션의 최상위 라우터(Router) 및 상태 관리자입니다.
/// </summary>
import React, { Suspense, lazy, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { version as CLIENT_VERSION } from '../package.json';
import { checkVersion } from './api/auth';
import { reportVersionUpdate, callLogout, logActivity } from './api/activity';
import { sendHeartbeat, beaconOffline } from './api/presence';
import { getUsers } from './api/admin';
import SplashScreen from './pages/auth/SplashScreen';
import LoginScreen from './pages/auth/LoginScreen';
import Layout from './components/layout/Layout';
import { Wand2 } from 'lucide-react';
import { ANALYSIS_DATA, DashboardProvider, getAppMenuName, useAppCatalogue } from './contexts/DashboardContext';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { RecentActivityProvider } from './contexts/RecentActivityContext';
import UpdateModal from './components/UpdateModal';
import UtilityDock from './components/platform/UtilityDock';
import { ADMIN_MENUS } from './constants/adminMenus';
import { API_BASE_URL } from './config';
import { getSessionToken } from './utils/auth';
import { isWorkbenchAxiosRequest } from './utils/workbenchRequest';

const APP_STATE = { SPLASH: 'splash', LOGIN: 'login', MAIN: 'main' };
const INACTIVITY_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8시간 미활동 시 자동 로그아웃
const ANALYSIS_MENU_FRESH_ENTRY_KEY = 'workbench:analysis-menu-fresh-entry';
const MENU_ENTRY_MAX_AGE_MS = 5000;

const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'));
const MyProjects = lazy(() => import('./pages/analysis/MyProjects'));
const NewAnalysis = lazy(() => import('./pages/analysis/NewAnalysis'));
const SimpleBeamAssessmentPage = lazy(() => import('./pages/analysis/SimpleBeamAssessmentPage'));
const InteractiveApps = lazy(() => import('./pages/analysis/InteractiveApps'));
const NoticeBoard = lazy(() => import('./pages/Support/NoticeBoard'));
const UserGuide = lazy(() => import('./pages/Support/UserGuide'));
const TrussAnalysis = lazy(() => import('./pages/analysis/TrussAnalysis'));
const TrussAssessment = lazy(() => import('./pages/analysis/TrussAssessment'));
const UserRequests = lazy(() => import('./pages/Support/UserRequests'));
const DownloadCenter = lazy(() => import('./pages/Support/DownloadCenter'));
const UserManagement = lazy(() => import('./pages/Administration/UserManagement'));
const SystemSettings = lazy(() => import('./pages/Administration/SystemSettings'));
const AnalysisManagement = lazy(() => import('./pages/Administration/AnalysisManagement'));
const UsageReports = lazy(() => import('./pages/Administration/UsageReports'));
const AppCommunityManagement = lazy(() => import('./pages/Administration/AppCommunityManagement'));
const AppSettings = lazy(() => import('./pages/Administration/AppSettings'));
const BdfScanner = lazy(() => import('./pages/analysis/BdfScanner'));
const DrawingToAnalysis = lazy(() => import('./pages/analysis/DrawingToAnalysis'));
const ParametricApps = lazy(() => import('./pages/analysis/ParametricApps'));
const ProductivityApps = lazy(() => import('./pages/analysis/ProductivityApps'));
const MastPostAssessment = lazy(() => import('./pages/analysis/MastPostAssessment'));
const JibRestAssessment = lazy(() => import('./pages/analysis/JibRestAssessment'));
const ColumnBucklingCalculator = lazy(() => import('./pages/analysis/ColumnBucklingCalculator'));
const HoleFatigueAssessment = lazy(() => import('./pages/analysis/HoleFatigueAssessment'));
const DTypeLugAssessment = lazy(() => import('./pages/analysis/DTypeLugAssessment'));
const CarlingCalculator = lazy(() => import('./pages/analysis/CarlingCalculator'));
const IndependentTankAssessment = lazy(() => import('./pages/analysis/IndependentTankAssessment'));
const SectionPropertyCalculator = lazy(() => import('./pages/analysis/SectionPropertyCalculator'));
const PlateStructureAnalysis = lazy(() => import('./pages/analysis/PlateStructureAnalysis'));
const ApiApps = lazy(() => import('./pages/Administration/ApiApps'));
const HiTessModelBuilder = lazy(() => import('./pages/analysis/HiTessModelBuilder'));
const GroupModuleUnitLiftingAnalysis = lazy(() => import('./pages/analysis/GroupModuleUnitLiftingAnalysis'));
const SidePassageAssessment = lazy(() => import('./pages/analysis/SidePassageAssessment'));
const F06ParserPage = lazy(() => import('./pages/analysis/F06ParserPage'));
const HullAccelerationPage = lazy(() => import('./pages/analysis/HullAccelerationPage'));
const AnalysisReportGenerator = lazy(() => import('./pages/analysis/AnalysisReportGenerator'));
const HpScrAssessment = lazy(() => import('./pages/analysis/HpScrAssessment'));
const DoublePipeFuelLineAssessment = lazy(() => import('./pages/analysis/DoublePipeFuelLineAssessment'));
const MooringFittingAssessment = lazy(() => import('./pages/analysis/MooringFittingAssessment'));
const BlockWeldAssessment = lazy(() => import('./pages/analysis/BlockWeldAssessment'));
const HeavyBlockLiftingSimulation = lazy(() => import('./pages/analysis/HeavyBlockLiftingSimulation'));
const ModelLibrary = lazy(() => import('./pages/analysis/ModelLibrary'));

const KEEP_ALIVE_MENUS = new Set(
  ANALYSIS_DATA
    .filter(app => app.hasPage)
    .map(app => getAppMenuName(app.title))
);

const PageFallback = () => (
  <div className="h-full min-h-[360px] flex items-center justify-center text-slate-400 text-sm">
    <div className="flex flex-col items-center gap-3">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <span>화면을 불러오는 중입니다...</span>
    </div>
  </div>
);

/** 관리자가 사용 중지한 App 에 들어왔을 때의 안내 화면. */
const BlockedAppNotice = ({ app, block, onBack }) => {
  const isMaintenance = block?.reason === 'maintenance';
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
      <div className={`mb-4 rounded-full p-6 ${isMaintenance ? 'bg-amber-50' : 'bg-blue-50'}`}>
        <Wand2 size={48} className={`opacity-20 ${isMaintenance ? 'text-amber-500' : 'text-blue-500'}`} />
      </div>
      <p className="text-lg font-bold text-slate-700">{app.title}</p>
      <p className="mt-1 max-w-md whitespace-pre-wrap text-sm">
        {isMaintenance
          ? block.message
          : '이 앱은 현재 준비 중으로 관리자만 사용할 수 있습니다.'}
      </p>
      <button
        onClick={onBack}
        className="mt-6 cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700"
      >
        대시보드로 돌아가기
      </button>
    </div>
  );
};

function AppInner() {
  const [appState, setAppState]           = useState(APP_STATE.SPLASH);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion]     = useState('');
  const [cachedAppMenus, setCachedAppMenus] = useState([]);
  const [analysisPageInstanceKeys, setAnalysisPageInstanceKeys] = useState({});
  const isLoggingOutRef = useRef(false);
  const { currentMenu, setCurrentMenu, goBack, goForward, canGoBack, canGoForward, resetNavigation } = useNavigation();
  const { showToast } = useToast();
  // AuthContext 가 localStorage 세션 키 4종 정리 + state 갱신을 캡슐화한다.
  // 본 컴포넌트는 setAppState/resetNavigation 같은 라우팅 부수 효과만 담당한다.
  const { logout: authLogout, user: authUser } = useAuth();
  const isAdmin = !!authUser?.is_admin;
  // 관리자가 App Settings 에서 내린 사용 중지 판정 — renderPage 의 단일 게이트에 쓴다.
  const {
    apps: appCatalogue,
    getBlock: appBlockOf,
    isBlockedFor: isAppBlocked,
  } = useAppCatalogue();

  // 승인 대기 사용자 수 — 사이드바 뱃지 + 로그인 시 토스트 알림.
  const [pendingUserCount, setPendingUserCount] = useState(0);
  const pendingToastShownForRef = useRef(null); // user_login_at 기준 중복 토스트 방지

  const refreshPendingUserCount = useCallback(async () => {
    if (!isAdmin) { setPendingUserCount(0); return 0; }
    try {
      const res = await getUsers();
      const count = (res.data || []).filter(u => !u.is_active).length;
      setPendingUserCount(count);
      return count;
    } catch {
      return null; // 조용히 무시 — 다음 폴링/이벤트에서 복구
    }
  }, [isAdmin]);

  // 관리자 진입(로그인/세션 복원) 시 1회 토스트 + 주기 폴링 + 목록 변경 이벤트 반영.
  useEffect(() => {
    if (appState !== APP_STATE.MAIN || !isAdmin) {
      setPendingUserCount(0);
      return;
    }
    let cancelled = false;
    const initialLoad = async () => {
      const count = await refreshPendingUserCount();
      if (cancelled || count == null) return;
      const loginAt = localStorage.getItem('user_login_at') || '';
      if (count > 0 && pendingToastShownForRef.current !== loginAt) {
        pendingToastShownForRef.current = loginAt;
        showToast(
          `신규 가입 요청 ${count}명이 승인을 기다리고 있습니다.`,
          'warning',
          8000,
          {
            onClick: () => window.dispatchEvent(new CustomEvent('workbench:navigate', { detail: { menu: 'User Management' } })),
            actionLabel: '승인하러 가기',
          }
        );
      }
    };
    initialLoad();
    const timer = setInterval(refreshPendingUserCount, 60000);
    const onChanged = () => refreshPendingUserCount();
    window.addEventListener('workbench:pending-users-changed', onChanged);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('workbench:pending-users-changed', onChanged);
    };
  }, [appState, isAdmin, refreshPendingUserCount, showToast]);

  const handleSplashFinish = async () => {
    // 세션 여부와 무관하게 항상 버전 체크 먼저 수행
    try {
      const res = await checkVersion();
      const serverVersion = res.data?.version;
      if (serverVersion && serverVersion !== CLIENT_VERSION) {
        const storedUser = localStorage.getItem('user');
        const employeeId = storedUser ? JSON.parse(storedUser).employee_id : null;
        reportVersionUpdate(CLIENT_VERSION, serverVersion, employeeId);
        setLatestVersion(serverVersion);
        setUpdateAvailable(true);
        return;
      }
    } catch {
      // 서버 응답 없으면 로그인 화면으로
      setAppState(APP_STATE.LOGIN);
      return;
    }

    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      // 당일 로그인 여부 확인 — 새 날이면 수동 로그인 요구
      const loginAt = parseInt(localStorage.getItem('user_login_at') || '0', 10);
      const loginDate = new Date(loginAt);
      const today = new Date();
      const isSameDay =
        loginAt > 0 &&
        loginDate.getFullYear() === today.getFullYear() &&
        loginDate.getMonth() === today.getMonth() &&
        loginDate.getDate() === today.getDate();

      if (!isSameDay) {
        authLogout();
        setAppState(APP_STATE.LOGIN);
        return;
      }

      // 장시간 미활동 체크 — 마지막 활동 시간 기준 8시간 초과 시 재로그인 요구
      const lastActive = parseInt(localStorage.getItem('user_last_active') || loginAt.toString(), 10);
      if (Date.now() - lastActive > INACTIVITY_TIMEOUT_MS) {
        callLogout();
        authLogout();
        setAppState(APP_STATE.LOGIN);
        return;
      }

      setAppState(APP_STATE.MAIN);
    } else {
      setAppState(APP_STATE.LOGIN);
    }
  };

  const handleLogout = ({ forgetEmployeeId = false } = {}) => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;
    setCachedAppMenus([]);
    callLogout();
    authLogout({ forgetEmployeeId });
    setAppState(APP_STATE.LOGIN);
    resetNavigation('Dashboard');
  };

  useEffect(() => {
    if (appState !== APP_STATE.MAIN || !KEEP_ALIVE_MENUS.has(currentMenu)) return;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(ANALYSIS_MENU_FRESH_ENTRY_KEY) || 'null');
      if (parsed?.menu === currentMenu && Date.now() - Number(parsed.at || 0) <= MENU_ENTRY_MAX_AGE_MS) {
        setCachedAppMenus(prev => prev.filter(menu => menu !== currentMenu));
        return;
      }
    } catch {
      // ignore malformed navigation hints
    }
    setCachedAppMenus(prev => (
      prev.includes(currentMenu) ? prev : [...prev, currentMenu]
    ));
  }, [appState, currentMenu]);

  useEffect(() => {
    const handleFreshEntry = (event) => {
      const menu = event.detail?.menu;
      if (!KEEP_ALIVE_MENUS.has(menu)) return;
      setCachedAppMenus(prev => prev.filter(item => item !== menu));
      setAnalysisPageInstanceKeys(prev => ({
        ...prev,
        [menu]: (prev[menu] || 0) + 1,
      }));
    };

    window.addEventListener('workbench:analysis-fresh-entry', handleFreshEntry);
    return () => window.removeEventListener('workbench:analysis-fresh-entry', handleFreshEntry);
  }, []);

  // 세션 만료(401) 자동 로그아웃 인터셉터 — axios 요청용
  useEffect(() => {
    // 해석 페이지별로 인증 헤더를 빠뜨리지 않도록 WorkBench 백엔드 요청에
    // 세션 토큰을 중앙에서 부착한다. 외부 origin에는 토큰을 보내지 않는다.
    const requestInterceptor = axios.interceptors.request.use((config) => {
      const token = getSessionToken();
      if (token && isWorkbenchAxiosRequest(config, API_BASE_URL)) {
        config.headers = config.headers || {};
        if (!config.headers.Authorization) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
      return config;
    });
    const responseInterceptor = axios.interceptors.response.use(
      (res) => res,
      (error) => {
        const isWorkbenchUnauthorized =
          error.response?.status === 401 &&
          isWorkbenchAxiosRequest(error.config, API_BASE_URL);
        if (isWorkbenchUnauthorized && appState === APP_STATE.MAIN) {
          handleLogout();
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [appState]);

  // 세션 만료(401) 자동 로그아웃 — fetch 요청용 (session-expired 커스텀 이벤트)
  useEffect(() => {
    const onSessionExpired = () => {
      if (appState === APP_STATE.MAIN) handleLogout();
    };
    window.addEventListener('session-expired', onSessionExpired);
    return () => window.removeEventListener('session-expired', onSessionExpired);
  }, [appState]);

  // MAIN 상태에서 5분마다 서버 버전 체크 — 불일치 시 자동 로그아웃
  useEffect(() => {
    if (appState !== APP_STATE.MAIN) return;

    const poll = setInterval(async () => {
      // 미활동 타임아웃 체크
      const loginAt = parseInt(localStorage.getItem('user_login_at') || '0', 10);
      const lastActive = parseInt(localStorage.getItem('user_last_active') || loginAt.toString(), 10);
      if (lastActive > 0 && Date.now() - lastActive > INACTIVITY_TIMEOUT_MS) {
        clearInterval(poll);
        handleLogout();
        return;
      }

      try {
        const res = await checkVersion();
        const serverVersion = res.data?.version;
        if (serverVersion && serverVersion !== CLIENT_VERSION) {
          clearInterval(poll);
          const storedUser = localStorage.getItem('user');
          const employeeId = storedUser ? JSON.parse(storedUser).employee_id : null;
          reportVersionUpdate(CLIENT_VERSION, serverVersion, employeeId);
          setLatestVersion(serverVersion);
          setUpdateAvailable(true);
        }
      } catch {
        // 서버 일시 다운은 무시 (401 인터셉터가 별도 처리)
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(poll);
  }, [appState]);

  // 사용자 활동 감지 — 클릭/키 입력 시 마지막 활동 시간 갱신 (throttle: 60초)
  useEffect(() => {
    if (appState !== APP_STATE.MAIN) return;
    let lastUpdate = 0;
    const updateLastActive = () => {
      const now = Date.now();
      if (now - lastUpdate > 60_000) {
        localStorage.setItem('user_last_active', String(now));
        lastUpdate = now;
      }
    };
    window.addEventListener('click', updateLastActive);
    window.addEventListener('keydown', updateLastActive);
    return () => {
      window.removeEventListener('click', updateLastActive);
      window.removeEventListener('keydown', updateLastActive);
    };
  }, [appState]);

  // 실시간 접속 하트비트 — MAIN 상태에서 45초 주기 + 페이지 이동 시 즉시 전송.
  // currentMenu 를 deps 에 넣어 페이지가 바뀔 때마다 effect 가 재실행되며,
  // 즉시 하트비트를 보내 관리자 화면에 '무엇을 사용 중인지'가 실시간 반영된다.
  // user_last_active(클릭/키입력 시각) 기준 유휴 경과초를 함께 보내 유휴/활성을 구분한다.
  useEffect(() => {
    if (appState !== APP_STATE.MAIN) return;
    const beat = () => {
      const loginAt = parseInt(localStorage.getItem('user_login_at') || '0', 10);
      const lastActive = parseInt(localStorage.getItem('user_last_active') || (loginAt ? String(loginAt) : '0'), 10);
      const idleSeconds = lastActive > 0 ? Math.max(0, Math.floor((Date.now() - lastActive) / 1000)) : 0;
      sendHeartbeat(currentMenu, idleSeconds, CLIENT_VERSION);
    };
    beat();
    const heartbeat = setInterval(beat, 45 * 1000);
    return () => clearInterval(heartbeat);
  }, [appState, currentMenu]);

  // 앱 종료(창 닫기) 시 sendBeacon 으로 즉시 오프라인 처리 — '유령 온라인'(하트비트 정지
  // 후 임계시간까지 접속 중으로 남는 문제)을 방지한다. appState 기준이라 재실행이 잦지 않다.
  useEffect(() => {
    if (appState !== APP_STATE.MAIN) return;
    const handlePageHide = () => beaconOffline();
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [appState]);

  // 전역 키보드 단축키 + 마우스 뒤로/앞으로 버튼
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F5') {
        e.preventDefault();
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
      }
    };
    // 마우스 버튼 3 = 뒤로, 버튼 4 = 앞으로 (일반 마우스 사이드 버튼)
    const handleMouseDown = (e) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [goBack, goForward]);

  const renderPage = (menu = currentMenu) => {
    // 차단된 App(개발 중·출시 예정·점검 중)의 단일 렌더 게이트.
    // 카드 클릭에는 각 목록 화면이 안내 모달을 띄우지만, 최근 앱·명령 팔레트·
    // 토스트 링크 등 다른 진입 경로는 setCurrentMenu 로 곧장 들어온다. 화면을
    // 그리는 이 지점에서 한 번 더 막아 모든 경로를 한 곳에서 통제한다.
    const gatedApp = appCatalogue.find(
      app => getAppMenuName(app.title) === menu || app.title === menu,
    );
    if (gatedApp && isAppBlocked(gatedApp, isAdmin)) {
      return (
        <BlockedAppNotice
          app={gatedApp}
          block={appBlockOf(gatedApp)}
          onBack={() => setCurrentMenu('Dashboard')}
        />
      );
    }

    if (ADMIN_MENUS.has(menu) && !isAdmin) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
          <div className="p-6 bg-red-50 rounded-full mb-4">
            <Wand2 size={48} className="opacity-20 text-red-500" />
          </div>
          <p className="text-lg font-bold text-slate-700">관리자 권한이 필요합니다.</p>
          <p className="text-sm">이 페이지는 관리자 승인 사용자만 접근할 수 있습니다.</p>
          <button
            onClick={() => setCurrentMenu('Dashboard')}
            className="mt-6 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
          >
            대시보드로 돌아가기
          </button>
        </div>
      );
    }

    switch (menu) {
      case 'Dashboard': return <Dashboard />;
      case 'My Project':
      case 'My Projects': return <MyProjects />;
      // 'Data Storage' 는 옛 메뉴 이름이다. 최근 방문 기록·명령 팔레트에 남아 있을 수 있어
      // alias 로 계속 받는다(빈 화면 대신 정상 진입).
      case 'Data Storage':
      case 'Model Library': return <ModelLibrary />;
      case 'New Analysis':
      case 'File-Based Apps': return <NewAnalysis />;
      case 'Truss Analysis': return <TrussAnalysis />;
      case 'Truss Structural Assessment': return <TrussAssessment />;
      case 'Mooring Fitting Assessment': return <MooringFittingAssessment />;
      case 'Interactive Apps': return <InteractiveApps />;
      case 'Block Weld Assessment': return <BlockWeldAssessment />;
      case 'Heavy Block Lifting Simulation': return <HeavyBlockLiftingSimulation />;
      case 'Parametric Apps': return <ParametricApps />;
      case 'Mast Post Assessment': return <MastPostAssessment />;
      case 'Jib Rest Assessment': return <JibRestAssessment />;
      case 'Column Buckling Load Calculator': return <ColumnBucklingCalculator />;
      case 'Simplified Hole Fatigue Assessment': return <HoleFatigueAssessment />;
      case 'D Type Lug Assessment': return <DTypeLugAssessment />;
      // key 분리: 같은 컴포넌트의 free↔optimization 전환 시 React 가 상태를 재사용하지 않고
      // 재마운트하도록 강제한다(이전 결과 잔존 방지 + Free→Optimization 입력 이관 초기화 보장).
      case 'Carling Free Calculator': return <CarlingCalculator key="carling-free" variant="free" />;
      case 'Carling Design Optimization': return <CarlingCalculator key="carling-optimization" variant="optimization" />;
      case 'Independent Tank Assessment': return <IndependentTankAssessment />;
      case 'Section Property Calculator': return <SectionPropertyCalculator />;
      case 'Plate Structure Analysis': return <PlateStructureAnalysis />;
      case 'API Apps': return <ApiApps />;
      case 'Component Wizard':
      case 'Simple Beam Assessment':
      case 'Simple Beam Analyzer': return <SimpleBeamAssessmentPage />;
      case 'Notice & Updates': return <NoticeBoard />;
      case 'Feature Requests':
      case 'User Requests': return <UserRequests />;
      case 'User Guide': return <UserGuide />;
      case 'Download Center': return <DownloadCenter />;
      case 'User Management': return <UserManagement />;
      case 'Analysis Management': return <AnalysisManagement />;
      case 'Usage Reports': return <UsageReports />;
      case 'App Community': return <AppCommunityManagement />;
      case 'App Settings': return <AppSettings />;
      case 'System Settings':
      case 'System Management': return <SystemSettings />;
      case 'BDF Scanner': return <BdfScanner />;
      case 'F06 Parser': return <F06ParserPage />;
      case '선급 Rule 기반 선체 가속도 Calculation': return <HullAccelerationPage />;
      case 'Analysis Report Generator': return <AnalysisReportGenerator />;
      case 'Productivity Apps': return <ProductivityApps />;
      case 'HiTESS Model Builder': return <HiTessModelBuilder />;
      case 'Group & Module Unit 권상 구조 해석': return <GroupModuleUnitLiftingAnalysis />;
      case 'Side Passage Assessment': return <SidePassageAssessment />;
      case 'HP-SCR 배관응력 해석': return <HpScrAssessment />;
      case '이중관 구조 연료배관 해석': return <DoublePipeFuelLineAssessment />;
      case 'DrawingToAnalysis': return <DrawingToAnalysis />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <div className="p-6 bg-slate-100 rounded-full mb-4">
              <Wand2 size={48} className="opacity-20" />
            </div>
            <p className="text-lg font-bold text-slate-600">"{menu}"</p>
            <p className="text-sm">해당 페이지는 현재 시스템 최적화 및 개발 진행 중입니다.</p>
            <button
              onClick={() => setCurrentMenu('Dashboard')}
              className="mt-6 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
            >
              대시보드로 돌아가기
            </button>
          </div>
        );
    }
  };

  return (
    <DashboardProvider>
      {updateAvailable && (
        <UpdateModal currentVersion={CLIENT_VERSION} serverVersion={latestVersion} />
      )}
      {appState === APP_STATE.SPLASH && <SplashScreen onFinish={handleSplashFinish} />}
      {appState === APP_STATE.LOGIN && <LoginScreen onLoginSuccess={() => {
        isLoggingOutRef.current = false;
        setAppState(APP_STATE.MAIN);
        logActivity('PAGE_VIEW', { page: currentMenu });
      }} />}
      {appState === APP_STATE.MAIN && (
        <Layout
          onLogout={() => handleLogout({ forgetEmployeeId: true })}
          currentMenu={currentMenu}
          setCurrentMenu={setCurrentMenu}
          goBack={goBack}
          goForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          pendingCount={pendingUserCount}
        >
          <Suspense fallback={<PageFallback />}>
            {(() => {
              const currentIsKeepAlive = KEEP_ALIVE_MENUS.has(currentMenu);
              const keepAliveMenus = currentIsKeepAlive && !cachedAppMenus.includes(currentMenu)
                ? [...cachedAppMenus, currentMenu]
                : cachedAppMenus;

              return (
                <>
                  {!currentIsKeepAlive && renderPage(currentMenu)}
                  {keepAliveMenus.map(menu => (
                    <div
                      key={`${menu}:${analysisPageInstanceKeys[menu] || 0}`}
                      className={menu === currentMenu ? 'h-full' : 'hidden'}
                      aria-hidden={menu === currentMenu ? undefined : true}
                    >
                      {renderPage(menu)}
                    </div>
                  ))}
                </>
              );
            })()}
          </Suspense>
        </Layout>
      )}
      {appState === APP_STATE.MAIN && (
        <UtilityDock currentUserId={authUser?.employee_id} isAdmin={isAdmin} />
      )}
    </DashboardProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationProvider>
        <ToastProvider>
          <NetworkProvider>
            <RecentActivityProvider>
              <AppInner />
            </RecentActivityProvider>
          </NetworkProvider>
        </ToastProvider>
      </NavigationProvider>
    </AuthProvider>
  );
}
