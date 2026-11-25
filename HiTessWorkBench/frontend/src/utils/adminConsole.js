// 관리자 웹 콘솔(admin.html) 규칙 — 계획 docs/plans/2026-11-18-admin-web-console-plan.md
import { ADMIN_MENUS, adminTabGroupOf } from '../constants/adminMenus.js';

/** 사이드바 구성. label 은 NavigationContext 메뉴 이름(exe 와 같다). */
export const CONSOLE_SECTIONS = [
  {
    category: '관리',
    items: [
      'User Management', 'Analysis Management', 'All Projects', 'Usage Reports',
      'System Management', 'App Settings', 'History', 'Automation Council',
    ],
  },
  { category: '소통', items: ['Notice & Updates', 'User Requests'] },
];

const SUPPORT_MENUS = new Set(['Notice & Updates', 'User Requests', 'Feature Requests']);

export const DEFAULT_CONSOLE_MENU = 'User Management';
export const LAST_MENU_KEY = 'admin_console_last_menu';
export const WINDOWS_LOGIN_OK_KEY = 'admin_console_windows_ok';
export const LOGGED_OUT_KEY = 'admin_console_logged_out';

/** 콘솔에서 열 수 있는 메뉴인가(관리자 메뉴 + 공지·기능 요청). */
export const isConsoleMenu = (menu) => typeof menu === 'string' && (ADMIN_MENUS.has(menu) || SUPPORT_MENUS.has(menu));

/**
 * 처음 열 화면. 주소 ?menu= 가 먼저(스트림덱 버튼이 쓴다), 그다음 마지막에 보던 화면, 없으면 User Management.
 * 콘솔 메뉴가 아니면 건너뛴다.
 */
export function resolveStartMenu(search, savedMenu) {
  let fromUrl = null;
  try {
    fromUrl = new URLSearchParams(search || '').get('menu');
  } catch { /* 깨진 주소 */ }
  if (isConsoleMenu(fromUrl)) return fromUrl;
  if (isConsoleMenu(savedMenu)) return savedMenu;
  return DEFAULT_CONSOLE_MENU;
}

/** 사이드바에서 지금 강조할 칸 — 탭 메뉴(App Community 등)는 그룹 칸을 강조한다. */
export const activeConsoleItem = (menu) => (menu === 'Feature Requests' ? 'User Requests' : adminTabGroupOf(menu));

/** 브라우저 탭 제목 — 가입 대기가 있으면 앞에 숫자를 붙여 탭만 봐도 알게 한다. */
export function consoleTitle(menu, pending) {
  const head = pending > 0 ? `(${pending > 99 ? '99+' : pending}) ` : '';
  return `${head}Hi-TESS 관리 · ${activeConsoleItem(menu)}`;
}
