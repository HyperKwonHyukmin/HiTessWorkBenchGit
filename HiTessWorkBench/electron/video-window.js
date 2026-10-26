// HiTESS 소개 영상 전용 창 (2026-10-26).
//
// 저작권 보호를 위해 영상은 WorkBench 안의 이 창에서만 재생한다.
//  - 녹화·캡처 방지: setContentProtection(true) — Windows 가 화면 캡처·녹화·화면 공유에 이 창을 검게 내보낸다.
//    ⚠ 본체 창에는 걸지 않는다. 걸면 Teams 로 WorkBench 화면을 공유해 원격 지원할 때 화면이 통째로 검게 나간다.
//  - 다운로드 차단: 전용 세션(partition)에서 will-download 를 모두 취소, 새 창·이동 금지, 패키징본은 개발자 도구 끔.
//  - 워터마크: 서버가 정한 '이름 사번' 을 영상 위에 겹친다(휴대폰 촬영은 못 막으니 누구 화면인지 남게).
// 재생 주소는 서버가 로그인 사용자에게 준 짧은 유효기간 표(ticket)가 붙은 /api/videos/stream/… 만 받는다.
const path = require("path");

const STREAM_PATH_PREFIX = "/api/videos/stream/";
const VIDEO_PARTITION = "video-player"; // 'persist:' 를 붙이지 않음 — 메모리 세션이라 디스크 캐시가 남지 않는다

/**
 * 렌더러가 보낸 재생 요청을 검증해 창에 넘길 정보로 만든다. 잘못되면 { error }.
 * 주소는 http(s) API 서버 + 정해진 스트리밍 경로만 허용한다(임의 주소를 이 창에 띄우지 못하게).
 */
function buildVideoInfo(payload) {
  const { apiBase, streamPath, title, subtitle, watermark } = payload || {};
  let base;
  try {
    base = new URL(String(apiBase || ""));
  } catch {
    return { error: "서버 주소가 올바르지 않습니다." };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { error: "서버 주소가 올바르지 않습니다." };
  }
  if (typeof streamPath !== "string" || !streamPath.startsWith(STREAM_PATH_PREFIX)) {
    return { error: "영상 주소가 올바르지 않습니다." };
  }
  const url = new URL(streamPath, base.origin);
  if (url.origin !== base.origin || !url.pathname.startsWith(STREAM_PATH_PREFIX)) {
    return { error: "영상 주소가 올바르지 않습니다." };
  }
  const text = (value, max) => String(value || "").slice(0, max);
  return {
    url: url.toString(),
    origin: url.origin,
    title: text(title, 120) || "HiTESS 영상",
    subtitle: text(subtitle, 200),
    watermark: text(watermark, 60),
  };
}

/** main 프로세스에 IPC 를 등록한다. getMainWindow 는 본체 창(요청을 받아 줄 유일한 창)을 돌려준다. */
function registerVideoWindow({ app, BrowserWindow, ipcMain, session, screen, getMainWindow, iconPath }) {
  let videoWindow = null;
  const infoBySender = new Map();
  let sessionReady = false;

  function videoSession() {
    const ses = session.fromPartition(VIDEO_PARTITION);
    if (!sessionReady) {
      sessionReady = true;
      ses.on("will-download", (event) => event.preventDefault());
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    }
    return ses;
  }

  ipcMain.handle("video:open", async (event, payload) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      return { ok: false, error: "본체 창에서만 열 수 있습니다." };
    }
    const info = buildVideoInfo(payload);
    if (info.error) return { ok: false, error: info.error };

    if (videoWindow && !videoWindow.isDestroyed()) {
      infoBySender.set(videoWindow.webContents.id, info);
      videoWindow.setTitle(info.title);
      videoWindow.webContents.reload();
      if (videoWindow.isMinimized()) videoWindow.restore();
      videoWindow.focus();
      return { ok: true, reused: true };
    }

    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
    const win = new BrowserWindow({
      width: Math.min(1280, screenW - 80),
      height: Math.min(800, screenH - 80),
      minWidth: 640,
      minHeight: 400,
      title: info.title,
      backgroundColor: "#000000",
      autoHideMenuBar: true,
      icon: iconPath,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "video-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: videoSession(),
        devTools: !app.isPackaged,
        spellcheck: false,
      },
    });
    // 창이 화면에 나오기 전에 건다 — 첫 프레임부터 캡처에서 빠지게.
    win.setContentProtection(true);
    win.removeMenu();
    videoWindow = win;
    const senderId = win.webContents.id;
    infoBySender.set(senderId, info);

    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (navEvent) => navEvent.preventDefault());
    win.once("ready-to-show", () => { win.show(); win.focus(); });
    win.on("closed", () => {
      infoBySender.delete(senderId);
      if (videoWindow === win) videoWindow = null;
    });
    await win.loadFile(path.join(__dirname, "video-player.html"));
    return { ok: true };
  });

  ipcMain.handle("video:get-info", (event) => infoBySender.get(event.sender.id) || null);

  // 로그아웃 때 본체가 닫는다(다음 사람이 앞사람 워터마크로 보지 않게).
  ipcMain.handle("video:close", (event) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false };
    closeVideoWindow();
    return { ok: true };
  });

  function closeVideoWindow() {
    if (videoWindow && !videoWindow.isDestroyed()) videoWindow.close();
  }
  return { closeVideoWindow };
}

module.exports = { buildVideoInfo, registerVideoWindow, STREAM_PATH_PREFIX, VIDEO_PARTITION };
