/**
 * 데스크톱(OS) 토스트 — 렌더러의 표준 Notification API 를 그대로 쓴다. IPC 채널 추가 없음.
 *
 * Electron 렌더러는 Notification.permission 이 기본 'granted' 다. 브라우저(npm run dev 를
 * 크롬에서 열 때)는 'default' 라 첫 사용자 제스처에서 ensureDesktopNotificationPermission() 을 부른다.
 * Windows 가 토스트에 앱 이름/아이콘을 붙이려면 main 이 app.setAppUserModelId(...) 를 설정해야 한다.
 * 실패는 전부 조용히 무시한다 — 인앱 토스트(ToastContext)가 이미 떠 있다.
 */

export function canShowDesktopNotification(win = globalThis) {
  const N = win?.Notification;
  return typeof N === 'function' && N.permission === 'granted';
}

export async function ensureDesktopNotificationPermission(win = globalThis) {
  const N = win?.Notification;
  if (typeof N !== 'function') return 'unsupported';
  if (N.permission === 'default' && typeof N.requestPermission === 'function') {
    try { return await N.requestPermission(); } catch { return N.permission; }
  }
  return N.permission;
}

/**
 * @param {{title: string, body?: string, tag?: string, onClick?: Function}} opts
 * @returns {Notification|null}
 */
export function showDesktopNotification({ title, body = '', tag, onClick }, win = globalThis) {
  if (!title || !canShowDesktopNotification(win)) return null;
  try {
    const n = new win.Notification(title, { body, tag });
    if (typeof onClick === 'function') {
      n.onclick = () => {
        try { win.focus?.(); } catch { /* 포커스 거부는 무시 */ }
        onClick();
        try { n.close?.(); } catch { /* 이미 닫힘 */ }
      };
    }
    return n;
  } catch {
    return null;
  }
}
