/// <summary>
/// 대시보드 및 전체 해석 앱의 메타데이터를 관리하는 전역 Context입니다.
/// (신규) 백그라운드 해석 작업을 추적하고 플로팅 위젯을 제공합니다.
/// (신규) Truss Assessment 페이지 이탈 시에도 상태를 유지하기 위한 글로벌 State를 추가했습니다.
/// </summary>
import React, { createContext, useState, useEffect, useContext } from 'react';
import { UploadCloud, PenTool, SlidersHorizontal, Wrench, RefreshCw, CheckCircle, AlertCircle, X, Bot } from 'lucide-react';
import { useNavigation } from './NavigationContext';
import { usePolling } from '../hooks/usePolling';

const RAW_ANALYSIS_DATA = [
  // ── File-Based Apps (signature: blue) ──────────── Active ──
  { mode: "File", category: "Truss", title: "Truss Model Builder", description: "Truss 설계 정보를 활용하여 구조 해석 모델을 구축합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["트러스", "모델생성", "CSV"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "Truss", title: "Truss Structural Assessment", description: "Truss BDF 모델을 업로드하여 구조적 안정성을 평가합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["트러스", "구조평가", "BDF"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "Pipeline", title: "HiTESS Model Builder", description: "CSV부터 Nastran 해석까지 FEM 파이프라인 전 과정을 단일 UI에서 관리합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["CSV", "BDF", "Nastran", "Pipeline"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "Piping", title: "HP-SCR 배관응력 해석", description: "배관 BDF를 업로드하여 열변형 계산 및 배관응력 해석(PSA · POR)을 수행합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["배관", "PSA", "POR", "BDF"], devStatus: "Active", contributor: "김윤환" },
  // ── File-Based Apps (signature: blue) ─────────── Developing ──
  { mode: "File", category: "Lifting", title: "Group & Module Unit 권상 구조 해석", description: "Group 및 Module Unit 권상 작업 시 발생하는 구조적 안전성을 사전에 검토합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["유닛", "블록", "국부강도"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "File", category: "Drawing", title: "DrawingToAnalysis", description: "설계 도면(PDF)을 업로드하여 LUG 구조 해석 BDF 모델로 변환합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["PDF", "Drawing", "BDF"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "File", category: "MooringFitting", title: "Mooring Fitting Assessment", description: "Mooring Fitting / Winch 보강 구조의 CSV 2종을 입력받아 8단계 BDF 파이프라인을 자동 생성합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["Mooring", "Winch", "BDF", "Pipeline"], devStatus: "Developing", contributor: "권혁민" },
  // ── Interactive Apps (signature: violet) ──────── Active ──
  { mode: "Interactive", category: "1D Beam", title: "Simple Beam Assessment", description: "단면 형상과 치수를 직접 입력하여 단순 보(Beam)의 응력 및 변위을 평가합니다.", icon: PenTool, color: "bg-violet-600", tags: ["1D요소", "굽힘응력", "실시간"], devStatus: "Active", contributor: "권혁민" },
  { mode: "Interactive", category: "Section", title: "Section Property Calculator", description: "단면 형상과 치수를 입력하여 단면 2차 모멘트(I), 단면계수(S), 회전반경(r) 등의 단면 특성값을 산출합니다.", icon: PenTool, color: "bg-violet-600", tags: ["단면", "특성값", "계산"], devStatus: "Active", contributor: "권혁민" },
  // ── Interactive Apps (signature: violet) ──────── Developing ──
  { mode: "Interactive", category: "Plate", title: "Plate Structure Analysis", description: "Plate 구조 해석용 Studio를 실행하여 판 구조 모델링 및 해석 작업을 진행합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Plate", "Studio", "구조해석"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "Interactive", category: "Tank", title: "Independent Tank Assessment", description: "독립 탱크의 치수·판두께·보강재 배치를 입력하여 구조 해석 모델을 구축합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Tank", "Plate", "Stiffener", "3D"], devStatus: "Developing", contributor: "권혁민" },
  // ── Parametric Apps (signature: emerald) ──────── Active ──
  { mode: "Parametric", category: "Davit", title: "Jib Rest Assessment", description: "Jib Rest 구조물의 1단/2단 파이프 설계 후보를 산출합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["Jib Rest", "1단", "2단"], devStatus: "Active", contributor: "박준석" },
  { mode: "Parametric", category: "Davit", title: "Mast Post Assessment", description: "Post 높이와 플랫폼 하중을 입력하여 기준을 만족하는 최적 파이프 후보를 산출합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["Post", "파이프선정"], devStatus: "Active", contributor: "박준석" },
  { mode: "Parametric", category: "Column", title: "Column Buckling Load Calculator", description: "AISC 기준 핀-핀 경계 조건의 강재 기둥 최대 허용 사용하중을 계산합니다. 동심·편심 하중 모두 지원.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["기둥", "좌굴", "AISC", "Secant"], devStatus: "Active", contributor: "김병훈" },
  { mode: "Parametric", category: "Fatigue", title: "Simplified Hole Fatigue Assessment", description: "Welded pipe penetration의 SCF 기반 피로 평가를 수행합니다. DNVGL-RP-C203 기준.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["Fatigue", "DNVGL-RP-C203", "Welded Penetration", "SCF"], devStatus: "Active", contributor: "김윤환" },
  { mode: "Parametric", category: "Lug", title: "D Type Lug Assessment", description: "D-Type 러그의 브라켓 타입별 각도 케이스 강도와 Usage Factor를 계산합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["Lug", "D-Type", "Usage Factor"], devStatus: "Active", contributor: "김연태" },
  { mode: "Parametric", category: "Carling", title: "Carling Free Calculator", description: "하중과 Hull Plate 조건을 입력하여 Carling 설치 필요 여부를 판정합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["Carling", "Free", "Plate"], devStatus: "Active", contributor: "박준석" },
  { mode: "Parametric", category: "Carling", title: "Carling Design Optimization", description: "Carling H/T 범위를 탐색하여 기준을 만족하는 최소 중량 후보를 산출합니다.", icon: SlidersHorizontal, color: "bg-emerald-600", tags: ["Carling", "Optimization", "Weight"], devStatus: "Active", contributor: "박준석" },
  // ── Productivity Apps (signature: amber) ──────── Active ──
  { mode: "Productivity", category: "BDF Tools", title: "BDF Scanner", description: "BDF 모델 파일의 유효성을 검증하고, 선택적으로 Nastran 해석 후 F06 결과를 요약합니다.", icon: Wrench, color: "bg-amber-500", tags: ["BDF", "유효성검증", "Nastran"], devStatus: "Active", contributor: "권혁민", relatedApps: ["F06 Parser", "HiTESS Model Builder"], transferOutputs: [{ key: 'f06', label: 'F06 파일', targetApp: 'F06 Parser' }] },
  { mode: "Productivity", category: "F06 Tools", title: "F06 Parser", description: "Nastran SOL 101 F06 파일에서 Displacement, SPC Force, CBAR/CBEAM/CROD 내력·응력을 추출하고 Subcase별 테이블로 조회합니다.", icon: Wrench, color: "bg-amber-500", tags: ["F06", "Nastran", "결과추출", "1D"], devStatus: "Active", contributor: "권혁민", relatedApps: ["BDF Scanner"], acceptsTransferFrom: ['BDF Scanner'] },
  // ── Academic Apps (signature: cyan) ───────────── Developing ──
  { mode: "Academic", category: "AI-based Analysis", title: "GNN 기반 Beam 구조 안정성 검토", description: "Graph Neural Network(GNN)를 활용하여 보(Beam) 구조물의 응력 분포 및 구조적 안정성을 AI 기반으로 평가합니다.", icon: Bot, color: "bg-cyan-600", tags: ["GNN", "AI", "Beam", "구조안정성"], devStatus: "Developing", contributor: "권혁민" },
];

const APP_REGISTRY_OVERRIDES = {
  "Truss Model Builder": {
    menuName: "Truss Analysis",
    programNames: ["TrussModelBuilder", "Truss Model Builder"],
    apiEndpoint: "/api/analysis/truss/request",
    sampleFiles: [{ label: "Node/Member CSV 입력 포맷", guideTitle: "[파일] Truss Model Builder — CSV 입력 포맷" }],
  },
  "Truss Structural Assessment": {
    menuName: "Truss Structural Assessment",
    programNames: ["Truss Assessment", "Truss Structural Assessment"],
    apiEndpoint: "/api/analysis/assessment/request",
    sampleFiles: [{ label: "BDF 입력 포맷", guideTitle: "[파일] Truss Structural Assessment — BDF 입력 포맷" }],
  },
  "HiTESS Model Builder": {
    menuName: "HiTESS Model Builder",
    programNames: ["HiTessModelBuilder", "HiTESS Model Builder"],
    apiEndpoint: "/api/analysis/modelflow/request",
    relatedApps: ["BDF Scanner", "F06 Parser"],
    transferOutputs: [{ key: "bdf_path", label: "BDF 모델", targetApp: "BDF Scanner" }],
    sampleFiles: [{ label: "CSV 패키지 입력 포맷", guideTitle: "[파일] HiTESS Model Builder — CSV 입력 포맷" }],
  },
  "HP-SCR 배관응력 해석": {
    menuName: "HP-SCR 배관응력 해석",
    programNames: ["HP-SCR", "HP-SCR PSA", "HP-SCR POR"],
    apiEndpoint: "/api/analysis/hpscr/request",
    sampleFiles: [{ label: "배관 BDF 입력 포맷", guideTitle: "[파일] HP-SCR 배관응력 해석 — BDF 입력 포맷" }],
  },
  "Group & Module Unit 권상 구조 해석": {
    menuName: "Group & Module Unit 권상 구조 해석",
    programNames: ["GroupModuleUnit", "Group & Module Unit 권상 구조 해석"],
    apiEndpoint: "/api/analysis/groupmodule/request",
    relatedApps: ["HiTESS Model Builder", "BDF Scanner"],
  },
  "Mooring Fitting Assessment": {
    menuName: "Mooring Fitting Assessment",
    programNames: ["MooringFitting", "Mooring Fitting Assessment"],
    apiEndpoint: "/api/analysis/mooring-fitting/request",
  },
  "DrawingToAnalysis": {
    menuName: "DrawingToAnalysis",
    programNames: ["DrawingToAnalysis"],
    apiEndpoint: "/api/analysis/drawing-to-analysis/request",
    transferOutputs: [{ key: "bdf", label: "BDF 모델", targetApp: "BDF Scanner" }],
  },
  "Simple Beam Assessment": {
    menuName: "Simple Beam Assessment",
    programNames: ["Simple Beam Assessment", "Beam Analysis"],
    apiEndpoint: "/api/analysis/beam/request",
    sampleFiles: [{ label: "Beam JSON 입력 포맷", guideTitle: "[대화형] Simple Beam Assessment — 입력 포맷" }],
  },
  "Section Property Calculator": {
    menuName: "Section Property Calculator",
    programNames: ["Section Property Calculator"],
    apiEndpoint: "/api/section-property/calculate",
  },
  "Plate Structure Analysis": {
    menuName: "Plate Structure Analysis",
    programNames: ["Plate Structure Analysis"],
  },
  "Independent Tank Assessment": {
    menuName: "Independent Tank Assessment",
    programNames: ["Independent Tank Assessment"],
  },
  "Jib Rest Assessment": {
    menuName: "Jib Rest Assessment",
    programNames: ["Jib Rest Assessment", "Jib Rest Assessment (1단)", "Jib Rest Assessment (2단)"],
    apiEndpoint: "/api/davit/jib-rest-1dan",
  },
  "Mast Post Assessment": {
    menuName: "Mast Post Assessment",
    programNames: ["Mast Post Assessment"],
    apiEndpoint: "/api/davit/mast-post",
  },
  "Column Buckling Load Calculator": {
    menuName: "Column Buckling Load Calculator",
    programNames: ["Column Buckling Load Calculator"],
    apiEndpoint: "/api/column-buckling/calculate",
  },
  "Simplified Hole Fatigue Assessment": {
    menuName: "Simplified Hole Fatigue Assessment",
    programNames: ["Simplified Hole Fatigue Assessment"],
  },
  "D Type Lug Assessment": {
    menuName: "D Type Lug Assessment",
    programNames: ["D Type Lug Assessment"],
    apiEndpoint: "/api/d-type-lug/calculate",
  },
  "Carling Free Calculator": {
    menuName: "Carling Free Calculator",
    programNames: ["Carling Free Calculator"],
  },
  "Carling Design Optimization": {
    menuName: "Carling Design Optimization",
    programNames: ["Carling Design Optimization"],
  },
  "BDF Scanner": {
    menuName: "BDF Scanner",
    programNames: ["BDF Scanner"],
    apiEndpoint: "/api/analysis/bdfscanner/request",
    relatedApps: ["HiTESS Model Builder", "F06 Parser"],
    transferOutputs: [{ key: "f06", label: "F06 파일", targetApp: "F06 Parser" }],
    sampleFiles: [{ label: "BDF 검증 예제", guideTitle: "[생산성] BDF Scanner — 입력 포맷" }],
  },
  "F06 Parser": {
    menuName: "F06 Parser",
    programNames: ["F06 Parser"],
    apiEndpoint: "/api/analysis/f06parser/request",
    relatedApps: ["BDF Scanner", "HiTESS Model Builder"],
    acceptsTransferFrom: ["BDF Scanner"],
    sampleFiles: [{ label: "F06 결과 예제", guideTitle: "[생산성] F06 Parser — 입력 포맷" }],
  },
  "GNN 기반 Beam 구조 안정성 검토": {
    menuName: "Academic Apps",
    programNames: ["GNN 기반 Beam 구조 안정성 검토"],
  },
};

export const ANALYSIS_DATA = RAW_ANALYSIS_DATA.map(app => ({
  ...app,
  menuName: app.title,
  programNames: [app.title],
  ...(APP_REGISTRY_OVERRIDES[app.title] ?? {}),
  // App.jsx renderPage 에 실제 페이지가 등록된 앱만 override 를 가진다 → 진입 가능 여부 판별 플래그
  hasPage: Object.prototype.hasOwnProperty.call(APP_REGISTRY_OVERRIDES, app.title),
}));

export const getAppMenuName = (title) =>
  ANALYSIS_DATA.find(app => app.title === title)?.menuName ?? title;

export const findAppByProgramName = (programName) =>
  ANALYSIS_DATA.find(app => app.programNames?.includes(programName));

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
  const [analysisPageStates, setAnalysisPageStates] = useState({});
  const setAnalysisPageState = (menuName, updater) => {
    if (!menuName) return;
    setAnalysisPageStates(prev => {
      const current = prev[menuName] || {};
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [menuName]: { ...current, ...(next || {}) } };
    });
  };
  const clearAnalysisPageState = (menuName) => {
    if (!menuName) return;
    setAnalysisPageStates(prev => {
      const next = { ...prev };
      delete next[menuName];
      return next;
    });
  };

  // 프로그램 간 연계: 다른 앱에서 GMU로 BDF를 바로 전달할 때 사용
  const [gmuHandoff, setGmuHandoff]   = useState(null); // { bdfServerPath, sourceApp }
  const clearGmuHandoff = () => setGmuHandoff(null);

  const [pendingJobTransfer, setPendingJobTransferRaw] = useState(null);
  const setPendingJobTransfer = (payload) => setPendingJobTransferRaw(payload);
  const clearPendingJobTransfer = () => setPendingJobTransferRaw(null);

  const [globalJobs, setGlobalJobs] = useState([]);
  const globalJob = globalJobs[0] || null;

  const clearGlobalJob = (jobId = null) => {
    setGlobalJobs(prev => jobId ? prev.filter(job => job.jobId !== jobId) : []);
  };

  const startGlobalJob = (jobId, menuName) => {
    if (!jobId) return;
    setGlobalJobs(prev => {
      const nextJob = { jobId, menu: menuName, status: 'Running', progress: 0, message: '서버에 작업을 요청하는 중...' };
      return [nextJob, ...prev.filter(job => job.jobId !== jobId)].slice(0, 5);
    });
  };

  useEffect(() => {
    setGlobalJobs(prev => prev.filter(job =>
      !((job.status === 'Success' || job.status === 'Failed' || job.status === 'Interrupted') && job.menu === currentMenu)
    ));
  }, [currentMenu]);

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
        globalJob, globalJobs, startGlobalJob, clearGlobalJob,
        assessmentPageState, setAssessmentPageState,
        modelBuilderPageState, setModelBuilderPageState,
        analysisPageStates, setAnalysisPageState, clearAnalysisPageState,
        gmuHandoff, setGmuHandoff, clearGmuHandoff,
        pendingJobTransfer, setPendingJobTransfer, clearPendingJobTransfer
    }}>
      {children}

      <GlobalJobTray
        jobs={globalJobs}
        currentMenu={currentMenu}
        onNavigate={setCurrentMenu}
        onDismiss={clearGlobalJob}
        onPatchJob={(jobId, patch) => setGlobalJobs(prev => prev.map(job => job.jobId === jobId ? { ...job, ...patch } : job))}
      />
    </DashboardContext.Provider>
  );
}

export const useDashboard = () => useContext(DashboardContext);

function GlobalJobTray({ jobs, currentMenu, onNavigate, onDismiss, onPatchJob }) {
  const visibleJobs = jobs.filter(job => job.menu !== currentMenu);
  if (!visibleJobs.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[99999] w-[min(360px,calc(100vw-2rem))] space-y-2">
      {visibleJobs.map(job => (
        <GlobalJobCard
          key={job.jobId}
          job={job}
          onNavigate={onNavigate}
          onDismiss={onDismiss}
          onPatchJob={onPatchJob}
        />
      ))}
    </div>
  );
}

function GlobalJobCard({ job, onNavigate, onDismiss, onPatchJob }) {
  const isTerminal = job.status === 'Success' || job.status === 'Failed' || job.status === 'Interrupted';

  usePolling({
    jobId: isTerminal ? null : job.jobId,
    interval: 1500,
    maxRetries: 120,
    onProgress: (data) => onPatchJob(job.jobId, data),
    onComplete: (data) => onPatchJob(job.jobId, data),
    onError: (err) => onPatchJob(job.jobId, {
      status: 'Failed',
      progress: 100,
      message: err?.timeout ? '해석 시간 초과 (3분)' : '서버 통신 오류 발생',
    }),
  });

  return (
    <div
      onClick={() => onNavigate && onNavigate(job.menu)}
      className="bg-slate-900/95 backdrop-blur-xl border border-slate-700 shadow-[0_15px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl p-4 cursor-pointer hover:border-blue-500 transition-all duration-200 animate-fade-in-up"
      title="클릭하여 해석 페이지로 돌아가기"
    >
      <div className="flex justify-between items-center mb-2">
        <span className="text-[11px] font-bold text-slate-300 flex items-center gap-2 uppercase tracking-wider min-w-0">
          {job.status === 'Running' ? <RefreshCw className="animate-spin text-blue-400 shrink-0" size={14}/> :
           job.status === 'Success' ? <CheckCircle className="text-emerald-400 shrink-0" size={14}/> :
           <AlertCircle className="text-red-400 shrink-0" size={14}/>}
          <span className="truncate">{job.menu}</span>
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(job.jobId); }}
          className="text-slate-500 hover:text-white transition-colors cursor-pointer shrink-0"
          title="닫기"
        >
          <X size={16}/>
        </button>
      </div>

      <div className="text-sm font-bold text-white mb-3 line-clamp-2">
        {job.status === 'Success' ? '해석 완료! 결과를 확인하세요.' :
         job.status === 'Interrupted' ? '서버 재시작으로 작업이 중단되었습니다.' :
         job.status === 'Failed' ? '해석 실패' : job.message}
      </div>

      {!isTerminal && (
        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${job.progress || 0}%` }} />
        </div>
      )}
    </div>
  );
}
