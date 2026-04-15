const { app, BrowserWindow, screen, ipcMain, shell, session } = require("electron");
const path = require("path");
const fs   = require("fs");

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
  shell.openExternal(url);
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
    return fs.readdirSync(dirPath)
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .map(f => ({ name: f, filePath: path.join(dirPath, f) }));
  } catch {
    return [];
  }
});

// 지정 경로의 파일 내용을 ArrayBuffer로 반환
ipcMain.handle("read-file-buffer", (_, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    // structuredClone 가능한 형태로 변환
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
  }
});

app.whenReady().then(() => {
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