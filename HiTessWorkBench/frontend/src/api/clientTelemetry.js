/**
 * 사용 기록용 클라이언트 텔레메트리.
 *
 * - getClientInfo(): Electron 이 알려 주는 PC 정보(호스트명·Windows 계정·OS). 하트비트에 실어
 *   접속 이력(access_sessions)에 남긴다. 웹 단독 실행·옛 exe(채널 없음)는 null.
 * - installClientErrorReporting(): 화면 JS 오류·처리 안 된 Promise 거부를 서버에 CLIENT_ERROR 로 보낸다.
 * - flushPendingCrashReports(): 화면이 죽었을 때 Electron main 이 보관해 둔 크래시를 꺼내 보낸다.
 */
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getSessionToken } from '../utils/auth';
import { shouldReportClientError } from '../utils/clientErrorFilter';

let clientInfoPromise = null;

export const getClientInfo = () => {
  if (!clientInfoPromise) {
    const invoke = typeof window !== 'undefined' ? window.electron?.invoke : null;
    clientInfoPromise = invoke
      ? Promise.resolve(invoke('app:client-info')).catch(() => null)
      : Promise.resolve(null);
  }
  return clientInfoPromise;
};

const authHeaders = () => {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const reportClientError = (payload) =>
  axios.post(`${API_BASE_URL}/api/activity/client-error`, payload, { headers: authHeaders() })
    .catch(() => {});

const errorText = (value) => {
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  if (typeof value === 'string') return { message: value, stack: null };
  try {
    return { message: JSON.stringify(value)?.slice(0, 1000) ?? String(value), stack: null };
  } catch {
    return { message: String(value), stack: null };
  }
};

/**
 * 전역 오류 수집을 건다. getContext() 는 { page, appVersion } 를 돌려준다.
 * 반환값은 해제 함수.
 */
export const installClientErrorReporting = (getContext) => {
  const seen = new Map();
  const send = (kind, message, stack, source) => {
    if (!shouldReportClientError(seen, message)) return;
    const { page, appVersion } = getContext?.() || {};
    getClientInfo().then((client) => {
      reportClientError({
        kind,
        message,
        stack,
        source,
        page,
        app_version: appVersion,
        extra: client ? { hostname: client.hostname, os_user: client.os_user } : null,
        occurred_at: new Date().toISOString(),
      });
    });
  };

  const onError = (event) => {
    const { message, stack } = errorText(event.error ?? event.message);
    const source = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null;
    send('window-error', message || event.message, stack, source);
  };
  const onRejection = (event) => {
    const { message, stack } = errorText(event.reason);
    send('unhandled-rejection', message, stack, null);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
};

export const flushPendingCrashReports = async (appVersion) => {
  const invoke = window.electron?.invoke;
  if (!invoke) return;
  let records = [];
  try {
    records = (await invoke('app:take-client-errors')) || [];
  } catch {
    return;
  }
  for (const rec of records) {
    reportClientError({
      kind: rec.kind,
      message: rec.message,
      page: null,
      app_version: appVersion,
      extra: rec.extra || null,
      occurred_at: rec.occurred_at,
    });
  }
};
