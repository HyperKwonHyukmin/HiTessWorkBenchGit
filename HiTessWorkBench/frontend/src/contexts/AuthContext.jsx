/// <summary>
/// 인증 사용자 상태를 reactive 하게 제공하는 React Context.
///
/// 기존 src/utils/auth.js (getCurrentUser/getEmployeeId/isAdmin/...) 는
/// 함수 호출 시점에만 localStorage 를 읽으므로 컴포넌트가 자동 재렌더링되지 않는다.
/// 본 Context 는 React state 기반이라 logout/login 호출 시 모든 구독 컴포넌트가
/// 자동으로 갱신된다.
///
/// 사용 예:
///   const { user, employeeId, isAdmin, login, logout } = useAuth();
///
/// 페이지가 단순히 employee_id 만 필요한 경우엔 useAnalysisJob 훅이 이미
/// 내부적으로 사번을 노출하므로 직접 useAuth 를 부르지 않아도 된다.
/// </summary>
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

const parseUser = (raw) => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

export function AuthProvider({ children }) {
  // 초기값은 localStorage 에서 1회 읽음 — 페이지 새로고침 후 세션 복원.
  const [user, setUser] = useState(() => parseUser(localStorage.getItem('user')));
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem('session_token') || '');

  /**
   * 로그인 성공 시 호출. localStorage 4개 키 (user, session_token, user_login_at,
   * user_last_active) 를 일괄 세팅하고 state 를 갱신한다. LoginScreen 의 inline
   * setItem 호출을 대체하기 위해 동일한 키 셋과 형식을 유지한다.
   */
  const login = useCallback((userObj, token = '') => {
    const now = Date.now();
    localStorage.setItem('user', JSON.stringify(userObj));
    if (token) localStorage.setItem('session_token', token);
    localStorage.setItem('user_login_at', String(now));
    localStorage.setItem('user_last_active', String(now));
    setUser(userObj);
    setSessionToken(token || '');
  }, []);

  /**
   * 로그아웃 시 호출. App.jsx 의 handleLogout 이 기존에 직접 처리하던
   * removeItem 4개 + sessionStorage admin_gate 정리를 한 곳에 모은다.
   * App.jsx 자체의 setAppState/resetNavigation 같은 라우팅 처리는 호출자가 담당.
   */
  const logout = useCallback(() => {
    localStorage.removeItem('user');
    localStorage.removeItem('user_login_at');
    localStorage.removeItem('user_last_active');
    localStorage.removeItem('session_token');
    sessionStorage.removeItem('admin_gate_unlocked');
    setUser(null);
    setSessionToken('');
  }, []);

  /**
   * 8시간 미활동 타임아웃 추적용 마지막 활동 시간 갱신.
   * App.jsx 의 throttle(60s) 활동 감지 effect 가 호출.
   */
  const updateLastActive = useCallback((now = Date.now()) => {
    localStorage.setItem('user_last_active', String(now));
  }, []);

  // 다른 탭/창에서 로그아웃하거나 토큰이 변경되면 현재 탭도 자동 동기화.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'user') {
        setUser(parseUser(e.newValue));
      } else if (e.key === 'session_token') {
        setSessionToken(e.newValue || '');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = {
    user,
    employeeId: user?.employee_id ?? null,
    isAdmin: user?.is_admin === true,
    sessionToken,
    isAuthenticated: !!user,
    login,
    logout,
    updateLastActive,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * AuthContext 구독 훅. AuthProvider 바깥에서 호출되면 throw — 페이지/컴포넌트가
 * 잘못된 위치에서 사용했을 때 명시적 에러로 빠르게 발견할 수 있도록 한다.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
