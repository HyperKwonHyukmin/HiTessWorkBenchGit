/**
 * 대시보드 '새 해석 시작'에 끌어다 놓은 파일을 해석 앱 페이지로 넘기는 단기 보관소.
 *
 * ⚠ 한 번 꺼내면 지우는(take) 방식을 쓰지 않는다. 대시보드에서 앱으로 이동하면
 *   fresh-entry 처리(App.jsx 인스턴스 키 증가)로 페이지가 1~2번 다시 마운트되는데,
 *   첫 인스턴스가 파일을 가져가 버리면 최종 인스턴스는 빈 화면이 된다.
 *   그래서 짧은 유효 시간 안에서는 마운트될 때마다 같은 파일을 돌려주고, 시간이 지나면 버린다.
 * File 객체는 직렬화할 수 없어 저장소가 아닌 모듈 메모리에 둔다(창을 새로 고치면 사라짐).
 */
import { useEffect } from 'react';

const HANDOFF_TTL_MS = 4000;
let pending = null; // { menu, files: File[], at }

/** 파일을 넘겨받을 수 있는 앱(메뉴명). 여기 있는 앱만 대시보드가 '파일 전달'로 표시한다. */
export const FILE_HANDOFF_MENUS = new Set([
  'Group & Module Unit 권상 구조 해석',
  'Side Passage Assessment',
  'BDF Scanner',
  'HP-SCR 배관응력 해석',
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

/**
 * 페이지 마운트 시 대시보드가 넘긴 파일이 있으면 apply(file) 로 기존 업로드 처리에 태운다.
 * accept 로 확장자를 거른다(예: ['.bdf']) — 페이지가 받지 않는 형식이면 무시한다.
 */
export function useDashboardFileHandoff(menu, apply, accept = null) {
  useEffect(() => {
    const files = peekDashboardFiles(menu);
    const file = files?.find(f => !accept || accept.some(ext => f.name.toLowerCase().endsWith(ext)));
    if (file) apply(file);
    // 마운트 1회만 본다 — apply 는 매 렌더 새 함수라 의존성에 넣으면 반복 적용된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
