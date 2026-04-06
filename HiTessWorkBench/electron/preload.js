const { contextBridge, ipcRenderer } = require('electron')

// 허용된 IPC 채널 화이트리스트
const VALID_SEND_CHANNELS = ['app-ready', 'open-external'];
const VALID_RECEIVE_CHANNELS = ['app-update', 'server-status'];

contextBridge.exposeInMainWorld("electron", {
  sendMessage: (channel, data) => {
    if (VALID_SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  onMessage: (channel, callback) => {
    if (VALID_RECEIVE_CHANNELS.includes(channel)) {
      const listener = (_, data) => callback(data);
      ipcRenderer.on(channel, listener);
      // cleanup 함수 반환 — 호출 측에서 컴포넌트 언마운트 시 제거 가능
      return () => ipcRenderer.removeListener(channel, listener);
    }
    return () => {};
  }
});
