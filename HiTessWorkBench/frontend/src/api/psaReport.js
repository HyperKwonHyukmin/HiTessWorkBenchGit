// PSA 평가보고서 자동화 — 결과 폴더 업로드 API (백엔드 routers/psa_report.py)
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';
import { planBatches, relativeInsidePicked } from '../utils/psaReport';

const base = () => `${API_BASE_URL}/api/analysis/psa-report`;

export const createPsaWorkspace = () =>
  axios.post(`${base()}/workspace`, null, { headers: getAuthHeaders() }).then(r => r.data.workspace);

/** 남은 대상 폴더 { TD01: {fileCount,totalBytes} } / 작업 폴더가 없어졌으면 null. */
export const describePsaWorkspace = (workspace) =>
  axios.get(`${base()}/workspace`, { params: { workspace }, headers: getAuthHeaders() })
    .then(r => r.data.targets)
    .catch(err => {
      // 404 = 30일 정리 등으로 없어짐 · 403 = 다른 사람의 입력 파일을 불러옴 → 둘 다 새 작업 폴더로
      if (err?.response?.status === 404 || err?.response?.status === 403) return null;
      throw err;
    });

/** 입력값 전체(입력 파일과 같은 내용)를 작업 폴더의 psa_input.json 으로 저장. */
export const savePsaInput = (workspace, inputJsonText) =>
  axios.put(`${base()}/input`, { workspace, input: JSON.parse(inputJsonText) }, { headers: getAuthHeaders() });

export const removePsaFolder = (workspace, target) => {
  const fd = new FormData();
  fd.append('workspace', workspace);
  fd.append('target', target);
  return axios.post(`${base()}/folder-remove`, fd, { headers: getAuthHeaders() });
};

/**
 * 고른 폴더 파일 전부를 묶음으로 나눠 차례로 올린다(첫 묶음이 서버 폴더를 비운다).
 * onProgress({ doneFiles, totalFiles }) · 반환 { saved, drmFiles }
 * depth = 서버 경로에서 뺄 앞 폴더 수. 1 = 고른 폴더 이름만 뺌(기본, 파일만 고르면 파일 이름 그대로).
 * reset = 첫 묶음에서 서버 폴더를 비울지(기본). false = 있던 파일에 더한다(같은 이름은 덮어씀 — 그림 파일 추가).
 */
export async function uploadPsaFolder(workspace, target, files, onProgress, { depth = 1, reset = true } = {}) {
  const batches = planBatches(files);
  let doneFiles = 0;
  const drmFiles = [];
  onProgress?.({ doneFiles, totalFiles: files.length });
  for (let i = 0; i < batches.length; i += 1) {
    const fd = new FormData();
    fd.append('workspace', workspace);
    fd.append('target', target);
    fd.append('reset', i === 0 && reset ? 'true' : 'false');
    for (const f of batches[i]) {
      fd.append('paths', depth === 1 ? relativeInsidePicked(f) : String(f.webkitRelativePath || f.name).split('/').slice(depth).join('/'));
      fd.append('files', f, f.name);
    }
    const res = await axios.post(`${base()}/folder-upload`, fd, { headers: getAuthHeaders(), timeout: 0 });
    drmFiles.push(...(res.data?.drmFiles || []));
    doneFiles += batches[i].length;
    onProgress?.({ doneFiles, totalFiles: files.length });
  }
  return { saved: doneFiles, drmFiles };
}

/** 서버 오류 → 사용자 문구 */
export const psaUploadErrorMessage = (err) => {
  const d = err?.response?.data?.detail;
  if (typeof d === 'string' && d && d !== 'workspace_missing') return d;
  if (err?.response?.status === 403) return '이 작업 폴더에 쓸 권한이 없습니다.';
  if (!err?.response) return '서버에 연결하지 못했습니다.';
  return '폴더를 올리지 못했습니다.';
};

/** Line 폴더마다 보고서에 필요한 파일 후보 { 폴더: { kinds: {kind: [경로]}, unreadable } } / 작업 폴더가 없으면 null */
export const getPsaChecklist = (workspace) =>
  axios.get(`${base()}/checklist`, { params: { workspace }, headers: getAuthHeaders(), timeout: 120000 })
    .then(r => r.data.targets)
    .catch(err => {
      if (err?.response?.status === 404 || err?.response?.status === 403) return null;
      throw err;
    });

/**
 * 보고서(docx) 만들기 — 서버가 작업 폴더의 psa_input.json 으로 만들어 바이트로 돌려준다(디스크에 쓰지 않음).
 * 반환 { blob, filename, warnings }. 실패하면 detail 문구를 담은 Error.
 */
export async function generatePsaReport(workspace, { review = false, pending = [] } = {}) {
  try {
    const res = await axios.post(`${base()}/report`, { workspace, review, pending: review ? pending : [] }, {
      headers: getAuthHeaders(), responseType: 'blob', timeout: 300000,
    });
    return {
      blob: res.data,
      filename: reportFilenameFrom(res.headers?.['content-disposition']),
      warnings: reportWarningsFrom(res.headers?.['x-report-warnings']),
      missing: Number(res.headers?.['x-report-missing']) || 0, // 보고서에 'Not provided' 로 남은 자리 수
    };
  } catch (err) {
    // responseType blob 이라 오류 본문도 Blob — detail 을 꺼내 문구로
    const data = err?.response?.data;
    let detail = '';
    if (data instanceof Blob) {
      try { detail = JSON.parse(await data.text())?.detail || ''; } catch { /* 본문이 JSON 이 아님 */ }
    }
    const e = new Error(typeof detail === 'string' && detail
      ? detail
      : (!err?.response ? '서버에 연결하지 못했습니다.' : `보고서를 만들지 못했습니다 (HTTP ${err.response.status}).`));
    e.status = err?.response?.status;
    throw e;
  }
}

/** 보고서 그림 자리와 그림 폴더에서 찾은 파일 { slots: [{slot,label,hint,file}], unmatched: [] } / 작업 폴더가 없으면 null */
export const getPsaFigures = (workspace) =>
  axios.get(`${base()}/figures`, { params: { workspace }, headers: getAuthHeaders(), timeout: 60000 })
    .then(r => r.data)
    .catch(err => {
      if (err?.response?.status === 404 || err?.response?.status === 403) return null;
      throw err;
    });

/**
 * 지금 입력으로 만든 검토 기록 { generated, filename, items, missing, templateFixed, kinds, warnings }.
 * 보고서를 먼저 만들 필요 없다(서버가 메모리에서 만들고 기록만 돌려준다). pending = 아직 고르지 않은 파일 칸.
 */
export const getPsaReview = (workspace, pending = []) =>
  axios.post(`${base()}/review`, { workspace, pending }, { headers: getAuthHeaders(), timeout: 300000 })
    .then(r => r.data)
    .catch(err => {
      const detail = err?.response?.data?.detail;
      throw new Error(typeof detail === 'string' && detail
        ? detail
        : (!err?.response ? '서버에 연결하지 못했습니다.' : `검토 결과를 만들지 못했습니다 (HTTP ${err.response.status}).`));
    });

/** Content-Disposition 의 filename*=UTF-8''… (없으면 filename="…", 그것도 없으면 기본 이름) */
export function reportFilenameFrom(header) {
  const h = String(header || '');
  const star = h.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { /* 깨진 인코딩 */ } }
  const plain = h.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : 'Pipe Stress Analysis.docx';
}

/** X-Report-Warnings = URL 인코딩한 JSON 문자열 배열 */
export function reportWarningsFrom(header) {
  if (!header) return [];
  try {
    const v = JSON.parse(decodeURIComponent(header));
    return Array.isArray(v) ? v.map(String) : [];
  } catch { return []; }
}
