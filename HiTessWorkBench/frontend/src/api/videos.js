import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** HiTESS 소개 영상 목록 [{ id, title, subtitle }] (로그인 필요) */
export const getVideos = () =>
  axios.get(`${API_BASE_URL}/api/videos`, { headers: getAuthHeaders() });

/** 재생 표 발급 → { streamPath, watermark, title, subtitle, expiresIn }. 서버에 시청 기록(VIDEO_PLAY)이 남는다. */
export const issueVideoTicket = (videoId) =>
  axios.post(`${API_BASE_URL}/api/videos/${encodeURIComponent(videoId)}/ticket`, {}, { headers: getAuthHeaders() });
