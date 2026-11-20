// WorkBench 중복 실행 막기 (2026-11-16).
//
// 이동식(portable) exe 는 실행할 때 %TEMP% 의 버전별 고정 폴더에 Chromium 파일(resources.pak 등)을
// 풀어 쓴다. 같은 exe 를 두 번 띄우면 두 실행이 그 폴더를 같이 쓰고, 하나를 닫을 때 정리가 공유 파일을
// 지우는 것으로 추정된다 — 남은 쪽에서 새로 여는 창(Studio)이 기본 스타일 없이 그려져 제목과 CSS 글자가
// 화면에 찍히고 모델이 안 뜬다(2026-11-04 MF Studio, 2026-11-16 MU Studio 다른 사용자 PC).
// 그래서 두 번째 실행은 바로 끝내고 이미 떠 있는 창을 앞으로 가져온다.
//
// 배포 exe 에서만 잠근다 — 개발 실행(npm run dev)은 배포 exe 와 같은 userData 폴더를 써서,
// 개발 실행까지 잠그면 개발 PC 에서 exe 와 개발 앱을 같이 띄울 수 없다.

/**
 * @param {object} deps
 * @param {Electron.App} deps.app
 * @param {() => Electron.BrowserWindow | null} deps.getMainWindow
 * @param {() => Electron.BrowserWindow[]} deps.getAllWindows
 * @param {() => void} deps.createWindow
 * @returns {boolean} 이 실행이 계속 떠도 되면 true, 이미 다른 실행이 있어 끝내야 하면 false
 */
function installSingleInstance({ app, getMainWindow, getAllWindows, createWindow }) {
  if (!app.isPackaged) return true;
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on("second-instance", () => {
    const main = getMainWindow();
    const win = main && !main.isDestroyed() ? main : (getAllWindows()[0] || null);
    if (!win) {
      if (app.isReady()) createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  return true;
}

module.exports = { installSingleInstance };
