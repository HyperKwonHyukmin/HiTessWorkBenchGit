import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 내 대화 목록 + 미읽음 개수 조회 (도크 폴링용) */
export const getChatThreads = () =>
  axios.get(`${API_BASE_URL}/api/chat/threads`, { headers: getAuthHeaders() });

/** 대화 가능한 활성 관리자 목록 + 접속 상태 (패널 열려 있는 동안 폴링) */
export const getChatContacts = () =>
  axios.get(`${API_BASE_URL}/api/chat/contacts`, { headers: getAuthHeaders() });

/** 특정 상대와의 대화내역 조회 — 조회 시 나에게 온 미읽음은 서버에서 읽음 처리됨 */
export const getChatConversation = (otherId) =>
  axios.get(
    `${API_BASE_URL}/api/chat/conversation/${encodeURIComponent(otherId)}`,
    { headers: getAuthHeaders() },
  );

/** 메시지 전송 (관리자↔사용자 1:1 DM) */
export const sendChatMessage = (recipientId, body) =>
  axios.post(
    `${API_BASE_URL}/api/chat/send`,
    { recipient_id: recipientId, body },
    { headers: getAuthHeaders() },
  );

/** 대화 '내게서만' 삭제 — 내 화면에서만 숨기고 상대 기록은 보존 */
export const deleteChatConversation = (otherId) =>
  axios.delete(
    `${API_BASE_URL}/api/chat/conversation/${encodeURIComponent(otherId)}`,
    { headers: getAuthHeaders() },
  );
