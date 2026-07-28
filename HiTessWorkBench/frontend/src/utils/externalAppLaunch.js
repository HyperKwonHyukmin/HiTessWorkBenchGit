export const EXTERNAL_APP_MODE = Object.freeze({
  PROXY: 'workbench-proxy',
  RAW: 'raw-external',
});

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return HTTP_PROTOCOLS.has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isWorkbenchProxyUrl(baseUrl, workbenchApiBaseUrl) {
  const target = parseHttpUrl(baseUrl);
  const workbench = parseHttpUrl(workbenchApiBaseUrl);
  if (!target || !workbench || target.origin !== workbench.origin) return false;
  return /^\/external-apps\/[^/]+(?:\/|$)/.test(target.pathname);
}

export function resolveExternalAppMode(baseUrl, requestedMode, workbenchApiBaseUrl) {
  const target = parseHttpUrl(baseUrl);
  if (!target) {
    throw new Error('외부 앱 주소는 유효한 HTTP(S) URL이어야 합니다.');
  }

  if (requestedMode === EXTERNAL_APP_MODE.RAW) return requestedMode;

  const isProxy = isWorkbenchProxyUrl(baseUrl, workbenchApiBaseUrl);
  if (requestedMode === EXTERNAL_APP_MODE.PROXY) {
    if (!isProxy) {
      throw new Error('WorkBench 프록시 모드는 동일 서버의 /external-apps 경로만 사용할 수 있습니다.');
    }
    return requestedMode;
  }

  if (requestedMode != null) {
    throw new Error(`지원하지 않는 외부 앱 launchMode입니다: ${requestedMode}`);
  }
  if (isProxy) return EXTERNAL_APP_MODE.PROXY;

  throw new Error('원본 외부 앱은 launchMode="raw-external"을 명시해야 합니다.');
}

export async function pingExternalApp({
  url,
  mode,
  fetchImpl = fetch,
  authHeaders = {},
  onUnauthorized = () => {},
  signal,
}) {
  if (mode === EXTERNAL_APP_MODE.PROXY) {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: authHeaders,
      signal,
    });
    onUnauthorized(response.status);
    return response.ok;
  }

  if (mode !== EXTERNAL_APP_MODE.RAW) {
    throw new Error(`지원하지 않는 외부 앱 launchMode입니다: ${mode}`);
  }

  const rawOptions = {
    cache: 'no-store',
    credentials: 'omit',
    signal,
  };
  try {
    const response = await fetchImpl(url, rawOptions);
    return response.type === 'opaque' || response.ok;
  } catch {
    try {
      // Legacy raw servers commonly omit CORS headers. An opaque response is
      // sufficient for availability and cannot expose response data.
      await fetchImpl(url, {
        ...rawOptions,
        mode: 'no-cors',
      });
      return true;
    } catch {
      return false;
    }
  }
}

function buildRawLaunchUrl(baseUrl, employeeId, cacheBust, now) {
  const url = new URL(
    `${String(baseUrl).replace(/\/+$/, '')}/${encodeURIComponent(employeeId)}`,
  );
  if (cacheBust) url.searchParams.set('__wb_cache_bust', String(now()));
  return url.toString();
}

export async function requestExternalAppLaunch({
  baseUrl,
  mode,
  employeeId,
  cacheBust,
  fetchImpl = fetch,
  authHeaders = {},
  onUnauthorized = () => {},
  now = Date.now,
}) {
  if (mode === EXTERNAL_APP_MODE.RAW) {
    return buildRawLaunchUrl(baseUrl, employeeId, cacheBust, now);
  }
  if (mode !== EXTERNAL_APP_MODE.PROXY) {
    throw new Error(`지원하지 않는 외부 앱 launchMode입니다: ${mode}`);
  }

  const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/__wb_bootstrap`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cache_bust: cacheBust }),
  });
  onUnauthorized(response.status);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || '외부 앱 실행 권한을 발급하지 못했습니다.');
  }
  const data = await response.json();
  if (!data?.launchPath) {
    throw new Error('외부 앱 실행 주소가 올바르지 않습니다.');
  }
  return new URL(data.launchPath, baseUrl).toString();
}
