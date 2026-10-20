import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_PER_SESSION, MAX_SAME_MESSAGE, shouldReportClientError } from './clientErrorFilter.js';

test('같은 메시지는 정해진 횟수까지만 보낸다', () => {
  const seen = new Map();
  const results = Array.from({ length: MAX_SAME_MESSAGE + 2 }, () => shouldReportClientError(seen, 'x is undefined'));
  assert.equal(results.filter(Boolean).length, MAX_SAME_MESSAGE);
});

test('세션 전체 상한을 넘기면 더 보내지 않는다', () => {
  const seen = new Map();
  let sent = 0;
  for (let i = 0; i < MAX_PER_SESSION + 10; i += 1) {
    if (shouldReportClientError(seen, `error ${i}`)) sent += 1;
  }
  assert.equal(sent, MAX_PER_SESSION);
});

test('빈 메시지와 무의미한 브라우저 경고는 보내지 않는다', () => {
  const seen = new Map();
  assert.equal(shouldReportClientError(seen, ''), false);
  assert.equal(shouldReportClientError(seen, 'ResizeObserver loop completed with undelivered notifications.'), false);
  assert.equal(shouldReportClientError(seen, 'Script error.'), false);
});
