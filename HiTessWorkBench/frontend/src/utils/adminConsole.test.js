import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isConsoleMenu, resolveStartMenu, activeConsoleItem, consoleTitle, CONSOLE_SECTIONS, DEFAULT_CONSOLE_MENU,
} from './adminConsole.js';

test('콘솔 메뉴는 관리자 메뉴와 공지·기능 요청뿐', () => {
  assert.equal(isConsoleMenu('User Management'), true);
  assert.equal(isConsoleMenu('Development History'), true);
  assert.equal(isConsoleMenu('User Requests'), true);
  assert.equal(isConsoleMenu('Dashboard'), false);
  assert.equal(isConsoleMenu('HiTESS Model Builder'), false);
  assert.equal(isConsoleMenu(null), false);
  for (const section of CONSOLE_SECTIONS) for (const m of section.items) assert.equal(isConsoleMenu(m), true, m);
});

test('시작 화면: 주소 > 마지막 화면 > 기본', () => {
  assert.equal(resolveStartMenu('?menu=All%20Projects', 'Usage Reports'), 'All Projects');
  assert.equal(resolveStartMenu('?menu=User+Management', null), 'User Management');
  assert.equal(resolveStartMenu('?menu=Dashboard', 'Usage Reports'), 'Usage Reports');
  assert.equal(resolveStartMenu('', 'Dashboard'), DEFAULT_CONSOLE_MENU);
  assert.equal(resolveStartMenu(undefined, undefined), DEFAULT_CONSOLE_MENU);
});

test('탭 메뉴는 그룹 칸을 강조하고 제목에 대기 수', () => {
  assert.equal(activeConsoleItem('API Apps'), 'App Settings');
  assert.equal(activeConsoleItem('Update History'), 'History');
  assert.equal(activeConsoleItem('Feature Requests'), 'User Requests');
  assert.equal(consoleTitle('User Management', 0), 'Hi-TESS 관리 · User Management');
  assert.equal(consoleTitle('Development History', 3), '(3) Hi-TESS 관리 · History');
  assert.equal(consoleTitle('User Management', 120), '(99+) Hi-TESS 관리 · User Management');
});
