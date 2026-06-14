/**
 * 뉴스레터 API 클라이언트 (공유 폴더 기반)
 *   - API_BASE_URL 동적 import (런타임 서버 변경 반영)
 *   - 목록/미리보기/다운로드는 인증 불필요 — 공유 폴더를 그대로 노출한다.
 *
 * id 는 '호 폴더명'(한글 포함)이므로 URL 경로에 넣을 때 encodeURIComponent 로 인코딩한다.
 * 미리보기는 PDF 가 아니라 페이지별 PNG(<img>)로 표시하고, 다운로드는 원본 PDF 를 받는다.
 */
import axios from 'axios';
import { API_BASE_URL } from '../config';

/** 뉴스레터 목록 조회 (발행일 내림차순) */
export const getNewsletters = () =>
  axios.get(`${API_BASE_URL}/api/newsletters`);

/** PDF 총 페이지 수 조회 URL */
export const getNewsletterPagesUrl = (id) =>
  `${API_BASE_URL}/api/newsletters/${encodeURIComponent(id)}/pages`;

/** 특정 페이지(1-기반) PNG 미리보기 URL */
export const getNewsletterPageUrl = (id, pageNo) =>
  `${API_BASE_URL}/api/newsletters/${encodeURIComponent(id)}/page/${pageNo}`;

/** PDF 원본 다운로드 URL (download=true → 첨부) */
export const getNewsletterDownloadUrl = (id) =>
  `${API_BASE_URL}/api/newsletters/${encodeURIComponent(id)}/file?download=true`;
