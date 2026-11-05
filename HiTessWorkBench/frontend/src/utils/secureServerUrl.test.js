import test from 'node:test';
import assert from 'node:assert/strict';
import { secureServerUrl } from './secureServerUrl.js';

test('145 평문 주소는 HTTPS 9443 으로 바꾼다', () => {
  assert.equal(secureServerUrl('http://10.14.42.145:9091'), 'https://10.14.42.145:9443');
  assert.equal(secureServerUrl(' http://10.14.42.145:9091/ '), 'https://10.14.42.145:9443');
  assert.equal(secureServerUrl('HTTP://HHIPW170658.HDShipGroup.HHI.co.kr:9091'), 'https://hhipw170658.hdshipgroup.hhi.co.kr:9443');
});

test('경로가 붙어 있어도 앞부분만 바꾼다', () => {
  assert.equal(secureServerUrl('http://10.14.42.145:9091/api/version'), 'https://10.14.42.145:9443/api/version');
});

test('다른 주소·이미 HTTPS·비슷한 포트는 그대로', () => {
  assert.equal(secureServerUrl('https://10.14.42.145:9443'), 'https://10.14.42.145:9443');
  assert.equal(secureServerUrl('http://10.14.42.145:90910'), 'http://10.14.42.145:90910');
  assert.equal(secureServerUrl('http://10.14.42.145:9095'), 'http://10.14.42.145:9095');
  assert.equal(secureServerUrl('http://localhost:9091'), 'http://localhost:9091');
  assert.equal(secureServerUrl(''), '');
});

test('http://…:9443 오타는 https 로(어느 호스트든), 9443 이 아니면 그대로', async () => {
  const { fixPlainHttpsPort } = await import('./secureServerUrl.js');
  assert.equal(fixPlainHttpsPort('http://10.14.42.145:9443'), 'https://10.14.42.145:9443');
  assert.equal(fixPlainHttpsPort(' http://10.133.122.70:9443/ '), 'https://10.133.122.70:9443');
  assert.equal(fixPlainHttpsPort('HTTP://10.133.122.70:9443/api'), 'https://10.133.122.70:9443/api');
  assert.equal(fixPlainHttpsPort('http://10.133.122.70:94430'), 'http://10.133.122.70:94430');
  assert.equal(fixPlainHttpsPort('http://10.14.42.145:9091'), 'http://10.14.42.145:9091');
  assert.equal(secureServerUrl('http://10.133.122.70:9443'), 'https://10.133.122.70:9443');
});
