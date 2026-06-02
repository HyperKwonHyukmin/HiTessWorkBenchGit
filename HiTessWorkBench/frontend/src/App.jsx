/// <summary>
/// React 애플리케이션의 최상위 라우터(Router) 및 상태 관리자입니다.
/// </summary>
import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { version as CLIENT_VERSION } from '../package.json';
import { checkVersion } from './api/auth';
import { reportVersionUpdate, callLogout, logActivity } from './api/activity';
import SplashScreen from './pages/auth/SplashScreen';
import LoginScreen from './pages/auth/LoginScreen';
import Layout from './components/layout/Layout';
import { Wand2 } from 'lucide-react';
import { DashboardProvider } from './contexts/DashboardContext';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import UpdateModal from './components/UpdateModal';

const APP_STATE = { SPLASH: 'splash', LOGIN: 'login', MAIN: 'main' };
const INACTIVITY_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8시간 미활동 시 자동 로그아웃

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
const AiAssistantHub = lazy(() => import('./pages/AI/AiAssistantHub'));
const AcademicApps = lazy(() => import('./pages/analysis/AcademicApps'));
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
const F06ParserPage = lazy(() => import('./pages/analysis/F06ParserPage'));
const HpScrAssessment = lazy(() => import('./pages/analysis/HpScrAssessment'));
const MooringFittingAssessment = lazy(() => import('./pages/analysis/MooringFittingAssessment'));

const PageFallback = () => (
  <div className="h-full min-h-[360px] flex items-center justify-center text-slate-400 text-sm">
    <div className="flex flex-col items-center gap-3">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <span>화면을 불러오는 중입니다...</span>
    </div>
  </div>
);

function AppInner() {
  const [appState, setAppState]           = useState(APP_STATE.SPLASH);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion]     = useState('');
  const isLoggingOutRef = useRef(false);
  const { currentMenu, setCurrentMenu, goBack, goForward, canGoBack, canGoForward, resetNavigation } = useNavigation();
  const { showToast } = useToast();
  // AuthContext 가 localStorage 세션 키 4종 정리 + state 갱신을 캡슐화한다.
  // 본 컴포넌트는 setAppState/resetNavigation 같은 라우팅 부수 효과만 담당한다.
  const { logout: authLogout } = useAuth();

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

  const handleLogout = () => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;
    callLogout();
    authLogout();
    setAppState(APP_STATE.LOGIN);
    resetNavigation('Dashboard');
  };

  // 세션 만료(401) 자동 로그아웃 인터셉터 — axios 요청용
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (res) => res,
      (error) => {
        if (error.response?.status === 401 && appState === APP_STATE.MAIN) {
          handleLogout();
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
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

  const renderPage = () => {
    switch (currentMenu) {
      case 'Dashboard': return <Dashboard />;
      case 'My Project':
      case 'My Projects': return <MyProjects />;
      case 'New Analysis':
      case 'File-Based Apps': return <NewAnalysis />;
      case 'Truss Analysis': return <TrussAnalysis />;
      case 'Truss Structural Assessment': return <TrussAssessment />;
      case 'Mooring Fitting Assessment': return <MooringFittingAssessment />;
      case 'Interactive Apps': return <InteractiveApps />;
      case 'Parametric Apps': return <ParametricApps />;
      case 'Academic Apps': return <AcademicApps />;
      case 'Mast Post Assessment': return <MastPostAssessment />;
      case 'Jib Rest Assessment': return <JibRestAssessment />;
      case 'Column Buckling Load Calculator': return <ColumnBucklingCalculator />;
      case 'Simplified Hole Fatigue Assessment': return <HoleFatigueAssessment />;
      case 'D Type Lug Assessment': return <DTypeLugAssessment />;
      case 'Carling Free Calculator': return <CarlingCalculator variant="free" />;
      case 'Carling Design Optimization': return <CarlingCalculator variant="optimization" />;
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
      case 'System Settings':
      case 'System Management': return <SystemSettings />;
      case 'AI Lab Assistant':
      case 'AI Assistant':
      case 'AI Based Apps': return <AiAssistantHub />;

      case 'BDF Scanner': return <BdfScanner />;
      case 'F06 Parser': return <F06ParserPage />;
      case 'Productivity Apps': return <ProductivityApps />;
      case 'HiTESS Model Builder': return <HiTessModelBuilder />;
      case 'Group & Module Unit 권상 구조 해석': return <GroupModuleUnitLiftingAnalysis />;
      case 'HP-SCR 배관응력 해석': return <HpScrAssessment />;
      case 'DrawingToAnalysis': return <DrawingToAnalysis />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <div className="p-6 bg-slate-100 rounded-full mb-4">
              <Wand2 size={48} className="opacity-20" />
            </div>
            <p className="text-lg font-bold text-slate-600">"{currentMenu}"</p>
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
          onLogout={handleLogout}
          currentMenu={currentMenu}
          setCurrentMenu={setCurrentMenu}
          goBack={goBack}
          goForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
        >
          <Suspense fallback={<PageFallback />}>
            {renderPage()}
          </Suspense>
        </Layout>
      )}
    </DashboardProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationProvider>
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </NavigationProvider>
    </AuthProvider>
  );
}
