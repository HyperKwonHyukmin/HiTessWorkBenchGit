import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExternalEndpointPayload,
  parseServerAddress,
  validateExternalEndpoint,
} from './externalEndpoint.js';

test('validateExternalEndpoint 는 IP·Port 형식을 백엔드와 같은 규칙으로 본다', () => {
  assert.equal(validateExternalEndpoint('10.14.42.145', '31860'), null);
  assert.equal(validateExternalEndpoint(' 10.14.42.114 ', 80), null);
  assert.match(validateExternalEndpoint('', '1'), /IP/);
  assert.match(validateExternalEndpoint('http://10.14.42.145', '1'), /IP 형식/);
  assert.match(validateExternalEndpoint('10.14.42.145:31860', '1'), /IP 형식/);
  assert.match(validateExternalEndpoint('10.14.42.145', 'abc'), /숫자/);
  assert.match(validateExternalEndpoint('10.14.42.145', '0'), /1~65535/);
  assert.match(validateExternalEndpoint('10.14.42.145', '70000'), /1~65535/);
});

test('buildExternalEndpointPayload 는 기본값과 같은 항목을 null 로 보낸다', () => {
  const endpoint = { default_host: '10.14.42.145', default_port: 31860 };
  assert.deepEqual(buildExternalEndpointPayload(endpoint, '10.14.42.145', '31860'), {
    external_host: null,
    external_port: null,
  });
  assert.deepEqual(buildExternalEndpointPayload(endpoint, ' 10.14.42.114 ', '31861'), {
    external_host: '10.14.42.114',
    external_port: 31861,
  });
});

test('parseServerAddress 는 WorkBench 서버 URL 에서 IP·Port 를 뽑는다', () => {
  assert.deepEqual(parseServerAddress('http://10.14.42.145:9091'), { host: '10.14.42.145', port: 9091 });
  assert.deepEqual(parseServerAddress('http://example.local'), { host: 'example.local', port: 80 });
  assert.equal(parseServerAddress('not a url'), null);
});
