const { app, BrowserWindow, screen, ipcMain, shell, session } = require("electron");
const path  = require("path");
const fs    = require("fs");
const http  = require("http");
const https = require("https");
const os    = require("os");

let mainWindow;

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
  const fileName = which === "workbench" ? "hitess-workbench.html" : "hitess-platform.html";
  const filePath = path.join(__dirname, "../IntroductionPage/", fileName);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
});

// 지정 폴더의 CSV 파일 목록 반환
ipcMain.handle("list-dir-csvs", (_, dirPath) => {
  try {
    const resolvedPath = path.resolve(dirPath);
    const allowedBases = [app.getPath("userData"), app.getPath("home"), app.getAppPath()].map(p => path.resolve(p));
    if (!allowedBases.some(base => resolvedPath.startsWith(base))) {
      console.warn("[Security] list-dir-csvs blocked path:", resolvedPath);
      return [];
    }
    return fs.readdirSync(resolvedPath)
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .map(f => ({ name: f, filePath: path.join(resolvedPath, f) }));
  } catch {
    return [];
  }
});

// 지정 경로의 파일 내용을 ArrayBuffer로 반환
ipcMain.handle("read-file-buffer", (_, filePath) => {
  try {
    const resolvedPath = path.resolve(filePath);
    const allowedBases = [app.getPath("userData"), app.getPath("home"), app.getAppPath()].map(p => path.resolve(p));
    if (!allowedBases.some(base => resolvedPath.startsWith(base))) {
      console.warn("[Security] read-file-buffer blocked path:", resolvedPath);
      return null;
    }
    const buf = fs.readFileSync(resolvedPath);
    // structuredClone 가능한 형태로 변환
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
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