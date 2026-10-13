/**
 * App Settings 에서 등록한 외부 앱(백엔드 external_app_registrations) → 카탈로그 항목.
 *
 * 코드 카탈로그(ANALYSIS_DATA)와 같은 모양으로 만들어 카드·검색·최근 앱·차단 게이트가
 * 그대로 다루게 한다. 같은 등록 객체에는 같은 항목을 돌려줘(WeakMap) 메모·비교가 흔들리지 않게 한다.
 */

const cache = new WeakMap();

export function registeredAppToCatalogueItem(registration, icon) {
  if (!registration?.slug || !registration?.title) return null;
  const cached = cache.get(registration);
  if (cached) return cached;
  const item = Object.freeze({
    mode: registration.mode || 'Interactive',
    category: registration.category || '',
    title: registration.title,
    description: registration.description || '',
    icon,
    color: 'bg-violet-600',
    tags: Array.isArray(registration.tags) ? registration.tags : [],
    devStatus: registration.dev_status || 'Active',
    contributor: registration.contributor || '',
    ...(registration.art ? { art: registration.art } : {}),
    menuName: registration.title,
    programNames: [registration.title],
    inputFormats: ['Direct input'],
    outputFormats: ['Web App'],
    workflow: 'External',
    // 공용 외부 앱 실행 페이지로 들어간다(App.jsx renderPage).
    hasPage: true,
    isRegisteredExternal: true,
    slug: registration.slug,
    proxyPath: registration.proxy_path || `/external-apps/${registration.slug}`,
  });
  cache.set(registration, item);
  return item;
}

/** 코드 앱 목록 뒤에 등록 앱을 붙인다. 코드 앱과 이름이 겹치는 등록 앱은 무시한다. */
export function mergeRegisteredApps(codeApps, registrations, icon) {
  const titles = new Set(codeApps.map(app => app.title));
  const extra = [];
  for (const registration of registrations || []) {
    const item = registeredAppToCatalogueItem(registration, icon);
    if (!item || titles.has(item.title)) continue;
    titles.add(item.title);
    extra.push(item);
  }
  return extra.length ? [...codeApps, ...extra] : codeApps;
}
