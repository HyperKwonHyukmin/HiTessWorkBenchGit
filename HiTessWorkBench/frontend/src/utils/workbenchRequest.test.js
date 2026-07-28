import test from 'node:test';
import assert from 'node:assert/strict';

import { isWorkbenchAxiosRequest } from './workbenchRequest.js';

const API_BASE_URL = 'http://10.14.42.145:9091';

test('accepts relative and exact-origin WorkBench requests', () => {
  assert.equal(isWorkbenchAxiosRequest({ url: '/api/version' }, API_BASE_URL), true);
  assert.equal(isWorkbenchAxiosRequest({ url: 'api/version' }, API_BASE_URL), true);
  assert.equal(
    isWorkbenchAxiosRequest({ url: `${API_BASE_URL}/api/version` }, API_BASE_URL),
    true,
  );
  assert.equal(
    isWorkbenchAxiosRequest(
      { url: '/api/version', baseURL: `${API_BASE_URL}/gateway` },
      API_BASE_URL,
    ),
    true,
  );
});

test('rejects prefix-confusion and different WorkBench-like origins', () => {
  assert.equal(
    isWorkbenchAxiosRequest({ url: `${API_BASE_URL}.evil.example/api` }, API_BASE_URL),
    false,
  );
  assert.equal(
    isWorkbenchAxiosRequest({ url: 'http://10.14.42.145:9092/api' }, API_BASE_URL),
    false,
  );
  assert.equal(
    isWorkbenchAxiosRequest({ url: 'https://10.14.42.145:9091/api' }, API_BASE_URL),
    false,
  );
});

test('rejects protocol-relative external URLs and external baseURL requests', () => {
  assert.equal(
    isWorkbenchAxiosRequest({ url: '//external.example/api' }, API_BASE_URL),
    false,
  );
  assert.equal(
    isWorkbenchAxiosRequest(
      { url: '/api', baseURL: 'https://external.example/service' },
      API_BASE_URL,
    ),
    false,
  );
});

test('uses the latest runtime WorkBench server origin', () => {
  const runtimeUrl = 'https://workbench.internal:9443/base/';
  assert.equal(
    isWorkbenchAxiosRequest(
      { url: 'https://workbench.internal:9443/api/session/context' },
      runtimeUrl,
    ),
    true,
  );
  assert.equal(
    isWorkbenchAxiosRequest(
      { url: 'https://workbench.internal/api/session/context' },
      runtimeUrl,
    ),
    false,
  );
});

test('fails closed for malformed or non-http WorkBench server URLs', () => {
  assert.equal(isWorkbenchAxiosRequest({ url: '/api' }, 'not a server URL'), false);
  assert.equal(isWorkbenchAxiosRequest({ url: '/api' }, 'file:///tmp/workbench'), false);
});
