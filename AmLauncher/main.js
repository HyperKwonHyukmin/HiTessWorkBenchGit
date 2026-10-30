// HiTESS MB 실행기 — AM 연동용 Model Builder Studio 호스트(Electron main).
//
//   HiTessMBLauncher.exe --server=<http://host:9091> --employee <사번> --job <job_id> [--hull-no <호선>] [--smoke]
//
// 흐름(작업 하나 = Flow 하나): 로그인 → 모델 생성 진행(서버 status 1.5초 폴링) → 결과 폴더 zip 받기
//   → Model Builder Studio(model-studio) 확인·설치 → Studio 창 열기.
// Studio 의 편집 확정·구조 해석은 lib/studio-host.js · lib/finalize.js 가 처리한다.
// 이미 떠 있으면(단일 인스턴스) 새 인자를 second-instance 로 받아 같은 흐름을 한 번 더 — 모델마다 Studio 창 따로.
"use strict";

const fs = require("fs");
const path = require("path");
const { app, dialog, shell } = require("electron");

// ── 폴더 — app ready 와 단일 인스턴스 잠금보다 먼저 정해야 한다(잠금도 userData 를 쓴다) ──
const LOCAL_APPDATA = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
const ROOT_DIR = path.join(LOCAL_APPDATA, "HiTESS", "MBLauncher");
const DATA_DIR = path.join(ROOT_DIR, "data");
const LOG_DIR = path.join(ROOT_DIR, "logs");
const RESULTS_DIR = path.join(DATA_DIR, "results");
const VIEWERS_DIR = path.join(DATA_DIR, "viewers");
const VIEWER_ID = "model-studio";
const POLL_MS = 1500;
const BUILD_TIMEOUT_MS = 25 * 60 * 1000;   // 서버 build-full 제한 20분 + 대기열 여유
const SMOKE_WAIT_MS = 8000;
const SMOKE_TIMEOUT_MS = 30 * 60 * 1000;

// ⚠ Chromium 샌드박스 끄기 (2026-10-30 실측): 이 회사 PC 에서는 같은 Electron 40 바이너리라도
//   이름이 electron.exe 면 되고 HiTessMBLauncher.exe 로 바꾸면 GPU·렌더러 하위 프로세스가
//   'launch failed: error_code=40' 로 못 떠서 "GPU process isn't usable. Goodbye." 로 종료된다(종료 코드 0, JS 로그 없음).
//   --no-sandbox 면 정상. 사내 보안 제품이 모르는 exe 이름의 샌드박스 프로세스를 막는 것으로 보이며,
//   사용자 PC 도 같은 제품이라 기본으로 끈다. 창에는 설치 때 sha256 을 확인한 로컬 Studio(file://)와
//   실행기 화면만 띄우고 외부 페이지 이동·새 창을 막으므로 위험은 제한적이다(contextIsolation 유지).
app.commandLine.appendSwitch("no-sandbox");
// smoke 는 사람이 화면을 보지 않는 PC 에서 돈다 — 창이 가려지면 Chromium 이 렌더러를 늦춰 DOM 확인이
// 수십 초 늦어졌다(실측 15~60초). smoke 에서만 가려진 창 늦추기를 끈다(일반 실행에는 영향 없음).
if (process.argv.includes("--smoke")) {
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

fs.mkdirSync(DATA_DIR, { recursive: true });
app.setPath("userData", DATA_DIR);
app.setAppUserModelId("HiTESS.MBLauncher");

const { createLogger } = require("./lib/logger");
const { parseArgs } = require("./lib/args");
const log = createLogger(LOG_DIR);

// second-instance 의 commandLine 은 Chromium 이 스위치를 앞으로 모으고 값을 뒤로 보내 순서가 깨진다
// (2026-10-30 실측: "--employee --job … A476854 <job>"). 그래서 원래 argv 를 additionalData 로 함께 넘긴다.
const gotLock = app.requestSingleInstanceLock({ argv: process.argv.slice(1) });
if (!gotLock) {
  log.info(`이미 실행 중 — 인자를 기존 실행기로 넘기고 종료: ${process.argv.slice(1).join(" ")}`);
  app.quit();
  return;
}

// 여기서부터 electron 모듈(net 등)을 쓰는 모듈을 불러온다.
const { ServerClient, LoginError } = require("./lib/server-client");
const { installViewer, fetchResultDir } = require("./lib/install");
const { ProgressWindow } = require("./lib/progress-window");
const { registerStudioIpc, openStudio, windowOfSession } = require("./lib/studio-host");
const { startFinalize, pollApplyEdit, fetchEditStatus, downloadServerFile } = require("./lib/finalize");

let exitCode = 0;
let busyCount = 0; // 창 없이 진행 중인 작업 수(편집 적용 폴링 등) — 0 일 때만 창이 모두 닫히면 종료
const flows = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseName = (p) => String(p || "").split(/[\\/]/).pop();

const BUILD_STEPS = [
  { key: "login", label: "로그인" },
  { key: "build", label: "모델 생성 중" },
  { key: "result", label: "결과 받는 중" },
  { key: "studio", label: "Studio 확인·설치" },
  { key: "open", label: "Studio 열기" },
];
const EDIT_STEPS = [
  { key: "upload", label: "편집 내용 올리기" },
  { key: "apply", label: "편집 적용 중" },
  { key: "download", label: "편집 BDF 받기" },
];

class Flow {
  constructor(args) {
    this.args = args;
    this.log = log.child(`job ${args.job.slice(0, 8)}`);
    this.client = new ServerClient({ serverUrl: args.server, employeeId: args.employee, log: this.log });
    this.outputDir = null;   // 서버 경로(solve·편집 확정에 씀)
    this.localDir = null;    // 사용자 PC 로 받은 결과 폴더(Studio initialFolder)
    this.bdfPath = null;     // 서버 원본 최종 BDF
    this.struName = null;
    this.pw = null;
    this.steps = [];
    this.smokeDone = false;
    this.failed = false;
    flows.add(this);
  }

  subtitle() {
    const parts = [];
    if (this.args.hullNo) parts.push(`호선 ${this.args.hullNo}`);
    if (this.struName) parts.push(this.struName);
    parts.push(`사번 ${this.args.employee}`);
    return parts.join(" · ");
  }

  // ── 진행 창 ──
  openProgress(steps, title) {
    if (!this.pw || !this.pw.alive()) {
      this.pw = new ProgressWindow({
        onAction: (id) => this.onAction(id),
        onClosed: () => { this.pw = null; },
      });
    }
    this.steps = steps.map((s) => ({ ...s, status: "pending", detail: "" }));
    this.pw.set({ title, subtitle: this.subtitle(), steps: this.steps, progress: null, busy: true, message: "", error: null, info: [], actions: [] });
    this.pw.focus();
  }

  step(key, status, detail) {
    this.steps = this.steps.map((s) => (s.key === key ? { ...s, status, detail: detail ?? s.detail } : s));
    this.pw?.set({ steps: this.steps, subtitle: this.subtitle() });
  }

  ui(patch) { this.pw?.set(patch); }

  // 편집 적용을 기다리는 동안 사용자가 진행 창을 닫았으면, 결과를 보여 주려고 같은 단계로 다시 띄운다.
  reopenIfClosed(title) {
    if (this.pw && this.pw.alive()) return;
    const steps = this.steps;
    this.pw = new ProgressWindow({ onAction: (id) => this.onAction(id), onClosed: () => { this.pw = null; } });
    this.pw.set({ title, subtitle: this.subtitle(), steps, progress: null, busy: true, message: "", error: null, info: [], actions: [] });
  }

  onAction(id) {
    this.log.info(`버튼: ${id}`);
    if (id === "close") this.pw?.close();
    else if (id === "logs") shell.openPath(LOG_DIR);
    else if (id === "open-folder" && this.lastSavedPath) shell.showItemInFolder(this.lastSavedPath);
    else if (id === "save-as") this.saveAs().catch((e) => this.log.error(`다른 위치에 저장 실패: ${e.message}`));
    else if (id === "open-diagnosis") this.continueAfterBuild({ diagnosis: true }).catch((e) => this.fail("open", e));
  }

  fail(stepKey, err) {
    const msg = err?.message || String(err);
    this.failed = true;
    exitCode = 1;
    this.log.error(`실패(${stepKey}): ${msg}`);
    if (stepKey) this.step(stepKey, "error");
    this.ui({ title: "진행하지 못했습니다", busy: false, progress: null, message: "", error: msg,
      info: [{ label: "로그 폴더", value: LOG_DIR }],
      actions: [{ id: "logs", label: "로그 폴더 열기" }, { id: "close", label: "닫기", primary: true }] });
    if (this.args.smoke) this.finishSmoke({ stage: stepKey, error: msg });
  }

  // ── 1~5단계 ──
  async run() {
    const a = this.args;
    this.log.info(`시작: server=${a.server} employee=${a.employee} job=${a.job} hull=${a.hullNo || "-"} smoke=${a.smoke}`);
    this.openProgress(BUILD_STEPS, "모델을 준비하고 있습니다");

    // 1) 로그인
    this.step("login", "active");
    try {
      const user = await this.client.login();
      this.step("login", "done", user?.name ? `${user.name} (${user.employee_id})` : user?.employee_id);
    } catch (e) {
      this.fail("login", e instanceof LoginError ? e : new Error(`로그인 실패: ${e.message}`));
      return;
    }

    // 2) 모델 생성 진행
    this.step("build", "active");
    let job;
    try {
      job = await this.waitForBuild();
    } catch (e) {
      this.fail("build", e);
      return;
    }
    if (job.status !== "Success") {
      const msg = job.message || "모델 생성 실패";
      this.log.error(`빌드 실패: ${msg}`);
      if (job.engine_log) this.log.error(`엔진 로그(끝 1500자): ${String(job.engine_log).slice(-1500)}`);
      this.failed = true;
      exitCode = 1;
      this.step("build", "error", msg);
      const actions = [{ id: "logs", label: "로그 폴더 열기" }];
      if (this.outputDir) actions.push({ id: "open-diagnosis", label: "Studio 에서 진단 보기", primary: true });
      actions.push({ id: "close", label: "닫기", primary: !this.outputDir });
      this.ui({ title: "모델을 만들지 못했습니다", busy: false, progress: null, message: "",
        error: `${msg}\n${this.outputDir ? "진단 자료(단계별 JSON)는 Studio 에서 볼 수 있습니다." : ""}`.trim(),
        info: [{ label: "로그 폴더", value: LOG_DIR }], actions });
      if (this.args.smoke) this.finishSmoke({ stage: "build", error: msg });
      return;
    }
    this.step("build", "done", "모델 생성 완료");
    await this.continueAfterBuild({ diagnosis: false });
  }

  async waitForBuild() {
    const started = Date.now();
    let notFound = 0;
    while (Date.now() - started < BUILD_TIMEOUT_MS) {
      let sd;
      try {
        sd = await this.client.getJson(`/api/analysis/status/${encodeURIComponent(this.args.job)}`);
      } catch (e) {
        if (e.status === 404 && ++notFound >= 5) throw new Error(`서버에 이 작업이 없습니다(job ${this.args.job}).`);
        if (e.status === 403) throw new Error("이 작업을 볼 권한이 없습니다(다른 사번의 작업).");
        this.log.warn(`status 조회 실패: ${e.message}`);
        await sleep(POLL_MS);
        continue;
      }
      const pct = Number.isFinite(Number(sd.progress)) ? Number(sd.progress) : null;
      const queue = sd.status === "Pending" && sd.queuePosition ? ` (대기 ${sd.queuePosition}번째)` : "";
      this.ui({ progress: pct, busy: true, message: `${sd.message || sd.status}${queue}` });
      if (sd.status === "Success" || sd.status === "Failed" || sd.status === "Cancelled" || sd.status === "Interrupted") {
        await this.captureBuildResult(sd);
        this.log.info(`빌드 종료: ${sd.status} output_dir=${this.outputDir}`);
        return sd;
      }
      await sleep(POLL_MS);
    }
    throw new Error("모델 생성 대기 시간이 지났습니다(25분).");
  }

  // 완료 응답 최상위에 output_dir·bdf_path·stru_path 가 실린다(mark_complete extra).
  // 메모리 저장소에서 빠져 DB 응답만 오면 해석 기록(GET /api/analysis/{id})의 result_info 로 보충한다.
  async captureBuildResult(sd) {
    this.outputDir = sd.output_dir || null;
    this.bdfPath = sd.bdf_path || null;
    if (sd.stru_path || sd.pipe_path) this.struName = baseName(sd.stru_path || sd.pipe_path).replace(/\.csv$/i, "");
    if (!this.outputDir && sd.project?.id) {
      try {
        const rec = await this.client.getJson(`/api/analysis/${sd.project.id}`);
        const ri = rec?.result_info || {};
        this.outputDir = ri.output_dir || null;
        this.bdfPath = this.bdfPath || ri.bdf_path || null;
        const ii = rec?.input_info || {};
        if (!this.struName && (ii.stru_csv || ii.pipe_csv)) this.struName = baseName(ii.stru_csv || ii.pipe_csv).replace(/\.csv$/i, "");
      } catch (e) {
        this.log.warn(`해석 기록 조회 실패: ${e.message}`);
      }
    }
  }

  async continueAfterBuild({ diagnosis }) {
    if (!this.outputDir) throw new Error("서버가 결과 폴더(output_dir)를 알려 주지 않았습니다.");
    if (diagnosis) {
      this.log.info("빌드 실패 진단 자료로 Studio 를 엽니다.");
      this.ui({ title: "진단 자료를 여는 중", error: null, actions: [], busy: true });
    }
    // 3) 결과 받기
    this.step("result", "active");
    this.ui({ progress: 0, message: "결과 폴더 내려받는 중..." });
    try {
      this.localDir = await fetchResultDir({
        client: this.client, outputDir: this.outputDir, jobId: this.args.job,
        resultsRoot: RESULTS_DIR, tempDir: app.getPath("temp"), log: this.log,
        onProgress: ({ received, total }) => this.ui({
          progress: total > 0 ? Math.round((received / total) * 100) : null,
          message: `결과 폴더 내려받는 중... ${(received / 1048576).toFixed(1)} MB`,
        }),
      });
      this.step("result", "done", this.localDir);
    } catch (e) {
      this.fail("result", new Error(`결과 폴더 받기 실패: ${e.message}`));
      return;
    }

    // 4) Studio 확인·설치
    this.step("studio", "active");
    this.ui({ progress: null, message: "Studio 버전 확인 중..." });
    let installed;
    try {
      installed = await installViewer({
        client: this.client, viewerId: VIEWER_ID, viewersRoot: VIEWERS_DIR, tempDir: app.getPath("temp"), log: this.log,
        onProgress: ({ received, total }) => this.ui({
          progress: total > 0 ? Math.round((received / total) * 100) : null,
          message: `Studio 내려받는 중... ${(received / 1048576).toFixed(1)} MB`,
        }),
      });
      this.step("studio", "done", `v${installed.manifest.version}${installed.installed ? " 새로 설치" : " 설치본 사용"}`);
    } catch (e) {
      this.fail("studio", new Error(`Studio 설치 실패: ${e.message}`));
      return;
    }

    // 5) Studio 열기
    this.step("open", "active");
    this.ui({ progress: null, message: "Studio 창을 여는 중..." });
    const title = `${[this.args.hullNo, this.struName || baseName(this.outputDir)].filter(Boolean).join(" · ")} — HiTESS Model Builder Studio`;
    try {
      const session = openStudio({
        flow: this, viewerDir: installed.dir, viewerId: VIEWER_ID,
        initialFolder: this.localDir, outputDir: this.outputDir, windowTitle: title, smoke: this.args.smoke,
      });
      this.session = session;
      this.log.info(`Studio 창 열기: ${title}${session.reused ? " (기존 창 재사용)" : ""}`);
      const win = session.win;
      // Studio 창이 뜨면 진행 창은 닫는다.
      const closeProgress = () => { this.step("open", "done"); this.pw?.close(); };
      if (session.reused || win.isVisible()) closeProgress();
      else win.once("show", closeProgress);
      if (this.args.smoke) this.armSmoke(session);
    } catch (e) {
      this.fail("open", e);
    }
  }

  // ── Studio 편집 확정 ──
  async finalizeFromStudio(session, folderPath, request) {
    const editFileName = request?.editFileName || null;
    this.log.info(`Studio 저장 요청: edit=${editFileName || "(수정 없음)"} folder=${folderPath}`);
    const r = await startFinalize({
      client: this.client, localDir: session.initialFolder, outputDir: session.outputDir,
      folderPath, editFileName, log: this.log,
    });
    if (!r.ok) {
      this.log.warn(`저장 요청 실패: ${r.error}`);
      return { ok: false, error: r.error };
    }
    // Studio 창이 곧 닫히므로 진행 창을 먼저 띄운다(창이 모두 닫혀 앱이 끝나지 않게).
    this.openProgress(EDIT_STEPS, r.mode === "apply" ? "편집을 적용하고 있습니다" : "원본 모델로 저장했습니다");
    if (r.mode === "discard") {
      this.step("upload", "done", "수정 내역 없음 — 이전 편집본 정리");
      this.step("apply", "done", "적용할 편집 없음");
      this.finishWithBdf({ remotePath: this.bdfPath, localSub: "", label: "원본 BDF" }).catch((e) => this.fail("download", e));
    } else {
      this.step("upload", "done", editFileName);
      this.step("apply", "active");
      busyCount++;
      this.followApplyEdit(r.jobId)
        .catch((e) => { this.reopenIfClosed("편집 적용"); this.fail("apply", e); })
        .finally(() => { busyCount--; });
    }
    return { ok: true };
  }

  async followApplyEdit(jobId) {
    const sd = await pollApplyEdit({
      client: this.client, jobId,
      onStatus: (s) => this.ui({ progress: Number.isFinite(Number(s.progress)) ? Number(s.progress) : null, message: s.message || s.status }),
    });
    this.reopenIfClosed("편집 적용");
    if (sd.status !== "Success") {
      const msg = sd.engine_log ? `${sd.message || "편집 적용 실패"}\n${String(sd.engine_log).slice(-800)}` : (sd.message || "편집 적용 실패");
      this.fail("apply", new Error(msg));
      return;
    }
    this.step("apply", "done", sd.message || "편집 적용 완료");
    let st;
    try { st = await fetchEditStatus({ client: this.client, outputDir: this.outputDir }); } catch (e) { this.fail("download", new Error(`편집 상태 조회 실패: ${e.message}`)); return; }
    if (!st?.edited_bdf_path) { this.fail("download", new Error("편집 적용은 끝났지만 편집 BDF 를 찾지 못했습니다.")); return; }
    if (st.f06_diagnostics?.available && st.f06_diagnostics?.fatal_count) {
      this.log.warn(`편집 BDF Nastran FATAL ${st.f06_diagnostics.fatal_count}건`);
    }
    await this.finishWithBdf({ remotePath: st.edited_bdf_path, localSub: "edited", label: "편집 BDF" }).catch((e) => this.fail("download", e));
  }

  // 편집(또는 원본) BDF 를 사용자 PC 의 결과 폴더로 받아 두고, 다른 위치에 저장할 수 있게 한다.
  async finishWithBdf({ remotePath, localSub, label }) {
    this.step("download", "active");
    this.ui({ progress: null, busy: true, message: `${label} 받는 중...` });
    if (!remotePath) throw new Error(`${label} 경로를 서버가 알려 주지 않았습니다.`);
    const dest = path.join(this.localDir, localSub, baseName(remotePath));
    await downloadServerFile({ client: this.client, remotePath, destPath: dest });
    this.lastSavedPath = dest;
    this.log.info(`${label} 받음: ${dest}`);
    this.step("download", "done", dest);
    this.ui({ title: `${label}를 받았습니다`, busy: false, progress: 100, message: "",
      info: [{ label, value: dest }],
      actions: [
        { id: "open-folder", label: "폴더 열기" },
        { id: "save-as", label: "다른 위치에 저장…" },
        { id: "close", label: "닫기", primary: true },
      ] });
  }

  async saveAs() {
    if (!this.lastSavedPath) return;
    const r = await dialog.showSaveDialog(this.pw?.win || undefined, {
      title: "BDF 저장",
      defaultPath: path.join(app.getPath("downloads"), baseName(this.lastSavedPath)),
      filters: [{ name: "Nastran BDF", extensions: ["bdf"] }, { name: "모든 파일", extensions: ["*"] }],
    });
    if (r.canceled || !r.filePath) return;
    await fs.promises.copyFile(this.lastSavedPath, r.filePath);
    this.log.info(`다른 위치에 저장: ${r.filePath}`);
    this.lastSavedPath = r.filePath;
    this.ui({ info: [...(this.pw?.state.info || []), { label: "저장", value: r.filePath }] });
  }

  onStudioClosed() {
    this.log.info("Studio 창 닫힘");
  }

  // ── smoke: Studio 로드 후 8초 기다렸다가 결과를 남기고 종료 ──
  armSmoke(session) {
    session.win.webContents.once("did-finish-load", () => {
      this.log.info(`smoke: did-finish-load — ${SMOKE_WAIT_MS / 1000}초 대기`);
      setTimeout(async () => {
        // 화면을 사람이 못 보므로 DOM 으로 '모델이 열렸는가' 를 대신 확인한다(3D 캔버스·단계 이름 글자).
        try {
          const win = windowOfSession(session);
          // 렌더러가 응답하지 않으면 45초에서 끊는다(그때는 smoke 실패로 남는다).
          const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("DOM 확인 45초 초과")), 45000));
          session.smoke.dom = !win ? null : await Promise.race([timeout, win.webContents.executeJavaScript(`(() => {
            const text = document.body ? document.body.innerText : '';
            return {
              canvasCount: document.querySelectorAll('canvas').length,
              stageNames: ['Preprocess', 'ElementSplit', 'NodeMerge', 'Connectivity', 'RigidPostProc', 'Validation', 'Final']
                .filter((n) => text.includes(n)),
              textSample: text.replace(/\\s+/g, ' ').slice(0, 400),
            };
          })()`, true)]);
        } catch (e) {
          session.smoke.dom = { error: e.message };
        }
        this.finishSmoke({ stage: "studio", session });
      }, SMOKE_WAIT_MS);
    });
  }

  finishSmoke({ stage, error = null, session = null }) {
    if (this.smokeDone) return;
    this.smokeDone = true;
    const sm = session?.smoke || null;
    const win = session ? windowOfSession(session) : null;
    const report = {
      job: this.args.job,
      server: this.args.server,
      employee: this.args.employee,
      stage,
      error,
      windowTitle: win ? win.getTitle() : null,
      studioUrl: win ? win.webContents.getURL() : null,
      localDir: this.localDir,
      outputDir: this.outputDir,
      initialFolderCalls: sm?.initialFolderCalls ?? 0,
      jsonFiles: sm?.jsonFiles ?? null,
      jsonNames: sm?.jsonNames ?? [],
      consoleErrors: sm?.consoleErrors ?? [],
      consoleWarnings: sm?.consoleWarnings ?? 0,
      loadFailures: sm?.loadFailures ?? [],
      crashed: sm?.crashed ?? null,
      dom: sm?.dom ?? null,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      launcher: app.getVersion(),
      finishedAt: new Date().toISOString(),
    };
    report.ok = !error && !!sm && report.consoleErrors.length === 0 && report.loadFailures.length === 0
      && !report.crashed && (report.jsonFiles || 0) > 0
      && (report.dom?.canvasCount || 0) > 0 && (report.dom?.stageNames?.length || 0) > 0;
    const file = path.join(LOG_DIR, `smoke-${this.args.job}.json`);
    try { fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf-8"); } catch (e) { log.error(`smoke 기록 실패: ${e.message}`); }
    this.log.info(`smoke 결과: ok=${report.ok} json=${report.jsonFiles} 콘솔오류=${report.consoleErrors.length} 제목="${report.windowTitle}" → ${file}`);
    app.exit(report.ok ? 0 : 1);
  }
}

function startFlow(argv, source) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log.error(`인자 오류(${source}): ${e.message} — ${argv.join(" ")}`);
    if (flows.size === 0) exitCode = 2;
    if (argv.includes("--smoke") && flows.size === 0) { app.exit(2); return; }
    // 모달(dialog.showErrorBox)은 쓰지 않는다 — second-instance 처리 중에 띄우면 기존 실행기가 통째로 종료됐다(실측).
    const pw = new ProgressWindow({ onAction: (id) => { if (id === "logs") shell.openPath(LOG_DIR); else pw.close(); } });
    pw.set({ title: "실행 인자가 잘못됐습니다", subtitle: "", steps: [], busy: false, progress: null, message: "",
      error: e.message, info: [{ label: "로그 폴더", value: LOG_DIR }],
      actions: [{ id: "logs", label: "로그 폴더 열기" }, { id: "close", label: "닫기", primary: true }] });
    return;
  }
  const flow = new Flow(args);
  if (args.smoke) {
    setTimeout(() => { flow.log.error("smoke 전체 시간 초과"); flow.finishSmoke({ stage: "timeout", error: "smoke 시간 초과(30분)" }); }, SMOKE_TIMEOUT_MS).unref?.();
  }
  flow.run().catch((e) => flow.fail(null, e));
}

app.on("second-instance", (_event, commandLine, _cwd, additionalData) => {
  const argv = Array.isArray(additionalData?.argv) ? additionalData.argv.map(String) : commandLine.slice(1);
  log.info(`second-instance: ${argv.join(" ")}`);
  startFlow(argv, "second-instance");
});

app.on("window-all-closed", () => {
  if (busyCount > 0) return; // 편집 적용 진행 중 — 결과 창을 다시 띄운다
  log.info(`창이 모두 닫힘 → 종료(코드 ${exitCode})`);
  app.exit(exitCode);
});

process.on("uncaughtException", (e) => log.error(`uncaughtException: ${e?.stack || e}`));
process.on("unhandledRejection", (e) => log.error(`unhandledRejection: ${e?.stack || e}`));

app.whenReady().then(() => {
  log.info(`실행기 v${app.getVersion()} (Electron ${process.versions.electron}) 시작 — ${app.getPath("exe")}`);
  registerStudioIpc(log);
  startFlow(process.argv.slice(1), "first");
});
