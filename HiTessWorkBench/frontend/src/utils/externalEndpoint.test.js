import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExternalEndpointPayload,
  isPrivateIpv4,
  parseServerAddress,
  suggestSlug,
  validateExternalEndpoint,
  validateRegisteredAppForm,
  validateRegisteredEndpoint,
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

test('isPrivateIpv4 는 사내 사설 대역만 허용한다(백엔드와 같은 규칙)', () => {
  assert.equal(isPrivateIpv4('10.14.42.145'), true);
  assert.equal(isPrivateIpv4('172.16.0.1'), true);
  assert.equal(isPrivateIpv4('172.31.255.1'), true);
  assert.equal(isPrivateIpv4('192.168.0.10'), true);
  assert.equal(isPrivateIpv4('172.32.0.1'), false);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(isPrivateIpv4('127.0.0.1'), false);
  assert.equal(isPrivateIpv4('10.0.0.256'), false);
  assert.equal(isPrivateIpv4('server.local'), false);
});

test('suggestSlug 는 App 이름에서 주소 이름 후보를 만든다', () => {
  assert.equal(suggestSlug('Block Lug Planner'), 'block-lug-planner');
  assert.equal(suggestSlug('  권상 Lug v2  '), 'lug-v2');
  assert.equal(suggestSlug('권상 러그'), '');
});

test('validateRegisteredAppForm 은 생성 때만 이름·주소 이름을 본다', () => {
  const form = { title: 'Block Lug', slug: 'block-lug', category: 'Lifting', host: '10.14.42.200', port: '31890' };
  assert.deepEqual(validateRegisteredAppForm(form, { isCreate: true }), {});
  const errors = validateRegisteredAppForm(
    { ...form, title: 'Block Weld Assessment', slug: 'block-weld', category: '', host: '8.8.8.8' },
    { isCreate: true, existingTitles: new Set(['Block Weld Assessment']) },
  );
  assert.deepEqual(Object.keys(errors).sort(), ['category', 'endpoint', 'slug', 'title']);
  assert.deepEqual(validateRegisteredAppForm({ ...form, title: '', slug: '' }, { isCreate: false }), {});
  assert.match(validateRegisteredEndpoint('10.1.1.1', '70000'), /1~65535/);
});
