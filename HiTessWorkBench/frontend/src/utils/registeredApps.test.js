import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeRegisteredApps, registeredAppToCatalogueItem } from './registeredApps.js';

const ICON = () => null;
const registration = Object.freeze({
  slug: 'block-lug',
  title: 'Block Lug Planner',
  description: '러그 배치',
  mode: 'Interactive',
  category: 'Lifting',
  art: 'weld',
  tags: ['Lug'],
  contributor: '외부 개발자',
  dev_status: 'Developing',
  proxy_path: '/external-apps/block-lug',
});

test('등록 외부 앱을 카탈로그 항목 모양으로 바꾼다', () => {
  const item = registeredAppToCatalogueItem(registration, ICON);
  assert.equal(item.title, 'Block Lug Planner');
  assert.equal(item.menuName, 'Block Lug Planner');
  assert.equal(item.category, 'Lifting');
  assert.equal(item.art, 'weld');
  assert.equal(item.devStatus, 'Developing');
  assert.equal(item.hasPage, true);
  assert.equal(item.isRegisteredExternal, true);
  assert.equal(item.proxyPath, '/external-apps/block-lug');
  // 같은 등록 객체에는 같은 항목(메모 안정성).
  assert.equal(registeredAppToCatalogueItem(registration, ICON), item);
  assert.equal(registeredAppToCatalogueItem({ title: 'x' }, ICON), null);
});

test('코드 앱 뒤에 붙이되 같은 이름의 등록 앱은 무시한다', () => {
  const codeApps = [{ title: 'Block Weld Assessment' }];
  assert.equal(mergeRegisteredApps(codeApps, [], ICON), codeApps);
  const merged = mergeRegisteredApps(
    codeApps,
    [registration, { ...registration, slug: 'dup', title: 'Block Weld Assessment' }],
    ICON,
  );
  assert.deepEqual(merged.map(app => app.title), ['Block Weld Assessment', 'Block Lug Planner']);
});
