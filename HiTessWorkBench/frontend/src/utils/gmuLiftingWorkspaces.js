/**
 * Group & Module Unit 권상 '작업 탭' 규칙 — 공용 규칙(utils/appWorkspaces)에 GMU 판정만 얹는다.
 *
 * GMU 의 한 작업 = BDF 입력 검증 → Studio 권상 검토(자세안정성·구조 해석) → 결과·보고서.
 * 저장 위치: DashboardContext.gmuLiftingPageState. 작업 화면 상태는 예전 단일 페이지가 저장하던
 * 객체 그대로다(bdfFile·bdfPath·bdfAnalysisId·analysisResult …).
 */
import { createWorkspaceKit, normalizePath } from './appWorkspaces.js';

export { normalizePath };

/** 탭이 아직 아무것도 하지 않은 상태인가 — 입력 BDF 도, 연계로 받은 BDF 도, 검증 기록도 없음. */
export function isGmuWorkspaceIdle(state) {
  if (!state) return true;
  return !state.bdfFile && !state.handoffBdfPath && !state.validating && !state.validJobId
    && !state.bdfPath && !state.bdfAnalysisId && !state.step1Data && !state.validFailed;
}

/** BDF 검증이 서버에서 도는 중인가. 닫기 확인·상태 점에 쓴다. */
export function isGmuWorkspaceRunning(state) {
  return !!state?.validating;
}

export const gmuWorkspaceKit = createWorkspaceKit({ isIdle: isGmuWorkspaceIdle });

const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
const stripBdfExt = (name) => String(name || '').replace(/\.(bdf|dat|nas)$/i, '');

/** 탭 제목 — 올린 BDF 파일명, 연계·다시 연 결과면 서버 BDF 파일명, 그것도 없으면 '새 작업'. */
export function gmuWorkspaceLabel(state) {
  const name = state?.bdfFile?.name || baseName(state?.handoffBdfPath) || baseName(state?.bdfPath);
  return name ? stripBdfExt(name) : '새 작업';
}

/** 작업 이름 — '작업 N · 탭 제목'. Job Center 카드와 Studio 창 제목이 이 이름을 쓴다. */
export function gmuWorkspaceTitle(ws, state) {
  return `작업 ${ws.slotNo} · ${gmuWorkspaceLabel(state)}`;
}

/**
 * 탭의 상태 점(runFrame/WorkspaceTabs 의 WORKSPACE_STATUS_META 키).
 *   running   — BDF 검증 중
 *   failed    — 검증 실패, 또는 Studio 구조 해석 실패
 *   delivered — 결과 산출물·보고서를 받음(3단계 완료)
 *   ready     — 검증이 끝나 Studio 권상 검토·결과 확인 단계
 *   idle      — 입력 전/입력 중
 */
export function gmuWorkspaceStatus(state) {
  if (isGmuWorkspaceRunning(state)) return 'running';
  if ((state?.validFailed && !state?.step1Data) || state?.analysisResult?.status === 'ERROR') return 'failed';
  if (state?.delivered) return 'delivered';
  if (state?.step1Data || state?.bdfPath) return 'ready';
  return 'idle';
}

/**
 * Studio 구조 해석 완료 이벤트가 어느 탭의 것인지 — 검증 기록 id(parentAnalysisId)로 찾는다.
 * 그 BDF 로 검증한 탭만 맞는다. 모르는 id 면 null(어느 탭도 받지 않는다).
 */
export function findGmuWorkspaceByAnalysisId(store, analysisId) {
  const id = Number(analysisId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return gmuWorkspaceKit.find(store, (state) => Number(state?.bdfAnalysisId) === id);
}

/** Studio 구조 해석 완료 이벤트를 이 탭이 받아야 하는가 — 이 탭의 검증 기록 id 와 같을 때만. */
export function isOwnStructuralEvent(payload, bdfAnalysisId) {
  if (!payload || !bdfAnalysisId || !payload.parentAnalysisId) return false;
  return Number(payload.parentAnalysisId) === Number(bdfAnalysisId);
}
