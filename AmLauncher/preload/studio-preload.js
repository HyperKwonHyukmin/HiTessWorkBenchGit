// Studio 창 preload — window.workbenchAPI 를 WorkBench 와 같은 이름·같은 모양으로 준다.
//
// WorkBench electron/preload.js 의 contextBridge.exposeInMainWorld("workbenchAPI", …) 에서
// Model Builder Studio(model-studio, host.js) 가 쓰는 항목만 옮겼다:
//   pickFolder · getInitialFolder · writeFile · finalizeEditedModel ·
//   runModelBuilderAnalysis · onModelBuilderAnalysisProgress
// IPC 채널 이름도 WorkBench 와 같게 둔다(viewer:*) — 공용 모듈로 합칠 때 그대로 맞물리게.
// 다른 Studio(Module Unit·Mooring 등) 전용 API 는 넣지 않는다 — 실행기는 model-studio 만 띄운다.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workbenchAPI", {
  pickFolder: () => ipcRenderer.invoke("viewer:pickFolder"),
  getInitialFolder: () => ipcRenderer.invoke("viewer:getInitialFolder"),
  writeFile: (folderPath, fileName, content) =>
    ipcRenderer.invoke("viewer:writeFile", folderPath, fileName, content),
  // Studio "모델 저장" → 실행기 main 이 discard-edit / upload-edit → apply-edit 를 직접 수행
  finalizeEditedModel: (folderPath, request) =>
    ipcRenderer.invoke("viewer:finalizeEditedModel", { folderPath, request }),
  // Studio "해석 실행" → 백엔드 modelbuilder/solve 호출 + 폴링 + 결과 JSON 다운로드
  runModelBuilderAnalysis: (opts) =>
    ipcRenderer.invoke("viewer:runModelBuilderSolve", opts),
  onModelBuilderAnalysisProgress: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("viewer:modelbuilder-structural-progress", listener);
    return () => ipcRenderer.removeListener("viewer:modelbuilder-structural-progress", listener);
  },
});
