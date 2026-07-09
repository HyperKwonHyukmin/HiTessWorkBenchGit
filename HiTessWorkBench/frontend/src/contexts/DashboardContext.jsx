/// <summary>
/// 대시보드 및 전체 해석 앱의 메타데이터를 관리하는 전역 Context입니다.
/// (신규) 백그라운드 해석 작업을 추적하고 플로팅 위젯을 제공합니다.
/// (신규) Truss Assessment 페이지 이탈 시에도 상태를 유지하기 위한 글로벌 State를 추가했습니다.
/// </summary>
import React, { createContext, useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { UploadCloud, PenTool, SlidersHorizontal, Wrench, RefreshCw, CheckCircle, AlertCircle, X } from 'lucide-react';
import { useNavigation } from './NavigationContext';
import { useAuth } from './AuthContext';
import { usePolling } from '../hooks/usePolling';
import { POLLING_POLICY } from '../hooks/pollingPolicy';
import AnalysisResultPanel from '../components/platform/AnalysisResultPanel';

const RAW_ANALYSIS_DATA = [
  // ── File-Based Apps (signature: blue) ──────────── Active ──
  { mode: "File", category: "Truss", title: "Truss Model Builder", description: "Truss 설계 정보를 활용하여 구조 해석 모델을 구축합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["트러스", "모델생성", "CSV"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "Truss", title: "Truss Structural Assessment", description: "Truss BDF 모델을 업로드하여 구조적 안정성을 평가합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["트러스", "구조평가", "BDF"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "FEM Pipeline", title: "HiTESS Model Builder", description: "CSV부터 Nastran 해석까지 FEM 파이프라인 전 과정을 단일 UI에서 관리합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["CSV", "BDF", "Nastran", "Pipeline"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "Pipe", title: "HP-SCR 배관응력 해석", description: "배관 BDF를 업로드하여 열변형 계산 및 배관응력 해석(PSA · POR)을 수행합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["배관", "PSA", "POR", "BDF"], devStatus: "Active", contributor: "김윤환" },
  // ── File-Based Apps (signature: blue) ─────────── Developing ──
  { mode: "File", category: "Pipe", title: "이중관 구조 연료배관 해석", description: "이중관 연료배관의 Inner Support 설계와 전체/선택 Load Case 배관응력 해석을 준비합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["이중관", "연료배관", "PSA", "CSV"], devStatus: "Developing", contributor: "김윤환" },
  { mode: "File", category: "Lifting", title: "Group & Module Unit 권상 구조 해석", description: "Group 및 Module Unit 권상 작업 시 발생하는 구조적 안전성을 사전에 검토합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["유닛", "블록", "국부강도"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "File", category: "Passage", title: "Side Passage Assessment", description: "Side Passage BDF 모델을 검증하고 Studio 기반 권상 조건·Nastran 해석·결과 판정을 진행합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["Side Passage", "BDF", "Studio", "권상"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "File", category: "PDF", title: "DrawingToAnalysis", description: "설계 도면(PDF)을 업로드하여 LUG 구조 해석 BDF 모델로 변환합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["PDF", "Drawing", "BDF"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "File", category: "Mooring Fitting", title: "Mooring Fitting Assessment", description: "Mooring Fitting / Winch 보강 구조의 CSV 2종을 입력받아 8단계 BDF 파이프라인을 자동 생성합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["Mooring", "Winch", "BDF", "Pipeline"], devStatus: "Developing", contributor: "권혁민" },
  // ── Interactive Apps (signature: violet) ──────── Active ──
  { mode: "Interactive", category: "1D Beam", title: "Simple Beam Assessment", description: "단면 형상과 치수를 직접 입력하여 단순 보(Beam)의 응력 및 변위을 평가합니다.", icon: PenTool, color: "bg-violet-600", tags: ["1D요소", "굽힘응력", "실시간"], devStatus: "Active", contributor: "권혁민" },
  { mode: "Interactive", category: "Section", title: "Section Property Calculator", description: "단면 형상과 치수를 입력하여 단면 2차 모멘트(I), 단면계수(S), 회전반경(r) 등의 단면 특성값을 산출합니다.", icon: PenTool, color: "bg-violet-600", tags: ["단면", "특성값", "계산"], devStatus: "Active", contributor: "권혁민" },
  // ── Interactive Apps (signature: violet) ──────── Developing ──
  { mode: "Interactive", category: "Plate", title: "Plate Structure Analysis", description: "Plate 구조 해석용 Studio를 실행하여 판 구조 모델링 및 해석 작업을 진행합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Plate", "Studio", "구조해석"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "Interactive", category: "Tank", title: "Independent Tank Assessment", description: "독립 탱크의 치수·판두께·보강재 배치를 입력하여 구조 해석 모델을 구축합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Tank", "Plate", "Stiffener", "3D"], devStatus: "Developing", contributor: "김한별" },
  { mode: "Interactive", category: "Weld", title: "Block Weld Assessment", description: "블록 전도 방지 구속 용접양을 산출합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Weld", "Block", "용접"], devStatus: "Active", contributor: "김한별" },
  { mode: "Interactive", category: "Lifting", title: "Heavy Block Lifting Simulation", description: "중량물 블록의 권상 과정에서 자세 안정성을 사전에 예측·검증 합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Lifting", "Block", "권상", "자세안정성"], devStatus: "Developing", contributor: "김한별" },
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
  { mode: "Productivity", category: "Hull Accel", title: "선급 Rule 기반 선체 가속도 Calculation", description: "Trim & Stability Booklet PDF를 업로드하여 선박 제원과 Loading Conditions를 추출하고 선급 Rule 기반 선체 가속도를 계산합니다.", icon: Wrench, color: "bg-amber-500", tags: ["선급", "가속도", "PDF", "Loading Conditions"], devStatus: "Active", contributor: "정병훈" },
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
    programNames: ["HiTessModelBuilder", "ModelBuilderAnalysis", "HiTESS Model Builder"],
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
  "이중관 구조 연료배관 해석": {
    menuName: "이중관 구조 연료배관 해석",
    programNames: ["DoublePipeFuelLine", "이중관 구조 연료배관 해석"],
    sampleFiles: [{ label: "Inner Pipe Config JSON", guideTitle: "[파일] 이중관 구조 연료배관 해석 — 입력 포맷" }],
  },
  "Group & Module Unit 권상 구조 해석": {
    menuName: "Group & Module Unit 권상 구조 해석",
    programNames: ["GroupModuleUnit", "Group & Module Unit 권상 구조 해석"],
    apiEndpoint: "/api/analysis/groupmodule/request",
    relatedApps: ["HiTESS Model Builder", "BDF Scanner"],
  },
  "Side Passage Assessment": {
    menuName: "Side Passage Assessment",
    programNames: ["SidePassage", "Side Passage Assessment"],
    apiEndpoint: "/api/analysis/groupmoduleunit/request",
    relatedApps: ["BDF Scanner", "HiTESS Model Builder"],
  },
  "Mooring Fitting Assessment": {
    menuName: "Mooring Fitting Assessment",
    programNames: ["MooringFitting", "MooringFittingSolve", "Mooring Fitting Assessment"],
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
  // 외부 앱(iframe/별도 창) — 실행 시 외부 서버 URL 을 새 창으로 띄운다. (BlockWeldAssessment.jsx)
  "Block Weld Assessment": {
    menuName: "Block Weld Assessment",
    programNames: ["BlockWeld", "BlockWeldAssessment", "Block Weld", "Block Weld Assessment"],
  },
  "Heavy Block Lifting Simulation": {
    menuName: "Heavy Block Lifting Simulation",
    programNames: ["Heavy Block Lifting Simulation"],
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
  "선급 Rule 기반 선체 가속도 Calculation": {
    menuName: "선급 Rule 기반 선체 가속도 Calculation",
    programNames: ["HullAcceleration", "선급 Rule 기반 선체 가속도 Calculation"],
    apiEndpoint: "/api/analysis/hullacceleration/request",
  },
};

export const ANALYSIS_DATA = Object.freeze(RAW_ANALYSIS_DATA.map(app => Object.freeze({
  ...app,
  menuName: app.title,
  programNames: [app.title],
  ...(APP_REGISTRY_OVERRIDES[app.title] ?? {}),
  // App.jsx renderPage 에 실제 페이지가 등록된 앱만 override 를 가진다 → 진입 가능 여부 판별 플래그
  hasPage: Object.prototype.hasOwnProperty.call(APP_REGISTRY_OVERRIDES, app.title),
})));

const normalizeProgramName = (value) =>
  String(value ?? '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');

export const findAppByAnyName = (value) => {
  const normalizedValue = normalizeProgramName(value);
  return ANALYSIS_DATA.find(item =>
    item.title === value ||
    item.menuName === value ||
    item.programNames?.includes(value) ||
    normalizeProgramName(item.title) === normalizedValue ||
    normalizeProgramName(item.menuName) === normalizedValue ||
    item.programNames?.some(name => normalizeProgramName(name) === normalizedValue)
  );
};

export const getAppMenuName = (value) => {
  const app = findAppByAnyName(value);
  return app?.menuName ?? value;
};

const getAppStateKey = (value) => {
  const app = findAppByAnyName(value);
  return app?.title ?? value;
};

export const findAppByProgramName = (programName) => {
  const normalizedProgramName = normalizeProgramName(programName);
  return ANALYSIS_DATA.find(app =>
    app.programNames?.includes(programName) ||
    app.programNames?.some(name => normalizeProgramName(name) === normalizedProgramName)
  );
};

// program_name(내부 코드키, 예: "GroupModuleUnit")을 사용자가 읽는 앱 타이틀
// (예: "Group & Module Unit 권상 구조 해석")로 변환한다. 매칭 실패 시 원본 유지.
// ⚠ 표시(display) 전용 — program_name 기반 로직/분기에는 사용하지 말 것.
export const getDisplayProgramName = (programName) =>
  findAppByProgramName(programName)?.title || programName;

const DashboardContext = createContext();
const FavoritesContext = createContext();
const GlobalJobContext = createContext();
const AnalysisPageStateContext = createContext();
const FAVORITES_KEY = 'favorites';
const GLOBAL_JOBS_KEY = 'hitess_global_jobs';
const GLOBAL_JOB_VISIBLE_MS = 30 * 60 * 1000;
const GLOBAL_JOB_COLLAPSE_MS = 30 * 1000;
const ANALYSIS_MENU_FRESH_ENTRY_KEY = 'workbench:analysis-menu-fresh-entry';
const ANALYSIS_MENU_RESUME_ENTRY_KEY = 'workbench:analysis-menu-resume-entry';
const MENU_ENTRY_MAX_AGE_MS = 5000;
const ANALYSIS_ROUTE_MENUS = new Set(
  ANALYSIS_DATA
    .filter(app => app.hasPage)
    .map(app => getAppMenuName(app.title))
);
const INITIAL_ASSESSMENT_PAGE_STATE = {
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
  activeResultCase: null,
  projectData: null,
};

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

function readPersistedGlobalJobs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GLOBAL_JOBS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter(job => job?.jobId && job?.menu)
      .map(job => {
        const firstShownAt = Number(job.firstShownAt || 0);
        return {
          ...job,
          firstShownAt,
          collapseAt: firstShownAt ? Number(job.collapseAt || firstShownAt + GLOBAL_JOB_COLLAPSE_MS) : null,
          expiresAt: firstShownAt ? Number(job.expiresAt || firstShownAt + GLOBAL_JOB_VISIBLE_MS) : null,
          displayName: job.displayName || job.menu,
          stateKey: getAppStateKey(job.stateKey || job.menu),
          menu: job.routeMenu || getAppMenuName(job.menu),
        };
      })
      .filter(job => !job.expiresAt || now < job.expiresAt)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function writePersistedGlobalJobs(jobs) {
  try {
    localStorage.setItem(GLOBAL_JOBS_KEY, JSON.stringify(jobs.slice(0, 5)));
  } catch {
    // ignore storage failures
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
  const { isAuthenticated } = useAuth();
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
  const [assessmentPageState, setAssessmentPageState] = useState(INITIAL_ASSESSMENT_PAGE_STATE);

  const [modelBuilderPageState, setModelBuilderPageState] = useState(null);
  const [analysisPageStates, setAnalysisPageStates] = useState({});
  const setAnalysisPageState = useCallback((menuName, updater) => {
    if (!menuName) return;
    setAnalysisPageStates(prev => {
      const current = prev[menuName] || {};
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [menuName]: { ...current, ...(next || {}) } };
    });
  }, []);
  const clearAnalysisPageState = useCallback((menuName) => {
    if (!menuName) return;
    setAnalysisPageStates(prev => {
      const next = { ...prev };
      delete next[menuName];
      return next;
    });
  }, []);

  // 프로그램 간 연계: 다른 앱에서 GMU/Side Passage로 BDF를 전달할 때 사용
  const [gmuHandoff, setGmuHandoff]   = useState(null); // { bdfServerPath, sourceApp }
  const clearGmuHandoff = useCallback(() => setGmuHandoff(null), []);
  const [sidePassageHandoff, setSidePassageHandoff] = useState(null); // { bdfServerPath, sourceApp }
  const clearSidePassageHandoff = useCallback(() => setSidePassageHandoff(null), []);

  // 프로그램 간 연계: Carling Free Calculator → Design Optimization 입력 이관
  const [carlingHandoff, setCarlingHandoff] = useState(null); // { load, hull, material }
  const clearCarlingHandoff = useCallback(() => setCarlingHandoff(null), []);

  const [pendingJobTransfer, setPendingJobTransferRaw] = useState(null);
  const setPendingJobTransfer = useCallback((payload) => setPendingJobTransferRaw(payload), []);
  const clearPendingJobTransfer = useCallback(() => setPendingJobTransferRaw(null), []);

  const [globalJobs, setGlobalJobs] = useState(() => (
    isAuthenticated ? readPersistedGlobalJobs() : []
  ));
  const globalJob = globalJobs[0] || null;
  const handledFreshEntryRef = useRef({ menu: null, at: 0 });

  const resetAnalysisEntryState = useCallback((menuName) => {
    if (!ANALYSIS_ROUTE_MENUS.has(menuName)) return;
    const stateKey = getAppStateKey(menuName);
    setAnalysisPageStates(prev => {
      if (!Object.prototype.hasOwnProperty.call(prev, stateKey)) return prev;
      const next = { ...prev };
      delete next[stateKey];
      return next;
    });
    if (menuName === 'Truss Structural Assessment') {
      setAssessmentPageState(INITIAL_ASSESSMENT_PAGE_STATE);
    }
    if (menuName === 'HiTESS Model Builder') {
      setModelBuilderPageState(null);
    }
    setGlobalJobs(prev => prev.filter(job => job.menu !== menuName));
  }, []);

  const isFreshNavigationResume = useCallback((menuName) => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(ANALYSIS_MENU_RESUME_ENTRY_KEY) || 'null');
      return parsed?.menu === menuName && Date.now() - Number(parsed.at || 0) <= MENU_ENTRY_MAX_AGE_MS;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const handleFreshEntry = (event) => {
      const menu = event.detail?.menu;
      if (!ANALYSIS_ROUTE_MENUS.has(menu)) return;
      resetAnalysisEntryState(menu);
    };

    window.addEventListener('workbench:analysis-fresh-entry', handleFreshEntry);
    return () => window.removeEventListener('workbench:analysis-fresh-entry', handleFreshEntry);
  }, [resetAnalysisEntryState]);

  useEffect(() => {
    if (!isAuthenticated || !ANALYSIS_ROUTE_MENUS.has(currentMenu)) return;
    if (isFreshNavigationResume(currentMenu)) return;

    const now = Date.now();
    if (
      handledFreshEntryRef.current.menu === currentMenu &&
      now - handledFreshEntryRef.current.at < 250
    ) {
      return;
    }
    handledFreshEntryRef.current = { menu: currentMenu, at: now };

    sessionStorage.setItem(ANALYSIS_MENU_FRESH_ENTRY_KEY, JSON.stringify({ menu: currentMenu, at: now }));
    resetAnalysisEntryState(currentMenu);
    window.dispatchEvent(new CustomEvent('workbench:analysis-fresh-entry', { detail: { menu: currentMenu } }));
  }, [currentMenu, isAuthenticated, isFreshNavigationResume, resetAnalysisEntryState]);

  const patchGlobalJob = useCallback((jobId, patch) => {
    setGlobalJobs(prev => prev.map(job => {
      if (job.jobId !== jobId) return job;
      const nextJob = { ...job, ...patch, updatedAt: Date.now() };
      const pageStateKey = getAppStateKey(nextJob.stateKey || nextJob.menu);
      if (pageStateKey) {
        setAnalysisPageStates(pagePrev => {
          const current = pagePrev[pageStateKey] || {};
          const isRunning = nextJob.status !== 'Success' && nextJob.status !== 'Failed' && nextJob.status !== 'Interrupted';
          const isSuccess = nextJob.status === 'Success';
          const isFailure = nextJob.status === 'Failed' || nextJob.status === 'Interrupted';
          return {
            ...pagePrev,
            [pageStateKey]: {
              ...current,
              job: {
                ...(current.job || {}),
                jobId: nextJob.jobId,
                status: nextJob.status ?? current.job?.status,
                isRunning,
                progress: nextJob.progress ?? current.job?.progress ?? 0,
                statusMessage: nextJob.message ?? current.job?.statusMessage ?? '',
                logs: current.job?.logs || [],
                completeData: isSuccess ? nextJob : current.job?.completeData,
                errorData: isFailure ? nextJob : current.job?.errorData,
                resultRestored: isRunning ? false : current.job?.resultRestored ?? false,
              },
              recoveredFromGlobalJob: true,
            },
          };
        });
      }
      return nextJob;
    }));
  }, []);

  const clearGlobalJob = useCallback((jobId = null) => {
    setGlobalJobs(prev => jobId ? prev.filter(job => job.jobId !== jobId) : []);
  }, []);

  const markGlobalJobShown = useCallback((jobId) => {
    if (!jobId) return;
    setGlobalJobs(prev => prev.map(job => {
      if (job.jobId !== jobId || job.firstShownAt) return job;
      const now = Date.now();
      return {
        ...job,
        firstShownAt: now,
        collapseAt: now + GLOBAL_JOB_COLLAPSE_MS,
        expiresAt: now + GLOBAL_JOB_VISIBLE_MS,
        updatedAt: now,
      };
    }));
  }, []);

  const startGlobalJob = useCallback((jobId, menuName) => {
    if (!jobId) return;
    const routeMenu = getAppMenuName(menuName);
    const stateKey = getAppStateKey(menuName);
    const now = Date.now();
    const nextJob = {
      jobId,
      menu: routeMenu,
      stateKey,
      displayName: menuName,
      status: 'Running',
      progress: 0,
      message: '서버에 작업을 요청하는 중...',
      startedAt: now,
      updatedAt: now,
      firstShownAt: null,
      collapseAt: null,
      expiresAt: null,
    };
    setGlobalJobs([nextJob]);
    setAnalysisPageState(stateKey, current => ({
      ...current,
      job: {
        jobId,
        status: 'Running',
        isRunning: true,
        progress: 0,
        statusMessage: '서버에 작업을 요청하는 중...',
        logs: current.job?.logs || [],
        completeData: null,
        errorData: null,
        resultRestored: false,
      },
      recoveredFromGlobalJob: true,
    }));
  }, [setAnalysisPageState]);

  useEffect(() => {
    if (!isAuthenticated) {
      setGlobalJobs(prev => prev.length > 0 ? [] : prev);
      writePersistedGlobalJobs([]);
      return;
    }
    writePersistedGlobalJobs(globalJobs);
  }, [globalJobs, isAuthenticated]);

  useEffect(() => {
    setGlobalJobs(prev => {
      const next = prev.filter(job =>
        !((job.status === 'Success' || job.status === 'Failed' || job.status === 'Interrupted') && job.menu === currentMenu)
      );
      return next.length === prev.length ? prev : next;
    });
  }, [currentMenu]);

  useEffect(() => {
    if (!isAuthenticated || globalJobs.length === 0) return;

    const clearExpiredJobs = () => {
      const now = Date.now();
      setGlobalJobs(prev => {
        const next = prev.filter(job => now < (job.expiresAt || Infinity));
        return next.length === prev.length ? prev : next;
      });
    };

    clearExpiredJobs();
    const expiringAt = globalJobs
      .map(job => job.expiresAt)
      .filter(Boolean)
      .sort((a, b) => a - b)[0];

    if (!expiringAt) return undefined;

    const timer = setTimeout(clearExpiredJobs, Math.max(0, expiringAt - Date.now()));
    return () => clearTimeout(timer);
  }, [globalJobs, isAuthenticated]);

  const toggleFavorite = useCallback((title) => {
    setFavorites(prev => {
      const next = prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title];
      writeLocalFavorites(next);
      writeElectronFavorites(next);
      return next;
    });
  }, []);

  const reorderFavorite = useCallback((activeTitle, overTitle) => {
    if (!activeTitle || !overTitle || activeTitle === overTitle) return;

    setFavorites(prev => {
      const fromIndex = prev.indexOf(activeTitle);
      const toIndex = prev.indexOf(overTitle);
      if (fromIndex < 0 || toIndex < 0) return prev;

      const next = [...prev];
      const [movedFavorite] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, movedFavorite);
      writeLocalFavorites(next);
      writeElectronFavorites(next);
      return next;
    });
  }, []);

  const contextValue = useMemo(() => ({
    favorites, toggleFavorite, reorderFavorite,
    globalJob, globalJobs, startGlobalJob, clearGlobalJob,
    assessmentPageState, setAssessmentPageState,
    modelBuilderPageState, setModelBuilderPageState,
    analysisPageStates, setAnalysisPageState, clearAnalysisPageState,
    gmuHandoff, setGmuHandoff, clearGmuHandoff,
    sidePassageHandoff, setSidePassageHandoff, clearSidePassageHandoff,
    carlingHandoff, setCarlingHandoff, clearCarlingHandoff,
    pendingJobTransfer, setPendingJobTransfer, clearPendingJobTransfer
  }), [
    favorites, toggleFavorite, reorderFavorite,
    globalJob, globalJobs, startGlobalJob, clearGlobalJob,
    assessmentPageState,
    modelBuilderPageState,
    analysisPageStates, setAnalysisPageState, clearAnalysisPageState,
    gmuHandoff, clearGmuHandoff,
    sidePassageHandoff, clearSidePassageHandoff,
    carlingHandoff, clearCarlingHandoff,
    pendingJobTransfer, setPendingJobTransfer, clearPendingJobTransfer
  ]);

  const favoritesValue = useMemo(() => ({
    favorites,
    toggleFavorite,
    reorderFavorite,
  }), [favorites, toggleFavorite, reorderFavorite]);

  const globalJobValue = useMemo(() => ({
    globalJob,
    globalJobs,
    startGlobalJob,
    clearGlobalJob,
  }), [clearGlobalJob, globalJob, globalJobs, startGlobalJob]);

  const analysisPageStateValue = useMemo(() => ({
    assessmentPageState,
    setAssessmentPageState,
    modelBuilderPageState,
    setModelBuilderPageState,
    analysisPageStates,
    setAnalysisPageState,
    clearAnalysisPageState,
    gmuHandoff,
    setGmuHandoff,
    clearGmuHandoff,
    sidePassageHandoff,
    setSidePassageHandoff,
    clearSidePassageHandoff,
    carlingHandoff,
    setCarlingHandoff,
    clearCarlingHandoff,
    pendingJobTransfer,
    setPendingJobTransfer,
    clearPendingJobTransfer,
  }), [
    assessmentPageState,
    modelBuilderPageState,
    analysisPageStates,
    setAnalysisPageState,
    clearAnalysisPageState,
    gmuHandoff,
    clearGmuHandoff,
    sidePassageHandoff,
    clearSidePassageHandoff,
    carlingHandoff,
    clearCarlingHandoff,
    pendingJobTransfer,
    setPendingJobTransfer,
    clearPendingJobTransfer,
  ]);

  return (
    // [추가] Provider의 value에 assessmentPageState와 setAssessmentPageState를 넘겨줌
    <DashboardContext.Provider value={contextValue}>
      <FavoritesContext.Provider value={favoritesValue}>
        <GlobalJobContext.Provider value={globalJobValue}>
          <AnalysisPageStateContext.Provider value={analysisPageStateValue}>
            {children}
          </AnalysisPageStateContext.Provider>
        </GlobalJobContext.Provider>
      </FavoritesContext.Provider>

      {isAuthenticated && globalJobs.map(job => (
        <GlobalJobPoller
          key={`poll-${job.jobId}`}
          job={job}
          onPatchJob={patchGlobalJob}
        />
      ))}

      {isAuthenticated && (
        <GlobalJobTray
          jobs={globalJobs}
          currentMenu={currentMenu}
          onNavigate={setCurrentMenu}
          onDismiss={clearGlobalJob}
          onFirstShow={markGlobalJobShown}
        />
      )}
    </DashboardContext.Provider>
  );
}

export const useDashboard = () => useContext(DashboardContext);
export const useFavorites = () => useContext(FavoritesContext);
export const useGlobalJobs = () => useContext(GlobalJobContext);
export const useAnalysisPageState = () => useContext(AnalysisPageStateContext);

function GlobalJobTray({ jobs, currentMenu, onNavigate, onDismiss, onFirstShow }) {
  const [, setNowTick] = useState(Date.now());
  const visibleJob = jobs.find(job => job.menu !== currentMenu);

  useEffect(() => {
    if (!visibleJob) return undefined;
    if (!visibleJob.firstShownAt) {
      onFirstShow?.(visibleJob.jobId);
      return undefined;
    }

    const collapseAt = visibleJob.collapseAt || visibleJob.firstShownAt + GLOBAL_JOB_COLLAPSE_MS;
    const delay = Math.max(0, collapseAt - Date.now());
    if (delay === 0) {
      setNowTick(Date.now());
      return undefined;
    }
    const timer = setTimeout(() => setNowTick(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [onFirstShow, visibleJob?.jobId, visibleJob?.collapseAt, visibleJob?.firstShownAt]);

  if (!visibleJob) return null;

  const firstShownAt = visibleJob.firstShownAt || Date.now();
  const isCollapsed = Date.now() >= (visibleJob.collapseAt || firstShownAt + GLOBAL_JOB_COLLAPSE_MS);

  return (
    <div className={`fixed bottom-4 right-4 z-[99999] transition-all duration-300 ${
      isCollapsed ? 'w-[min(320px,calc(100vw-2rem))]' : 'w-[min(360px,calc(100vw-2rem))]'
    }`}>
      <GlobalJobCard
        key={visibleJob.jobId}
        job={visibleJob}
        isCollapsed={isCollapsed}
        onNavigate={onNavigate}
        onDismiss={onDismiss}
      />
    </div>
  );
}

function GlobalJobPoller({ job, onPatchJob }) {
  const isTerminal = job.status === 'Success' || job.status === 'Failed' || job.status === 'Interrupted';

  usePolling({
    jobId: isTerminal ? null : job.jobId,
    interval: POLLING_POLICY.analysisIntervalMs,
    maxRetries: POLLING_POLICY.analysisMaxRetries,
    onProgress: (data) => onPatchJob(job.jobId, data),
    onComplete: (data) => onPatchJob(job.jobId, data),
    onError: (err) => onPatchJob(job.jobId, {
      status: 'Failed',
      progress: 100,
      message: err?.timeout ? '해석 시간 초과 (3분)' : '서버 통신 오류 발생',
    }),
  });

  return null;
}

function GlobalJobCard({ job, isCollapsed, onNavigate, onDismiss }) {
  const statusIcon = job.status === 'Running'
    ? <RefreshCw className="animate-spin text-blue-400 shrink-0" size={14}/>
    : job.status === 'Success'
      ? <CheckCircle className="text-emerald-400 shrink-0" size={14}/>
      : <AlertCircle className="text-red-400 shrink-0" size={14}/>;

  return (
    <div
      onClick={() => {
        sessionStorage.setItem(ANALYSIS_MENU_RESUME_ENTRY_KEY, JSON.stringify({ menu: job.menu, jobId: job.jobId, at: Date.now() }));
        onNavigate?.(job.menu);
      }}
      className={`bg-slate-900/95 backdrop-blur-xl border border-slate-700 shadow-[0_15px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl cursor-pointer hover:border-blue-500 transition-all duration-300 animate-fade-in-up ${
        isCollapsed ? 'p-3' : 'p-4'
      }`}
      title="클릭하여 해석 페이지로 돌아가기"
    >
      <div className={`flex justify-between items-center ${isCollapsed ? 'mb-0' : 'mb-2'}`}>
        <span className="text-[11px] font-bold text-slate-300 flex items-center gap-2 uppercase tracking-wider min-w-0">
          {statusIcon}
          <span className="truncate">{job.displayName || job.menu}</span>
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(job.jobId); }}
          className="text-slate-500 hover:text-white transition-colors cursor-pointer shrink-0"
          title="닫기"
        >
          <X size={16}/>
        </button>
      </div>

      {isCollapsed ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                job.status === 'Failed' || job.status === 'Interrupted' ? 'bg-red-400' :
                job.status === 'Success' ? 'bg-emerald-400' :
                'bg-blue-400'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, Number(job.progress) || 0))}%` }}
            />
          </div>
          <span className="w-9 text-right text-[10px] font-black text-slate-400">
            {Math.round(Number(job.progress) || 0)}%
          </span>
        </div>
      ) : (
        <AnalysisResultPanel job={job} compact />
      )}
    </div>
  );
}
