/**
 * 관리자 전용 메뉴 단일 소스(SSOT).
 *
 * Layout(비밀번호 게이트)과 App(renderPage의 isAdmin 가드)이 각각 하드코딩하던
 * 두 벌의 목록을 하나로 통합한다. 라벨 alias('System Management'/'System Settings')와
 * 'App Community'를 모두 포함해, 과거 게이트/가드 모두를 우회하던 구멍을 막는다.
 */
export const ADMIN_MENUS = new Set([
  'User Management',
  'Analysis Management',
  'System Management',
  'System Settings',
  'Usage Reports',
  'App Community',
  'App Settings',
  'API Apps',
]);

export const isAdminMenu = (menu) => ADMIN_MENUS.has(menu);
