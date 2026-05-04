const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 허용된 IPC 채널 화이트리스트
const VALID_SEND_CHANNELS    = [
  'app-ready', 'open-external',
  // mainWindow 렌더러가 finalize-edit 처리 결과를 main 으로 보고
  'modelflow:finalize-edit-response',
];
const VALID_RECEIVE_CHANNELS = [
  'app-update',
  'server-status',
  'download-progress',
  'viewer:install-progress',
  // main 이 mainWindow 렌더러에게 finalize-edit 처리를 요청
  'modelflow:finalize-edit-request',
];
const VALID_INVOKE_CHANNELS  = [
  'list-dir-csvs',
  'read-file-buffer',
  'get-intro-page-html',
  'download-client',
  'start-self-update',
  // viewer 라이프사이클
  'viewer:check-installed',
  'viewer:install',
  'viewer:open',
  'viewer:close',
  // viewer 호스트 어댑터(window.workbenchAPI)
  'viewer:pickFolder',
  'viewer:getInitialFolder',
  'viewer:writeFile',
  'viewer:finalizeEditedModel',
  // 개발자 런북: 탐색기 열기
  'shell:openPath',
];

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
  // Electron 32+ 대응: File 객체에서 절대 경로 추출 (File.path 제거 대체)
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
});

// ClaudeModelBuilderViewer(host.js)가 기대하는 workbenchAPI 인터페이스.
// ElectronHost 가 window.workbenchAPI 존재 여부로 자동 감지됨.
contextBridge.exposeInMainWorld("workbenchAPI", {
  pickFolder: () => ipcRenderer.invoke('viewer:pickFolder'),
  getInitialFolder: () => ipcRenderer.invoke('viewer:getInitialFolder'),
  writeFile: (folderPath, fileName, content) =>
    ipcRenderer.invoke('viewer:writeFile', folderPath, fileName, content),
  // Studio "최종 모델 출력" → 워크벤치 백엔드 apply-edit-intent 자동 수행
  // → mainWindow Edit 탭 표시 → Studio 창 닫기 → { ok, error }
  finalizeEditedModel: (folderPath, request) =>
    ipcRenderer.invoke('viewer:finalizeEditedModel', { folderPath, request }),
});
