import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeHullInput, suggestHullNo, suggestHullNoFromFilename } from './hullNo.js';

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
