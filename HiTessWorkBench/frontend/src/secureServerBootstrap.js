// 앱 시작 때 한 번 — 저장된(또는 기본) 서버 주소가 145 평문이면 HTTPS 로 바꿔 저장한다.
// 사용자가 서버 설정에서 직접 넣은 주소(MANUAL_SERVER_URL_KEY)는 그대로 둔다.
// main.jsx 의 첫 import 여야 한다: API 모듈들이 API_BASE_URL 을 읽기 전에 바뀌어 있어야 한다.
import { API_BASE_URL, setApiBaseUrl } from './config';
import { MANUAL_SERVER_URL_KEY, fixPlainHttpsPort, secureServerUrl } from './utils/secureServerUrl';

let manual = false;
try { manual = localStorage.getItem(MANUAL_SERVER_URL_KEY) === '1'; } catch { /* 없으면 자동 */ }
// 직접 넣은 주소도 http://…:9443 오타만은 고친다(그 주소로는 어디에도 붙지 않는다).
const upgraded = manual ? fixPlainHttpsPort(API_BASE_URL) : secureServerUrl(API_BASE_URL);
if (upgraded !== API_BASE_URL) {
  try {
    setApiBaseUrl(upgraded);
  } catch { /* localStorage 를 못 쓰면 이번 실행은 옛 주소 그대로 */ }
}
