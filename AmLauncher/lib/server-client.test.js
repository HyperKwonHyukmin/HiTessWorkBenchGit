// 실행: node --test lib/server-client.test.js   (build.ps1 이 *.test.js 를 배포 zip 에서 뺀다)
// HiTessMB 가 넘긴 토큰(adoptToken) 규칙과 AD 모드 사번 로그인 실패 문구를 고정한다(2026-11-04).
"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { ServerClient, LoginError } = require("./server-client");

const quiet = { info() {}, warn() {}, error() {} };
const realFetch = globalThis.fetch;
let calls;

function respond(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

function client() {
  return new ServerClient({ serverUrl: "http://srv:9091/", employeeId: "A123456", log: quiet });
}

test("넘겨받은 토큰이 같은 사번이면 그 토큰을 쓴다 — /api/login 은 부르지 않는다", async () => {
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return respond(200, { employee_id: "a123456" }); };
  const c = client();
  const user = await c.adoptToken("tok-1");
  assert.equal(user.employee_id, "A123456");
  assert.equal(c.token, "tok-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://srv:9091/api/session/context");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer tok-1");
});

test("남의 사번 토큰은 거부하고 들고 있지 않는다", async () => {
  globalThis.fetch = async () => respond(200, { employee_id: "B999999" });
  const c = client();
  await assert.rejects(c.adoptToken("tok-other"), (e) => e instanceof LoginError && e.status === 403);
  assert.equal(c.token, "");
});

test("만료된 토큰은 AM 에서 다시 실행하라고 알린다", async () => {
  globalThis.fetch = async () => respond(401, { detail: "Invalid or expired session" });
  const c = client();
  await assert.rejects(c.adoptToken("tok-old"), (e) => e.status === 401 && /다시 실행/.test(e.message));
  assert.equal(c.token, "");
});

test("AD 서버에 사번만 로그인하면 password_required — 다시 실행 안내", async () => {
  globalThis.fetch = async () => respond(401, { detail: "password_required" });
  await assert.rejects(client().login(), (e) => e.status === 401 && /AM 에서 HiTESS Model Builder 를 다시 실행/.test(e.message));
});

test("넘겨받은 토큰이 쓰는 중에 만료되면 'HTTP 401' 대신 다시 실행 안내를 던진다", async () => {
  globalThis.fetch = async (url) => (url.endsWith("/api/login")
    ? respond(401, { detail: "password_required" })
    : respond(401, { detail: "Invalid or expired session" }));
  const c = client();
  c.token = "tok-expired";
  await assert.rejects(c.getJson("/api/analysis/status/x"), (e) => e instanceof LoginError && /다시 실행/.test(e.message));
});

test("토큰이 없으면 예전처럼 사번 로그인", async () => {
  globalThis.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return respond(200, { token: "t2", employee_id: "A123456" }); };
  const c = client();
  await c.login();
  assert.equal(c.token, "t2");
  assert.deepEqual(calls[0].body, { employee_id: "A123456" });
});


// ── 회사 PC 계정 자동 로그인(2026-11-05) ──
function ssoClient(result) {
  return new ServerClient({ serverUrl: "http://srv:9091/", employeeId: "A123456", log: quiet,
    windowsLogin: async () => result });
}

test("자동 로그인이 같은 사번이면 /api/login 을 부르지 않는다", async () => {
  globalThis.fetch = async (url) => { calls.push(url); return respond(401, { detail: "password_required" }); };
  const c = ssoClient({ ok: true, status: 200, data: { token: "sso-tok", employee_id: "a123456", name: "홍길동" } });
  const user = await c.login();
  assert.equal(user.employee_id, "a123456");
  assert.equal(c.token, "sso-tok");
  assert.equal(calls.length, 0);
});

test("자동 로그인 계정이 실행 사번과 다르면 쓰지 않고 사번 로그인으로", async () => {
  globalThis.fetch = async (url) => { calls.push(url); return respond(401, { detail: "password_required" }); };
  const c = ssoClient({ ok: true, status: 200, data: { token: "other", employee_id: "B999999" } });
  await assert.rejects(c.login(), (e) => e.status === 401 && /다시 실행/.test(e.message));
  assert.notEqual(c.token, "other");
  assert.deepEqual(calls, ["http://srv:9091/api/login"]);
});

test("자동 로그인이 꺼진 서버(404)면 예전 사번 로그인", async () => {
  globalThis.fetch = async () => respond(200, { token: "old-tok", employee_id: "A123456" });
  const c = ssoClient({ ok: false, status: 404, detail: "windows_login_disabled" });
  await c.login();
  assert.equal(c.token, "old-tok");
});

test("401 재시도 때도 자동 로그인으로 다시 받는다", async () => {
  let n = 0;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, auth: opts?.headers?.Authorization });
    n += 1;
    return n === 1 ? respond(401, {}) : respond(200, { ok: true });
  };
  const c = ssoClient({ ok: true, status: 200, data: { token: "fresh", employee_id: "A123456" } });
  c.token = "expired";
  const res = await c.fetchAuthed("/api/x", { method: "GET" });
  assert.equal(res.status, 200);
  assert.equal(calls[1].auth, "Bearer fresh");
});