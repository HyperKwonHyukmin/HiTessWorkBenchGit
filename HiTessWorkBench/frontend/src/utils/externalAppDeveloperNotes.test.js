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
});
