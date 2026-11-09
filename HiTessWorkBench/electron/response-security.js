const WORKBENCH_CSP =
  "default-src 'self' http: https:; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; " +
  // Studio 사용 설명서 모달(srcdoc)은 글꼴을 data: 로 싣는다 — 없으면 default-src 를 따라 막혀 시스템 글꼴로 보인다
  "font-src 'self' data:; " +
  "connect-src 'self' http: https: ws: wss:;";

function responseHeadersWithWorkbenchCsp(details, mainWebContentsId) {
  const responseHeaders = details?.responseHeaders || {};
  if (details?.webContentsId !== mainWebContentsId) return responseHeaders;
  // 본창 안의 iframe 문서(대시보드 Hi-TESS LogBook 모달 등)는 다른 출처의 앱이다 — 그 앱의 응답 헤더를 그대로 둔다.
  // 본창 CSP 는 본창 문서·자원을 지키는 것이고, 남의 문서에 덮어쓰면 그 앱의 스크립트·워커가 막힐 수 있다.
  if (details?.resourceType === 'subFrame') return responseHeaders;

  return {
    ...responseHeaders,
    'Content-Security-Policy': [WORKBENCH_CSP],
  };
}

module.exports = { responseHeadersWithWorkbenchCsp };
