import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * D/W/M 사용량 리포트 조회.
 * @param {object} params
 * @param {'daily'|'weekly'|'monthly'} params.period
 * @param {string|null} [params.date] - YYYY-MM-DD
 * @param {AbortSignal} [params.signal]
 */
export function getUsageReport({ period, date, signal }) {
  return axios.get(`${API_BASE_URL}/api/analysis/report`, {
    params: { period, ...(date ? { date } : {}) },
    headers: getAuthHeaders(),
    signal,
  });
}

/**
 * 리포트 Excel 다운로드 — Blob을 받아 브라우저 다운로드 트리거.
 */
export async function downloadUsageReportXlsx({ period, date }) {
  const res = await axios.get(`${API_BASE_URL}/api/analysis/report/export-xlsx`, {
    params: { period, ...(date ? { date } : {}) },
    headers: getAuthHeaders(),
    responseType: 'blob',
  });

  const disposition = res.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : `WorkBench_UsageReport_${period}_${date || ''}.xlsx`;

  const blobUrl = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

/** program_id 별 리포트 가능 여부 조회. */
export function getReportCapabilities({ signal } = {}) {
  return axios.get(`${API_BASE_URL}/api/reports/capabilities`, {
    headers: getAuthHeaders(),
    signal,
  });
}

/**
 * 해석 1건의 계산서(XLSX)를 받아 브라우저 다운로드를 트리거한다.
 * 생성이 POST 인 이유는 백엔드 라우터 docstring 참조(App 가용성 게이트).
 */
export async function downloadAnalysisReport({ analysisId }) {
  const res = await axios.post(
    `${API_BASE_URL}/api/reports/generate`,
    { analysis_id: analysisId },
    { headers: getAuthHeaders(), responseType: 'blob' },
  );

  const disposition = res.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : `WorkBench_Report_${analysisId}.xlsx`;

  const blobUrl = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}
