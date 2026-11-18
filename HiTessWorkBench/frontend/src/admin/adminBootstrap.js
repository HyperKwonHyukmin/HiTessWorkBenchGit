// 관리자 웹 콘솔의 첫 import — 다른 API 모듈이 API_BASE_URL 을 읽기 전에 실행된다.
// 계획 docs/plans/2026-11-18-admin-web-console-plan.md
import { setApiBaseUrl } from '../config';

// ① 로그인 키를 이 탭에만 둔다(커밋 전 리뷰 2026-11-18 '막아야 함').
//    콘솔은 https://145:9091 출처에서 도는데, 같은 출처에 다른 개발자의 외부 App 이 /external-apps/* 로 서빙된다.
//    localStorage 에 관리자 토큰을 두면 같은 크롬에서 연 외부 App 의 스크립트가 읽을 수 있다.
//    exe 와 같은 화면 코드가 localStorage 를 직접 읽는 곳이 많아(12개 파일), 콘솔에서만 그 네 키를 sessionStorage 로 돌린다.
//    exe(file:// 출처) 에는 이 파일이 실리지 않는다. 탭을 닫으면 로그아웃되지만 Windows 자동 로그인으로 다시 들어온다.
const SESSION_ONLY_KEYS = new Set(['session_token', 'user', 'user_login_at', 'user_last_active']);
try {
  const local = window.localStorage;
  const session = window.sessionStorage;
  const proto = Object.getPrototypeOf(local);
  const { getItem, setItem, removeItem } = proto;
  const redirect = (store, key) => (store === local && SESSION_ONLY_KEYS.has(key) ? session : store);
  proto.getItem = function (key) { return getItem.call(redirect(this, key), key); };
  proto.setItem = function (key, value) { return setItem.call(redirect(this, key), key, value); };
  proto.removeItem = function (key) { return removeItem.call(redirect(this, key), key); };
  // 예전 판이 localStorage 에 남긴 토큰은 지운다.
  for (const key of SESSION_ONLY_KEYS) removeItem.call(local, key);
} catch { /* 저장소를 못 쓰는 환경 — 로그인이 매번 필요할 뿐 */ }

// ② 서버 주소 = 이 페이지를 준 서버(같은 출처라 CORS 가 필요 없다). 개발 실행(vite)만 저장값·config 기본값.
const { protocol, origin } = window.location;
const isDevServer = import.meta.env.DEV;

// 평문 http 로 열었으면 같은 포트의 https 로 다시 연다 — 9091 은 평문과 HTTPS 를 함께 받는다(port_mux).
// 평문 페이지에서 https API 를 부르면 출처가 달라져 CORS 에 막히고, 비밀번호도 평문으로 오간다.
if (!isDevServer && protocol === 'http:') {
  window.location.replace(window.location.href.replace(/^http:/, 'https:'));
} else if (!isDevServer && protocol === 'https:') {
  try { setApiBaseUrl(origin); } catch { /* localStorage 를 못 쓰면 config 기본값 */ }
}
