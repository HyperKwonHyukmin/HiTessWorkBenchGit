import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTERNAL_APP_MODE,
  pingExternalApp,
  requestExternalAppLaunch,
  resolveExternalAppMode,
} from './externalAppLaunch.js';

const WORKBENCH_URL = 'http://10.14.42.145:9091';
const RAW_URL = 'http://10.14.42.114:31860';

test('raw external mode never sends WorkBench credentials or bootstrap requests', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new TypeError('CORS blocked');
    return { ok: false, type: 'opaque', status: 0 };
  };

  assert.equal(
    await pingExternalApp({
      url: RAW_URL,
      mode: EXTERNAL_APP_MODE.RAW,
      fetchImpl,
      authHeaders: { Authorization: 'Bearer workbench-secret', Cookie: 'wb=secret' },
    }),
    true,
  );

  const launchUrl = await requestExternalAppLaunch({
    baseUrl: RAW_URL,
    mode: EXTERNAL_APP_MODE.RAW,
    employeeId: 'USER001',
    cacheBust: true,
    now: () => 1234,
    fetchImpl,
    authHeaders: { Authorization: 'Bearer workbench-secret', Cookie: 'wb=secret' },
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, RAW_URL);
    assert.equal(call.options.credentials, 'omit');
    assert.equal('headers' in call.options, false);
  }
  assert.equal(calls[1].options.mode, 'no-cors');
  assert.equal(launchUrl, `${RAW_URL}/USER001?__wb_cache_bust=1234`);
  assert.equal(calls.some(({ url }) => url.includes('__wb_bootstrap')), false);
});

test('proxy mode uses authenticated bootstrap and resolves the one-time launch path', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ launchPath: '/external-apps/block-weld/__wb_launch?grant=one-time' }),
    };
  };

  const launchUrl = await requestExternalAppLaunch({
    baseUrl: `${WORKBENCH_URL}/external-apps/block-weld`,
    mode: EXTERNAL_APP_MODE.PROXY,
    employeeId: 'USER001',
    cacheBust: true,
    fetchImpl,
    authHeaders: { Authorization: 'Bearer workbench-secret' },
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `${WORKBENCH_URL}/external-apps/block-weld/__wb_bootstrap`,
  );
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer workbench-secret');
  assert.deepEqual(JSON.parse(calls[0].options.body), { cache_bust: true });
  assert.equal(
    launchUrl,
    `${WORKBENCH_URL}/external-apps/block-weld/__wb_launch?grant=one-time`,
  );
});

test('mode resolution defaults only same-origin WorkBench proxy paths and rejects ambiguity', () => {
  assert.equal(
    resolveExternalAppMode(
      `${WORKBENCH_URL}/external-apps/block-weld`,
      undefined,
      WORKBENCH_URL,
    ),
    EXTERNAL_APP_MODE.PROXY,
  );
  assert.throws(
    () => resolveExternalAppMode(RAW_URL, undefined, WORKBENCH_URL),
    /launchMode/,
  );
  assert.throws(
    () => resolveExternalAppMode(
      'https://evil.example/external-apps/block-weld',
      EXTERNAL_APP_MODE.PROXY,
      WORKBENCH_URL,
    ),
    /WorkBench/,
  );
});
