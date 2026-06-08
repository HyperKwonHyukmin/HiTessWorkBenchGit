const { app, BrowserWindow, screen, ipcMain, shell, session, dialog, net } = require("electron");
const path    = require("path");
const fs      = require("fs");
const http    = require("http");
const https   = require("https");
const os      = require("os");
const crypto  = require("crypto");
const { spawn } = require("child_process");

// 앱 이름 — Studio 등 자식 BrowserWindow 가 window.alert()/confirm() 호출 시
// 다이얼로그 제목으로 사용됨. 미설정 시 개발 모드 기본값 'electron-app' 이 노출되므로,
// 패키징 여부와 무관하게 일관된 브랜드명을 강제 설정한다.
// userData 폴더 경로(viewers 캐시 등)도 이 이름을 따라 결정됨.
app.setName("HiTESS WorkBench");

let mainWindow;
let viewerWindow = null;
// 현재 viewerWindow 에 로드된 viewerId — 다른 Studio 로 전환 시 reload 가 아니라 loadFile 을
// 다시 호출해야 한다 (reload 는 이전 URL 을 유지하므로 잘못된 Studio 가 보이는 버그가 있음).
let viewerCurrentId = null;
// viewer:getInitialFolder 가 호출될 때 반환할 절대경로(보통 jsonPath 의 디렉터리)
let viewerInitialFolder = null;
// viewer:runUnitStructural 가 백엔드에 전달할 GroupModuleUnit Analysis.id (DB record).
// viewer:open 에서 등록되며, viewer 창이 닫혀도 다음 viewer:open 이 덮어쓸 때까지 유지된다.
let viewerParentAnalysisId = null;
// viewer IPC 가 사용할 WorkBench 백엔드 URL. Studio 오픈 시점의 프론트 API_BASE_URL 을
// 전달받아 Electron main process 의 별도 fallback 과 drift 되지 않게 한다.
let viewerServerUrl = null;
// viewer:runMooringStructural 가 백엔드에 전달할 서버측 output_dir(원본 BDF 보유 userConnection out 폴더).
// MooringFittingStudio 는 로컬 추출 폴더만 알기에, solve 는 이 서버 경로 기준으로 수행된다.
let viewerOutputDir = null;

function createWindow() {
  // 기준 해상도(1920px) 대비 현재 화면 비율로 zoomFactor 자동 계산
  // 예) 1280px 화면 → 0.80, 1600px → 0.90, 1920px 이상 → 1.00
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const REFERENCE_WIDTH = 1920;
  const zoomFactor = Math.min(Math.max(screenW / REFERENCE_WIDTH, 0.70), 1.0);

  // 창 크기도 화면을 벗어나지 않도록 상한 설정 (여백 40px)
  const winWidth  = Math.min(1280, screenW - 40);
  const winHeight = Math.min(1050, screenH - 40);

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 1024,
    minHeight: 760,
    title: "HiTESS WorkBench",
    frame: true,
    backgroundColor: '#002554', // 초기 로딩 색상
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      zoomFactor: zoomFactor,  // 해상도 비례 자동 축소
    },
    show: false, // 준비될 때까지 숨김
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.ico")
  });

  // [핵심 수정] 개발 모드 vs 배포 모드 구분
  // packager로 빌드된 앱은 app.isPackaged가 true가 됩니다.
  if (app.isPackaged) {
    // 배포 모드: 빌드된 index.html 파일 로드
    // dist_electron/.../resources/app/frontend/dist/index.html 경로를 찾습니다.
    mainWindow.loadFile(path.join(__dirname, "../frontend/dist/index.html"));
  } else {
    // 개발 모드: localhost 서버 로드
    mainWindow.loadURL("http://localhost:5173");
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
    // 개발 모드에서만 개발자 도구 자동 오픈 (Network/Console 디버깅용)
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("open-external", (_, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      console.warn("[Security] open-external blocked non-http protocol:", parsed.protocol);
      return;
    }
    shell.openExternal(url);
  } catch {
    console.warn("[Security] open-external blocked invalid URL:", url);
  }
});

// ──────────────────────────────────────────────────────────────
// 외부/별도 웹앱을 WorkBench '내부'의 별도 창(BrowserWindow)으로 띄운다.
// shell.openExternal(시스템 브라우저) 과 달리, WorkBench 에 속한 프로그램처럼
// 보이도록 자식 창으로 연다. payload = { url, title? }
// URL 별로 창을 1개만 유지(재호출 시 기존 창 포커스) → 중복 창 방지.
// 보안: http/https 만 허용. 외부 웹앱이므로 WorkBench preload(IPC)는 주입하지 않는다(격리).
// ──────────────────────────────────────────────────────────────
const appWindows = new Map(); // url -> BrowserWindow

ipcMain.handle("open-app-window", async (_e, payload = {}) => {
  const { url, title } = payload || {};
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "잘못된 URL 입니다." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "http/https 주소만 열 수 있습니다." };
  }

  // 이미 열린 창이 있으면 재사용(포커스)
  const existing = appWindows.get(url);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return { ok: true, reused: true };
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1280, screenW - 80),
    height: Math.min(900, screenH - 80),
    minWidth: 800,
    minHeight: 600,
    title: title || "HiTESS WorkBench",
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    backgroundColor: "#002554",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.ico"),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  appWindows.set(url, win);
  win.once("ready-to-show", () => { win.show(); win.focus(); });
  win.on("closed", () => { appWindows.delete(url); });

  // 창 내부에서 새 창 요청(window.open/target=_blank) 시 → 시스템 브라우저로 위임(무한 자식창 방지)
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    try {
      const p = new URL(u);
      if (p.protocol === "http:" || p.protocol === "https:") shell.openExternal(u);
    } catch { /* 무시 */ }
    return { action: "deny" };
  });

  try {
    await win.loadURL(url);
  } catch {
    // 외부 서버 미기동 등 로드 실패 시에도 창은 떠 있게 둔다(연결 실패 화면 표시).
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }
  return { ok: true };
});

// 개발자 런북에서 "탐색기 열기" 액션용. 파일이면 부모 폴더가 선택된 채 열림,
// 폴더면 해당 폴더가 열림. UNC/환경변수(%APPDATA% 등) 도 그대로 통과.
// 보안: 외부 URL 은 open-external 로 분리되어 있고, 여기서는 로컬 파일시스템만 허용.
ipcMain.handle("shell:openPath", async (_, rawPath) => {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return { ok: false, error: "경로가 비어 있습니다." };
  }
  let resolved = rawPath.trim();
  // %ENV% 확장 (Windows)
  resolved = resolved.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);

  try {
    let stat = null;
    try { stat = fs.statSync(resolved); } catch {}

    // 파일이면 탐색기에서 해당 항목 선택, 폴더/UNC/존재 안 함은 openPath 시도
    if (stat && stat.isFile()) {
      shell.showItemInFolder(resolved);
      return { ok: true };
    }
    const errMsg = await shell.openPath(resolved);
    if (errMsg) return { ok: false, error: errMsg };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle("download-client", (event, url) => {
  return new Promise((resolve, reject) => {
    session.defaultSession.once("will-download", (_, item) => {
      item.on("updated", (_, state) => {
        if (state === "progressing" && mainWindow) {
          const received = item.getReceivedBytes();
          const total    = item.getTotalBytes();
          const progress = total > 0 ? Math.round((received / total) * 100) : -1;
          mainWindow.webContents.send("download-progress", { progress, received, total });
        }
      });
      item.once("done", (_, state) => {
        if (state === "completed") {
          const savePath = item.getSavePath();
          if (mainWindow) mainWindow.webContents.send("download-progress", { progress: 100, done: true, savePath });
          resolve({ success: true, savePath });
        } else {
          if (mainWindow) mainWindow.webContents.send("download-progress", { progress: -1, done: true, error: state });
          reject(new Error(`다운로드 실패: ${state}`));
        }
      });
    });
    mainWindow.webContents.downloadURL(url);
  });
});

// Download Center: ServerIP.txt 를 사용자 PC 의 C:\temp 에 바로 기록한다.
// 레거시/외부 프로그램이 시작 시 C:\temp\ServerIP.txt 를 읽어 서버 주소를 찾기 때문에,
// 사용자가 한 번의 클릭으로 최신 서버 주소를 적용할 수 있게 한다.
// 보안: 대상 폴더(C:\temp)와 파일명(ServerIP.txt)이 모두 고정이라 경로 탈출 여지가 없다.
ipcMain.handle("place-server-ip", async (_event, payload) => {
  try {
    const content = payload?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, error: "서버 주소 내용이 비어 있습니다." };
    }
    const tempDir = "C:\\temp";
    const targetPath = path.join(tempDir, "ServerIP.txt");
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(targetPath, content, "utf-8");
    return { ok: true, path: targetPath };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

function getPreferencesPath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

function readPreferences() {
  const preferencesPath = getPreferencesPath();
  try {
    if (!fs.existsSync(preferencesPath)) return {};
    const raw = fs.readFileSync(preferencesPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    console.warn("[preferences] read failed:", e?.message || e);
    return {};
  }
}

function writePreferences(nextPreferences) {
  const preferencesPath = getPreferencesPath();
  const dir = path.dirname(preferencesPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${preferencesPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(nextPreferences, null, 2), "utf-8");
  fs.renameSync(tmpPath, preferencesPath);
}

function normalizeFavorites(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

ipcMain.handle("preferences:get", () => {
  const preferences = readPreferences();
  return {
    ok: true,
    preferences,
    path: getPreferencesPath(),
  };
});

ipcMain.handle("preferences:set", (_event, payload) => {
  try {
    const current = readPreferences();
    const next = { ...current };

    if (payload && Object.prototype.hasOwnProperty.call(payload, "favorites")) {
      next.favorites = normalizeFavorites(payload.favorites);
      next.updatedAt = new Date().toISOString();
    }

    writePreferences(next);
    return {
      ok: true,
      preferences: next,
      path: getPreferencesPath(),
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      path: getPreferencesPath(),
    };
  }
});

ipcMain.handle("start-self-update", (event, payload) => {
  return new Promise((resolve, reject) => {
    // 호환성: 구버전은 url 문자열 하나만 넘김. 신버전은 { url, headers } 객체.
    const url = typeof payload === "string" ? payload : payload?.url;
    const headers = (typeof payload === "object" && payload?.headers) || {};
    if (!url) { reject(new Error("update URL이 비어있습니다.")); return; }

    // 항상 temp 폴더에 저장 — 쓰기 권한 문제 없음
    let tmpPath = path.join(os.tmpdir(), "HiTESS-WorkBench-update.exe");

    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(url, { headers }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`서버 오류: HTTP ${response.statusCode}`));
        return;
      }

      // 서버가 보내는 실제 파일명 사용 (예: HiTESS-WorkBench-v0.0.15.exe)
      const disposition = response.headers["content-disposition"] || "";
      const nameMatch = disposition.match(/filename="?([^";\r\n]+)"?/i);
      if (nameMatch) tmpPath = path.join(os.tmpdir(), nameMatch[1].trim());

      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}

      const total = parseInt(response.headers["content-length"] || "0", 10);
      let received = 0;
      const fileStream = fs.createWriteStream(tmpPath);

      response.on("data", (chunk) => {
        received += chunk.length;
        fileStream.write(chunk);
        const progress = total > 0 ? Math.round((received / total) * 100) : -1;
        if (mainWindow)
          mainWindow.webContents.send("download-progress", { progress, received, total, done: false });
      });

      response.on("end", () => {
        fileStream.end();
        fileStream.on("finish", () => {
          // 파일이 실제로 존재하는지 확인
          if (!fs.existsSync(tmpPath)) {
            reject(new Error(`다운로드 파일을 찾을 수 없습니다: ${tmpPath}`));
            return;
          }

          if (mainWindow)
            mainWindow.webContents.send("download-progress", { progress: 100, done: true });

          if (!app.isPackaged) {
            resolve({ success: true, devMode: true });
            return;
          }

          const { spawn } = require("child_process");
          // portable EXE는 실행 시 temp에 압축 해제 후 동작하므로
          // process.execPath는 temp 경로를 가리킴.
          // electron-builder가 설정한 PORTABLE_EXECUTABLE_FILE이 실제 원본 EXE 경로.
          const currentExe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
          const vbsPath = path.join(os.tmpdir(), "hitess_update_helper.vbs");
          const vbs = [
            "WScript.Sleep 2000",
            "Dim oldPath, tmpPath, destPath",
            "oldPath = WScript.Arguments(0)",
            "tmpPath = WScript.Arguments(1)",
            "Set fso = CreateObject(\"Scripting.FileSystemObject\")",
            "destPath = fso.BuildPath(fso.GetParentFolderName(oldPath), fso.GetFileName(tmpPath))",
            "fso.CopyFile tmpPath, destPath, True",
            "If fso.FileExists(oldPath) Then",
            "  On Error Resume Next",
            "  fso.DeleteFile oldPath, True",
            "  On Error GoTo 0",
            "End If",
            "Set shell = CreateObject(\"WScript.Shell\")",
            "shell.Run Chr(34) & destPath & Chr(34)",
            "On Error Resume Next",
            "fso.DeleteFile tmpPath, True",
            "WScript.Quit",
          ].join("\r\n");
          fs.writeFileSync(vbsPath, vbs, "utf8");

          const child = spawn("wscript.exe", [vbsPath, currentExe, tmpPath], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
          child.unref();

          resolve({ success: true });
          setTimeout(() => app.quit(), 500);
        });
        fileStream.on("error", (err) => {
          try { fs.unlinkSync(tmpPath); } catch {}
          reject(err);
        });
      });

      response.on("error", (err) => {
        fileStream.destroy();
        try { fs.unlinkSync(tmpPath); } catch {}
        reject(err);
      });
    });

    request.setTimeout(120000, () => {
      request.destroy();
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(new Error("다운로드 타임아웃 (120초)"));
    });

    request.on("error", (err) => {
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(err);
    });
  });
});

ipcMain.handle("get-intro-page-html", (_evt, which) => {
  // 대시보드 두 배너의 매핑:
  //   'platform'  → hitess-introduction.html  (Discover HiTESS 버튼)
  //   'workbench' → hitess-platform.html      (HiTESS WorkBench 버튼)
  const fileName = which === "workbench" ? "hitess-platform.html" : "hitess-introduction.html";
  // 패키지된 .exe 는 process.resourcesPath 아래 IntroductionPage/ 를 우선 시도하고,
  // 실패 시 app.asar 내부(레거시 빌드 호환)로 폴백. dev 모드는 워크스페이스 루트.
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "IntroductionPage", fileName),
        path.join(__dirname, "../IntroductionPage/", fileName),
      ]
    : [path.join(__dirname, "../IntroductionPage/", fileName)];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf-8");
    } catch {}
  }
  return null;
});

// 지정 폴더의 CSV 파일 목록 반환
ipcMain.handle("list-dir-csvs", (_, dirPath) => {
  try {
    const resolvedPath = path.resolve(dirPath);
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) return [];
    return fs.readdirSync(resolvedPath)
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .map(f => ({ name: f, filePath: path.join(resolvedPath, f) }));
  } catch {
    return [];
  }
});

// 지정 경로의 파일 내용을 ArrayBuffer로 반환 (CSV 파일만 허용)
ipcMain.handle("read-file-buffer", (_, filePath) => {
  try {
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.toLowerCase().endsWith('.csv')) return null;
    const buf = fs.readFileSync(resolvedPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
  }
});

// ============================================================
// Viewer 라이프사이클 (다운로드 → 압축 해제 → 풀스크린 보조 창 오픈)
// ============================================================

function getViewersRoot() {
  return path.join(app.getPath("userData"), "viewers");
}

function getViewerDir(viewerId) {
  // viewerId 는 a-z0-9-_ 만 허용 — 디렉터리 탈출 방지
  const safe = String(viewerId).replace(/[^a-z0-9_-]/gi, "");
  return path.join(getViewersRoot(), safe);
}

// 폴더(재귀)에서 .json 파일을 모두 읽어 [{name, content}] 형태로 반환
async function readJsonFolderRecursive(folderPath) {
  const files = [];
  const stack = [folderPath];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const readPromises = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.toLowerCase().endsWith(".json")) {
        readPromises.push(
          fs.promises.readFile(full, "utf-8")
            .then(content => files.push({ name: entry.name, content }))
            .catch(() => { /* 개별 파일 오류는 스킵 */ })
        );
      }
    }
    await Promise.all(readPromises);
  }
  return { folderPath, files };
}

// Electron net 모듈 기반 다운로드 (Chromium 네트워크 스택 — 시스템 프록시 자동 적용,
// FastAPI/uvicorn keep-alive/응답 종료 비표준에도 관대함)
function downloadToFile(url, destPath, viewerId, totalRangeStart = 0, totalRangePct = 90, headers = {}) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(destPath);
    let settled = false;
    const settle = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    const request = net.request({ url, method: "GET", redirect: "follow", useSessionCookies: false });
    for (const [k, v] of Object.entries(headers || {})) {
      try { request.setHeader(k, String(v)); } catch {}
    }

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        stream.destroy();
        try { fs.unlinkSync(destPath); } catch {}
        settle(reject, new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const total = parseInt(response.headers["content-length"] || "0", 10);
      let received = 0;

      response.on("data", (chunk) => {
        received += chunk.length;
        stream.write(chunk);
        if (mainWindow && total > 0) {
          const dlPct = (received / total) * totalRangePct;
          mainWindow.webContents.send("viewer:install-progress", {
            viewerId,
            phase: "downloading",
            progress: Math.round(totalRangeStart + dlPct),
            received,
            total,
          });
        }
      });
      response.on("end", () => {
        stream.end();
        stream.on("finish", () => settle(resolve));
        stream.on("error", (e) => settle(reject, e));
      });
      response.on("error", (e) => {
        stream.destroy();
        settle(reject, e instanceof Error ? e : new Error(String(e)));
      });
      response.on("aborted", () => {
        stream.destroy();
        settle(reject, new Error("response aborted"));
      });
    });
    request.on("error", (e) => {
      stream.destroy();
      settle(reject, e instanceof Error ? e : new Error(String(e)));
    });
    request.on("abort", () => {
      stream.destroy();
      settle(reject, new Error("request aborted"));
    });
    request.end();

    // 120초 타임아웃
    setTimeout(() => {
      if (!settled) {
        try { request.abort(); } catch {}
      }
    }, 120000);
  });
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(filePath);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}

// Windows 내장 PowerShell Expand-Archive 로 zip 풀기 (외부 의존성 0).
// Windows 의 tar.exe(bsdtar) 는 'C:' 를 원격 호스트로 오인하는 이슈가 있어 PowerShell 사용.
function extractZipWithTar(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    // PowerShell single-quoted 문자열 escape: ' → ''
    const esc = (s) => String(s).replace(/'/g, "''");
    const cmd = `Expand-Archive -LiteralPath '${esc(zipPath)}' -DestinationPath '${esc(destDir)}' -Force`;
    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
      { windowsHide: true }
    );
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Expand-Archive 종료 코드 ${code}: ${stderr.trim()}`));
    });
    proc.on("error", reject);
  });
}

// 1) 설치 여부 + manifest 반환
ipcMain.handle("viewer:check-installed", (_e, viewerId) => {
  try {
    const dir = getViewerDir(viewerId);
    const manifestPath = path.join(dir, "manifest.json");
    const indexPath    = path.join(dir, "index.html");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) {
      return { installed: false, dir };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    return { installed: true, manifest, dir };
  } catch (e) {
    return { installed: false, error: e.message };
  }
});

// 2) 다운로드 + 해시 검증 + 압축 해제
ipcMain.handle("viewer:install", async (_e, payload) => {
  const { viewerId, downloadUrl, uncPath, expectedSha256 } = payload || {};
  if (!viewerId || (!downloadUrl && !uncPath)) {
    return { ok: false, error: "viewerId/downloadUrl/uncPath 누락" };
  }
  const tmpZip = path.join(app.getPath("temp"), `${viewerId}-${Date.now()}.zip`);
  const targetDir = getViewerDir(viewerId);

  try {
    if (mainWindow) {
      mainWindow.webContents.send("viewer:install-progress", {
        viewerId, phase: "starting", progress: 0,
      });
    }

    // 우선순위: UNC 직접 복사 (회사 DRM/프록시가 HTTP 응답을 변조하는 환경 우회)
    //          → 실패 시 HTTP fallback
    let usedSource = null;
    let lastErr = null;

    if (uncPath) {
      try {
        if (mainWindow) {
          mainWindow.webContents.send("viewer:install-progress", {
            viewerId, phase: "downloading", progress: 10,
          });
        }
        // fs.copyFile 은 Windows UNC 경로를 그대로 받아들임.
        // 큰 파일도 OS 의 CopyFile2 syscall 로 효율적으로 복사.
        await fs.promises.copyFile(uncPath, tmpZip);
        usedSource = "unc";
        if (mainWindow) {
          mainWindow.webContents.send("viewer:install-progress", {
            viewerId, phase: "downloading", progress: 90,
          });
        }
      } catch (e) {
        lastErr = e;
        console.warn(`[viewer:install] UNC copy 실패, HTTP 로 폴백: ${e.message}`);
      }
    }

    if (usedSource === null && downloadUrl) {
      try {
        await downloadToFile(downloadUrl, tmpZip, viewerId, 0, 90);
        usedSource = "http";
      } catch (e) {
        lastErr = e;
      }
    }

    if (usedSource === null) {
      throw new Error(`다운로드 실패 (UNC/HTTP 모두): ${lastErr?.message || "원인 불명"}`);
    }

    // 해시 검증
    if (expectedSha256) {
      const actual = await sha256OfFile(tmpZip);
      if (actual.toLowerCase() !== String(expectedSha256).toLowerCase()) {
        try { fs.unlinkSync(tmpZip); } catch {}
        throw new Error(
          `SHA256 불일치 — expected ${expectedSha256}, got ${actual} (source: ${usedSource}). ` +
          `회사 DRM/프록시가 ${usedSource === "unc" ? "UNC 복사" : "HTTP 다운로드"} 도중 zip 을 변조한 것으로 추정됩니다.`
        );
      }
    }
    if (mainWindow) {
      mainWindow.webContents.send("viewer:install-progress", {
        viewerId, phase: "extracting", progress: 95,
      });
    }

    // 기존 폴더 정리 후 재생성
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });

    // 압축 해제
    await extractZipWithTar(tmpZip, targetDir);

    // 임시 zip 정리
    try { fs.unlinkSync(tmpZip); } catch {}

    // manifest.json / index.html 검증
    const manifestPath = path.join(targetDir, "manifest.json");
    const indexPath    = path.join(targetDir, "index.html");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) {
      throw new Error("압축 해제 후 manifest.json 또는 index.html 발견 안 됨");
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    if (mainWindow) {
      mainWindow.webContents.send("viewer:install-progress", {
        viewerId, phase: "completed", progress: 100,
      });
    }
    return { ok: true, dir: targetDir, manifest };
  } catch (e) {
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch {}
    if (mainWindow) {
      mainWindow.webContents.send("viewer:install-progress", {
        viewerId, phase: "failed", progress: -1, error: e.message,
      });
    }
    return { ok: false, error: e.message };
  }
});

// 2.5) 결과 폴더 경로가 사용자 PC 에서 직접 fs.readdir 가능한지 검사
//      (dev: 같은 PC 면 true, production: 백엔드가 다른 머신이면 false)
ipcMain.handle("viewer:checkPathAccess", async (_e, payload) => {
  const { path: p } = payload || {};
  if (!p || typeof p !== "string") return { accessible: false };
  try {
    const stat = fs.statSync(p);
    return { accessible: stat.isDirectory() };
  } catch {
    return { accessible: false };
  }
});

// 2.6) 백엔드 result-zip 을 다운로드하여 사용자 PC 로컬 temp 에 압축 해제.
//      Studio 의 initialFolder 로 사용할 로컬 경로를 반환.
ipcMain.handle("viewer:fetchResultDir", async (_e, payload) => {
  const { downloadUrl, jobId, headers } = payload || {};
  if (!downloadUrl || !jobId) {
    return { ok: false, error: "downloadUrl/jobId 누락" };
  }

  const tmpZip   = path.join(app.getPath("temp"), `result-${jobId}-${Date.now()}.zip`);
  const targetDir = path.join(app.getPath("userData"), "results", String(jobId));

  try {
    if (mainWindow) {
      mainWindow.webContents.send("viewer:install-progress", {
        viewerId: "result", phase: "starting", progress: 0,
      });
    }

    await downloadToFile(downloadUrl, tmpZip, "result", 0, 90, headers || {});

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });

    await extractZipWithTar(tmpZip, targetDir);
    try { fs.unlinkSync(tmpZip); } catch {}

    if (mainWindow) {
      mainWindow.webContents.send("viewer:install-progress", {
        viewerId: "result", phase: "completed", progress: 100,
      });
    }
    return { ok: true, dir: targetDir };
  } catch (e) {
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch {}
    if (mainWindow) {
      mainWindow.webContents.send("viewer:install-progress", {
        viewerId: "result", phase: "failed", progress: -1, error: e.message,
      });
    }
    return { ok: false, error: e.message };
  }
});

// 2.7) 사용자 PC 로컬 파일을 읽어 Uint8Array 로 반환 (apply-edit 업로드용).
//      보안: app.getPath("userData")/"temp" 하위 파일만 허용.
ipcMain.handle("viewer:readLocalFile", async (_e, payload) => {
  const { filePath } = payload || {};
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, error: "filePath 누락" };
  }
  const userData = path.normalize(app.getPath("userData"));
  const tempDir  = path.normalize(app.getPath("temp"));
  const norm     = path.normalize(filePath);
  if (!norm.startsWith(userData) && !norm.startsWith(tempDir)) {
    return { ok: false, error: "허용되지 않은 경로" };
  }
  try {
    const buf = await fs.promises.readFile(norm);
    return { ok: true, data: new Uint8Array(buf), size: buf.byteLength };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 3) 풀스크린 보조 BrowserWindow 로 viewer 오픈
ipcMain.handle("viewer:open", async (_e, payload) => {
  const { viewerId, initialFolder, parentAnalysisId, serverUrl, outputDir } = payload || {};
  if (!viewerId) return { ok: false, error: "viewerId 누락" };

  const dir = getViewerDir(viewerId);
  const indexPath = path.join(dir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return { ok: false, error: `viewer 미설치: ${viewerId}` };
  }

  // viewer:getInitialFolder 가 사용
  viewerInitialFolder = initialFolder ? path.resolve(initialFolder) : null;
  // viewer:runUnitStructural 가 사용 — null 이면 그 IPC 가 거부 응답
  const parsedParentId = Number(parentAnalysisId);
  viewerParentAnalysisId = Number.isFinite(parsedParentId) && parsedParentId > 0 ? parsedParentId : null;
  viewerServerUrl = typeof serverUrl === "string" && serverUrl.trim()
    ? serverUrl.trim().replace(/\/$/, "")
    : null;
  // MooringFittingStudio 구조해석용 서버측 out 폴더(원본 BDF 위치). 없으면 null → 해당 IPC 거부.
  viewerOutputDir = typeof outputDir === "string" && outputDir.trim() ? outputDir.trim() : null;

  if (viewerWindow && !viewerWindow.isDestroyed()) {
    viewerWindow.focus();
    if (viewerCurrentId !== viewerId) {
      // 다른 Studio 로 전환 — 새 index.html 로드 (reload 는 이전 URL 유지하므로 사용 X)
      viewerWindow.loadFile(indexPath);
      viewerCurrentId = viewerId;
    } else {
      // 같은 Studio 재오픈 — initialFolder 등 갱신을 위해 reload
      viewerWindow.webContents.reload();
    }
    return { ok: true, reused: true };
  }

  viewerWindow = new BrowserWindow({
    // parent 미설정: Windows에서 child window가 parent를 비활성화하는 OS 동작 방지.
    // 독립 창으로 두어 WorkBench와 상호 작용 가능.
    show: false,                     // ready-to-show 까지 숨김 (깜빡임 방지)
    frame: true,                     // OS 표준 타이틀바 (최소화/최대화/닫기 버튼 살림)
    backgroundColor: "#0d0d1a",
    autoHideMenuBar: true,
    title: "HiTess Model Viewer",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  viewerWindow.loadFile(indexPath);
  viewerCurrentId = viewerId;

  viewerWindow.once("ready-to-show", () => {
    // 화면 우측 절반에 배치 — WorkBench 본체(좌측)와 Studio(우측)를 동시에 볼 수 있도록.
    // 사용자가 이후 최대화/직접 리사이즈하면 OS 표준 동작에 따라 그대로 적용됨.
    const wa = screen.getPrimaryDisplay().workArea;
    const halfW = Math.floor(wa.width / 2);
    viewerWindow.setBounds({ x: wa.x + halfW, y: wa.y, width: halfW, height: wa.height });
    viewerWindow.show();
    viewerWindow.focus();
  });

  // 키보드 단축키:
  //   F11        → 풀스크린 토글
  //   Esc        → 풀스크린 해제 (창모드일 땐 무시)
  //   Ctrl+W     → 창 닫기
  //   Ctrl+Shift+I (개발 모드) → DevTools 토글
  viewerWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key;

    if (key === "F11") {
      viewerWindow.setFullScreen(!viewerWindow.isFullScreen());
      event.preventDefault();
    } else if (key === "Escape" && viewerWindow.isFullScreen()) {
      viewerWindow.setFullScreen(false);
      event.preventDefault();
    } else if (input.control && (key === "w" || key === "W")) {
      viewerWindow.close();
      event.preventDefault();
    }
  });

  viewerWindow.on("closed", () => { viewerWindow = null; viewerCurrentId = null; });

  // 개발 모드에서는 viewer 창 디버깅 도구 자동 오픈
  if (!app.isPackaged) {
    viewerWindow.webContents.once("did-finish-load", () => {
      try { viewerWindow.webContents.openDevTools({ mode: "detach" }); } catch {}
    });
  }
  return { ok: true };
});

ipcMain.handle("viewer:close", () => {
  if (viewerWindow && !viewerWindow.isDestroyed()) {
    viewerWindow.close();
  }
  return { ok: true };
});

// ── viewer 측 host adapter (window.workbenchAPI) ─────────────

ipcMain.handle("viewer:pickFolder", async () => {
  const target = (viewerWindow && !viewerWindow.isDestroyed()) ? viewerWindow : mainWindow;
  const r = await dialog.showOpenDialog(target, { properties: ["openDirectory"] });
  if (r.canceled || r.filePaths.length === 0) return null;
  return await readJsonFolderRecursive(r.filePaths[0]);
});

ipcMain.handle("viewer:getInitialFolder", async () => {
  if (!viewerInitialFolder) return null;
  if (!fs.existsSync(viewerInitialFolder)) return null;
  return await readJsonFolderRecursive(viewerInitialFolder);
});

// ── Studio "최종 모델 출력" → workbench 자동 처리 ────────────────────
// Studio 가 _edit.json 을 folderPath 에 쓴 직후 호출.
// main 이 mainWindow 렌더러로 작업을 디스패치 (POST /apply-edit + 폴링 + Edit 탭 활성화),
// 결과를 받아 Studio 에 { ok, error } 로 반환. 성공 시 viewer 창 자동 종료.
const _pendingFinalizeReqs = new Map();   // requestId → resolve

// Keep this in sync with frontend/src/config.js DEFAULT_API_BASE_URL.
// The viewer IPC bridge runs in Electron main process and cannot import the
// frontend module, so it needs the same fallback here for users who have not
// saved a custom server_url in localStorage.
const DEFAULT_BACKEND_BASE_URL = "http://10.14.42.145:9091";

async function getWorkbenchRuntimeConfig() {
  const defaultServerUrl = viewerServerUrl || DEFAULT_BACKEND_BASE_URL;
  const fallback = { serverUrl: defaultServerUrl, token: "", employeeId: "" };
  if (!mainWindow || mainWindow.isDestroyed()) return fallback;

  try {
    const raw = await mainWindow.webContents.executeJavaScript(`
      (() => {
        let employeeId = '';
        try {
          const u = JSON.parse(localStorage.getItem('user') || '{}');
          employeeId = u.employee_id || u.employeeId || '';
        } catch {}
        return JSON.stringify({
          serverUrl: localStorage.getItem('server_url') || '',
          token: localStorage.getItem('session_token') || '',
          employeeId
        });
      })()
    `, true);
    const cfg = JSON.parse(raw || "{}");
    return {
      serverUrl: String(cfg.serverUrl || viewerServerUrl || DEFAULT_BACKEND_BASE_URL).replace(/\/$/, ""),
      token: String(cfg.token || ""),
      employeeId: String(cfg.employeeId || ""),
    };
  } catch (e) {
    console.warn("[viewer] runtime config read failed:", e?.message || e);
    return fallback;
  }
}

async function refreshWorkbenchSession(serverUrl, employeeId) {
  if (!mainWindow || mainWindow.isDestroyed() || !employeeId) return "";

  const res = await fetch(`${serverUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employee_id: employeeId }),
  });
  if (!res.ok) return "";

  const body = await res.json();
  const nextToken = String(body?.token || "");
  if (!nextToken) return "";

  const user = { ...body };
  delete user.token;
  await mainWindow.webContents.executeJavaScript(`
      JSON.stringify({
        ok: (() => {
          localStorage.setItem('session_token', ${JSON.stringify(nextToken)});
          localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
          localStorage.setItem('user_login_at', String(Date.now()));
          localStorage.setItem('user_last_active', String(Date.now()));
          return true;
        })()
      })
    `, true);

  return nextToken;
}

async function fetchWithSessionRefresh(url, optionsOrFactory = {}, runtimeConfig = null) {
  const cfg = runtimeConfig || await getWorkbenchRuntimeConfig();
  const makeOptions = (token) => {
    const options = typeof optionsOrFactory === "function"
      ? optionsOrFactory(token)
      : optionsOrFactory;
    const headers = { ...(options.headers || {}) };
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
    return { ...options, headers };
  };

  let res = await fetch(url, makeOptions(cfg.token));
  if (res.status !== 401) return { res, token: cfg.token };

  const nextToken = await refreshWorkbenchSession(cfg.serverUrl, cfg.employeeId);
  if (!nextToken) return { res, token: cfg.token };

  res = await fetch(url, makeOptions(nextToken));
  return { res, token: nextToken };
}

async function readBackendError(res) {
  try {
    const body = await res.json();
    return body?.detail || body?.message || JSON.stringify(body);
  } catch {
    try { return await res.text(); } catch { return ""; }
  }
}

ipcMain.handle("viewer:finalizeEditedModel", async (_e, payload) => {
  try {
    const folderPath   = payload?.folderPath;
    const editFileName = payload?.request?.editFileName;
    if (!folderPath || !editFileName) {
      return { ok: false, error: "folderPath / editFileName 누락" };
    }
    // 경로 탈출 차단 + 파일 실존 확인
    const baseAbs = path.resolve(folderPath);
    const editAbs = path.resolve(baseAbs, editFileName);
    if (!editAbs.startsWith(baseAbs)) {
      return { ok: false, error: "경로 탈출 시도 차단" };
    }
    if (!fs.existsSync(editAbs)) {
      return { ok: false, error: `_edit.json 파일이 없습니다: ${editFileName}` };
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "워크벤치 메인 창이 활성화되지 않았습니다." };
    }

    const requestId = crypto.randomUUID();
    const result = await new Promise((resolve) => {
      _pendingFinalizeReqs.set(requestId, resolve);
      // 10분 안전 타임아웃 (apply-edit-intent 자체는 백엔드에서 10분)
      setTimeout(() => {
        if (_pendingFinalizeReqs.has(requestId)) {
          _pendingFinalizeReqs.delete(requestId);
          resolve({ ok: false, error: "워크벤치 응답 시간 초과" });
        }
      }, 10 * 60 * 1000);

      const channel = viewerCurrentId === 'mooring-fitting-studio'
        ? 'mooring:finalize-edit-request'
        : 'modelflow:finalize-edit-request';

      mainWindow.webContents.send(channel, {
        requestId,
        folderPath: baseAbs,
        editFileName,
      });
    });

    // 성공 시 Studio 창 자동 종료 (Studio 의 await 가 결과를 받은 직후 닫히도록 마이크로태스크로)
    if (result?.ok) {
      setImmediate(() => {
        if (viewerWindow && !viewerWindow.isDestroyed()) viewerWindow.close();
      });
    }
    return result;
  } catch (e) {
    return { ok: false, error: e?.message || "예외 발생" };
  }
});

// mainWindow 렌더러가 finalize-edit 처리 결과를 보고하는 채널
ipcMain.on("modelflow:finalize-edit-response", (_e, msg) => {
  const { requestId, ok, error } = msg || {};
  const resolve = _pendingFinalizeReqs.get(requestId);
  if (resolve) {
    _pendingFinalizeReqs.delete(requestId);
    resolve({ ok: !!ok, ...(error ? { error } : {}) });
  }
});

// MooringFittingStudio finalize-edit 결과 채널 — modelflow 와 동일 _pendingFinalizeReqs 공유
ipcMain.on("mooring:finalize-edit-response", (_e, msg) => {
  const { requestId, ok, error } = msg || {};
  const resolve = _pendingFinalizeReqs.get(requestId);
  if (resolve) {
    _pendingFinalizeReqs.delete(requestId);
    resolve({ ok: !!ok, error: error || null });
  }
});

ipcMain.handle("viewer:writeFile", async (_e, folderPath, fileName, content) => {
  try {
    if (!folderPath || !fileName) return { ok: false, error: "인자 누락" };
    const baseAbs = path.resolve(folderPath);
    const safeAbs = path.resolve(baseAbs, fileName);
    if (!safeAbs.startsWith(baseAbs)) {
      return { ok: false, error: "경로 탈출 시도 차단" };
    }
    fs.writeFileSync(safeAbs, content, "utf-8");
    return { ok: true, location: "folder" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Studio 평가 입력 산출물 업로드 ───────────────────────────────────
// Studio (다른 PC) 가 자기 로컬 폴더에 _edit_posture.json / _edited.json 을 저장한 직후
// 서버 PC 의 userConnection/{ts}_{empid}_GroupModuleUnit/ 로 같은 파일을 올린다.
// 그 후 viewer:runStabilityAnalysis 는 반환된 remotePath 로 호출되어 같은 PC 디스크에서
// 자세안정성 평가가 실행된다. 이로써 Studio/서버 PC 분리 운영을 지원한다.
ipcMain.handle("viewer:uploadEvaluationArtifact", async (_e, payload) => {
  try {
    const fileName = payload?.fileName;
    const content  = payload?.content;
    const artifactKind = payload?.artifactKind || "posture";
    if (!fileName || typeof content !== "string") {
      return { ok: false, error: "fileName / content 누락" };
    }

    const runtimeConfig = await getWorkbenchRuntimeConfig();
    const { serverUrl } = runtimeConfig;
    // employee_id 는 백엔드의 require_auth 가 검증한 current_user 와 일치해야 한다.
    const employeeId = runtimeConfig.employeeId;
    if (!employeeId) {
      return { ok: false, error: "사용자 정보가 없습니다 (로그인 필요)." };
    }
    if (!viewerParentAnalysisId) {
      return { ok: false, error: "parentAnalysisId 가 없습니다. WorkBench 에서 BDF 검증을 완료한 뒤 Studio 를 여세요." };
    }

    const makeForm = () => {
      const form = new FormData();
      form.append("file", new Blob([content], { type: "application/json" }), fileName);
      form.append("employee_id", employeeId);
      form.append("parent_analysis_id", String(viewerParentAnalysisId));
      form.append("artifact_kind", artifactKind);
      return form;
    };

    const { res } = await fetchWithSessionRefresh(`${serverUrl}/api/analysis/module-stability/upload`, () => ({
      method: "POST",
      body: makeForm(),
    }), runtimeConfig);
    if (!res.ok) {
      const detail = await readBackendError(res);
      return { ok: false, error: `업로드 실패: ${res.status}${detail ? ` - ${detail}` : ""}` };
    }
    const body = await res.json();
    return {
      ok: true,
      remotePath: body.remotePath || null,
      folderPath: body.folderPath || null,
      fileName: body.fileName || fileName,
    };
  } catch (e) {
    return { ok: false, error: e?.message || "예외 발생" };
  }
});

ipcMain.handle("viewer:runStabilityAnalysis", async (_e, posturePath) => {
  try {
    if (!posturePath) return { ok: false, error: "posturePath 누락" };
    if (!path.isAbsolute(posturePath)) {
      return { ok: false, error: `_posture.json 절대경로가 아닙니다: ${posturePath}` };
    }

    const runtimeConfig = await getWorkbenchRuntimeConfig();
    const { serverUrl } = runtimeConfig;

    const { res: reqRes, token } = await fetchWithSessionRefresh(`${serverUrl}/api/analysis/module-stability/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posturePath, source: "ModuleUnitStudio" }),
    }, runtimeConfig);
    if (!reqRes.ok) {
      const detail = await readBackendError(reqRes);
      return { ok: false, error: `백엔드 요청 실패: ${reqRes.status}${detail ? ` - ${detail}` : ""}` };
    }

    const reqBody = await reqRes.json();
    const jobId = reqBody.jobId || reqBody.job_id;
    if (!jobId) return { ok: false, error: "백엔드 응답에 jobId가 없습니다." };

    for (let i = 0; i < 120; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const statusRes = await fetch(`${serverUrl}/api/analysis/module-stability/${jobId}/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!statusRes.ok) continue;

      const job = await statusRes.json();
      if (job.status === "Success") {
        const resultInfo = job.project?.result_info || {};
        return {
          ok: true,
          report: resultInfo.stabilityReport,
          stabilityPath: resultInfo.stabilityPath,
          job,
        };
      }
      if (job.status === "Failed") {
        return {
          ok: false,
          error: job.message || "CLI 실행 실패",
          stderr: job.engine_log || "",
          job,
        };
      }
    }

    return { ok: false, error: "시간 초과 (2분)" };
  } catch (e) {
    return { ok: false, error: e?.message || "예외 발생" };
  }
});

// ── Unit 구조 해석 (자세 안정성 PASS 후 wire 포함 BDF + Nastran SOL 101 + F06 매핑) ──
// Studio 측에서 IPC 한 번으로 호출 → main 이 백엔드 unit-structural endpoint 에 양식
// 데이터를 보내 job 시작 → 1.5초 간격으로 30분 폴링 → 완료 시 nastranResult JSON 의
// 내용까지 함께 돌려준다. 진행 상황은 viewer:unit-structural-progress 로 stream.
ipcMain.handle("viewer:runUnitStructural", async (_e, payload) => {
  try {
    const stabilityPath = payload?.stabilityPath;
    const safetyFactor  = Number(payload?.safetyFactor ?? 1.2);
    const allowableMpa  = Number(payload?.allowableMpa ?? 220);

    if (!stabilityPath) return { ok: false, error: "stabilityPath 누락" };
    if (!path.isAbsolute(stabilityPath)) {
      return { ok: false, error: `stabilityPath 절대경로가 아닙니다: ${stabilityPath}` };
    }
    if (!viewerParentAnalysisId) {
      return { ok: false, error: "parentAnalysisId 가 viewer:open 시점에 등록되지 않았습니다. WorkBench 에서 BDF 검증을 먼저 마치고 Studio 를 여세요." };
    }
    if (!Number.isFinite(safetyFactor) || safetyFactor <= 0) {
      return { ok: false, error: `safetyFactor 가 양수여야 합니다: ${safetyFactor}` };
    }
    if (!Number.isFinite(allowableMpa) || allowableMpa <= 0) {
      return { ok: false, error: `allowableMpa 가 양수여야 합니다: ${allowableMpa}` };
    }

    const runtimeConfig = await getWorkbenchRuntimeConfig();
    const { serverUrl } = runtimeConfig;
    const employeeId = runtimeConfig.employeeId;
    if (!employeeId) {
      return { ok: false, error: "사용자 정보가 없습니다 (로그인 필요)." };
    }

    const form = new URLSearchParams();
    form.set("stability_path", stabilityPath);
    form.set("parent_analysis_id", String(viewerParentAnalysisId));
    form.set("safety_factor", String(safetyFactor));
    form.set("allowable_mpa", String(allowableMpa));
    form.set("employee_id", employeeId);
    form.set("source", "Studio");

    const { res: reqRes, token } = await fetchWithSessionRefresh(`${serverUrl}/api/analysis/unit-structural/request`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }, runtimeConfig);
    if (!reqRes.ok) {
      const detail = await readBackendError(reqRes);
      return { ok: false, error: `백엔드 요청 실패: ${reqRes.status}${detail ? ` - ${detail}` : ""}` };
    }
    const reqBody = await reqRes.json();
    const jobId = reqBody.jobId || reqBody.job_id;
    if (!jobId) return { ok: false, error: "백엔드 응답에 jobId 가 없습니다." };

    const sendProgress = (data) => {
      try {
        if (viewerWindow && !viewerWindow.isDestroyed()) {
          viewerWindow.webContents.send("viewer:unit-structural-progress", { jobId, ...data });
        }
      } catch {}
    };
    sendProgress({ status: "Pending", progress: 0, message: "큐 대기..." });

    // SOL 101 + 모델 크기 고려해 30분 (1.5s × 1200) 폴링
    for (let i = 0; i < 1200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const statusRes = await fetch(`${serverUrl}/api/analysis/status/${jobId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!statusRes.ok) continue;

      const job = await statusRes.json();
      sendProgress({
        status: job.status,
        progress: job.progress,
        message: job.message,
      });

      if (job.status === "Success") {
        const resultInfo = job.project?.result_info || {};
        const resultPath = resultInfo.nastranResultJson || null;
        let resultContent = null;
        // 서버 PC 가 클라이언트와 분리된 환경에서는 resultPath 가 서버 로컬 경로라
        // fs.existsSync 가 항상 false 가 된다. 백엔드 /api/download 로 HTTP 다운로드하여
        // 결과 JSON 을 가져와야 Studio 하단 결과 dock(useUnitStructuralStore.result) 이 표시된다.
        if (resultPath) {
          try {
            const dlUrl = `${serverUrl}/api/download?filepath=${encodeURIComponent(resultPath)}`;
            const { res: dlRes } = await fetchWithSessionRefresh(dlUrl, { method: "GET" });
            if (!dlRes.ok) {
              const detail = await readBackendError(dlRes);
              return {
                ok: false,
                error: `결과 JSON 다운로드 실패: ${dlRes.status}${detail ? ` - ${detail}` : ""}`,
                job,
              };
            }
            resultContent = JSON.parse(await dlRes.text());
          } catch (e) {
            return { ok: false, error: `결과 JSON 다운로드/파싱 실패: ${e.message}`, job };
          }
        }
        return {
          ok: true,
          analysisId: job.project?.id ?? null,
          summary: resultInfo.summary ?? null,
          warnings: resultInfo.warnings ?? [],
          resultPath,
          result: resultContent,
          job,
        };
      }
      if (job.status === "Failed") {
        return {
          ok: false,
          error: job.message || "Unit 구조 해석 실패",
          stderr: job.engine_log || "",
          job,
        };
      }
    }

    return { ok: false, error: "시간 초과 (30분)" };
  } catch (e) {
    return { ok: false, error: e?.message || "예외 발생" };
  }
});

// ── Plate Studio: BDF 본문 업로드 → Nastran SOL 101 → 결과 JSON ──
// Studio 내 'Analysis' 탭 의 "구조해석 수행" 버튼 한 번으로 백엔드 job 시작 + 폴링 + 결과 JSON 다운로드까지 main 이 처리.
// 진행 상황은 viewer:plate-structural-progress 로 stream.
//
// payload = { bdfContent: string, fileName?: string }
// 반환    = { ok, summary, resultPath, result, job, analysisId } | { ok:false, error, ... }
ipcMain.handle("viewer:runPlateStructural", async (_e, payload) => {
  try {
    const bdfContent = payload?.bdfContent;
    const fileName   = payload?.fileName || "plate_model.bdf";
    if (typeof bdfContent !== "string" || !bdfContent.trim()) {
      return { ok: false, error: "bdfContent 누락" };
    }

    const runtimeConfig = await getWorkbenchRuntimeConfig();
    const { serverUrl } = runtimeConfig;
    const employeeId = runtimeConfig.employeeId;
    if (!employeeId) {
      return { ok: false, error: "사용자 정보가 없습니다 (로그인 필요)." };
    }

    const makeForm = () => {
      const form = new FormData();
      form.append("bdf_file", new Blob([bdfContent], { type: "text/plain" }), fileName);
      form.append("employee_id", employeeId);
      form.append("source", "PlateStudio");
      return form;
    };

    const { res: reqRes, token } = await fetchWithSessionRefresh(
      `${serverUrl}/api/analysis/plate-structure/request`,
      () => ({ method: "POST", body: makeForm() }),
      runtimeConfig,
    );
    if (!reqRes.ok) {
      const detail = await readBackendError(reqRes);
      const route = "/api/analysis/plate-structure/request";
      const hint = reqRes.status === 404
        ? ` - Plate 구조해석 API가 해당 서버에 없습니다. 서버 주소(${serverUrl})가 최신 WorkBench 백엔드인지 확인하세요.`
        : "";
      return { ok: false, error: `백엔드 요청 실패: ${reqRes.status}${detail ? ` - ${detail}` : ""}${hint} (${serverUrl}${route})` };
    }
    const reqBody = await reqRes.json();
    const jobId = reqBody.jobId || reqBody.job_id;
    if (!jobId) return { ok: false, error: "백엔드 응답에 jobId 가 없습니다." };

    const sendProgress = (data) => {
      try {
        if (viewerWindow && !viewerWindow.isDestroyed()) {
          viewerWindow.webContents.send("viewer:plate-structural-progress", { jobId, ...data });
        }
      } catch {}
    };
    sendProgress({ status: "Pending", progress: 0, message: "큐 대기..." });

    // SOL 101 + 모델 크기 고려해 30분 (1.5s × 1200) 폴링
    for (let i = 0; i < 1200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const statusRes = await fetch(`${serverUrl}/api/analysis/status/${jobId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!statusRes.ok) continue;

      const job = await statusRes.json();
      sendProgress({ status: job.status, progress: job.progress, message: job.message });

      if (job.status === "Success") {
        const resultInfo = job.project?.result_info || {};
        const resultPath = resultInfo.plateResultJson || null;
        let resultContent = null;
        // 서버↔클라이언트 분리 환경에서는 서버 로컬 경로를 fs.existsSync 로 못 읽으므로 HTTP 다운로드.
        if (resultPath) {
          try {
            const dlUrl = `${serverUrl}/api/download?filepath=${encodeURIComponent(resultPath)}`;
            const { res: dlRes } = await fetchWithSessionRefresh(dlUrl, { method: "GET" });
            if (!dlRes.ok) {
              const detail = await readBackendError(dlRes);
              return {
                ok: false,
                error: `결과 JSON 다운로드 실패: ${dlRes.status}${detail ? ` - ${detail}` : ""}`,
                job,
              };
            }
            resultContent = JSON.parse(await dlRes.text());
          } catch (e) {
            return { ok: false, error: `결과 JSON 다운로드/파싱 실패: ${e.message}`, job };
          }
        }
        return {
          ok: true,
          analysisId: job.project?.id ?? null,
          summary:    resultInfo.summary ?? null,
          resultPath,
          result:     resultContent,
          job,
        };
      }
      if (job.status === "Failed") {
        return {
          ok: false,
          error: job.message || "Plate 구조 해석 실패",
          stderr: job.engine_log || "",
          job,
        };
      }
    }

    return { ok: false, error: "시간 초과 (30분)" };
  } catch (e) {
    return { ok: false, error: e?.message || "예외 발생" };
  }
});

// ── MooringFittingStudio: 편집 반영 BDF → Nastran SOL 101 → 조합응력 결과 JSON ──
// Studio 'Solve' 버튼 한 번으로 백엔드 mooring-fitting/solve job 시작 + 폴링 + 결과 JSON 다운로드까지 main 처리.
// 진행 상황은 viewer:mooring-structural-progress 로 stream.
//
// payload = { intents: Array, yieldStrength?: number, gammaM?: number }
//   yieldStrength = 항복강도 σy[MPa] (기본 315), gammaM = 재료계수 γM (기본 1.0). Usage=σeff/(σy/γM).
// 반환    = { ok, summary, resultPath, result, job, editSummary } | { ok:false, error, ... }
ipcMain.handle("viewer:runMooringStructural", async (_e, payload) => {
  try {
    const intents = Array.isArray(payload?.intents) ? payload.intents : [];
    if (!viewerOutputDir) {
      return { ok: false, error: "서버측 output_dir 가 viewer:open 시점에 등록되지 않았습니다. WorkBench 에서 해석을 완료하고 Studio 를 다시 여세요." };
    }

    // 평가 파라미터 — 양수만 통과, 아니면 백엔드 기본값에 위임(undefined 전송).
    const toPos = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : undefined);
    const yieldStrength = toPos(payload?.yieldStrength);
    const gammaM = toPos(payload?.gammaM);

    const runtimeConfig = await getWorkbenchRuntimeConfig();
    const { serverUrl } = runtimeConfig;
    const employeeId = runtimeConfig.employeeId;
    if (!employeeId) {
      return { ok: false, error: "사용자 정보가 없습니다 (로그인 필요)." };
    }

    const { res: reqRes, token } = await fetchWithSessionRefresh(
      `${serverUrl}/api/analysis/mooring-fitting/solve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output_dir: viewerOutputDir, intents, yieldStrength, gammaM }),
      },
      runtimeConfig,
    );
    if (!reqRes.ok) {
      const detail = await readBackendError(reqRes);
      const hint = reqRes.status === 404
        ? ` - Mooring 구조해석 API가 해당 서버에 없습니다. 서버 주소(${serverUrl})가 최신 WorkBench 백엔드인지 확인하세요.`
        : "";
      return { ok: false, error: `백엔드 요청 실패: ${reqRes.status}${detail ? ` - ${detail}` : ""}${hint}` };
    }
    const reqBody = await reqRes.json();
    const jobId = reqBody.jobId || reqBody.job_id;
    const editSummary = reqBody.editSummary ?? null;
    if (!jobId) return { ok: false, error: "백엔드 응답에 jobId 가 없습니다." };

    const sendProgress = (data) => {
      try {
        if (viewerWindow && !viewerWindow.isDestroyed()) {
          viewerWindow.webContents.send("viewer:mooring-structural-progress", { jobId, ...data });
        }
      } catch {}
    };
    sendProgress({ status: "Pending", progress: 0, message: "큐 대기..." });

    // SOL 101 + 다중 SUBCASE 고려해 30분 (1.5s × 1200) 폴링
    for (let i = 0; i < 1200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const statusRes = await fetch(`${serverUrl}/api/analysis/status/${jobId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!statusRes.ok) continue;

      const job = await statusRes.json();
      sendProgress({ status: job.status, progress: job.progress, message: job.message });

      if (job.status === "Success") {
        const resultInfo = job.project?.result_info || {};
        const resultPath = resultInfo.nastranResultJson || null;
        let resultContent = null;
        if (resultPath) {
          try {
            const dlUrl = `${serverUrl}/api/download?filepath=${encodeURIComponent(resultPath)}`;
            const { res: dlRes } = await fetchWithSessionRefresh(dlUrl, { method: "GET" });
            if (!dlRes.ok) {
              const detail = await readBackendError(dlRes);
              return { ok: false, error: `결과 JSON 다운로드 실패: ${dlRes.status}${detail ? ` - ${detail}` : ""}`, job };
            }
            resultContent = JSON.parse(await dlRes.text());
          } catch (e) {
            return { ok: false, error: `결과 JSON 다운로드/파싱 실패: ${e.message}`, job };
          }
        }
        return {
          ok: true,
          summary:    resultInfo.summary ?? null,
          resultPath,
          result:     resultContent,
          editSummary,
          job,
        };
      }
      if (job.status === "Failed") {
        return {
          ok: false,
          error: job.message || "Mooring 구조 해석 실패",
          stderr: job.engine_log || "",
          job,
        };
      }
    }

    return { ok: false, error: "시간 초과 (30분)" };
  } catch (e) {
    return { ok: false, error: e?.message || "예외 발생" };
  }
});

// MooringFittingStudio "최종 BDF 출력" → 백엔드 apply-edit(편집 반영 BDF 생성) → 사용자 PC 저장(대화상자).
// runMooringStructural 과 동일하게 viewerOutputDir(서버측 out 폴더) 기준으로 동작한다.
// MooringFittingStudio 는 zip 추출 데이터만 보유해 로컬 폴더가 없으므로, 서버측 out 폴더에서 BDF 를 만들어 내려받는다.
// payload = { intents: Array }, 반환 = { ok, savedPath, summary } | { ok:false, canceled?, error }
ipcMain.handle("viewer:exportMooringBdf", async (_e, payload) => {
  try {
    const intents = Array.isArray(payload?.intents) ? payload.intents : [];
    if (!viewerOutputDir) {
      return { ok: false, error: "서버측 output_dir 가 viewer:open 시점에 등록되지 않았습니다. WorkBench 에서 해석을 완료하고 Studio 를 다시 여세요." };
    }
    const runtimeConfig = await getWorkbenchRuntimeConfig();
    const { serverUrl } = runtimeConfig;
    if (!runtimeConfig.employeeId) {
      return { ok: false, error: "사용자 정보가 없습니다 (로그인 필요)." };
    }

    // 1) 편집 반영 BDF 생성 (apply-edit) — 서버 out 폴더의 stage07.json 에 intents 적용 → mooring_fitting_edited.bdf
    const { res: reqRes } = await fetchWithSessionRefresh(
      `${serverUrl}/api/analysis/mooring-fitting/apply-edit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: viewerOutputDir, intents }),
      },
      runtimeConfig,
    );
    if (!reqRes.ok) {
      const detail = await readBackendError(reqRes);
      const hint = reqRes.status === 404
        ? ` - apply-edit API가 해당 서버에 없습니다. 서버(${serverUrl})가 최신 WorkBench 백엔드인지 확인하세요.`
        : "";
      return { ok: false, error: `편집 반영 BDF 생성 실패: ${reqRes.status}${detail ? ` - ${detail}` : ""}${hint}` };
    }
    const body = await reqRes.json();
    const bdfPath = body?.bdfPath;
    if (!bdfPath) return { ok: false, error: "백엔드 응답에 bdfPath 가 없습니다." };

    // 2) 생성된 BDF 다운로드
    const dlUrl = `${serverUrl}/api/download?filepath=${encodeURIComponent(bdfPath)}`;
    const { res: dlRes } = await fetchWithSessionRefresh(dlUrl, { method: "GET" }, runtimeConfig);
    if (!dlRes.ok) {
      const detail = await readBackendError(dlRes);
      return { ok: false, error: `BDF 다운로드 실패: ${dlRes.status}${detail ? ` - ${detail}` : ""}` };
    }
    const bdfText = await dlRes.text();

    // 3) 사용자 PC 저장 (저장 대화상자)
    const target = viewerWindow && !viewerWindow.isDestroyed() ? viewerWindow : mainWindow;
    const saveRes = await dialog.showSaveDialog(target, {
      title: "편집 반영 최종 BDF 저장",
      defaultPath: path.basename(bdfPath) || "mooring_fitting_edited.bdf",
      filters: [{ name: "Nastran BDF", extensions: ["bdf"] }],
    });
    if (saveRes.canceled || !saveRes.filePath) {
      return { ok: false, canceled: true, error: "저장이 취소되었습니다." };
    }
    fs.writeFileSync(saveRes.filePath, bdfText, "utf-8");
    return { ok: true, savedPath: saveRes.filePath, summary: body?.summary ?? null };
  } catch (e) {
    return { ok: false, error: e?.message || "예외 발생" };
  }
});

app.whenReady().then(() => {
  // 외부 회사 네트워크 등 시스템 프록시가 설정된 환경에서도 정상 동작하도록
  // 시스템 프록시 설정을 자동으로 적용
  session.defaultSession.setProxy({ mode: 'system' })
    .catch((e) => console.warn("[proxy] system proxy setup failed:", e?.message || e));

  // CSP 헤더 설정 — XSS 방어
  // connect-src는 사용자가 설정한 내부망 서버 URL을 허용해야 하므로 http:/https:/ws: 전체 허용
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self' http: https:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob: https:; " +
          "connect-src 'self' http: https: ws: wss:;"
        ]
      }
    });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
