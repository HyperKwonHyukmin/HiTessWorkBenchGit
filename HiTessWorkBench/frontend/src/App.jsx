/// <summary>
/// React 애플리케이션의 최상위 라우터(Router) 및 상태 관리자입니다.
/// </summary>
import React, { useState, useEffect } from 'react';
import { version as CLIENT_VERSION } from '../package.json';
import { checkVersion } from './api/auth';
import SplashScreen from './pages/auth/SplashScreen';
import LoginScreen from './pages/auth/LoginScreen';
import Dashboard from './pages/dashboard/Dashboard';
import MyProjects from './pages/analysis/MyProjects';
import NewAnalysis from './pages/analysis/NewAnalysis';
import Layout from './components/layout/Layout';
import { Wand2 } from 'lucide-react';
import SimpleBeamAssessmentPage from './pages/analysis/SimpleBeamAssessmentPage';
import { DashboardProvider } from './contexts/DashboardContext';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import { ToastProvider } from './contexts/ToastContext';
import InteractiveApps from './pages/analysis/InteractiveApps';
import NoticeBoard from './pages/Support/NoticeBoard';
import UserGuide from './pages/Support/UserGuide';
import TrussAnalysis from './pages/analysis/TrussAnalysis';
import TrussAssessment from './pages/analysis/TrussAssessment';
import UserRequests from './pages/Support/UserRequests';
import UserManagement from './pages/Administration/UserManagement';
import SystemSettings from './pages/Administration/SystemSettings';
import AnalysisManagement from './pages/Administration/AnalysisManagement';
import AiAssistantHub from './pages/AI/AiAssistantHub';
import BdfScanner from './pages/analysis/BdfScanner';
import ParametricApps from './pages/analysis/ParametricApps';
import ProductivityApps from './pages/analysis/ProductivityApps';
import MastPostAssessment from './pages/analysis/MastPostAssessment';
import JibRestAssessment from './pages/analysis/JibRestAssessment';
import ColumnBucklingCalculator from './pages/analysis/ColumnBucklingCalculator';
import ApiApps from './pages/Administration/ApiApps';
import HiTessModelFlow from './pages/analysis/HiTessModelFlow';

const APP_STATE = { SPLASH: 'splash', LOGIN: 'login', MAIN: 'main' };

function AppInner() {
  const [appState, setAppState] = useState(APP_STATE.SPLASH);
  const { currentMenu, setCurrentMenu, goBack, goForward, canGoBack, canGoForward, resetNavigation } = useNavigation();

  const handleSplashFinish = async () => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      // 자동 로그인 만료 체크 (3일)
      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
      const loginAt = parseInt(localStorage.getItem('user_login_at') || '0', 10);
      if (!loginAt || Date.now() - loginAt > THREE_DAYS_MS) {
        localStorage.removeItem('user');
        localStorage.removeItem('user_login_at');
        setAppState(APP_STATE.LOGIN);
        return;
      }

      try {
        const res = await checkVersion();
        const serverVersion = res.data?.version;
        if (serverVersion && serverVersion !== CLIENT_VERSION) {
          localStorage.removeItem('user');
          localStorage.removeItem('user_login_at');
          setAppState(APP_STATE.LOGIN);
          return;
        }
      } catch {
        // 서버 응답 없으면 로그인 화면으로
        setAppState(APP_STATE.LOGIN);
        return;
      }
      setAppState(APP_STATE.MAIN);
    } else {
      setAppState(APP_STATE.LOGIN);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('user_login_at');
    setAppState(APP_STATE.LOGIN);
    resetNavigation('Dashboard');
  };

  // 전역 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (e) => {
      // F5: 새로고침 방지 (Electron에서 페이지 새로고침 대신 뒤로가기)
      if (e.key === 'F5') {
        e.preventDefault();
      }
      // Alt + ← : 뒤로 가기
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      }
      // Alt + → : 앞으로 가기
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
      case 'Interactive Apps': return <InteractiveApps />;
      case 'Parametric Apps': return <ParametricApps />;
      case 'Mast Post Assessment': return <MastPostAssessment />;
      case 'Jib Rest Assessment': return <JibRestAssessment />;
      case 'Column Buckling Load Calculator': return <ColumnBucklingCalculator />;
      case 'API Apps': return <ApiApps />;
      case 'Component Wizard':
      case 'Simple Beam Assessment':
      case 'Simple Beam Analyzer': return <SimpleBeamAssessmentPage />;
      case 'Notice & Updates': return <NoticeBoard />;
      case 'Feature Requests':
      case 'User Requests': return <UserRequests />;
      case 'User Guide': return <UserGuide />;
      case 'User Management': return <UserManagement />;
      case 'Analysis Management': return <AnalysisManagement />;
      case 'System Settings': return <SystemSettings />;
      case 'AI Lab Assistant':
      case 'AI Assistant':
      case 'AI Based Apps': return <AiAssistantHub />;

      case 'BDF Scanner': return <BdfScanner />;
      case 'Productivity Apps': return <ProductivityApps />;
      case 'HiTess ModelFlow': return <HiTessModelFlow />;
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
      {appState === APP_STATE.SPLASH && <SplashScreen onFinish={handleSplashFinish} />}
      {appState === APP_STATE.LOGIN && <LoginScreen onLoginSuccess={() => setAppState(APP_STATE.MAIN)} />}
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
          {renderPage()}
        </Layout>
      )}
    </DashboardProvider>
  );
}

export default function App() {
  return (
    <NavigationProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </NavigationProvider>
  );
}
