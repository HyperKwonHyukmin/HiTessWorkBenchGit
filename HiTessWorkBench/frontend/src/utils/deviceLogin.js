// 등록한 PC 로그인(회사 도메인에 없는 계열사 PC, 2026-11-10) — 화면 규칙. 서버 routers/device_login.py.
// 이 PC 는 비밀번호 칸을 보이지 않는다(사용자 결정: 계열사 직원에게 회사 Windows 비밀번호를 입력하게 하지 않는다).

export const DEVICE_SIGN_PREFIX = 'hitess-device-login';

export const deviceSignMessage = (deviceId, nonce) => `${DEVICE_SIGN_PREFIX}:${deviceId}:${nonce}`;

/** 메일 코드 확인·다시 보내기도 이 PC 열쇠로 서명한다(서버 device_login.verify_message·_resend_message 와 같은 모양). */
export const deviceActionMessage = (action, deviceId, nonce) => `${DEVICE_SIGN_PREFIX}:${action}:${deviceId}:${nonce}`;

/** 메일 코드 확인·다시 보내기 오류 → 화면 문구 */
export const EMAIL_CODE_MESSAGES = {
  email_code_mismatch: '코드가 맞지 않습니다. 메일의 6자리 숫자를 다시 확인하세요.',
  email_code_expired: '코드 유효 시간(10분)이 지났습니다. 코드 다시 보내기를 누르세요.',
  email_code_locked: '여러 번 틀려 이 코드는 더 쓸 수 없습니다. 코드 다시 보내기를 누르세요.',
  email_code_missing: '쓸 수 있는 코드가 없습니다. 코드 다시 보내기를 누르세요.',
  email_resend_too_soon: '1분 뒤에 다시 보낼 수 있습니다.',
  email_resend_limit: '더 보낼 수 없습니다. WorkBench 관리자에게 문의하세요.',
  email_unavailable: '회사 메일로 보낼 수 없습니다. WorkBench 관리자에게 문의하세요.',
};

/** 6자리 숫자만 남긴다(붙여 넣은 공백·하이픈 제거) */
export const cleanEmailCode = (value) => String(value || '').replace(/\D/g, '').slice(0, 6);

/**
 * 이 PC 에서 등록한 PC 로그인을 쓰는가.
 * 서버가 켜 두었고(AD 모드) + 앱이 열쇠를 다룰 수 있고 + 도메인에 가입하지 않은 로컬 계정 PC.
 * 본사(도메인) PC 는 지금처럼 Windows 자동 로그인 → 안 되면 비밀번호.
 */
export function isDeviceMode({ authMode, serverDeviceLogin, deviceInfo }) {
  return authMode === 'ad' && serverDeviceLogin === true
    && !!deviceInfo?.supported && !!deviceInfo?.localAccount;
}

/**
 * 서버 로그인 응답(오류) → 화면 상태.
 * 반환 { state, forget } — forget 이면 이 PC 의 열쇠를 버리고 다음 요청은 새 열쇠로 한다.
 * state: pending | rejected | revoked | expired | unregistered | disabled | error
 */
export function deviceErrorState(status, detail) {
  if (status === 403 && detail === 'device_pending') return { state: 'pending', forget: false };
  if (status === 403 && detail === 'device_rejected') return { state: 'rejected', forget: true };
  if (status === 403 && detail === 'device_revoked') return { state: 'revoked', forget: true };
  if (status === 403 && detail === 'device_expired') return { state: 'expired', forget: true };
  // 서명이 안 맞음 — 서버에서 기기가 지워졌거나 다른 열쇠. 새로 등록한다.
  if (status === 401 && detail === 'device_auth_failed') return { state: 'unregistered', forget: true };
  if (status === 404 && detail === 'device_login_disabled') return { state: 'disabled', forget: false };
  return { state: 'error', forget: false };
}

export const DEVICE_STATE_TEXT = {
  unregistered: {
    title: '이 PC 를 등록해야 합니다.',
    body: '회사 도메인에 가입되지 않은 PC 입니다. 등록 요청을 보내고 관리자 승인을 한 번 받으면, 다음부터 비밀번호 없이 들어옵니다.',
    action: '이 PC 등록 요청',
  },
  pending: {
    title: '관리자 승인을 기다리고 있습니다.',
    body: '회사 메일로 코드를 보낼 수 없어 관리자가 확인합니다. 관리자가 연락하면 아래 확인 코드를 알려 주세요. 승인되면 자동으로 들어갑니다.',
  },
  // 회사 메일로 받은 코드를 직원이 직접 입력(관리자 일 없음)
  pendingEmail: {
    title: '회사 메일로 확인 코드를 보냈습니다.',
    body: '메일의 6자리 코드를 입력하면 등록이 끝나고, 다음부터 비밀번호 없이 들어옵니다.',
  },
  rejected: {
    title: '등록 요청이 거절되었습니다.',
    body: '관리자에게 문의한 뒤 다시 요청하세요.',
    action: '다시 등록 요청',
  },
  revoked: {
    title: '이 PC 등록이 해지되었습니다.',
    body: '계속 쓰려면 다시 등록 요청을 보내 주세요.',
    action: '다시 등록 요청',
  },
  expired: {
    title: '오래 사용하지 않아 PC 등록이 만료되었습니다.',
    body: '다시 등록 요청을 보내 주세요.',
    action: '다시 등록 요청',
  },
};
