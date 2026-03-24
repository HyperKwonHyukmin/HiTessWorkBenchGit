/// <summary>
/// React 애플리케이션의 최상위 라우터(Router) 및 상태 관리자입니다.
/// </summary>
import React, { useState } from 'react';
import SplashScreen from './pages/auth/SplashScreen';
import LoginScreen from './pages/auth/LoginScreen';
import Dashboard from './pages/dashboard/Dashboard';
import MyProjects from './pages/analysis/MyProjects';
import NewAnalysis from './pages/analysis/NewAnalysis';
import Layout from './components/layout/Layout';
import { Wand2 } from 'lucide-react';
import ComponentWizard from './pages/analysis/ComponentWizard';
import { DashboardProvider } from './contexts/DashboardContext';
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
import HiLabInsight from './pages/AI/HiLabInsight';
import BeamAnalysisViewer from './pages/analysis/BeamAnalysisViewer';

const APP_STATE = { SPLASH: 'splash', LOGIN: 'login', MAIN: 'main' };

function App() {
  const [appState, setAppState] = useState(APP_STATE.SPLASH);
  const [history, setHistory] = useState(['Dashboard']);
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentMenu = history[currentIndex];

  const setCurrentMenu = (menu) => {
    const newHistory = history.slice(0, currentIndex + 1);
    if (newHistory[newHistory.length - 1] !== menu) { 
      newHistory.push(menu);
      setHistory(newHistory);
      setCurrentIndex(newHistory.length - 1);
    }
  };

  const goBack = () => { if (currentIndex > 0) setCurrentIndex(currentIndex - 1); };
  const goForward = () => { if (currentIndex < history.length - 1) setCurrentIndex(currentIndex + 1); };

  const handleSplashFinish = () => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setCurrentMenu('Dashboard');
      setAppState(APP_STATE.MAIN);
    } else {
      setAppState(APP_STATE.LOGIN);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('user');
    setAppState(APP_STATE.LOGIN);
    setHistory(['Dashboard']);
    setCurrentIndex(0);
  };

  const renderPage = () => {
    switch (currentMenu) {
      case 'Dashboard': return <Dashboard setCurrentMenu={setCurrentMenu} />;
      case 'My Project':
      case 'My Projects': return <MyProjects setCurrentMenu={setCurrentMenu} />;
      case 'New Analysis':
      case 'File-Based Apps': return <NewAnalysis setCurrentMenu={setCurrentMenu} />;
      case 'Truss Analysis': return <TrussAnalysis setCurrentMenu={setCurrentMenu} />;
      case 'Truss Structural Assessment': return <TrussAssessment setCurrentMenu={setCurrentMenu} />; 
      case 'Interactive Apps': return <InteractiveApps setCurrentMenu={setCurrentMenu} />;
      case 'Component Wizard':
      case 'Simple Beam Assessment': 
      case 'Simple Beam Analyzer': return <ComponentWizard />;
      case 'Notice & Updates': return <NoticeBoard />;
      case 'Feature Requests': 
      case 'User Requests': return <UserRequests />;
      case 'User Guide': return <UserGuide />;
      case 'User Management': return <UserManagement />;
      case 'Analysis Management': return <AnalysisManagement />;
      case 'System Settings': return <SystemSettings />;
      case 'AI Lab Assistant': 
      case 'AI Assistant': return <AiAssistantHub setCurrentMenu={setCurrentMenu} />;
      case 'Hi-Lab Insight': return <HiLabInsight setCurrentMenu={setCurrentMenu} />;
      case 'Beam Result Viewer': return <BeamAnalysisViewer />;
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
    // 💡 [수정] DashboardProvider에 setCurrentMenu를 전달하여 전역 위젯에서 메뉴 이동이 가능하게 함
    <DashboardProvider setCurrentMenu={setCurrentMenu}>
      {appState === APP_STATE.SPLASH && <SplashScreen onFinish={handleSplashFinish} />}
      {appState === APP_STATE.LOGIN && <LoginScreen onLoginSuccess={() => setAppState(APP_STATE.MAIN)} />}
      {appState === APP_STATE.MAIN && (
        <Layout 
          onLogout={handleLogout} currentMenu={currentMenu} setCurrentMenu={setCurrentMenu}
          goBack={goBack} goForward={goForward} canGoBack={currentIndex > 0} canGoForward={currentIndex < history.length - 1}
        >
          {renderPage()}
        </Layout>
      )}
    </DashboardProvider>
  );
}

export default App;