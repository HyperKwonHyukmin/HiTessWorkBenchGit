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
