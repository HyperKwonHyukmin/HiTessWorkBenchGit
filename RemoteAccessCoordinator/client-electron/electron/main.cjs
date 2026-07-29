const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const dgram = require('dgram');
const { spawn } = require('child_process');

const SERVER_HOST = '10.14.42.145';
const SERVER_PORT = 8765;
const ICON_PATH = path.join(__dirname, 'icon.png');

let mainWindow = null;
let tray = null;
let isQuitting = false;
// 로그인 자동시작은 '--hidden' 인자로 실행 → 창 없이 트레이에만 조용히 상주한다.
const startHidden = process.argv.includes('--hidden');

// 단일 인스턴스 — 이미 실행 중이면 새로 띄우지 않고 기존 창을 앞으로 가져온다.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(() => {
    registerAutoLaunch();
    createWindow();
    createTray();
    setupAutoUpdate();
  });
}

function getLocalAddress() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.connect(SERVER_PORT, SERVER_HOST, () => {
      const { address } = socket.address();
      socket.close();
      resolve(address);
    });
  });
}

// 각 개인 PC의 로그인 시 자동 실행을 자가 등록한다(HKCU Run, 관리자 권한 불필요).
// 포터블 exe는 실행 시 임시폴더로 압축 해제되므로 process.execPath 가 아니라
// 실제 포터블 파일 경로(PORTABLE_EXECUTABLE_FILE)로 등록해야 자동시작이 유지된다.
function registerAutoLaunch() {
  if (!app.isPackaged) return; // 개발 모드에서는 등록하지 않는다.
  const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  try {
    app.setLoginItemSettings({ openAtLogin: true, path: exePath, args: ['--hidden'] });
  } catch (_) {
    // 자동시작 등록 실패는 앱 사용 자체를 막지 않으므로 무시한다.
  }
}

// 사내 서버(server.py의 /updates)를 업데이트 피드로 삼아 새 버전을 자동 확인·다운로드한다.
// 다운로드가 끝나면 토스트로 알리고, 클릭 시 즉시 적용(아니면 다음 종료 시 자동 적용).
function setupAutoUpdate() {
  if (!app.isPackaged) return; // 개발 모드에서는 업데이트 확인을 건너뛴다.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'RDP Access Desk 업데이트',
        body: `새 버전 ${info?.version || ''}이(가) 준비됐습니다 · 클릭하면 지금 적용`,
        icon: ICON_PATH, silent: false,
      });
      notification.on('click', () => { isQuitting = true; autoUpdater.quitAndInstall(); });
      notification.show();
    }
  });
  autoUpdater.on('error', () => { /* 업데이트 서버 미가용 등은 조용히 무시(앱 사용엔 지장 없음) */ });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 60 * 60 * 1000); // 1시간마다 확인
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 830, minWidth: 1040, minHeight: 700,
    backgroundColor: '#f4f7fb', autoHideMenuBar: true,
    title: 'RDP Access Desk',
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      // 트레이로 숨겨져도 3초 폴링을 유지해 메시지 알림이 늦지 않게 한다.
      // (기본값 true면 숨김 시 타이머가 분당 1회로 throttle 됨)
      backgroundThrottling: false,
    },
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show(); });
  mainWindow.on('focus', () => mainWindow.flashFrame(false));
  // 창을 닫아도 종료하지 않고 트레이로 숨긴다(종료는 트레이 메뉴에서만).
  mainWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
  });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.flashFrame(false);
  if (tray) tray.setToolTip('RDP Access Desk');
}

function createTray() {
  const image = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }));
  tray.setToolTip('RDP Access Desk');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => showWindow() },
    { label: '원격 연결', click: () => connectRdp() },
    { type: 'separator' },
    { label: '종료', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

function connectRdp() {
  return new Promise((resolve) => {
    // '/prompt'는 매번 자격증명을 강제로 다시 묻는다. 제거하면 mstsc가 Windows 자격증명
    // 관리자(사용자별 DPAPI 암호화)에 저장된 자격증명으로 무프롬프트 접속한다 —
    // 사용자는 최초 1회 접속 때 '기억' 체크만 하면 이후 비밀번호를 입력하지 않는다.
    // (도메인 비밀번호를 앱/설정에 평문 내장하는 방식은 계정 탈취 위험이라 채택하지 않는다.)
    const child = spawn('mstsc.exe', [`/v:${SERVER_HOST}`], { windowsHide: false });
    child.once('spawn', () => resolve({ ok: true }));
    child.once('error', (error) => resolve({ ok: false, error: error.message || '원격 데스크톱을 열 수 없습니다.' }));
  });
}

ipcMain.handle('network:local-ip', async () => getLocalAddress());
ipcMain.handle('rdp:connect', async () => connectRdp());
ipcMain.handle('app:show', async () => { showWindow(); return { ok: true }; });
// 새 수신 메시지를 렌더러가 감지하면 호출 → 네이티브 토스트(소리) + 작업표시줄 깜빡임으로 즉시 알린다.
ipcMain.handle('app:notify', async (_event, payload) => {
  const { title, body } = payload || {};
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title || 'RDP Access Desk', body: body || '', icon: ICON_PATH, silent: false,
    });
    notification.on('click', () => showWindow());
    notification.show();
  }
  if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  if (tray) tray.setToolTip('RDP Access Desk · 새 메시지');
  return { ok: true };
});

// 트레이 상주: 창이 모두 닫혀도(숨겨져도) 앱을 종료하지 않는다.
app.on('window-all-closed', () => {});
app.on('before-quit', () => { isQuitting = true; });
