const test = require('node:test');
const assert = require('node:assert/strict');

const { responseHeadersWithWorkbenchCsp } = require('./response-security');

test('adds the WorkBench CSP only to responses owned by the main window', () => {
  const originalHeaders = { Server: ['Kestrel'] };

  const mainHeaders = responseHeadersWithWorkbenchCsp(
    { webContentsId: 10, responseHeaders: originalHeaders },
    10,
  );
  assert.ok(mainHeaders['Content-Security-Policy']);

  const externalHeaders = responseHeadersWithWorkbenchCsp(
    { webContentsId: 20, responseHeaders: originalHeaders },
    10,
  );
  assert.deepEqual(externalHeaders, originalHeaders);
});

test('leaves iframe documents inside the main window with their own headers', () => {
  const originalHeaders = { 'Content-Security-Policy': ["default-src 'self'"] };
  const frameHeaders = responseHeadersWithWorkbenchCsp(
    { webContentsId: 10, resourceType: 'subFrame', responseHeaders: originalHeaders },
    10,
  );
  assert.deepEqual(frameHeaders, originalHeaders);
  const scriptHeaders = responseHeadersWithWorkbenchCsp(
    { webContentsId: 10, resourceType: 'script', responseHeaders: {} },
    10,
  );
  assert.ok(scriptHeaders['Content-Security-Policy']);
});

test('allows data: fonts so the Studio manual modal keeps its fonts', () => {
  const headers = responseHeadersWithWorkbenchCsp({ webContentsId: 10, responseHeaders: {} }, 10);
  assert.match(headers['Content-Security-Policy'][0], /font-src 'self' data:/);
});
