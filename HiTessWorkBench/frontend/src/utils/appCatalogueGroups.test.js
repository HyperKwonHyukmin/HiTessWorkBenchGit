import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCatalogueGroups } from './appCatalogueGroups.js';

const app = (title, category, extra = {}) => ({ title, category, ...extra });

const TRUSS_MB = app('Truss Model Builder', '구조 모델', { series: 'Truss' });
const TRUSS_SA = app('Truss Structural Assessment', '구조 모델', { series: 'Truss' });
const HITESS = app('HiTESS Model Builder', '구조 모델');
const HPSCR = app('HP-SCR 배관응력 해석', '배관');

const ORDER = ['구조 모델', '배관', '권상·의장'];

test('buildCatalogueGroups 는 같은 series 를 한 묶음으로 모은다', () => {
  const { categories } = buildCatalogueGroups([TRUSS_MB, TRUSS_SA, HITESS], { categoryOrder: ORDER });

  assert.equal(categories.length, 1);
  assert.deepEqual(
    categories[0].seriesClusters.map((c) => [c.series, c.apps.map((a) => a.title)]),
    [['Truss', ['Truss Model Builder', 'Truss Structural Assessment']]],
  );
});

test('buildCatalogueGroups 는 series 없는 앱을 singles 로 둔다', () => {
  const { categories } = buildCatalogueGroups([TRUSS_MB, TRUSS_SA, HITESS], { categoryOrder: ORDER });

  assert.deepEqual(categories[0].singles.map((a) => a.title), ['HiTESS Model Builder']);
});

test('buildCatalogueGroups 는 떨어져 있는 같은 series 도 첫 등장 자리에 모은다', () => {
  const { categories } = buildCatalogueGroups([TRUSS_MB, HITESS, TRUSS_SA], { categoryOrder: ORDER });

  assert.deepEqual(
    categories[0].seriesClusters[0].apps.map((a) => a.title),
    ['Truss Model Builder', 'Truss Structural Assessment'],
  );
});

test('buildCatalogueGroups 는 카테고리를 지정한 순서대로 낸다', () => {
  const { categories } = buildCatalogueGroups([HPSCR, HITESS], { categoryOrder: ORDER });

  assert.deepEqual(categories.map((c) => c.name), ['구조 모델', '배관']);
});

test('buildCatalogueGroups 는 순서 목록에 없는 카테고리를 뒤에 붙인다', () => {
  const unknown = app('신규 해석', '신규 분야');
  const { categories } = buildCatalogueGroups([unknown, HPSCR], { categoryOrder: ORDER });

  assert.deepEqual(categories.map((c) => c.name), ['배관', '신규 분야']);
});

test('buildCatalogueGroups 는 즐겨찾기를 따로 뽑되 카테고리에서 빼지 않는다', () => {
  // 즐겨찾기는 바로가기고 카테고리는 전체 목록이라, 양쪽에 모두 보이는 것이 맞다.
  // 카테고리에서 빼면 그룹에 구멍이 생겨 Truss 짝이 다시 갈라진다.
  const { favoriteApps, categories } = buildCatalogueGroups(
    [TRUSS_MB, TRUSS_SA, HITESS],
    { favorites: ['Truss Structural Assessment'], categoryOrder: ORDER },
  );

  assert.deepEqual(favoriteApps.map((a) => a.title), ['Truss Structural Assessment']);
  assert.deepEqual(
    categories[0].seriesClusters[0].apps.map((a) => a.title),
    ['Truss Model Builder', 'Truss Structural Assessment'],
  );
});

test('buildCatalogueGroups 는 즐겨찾기를 카탈로그 정의 순서로 낸다', () => {
  const { favoriteApps } = buildCatalogueGroups(
    [TRUSS_MB, TRUSS_SA, HITESS],
    { favorites: ['HiTESS Model Builder', 'Truss Model Builder'], categoryOrder: ORDER },
  );

  assert.deepEqual(favoriteApps.map((a) => a.title), ['Truss Model Builder', 'HiTESS Model Builder']);
});

test('buildCatalogueGroups 는 혼자 남은 series 도 묶음으로 유지한다', () => {
  // 검색이나 필터로 짝 하나만 남을 수 있다. 이때 묶음 상자를 없애면 화면이 들썩인다.
  const { categories } = buildCatalogueGroups([TRUSS_SA], { categoryOrder: ORDER });

  assert.equal(categories[0].seriesClusters.length, 1);
  assert.deepEqual(categories[0].singles, []);
});

test('buildCatalogueGroups 는 빈 목록을 안전하게 처리한다', () => {
  assert.deepEqual(buildCatalogueGroups([], { categoryOrder: ORDER }), { favoriteApps: [], categories: [] });
  assert.deepEqual(buildCatalogueGroups(undefined, {}), { favoriteApps: [], categories: [] });
});
