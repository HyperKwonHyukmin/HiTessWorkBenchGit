// 구조해석 자동화 협의체 과제 현황 API(백엔드 routers/council.py). 모두 관리자 전용.
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';
import { publicPageUrl } from '../utils/publicPageUrl';

const base = () => `${API_BASE_URL}/api/council`;
const opts = () => ({ headers: getAuthHeaders() });

export const fetchCouncilBoard = () => axios.get(`${base()}/board`, opts()).then((r) => r.data);
export const createCouncilTask = (body) => axios.post(`${base()}/tasks`, body, opts()).then((r) => r.data);
export const updateCouncilTask = (id, body) => axios.patch(`${base()}/tasks/${id}`, body, opts()).then((r) => r.data);
export const deleteCouncilTask = (id) => axios.delete(`${base()}/tasks/${id}`, opts()).then((r) => r.data);
export const addCouncilNote = (taskId, kind, body) =>
  axios.post(`${base()}/tasks/${taskId}/notes`, { kind, body }, opts()).then((r) => r.data);
export const updateCouncilNote = (noteId, body) => axios.patch(`${base()}/notes/${noteId}`, { body }, opts()).then((r) => r.data);
export const deleteCouncilNote = (noteId) => axios.delete(`${base()}/notes/${noteId}`, opts()).then((r) => r.data);
export const seedFirstMeeting = () => axios.post(`${base()}/seed-first-meeting`, null, opts()).then((r) => r.data);

/**
 * 팀장, 실장님께 드릴 브라우저 주소. 페이지는 https 로 옮겨 가 로그인한다(src/admin/adminBootstrap.js).
 * http 로 적어 두면 처음 열 때 경고 없이 들어와 같은 포트의 https 로 넘어간다.
 */
export const councilPageUrl = () => publicPageUrl(API_BASE_URL, '/council/');

/** 서버가 준 오류 문구(422 의 detail 등). 없으면 기본 문구. */
export function councilErrorText(err, fallback = '저장하지 못했습니다.') {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (err?.response?.status === 403) return '관리자 권한이 필요합니다.';
  if (err?.response?.status === 404) return '이미 지워졌거나 서버에 이 기능이 아직 없습니다.';
  if (!err?.response) return '서버에 연결하지 못했습니다.';
  return `${fallback} (${err.response.status})`;
}
