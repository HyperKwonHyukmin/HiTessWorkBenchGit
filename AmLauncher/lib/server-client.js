// 서버 API 클라이언트 — 작업(흐름)마다 하나. 로그인 토큰을 들고 다니고 401 이면 한 번 다시 로그인한다.
// 토큰은 HiTessMB 가 넘긴 것(adoptToken)이 우선이고, 없으면 사번 로그인(login). 서버가 사내 AD 로그인이면
// 사번 로그인은 401 password_required 로 실패한다(2026-11-04).
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
  constructor({ serverUrl, employeeId, log, windowsLogin = null }) {
    this.serverUrl = String(serverUrl).replace(/\/$/, "");
    this.employeeId = employeeId;
    this.log = log;
    // 회사 PC 계정 자동 로그인(lib/windows-login.js) — () => Promise<{ok, status, data|detail}>. 없으면 사번 로그인만.
    this.windowsLogin = windowsLogin;
    this.token = "";
    this.user = null;
  }

  url(p) { return `${this.serverUrl}${p}`; }

  /** 회사 PC 계정으로 다시 받는다. 같은 사번일 때만 쓴다(남의 이름으로 작업하지 않게). 못 쓰면 null. */
  async tryWindowsLogin() {
    if (!this.windowsLogin) return null;
    let r;
    try { r = await this.windowsLogin(); } catch { return null; }
    if (!r?.ok) {
      if (r && r.status !== 404) this.log.warn(`회사 PC 계정 로그인 안 됨: HTTP ${r.status} ${r.detail || ""}`);
      return null;
    }
    const who = String(r.data.employee_id || "").toUpperCase();
    if (who !== String(this.employeeId).toUpperCase()) {
      this.log.warn(`회사 PC 계정(${who}) ≠ 실행 사번(${this.employeeId}) — 사용하지 않음`);
      return null;
    }
    this.token = String(r.data.token);
    const user = { ...r.data };
    delete user.token;
    this.user = user;
    this.log.info(`회사 PC 계정 로그인 성공: ${user.employee_id} ${user.name || ""}`);
    return user;
  }

  /**
   * 회사 PC 계정 자동 로그인 → 안 되면 POST /api/login {employee_id}.
   * AD 서버에서는 사번 로그인이 401 password_required 라, 자동 로그인이 넘겨받은 토큰 만료 뒤 유일한 재로그인 길이다.
   * 실패 사유를 사용자 문구로 바꿔 던진다.
   */
  async login() {
    const ssoUser = await this.tryWindowsLogin();
    if (ssoUser) return ssoUser;
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
        // 서버가 사내 AD 로그인(AUTH_MODE=ad) — 실행기는 비밀번호가 없어 HiTessMB 가 넘긴 토큰으로만 들어간다.
        : res.status === 401 && detail === "password_required" ? "로그인 세션이 없거나 만료되었습니다. AM 에서 HiTESS Model Builder 를 다시 실행해 주세요."
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

  /**
   * HiTessMB 가 넘긴 토큰을 쓴다(환경 변수 HITESS_WB_TOKEN). 서버가 AD 로그인이면 이것이 유일한 입구다.
   * 토큰이 살아 있고 실행 인자의 사번 것인지 GET /api/session/context 로 확인한다 — 남의 토큰으로 남의 작업을 열지 않게.
   */
  async adoptToken(token) {
    this.token = String(token || "");
    let res;
    try {
      res = await fetch(this.url("/api/session/context"), { headers: this.authHeaders() });
    } catch (e) {
      this.token = "";
      throw new LoginError(0, `서버(${this.serverUrl})에 연결하지 못했습니다: ${e?.cause?.message || e.message}`);
    }
    if (!res.ok) {
      this.token = "";
      throw new LoginError(res.status, res.status === 401
        ? "넘겨받은 로그인 정보가 만료되었습니다. AM 에서 HiTESS Model Builder 를 다시 실행해 주세요."
        : `로그인 확인 실패: HTTP ${res.status}`);
    }
    const body = await res.json().catch(() => ({}));
    const owner = String(body?.employee_id || "").toUpperCase();
    if (owner !== String(this.employeeId).toUpperCase()) {
      this.token = "";
      throw new LoginError(403, `넘겨받은 로그인 정보의 사번(${owner || "-"})이 실행 사번(${this.employeeId})과 다릅니다.`);
    }
    this.user = { employee_id: owner };
    this.log.info(`넘겨받은 로그인 정보 사용: ${owner}`);
    return this.user;
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
    try {
      await this.login();
    } catch (e) {
      this.log.error(`재로그인 실패: ${e.message}`);
      // 401 = 다시 들어갈 방법이 없다(AD 서버 + 넘겨받은 토큰 만료). 'HTTP 401' 대신 'AM 에서 다시 실행' 안내를 그대로 올린다.
      if (e instanceof LoginError && e.status === 401) throw e;
      return res;
    }
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
