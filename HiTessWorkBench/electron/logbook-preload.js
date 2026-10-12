// Hi-TESS LogBook 창 전용 preload — WorkBench 로 모델을 보내는 통로 하나만 노출한다.
//
// open-app-window 에 bridge:'logbook' 를 줄 때만 붙는다(다른 외부 앱 창에는 preload 가 없다).
// LogBook 화면은 window.hitessBridge 가 있을 때만 [WorkBench로 보내기] 버튼을 보인다.
// 발신 창·origin 검사와 payload 검증은 main(logbook:send-model)이 한다 — 여기서는 전달만.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hitessBridge", {
  version: 1,
  // payload = { target:'gmu'|'truss', slot:1..4(truss 는 1), fileId:int, entryId:string|null, name:string }
  // 반환 = Promise<{ ok:boolean, message:string }>
  sendModel: (payload) => ipcRenderer.invoke("logbook:send-model", payload),
});
