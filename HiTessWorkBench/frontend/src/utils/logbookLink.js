/**
 * Hi-TESS LogBook 연동 — GMU 권상 · Truss Structural Assessment 페이지가 쓰는 순수 규칙
 * (대상 가르기 · 작업 탭 찾기 · 받을 수 있는지 · 오류 문구).
 *
 * LogBook 창의 [WorkBench로 보내기] → Electron main 이 발신 창·origin 을 확인 → 본체에
 * 'logbook:model-picked' {requestId, target, slot, fileId, entryId, name} 를 보낸다.
 * 받는 탭은 작업 번호(slot = ws.slotNo, 탭의 고정 정체성)로만 찾는다 — 위치 순번·활성 탭으로 찾으면
 * 다른 작업 탭의 모델을 덮어쓴다(작업 탭 규칙: Studio 이벤트처럼 탭을 특정할 것).
 * 계약 원본: LogBook 저장소 docs/plans/2026-10-08-logbook-18-workbench-link.md 7절.
 */
import { isGmuWorkspaceIdle, isGmuWorkspaceRunning } from './gmuLiftingWorkspaces.js';

export const LOGBOOK_SOURCE = 'Hi-TESS LogBook';
export const LOGBOOK_WINDOW_KEY = 'hitess-logbook';

/** 'logbook:model-picked' 의 target — Electron logbook-bridge.js · LB workbenchBridge.js 와 같은 값. */
export const LOGBOOK_TARGET_GMU = 'gmu';
export const LOGBOOK_TARGET_TRUSS = 'truss';
/** /api/logbook/import 의 target(WB App 이름). */
export const LOGBOOK_IMPORT_TARGET = { gmu: 'GroupModuleUnit', truss: 'TrussAssessment' };

/** 이 메시지가 그 페이지(target) 몫인가. 두 페이지가 모두 듣고 있으므로 남의 대상은 회신 없이 무시한다. */
export function isLogbookPickFor(msg, target) {
  return !!msg?.requestId && msg?.target === target;
}

export const TRUSS_LOGBOOK_BUSY_MESSAGE = 'Truss 해석이 진행 중입니다. 끝난 뒤 다시 보내 주세요.';
export const TRUSS_LOGBOOK_IN_FLIGHT_MESSAGE = '앞서 보낸 모델을 가져오는 중입니다. 잠시 뒤 다시 보내 주세요.';
export const TRUSS_LOGBOOK_STARTED_MESSAGE = 'Truss Structural Assessment로 가져와 해석을 시작했습니다.';

/**
 * Truss 화면(단일 화면 — 작업 탭 없음)이 LogBook 모델을 받을 수 있는가.
 * @param {{ isRunning?: boolean, inFlight?: boolean }} state
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function decideTrussLogbookPick({ isRunning = false, inFlight = false } = {}) {
  if (isRunning) return { ok: false, message: TRUSS_LOGBOOK_BUSY_MESSAGE };
  if (inFlight) return { ok: false, message: TRUSS_LOGBOOK_IN_FLIGHT_MESSAGE };
  return { ok: true };
}

/**
 * 이 탭이 LogBook 모델을 받을 수 있는가.
 *   - 빈 탭: 받는다.
 *   - 이전에 LogBook 에서 받은 모델이 있고 검증이 끝났으며 Studio 로 넘어가지 않았다: 바꿔 받는다
 *     (모델을 잘못 골랐을 때 LogBook 에서 다시 보내는 경우).
 *   - 그 밖(검증 중 · 다른 입력 · Studio 진행·결과 있음): 받지 않는다.
 */
export function canAcceptLogbookPick(state) {
  if (isGmuWorkspaceIdle(state)) return true;
  if (isGmuWorkspaceRunning(state)) return false;
  return state?.handoffSource === LOGBOOK_SOURCE && !state?.studioOpened && !state?.analysisResult;
}

/**
 * 'logbook:model-picked' 를 어느 탭이 받는지 정한다.
 * @param {{ workspaces: {id:string, slotNo:number}[], states: Record<string, any> }} store
 * @param {number} slot  LogBook 창을 연 작업 번호
 * @param {Set<number>|number[]} [inFlightSlots]  지금 가져오는 중인 작업 번호
 * @returns {{ ok: true, workspaceId: string } | { ok: false, message: string }}
 */
export function decideLogbookPick(store, slot, inFlightSlots = []) {
  const n = Number(slot);
  if (!Number.isInteger(n) || n < 1) return { ok: false, message: '작업 번호가 올바르지 않습니다.' };
  const ws = (store?.workspaces ?? []).find(w => w.slotNo === n);
  if (!ws) return { ok: false, message: `작업 ${n} 탭이 닫혀 있습니다.` };
  const busySlots = inFlightSlots instanceof Set ? inFlightSlots : new Set(inFlightSlots);
  if (busySlots.has(n)) {
    return { ok: false, message: `작업 ${n}은 진행 중입니다. 앞서 보낸 모델을 가져오는 중이니 잠시 뒤 다시 보내 주세요.` };
  }
  const state = store?.states?.[ws.id];
  if (isGmuWorkspaceRunning(state)) {
    return { ok: false, message: `작업 ${n}은 진행 중입니다. BDF 검증이 끝난 뒤 다시 보내 주세요.` };
  }
  if (!canAcceptLogbookPick(state)) {
    return { ok: false, message: `작업 ${n}은 진행 중입니다. 빈 작업 탭에서 LogBook 을 다시 열어 보내 주세요.` };
  }
  return { ok: true, workspaceId: ws.id };
}

const ERROR_MESSAGES = {
  logbook_has_includes: 'INCLUDE 파일이 있는 모델은 아직 가져올 수 없습니다.',
  logbook_file_not_found: 'LogBook 에서 파일을 찾을 수 없거나 볼 권한이 없습니다.',
  logbook_not_bdf: 'BDF 모델 파일만 가져올 수 있습니다.',
  logbook_unreachable: 'LogBook 서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
  logbook_integration_disabled: 'LogBook 연동이 설정되지 않았습니다.',
  logbook_launch_rate_limited: '짧은 시간에 너무 많이 열었습니다. 1분 뒤 다시 시도해 주세요.',
  logbook_invalid_target: '지원하지 않는 대상입니다.',
  logbook_invalid_file_id: '파일 번호가 올바르지 않습니다.',
  logbook_target_not_allowed: '이 앱에 보낼 수 있도록 분류되지 않은 모델입니다.',
};

/** axios 오류(또는 일반 Error)를 사용자에게 보일 한국어 문구로 바꾼다. */
export function logbookErrorMessage(error) {
  const status = error?.response?.status;
  const detail = error?.response?.data?.detail;
  if (detail === 'logbook_target_not_allowed') {
    // LogBook 이 준 사유(어떤 분류인지 등)가 있으면 뒤에 붙인다.
    const reason = error?.response?.data?.message;
    const base = ERROR_MESSAGES.logbook_target_not_allowed;
    return typeof reason === 'string' && reason.trim() && reason.trim() !== base ? `${base} (${reason.trim()})` : base;
  }
  if (typeof detail === 'string' && ERROR_MESSAGES[detail]) return ERROR_MESSAGES[detail];
  if (status === 401) return 'WorkBench 로그인이 만료되었습니다. 다시 로그인해 주세요.';
  if (status === 503) return ERROR_MESSAGES.logbook_integration_disabled;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (!error?.response && error?.request) return 'WorkBench 서버에 연결할 수 없습니다.';
  return error?.message || '알 수 없는 오류가 발생했습니다.';
}

/** LogBook 등급 이름(LogBook lib/levels.js 와 같은 값). 서버가 다른 이름을 주면 그것을 쓴다. */
export const LOGBOOK_LEVEL_LABELS = { 1: '게스트', 2: '일반', 3: '관리자' };

/**
 * 사용자 관리 화면의 LogBook 등급 — LogBook access.level_of 와 같은 규칙.
 *   WorkBench 관리자 → LV3(자동), LogBook 에 저장된 등급이 있으면 그 값, 없으면(LogBook 미접속) LV1.
 * @param {{ employee_id?: string, is_admin?: boolean }} user  WorkBench 사용자 행
 * @param {{ labels?: Record<string,string>, levels?: Record<string,{level:number, last_login?:string|null}> } | null} data
 *        /api/logbook/levels 응답(못 읽었으면 null)
 * @returns {{ level: number, label: string, auto: boolean, known: boolean } | null}  data 가 없으면 null
 */
export function logbookLevelOf(user, data) {
  if (!data) return null;
  const labels = { ...LOGBOOK_LEVEL_LABELS, ...(data.labels || {}) };
  const row = data.levels?.[String(user?.employee_id || '').trim().toUpperCase()];
  const known = !!row;
  if (user?.is_admin) return { level: 3, label: labels[3], auto: true, known };
  const level = [1, 2, 3].includes(row?.level) ? row.level : 1;
  return { level, label: labels[level], auto: false, known };
}
