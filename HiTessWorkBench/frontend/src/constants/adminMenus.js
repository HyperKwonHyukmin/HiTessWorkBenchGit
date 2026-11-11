/**
 * 관리자 전용 메뉴 단일 소스(SSOT).
 *
 * Layout(비밀번호 게이트)과 App(renderPage의 isAdmin 가드)이 각각 하드코딩하던
 * 두 벌의 목록을 하나로 통합한다.
 *
 * 2026-11-11 메뉴 정리: 거의 안 쓰던 App Community·API Apps 는 App Settings 의 탭으로,
 * Update History·Development History 는 History 메뉴의 탭으로 옮겼다(145 화면 체류 기록 근거).
 * 탭도 메뉴 이름을 그대로 쓴다 — 저장된 시작 화면·화면별 체류 기록(access_sessions.page_seconds)·
 * 뒤로 가기가 탭 단위로 계속 동작하게 하려는 것이다. 그래서 탭 이름도 이 목록에 남는다.
 */
export const ADMIN_MENUS = new Set([
  'User Management',
  'Analysis Management',
  'All Projects',
  'System Management',
  'Usage Reports',
  'App Settings',
  'App Community',
  'API Apps',
  'History',
  'Update History',
  'Development History',
]);

export const isAdminMenu = (menu) => ADMIN_MENUS.has(menu);

/**
 * 사이드바 한 칸 아래 탭으로 묶인 관리자 화면. 첫 탭이 그 메뉴를 눌렀을 때 열리는 화면이다.
 * 탭 menu 는 NavigationContext 의 메뉴 이름(이동·기록 단위)이고, 사이드바에는 그룹 이름만 나온다.
 */
export const ADMIN_TAB_GROUPS = {
  'App Settings': [
    { menu: 'App Settings', label: 'App Settings' },
    { menu: 'App Community', label: 'App Community' },
    { menu: 'API Apps', label: 'API Apps' },
  ],
  History: [
    { menu: 'Update History', label: 'Update History' },
    { menu: 'Development History', label: 'Development History' },
  ],
};

/** 탭 메뉴 → 사이드바 그룹 이름. 그룹에 없는 메뉴는 그대로 돌려준다. */
export function adminTabGroupOf(menu) {
  for (const [group, tabs] of Object.entries(ADMIN_TAB_GROUPS)) {
    if (group === menu || tabs.some((t) => t.menu === menu)) return group;
  }
  return menu;
}

/** 지금 메뉴가 그룹의 어느 탭인가. 그룹 이름 자체(History 등)면 첫 탭. */
export function activeAdminTab(group, menu) {
  const tabs = ADMIN_TAB_GROUPS[group] || [];
  return (tabs.find((t) => t.menu === menu) || tabs[0])?.menu ?? null;
}
