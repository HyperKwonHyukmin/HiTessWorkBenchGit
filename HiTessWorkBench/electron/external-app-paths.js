// 외부 앱 창의 '프록시 밖으로 새는 요청' 되돌리기 — Electron 비의존 순수 로직(단위 테스트 대상).
//
// 외부 앱은 WorkBench 백엔드 프록시(/external-apps/<앱>/…)로 열리고, 프록시가 넣는 보정 스크립트가
// 주소창을 /<사번> 으로 바꿔 앱이 사번을 읽게 한다. 그런데 이 때문에 아래 요청은 프록시 경로를
// 잃고 WorkBench 서버 루트로 가서 404 가 난다(실측):
//   - 새로고침(Ctrl+R)·뒤로 가기 — 주소창이 /<사번> 이라 그 주소를 다시 부른다
//   - CSS 의 url(/…), JS 로 만든 <img src="/…">·<a href="/…">, location.href = '/…'
// 외부 앱 창에서 같은 서버로 가는 요청 중 /external-apps/ 밖의 것은 그 창의 앱 경로 아래로 돌린다.
"use strict";

const PROXY_PREFIX = "/external-apps/";
// /external-apps/<앱 주소 이름> — 코드 앱(block-weld 등)과 등록 앱(slug) 모두 이 모양이다.
const PROXY_BASE_RE = /^\/external-apps\/([a-z0-9][a-z0-9-]*)(?:\/|$)/;

/**
 * 외부 앱 창을 연 URL 에서 프록시 기준점을 뽑는다. 프록시 창이 아니면 null.
 * @returns {{origin: string, base: string}|null}  base 예: '/external-apps/block-weld'
 */
function externalAppBinding(launchUrl) {
  let parsed;
  try {
    parsed = new URL(launchUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const match = PROXY_BASE_RE.exec(parsed.pathname);
  if (!match) return null;
  return { origin: parsed.origin, base: `/external-apps/${match[1]}` };
}

/**
 * 그 창에서 나간 요청을 앱 경로 아래로 돌려야 하면 새 URL, 아니면 null.
 * 같은 서버(origin)이고 /external-apps/ 밖의 경로일 때만 돌린다 — 다른 서버(CDN 등)나
 * 이미 프록시 경로인 요청은 건드리지 않는다.
 */
function redirectIntoExternalApp(requestUrl, binding) {
  if (!binding) return null;
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== binding.origin) return null;
  if (parsed.pathname === binding.base || parsed.pathname.startsWith(PROXY_PREFIX)) return null;
  return `${binding.origin}${binding.base}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

module.exports = { externalAppBinding, redirectIntoExternalApp };
