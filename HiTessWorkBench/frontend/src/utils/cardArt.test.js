import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_ART_NAMES, CATEGORY_ART, resolveCardArtName } from './cardArt.js';

test('앱의 art 필드가 분류 기본값보다 앞선다', () => {
  assert.equal(resolveCardArtName({ category: '구조 모델', art: 'truss' }), 'truss');
  assert.equal(resolveCardArtName({ category: '구조 모델' }), 'frame');
});

test('모르는 art 는 무시하고 분류 기본값으로, 분류도 모르면 null', () => {
  assert.equal(resolveCardArtName({ category: '배관', art: 'rocket' }), 'pipe');
  assert.equal(resolveCardArtName({ category: '새 분류' }), null);
  assert.equal(resolveCardArtName(), null);
});

test('분류 기본값은 모두 라이브러리에 있는 그림이다', () => {
  for (const [category, name] of Object.entries(CATEGORY_ART)) {
    assert.ok(CARD_ART_NAMES.includes(name), `${category} → ${name}`);
  }
});
