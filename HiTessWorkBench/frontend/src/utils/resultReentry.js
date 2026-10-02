/**
 * 지난 해석 결과를 앱 페이지의 '결과 화면'으로 다시 여는 단기 보관소.
 *
 * My Projects·대시보드 '내 작업'에서 [결과 화면에서 열기]를 누르면 해석 ID 를 여기 맡기고 앱으로
 * 이동한다. 앱 페이지는 useResultReentry 로 그 ID 를 받아 `GET /api/analysis/{id}` 의 result_info
 * (서버 산출 폴더 경로)로 결과 상태를 복원한다. 브라우저 메모리의 페이지 상태가 아니라 서버 산출물에
 * 묶여 있으므로, 앱을 떠났다 돌아와도·다른 날에도 같은 결과 화면이 열린다.
 *
 * 보관·적용 방식은 dashboardFileHandoff 와 같다(fresh-entry 재마운트 대응):
 *   - 꺼내도 지우지 않고 TTL 동안 같은 값을 돌려준다.
 *   - 적용은 APPLY_DELAY_MS 미루고 언마운트되면 취소한다 — 살아남은 인스턴스 하나에만 한 번 적용된다.
 *
 * 새 앱이 이 진입을 받으려면 페이지에 useResultReentry 를 붙이고 RESULT_REENTRY_MENUS 에 등록한다.
 */
import { useEffect } from 'react';

const REENTRY_TTL_MS = 8000;
const APPLY_DELAY_MS = 60;
let pending = null; // { menu, analysisId, at }

/** 결과 화면으로 다시 열 수 있는 앱의 메뉴명 → 해석 기록의 program_name. */
export const RESULT_REENTRY_MENUS = {
  'HiTESS Model Builder': 'HiTessModelBuilder',
  'Group & Module Unit 권상 구조 해석': 'GroupModuleUnit',
  'Truss Analysis': 'TrussModelBuilder',              // Truss Model Builder (메뉴명은 옛 이름 그대로)
  'Truss Structural Assessment': 'Truss Assessment',
};

// 앱마다 '복원할 결과가 있다'의 기준이 되는 result_info 키가 다르다(Model Builder = 산출 폴더, 권상 = 검증한 BDF).
const RESULT_KEYS = {
  HiTessModelBuilder: 'output_dir',
  GroupModuleUnit: 'bdf',
  TrussModelBuilder: 'bdf',
  'Truss Assessment': 'bdf',
};

/** program_name 으로 '결과 화면에서 열기'를 지원하는 메뉴를 찾는다. 없으면 null. */
export function reentryMenuForProgram(programName) {
  const hit = Object.entries(RESULT_REENTRY_MENUS).find(([, program]) => program === programName);
  return hit ? hit[0] : null;
}

/** 해석 기록을 앱 결과 화면으로 다시 열 수 있는가 — 성공·파일 보관 중·결과 경로 있음. */
export function canOpenResult(project) {
  if (!project || !reentryMenuForProgram(project.program_name)) return false;
  if (project.status && project.status !== 'Success') return false;
  if (project.files_available === false) return false;
  const key = RESULT_KEYS[project.program_name];
  return !!(key && project.result_info?.[key]);
}

export function offerResultReentry(menu, analysisId) {
  pending = { menu, analysisId, at: Date.now() };
}

export function peekResultReentry(menu) {
  if (!pending || pending.menu !== menu) return null;
  if (Date.now() - pending.at > REENTRY_TTL_MS) {
    pending = null;
    return null;
  }
  return pending.analysisId;
}

/** 페이지 마운트 시 맡겨진 해석 ID 가 있으면 apply(analysisId) 를 한 번 부른다. */
export function useResultReentry(menu, apply) {
  useEffect(() => {
    const analysisId = peekResultReentry(menu);
    if (analysisId == null) return undefined;
    const timer = setTimeout(() => {
      // 적용된 인스턴스가 정해졌으니 보관소를 비운다 — 이후 사용자가 같은 앱을 다시 열 때 옛 결과가 뜨지 않게.
      pending = null;
      apply(analysisId);
    }, APPLY_DELAY_MS);
    return () => clearTimeout(timer);
    // 마운트 1회만 본다 — apply 는 매 렌더 새 함수다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
