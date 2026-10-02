/**
 * HiTESS Model Builder '작업 탭' 규칙 — 공용 규칙(utils/appWorkspaces)에 Model Builder 판정만 얹는다.
 *
 * Model Builder 의 한 작업 = CSV 입력 → 빌드·검증 → 판정 → Studio 확인·보정 → BDF 저장·전달.
 * 저장 위치: DashboardContext.modelBuilderPageState. 작업 화면 상태는 예전 단일 페이지가 저장하던
 * 객체 그대로다(struFile·bdfResult·jobStatus …).
 */
import { MAX_APP_WORKSPACES, createWorkspaceKit, normalizePath } from './appWorkspaces.js';

export { normalizePath };

export const MAX_MODEL_BUILDER_WORKSPACES = MAX_APP_WORKSPACES;

/** 탭이 아직 아무것도 하지 않은 상태인가 — 입력 파일도, 실행 기록도, 다시 연 결과도 없음. */
export function isWorkspaceIdle(state) {
  if (!state) return true;
  return !state.hasRunOnce
    && !state.struFile && !state.pipeFile && !state.equiFile
    && !state.bdfResult && !state.currentJobId && !state.sourceAnalysisId;
}

/** 탭이 서버 작업을 기다리는 중인가(빌드 실행 중). 닫기 확인·상태 점에 쓴다. */
export function isWorkspaceRunning(state) {
  return state?.jobStatus?.status === 'Running' || state?.jobStatus?.status === 'Pending';
}

export const modelBuilderWorkspaceKit = createWorkspaceKit({ isIdle: isWorkspaceIdle });
const kit = modelBuilderWorkspaceKit;

export const normalizeWorkspaceStore = kit.normalize;
export const freshEntryWorkspaces = kit.freshEntry;
export const addWorkspace = kit.add;
export const canAddWorkspace = kit.canAdd;
export const closeWorkspace = kit.close;
export const activateWorkspace = kit.activate;
export const saveWorkspaceState = kit.save;

const stripCsvExt = (name) => String(name || '').replace(/\.csv$/i, '');

/** 탭 제목 — 구조 CSV 파일명(없으면 배관 CSV), 다시 연 결과면 서버 입력명, 그것도 없으면 '새 작업'. */
export function workspaceLabel(state) {
  const fromFile = state?.struFile?.name || state?.pipeFile?.name;
  if (fromFile) return stripCsvExt(fromFile);
  const fromServer = state?.serverInputs?.stru || state?.serverInputs?.pipe;
  if (fromServer) return stripCsvExt(String(fromServer).split(/[\\/]/).pop());
  return '새 작업';
}

/** 작업 이름 — '작업 N · 탭 제목'. Job Center 카드와 Studio 창 제목이 이 이름을 쓴다. */
export function workspaceTitle(ws, state) {
  return `작업 ${ws.slotNo} · ${workspaceLabel(state)}`;
}

/**
 * 탭의 상태 점(runFrame/WorkspaceTabs 의 WORKSPACE_STATUS_META 키). 판정 등급은 화면 안에서만
 * 계산되므로 여기서는 진행 단계만 본다.
 *   running   — 빌드 실행 중
 *   failed    — 실행 실패·중단
 *   delivered — BDF 받기·후속 전달까지 끝남(3단계 완료)
 *   ready     — 모델이 만들어져 판정·Studio 확인 단계
 *   idle      — 입력 전/입력 중
 */
export function workspaceStatus(state) {
  if (isWorkspaceRunning(state)) return 'running';
  const st = state?.jobStatus?.status;
  if (st === 'Failed' || st === 'Cancelled' || st === 'Interrupted') return 'failed';
  if (state?.bdfResult) {
    return state?.steps?.[2]?.status === 'done' ? 'delivered' : 'ready';
  }
  return 'idle';
}

/** 서버 산출 폴더로 탭을 찾는다(Studio 의 편집 적용 요청이 어느 탭의 것인지). */
export function findWorkspaceByOutputDir(store, outputDir) {
  if (!outputDir) return null;
  const key = normalizePath(outputDir);
  return kit.find(store, (state) => normalizePath(state?.bdfResult?.outputDir) === key);
}
