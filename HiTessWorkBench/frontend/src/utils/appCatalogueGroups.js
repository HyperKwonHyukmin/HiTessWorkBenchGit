/**
 * App 카탈로그(File-Based Apps) 그룹 구성 — 순수 함수.
 *
 * 목록을 세 층으로 정리한다:
 *  1. 즐겨찾기 — 자주 쓰는 앱의 바로가기. 카테고리에도 그대로 남겨 그룹에 구멍을 내지 않는다.
 *  2. 카테고리 — '무엇을 해석하는가' 한 축(구조 모델 / 배관 / 권상·의장).
 *  3. series 묶음 — 카테고리보다 한 단계 작은 단위. 예) Truss Model Builder + Truss
 *     Structural Assessment 는 모델 생성 → 평가로 이어지는 한 쌍이라 붙여 놓는다.
 *
 * ⚠ 개발 중(devStatus !== 'Active') 앱은 호출측에서 걸러 낸 뒤 넘긴다. 개발 중은 별도 섹션에
 *   따로 모으는 것이 카탈로그 정책이며, 서비스로 전환되면 자연히 이 그룹 체계에 편입된다.
 */

/**
 * @param {Array} apps       카탈로그 정의 순서를 유지한 앱 목록(Active 만).
 * @param {object} options
 * @param {string[]} options.favorites      즐겨찾기한 앱 title 목록.
 * @param {string[]} options.categoryOrder  카테고리 노출 순서. 여기 없는 카테고리는 뒤에 붙는다.
 * @returns {{favoriteApps: Array, categories: Array<{name: string,
 *           seriesClusters: Array<{series: string, apps: Array}>, singles: Array}>}}
 */
export function buildCatalogueGroups(apps, { favorites = [], categoryOrder = [] } = {}) {
  const list = Array.isArray(apps) ? apps : [];
  if (list.length === 0) return { favoriteApps: [], categories: [] };

  const favoriteApps = list.filter((app) => favorites.includes(app.title));

  // 카테고리별로 정의 순서를 유지한 채 모은다.
  const byCategory = new Map();
  for (const app of list) {
    const name = app.category;
    if (!byCategory.has(name)) byCategory.set(name, []);
    byCategory.get(name).push(app);
  }

  const ordered = [
    ...categoryOrder.filter((name) => byCategory.has(name)),
    ...[...byCategory.keys()].filter((name) => !categoryOrder.includes(name)),
  ];

  const categories = ordered.map((name) => {
    const seriesClusters = [];
    const seriesIndex = new Map();
    const singles = [];

    for (const app of byCategory.get(name)) {
      if (!app.series) {
        singles.push(app);
        continue;
      }
      // 같은 series 가 목록에서 떨어져 있어도 첫 등장 자리에 모은다.
      if (seriesIndex.has(app.series)) {
        seriesClusters[seriesIndex.get(app.series)].apps.push(app);
      } else {
        seriesIndex.set(app.series, seriesClusters.length);
        seriesClusters.push({ series: app.series, apps: [app] });
      }
    }

    return { name, seriesClusters, singles };
  });

  return { favoriteApps, categories };
}
