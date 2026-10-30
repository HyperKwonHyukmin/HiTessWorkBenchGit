// 진행 창 preload — main → 화면 상태 전달, 화면 → main 버튼 동작만 연다.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcherUI", {
  onState: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on("launcher:state", listener);
    return () => ipcRenderer.removeListener("launcher:state", listener);
  },
  ready: () => ipcRenderer.send("launcher:ui-ready"),
  action: (name) => ipcRenderer.send("launcher:action", String(name)),
});
