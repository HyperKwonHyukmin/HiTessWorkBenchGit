// 회사 PC 계정 자동 로그인(Windows 통합 인증) — 서버 `POST /api/login/windows` (2026-11-05).
//
// 왜 main 프로세스에서: Negotiate 는 Chromium 네트워크 스택이 Windows 계정으로 토큰을 만들어 준다.
// 화면(file://)의 axios 로 부르면 교차 출처 요청이라 HTTP 인증이 실리지 않는다(CORS 자격 증명).
// main 의 net.request 는 출처 제약이 없고, 같은 Chromium 스택이라 NTLM·Kerberos 를 스스로 처리한다
// (2026-11-05 Electron 26 실측 — 서버가 HHI\사번 을 받음).
//
// 전용 메모리 세션(파티션)을 쓴다: 자동 인증 허용 목록을 다른 창(외부 App 등)에 넓히지 않으려고.

const LOGIN_PARTITION = "wb-windows-login";

// Windows 자격 증명(NTLM 응답)은 사내 서버에만 보낸다 — 서버 주소를 외부로 바꿔도 응답이 새지 않게.
// 사설 IPv4(10/8·172.16/12·192.168/16)·localhost·사내 도메인(*.hhi.co.kr)만.
function isInternalHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (h === "hhi.co.kr" || h.endsWith(".hhi.co.kr")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function windowsLoginUrl(serverUrl, employeeId = "") {
  let parsed;
  try { parsed = new URL(String(serverUrl || "")); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!isInternalHost(parsed.hostname)) return null;
  const query = employeeId ? `?employee_id=${encodeURIComponent(String(employeeId).trim())}` : "";
  return `${parsed.origin}/api/login/windows${query}`;
}

// 결과: { ok: true, status: 200, data } | { ok: false, status, detail }
// status 0 = 접속 실패·시간 초과(서버 응답 없음).
function parseResult(status, text) {
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (status === 200 && data && data.token) return { ok: true, status, data };
  const detail = data && typeof data.detail === "string" ? data.detail : "";
  return { ok: false, status, detail };
}

// employeeId: 화면에 입력한(또는 실행 인자의) 사번. 보내면 서버가 Windows 계정과 같을 때만 세션을 만든다
// (다르면 403 windows_account_mismatch — 남의 PC 에서 그 PC 주인 이름으로 로그인 처리가 일어나지 않게).
function requestWindowsLogin({ net, session, serverUrl, employeeId = "", timeoutMs = 15000, log = null }) {
  const t0 = Date.now();
  const trace = (msg) => { if (log) log(`[windows-login] +${Date.now() - t0}ms ${msg}`); };
  const url = windowsLoginUrl(serverUrl, employeeId);
  if (!url) return Promise.resolve({ ok: false, status: 0, detail: "invalid_server_url" });

  const ses = session.fromPartition(LOGIN_PARTITION);
  try { ses.allowNTLMCredentialsForDomains(new URL(url).hostname); } catch { /* 옛 Electron — 기본 정책에 맡김 */ }

  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; clearTimeout(timer); trace(`끝 ${result.status} ${result.detail || "ok"}`); resolve(result); } };
    trace(`요청 ${url}`);
    const req = net.request({ url, method: "POST", session: ses, useSessionCookies: false });
    const timer = setTimeout(() => { try { req.abort(); } catch {} done({ ok: false, status: 0, detail: "timeout" }); }, timeoutMs);
    req.on("redirect", (code) => trace(`redirect ${code}`));
    req.on("finish", () => trace("요청 본문 전송 끝"));
    req.on("response", (res) => {
      trace(`응답 ${res.statusCode}`);
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => done(parseResult(res.statusCode, text)));
      res.on("error", () => done({ ok: false, status: 0, detail: "network_error" }));
    });
    // Basic 같은 다른 인증 요구 — 사용자에게 창을 띄우지 않고 실패로 본다.
    req.on("login", (info, callback) => { trace(`login 이벤트 ${info?.scheme || ""}`); try { callback(); } catch {} done({ ok: false, status: 401, detail: "windows_auth_failed" }); });
    req.on("error", (e) => { trace(`오류 ${e?.message || e}`); done({ ok: false, status: 0, detail: "network_error" }); });
    // 본문을 싣지 않는다 — Electron 40 은 본문이 있으면 NTLM 3번째 메시지를 보내지 않고 멈췄다(2026-11-05 실측,
    // Electron 26 은 정상). 사번은 주소 쿼리로 보낸다(windowsLoginUrl).
    req.end();
  });
}

module.exports = { requestWindowsLogin, windowsLoginUrl, parseResult, isInternalHost, LOGIN_PARTITION };
