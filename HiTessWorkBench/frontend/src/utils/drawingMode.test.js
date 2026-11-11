import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDrawingMode, supportEngineAllowedForName } from './drawingMode.js';

test('SU-145 이름만 옛 support 엔진으로 간다', () => {
  assert.equal(resolveDrawingMode('BlockSupport_SU_145.pdf'), 'support');
  assert.equal(resolveDrawingMode('block_support_su-145_rev1.pdf'), 'support');
  assert.equal(resolveDrawingMode('BS_SU145.pdf'), 'support');
});

test("'support' 만 있는 다른 도면은 새 러그 엔진", () => {
  // 옛 엔진은 도면을 안 읽고 SU-145 모델을 내므로(조용히 틀린 모델) 보내지 않는다
  assert.equal(resolveDrawingMode('BlockSupport_SU_A1.pdf'), 'lug');
  assert.equal(resolveDrawingMode('my_support_drawing.pdf'), 'lug');
  assert.equal(resolveDrawingMode('BlockSupport_SU_1450.pdf'), 'lug');
});

test('SU-145 이름이라도 support 낱말이 없으면 러그(예전 규칙과 같음)', () => {
  assert.equal(resolveDrawingMode('SU145_only.pdf'), 'lug');
  assert.equal(resolveDrawingMode('Lug_L_25.pdf'), 'lug');
  assert.equal(resolveDrawingMode(''), 'lug');
});

test('이름 비교는 기호·대소문자를 무시', () => {
  assert.equal(supportEngineAllowedForName('su 145'), true);
  assert.equal(supportEngineAllowedForName('SU-14'), false);
});
