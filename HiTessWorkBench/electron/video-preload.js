// 영상 전용 창 preload — 재생 정보 하나만 꺼내 준다(다른 IPC 는 열지 않는다).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("videoHost", {
  getInfo: () => ipcRenderer.invoke("video:get-info"),
});
