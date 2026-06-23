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

/** Assessment JSON → XLSX 변환 다운로드 (DRM 우회: 서버 메모리에서 생성) */
export const exportAssessmentXlsx = (jsonPath) =>
  axios.get(`${API_BASE_URL}/api/analysis/export-xlsx?json_path=${encodeURIComponent(jsonPath)}`, {
    responseType: 'blob',
    headers: getAuthHeaders()
  });

/** 프로그램별 사용 건수 집계 (days=0이면 전체 기간) */
export const getTopPrograms = (days = 30, limit = 10) =>
  axios.get(`${API_BASE_URL}/api/analysis/stats/top-programs`, { params: { days, limit }, headers: getAuthHeaders() });

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
