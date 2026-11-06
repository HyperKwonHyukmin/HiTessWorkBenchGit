import test from 'node:test';
import assert from 'node:assert/strict';

import { needsHullPrompt, readHullNoFromBdfText, sanitizeHullInput, suggestHullNo, suggestHullNoFromFilename } from './hullNo.js';

test('파일명 앞 4자리 숫자만 호선으로 제안한다 (백엔드 hull_no.py 와 같은 규칙)', () => {
  assert.equal(suggestHullNoFromFilename('3454-35020-struData-A505080_20251021.csv'), '3454');
  assert.equal(suggestHullNoFromFilename('C:\\work\\3370_M04.bdf'), '3370');
  assert.equal(suggestHullNoFromFilename('8262-MAA-PIPE.csv'), '8262');
  assert.equal(suggestHullNoFromFilename('5PPP_-struData-A507260_20260917.csv'), null);
  assert.equal(suggestHullNoFromFilename('34540-x.csv'), null);
  assert.equal(suggestHullNoFromFilename(null), null);
});

test('구조 → 배관 → 장비 순으로 처음 나온 제안을 쓴다', () => {
  assert.equal(suggestHullNo([null, '5PPP_-pipeData.csv', '3454-equpData.csv']), '3454');
  assert.equal(suggestHullNo([]), null);
});

test('입력값은 허용 문자만 남기고 대문자·20자로 자른다', () => {
  assert.equal(sanitizeHullInput(' 5ppp '), '5PPP');
  assert.equal(sanitizeHullInput('34$5 4\n'), '3454');
  assert.equal(sanitizeHullInput('호선3454'), '3454');
  assert.equal(sanitizeHullInput('x'.repeat(30)).length, 20);
});

test('호선 확인 창 — 값·제안이 없고 같은 입력으로 건너뛴 적이 없을 때만', () => {
  assert.equal(needsHullPrompt({ hullNo: '', hullSuggestion: null, inputKey: 'a.csv', skippedKey: null }), true);
  assert.equal(needsHullPrompt({ hullNo: '3454', hullSuggestion: null, inputKey: 'a.csv' }), false);
  assert.equal(needsHullPrompt({ hullNo: '', hullSuggestion: '3454', inputKey: 'a.csv' }), false);
  assert.equal(needsHullPrompt({ hullNo: '', hullSuggestion: null, inputKey: 'a.csv', skippedKey: 'a.csv' }), false);
  assert.equal(needsHullPrompt({ hullNo: '', hullSuggestion: null, inputKey: 'b.csv', skippedKey: 'a.csv' }), true);
  assert.equal(needsHullPrompt({ hullNo: '  ', hullSuggestion: null, inputKey: 'a.csv' }), true);
});

test('BDF 앞부분에서 Model Builder 호선 주석 읽기', () => {
  assert.equal(readHullNoFromBdfText('$ HiTessModelBuilder: HullNo=3454\nSOL 101\n'), '3454');
  assert.equal(readHullNoFromBdfText('SOL 101\n$ hitessmodelbuilder: hullno = 3542a\n'), '3542A');
  assert.equal(readHullNoFromBdfText('SOL 101\nCEND\n'), null);
  assert.equal(readHullNoFromBdfText('$ HiTessModelBuilder: HullNo=33#00\n'), null);
});
