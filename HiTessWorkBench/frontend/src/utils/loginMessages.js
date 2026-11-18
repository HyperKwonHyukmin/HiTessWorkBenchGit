// 서버 ad_auth.AdResult 값 → 화면 문구. 사번이 맞는지 틀렸는지는 따로 알려 주지 않는다.
// exe 로그인 화면(pages/auth/LoginScreen.jsx)과 관리자 웹 콘솔(admin/AdminLogin.jsx)이 같이 쓴다.
export const AD_LOGIN_MESSAGES = {
  password_required: '회사 PC 로그인 비밀번호를 입력하세요.',
  invalid_credentials: '사번 또는 비밀번호가 맞지 않습니다.',
  account_locked: '회사 계정이 잠겼습니다. IT 지원팀에 잠금 해제를 요청하세요.',
  password_expired: '회사 PC 비밀번호가 만료되었습니다. Windows 에서 비밀번호를 바꾼 뒤 다시 로그인하세요.',
  account_disabled: '사용할 수 없는 회사 계정입니다. IT 지원팀에 문의하세요.',
  too_many_attempts: '로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도하세요.',
  auth_unavailable: '사내 계정 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.',
  // Windows 계정 로그인(/api/login/windows)이 안 될 때 — 비밀번호 칸을 연다
  windows_auth_failed: 'Windows 계정으로 확인하지 못했습니다. 비밀번호를 입력하세요.',
  windows_account_not_employee: '이 PC 의 Windows 계정이 사번 계정이 아닙니다. 비밀번호를 입력하세요.',
  windows_account_mismatch: '입력한 사번이 이 PC 의 Windows 계정과 다릅니다. 비밀번호를 입력하세요.',
};
