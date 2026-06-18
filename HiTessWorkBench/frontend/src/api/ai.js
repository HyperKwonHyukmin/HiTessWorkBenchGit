import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** AI 챗봇 질의 (signal: AbortController.signal — 진행 중 요청 취소용) */
export const chatWithAI = (question, chat_history, target_document, signal) =>
  axios.post(`${API_BASE_URL}/api/ai/chat`, { question, chat_history, target_document }, { headers: getAuthHeaders(), signal });

/** 학습된 문서 목록 조회 */
export const getAIDocuments = () =>
  axios.get(`${API_BASE_URL}/api/ai/documents`, { headers: getAuthHeaders() });

/** 문서 학습(Ingest) 트리거 */
export const triggerIngest = () =>
  axios.post(`${API_BASE_URL}/api/ai/ingest`, {}, { headers: getAuthHeaders() });
