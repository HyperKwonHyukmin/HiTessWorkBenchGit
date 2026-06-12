/**
 * 뉴스레터 API 클라이언트
 * 기존 admin.js / analysis.js 패턴을 그대로 따름:
 *   - API_BASE_URL 동적 import (런타임 서버 변경 반영)
 *   - getAuthHeaders() 로 Bearer 토큰 자동 부착
 *
 * 미리보기는 PDF 가 아니라 페이지별 PNG(<img>)로 표시한다.
 * (Electron 내장 PDF 뷰어는 환경에 따라 iframe PDF 를 렌더하지 못하지만, PNG <img> 는 어디서나 렌더된다.)
 * 다운로드는 원본 PDF 를 그대로 받는다.
 */
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 뉴스레터 목록 조회 (발행일 내림차순) */
export const getNewsletters = () =>
  axios.get(`${API_BASE_URL}/api/newsletters`, { headers: getAuthHeaders() });

/**
 * 뉴스레터 업로드 (관리자 전용)
 * @param {FormData} formData - title(필수), issue_date(선택), description(선택), file(PDF 필수)
 */
export const uploadNewsletter = (formData) =>
  axios.post(`${API_BASE_URL}/api/newsletters`, formData, {
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'multipart/form-data',
    },
  });

/** 뉴스레터 삭제 (관리자 전용) */
export const deleteNewsletter = (id) =>
  axios.delete(`${API_BASE_URL}/api/newsletters/${id}`, { headers: getAuthHeaders() });

/** PDF 총 페이지 수 조회 URL */
export const getNewsletterPagesUrl = (id) =>
  `${API_BASE_URL}/api/newsletters/${id}/pages`;

/** 특정 페이지(1-기반) PNG 미리보기 URL */
export const getNewsletterPageUrl = (id, pageNo) =>
  `${API_BASE_URL}/api/newsletters/${id}/page/${pageNo}`;

/** PDF 원본 다운로드 URL (download=true → 첨부) */
export const getNewsletterDownloadUrl = (id) =>
  `${API_BASE_URL}/api/newsletters/${id}/file?download=true`;
