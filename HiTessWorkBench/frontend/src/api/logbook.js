import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * Hi-TESS LogBook 자동 로그인 창 주소를 받는다(30초 일회 코드가 실린 /sso 주소).
 * target('gmu'|'truss')·slot 을 주면 LogBook 이 선택 띠를 띄운다
 * ('WorkBench GMU 작업 N 에 보낼 BDF…' / 'WorkBench · Truss Structural Assessment에 보낼 BDF…'). truss 는 slot 1 고정.
 * 반환 data = { url, windowKey }
 */
export const launchLogbook = ({ target, slot } = {}) =>
  axios.post(`${API_BASE_URL}/api/logbook/launch`, { target, slot }, { headers: getAuthHeaders() });

/**
 * LogBook 의 BDF 를 WorkBench 서버로 가져온다(서버끼리 전송).
 * target = 'GroupModuleUnit' | 'TrussAssessment' (utils/logbookLink LOGBOOK_IMPORT_TARGET).
 * 반환 data = { bdfServerPath, fileName, entryId, fileId } — GMU 는 request-from-path 로, Truss 는 File 로 받아 올린다.
 * 409 logbook_target_not_allowed = LogBook 분류상 이 앱에 보낼 수 없는 모델(data.message = LogBook 사유).
 */
export const importFromLogbook = ({ fileId, target = 'GroupModuleUnit' }) =>
  axios.post(
    `${API_BASE_URL}/api/logbook/import`,
    { file_id: fileId, target },
    { headers: getAuthHeaders(), timeout: 180000 },
  );
