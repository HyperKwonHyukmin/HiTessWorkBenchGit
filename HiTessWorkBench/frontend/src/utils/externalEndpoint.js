/**
 * App 접속 주소(IP·Port) 규칙 — App Settings 표의 인라인 편집과 설정 모달이 함께 쓴다.
 * 백엔드 검증(services/app_settings.is_valid_external_host/port)과 같은 규칙이다.
 */

// IPv4 또는 호스트 이름(스킴·포트·경로 없이).
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** 입력값을 검사한다. 오류 문구 또는 null. */
export function validateExternalEndpoint(host, port) {
  const h = String(host ?? '').trim();
  const p = String(port ?? '').trim();
  if (!h) return 'IP를 입력하세요.';
  if (!HOST_RE.test(h)) return 'IP 형식이 올바르지 않습니다. 예) 10.14.42.145 (http://·포트 없이)';
  if (!/^\d+$/.test(p)) return 'Port는 숫자여야 합니다.';
  const n = Number(p);
  if (n < 1 || n > 65535) return 'Port는 1~65535 사이여야 합니다.';
  return null;
}

/**
 * 저장 payload. 코드 기본값과 같으면 null(오버라이드 해제)로 보낸다 —
 * 기본 주소가 코드에서 바뀌면 따라가게 하려는 것.
 */
export function buildExternalEndpointPayload(endpoint, host, port) {
  const h = String(host ?? '').trim();
  const p = Number(port);
  return {
    external_host: h === endpoint.default_host ? null : h,
    external_port: p === endpoint.default_port ? null : p,
  };
}

/** WorkBench 서버 주소(URL) → { host, port }. 내부 App 의 접속 주소 표시용. */
export function parseServerAddress(baseUrl) {
  try {
    const url = new URL(baseUrl);
    const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
    return { host: url.hostname, port };
  } catch {
    return null;
  }
}

// ── App Settings 에서 등록하는 외부 앱 ─────────────────────────────────────
// 백엔드 services/external_app_registry.py 와 같은 규칙이다 — 한쪽을 고치면 양쪽 다.

export const REGISTERED_APP_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;

export const RESERVED_REGISTERED_APP_SLUGS = new Set([
  'block-weld', 'independent-tank', 'heavy-block-lifting', 'x', 'api', 'admin', 'static',
]);

/** 사내 사설 대역 IPv4(10/8, 172.16/12, 192.168/16)인지. 이름(host name)은 받지 않는다. */
export function isPrivateIpv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host ?? '').trim());
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some(n => n > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** App 이름에서 주소 이름(slug) 후보를 만든다. 영문·숫자가 없으면 빈 문자열. */
export function suggestSlug(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/** 등록 외부 앱의 IP·Port 검사(사설 대역만). 오류 문구 또는 null. */
export function validateRegisteredEndpoint(host, port) {
  const h = String(host ?? '').trim();
  const p = String(port ?? '').trim();
  if (!h) return 'IP를 입력하세요.';
  if (!isPrivateIpv4(h)) return 'IP는 사내 사설 대역(10.x · 172.16~31.x · 192.168.x)의 IPv4만 쓸 수 있습니다.';
  if (!/^\d+$/.test(p)) return 'Port는 숫자여야 합니다.';
  const n = Number(p);
  if (n < 1 || n > 65535) return 'Port는 1~65535 사이여야 합니다.';
  return null;
}

/**
 * 등록 폼 검사. 칸 이름 → 오류 문구 map(빈 객체면 통과).
 * @param {object} form { title, slug, category, host, port }
 * @param {{ isCreate: boolean, existingTitles: Set<string>, usedSlugs?: Set<string> }} options
 *   usedSlugs = 이미 쓰는 주소 이름(기본 제공 외부 App + 등록 App)
 */
export function validateRegisteredAppForm(form, { isCreate, existingTitles = new Set(), usedSlugs = new Set() }) {
  const errors = {};
  if (isCreate) {
    const title = String(form.title ?? '').trim();
    if (!title) errors.title = 'App 이름을 입력하세요.';
    else if (existingTitles.has(title)) errors.title = '이미 있는 App 이름입니다.';
    const slug = String(form.slug ?? '').trim();
    if (!REGISTERED_APP_SLUG_RE.test(slug)) {
      errors.slug = '영문 소문자·숫자·하이픈 2~40자(하이픈으로 시작·끝 불가)';
    } else if (RESERVED_REGISTERED_APP_SLUGS.has(slug)) {
      errors.slug = '예약된 주소 이름입니다.';
    } else if (usedSlugs.has(slug)) {
      errors.slug = '이미 쓰는 주소 이름입니다.';
    }
  }
  if (!String(form.category ?? '').trim()) errors.category = '분류를 고르거나 입력하세요.';
  const endpointError = validateRegisteredEndpoint(form.host, form.port);
  if (endpointError) errors.endpoint = endpointError;
  return errors;
}
