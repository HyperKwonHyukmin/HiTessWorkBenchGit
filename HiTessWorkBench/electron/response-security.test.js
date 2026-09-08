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
