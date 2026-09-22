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

/**
 * 해석 기록의 결과 파일 보관 정책을 변경합니다.
 *
 *  - extendDays : 1~180. null|undefined 면 연장 없음.
 *  - pinned     : true/false 면 핀 상태를 그 값으로 설정, null|undefined 면 변경 없음.
 *  - 성공 시 갱신된 프로젝트(`{ ..., retention: {...} }`) 를 그대로 돌려준다.
 *
 * 상태 코드:
 *  - 400 : 요청 비었거나 누적 상한(180일) 초과 · 422 : extend_days 범위/타입 오류
 *  - 403 : 소유자/관리자 아님 · 404 : 기록 없음 · 409 : 파일이 이미 만료
 */
export const updateAnalysisRetention = (analysisId, { extendDays = null, pinned = null } = {}) =>
  axios.post(
    `${API_BASE_URL}/api/analysis/${analysisId}/retention`,
    {
      extend_days: extendDays == null ? null : Number(extendDays),
      pinned: pinned == null ? null : Boolean(pinned),
    },
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
 *
 * 검증 **엔진** 은 GroupModuleUnit 것을 재사용하지만 접수는 이 앱 전용 엔드포인트로 한다
 * (SidePassage 와 같은 방식). 그래야 작업 폴더가
 * `userConnection/{timestamp}_{사번}_ModuleOceanMoving/` 으로 만들어져 2·3단계 산출물이
 * 한 자리에 모이고, DB program_name·앱 가용성 게이트도 이 앱 기준으로 걸린다.
 */
export const requestModuleOceanTransport = (formData) =>
  postAnalysisRequest(`${API_BASE_URL}/api/analysis/module-ocean-transport/request`, formData, 'ModuleOceanTransport');

/**
 * Module Unit 해상 운송 구조 해석 — 3단계 구조 해석 수행.
 * 과정 1(MU 응력) + 과정 2(Leg 반력) 를 한 job 으로 순차 실행한다.
 * 다른 JSON 바디 해석 요청(solveDrawingModel 등)과 동일하게 axios 응답 전체를 반환한다 —
 * 호출부는 res.data.job_id 로 꺼내 쓴다.
 */
export const requestModuleOceanStructural = (payload) =>
  axios.post(`${API_BASE_URL}/api/analysis/module-ocean-transport/structural-run`, payload, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
  });

/** 원본 Barge Excel의 APOL(1) 보간으로 선택 LC 한 개의 가속도를 계산한다. */
export const calculateModuleOceanAcceleration = (payload) =>
  axios.post(`${API_BASE_URL}/api/analysis/module-ocean-transport/acceleration-calculate`, payload, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
  });

/**
 * Module Unit 해상 운송 구조 해석 — 과정 2 정반 Leg 용접부 재평가.
 *
 * 용접 사양(각장·용접길이·tack 개수…)은 Leg 반력과 무관하므로 사양을 바꿀 때마다
 * 20분짜리 Nastran 을 다시 돌릴 이유가 없다. 백엔드가 저장된 반력 결과 파일을 읽어
 * 판정만 다시 하고, 결과 JSON 도 같은 작업 폴더에 덮어쓴다.
 */
export const assessModuleOceanWeld = (legResultJson, weld) =>
  axios.post(`${API_BASE_URL}/api/analysis/module-ocean-transport/weld-assess`,
    { leg_result_json: legResultJson, weld },
    { headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } });

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

/**
 * Unit 권상 보고서 — 응답 blob + 헤더(파일명·경고·요약).
 * kind:   'result' = 사내 표준 서식 2~3페이지(기본) · 'detail' = 다장 기술보고서.
 * format: 'pdf'(기본) = 백엔드가 만든 xlsx 를 서버 Excel 로 인쇄해 변환 · 'xlsx' = 원본 그대로.
 */
export const downloadUnitLiftingReport = (analysisId, options = {}, kind = 'result', format = 'pdf') =>
  axios.post(`${API_BASE_URL}/api/analysis/unit-structural/report`,
    { analysisId, kind, format, options },
    {
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      responseType: 'blob',
    });
