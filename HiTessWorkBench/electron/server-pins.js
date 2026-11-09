// 서버 인증서 고정(통합 계획 3단계, RecordMD/2026-11-05-https-certificate-pinning-plan.md).
//
// 145 HTTPS(9091 같은 포트, 옛 9443)는 자체 인증서라 회사 PC 가 믿는 인증서 목록에 없다. 대신 앱이 그 인증서의
// 공개키 지문(SPKI sha256, base64)을 들고 있다가 같을 때만 연결한다.
// - 지문이 맞으면: 인증서 체인·이름과 상관없이 통과(우리 키를 가진 서버다).
// - 145 주소인데 지문이 다르면: 거부. 회사 PC 가 믿는 인증서(Somansa 등)를 내밀어도 막는다 = 중간자 차단.
// - 그 밖의 주소: Chromium 기본 검사 그대로.
// 고정값은 공개 정보다. 145 에서 `python scripts/make_tls_cert.py --pins` 로 다시 볼 수 있다.
// ⚠ 사본: AmLauncher/lib/server-pins.js · HiTessMBClient/src/ServerPins.cs · frontend/src/utils/secureServerUrl.js(주소 바꾸기만).
//   지문을 바꾸면 네 곳 다. 주소 표(SECURE_UPGRADES)는 2026-11-10 부터 이 파일과 프론트 사본만 9091 — 실행기·HiTessMB 는 9443 유지.

const crypto = require("crypto");

// 145 운영 서버 — 지금 키 + 예비 키(지금 키가 유출되면 서버가 예비 키로 바꾼다, 앱 재배포 없이). 2026-11-05 생성.
const SERVER_PINS = [
  "y5rOaChW9frcyuJTf9rulsY0IyxPTmPfNeaNkpHZwCk=",
  "u1mZtu+qFaU7wUx16vhHgvJAZP/QKJJ5L+GMxh26f9g=",
];

// 개발 PC 시험용 인증서 — 패키징하지 않은 실행(npm run dev)에서만 받아 준다.
const DEV_PINS = [
  "DOyc1eUt3A59amHRj2Vtu7oWTPmm8DHBxOGHkG/O6Lo=",
  "ZsVUCxHq3xztvgjGLDyUuNhxdKYZA8fdMwE1fwvb+ic=",
];

// 이 주소로는 지문이 맞는 인증서만 받는다(소문자).
const PINNED_HOSTS = ["10.14.42.145", "hhipw170658.hdshipgroup.hhi.co.kr"];

// 옛 주소 → HTTPS 주소. 저장된 server_url·명령줄 인자가 옛 주소여도 HTTPS 로 간다.
// 2026-11-10: HTTPS 를 9443 이 아니라 **9091 같은 포트**로 받는다(백엔드 app/services/port_mux.py) —
// 9091 만 방화벽이 열린 계열사 위치 때문. 1.7.2~1.7.15 가 저장해 둔 https://…:9443 도 9091 로 옮긴다.
// 145 의 9443 은 옛 exe·실행기(AmLauncher)·HiTessMB 를 위해 그대로 열어 둔다(그 둘은 9443 그대로 — 사용자 결정).
const SECURE_UPGRADES = [
  ["http://10.14.42.145:9091", "https://10.14.42.145:9091"],
  ["https://10.14.42.145:9443", "https://10.14.42.145:9091"],
  ["http://hhipw170658.hdshipgroup.hhi.co.kr:9091", "https://hhipw170658.hdshipgroup.hhi.co.kr:9091"],
  ["https://hhipw170658.hdshipgroup.hhi.co.kr:9443", "https://hhipw170658.hdshipgroup.hhi.co.kr:9091"],
];

// 9443 은 HTTPS 전용 포트 — http://…:9443 은 늘 잘못 친 주소라 https 로 고친다.
function secureServerUrl(url) {
  let s = String(url || "").trim().replace(/\/+$/, "");
  if (/^http:\/\/[^/]+:9443(\/|$)/i.test(s)) s = "https://" + s.slice("http://".length);
  const lower = s.toLowerCase();
  for (const [from, to] of SECURE_UPGRADES) {
    if (lower === from || lower.startsWith(from + "/")) return to + s.slice(from.length);
  }
  return s;
}

function spkiPinFromPem(pem) {
  const der = new crypto.X509Certificate(pem).publicKey.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("base64");
}

// session.setCertificateVerifyProc 에 넘길 함수. callback: 0 = 통과, -2 = 거부, -3 = Chromium 기본 검사.
function makeCertificateVerifyProc({ pins = SERVER_PINS, extraPins = [], pinnedHosts = PINNED_HOSTS, log = null } = {}) {
  const allowed = new Set([...pins, ...extraPins]);
  const strict = new Set(pinnedHosts.map((h) => h.toLowerCase()));
  return (request, callback) => {
    let pin = "";
    try { pin = spkiPinFromPem(request.certificate.data); } catch { /* 읽지 못하면 아래 규칙대로 */ }
    if (pin && allowed.has(pin)) return callback(0);
    const host = String(request.hostname || "").toLowerCase();
    if (strict.has(host)) {
      if (log) log(`[server-pins] ${host} 인증서 지문 불일치 — 연결 거부 (${pin || "읽지 못함"})`);
      return callback(-2);
    }
    return callback(-3);
  };
}

// 모든 세션(본창·Studio·영상 창·자동 로그인 전용 세션)에 같은 검사를 건다.
function installCertificatePinning({ app, session, extraPins = [], log = null }) {
  const proc = makeCertificateVerifyProc({ extraPins, log });
  session.defaultSession.setCertificateVerifyProc(proc);
  app.on("session-created", (ses) => ses.setCertificateVerifyProc(proc));
  return proc;
}

// main 의 Node fetch 는 Chromium 검사를 거치지 않는다 → https 는 net.fetch(Chromium)로 보낸다.
// FormData·Blob 본문은 net.fetch 가 다르게 다룰 수 있어 미리 바이트로 만든다(Content-Type 경계 포함).
async function serverFetch(net, url, init = {}) {
  if (!/^https:/i.test(String(url))) return fetch(url, init);
  const headers = new Headers(init.headers || {});
  let body = init.body;
  if (body != null && typeof body !== "string" && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
    const req = new Request("http://localhost/", { method: "POST", body });
    if (!headers.has("content-type") && req.headers.get("content-type")) {
      headers.set("content-type", req.headers.get("content-type"));
    }
    body = Buffer.from(await req.arrayBuffer());
  }
  return net.fetch(String(url), { ...init, headers, body });
}

module.exports = {
  SERVER_PINS, DEV_PINS, PINNED_HOSTS,
  secureServerUrl, spkiPinFromPem, makeCertificateVerifyProc, installCertificatePinning, serverFetch,
};
