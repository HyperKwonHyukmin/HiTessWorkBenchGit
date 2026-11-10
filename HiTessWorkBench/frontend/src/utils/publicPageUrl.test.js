import test from 'node:test';
import assert from 'node:assert/strict';
import { publicPageUrl } from './publicPageUrl.js';

test('앱이 쓰는 https 주소는 브라우저용 http 9091 로 바꾼다', () => {
  assert.equal(publicPageUrl('https://10.14.42.145:9091', '/history'), 'http://10.14.42.145:9091/history');
  assert.equal(publicPageUrl('https://10.14.42.145:9443/', 'history'), 'http://10.14.42.145:9091/history');
});

test('평문 주소·다른 포트는 그대로 둔다', () => {
  assert.equal(publicPageUrl('http://10.133.122.70:9091', '/history'), 'http://10.133.122.70:9091/history');
  assert.equal(publicPageUrl('https://example.hhi.co.kr', '/newsletter'), 'https://example.hhi.co.kr/newsletter');
  assert.equal(publicPageUrl('https://10.14.42.145:8443', '/history'), 'https://10.14.42.145:8443/history');
});

test('빈 주소여도 죽지 않는다', () => {
  assert.equal(publicPageUrl('', '/history'), '/history');
  assert.equal(publicPageUrl(null, ''), '/');
});
