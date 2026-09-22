/**
 * @fileoverview 알림 수신 설정(`muted_kinds` / `desktop_toast`)을 서버 환경설정에서 읽는 얇은 훅.
 *
 * 알림 센터는 `GET /api/notifications` 응답에도 같은 값을 받지만 그 경로는 30초 폴링이라
 * My Settings 에서 방금 바꾼 값이 곧바로 반영되지 않는다. 화면 즉시 반영이 필요한 소비자는
 * 이 훅(=PreferencesContext, 낙관적 갱신)으로 읽는다. 서버 저장·필터링의 진실은 백엔드다.
 */
import { usePreferences } from '../contexts/PreferencesContext';

const DEFAULT = { muted_kinds: [], desktop_toast: true };

export function useNotificationPrefs() {
  const { prefs } = usePreferences();
  const n = prefs?.notifications || {};
  return {
    mutedKinds: Array.isArray(n.muted_kinds) ? n.muted_kinds : DEFAULT.muted_kinds,
    desktopToast: typeof n.desktop_toast === 'boolean' ? n.desktop_toast : DEFAULT.desktop_toast,
  };
}

export default useNotificationPrefs;
