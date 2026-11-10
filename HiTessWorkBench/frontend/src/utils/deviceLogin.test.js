import test from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_STATE_TEXT, deviceErrorState, deviceSignMessage, isDeviceMode } from './deviceLogin.js';

test('계열사(로컬 계정) PC 에서만 등록한 PC 로그인을 쓴다', () => {
  const local = { supported: true, localAccount: true };
  assert.equal(isDeviceMode({ authMode: 'ad', serverDeviceLogin: true, deviceInfo: local }), true);
  // 본사 도메인 PC — 지금처럼 Windows 자동 로그인
  assert.equal(isDeviceMode({ authMode: 'ad', serverDeviceLogin: true, deviceInfo: { supported: true, localAccount: false } }), false);
  // 옛 서버·사번만 서버·옛 exe·열쇠 저장 불가
  assert.equal(isDeviceMode({ authMode: 'ad', serverDeviceLogin: false, deviceInfo: local }), false);
  assert.equal(isDeviceMode({ authMode: 'employee_id', serverDeviceLogin: true, deviceInfo: local }), false);
  assert.equal(isDeviceMode({ authMode: 'ad', serverDeviceLogin: true, deviceInfo: null }), false);
  assert.equal(isDeviceMode({ authMode: 'ad', serverDeviceLogin: true, deviceInfo: { supported: false, localAccount: true } }), false);
});

test('서버 응답 → 화면 상태, 해지·거절·만료·서명 불일치는 열쇠를 버린다', () => {
  assert.deepEqual(deviceErrorState(403, 'device_pending'), { state: 'pending', forget: false });
  assert.deepEqual(deviceErrorState(403, 'device_rejected'), { state: 'rejected', forget: true });
  assert.deepEqual(deviceErrorState(403, 'device_revoked'), { state: 'revoked', forget: true });
  assert.deepEqual(deviceErrorState(403, 'device_expired'), { state: 'expired', forget: true });
  assert.deepEqual(deviceErrorState(401, 'device_auth_failed'), { state: 'unregistered', forget: true });
  assert.deepEqual(deviceErrorState(404, 'device_login_disabled'), { state: 'disabled', forget: false });
  // 사용자 자체의 문제(미가입·승인 대기·점검)는 기존 로그인 오류 표시로
  assert.equal(deviceErrorState(404, 'User not found').state, 'error');
  assert.equal(deviceErrorState(403, 'Approval Pending').state, 'error');
  assert.equal(deviceErrorState(503, 'Maintenance Mode').state, 'error');
});

test('서명할 글은 서버(services/device_login.sign_message)와 같은 모양', () => {
  assert.equal(deviceSignMessage(7, 'abc'), 'hitess-device-login:7:abc');
});

test('다시 등록할 수 있는 상태에는 단추 문구가 있다', () => {
  for (const state of ['unregistered', 'rejected', 'revoked', 'expired']) {
    assert.ok(DEVICE_STATE_TEXT[state].action, state);
  }
  assert.equal(DEVICE_STATE_TEXT.pending.action, undefined);
});

test('메일 코드 서명 글·코드 정리', async () => {
  const { deviceActionMessage, cleanEmailCode, EMAIL_CODE_MESSAGES } = await import('./deviceLogin.js');
  assert.equal(deviceActionMessage('verify', 7, 'n'), 'hitess-device-login:verify:7:n');
  assert.equal(cleanEmailCode(' 123-456 '), '123456');
  assert.equal(cleanEmailCode('1234567'), '123456');
  for (const k of ['email_code_mismatch', 'email_code_expired', 'email_code_locked', 'email_resend_too_soon']) {
    assert.ok(EMAIL_CODE_MESSAGES[k], k);
  }
  assert.ok(DEVICE_STATE_TEXT.pendingEmail.title);
});
