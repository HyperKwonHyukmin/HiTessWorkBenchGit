import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * 선별형 BDF Model Registry API.
 *
 * 계약: 클라이언트는 **파일 경로를 보내지 않는다.** source_analysis_id + artifact_kind 만
 * 보내고 서버가 allowlist 로 실제 경로를 해석한다.
 * 등록/수정/보관은 관리자 전용이며, 프론트에서 버튼을 숨기더라도 백엔드가 최종 방어한다.
 */

const BASE = () => `${API_BASE_URL}/api/model-registry`;

const jsonHeaders = () => ({ ...getAuthHeaders(), 'Content-Type': 'application/json' });

/**
 * preview/register 는 서버에서 BDF 를 파싱한다. 기존 요약 JSON 이 없으면 엔진 폴백이
 * 최대 180s 까지 걸리므로 넉넉히 잡되, **무한 대기는 막는다** —
 * 타임아웃이 없으면 연결이 끊겼을 때 모달이 영원히 스피너 상태로 갇힌다.
 */
const PARSE_TIMEOUT_MS = 300_000;

/** 등록 미리보기 — 서버 상태를 변경하지 않는다. (관리자 전용) */
export const previewModelRegistration = (sourceAnalysisId, artifactKind, config = {}) =>
  axios.post(
    `${BASE()}/preview`,
    { source_analysis_id: sourceAnalysisId, artifact_kind: artifactKind },
    { headers: jsonHeaders(), timeout: PARSE_TIMEOUT_MS, ...config },
  );

/** BDF 를 Model Library 에 영구 등록한다. (관리자 전용) */
export const registerModel = (payload) =>
  axios.post(`${BASE()}/models`, payload, {
    headers: jsonHeaders(),
    timeout: PARSE_TIMEOUT_MS,
  });

/** 등록 모델 목록 — 서버 사이드 검색/필터/페이지네이션 */
export const listRegisteredModels = (params = {}, config = {}) =>
  axios.get(`${BASE()}/models`, { params, headers: getAuthHeaders(), ...config });

/** 등록 모델 상세 (revision + artifact 포함) */
export const getRegisteredModel = (modelUid) =>
  axios.get(`${BASE()}/models/${modelUid}`, { headers: getAuthHeaders() });

/** metadata 부분 갱신 — 새 revision 을 만들지 않는다. (관리자 전용) */
export const updateRegisteredModel = (modelUid, changes) =>
  axios.patch(`${BASE()}/models/${modelUid}`, changes, { headers: jsonHeaders() });

/** 목록에서 내린다. 파일은 보존된다. (관리자 전용) */
export const archiveRegisteredModel = (modelUid) =>
  axios.post(`${BASE()}/models/${modelUid}/archive`, {}, { headers: getAuthHeaders() });

/**
 * 보관을 해제해 목록으로 되돌린다 — archive 의 역연산. (관리자 전용)
 *
 * 같은 BDF 는 sha256 이 전역 unique 라 재등록할 수 없으므로,
 * 보관된 모델을 다시 쓰는 방법은 재등록이 아니라 복원이다.
 */
export const restoreRegisteredModel = (modelUid) =>
  axios.post(`${BASE()}/models/${modelUid}/restore`, {}, { headers: getAuthHeaders() });

/**
 * 3D 미리보기용 좌표/연결 정보.
 *
 * 상세 응답과 분리한 이유는 크기다 — 노드/요소 배열은 수 MB 라 목록·상세에 매번 실으면
 * 화면 전체가 느려진다. 사용자가 미리보기를 열 때만 받아 간다.
 * 저장된 정규화 JSON 이 없으면 서버가 BDF 를 다시 파싱하므로 넉넉한 타임아웃을 준다.
 */
export const getRegistryModelGeometry = (modelUid, params = {}, config = {}) =>
  axios.get(`${BASE()}/models/${modelUid}/geometry`, {
    params,
    headers: getAuthHeaders(),
    timeout: PARSE_TIMEOUT_MS,
    ...config,
  });

/**
 * 형상이 비슷한 등록 모델 — **왜 비슷한지**(차원별 기여)를 함께 받는다.
 *
 * 제목 검색으로는 같은 형상을 다른 이름으로 등록한 모델을 영원히 못 찾는다.
 * 서버가 SQL 로 후보를 좁히고 파이썬으로 거리를 재며, vector DB 는 쓰지 않는다.
 */
export const getSimilarModels = (modelUid, params = {}, config = {}) =>
  axios.get(`${BASE()}/models/${modelUid}/similar`, {
    params,
    headers: getAuthHeaders(),
    ...config,
  });

/** 등록 모델 통계 — 현재 사용자가 볼 수 있는 모델만 집계된다. */
export const getRegistryInsights = (params = {}, config = {}) =>
  axios.get(`${BASE()}/insights/overview`, { params, headers: getAuthHeaders(), ...config });

/** 분석용 export — 사번은 기본 제외(include_identity 는 관리자만). */
export const exportRegistry = (params = {}) =>
  axios.get(`${BASE()}/export.json`, { params, headers: getAuthHeaders() });

/** artifact 다운로드 — ID 로만 조회한다(경로를 보내지 않는다). */
export const downloadRegistryArtifact = (artifactId) =>
  axios.get(`${BASE()}/artifacts/${artifactId}/download`, {
    headers: getAuthHeaders(),
    responseType: 'blob',
  });
