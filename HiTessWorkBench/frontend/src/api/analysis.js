import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';
import { logActivity } from './activity';

const postAnalysisRequest = (url, formData, programName) =>
  axios.post(url, formData, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' }
  }).then((res) => {
    logActivity('ANALYSIS_REQUEST', {
      program_name: programName,
      job_id: res.data?.job_id,
    });
    return res;
  });

/** 사용자 해석 이력 조회 */
export const getAnalysisHistory = (employeeId, skip = 0, limit = 50, filters = {}) =>
  axios.get(`${API_BASE_URL}/api/analysis/history/${employeeId}`, {
    params: { skip, limit, ...filters },
    headers: getAuthHeaders()
  });

/** 보존된 입력 파일/옵션으로 과거 해석을 새 작업으로 재제출 */
export const rerunAnalysisProject = (analysisId) =>
  axios.post(
    `${API_BASE_URL}/api/analysis/${analysisId}/rerun`,
    {},
    { headers: getAuthHeaders() },
  );

/** 전체 해석 이력 조회 (관리자용) */
export const getAllAnalysisHistory = (limit = 50, skip = 0, filters = {}) =>
  axios.get(`${API_BASE_URL}/api/analysis/all`, {
    params: { skip, limit, ...filters },
    headers: getAuthHeaders()
  });

/** 해석 작업 상태 조회 (폴링용) */
export const getJobStatus = (jobId) =>
  axios.get(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });

/** Truss 해석 요청 */
export const requestTrussAnalysis = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/truss/request`, formData, 'TrussModelBuilder');

/** Truss Model Builder — 서버 내장 샘플 NODE/WAY CSV 미리보기 */
export const getTrussSamplePreview = () =>
  axios.get(`${API_BASE_URL}/api/analysis/truss/sample-preview`, {
    headers: getAuthHeaders(),
  });

/** Truss Assessment 요청 */
export const requestAssessment = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/assessment/request`, formData, 'TrussAssessment');

/** Beam 해석 요청 */
export const requestBeamAnalysis = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/beam/request`, formData, 'SimpleBeam');

/** BDF Scanner 요청 */
export const requestBdfScanner = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/bdfscanner/request`, formData, 'BdfScanner');

/** DrawingToAnalysis 요청 */
export const requestDrawingToAnalysis = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/drawing-to-analysis/request`, formData, 'DrawingToAnalysis');

/** DrawingToAnalysis — JPG/PNG 이미지 도면 요청 */
export const requestDrawingImageToAnalysis = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/drawing-to-analysis/image/request`, formData, 'DrawingToAnalysis');

/** DrawingToAnalysis — PDF 1개를 userConnection 폴더에 저장 (레거시 테스트용) */
export const uploadDrawingPdf = (file) => {
  const fd = new FormData();
  fd.append('pdf_file', file);
  return axios.post(`${API_BASE_URL}/api/analysis/drawing-to-analysis/upload`, fd, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' },
  });
};

/** DrawingToAnalysis — 카탈로그 PDF 목록 조회 */
export const listDrawingCatalogue = () =>
  axios.get(`${API_BASE_URL}/api/analysis/drawing-to-analysis/catalogue`, {
    headers: getAuthHeaders(),
  });

/** DrawingToAnalysis — 카탈로그 PDF 첫 페이지 미리보기 URL */
export const drawingCataloguePreviewUrl = (filename) =>
  `${API_BASE_URL}/api/analysis/drawing-to-analysis/catalogue/${encodeURIComponent(filename)}/preview`;

/** DrawingToAnalysis — 카탈로그 PDF로 변환 작업 시작 */
export const runDrawingCatalogue = (filename, { employeeId, meshSize = 10.0 }) => {
  const fd = new FormData();
  fd.append('employee_id', employeeId);
  fd.append('mesh_size', String(meshSize));
  fd.append('source', 'Workbench-Catalogue');
  return axios.post(
    `${API_BASE_URL}/api/analysis/drawing-to-analysis/catalogue/${encodeURIComponent(filename)}/run`,
    fd,
    { headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' } },
  );
};

/** DrawingToAnalysis — 편집한 파라미터로 모델 재구축 */
export const rebuildDrawingModel = ({ employeeId, workDir, mode, params, originalPdfPath = null }) =>
  axios.post(
    `${API_BASE_URL}/api/analysis/drawing-to-analysis/rebuild`,
    {
      employee_id: employeeId,
      work_dir: workDir,
      mode,
      params,
      original_pdf_path: originalPdfPath,
      source: 'Workbench-Rebuild',
    },
    { headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } },
  );

/** DrawingToAnalysis — 하중/경계조건을 BDF 에 반영해 Nastran 해석 실행
 *  loads: [{ nodes:[id...], fx, fy, fz }]   (N)
 *  bcs:   [{ nodes:[id...], dof:'123456' }]
 */
export const solveDrawingModel = ({ employeeId, workDir, bdfPath, mode, loads, bcs, holeRbe = null, rbe3Sets = [], loadCases = [] }) =>
  axios.post(
    `${API_BASE_URL}/api/analysis/drawing-to-analysis/solve`,
    {
      employee_id: employeeId,
      work_dir: workDir,
      bdf_path: bdfPath,
      mode,
      loads,
      bcs,
      hole_rbe: holeRbe,   // { center:{x,y,z}, ring_node_ids:[id], fx, fy, fz } | null
      rbe3_sets: rbe3Sets, // [{ ref_id, center:{x,y,z}, node_ids:[id] }] — Area 하중분배
      load_cases: loadCases, // [{ name, bc_ids:[idx], load_ids:[idx], include_rbe }]
      source: 'Workbench-Solve',
    },
    { headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } },
  );

/** HP-SCR 배관응력 해석 요청 (PSA / POR) */
export const requestHpscrAssessment = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/hpscr/request`, formData, 'HpScr');

/** Group & Module Unit 권상 구조 해석 — BDF 검증 (NastranBridge) */
export const requestGroupModuleUnit = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/groupmoduleunit/request`, formData, 'GroupModuleUnit');

/**
 * Module Unit 해상 운송 구조 해석 — Step1 BDF 입력 검증.
 * ⚠ 현재는 GroupModuleUnit 검증 엔진/엔드포인트를 그대로 재사용한다(사용자 결정).
 *   → DB program_name 도 "GroupModuleUnit" 으로 기록되므로 My Project 이력에는
 *     Group & Module Unit 권상 구조 해석으로 표시된다. 전용 엔드포인트가 생기면
 *     (SidePassage 처럼 /api/analysis/moduleoceantransport/request) 이 한 줄만 교체하면 된다.
 */
export const requestModuleOceanTransport = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/groupmoduleunit/request`, formData, 'ModuleOceanTransport');

/**
 * Module Unit 해상 운송 구조 해석 — 선택 가능한 정반 타입 목록과 제원.
 * 지오메트리가 없어 가볍다(선택 화면의 Spec 표가 즉시 뜬다).
 */
export const getJungbanDeckTypes = () =>
  axios.get(`${API_BASE_URL}/api/analysis/module-ocean-transport/jungban-decks`, {
    headers: getAuthHeaders(),
  });

/**
 * 선택한 타입의 고정 정반 모델(뷰어용 슬림 지오메트리).
 * 백엔드가 타입별로 최초 1회만 파싱하고 이후는 캐시에서 즉시 응답한다. 응답은 gzip 으로 내려온다.
 */
export const getJungbanViewerModel = (deckType = 'A') =>
  axios.get(`${API_BASE_URL}/api/analysis/module-ocean-transport/jungban-model`, {
    params: { deck_type: deckType },
    headers: getAuthHeaders(),
  });

/**
 * 검증 단계가 만든 모델 JSON(JSON_ModelInfo)을 뷰어용 슬림 지오메트리로 받아온다.
 * ⚠ 원본 모델 JSON 은 대형 모델에서 30MB 를 넘는다 — 절대 downloadFileText 로 직접 받지 말 것.
 */
export const getModuleOceanViewerModel = (modelJsonPath, name = 'model') =>
  axios.get(`${API_BASE_URL}/api/analysis/module-ocean-transport/viewer-model`, {
    params: { model_json: modelJsonPath, name },
    headers: getAuthHeaders(),
  });

/** Side Passage Assessment — BDF 검증 */
export const requestSidePassageAssessment = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/sidepassage/request`, formData, 'SidePassage');

/** Group & Module Unit — 서버 경로로 BDF 검증 요청 (프로그램 간 연계용) */
export const requestGroupModuleUnitFromPath = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/groupmoduleunit/request-from-path`, formData, 'GroupModuleUnit');

/** F06 Parser 요청 */
export const requestF06Parser = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/f06parser/request`, formData, 'F06Parser');

/** 선급 Rule 기반 선체 가속도 Calculation 요청 (PDF → Summary of Loading Conditions 추출) */
export const requestHullAcceleration = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/hullacceleration/request`, formData, 'HullAcceleration');

/** 선급 Rule 기반 선체 가속도 — 내장 샘플 PDF 로 즉시 실행 (업로드 없이 서버 로컬 샘플 사용) */
export const requestHullAccelerationSample = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/hullacceleration/sample-request`, formData, 'HullAccelerationSample');

/** 샘플 TS PDF 핵심 페이지 미리보기 (표지 + 제원 + Summary 페이지를 base64 PNG 리스트로 반환) */
export const getHullAccelerationSamplePreview = () =>
  axios.get(`${API_BASE_URL}/api/analysis/hullacceleration/sample-preview`, {
    headers: getAuthHeaders(),
  });

/** 파일 다운로드 (blob) */
export const downloadFileBlob = (filepath) =>
  axios.get(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(filepath)}`, {
    responseType: 'blob',
    headers: getAuthHeaders()
  });

/** 파일 다운로드 (text - BDF 등) */
export const downloadFileText = (filepath) =>
  axios.get(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(filepath)}`, {
    responseType: 'text',
    headers: getAuthHeaders()
  });

/** Group/Module Unit 권상 구조해석 산출물 목록 (parent BDF 폴더에서 존재하는 lifting 산출물만) */
export const getGroupModuleUnitArtifacts = (parentId) =>
  axios.get(`${API_BASE_URL}/api/analysis/groupmoduleunit/${parentId}/artifacts`, {
    headers: getAuthHeaders()
  });

/** Assessment JSON → XLSX 변환 다운로드 (DRM 우회: 서버 메모리에서 생성) */
export const exportAssessmentXlsx = (jsonPath) =>
  axios.get(`${API_BASE_URL}/api/analysis/export-xlsx?json_path=${encodeURIComponent(jsonPath)}`, {
    responseType: 'blob',
    headers: getAuthHeaders()
  });

/** 프로그램별 사용 건수 집계 (days=0이면 전체 기간) */
export const getTopPrograms = (days = 30, limit = 10) =>
  axios.get(`${API_BASE_URL}/api/analysis/stats/top-programs`, { params: { days, limit }, headers: getAuthHeaders() });

/** 특정 프로그램(App)의 상세 사용 통계 (관리자 — 대시보드 프로그램 행 클릭 시 모달용) */
export const getProgramUsageDetail = (programName, { date_from, date_to, aliases } = {}) =>
  axios.get(`${API_BASE_URL}/api/analysis/stats/program/${encodeURIComponent(programName)}`, {
    params: {
      date_from: date_from || undefined,
      date_to: date_to || undefined,
      aliases: Array.isArray(aliases) && aliases.length > 0 ? aliases.join('|') : undefined,
    },
    headers: getAuthHeaders(),
  });

/** 특정 Analysis ID로 단건 조회 */
export const getAnalysisById = (id) =>
  axios.get(`${API_BASE_URL}/api/analysis/${id}`, { headers: getAuthHeaders() });

/** 사용자 당월 해석 수행 건수 조회 (limit 제약 없음) */
export const getMonthlyAnalysisCount = (employeeId, year, month) =>
  axios.get(`${API_BASE_URL}/api/analysis/stats/monthly`, {
    params: { employee_id: employeeId, year, month },
    headers: getAuthHeaders()
  });

/** Group Module Unit — BDF COG(무게중심) 계산 */
export const requestGroupModuleCog = (bdfPath) =>
  axios.post(`${API_BASE_URL}/api/analysis/groupmodule/cog`,
    { bdf_path: bdfPath },
    { headers: getAuthHeaders() }
  );
