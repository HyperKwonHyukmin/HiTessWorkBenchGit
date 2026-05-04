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
// viewer:getInitialFolder 가 호출될 때 반환할 절대경로(보통 jsonPath 의 디렉터리)
let viewerInitialFolder = null;

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

ipcMain.handle("start-self-update", (event, url) => {
  return new Promise((resolve, reject) => {
    // 항상 temp 폴더에 저장 — 쓰기 권한 문제 없음
    let tmpPath = path.join(os.tmpdir(), "HiTESS-WorkBench-update.exe");

    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(url, (response) => {
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
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.toLowerCase().endsWith(".json")) {
        try {
          files.push({ name: entry.name, content: fs.readFileSync(full, "utf-8") });
        } catch { /* 개별 파일 오류는 스킵 */ }
      }
    }
  }
  return { folderPath, files };
}

// Electron net 모듈 기반 다운로드 (Chromium 네트워크 스택 — 시스템 프록시 자동 적용,
// FastAPI/uvicorn keep-alive/응답 종료 비표준에도 관대함)
function downloadToFile(url, destPath, viewerId, totalRangeStart = 0, totalRangePct = 90) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(destPath);
    let settled = false;
    const settle = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    const request = net.request({ url, method: "GET", redirect: "follow", useSessionCookies: false });

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

// 3) 풀스크린 보조 BrowserWindow 로 viewer 오픈
ipcMain.handle("viewer:open", async (_e, payload) => {
  const { viewerId, initialFolder } = payload || {};
  if (!viewerId) return { ok: false, error: "viewerId 누락" };

  const dir = getViewerDir(viewerId);
  const indexPath = path.join(dir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return { ok: false, error: `viewer 미설치: ${viewerId}` };
  }

  // viewer:getInitialFolder 가 사용
  viewerInitialFolder = initialFolder ? path.resolve(initialFolder) : null;

  if (viewerWindow && !viewerWindow.isDestroyed()) {
    viewerWindow.focus();
    viewerWindow.webContents.reload();  // 새 initialFolder 로 갱신
    return { ok: true, reused: true };
  }

  viewerWindow = new BrowserWindow({
    parent: mainWindow,
    modal: false,
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

  viewerWindow.once("ready-to-show", () => {
    viewerWindow.maximize();         // 최대화로 시작 (전체화면처럼 보이지만 OS 컨트롤 유지)
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

  viewerWindow.on("closed", () => { viewerWindow = null; });

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

      mainWindow.webContents.send("modelflow:finalize-edit-request", {
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

app.whenReady().then(async () => {
  // 외부 회사 네트워크 등 시스템 프록시가 설정된 환경에서도 정상 동작하도록
  // 시스템 프록시 설정을 자동으로 적용
  await session.defaultSession.setProxy({ mode: 'system' });

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