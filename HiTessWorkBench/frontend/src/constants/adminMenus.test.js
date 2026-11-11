import test from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN_MENUS, ADMIN_TAB_GROUPS, adminTabGroupOf, activeAdminTab } from './adminMenus.js';

test('탭 메뉴는 사이드바 그룹으로 모인다', () => {
  assert.equal(adminTabGroupOf('App Community'), 'App Settings');
  assert.equal(adminTabGroupOf('API Apps'), 'App Settings');
  assert.equal(adminTabGroupOf('App Settings'), 'App Settings');
  assert.equal(adminTabGroupOf('Update History'), 'History');
  assert.equal(adminTabGroupOf('Development History'), 'History');
  assert.equal(adminTabGroupOf('History'), 'History');
  assert.equal(adminTabGroupOf('User Management'), 'User Management');
});

test('그룹 이름으로 들어오면 첫 탭, 탭 이름이면 그 탭', () => {
  assert.equal(activeAdminTab('History', 'History'), 'Update History');
  assert.equal(activeAdminTab('History', 'Development History'), 'Development History');
  assert.equal(activeAdminTab('App Settings', 'API Apps'), 'API Apps');
});

test('그룹·탭 이름은 모두 관리자 메뉴다 — 빠지면 비관리자 가드를 우회한다', () => {
  for (const [group, tabs] of Object.entries(ADMIN_TAB_GROUPS)) {
    assert.ok(ADMIN_MENUS.has(group), group);
    for (const t of tabs) assert.ok(ADMIN_MENUS.has(t.menu), t.menu);
  }
});
