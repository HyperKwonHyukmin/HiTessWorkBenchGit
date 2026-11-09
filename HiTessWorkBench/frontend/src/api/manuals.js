import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';
import { downloadBlob, filenameFromDisposition } from '../utils/fileHelper';

/**
 * Studio 사용 설명서(백엔드 Manuals/<id>/, app/routers/manuals.py).
 * 웹판은 그림·글꼴까지 든 한 파일 HTML 이라 iframe srcDoc 으로 바로 띄운다.
 */
export function getManualInfo(manualId) {
  return axios.get(`${API_BASE_URL}/api/manuals/${manualId}`, { headers: getAuthHeaders() });
}

export async function getManualHtml(manualId) {
  const res = await axios.get(`${API_BASE_URL}/api/manuals/${manualId}/web`, {
    headers: getAuthHeaders(),
    responseType: 'text',
  });
  return res.data;
}

/** PDF 받기 — 파일 이름은 서버가 주는 한글 이름(RFC 5987)을 쓴다. */
export async function downloadManualPdf(manualId, fallbackName) {
  const res = await axios.get(`${API_BASE_URL}/api/manuals/${manualId}/pdf`, {
    headers: getAuthHeaders(),
    responseType: 'blob',
  });
  const filename = filenameFromDisposition(res.headers['content-disposition'], fallbackName || `${manualId}.pdf`);
  downloadBlob(res.data, filename, 'application/pdf');
  return filename;
}
