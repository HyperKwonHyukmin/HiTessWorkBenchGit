const WORKBENCH_CSP =
  "default-src 'self' http: https:; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; " +
  "connect-src 'self' http: https: ws: wss:;";

function responseHeadersWithWorkbenchCsp(details, mainWebContentsId) {
  const responseHeaders = details?.responseHeaders || {};
  if (details?.webContentsId !== mainWebContentsId) return responseHeaders;

  return {
    ...responseHeaders,
    'Content-Security-Policy': [WORKBENCH_CSP],
  };
}

module.exports = { responseHeadersWithWorkbenchCsp };
