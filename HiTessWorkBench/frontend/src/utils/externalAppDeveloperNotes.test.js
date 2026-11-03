import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDeveloperNotes, developerNotesText } from './externalAppDeveloperNotes.js';

test('입력한 IP·Port·주소 이름이 안내에 들어간다', () => {
  const text = developerNotesText({ title: 'Block Lug', host: ' 10.14.42.200 ', port: '31890', slug: 'block-lug' });
  assert.match(text, /^\[Hi-TESS WorkBench 외부 App 연결 안내\] Block Lug/);
  assert.match(text, /http:\/\/10\.14\.42\.200:31890\/<사번>/);
  assert.match(text, /WorkBench 입구: \/external-apps\/block-lug/);
  assert.match(text, /30초/);
  assert.match(text, /25MB/);
});

test('아직 입력 전이면 자리표시로 보여 준다', () => {
  const sections = buildDeveloperNotes({});
  assert.ok(sections.length >= 5);
  assert.match(sections[0].items[0], /http:\/\/<IP>:<Port>\/<사번>/);
  assert.match(developerNotesText({}), /http:\/\/<WorkBench 서버>\/api\/external-apps\/jwks/);
});

test('사번은 서명 토큰으로 확인하라고 알리고 aud·공개키 주소를 채운다', () => {
  const text = developerNotesText({ slug: 'sala', host: '10.14.42.145', port: 31810, server: 'http://10.14.42.145:9091/' });
  assert.match(text, /X-HiTESS-Assertion/);
  assert.match(text, /RS256/);
  assert.match(text, /aud = sala/);
  assert.match(text, /공개키 http:\/\/10\.14\.42\.145:9091\/api\/external-apps\/jwks/);
  assert.doesNotMatch(text, /주소의 첫 칸에서 읽으세요/);
});
