// 서버 API 클라이언트 — 작업(흐름)마다 하나. 사번 로그인 토큰을 들고 다니고 401 이면 한 번 다시 로그인한다.
//
// WorkBench electron/index.js 의 getWorkbenchRuntimeConfig / refreshWorkbenchSession /
// fetchWithSessionRefresh / readBackendError 에서 옮김. WorkBench 는 토큰을 메인 창 localStorage 에서
// 읽지만, 실행기는 메인 창이 없으므로 이 객체가 토큰을 직접 보관한다.
// ⚠ 로그아웃(/api/logout)은 부르지 않는다 — 같은 사번의 다른 앱 세션(LogBook 연동 등)을 끊을 수 있다.
"use strict";

class LoginError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBackendError(res) {
  try {
    const body = await res.json();
    const d = body?.detail;
    if (typeof d === "string") return d;
    if (d && typeof d === "object") return d.message || JSON.stringify(d);
    return body?.message || JSON.stringify(body);
  } catch {
    try { return await res.text(); } catch { return ""; }
  }
}

class ServerClient {
  /**
   * @param {{serverUrl:string, employeeId:string, log:any}} opts
   */
  constructor({ serverUrl, employeeId, log }) {
    this.serverUrl = String(serverUrl).replace(/\/$/, "");
    this.employeeId = employeeId;
    this.log = log;
    this.token = "";
    this.user = null;
  }

  url(p) { return `${this.serverUrl}${p}`; }

  /** POST /api/login {employee_id} → token. 실패 사유를 사용자 문구로 바꿔 던진다. */
  async login() {
    let res;
    try {
      res = await fetch(this.url("/api/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: this.employeeId }),
      });
    } catch (e) {
      throw new LoginError(0, `서버(${this.serverUrl})에 연결하지 못했습니다: ${e?.cause?.message || e.message}`);
    }
    if (!res.ok) {
      const detail = await readBackendError(res);
      const msg = res.status === 404 ? `가입되지 않은 사번입니다(${this.employeeId}). HiTESS WorkBench 가입 후 관리자 승인을 받으세요.`
        : res.status === 403 ? `관리자 승인 대기 중인 사번입니다(${this.employeeId}).`
        : res.status === 503 ? "서버 점검 중입니다. 잠시 뒤 다시 시도하세요."
        : `로그인 실패: HTTP ${res.status}${detail ? ` - ${detail}` : ""}`;
      throw new LoginError(res.status, msg);
    }
    const body = await res.json();
    if (!body?.token) throw new LoginError(500, "로그인 응답에 token 이 없습니다.");
    this.token = String(body.token);
    const user = { ...body };
    delete user.token;
    this.user = user;
    this.log.info(`로그인 성공: ${user.employee_id} ${user.name || ""}`);
    return user;
  }

  authHeaders(extra = {}) {
    return this.token ? { ...extra, Authorization: `Bearer ${this.token}` } : { ...extra };
  }

  /**
   * 인증 요청. 401 이면 다시 로그인해 한 번만 재시도한다(WorkBench fetchWithSessionRefresh 와 같은 규칙).
   * options 를 함수로 주면 재시도 때 본문(FormData 등)을 새로 만든다.
   */
  async fetchAuthed(pathOrUrl, optionsOrFactory = {}) {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : this.url(pathOrUrl);
    const build = () => {
      const options = typeof optionsOrFactory === "function" ? optionsOrFactory() : optionsOrFactory;
      return { ...options, headers: this.authHeaders(options.headers || {}) };
    };
    let res = await fetch(url, build());
    if (res.status !== 401) return res;
    this.log.warn(`401 → 다시 로그인: ${url}`);
    try { await this.login(); } catch (e) { this.log.error(`재로그인 실패: ${e.message}`); return res; }
    res = await fetch(url, build());
    return res;
  }

  async getJson(p) {
    const res = await this.fetchAuthed(p, { method: "GET" });
    if (!res.ok) {
      const detail = await readBackendError(res);
      const err = new Error(`HTTP ${res.status}${detail ? ` - ${detail}` : ""}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async postJson(p, body) {
    const res = await this.fetchAuthed(p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await readBackendError(res);
      const err = new Error(`HTTP ${res.status}${detail ? ` - ${detail}` : ""}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

module.exports = { ServerClient, LoginError, readBackendError };
