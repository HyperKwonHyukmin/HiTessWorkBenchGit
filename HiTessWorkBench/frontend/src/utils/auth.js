/**
 * 인증 관련 유틸리티
 * - 로그인한 사용자 정보와 세션 토큰을 localStorage에서 읽어옵니다.
 */

export const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

export const getEmployeeId = () => getCurrentUser()?.employee_id ?? null;

export const isAdmin = () => getCurrentUser()?.is_admin === true;

export const getSessionToken = () => localStorage.getItem('session_token') ?? '';

export const getAuthHeaders = () => ({
  Authorization: `Bearer ${getSessionToken()}`,
});

/** fetch 응답 status가 401이면 session-expired 이벤트를 발행하여 자동 로그아웃을 트리거한다 */
export const handleUnauthorized = (status) => {
  if (status === 401) {
    window.dispatchEvent(new CustomEvent('session-expired'));
  }
};
