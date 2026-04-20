const { contextBridge, ipcRenderer } = require('electron')

// 허용된 IPC 채널 화이트리스트
const VALID_SEND_CHANNELS    = ['app-ready', 'open-external'];
const VALID_RECEIVE_CHANNELS = ['app-update', 'server-status', 'download-progress'];
const VALID_INVOKE_CHANNELS  = ['list-dir-csvs', 'read-file-buffer', 'get-intro-page-html', 'download-client', 'start-self-update'];

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
      return () => ipcRenderer.removeListener(channel, listener);
    }
    return () => {};
  },
  // 파일시스템 접근 (폴더 내 CSV 목록 조회, 파일 내용 읽기)
  invoke: (channel, data) => {
    if (VALID_INVOKE_CHANNELS.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
    return Promise.resolve(null);
  },
});
