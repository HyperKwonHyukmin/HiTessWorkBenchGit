import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * My Projects — 내 해석을 Hi-TESS LogBook 으로 보내기(LogBook 65). 관리자 All Projects 와 같은 모양을 돌려준다.
 * 백엔드: routers/my_projects_logbook.py (자기 해석만, 성공한 해석만, .env LOGBOOK_OWNER_SEND=0 이면 꺼짐)
 */

/** 내 해석 1건의 작업 폴더 파일 + 보낸 이력. data = { folders, files, truncated, exports, liftingSet?, canSend, blockedReason } */
export const getMyProjectLogbookFiles = (analysisId) =>
  axios.get(`${API_BASE_URL}/api/analysis/${analysisId}/logbook/files`, { headers: getAuthHeaders() });

/** 고른 파일을 내 이름의 LogBook '올리기와 확정'으로 보낸다. data = 관리자 보내기와 같다 */
export const exportMyProjectToLogbook = (analysisId, { paths, title, note }) =>
  axios.post(
    `${API_BASE_URL}/api/analysis/${analysisId}/logbook`,
    { paths, title: title || null, note: note || null },
    { headers: getAuthHeaders(), timeout: 30 * 60 * 1000 },
  );
