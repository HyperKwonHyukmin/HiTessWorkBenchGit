/**
 * 대시보드 '새 해석 시작'에 끌어다 놓은 파일을 해석 앱 페이지로 넘기는 단기 보관소.
 *
 * ⚠ 한 번 꺼내면 지우는(take) 방식을 쓰지 않는다. 대시보드에서 앱으로 이동하면
 *   fresh-entry 처리(DashboardContext 가 페이지 상태를 지우고 App.jsx 가 인스턴스 키를 올림)로
 *   페이지가 1~2번 다시 마운트되는데, 첫 인스턴스가 파일을 가져가 버리면 최종 인스턴스는 빈 화면이 된다.
 *   그래서 유효 시간 안에서는 마운트될 때마다 같은 파일을 돌려주고, 시간이 지나면 버린다.
 * ⚠ 적용은 APPLY_DELAY_MS 만큼 미루고 언마운트되면 취소한다. 진입 직후의 리셋·재마운트는
 *   같은 커밋 안에서 끝나므로, 미뤄 두면 살아남은 인스턴스 하나에만 한 번 적용된다
 *   (바로 적용하면 리셋에 지워지거나, 자동 배정 토스트가 2~3번 뜬다).
 * File 객체는 직렬화할 수 없어 저장소가 아닌 모듈 메모리에 둔다(창을 새로 고치면 사라짐).
 */
import { useEffect } from 'react';

// 첫 진입 때 lazy 청크 로드 + 두 번째 마운트까지 넉넉히. 짧게 줄이면 느린 PC 에서 파일이 빠진다.
const HANDOFF_TTL_MS = 8000;
const APPLY_DELAY_MS = 60;
let pending = null; // { menu, files: File[], at }

/**
 * 파일을 넘겨받는 앱(메뉴명 = getAppMenuName). 새 앱을 추가하면 그 페이지에
 * useDashboardFileHandoff / useDashboardFilesHandoff 를 붙이고 여기에도 등록한다.
 * 등록되지 않은 앱은 대시보드 추천 목록에 '다시 선택' 으로 표시된다.
 */
export const FILE_HANDOFF_MENUS = new Set([
  'Group & Module Unit 권상 구조 해석',
  'Side Passage Assessment',
  'Module Unit 해상 운송 구조 해석',
  'BDF Scanner',
  'HP-SCR 배관응력 해석',
  'Truss Structural Assessment',
  'Truss Analysis',
  'Mooring Fitting Assessment',
  'HiTESS Model Builder',
  'DrawingToAnalysis',
  'F06 Parser',
  '선급 Rule 기반 선체 가속도 Calculation',
  '이중관 구조 연료배관 해석',
]);

export function offerDashboardFiles(menu, files) {
  pending = { menu, files: Array.from(files || []), at: Date.now() };
}

export function peekDashboardFiles(menu) {
  if (!pending || pending.menu !== menu) return null;
  if (Date.now() - pending.at > HANDOFF_TTL_MS) {
    pending = null;
    return null;
  }
  return pending.files;
}

const matchesAccept = (file, accept) =>
  !accept || accept.some(ext => file.name.toLowerCase().endsWith(ext));

/**
 * 파일 한 개를 받는 페이지용. 마운트 시 넘겨받은 파일 중 accept 에 맞는 첫 파일로 apply(file) 를 부른다.
 * accept 예: ['.bdf', '.dat'] — 페이지가 받지 않는 형식이면 아무것도 하지 않는다.
 */
export function useDashboardFileHandoff(menu, apply, accept = null) {
  useEffect(() => {
    const file = peekDashboardFiles(menu)?.find(f => matchesAccept(f, accept));
    if (!file) return undefined;
    const timer = setTimeout(() => apply(file), APPLY_DELAY_MS);
    return () => clearTimeout(timer);
    // 마운트 1회만 본다 — apply 는 매 렌더 새 함수라 의존성에 넣으면 반복 적용된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** 파일 여러 개(CSV 2종 등)를 받는 페이지용. accept 에 맞는 파일 전부로 applyAll(files) 를 부른다. */
export function useDashboardFilesHandoff(menu, applyAll, accept = null) {
  useEffect(() => {
    const files = (peekDashboardFiles(menu) || []).filter(f => matchesAccept(f, accept));
    if (files.length === 0) return undefined;
    const timer = setTimeout(() => applyAll(files), APPLY_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
