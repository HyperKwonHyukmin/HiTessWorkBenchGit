/// <summary>
/// 대시보드 및 전체 해석 앱의 메타데이터를 관리하는 전역 Context입니다.
/// (신규) 백그라운드 해석 작업을 추적하고 플로팅 위젯을 제공합니다.
/// (신규) Truss Assessment 페이지 이탈 시에도 상태를 유지하기 위한 글로벌 State를 추가했습니다.
/// </summary>
import React, { createContext, useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { UploadCloud, PenTool, SlidersHorizontal, Wrench } from 'lucide-react';
import { useNavigation } from './NavigationContext';
import { useAuth } from './AuthContext';
import { usePolling } from '../hooks/usePolling';
import { POLLING_POLICY } from '../hooks/pollingPolicy';
import {
  clearAppSettings,
  getAppBlock,
  isAppBlockedFor,
  mergeAppSetting,
  refreshAppSettings,
  useAppSettings,
} from '../hooks/useAppSettings';

const RAW_ANALYSIS_DATA = [
  // ── File-Based Apps (signature: blue) ──────────── Active ──
  // ⚠️ 아이콘(UploadCloud)과 색(bg-blue-600)은 File 모드 전체가 공유하는 시그니처다.
  //    앱마다 다른 글리프·색으로 분화하지 말 것 — 모드 정체성을 나타내는 의도된 통일이다.
  // 태그에는 파일 형식(BDF·CSV·PDF…)을 넣지 않는다 — 카드의 Input/Output 칩이 이미 표시하고,
  // 검색도 inputFormats/outputFormats 를 인덱싱하므로 태그로 중복시킬 이유가 없다.
  { mode: "File", category: "Truss", title: "Truss Model Builder", description: "Truss 설계 정보를 활용하여 구조 해석 모델을 구축합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["트러스", "모델생성"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "Truss", title: "Truss Structural Assessment", description: "Truss BDF 모델을 업로드하여 구조적 안정성을 평가합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["트러스", "구조평가"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "FEM Pipeline", title: "HiTESS Model Builder", description: "CSV부터 Nastran 해석까지 FEM 파이프라인 전 과정을 단일 UI에서 관리합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["Nastran", "파이프라인"], devStatus: "Active", contributor: "권혁민" },
  { mode: "File", category: "Pipe", title: "HP-SCR 배관응력 해석", description: "배관 BDF를 업로드하여 열변형 계산 및 배관응력 해석(PSA · POR)을 수행합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["배관", "PSA", "POR"], devStatus: "Active", contributor: "김윤환" },
  // ── File-Based Apps (signature: blue) ─────────── Developing ──
  { mode: "File", category: "Pipe", title: "이중관 구조 연료배관 해석", description: "이중관 연료배관의 Inner Support 설계와 전체/선택 Load Case 배관응력 해석을 준비합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["이중관", "연료배관", "PSA"], devStatus: "Developing", contributor: "김윤환" },
  { mode: "File", category: "Lifting", title: "Group & Module Unit 권상 구조 해석", description: "Group 및 Module Unit 권상 작업 시 발생하는 구조적 안전성을 사전에 검토합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["유닛", "블록", "국부강도"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "File", category: "Passage", title: "Side Passage Assessment", description: "Side Passage BDF 모델을 검증하고 Studio 기반 권상 조건·Nastran 해석·결과 판정을 진행합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["Side Passage", "Studio", "권상"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "File", category: "PDF", title: "DrawingToAnalysis", description: "설계 도면(PDF)을 업로드하여 LUG 구조 해석 BDF 모델로 변환합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["도면", "LUG"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "File", category: "Mooring Fitting", title: "Mooring Fitting Assessment", description: "Mooring Fitting / Winch 보강 구조의 CSV 2종을 입력받아 8단계 BDF 파이프라인을 자동 생성합니다.", icon: UploadCloud, color: "bg-blue-600", tags: ["Mooring", "Winch", "파이프라인"], devStatus: "Developing", contributor: "권혁민" },
  // ── Interactive Apps (signature: violet) ──────── Active ──
  { mode: "Interactive", category: "1D Beam", title: "Simple Beam Assessment", description: "단면 형상과 치수를 직접 입력하여 단순 보(Beam)의 응력 및 변위을 평가합니다.", icon: PenTool, color: "bg-violet-600", tags: ["1D요소", "굽힘응력", "실시간"], devStatus: "Active", contributor: "권혁민" },
  { mode: "Interactive", category: "Section", title: "Section Property Calculator", description: "단면 형상과 치수를 입력하여 단면 2차 모멘트(I), 단면계수(S), 회전반경(r) 등의 단면 특성값을 산출합니다.", icon: PenTool, color: "bg-violet-600", tags: ["단면", "특성값", "계산"], devStatus: "Active", contributor: "권혁민" },
  { mode: "Interactive", category: "Weld", title: "Block Weld Assessment", description: "블록 전도 방지 구속 용접양을 산출합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Weld", "Block", "용접"], devStatus: "Active", contributor: "김한별" },
  // ── Interactive Apps (signature: violet) ──────── Developing ──
  { mode: "Interactive", category: "Plate", title: "Plate Structure Analysis", description: "Plate 구조 해석용 Studio를 실행하여 판 구조 모델링 및 해석 작업을 진행합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Plate", "Studio", "구조해석"], devStatus: "Developing", contributor: "권혁민" },
  { mode: "Interactive", category: "Tank", title: "Independent Tank Assessment", description: "독립 탱크 구조 평가를 위한 외부 앱을 실행합니다.", icon: PenTool, color: "bg-violet-600", tags: ["Tank", "구조평가", "외부 앱"], devStatus: "Developing", contributor: "김한별" },
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
    supportsRerun: true,
    sampleFiles: [{ label: "Node/Member CSV 입력 포맷", guideTitle: "[파일] Truss Model Builder — CSV 입력 포맷" }],
  },
  "Truss Structural Assessment": {
    menuName: "Truss Structural Assessment",
    programNames: ["Truss Assessment", "Truss Structural Assessment"],
    apiEndpoint: "/api/analysis/assessment/request",
    supportsRerun: true,
    sampleFiles: [{ label: "BDF 입력 포맷", guideTitle: "[파일] Truss Structural Assessment — BDF 입력 포맷" }],
  },
  "HiTESS Model Builder": {
    menuName: "HiTESS Model Builder",
    programNames: ["HiTessModelBuilder", "ModelBuilderAnalysis", "HiTESS Model Builder"],
    communityKey: "hitess-model-builder",
    apiEndpoint: "/api/analysis/modelflow/request",
    supportsRerun: true,
    relatedApps: ["BDF Scanner", "F06 Parser"],
    transferOutputs: [{ key: "bdf_path", label: "BDF 모델", targetApp: "BDF Scanner" }],
    sampleFiles: [{ label: "CSV 패키지 입력 포맷", guideTitle: "[파일] HiTESS Model Builder — CSV 입력 포맷" }],
  },
  "HP-SCR 배관응력 해석": {
    menuName: "HP-SCR 배관응력 해석",
    programNames: ["HP-SCR", "HP-SCR PSA", "HP-SCR POR"],
    apiEndpoint: "/api/analysis/hpscr/request",
    supportsRerun: true,
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
    supportsRerun: true,
    relatedApps: ["HiTESS Model Builder", "BDF Scanner"],
  },
  "Side Passage Assessment": {
    menuName: "Side Passage Assessment",
    programNames: ["SidePassage", "Side Passage Assessment"],
    apiEndpoint: "/api/analysis/groupmoduleunit/request",
    supportsRerun: true,
    relatedApps: ["BDF Scanner", "HiTESS Model Builder"],
  },
  "Mooring Fitting Assessment": {
    menuName: "Mooring Fitting Assessment",
    programNames: ["MooringFitting", "MooringFittingSolve", "Mooring Fitting Assessment"],
    apiEndpoint: "/api/analysis/mooring-fitting/request",
    supportsRerun: true,
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
    supportsRerun: true,
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
    programNames: ["IndependentTank", "IndependentTankAssessment", "Independent Tank", "Independent Tank Assessment"],
  },
  // 외부 앱(별도 창) — 실행 시 WorkBench 프록시를 통해 외부 서버 앱을 띄운다.
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
    supportsRerun: true,
    relatedApps: ["HiTESS Model Builder", "F06 Parser"],
    transferOutputs: [{ key: "f06", label: "F06 파일", targetApp: "F06 Parser" }],
    sampleFiles: [{ label: "BDF 검증 예제", guideTitle: "[생산성] BDF Scanner — 입력 포맷" }],
  },
  "F06 Parser": {
    menuName: "F06 Parser",
    programNames: ["F06 Parser"],
    apiEndpoint: "/api/analysis/f06parser/request",
    supportsRerun: true,
    relatedApps: ["BDF Scanner", "HiTESS Model Builder"],
    acceptsTransferFrom: ["BDF Scanner"],
    sampleFiles: [{ label: "F06 결과 예제", guideTitle: "[생산성] F06 Parser — 입력 포맷" }],
  },
  "선급 Rule 기반 선체 가속도 Calculation": {
    menuName: "선급 Rule 기반 선체 가속도 Calculation",
    programNames: ["HullAcceleration", "선급 Rule 기반 선체 가속도 Calculation"],
    apiEndpoint: "/api/analysis/hullacceleration/request",
    supportsRerun: true,
  },
};

// 카탈로그/검색/재실행 UI가 설명 문구를 추측하지 않고 사용하는 명시적 I/O 계약.
// 실제 앱 계약이 바뀌면 이 레지스트리만 함께 갱신한다.
const APP_CAPABILITY_METADATA = {
  "Truss Model Builder": { inputFormats: ["CSV ×2"], outputFormats: ["BDF"], workflow: "File" },
  "Truss Structural Assessment": { inputFormats: ["BDF"], outputFormats: ["JSON", "XLSX", "3D"], workflow: "File" },
  "HiTESS Model Builder": { inputFormats: ["CSV ×1–3"], outputFormats: ["BDF", "JSON", "F06"], workflow: "Pipeline" },
  "HP-SCR 배관응력 해석": { inputFormats: ["BDF"], outputFormats: ["XLSX", "3D"], workflow: "File" },
  "이중관 구조 연료배관 해석": { inputFormats: ["CSV", "JSON"], outputFormats: ["BDF", "XLSX"], workflow: "Pipeline" },
  "Group & Module Unit 권상 구조 해석": { inputFormats: ["BDF"], outputFormats: ["BDF", "F06", "JSON"], workflow: "Pipeline" },
  "Side Passage Assessment": { inputFormats: ["BDF"], outputFormats: ["BDF", "F06", "JSON"], workflow: "Pipeline" },
  "DrawingToAnalysis": { inputFormats: ["PDF", "Image"], outputFormats: ["BDF", "JSON"], workflow: "Pipeline" },
  "Mooring Fitting Assessment": { inputFormats: ["CSV ×2"], outputFormats: ["BDF", "JSON", "XLSX"], workflow: "Pipeline" },
  "Simple Beam Assessment": { inputFormats: ["Direct input", "JSON"], outputFormats: ["Chart", "JSON"], workflow: "Interactive" },
  "Section Property Calculator": { inputFormats: ["Direct input"], outputFormats: ["Table", "JSON"], workflow: "Interactive" },
  "Block Weld Assessment": { inputFormats: ["Direct input"], outputFormats: ["Assessment"], workflow: "External" },
  "Plate Structure Analysis": { inputFormats: ["Direct input"], outputFormats: ["BDF", "Result"], workflow: "Studio" },
  "Independent Tank Assessment": { inputFormats: ["Direct input"], outputFormats: ["Assessment"], workflow: "External" },
  "Heavy Block Lifting Simulation": { inputFormats: ["Direct input"], outputFormats: ["Simulation"], workflow: "Interactive" },
  "Jib Rest Assessment": { inputFormats: ["Direct input"], outputFormats: ["Candidate table", "JSON"], workflow: "Parametric" },
  "Mast Post Assessment": { inputFormats: ["Direct input"], outputFormats: ["Candidate table", "JSON"], workflow: "Parametric" },
  "Column Buckling Load Calculator": { inputFormats: ["Direct input"], outputFormats: ["Assessment", "JSON"], workflow: "Parametric" },
  "Simplified Hole Fatigue Assessment": { inputFormats: ["Direct input"], outputFormats: ["Assessment", "JSON"], workflow: "Parametric" },
  "D Type Lug Assessment": { inputFormats: ["Direct input"], outputFormats: ["Assessment", "JSON"], workflow: "Parametric" },
  "Carling Free Calculator": { inputFormats: ["Direct input"], outputFormats: ["Assessment"], workflow: "Parametric" },
  "Carling Design Optimization": { inputFormats: ["Direct input"], outputFormats: ["Candidate table"], workflow: "Parametric" },
  "BDF Scanner": { inputFormats: ["BDF"], outputFormats: ["Validation", "F06"], workflow: "File" },
  "F06 Parser": { inputFormats: ["F06"], outputFormats: ["Table", "CSV"], workflow: "File" },
  "선급 Rule 기반 선체 가속도 Calculation": { inputFormats: ["PDF"], outputFormats: ["JSON", "CSV", "TXT"], workflow: "Pipeline" },
};

export const ANALYSIS_DATA = Object.freeze(RAW_ANALYSIS_DATA.map(app => Object.freeze({
  ...app,
  menuName: app.title,
  programNames: [app.title],
  ...(APP_CAPABILITY_METADATA[app.title] ?? { inputFormats: [], outputFormats: [], workflow: app.mode }),
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
const GLOBAL_JOB_HISTORY_LIMIT = 10;
const GLOBAL_JOB_VISIBLE_MS = 30 * 60 * 1000;
const GLOBAL_JOB_COLLAPSE_MS = 30 * 1000;
const ANALYSIS_MENU_FRESH_ENTRY_KEY = 'workbench:analysis-menu-fresh-entry';
const ANALYSIS_MENU_RESUME_ENTRY_KEY = 'workbench:analysis-menu-resume-entry';
const MENU_ENTRY_MAX_AGE_MS = 5000;
// 관리자가 App 상태를 바꾼 것을 다른 사용자 화면이 따라잡는 주기.
const APP_SETTINGS_POLL_MS = 60 * 1000;
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
      .slice(0, GLOBAL_JOB_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writePersistedGlobalJobs(jobs) {
  try {
    localStorage.setItem(GLOBAL_JOBS_KEY, JSON.stringify(jobs.slice(0, GLOBAL_JOB_HISTORY_LIMIT)));
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
  const { currentMenu } = useNavigation();
  const { isAuthenticated } = useAuth();
  const [favorites, setFavorites] = useState(() => readLocalFavorites());

  // 관리자가 지정한 App 오버라이드(서비스 상태·점검 안내·설명 등)를 받아 둔다.
  // 로그아웃하면 비워 코드 기본값으로 되돌린다.
  useEffect(() => {
    if (!isAuthenticated) {
      clearAppSettings();
      return undefined;
    }
    let cancelled = false;
    refreshAppSettings().then(() => {
      if (cancelled) return;
    });
    // 다른 관리자가 상태를 바꿨을 수 있으므로 주기적으로 다시 확인한다.
    const timer = setInterval(refreshAppSettings, APP_SETTINGS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated]);

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
      const now = Date.now();
      const patchedStatus = patch?.status ?? job.status;
      const isTerminal = patchedStatus === 'Success' || patchedStatus === 'Failed' || patchedStatus === 'Interrupted';
      const nextJob = {
        ...job,
        ...patch,
        updatedAt: now,
        ...(isTerminal && !job.completedAt ? {
          completedAt: now,
          firstShownAt: job.firstShownAt || now,
          expiresAt: now + GLOBAL_JOB_VISIBLE_MS,
        } : {}),
      };
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
    setGlobalJobs(prev => [
      nextJob,
      ...prev.filter(job => job.jobId !== jobId),
    ].slice(0, GLOBAL_JOB_HISTORY_LIMIT));
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

    </DashboardContext.Provider>
  );
}

/**
 * 관리자 오버라이드가 반영된 '실효' 앱 카탈로그.
 *
 * ANALYSIS_DATA(코드 기본값) 위에 App Settings 값을 덮은 목록을 돌려준다.
 * 서비스 상태·차단 여부·설명/태그/담당자는 반드시 이 훅으로 읽어야 관리자가
 * 바꾼 내용이 화면에 반영된다(ANALYSIS_DATA 를 직접 읽으면 코드 기본값 고정).
 *
 * @returns {{apps: Array, getApp: (title: string) => object|undefined,
 *            getBlock: (app: object) => object|null,
 *            isBlockedFor: (app: object, isAdmin: boolean) => boolean,
 *            refresh: () => Promise<boolean>}}
 */
export const useAppCatalogue = () => {
  const overrides = useAppSettings();
  const apps = useMemo(
    () => ANALYSIS_DATA.map(app => mergeAppSetting(app, overrides[app.title])),
    [overrides],
  );
  const getApp = useCallback(
    (title) => apps.find(app => app.title === title),
    [apps],
  );
  return useMemo(
    () => ({
      apps,
      getApp,
      getBlock: getAppBlock,
      isBlockedFor: isAppBlockedFor,
      refresh: refreshAppSettings,
    }),
    [apps, getApp],
  );
};

export const useDashboard = () => useContext(DashboardContext);
export const useFavorites = () => useContext(FavoritesContext);
export const useGlobalJobs = () => useContext(GlobalJobContext);
export const useAnalysisPageState = () => useContext(AnalysisPageStateContext);

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
