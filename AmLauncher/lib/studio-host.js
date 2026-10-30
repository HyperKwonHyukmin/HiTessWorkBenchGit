// Studio 창 + Studio 가 부르는 workbenchAPI 의 main 쪽 처리.
//
// WorkBench electron/index.js 에서 옮김(사본 — 나중에 공용 모듈로 합칠 대상):
//   openStudio                    ← ipcMain "viewer:open" (창 옵션·제목 고정·배치·단축키·세션 등록/정리)
//   "viewer:pickFolder"           ← 같은 이름 핸들러
//   "viewer:getInitialFolder"     ← 같은 이름 핸들러
//   "viewer:writeFile"            ← 같은 이름 핸들러
//   "viewer:runModelBuilderSolve" ← 같은 이름 핸들러 (토큰은 메인 창 localStorage 대신 작업별 ServerClient)
//   "viewer:finalizeEditedModel"  ← 같은 이름 핸들러. 단 WorkBench 는 메인 창 페이지로 넘기지만
//                                   실행기는 lib/finalize.js 로 main 에서 직접 처리한다.
// 세션 규약(viewer-sessions.js): Studio 의 IPC 는 반드시 '보낸 창' 으로 세션을 찾고, 못 찾으면 거부한다.
"use strict";

const fs = require("fs");
const path = require("path");
const { BrowserWindow, ipcMain, dialog, screen } = require("electron");
const { ViewerSessionRegistry, sessionKeyOf } = require("./viewer-sessions");
const { readJsonFolderRecursive } = require("./install");
const { readBackendError } = require("./server-client");

const registry = new ViewerSessionRegistry();
let ipcRegistered = false;

const sessionFromEvent = (event) => registry.fromWebContentsId(event?.sender?.id);
const windowOfSession = (session) => registry.windowOf(session);
const noSessionError = () => ({ ok: false, error: "이 창의 Studio 세션을 찾지 못했습니다. 실행기를 다시 실행하세요." });

function registerStudioIpc(log) {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle("viewer:pickFolder", async (event) => {
    const target = windowOfSession(sessionFromEvent(event)) || undefined;
    const r = await dialog.showOpenDialog(target, { properties: ["openDirectory"] });
    if (r.canceled || r.filePaths.length === 0) return null;
    return await readJsonFolderRecursive(r.filePaths[0]);
  });

  ipcMain.handle("viewer:getInitialFolder", async (event) => {
    // 호출한 Studio 자신의 initialFolder 만 돌려준다(다른 Studio 의 폴더가 섞이지 않게).
    const session = sessionFromEvent(event);
    const folder = session?.initialFolder;
    if (!folder || !fs.existsSync(folder)) {
      session?.flow?.log.warn("getInitialFolder: 폴더 없음");
      if (session?.smoke) session.smoke.initialFolderCalls += 1;
      return null;
    }
    const r = await readJsonFolderRecursive(folder);
    session.flow?.log.info(`getInitialFolder: JSON ${r.files.length}개 (${folder})`);
    if (session.smoke) {
      session.smoke.initialFolderCalls += 1;
      session.smoke.jsonFiles = r.files.length;
      session.smoke.jsonNames = r.files.map((f) => f.name).sort();
    }
    return r;
  });

  ipcMain.handle("viewer:writeFile", async (_e, folderPath, fileName, content) => {
    try {
      if (!folderPath || !fileName) return { ok: false, error: "인자 누락" };
      const baseAbs = path.resolve(folderPath);
      const safeAbs = path.resolve(baseAbs, fileName);
      if (!safeAbs.startsWith(baseAbs)) return { ok: false, error: "경로 탈출 시도 차단" };
      fs.writeFileSync(safeAbs, content, "utf-8");
      log.info(`writeFile: ${safeAbs}`);
      return { ok: true, location: "folder", filePath: safeAbs };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("viewer:finalizeEditedModel", async (event, payload) => {
    try {
      const session = sessionFromEvent(event);
      if (!session) return noSessionError();
      const result = await session.flow.finalizeFromStudio(session, payload?.folderPath, payload?.request || {});
      // 성공 시 요청한 Studio 창만 닫는다(Studio 의 await 가 결과를 받은 직후 닫히도록) — WorkBench 와 같음.
      if (result?.ok) {
        setImmediate(() => {
          const win = windowOfSession(session);
          if (win) win.close();
        });
      }
      return result;
    } catch (e) {
      return { ok: false, error: e?.message || "예외 발생" };
    }
  });

  ipcMain.handle("viewer:runModelBuilderSolve", async (event, payload) => {
    try {
      const session = sessionFromEvent(event);
      if (!session) return noSessionError();
      return await runModelBuilderSolve(session, payload);
    } catch (e) {
      return { ok: false, error: e?.message || "예외 발생" };
    }
  });
}

async function runModelBuilderSolve(session, payload) {
  const flow = session.flow;
  const client = flow.client;
  const log = flow.log.child("solve");
  const bcs       = Array.isArray(payload?.bcs)       ? payload.bcs       : [];
  const loads     = Array.isArray(payload?.loads)     ? payload.loads     : [];
  const gravities = Array.isArray(payload?.gravities) ? payload.gravities : [];
  const loadCases = Array.isArray(payload?.loadCases) ? payload.loadCases : [];
  // Studio 모델 편집 — 실제 Nastran ID 로 해소된 삭제/추가 목록. 있으면 그대로 백엔드로 넘긴다.
  const edits = (payload && typeof payload.edits === "object" && payload.edits) ? payload.edits : null;

  // 서버측 output_dir(ModelFlow 빌드 산출 폴더). Studio 는 로컬 추출본만 알기에 solve 는 이 경로 기준이다.
  if (!session.outputDir) {
    return { ok: false, error: "서버측 output_dir 가 등록되지 않았습니다. 실행기를 다시 실행하세요." };
  }
  const bdfPath = (typeof payload?.bdfPath === "string" && payload.bdfPath.trim()) ? payload.bdfPath.trim() : "";

  const reqRes = await client.fetchAuthed("/api/analysis/modelbuilder/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employee_id: client.employeeId,
      work_dir: session.outputDir,
      bdf_path: bdfPath,
      bcs,
      loads,
      gravities,
      load_cases: loadCases,
      edits,
      source: "ModelBuilder-Solve",
    }),
  });
  if (!reqRes.ok) {
    const detail = await readBackendError(reqRes);
    const hint = reqRes.status === 404
      ? ` - ModelBuilder 구조해석 API가 해당 서버에 없습니다. 서버 주소(${client.serverUrl})가 최신 WorkBench 백엔드인지 확인하세요.`
      : "";
    return { ok: false, error: `백엔드 요청 실패: ${reqRes.status}${detail ? ` - ${detail}` : ""}${hint}` };
  }
  const reqBody = await reqRes.json();
  const jobId = reqBody.jobId || reqBody.job_id;
  if (!jobId) return { ok: false, error: "백엔드 응답에 jobId 가 없습니다." };
  log.info(`구조 해석 시작: job ${jobId}`);

  const sendProgress = (data) => {
    try {
      const win = windowOfSession(session);
      if (win) win.webContents.send("viewer:modelbuilder-structural-progress", { jobId, ...data });
    } catch { /* 창 닫힘 */ }
  };
  sendProgress({ status: "Pending", progress: 0, message: "큐 대기..." });

  // SOL 101 + 다중 SUBCASE 고려해 30분 (1.5s × 1200) 폴링
  for (let i = 0; i < 1200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const statusRes = await client.fetchAuthed(`/api/analysis/status/${jobId}`, { method: "GET" });
    if (!statusRes.ok) continue;
    const job = await statusRes.json();
    sendProgress({ status: job.status, progress: job.progress, message: job.message });

    if (job.status === "Success") {
      const resultInfo = job.project?.result_info || {};
      const resultPath = resultInfo.nastranResultJson || null;
      let resultContent = null;
      if (resultPath) {
        try {
          const dlRes = await client.fetchAuthed(`/api/download?filepath=${encodeURIComponent(resultPath)}`, { method: "GET" });
          if (!dlRes.ok) {
            const detail = await readBackendError(dlRes);
            return { ok: false, error: `결과 JSON 다운로드 실패: ${dlRes.status}${detail ? ` - ${detail}` : ""}`, job };
          }
          resultContent = JSON.parse(await dlRes.text());
        } catch (e) {
          return { ok: false, error: `결과 JSON 다운로드/파싱 실패: ${e.message}`, job };
        }
      }
      log.info(`구조 해석 완료: job ${jobId}`);
      return {
        ok: true,
        analysisId: job.project?.id ?? null,
        summary: resultInfo.summary ?? null,
        resultPath,
        result: resultContent,
        job,
      };
    }
    if (job.status === "Failed") {
      log.warn(`구조 해석 실패: job ${jobId} — ${job.message}`);
      return { ok: false, error: job.message || "ModelBuilder 구조 해석 실패", stderr: job.engine_log || "", job };
    }
  }
  return { ok: false, error: "시간 초과 (30분)" };
}

/**
 * Studio 창을 연다. 같은 모델(sourceKey = 서버 output_dir)의 창이 이미 있으면 그 창을 다시 쓴다.
 * @returns {object} session
 */
function openStudio({ flow, viewerDir, viewerId, initialFolder, outputDir, windowTitle, smoke }) {
  const indexPath = path.join(viewerDir, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error(`Studio 가 설치되지 않았습니다: ${indexPath}`);

  const sessionKey = sessionKeyOf(viewerId, outputDir);
  const session = {
    viewerId,
    sessionKey,
    win: null,
    flow,
    initialFolder: initialFolder ? path.resolve(initialFolder) : null,
    outputDir: outputDir || null,
    sourceKey: outputDir || null,
    windowTitle,
    smoke: smoke ? { consoleErrors: [], consoleWarnings: 0, jsonFiles: null, jsonNames: [], initialFolderCalls: 0, loadFailures: [], crashed: null } : null,
  };

  const existingWin = windowOfSession(registry.get(sessionKey));
  if (existingWin) {
    session.win = existingWin;
    registry.register(session, existingWin.webContents.id);
    existingWin.setTitle(windowTitle);
    if (existingWin.isMinimized()) existingWin.restore();
    if (!existingWin.isFullScreen()) existingWin.maximize();
    existingWin.focus();
    existingWin.webContents.reload();
    session.reused = true;
    return session;
  }

  const win = new BrowserWindow({
    show: false,
    frame: true,
    backgroundColor: "#0d0d1a",
    autoHideMenuBar: true,
    title: windowTitle,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "studio-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Studio 가 해상도를 스스로 보정한다. Electron 확대가 겹치지 않게 항상 100% 로 시작한다.
      zoomFactor: 1.0,
    },
  });
  session.win = win;
  registry.register(session, win.webContents.id);

  win.webContents.on("did-finish-load", () => { win.webContents.setZoomFactor(1.0); });
  // 창 제목이 렌더러의 <title> 로 덮이지 않게 고정 — 어느 모델인지 항상 보이게 한다.
  win.on("page-title-updated", (e) => {
    e.preventDefault();
    win.setTitle(registry.get(sessionKey)?.windowTitle || windowTitle);
  });
  // Studio 안에서 외부 페이지로 이동하거나 새 창을 여는 것을 막는다.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) e.preventDefault(); });

  // smoke: 콘솔 오류·로드 실패·렌더러 종료를 모은다.
  win.webContents.on("console-message", (...args) => {
    // Electron 35+ 는 (event) 하나에 level 문자열, 이전 버전은 (event, level 숫자, message, line, sourceId).
    const e = args[0];
    let level; let message; let source = "";
    if (e && typeof e.level === "string") { level = e.level; message = e.message; source = `${e.sourceId || ""}:${e.lineNumber || ""}`; }
    else { level = ["verbose", "info", "warning", "error"][args[1]] || "info"; message = args[2]; source = `${args[4] || ""}:${args[3] || ""}`; }
    if (level === "error") {
      flow.log.warn(`Studio 콘솔 오류: ${message} (${source})`);
      if (session.smoke) session.smoke.consoleErrors.push({ message: String(message).slice(0, 500), source });
    } else if (level === "warning" && session.smoke) {
      session.smoke.consoleWarnings += 1;
    }
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    flow.log.error(`Studio 로드 실패: ${code} ${desc} ${url}`);
    session.smoke?.loadFailures.push({ code, desc, url });
  });
  win.webContents.on("preload-error", (_e, p, err) => {
    flow.log.error(`Studio preload 오류: ${p} ${err?.message}`);
    session.smoke?.loadFailures.push({ code: "preload", desc: err?.message, url: p });
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    flow.log.error(`Studio 렌더러 종료: ${details?.reason} (${details?.exitCode})`);
    if (session.smoke) session.smoke.crashed = details?.reason || "gone";
  });

  win.once("ready-to-show", () => {
    // WorkBench 와 같이 최대화해서 연다. '이전 크기로' 복원했을 때 오른쪽 절반 + 계단식 배치.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = display.workArea;
    const halfW = Math.floor(wa.width / 2);
    const width = Math.max(halfW, Math.min(960, wa.width));
    const baseX = Math.min(wa.x + wa.width - width, wa.x + halfW);
    const others = registry.live().filter((s) => s.win !== win).length;
    const maxShift = Math.max(0, Math.min(halfW - 120, wa.height - 200));
    const shift = Math.min(others * 36, maxShift);
    win.setBounds({ x: Math.max(wa.x, baseX - shift), y: wa.y + shift, width, height: Math.max(400, wa.height - shift) });
    win.maximize();
    win.show();
    win.focus();
  });

  // 단축키: F11 전체 화면 · Esc 전체 화면 해제 · Ctrl+W 닫기
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key;
    if (key === "F11") { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
    else if (key === "Escape" && win.isFullScreen()) { win.setFullScreen(false); event.preventDefault(); }
    else if (input.control && (key === "w" || key === "W")) { win.close(); event.preventDefault(); }
  });

  // 창이 닫히면 세션·역맵을 함께 정리한다(webContents.id 재사용 시 죽은 세션으로 해소되지 않게).
  const closedId = win.webContents.id;
  win.on("closed", () => {
    registry.remove(sessionKey, closedId, win);
    flow.onStudioClosed?.(session);
  });

  win.loadFile(indexPath);
  return session;
}

function liveStudioCount() { return registry.live().length; }

module.exports = { registerStudioIpc, openStudio, liveStudioCount, windowOfSession };
