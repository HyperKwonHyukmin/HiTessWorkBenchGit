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
  // main 이 viewer 창에 Unit 구조 해석 진행 상황을 stream
  'viewer:unit-structural-progress',
  // main 이 viewer 창에 Plate 구조 해석 진행 상황을 stream
  'viewer:plate-structural-progress',
  // main 이 viewer 창에 Mooring 구조 해석 진행 상황을 stream
  'viewer:mooring-structural-progress',
  'viewer:model-saved',
];
const VALID_INVOKE_CHANNELS  = [
  'list-dir-csvs',
  'read-file-buffer',
  'get-intro-page-html',
  'download-client',
  'start-self-update',
  'preferences:get',
  'preferences:set',
  // viewer 라이프사이클
  'viewer:check-installed',
  'viewer:install',
  'viewer:open',
  'viewer:close',
  // viewer 호스트 어댑터(window.workbenchAPI)
  'viewer:pickFolder',
  'viewer:getInitialFolder',
  'viewer:writeFile',
  'viewer:notifyModelSaved',
  'viewer:finalizeEditedModel',
  'viewer:uploadEvaluationArtifact',
  'viewer:runStabilityAnalysis',
  'viewer:runUnitStructural',
  'viewer:runPlateStructural',
  'viewer:runMooringStructural',
  'viewer:exportMooringBdf',
  // 결과 폴더 다운로드/추출 (백엔드↔사용자PC 분리 환경)
  'viewer:checkPathAccess',
  'viewer:fetchResultDir',
  'viewer:readLocalFile',
  // 개발자 런북: 탐색기 열기
  'shell:openPath',
  // Download Center: ServerIP.txt 를 C:\temp 에 바로 적용 (레거시 프로그램이 읽는 위치)
  'place-server-ip',
  // 외부/별도 웹앱을 WorkBench 내부의 별도 창(BrowserWindow)으로 오픈
  'open-app-window',
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
  notifyModelSaved: (payload) =>
    ipcRenderer.invoke('viewer:notifyModelSaved', payload),
  // Studio (다른 PC) 가 자기 로컬 폴더에 저장한 _edit_posture.json / _edited.json 을
  // 서버 PC 의 userConnection 폴더로 업로드. 반환된 remotePath 를 그대로 runStabilityAnalysis 에 넘긴다.
  // payload = { fileName, content, artifactKind? }
  uploadEvaluationArtifact: (fileName, content, artifactKind) =>
    ipcRenderer.invoke('viewer:uploadEvaluationArtifact', { fileName, content, artifactKind }),
  runStabilityAnalysis: (posturePath) =>
    ipcRenderer.invoke('viewer:runStabilityAnalysis', posturePath),
  // Studio "Unit 구조 해석 실행" → 백엔드 unit-structural endpoint 호출 + 폴링까지
  // main 이 처리. 진행 상황은 onUnitStructuralProgress() 로 stream.
  runUnitStructural: (opts) =>
    ipcRenderer.invoke('viewer:runUnitStructural', opts),
  onUnitStructuralProgress: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('viewer:unit-structural-progress', listener);
    return () => ipcRenderer.removeListener('viewer:unit-structural-progress', listener);
  },
  // Plate Studio "구조해석 수행" → 백엔드 plate-structure endpoint 호출 + 폴링 + 결과 JSON 다운로드까지
  // main 이 일괄 처리. 진행 상황은 onPlateStructuralProgress() 로 stream.
  // payload = { bdfContent: string, fileName?: string }
  runPlateStructural: (opts) =>
    ipcRenderer.invoke('viewer:runPlateStructural', opts),
  onPlateStructuralProgress: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('viewer:plate-structural-progress', listener);
    return () => ipcRenderer.removeListener('viewer:plate-structural-progress', listener);
  },
  // Studio "최종 모델 출력" → 워크벤치 백엔드 apply-edit-intent 자동 수행
  // → mainWindow Edit 탭 표시 → Studio 창 닫기 → { ok, error }
  finalizeEditedModel: (folderPath, request) =>
    ipcRenderer.invoke('viewer:finalizeEditedModel', { folderPath, request }),
  // MooringFittingStudio "구조 해석 수행" → 백엔드 mooring-fitting/solve(편집 반영 solvable BDF)
  // 호출 + 폴링 + 결과 JSON 다운로드까지 main 이 처리. 진행 상황은 onMooringStructuralProgress() 로 stream.
  // payload = { intents: Array }
  runMooringStructural: (opts) =>
    ipcRenderer.invoke('viewer:runMooringStructural', opts),
  // MooringFittingStudio "최종 BDF 출력" → 백엔드 apply-edit(편집 반영 BDF 생성) → 사용자 PC 저장
  // payload = { intents: Array }, 반환 = { ok, savedPath, summary } | { ok:false, canceled?, error }
  exportMooringBdf: (opts) =>
    ipcRenderer.invoke('viewer:exportMooringBdf', opts),
  onMooringStructuralProgress: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('viewer:mooring-structural-progress', listener);
    return () => ipcRenderer.removeListener('viewer:mooring-structural-progress', listener);
  },
});
