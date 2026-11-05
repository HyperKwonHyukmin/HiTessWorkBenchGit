// 회사 PC 계정 자동 로그인 — 주소 검사·결과 해석·전용 세션 사용을 지킨다(실제 Negotiate 는 2026-11-05 Electron 26 실측).
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { requestWindowsLogin, windowsLoginUrl, parseResult, isInternalHost, LOGIN_PARTITION } = require("./windows-login");

test("서버 주소에서 로그인 주소를 만든다 — http(s) 만", () => {
  assert.equal(windowsLoginUrl("http://10.14.42.145:9091/"), "http://10.14.42.145:9091/api/login/windows");
  assert.equal(windowsLoginUrl("https://host.hhi.co.kr:9443"), "https://host.hhi.co.kr:9443/api/login/windows");
  assert.equal(windowsLoginUrl("file:///C:/x"), null);
  assert.equal(windowsLoginUrl("not a url"), null);
});

test("결과 해석 — 토큰이 있어야 성공, 실패는 detail 만", () => {
  assert.deepEqual(parseResult(200, '{"token":"t","employee_id":"A1"}'),
    { ok: true, status: 200, data: { token: "t", employee_id: "A1" } });
  assert.deepEqual(parseResult(403, '{"detail":"windows_account_not_employee"}'),
    { ok: false, status: 403, detail: "windows_account_not_employee" });
  assert.deepEqual(parseResult(404, '{"detail":"windows_login_disabled"}'),
    { ok: false, status: 404, detail: "windows_login_disabled" });
  assert.deepEqual(parseResult(502, "<html>"), { ok: false, status: 502, detail: "" });
});

function fakeElectron(status, body) {
  const calls = { partition: null, allowed: null, options: null };
  const session = {
    fromPartition(name) {
      calls.partition = name;
      return { allowNTLMCredentialsForDomains(d) { calls.allowed = d; } };
    },
  };
  const net = {
    request(options) {
      calls.options = options;
      const req = new EventEmitter();
      req.setHeader = () => {};
      req.abort = () => {};
      req.end = () => setImmediate(() => {
        const res = new EventEmitter();
        res.statusCode = status;
        req.emit("response", res);
        res.emit("data", body);
        res.emit("end");
      });
      return req;
    },
  };
  return { net, session, calls };
}

test("전용 세션으로 POST 하고 허용 목록은 그 서버 하나", async () => {
  const { net, session, calls } = fakeElectron(200, '{"token":"tok","employee_id":"A476854"}');
  const r = await requestWindowsLogin({ net, session, serverUrl: "http://10.14.42.145:9091" });
  assert.equal(r.ok, true);
  assert.equal(r.data.employee_id, "A476854");
  assert.equal(calls.partition, LOGIN_PARTITION);
  assert.equal(calls.allowed, "10.14.42.145");
  assert.equal(calls.options.method, "POST");
  assert.equal(calls.options.useSessionCookies, false);
});

test("잘못된 주소는 요청하지 않는다", async () => {
  const { net, session, calls } = fakeElectron(200, "{}");
  const r = await requestWindowsLogin({ net, session, serverUrl: "javascript:alert(1)" });
  assert.deepEqual(r, { ok: false, status: 0, detail: "invalid_server_url" });
  assert.equal(calls.options, null);
});

test("사번은 쿼리로 — 본문을 실으면 Electron 40 이 NTLM 3번째 메시지를 보내지 않았다", () => {
  assert.equal(windowsLoginUrl("http://10.14.42.145:9091", "A476854"),
    "http://10.14.42.145:9091/api/login/windows?employee_id=A476854");
});

test("Windows 자격 증명은 사내 주소로만", () => {
  for (const h of ["10.14.42.145", "172.16.0.1", "192.168.1.5", "localhost", "HHIPW170658.HDShipGroup.HHI.co.kr"]) {
    assert.equal(isInternalHost(h), true, h);
  }
  for (const h of ["8.8.8.8", "172.32.0.1", "example.com", "hhi.co.kr.evil.com", ""]) {
    assert.equal(isInternalHost(h), false, h);
  }
  assert.equal(windowsLoginUrl("http://8.8.8.8:9091"), null);
});