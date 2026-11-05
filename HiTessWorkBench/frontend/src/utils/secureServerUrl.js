// 옛 평문 서버 주소 → HTTPS 주소 (통합 계획 3단계, RecordMD/2026-11-05-https-certificate-pinning-plan.md).
// 145 의 9091(평문)은 토큰·자료가 망에 그대로 흐른다. 저장된 server_url·사용자가 입력한 주소가 옛 주소여도
// HTTPS(9443)로 바꿔 쓴다. 인증서 지문 확인은 Electron main(electron/server-pins.js)이 한다.
// ⚠ 사본: electron/server-pins.js 의 SECURE_UPGRADES · AmLauncher/lib/server-pins.js · HiTessMBClient ServerPins.cs.

const SECURE_UPGRADES = [
  ['http://10.14.42.145:9091', 'https://10.14.42.145:9443'],
  ['http://hhipw170658.hdshipgroup.hhi.co.kr:9091', 'https://hhipw170658.hdshipgroup.hhi.co.kr:9443'],
];

// 사용자가 서버 설정에서 직접 넣은 주소는 바꾸지 않는다 — 145 HTTPS 가 안 열렸을 때 평문 9091 로 되돌리는 비상구.
export const MANUAL_SERVER_URL_KEY = 'wb_server_url_manual';

// 9443 은 HTTPS 전용 포트 — http://…:9443 은 늘 잘못 친 주소라 https 로 고친다(직접 입력한 주소에도 적용).
export function fixPlainHttpsPort(url) {
  const s = String(url || '').trim().replace(/\/+$/, '');
  return /^http:\/\/[^/]+:9443(\/|$)/i.test(s) ? `https://${s.slice('http://'.length)}` : s;
}

export function secureServerUrl(url) {
  const s = fixPlainHttpsPort(url);
  const lower = s.toLowerCase();
  for (const [from, to] of SECURE_UPGRADES) {
    if (lower === from || lower.startsWith(`${from}/`)) return to + s.slice(from.length);
  }
  return s;
}
