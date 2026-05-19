/// <summary>
/// 대시보드 및 전체 해석 앱의 메타데이터를 관리하는 전역 Context입니다.
/// (신규) 백그라운드 해석 작업을 추적하고 플로팅 위젯을 제공합니다.
/// (신규) Truss Assessment 페이지 이탈 시에도 상태를 유지하기 위한 글로벌 State를 추가했습니다.
/// </summary>
import React, { createContext, useState, useEffect, useContext } from 'react';
import { UploadCloud, PenTool, SlidersHorizontal, Wrench, RefreshCw, CheckCircle, AlertCircle, X, Bot } from 'lucide-react';
import { useNavigation } from './NavigationContext';
import { usePolling } from '../hooks/usePolling';

export const ANALYSIS_DATA = [
  // ── File-Based Apps (signature: blue) ──────────── Active ──
  { mode: "File", category: "트러스(Truss)", title: "Truss Model Builder", description: "Truss 설계 정보를 활용하여 구조 해석 모델을 구축합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["트러스", "모델생성", "CSV"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "트러스(Truss)", title: "Truss Structural Assessment", description: "Truss BDF 모델을 업로드하여 구조적 안정성을 평가합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["트러스", "구조평가", "BDF"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "파이프라인(Pipeline)", title: "HiTESS Model Builder", description: "CSV부터 Nastran 해석까지 FEM 파이프라인 전 과정을 단일 UI에서 관리합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["CSV", "BDF", "Nastran", "Pipeline"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "배관(Piping)", title: "HP-SCR 배관응력 해석", description: "배관 BDF를 업로드하여 열변형 계산 및 배관응력 해석(PSA · POR)을 수행합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["배관", "PSA", "POR", "BDF"], devStatus: "Active", contributor: "김윤환" },
  // ── File-Based Apps (signature: blue) ─────────── Developing ──
  { mode: "File", category: "권상(Lifting)", title: "Group & Module Unit 권상 구조 해석", description: "Group 및 Module Unit 권상 작업 시 발생하는 구조적 안전성을 사전에 검토합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["유닛", "블록", "국부강도"], devStatus: "Developing", contributor: "권혁민" },
  // ── Interactive Apps (signature: violet) ──────── Active ──
  { mode: "Interactive", category: "1D 빔(Beam)", title: "Simple Beam Assessment", description: "단면 형상과 치수를 직접 입력하여 단순 보(Beam)의 응력 및 변위을 평가합니다.", icon: PenTool, color: "bg-violet-600", tags: ["1D요소", "굽힘응력", "실시간"], devStatus: "Active", contributor: "권혁민" },
  { mode: "Interactive", category: "단면(Section)", title: "Section Property Calculator", description: "단면 형상과 치수를 입력하여 단면 2차 모멘트(I), 단면계수(S), 회전반경(r) 등의 단면 특성값을 산출합니다.", icon: PenTool, color: "bg-violet-600", tags: ["단면", "특성값", "계산"], devStatus: "Active", contributor: "권혁민" },
  // ── Interactive Apps (signature: violet) ──────── Developing ──
  { mode: "Interactive", category: "판 구조(Plate)", title: "Plate Structure Analysis", description: "Plate 구조 해석용 Studio를 실행하여 판 구조 모델링 및 해석 작업을 진행합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Plate", "Studio", "구조해석"], devStatus: "Developing", contributor: "권혁민" },
  // ── Parametric Apps (signature: emerald) ──────── Active ──
  { mode: "Parametric", category: "다빗(Davit)", title: "Jib Rest Assessment", description: "Jib Rest 구조물의 1단/2단 파이프 설계 후보를 산출합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["다빗", "Jib Rest", "1단", "2단"], devStatus: "Active", contributor: "박준석" },
  { mode: "Parametric", category: "다빗(Davit)", title: "Mast Post Assessment", description: "Post 높이와 플랫폼 하중을 입력하여 기준을 만족하는 최적 파이프 후보를 산출합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["다빗", "Post", "파이프선정"], devStatus: "Active", contributor: "박준석" },
  { mode: "Parametric", category: "기둥(Column)", title: "Column Buckling Load Calculator", description: "AISC 기준 핀-핀 경계 조건의 강재 기둥 최대 허용 사용하중을 계산합니다. 동심·편심 하중 모두 지원.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["기둥", "좌굴", "AISC", "Secant"], devStatus: "Active", contributor: "김병훈" },
  { mode: "Parametric", category: "러그(Lug)", title: "D Type Lug Assessment", description: "D-Type 러그의 브라켓 타입별 각도 케이스 강도와 Usage Factor를 계산합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["Lug", "D-Type", "Usage Factor", "Excel"], devStatus: "Active", contributor: "김연태" },
  { mode: "Parametric", category: "카링(Carling)", title: "Carling Free Calculator", description: "하중과 Hull Plate 조건을 입력하여 Carling 설치 필요 여부를 판정합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["Carling", "Free", "Plate", "Excel"], devStatus: "Active", contributor: "박준석" },
  { mode: "Parametric", category: "카링(Carling)", title: "Carling Design Optimization", description: "Carling H/T 범위를 탐색하여 기준을 만족하는 최소 중량 후보를 산출합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["Carling", "Optimization", "Weight", "Excel"], devStatus: "Active", contributor: "박준석" },
  // ── Productivity Apps (signature: amber) ──────── Active ──
  { mode: "Productivity", category: "BDF 도구", title: "BDF Scanner", description: "BDF 모델 파일의 유효성을 검증하고, 선택적으로 Nastran 해석 후 F06 결과를 요약합니다.", icon: Wrench, color: "bg-amber-500", tags: ["BDF", "유효성검증", "Nastran"], devStatus: "Active", contributor: "권혁민", relatedApps: ["F06 Parser", "HiTESS Model Builder"], transferOutputs: [{ key: 'f06', label: 'F06 파일', targetApp: 'F06 Parser' }] },
  { mode: "Productivity", category: "F06 도구", title: "F06 Parser", description: "Nastran SOL 101 F06 파일에서 Displacement, SPC Force, CBAR/CBEAM/CROD 내력·응력을 추출하고 Subcase별 테이블로 조회합니다.", icon: Wrench, color: "bg-amber-500", tags: ["F06", "Nastran", "결과추출", "1D"], devStatus: "Active", contributor: "권혁민", relatedApps: ["BDF Scanner"], acceptsTransferFrom: ['BDF Scanner'] },
  // ── Academic Apps (signature: cyan) ───────────── Developing ──
  { mode: "Academic", category: "AI 기반 해석", title: "GNN 기반 Beam 구조 안정성 검토", description: "Graph Neural Network(GNN)를 활용하여 보(Beam) 구조물의 응력 분포 및 구조적 안정성을 AI 기반으로 평가합니다.", icon: Bot, color: "bg-cyan-600", tags: ["GNN", "AI", "Beam", "구조안정성"], devStatus: "Developing", contributor: "권혁민" },
];

const DashboardContext = createContext();
const FAVORITES_KEY = 'favorites';

function readLocalFavorites() {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(next) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // localStorage 접근이 막힌 환경에서는 Electron preferences 저장만 사용합니다.
  }
}

async function writeElectronFavorites(next) {
  if (!window.electron?.invoke) return;
  try {
    await window.electron.invoke('preferences:set', { favorites: next });
  } catch (e) {
    console.warn('[preferences] favorites save failed:', e);
  }
}

export function DashboardProvider({ children }) {
  const { setCurrentMenu, currentMenu } = useNavigation();
  const [favorites, setFavorites] = useState(() => readLocalFavorites());

  useEffect(() => {
    let cancelled = false;

    const loadFavorites = async () => {
      if (!window.electron?.invoke) return;

      try {
        const result = await window.electron.invoke('preferences:get');
        if (cancelled || !result?.ok) return;

        const preferences = result.preferences || {};
        const hasStoredFavorites = Object.prototype.hasOwnProperty.call(preferences, 'favorites');
        const electronFavorites = Array.isArray(preferences.favorites)
          ? preferences.favorites.filter(item => typeof item === 'string')
          : [];

        if (hasStoredFavorites) {
          setFavorites(electronFavorites);
          writeLocalFavorites(electronFavorites);
          return;
        }

        const localFavorites = readLocalFavorites();
        if (localFavorites.length > 0) {
          setFavorites(localFavorites);
          await writeElectronFavorites(localFavorites);
        }
      } catch (e) {
        console.warn('[preferences] favorites load failed:', e);
      }
    };

    loadFavorites();
    return () => {
      cancelled = true;
    };
  }, []);

  // =========================================================
  // [핵심 추가] Truss Assessment 페이지의 상태를 전역으로 보존
  // =========================================================
  const [assessmentPageState, setAssessmentPageState] = useState({
    bdfFile: null,
    nodes: {},
    elements: [],
    nodeTableData: [],
    elemTableData: [],
    logs: [],
    detailedLogs: [],
    isRunning: false,
    progress: 0,
    statusMessage: '',
    activeTab: '3d',
    currentJobId: null,
    resultJsonData: null,
    activeResultCase: null
  });

  const [modelBuilderPageState, setModelBuilderPageState] = useState(null);

  // 프로그램 간 연계: 다른 앱에서 GMU로 BDF를 바로 전달할 때 사용
  const [gmuHandoff, setGmuHandoff]   = useState(null); // { bdfServerPath, sourceApp }
  const clearGmuHandoff = () => setGmuHandoff(null);

  const [pendingJobTransfer, setPendingJobTransferRaw] = useState(null);
  const setPendingJobTransfer = (payload) => setPendingJobTransferRaw(payload);
  const clearPendingJobTransfer = () => setPendingJobTransferRaw(null);

  const [globalJob, setGlobalJob] = useState(null);
  const [pendingJobId, setPendingJobId] = useState(null);

  const clearGlobalJob = () => {
    setPendingJobId(null);
    setGlobalJob(null);
  };

  const startGlobalJob = (jobId, menuName) => {
    setGlobalJob({ jobId, menu: menuName, status: 'Running', progress: 0, message: '서버에 작업을 요청하는 중...' });
    setPendingJobId(jobId);
  };

  useEffect(() => {
    if (
      globalJob &&
      (globalJob.status === 'Success' || globalJob.status === 'Failed') &&
      globalJob.menu === currentMenu
    ) {
      clearGlobalJob();
    }
  }, [globalJob, currentMenu]);

  usePolling({
    jobId: pendingJobId,
    interval: 1500,
    maxRetries: 120,
    onProgress: (data) => {
      setGlobalJob(prev => {
        if (!prev || prev.jobId !== pendingJobId) return prev;
        return { ...prev, ...data };
      });
    },
    onComplete: (data) => {
      setGlobalJob(prev => prev ? { ...prev, ...data } : prev);
      setPendingJobId(null);
    },
    onError: (err) => {
      setGlobalJob(prev => prev ? { ...prev, status: 'Failed', message: err?.timeout ? '해석 시간 초과 (3분)' : '서버 통신 오류 발생' } : prev);
      setPendingJobId(null);
    }
  });

  const toggleFavorite = (title) => {
    setFavorites(prev => {
      const next = prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title];
      writeLocalFavorites(next);
      writeElectronFavorites(next);
      return next;
    });
  };

  return (
    // [추가] Provider의 value에 assessmentPageState와 setAssessmentPageState를 넘겨줌
    <DashboardContext.Provider value={{
        favorites, toggleFavorite,
        globalJob, startGlobalJob, clearGlobalJob,
        assessmentPageState, setAssessmentPageState,
        modelBuilderPageState, setModelBuilderPageState,
        gmuHandoff, setGmuHandoff, clearGmuHandoff,
        pendingJobTransfer, setPendingJobTransfer, clearPendingJobTransfer
    }}>
      {children}

      {/* 글로벌 해석 추적 위젯 (화면 우측 하단 고정) */}
      {globalJob && (
        <div 
          onClick={() => setCurrentMenu && setCurrentMenu(globalJob.menu)}
          className="fixed bottom-6 right-6 z-[99999] w-[320px] bg-slate-900/95 backdrop-blur-xl border border-slate-700 shadow-[0_15px_40px_-10px_rgba(0,0,0,0.7)] rounded-2xl p-5 cursor-pointer hover:border-blue-500 hover:-translate-y-1 transition-all duration-300 animate-fade-in-up group"
          title="클릭하여 해석 페이지로 돌아가기"
        >
          <div className="flex justify-between items-center mb-3">
            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-2 uppercase tracking-wider">
              {globalJob.status === 'Running' ? <RefreshCw className="animate-spin text-blue-400" size={14}/> :
               globalJob.status === 'Success' ? <CheckCircle className="text-emerald-400" size={14}/> :
               <AlertCircle className="text-red-400" size={14}/>}
              {globalJob.menu}
            </span>
            <button 
              onClick={(e) => { e.stopPropagation(); clearGlobalJob(); }} 
              className="text-slate-500 hover:text-white transition-colors cursor-pointer"
            >
              <X size={16}/>
            </button>
          </div>
          
          <div className="text-sm font-bold text-white mb-3">
            {globalJob.status === 'Success' ? '해석 완료! 결과를 확인하세요.' : 
             globalJob.status === 'Failed' ? '해석 실패' : globalJob.message}
          </div>
          
          {globalJob.status === 'Running' && (
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${globalJob.progress}%` }}></div>
            </div>
          )}
        </div>
      )}
    </DashboardContext.Provider>
  );
}

export const useDashboard = () => useContext(DashboardContext);
