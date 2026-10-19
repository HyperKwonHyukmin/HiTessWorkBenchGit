import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * 관리자 All Projects — 모든 사용자의 해석 이력(My Projects 와 같은 기준: 샘플·세부 검토 제외).
 * filters = { search, program_name, status, employee_id, date_from, date_to, file_status: 'available'|'expired',
 *             logbook: 'sent'(LogBook 으로 보낸 기록만) }
 * 반환 data = { total, items: [...My Projects 행 + userName·department·logbook], programs: [App 이름] }
 */
export const getAdminProjects = (skip = 0, limit = 20, filters = {}) =>
  axios.get(`${API_BASE_URL}/api/admin/projects`, {
    params: { skip, limit, ...filters },
    headers: getAuthHeaders(),
  });

/** 해석 1건의 작업 폴더 전체 파일 + LogBook 보낸 이력. data = { folders, files, truncated, exports } */
export const getAdminProjectFiles = (analysisId) =>
  axios.get(`${API_BASE_URL}/api/admin/projects/${analysisId}/files`, { headers: getAuthHeaders() });

/**
 * 고른 파일을 Hi-TESS LogBook '정리 대기'로 보낸다(서버끼리 전송 — 큰 파일은 오래 걸린다).
 * 반환 data = { key, state: 'staged'|'blocked', blocked, rejected, file_count, total_bytes, title }
 */
export const exportProjectToLogbook = (analysisId, { paths, title, note }) =>
  axios.post(
    `${API_BASE_URL}/api/admin/projects/${analysisId}/logbook`,
    { paths, title: title || null, note: note || null },
    { headers: getAuthHeaders(), timeout: 30 * 60 * 1000 },
  );
