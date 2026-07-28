const ABSOLUTE_URL_PATTERN = /^([a-z][a-z\d+\-.]*:)?\/\//i;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function parseHttpUrl(value, baseUrl) {
  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Returns true only when an Axios request resolves to the configured WorkBench
 * backend origin. Relative URLs without an explicit baseURL are treated as
 * WorkBench calls to preserve the application's existing request convention.
 */
export function isWorkbenchAxiosRequest(config, apiBaseUrl) {
  const workbenchUrl = parseHttpUrl(String(apiBaseUrl || '').trim());
  if (!workbenchUrl) return false;

  const requestUrl = String(config?.url || '').trim();
  const configuredBaseUrl = String(config?.baseURL || '').trim();
  const allowAbsoluteUrls = config?.allowAbsoluteUrls !== false;
  let targetUrl = null;

  if (ABSOLUTE_URL_PATTERN.test(requestUrl) && allowAbsoluteUrls) {
    targetUrl = parseHttpUrl(requestUrl, workbenchUrl);
  } else if (configuredBaseUrl) {
    const baseUrl = parseHttpUrl(configuredBaseUrl, workbenchUrl);
    if (!baseUrl) return false;

    // Axios prepends baseURL when url is relative (or allowAbsoluteUrls=false).
    // Only the resulting origin matters for deciding whether credentials are safe.
    targetUrl = baseUrl;
  } else {
    targetUrl = parseHttpUrl(requestUrl || '.', workbenchUrl);
  }

  return targetUrl?.origin === workbenchUrl.origin;
}
