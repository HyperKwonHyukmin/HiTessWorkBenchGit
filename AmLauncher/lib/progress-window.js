// 진행 창 — 작업(흐름)마다 하나. 로그인 → 모델 생성 → 결과 받기 → Studio 확인·설치 → 열기 단계를 보여 주고,
// 실패하면 사유·로그 폴더·[닫기] 를 보여 준다. 편집 확정(apply-edit) 진행·결과도 같은 창을 다시 쓴다.
"use strict";

const path = require("path");
const { BrowserWindow, ipcMain } = require("electron");

const byWebContents = new Map(); // webContents.id → ProgressWindow
let ipcReady = false;

function ensureIpc() {
  if (ipcReady) return;
  ipcReady = true;
  ipcMain.on("launcher:ui-ready", (e) => {
    const pw = byWebContents.get(e.sender.id);
    if (pw) { pw.uiReady = true; pw.flush(); }
  });
  ipcMain.on("launcher:action", (e, name) => {
    const pw = byWebContents.get(e.sender.id);
    if (pw) pw.handleAction(String(name));
  });
}

class ProgressWindow {
  /**
   * @param {{title?:string, onAction:(id:string)=>void, onClosed?:()=>void}} opts
   */
  constructor({ onAction, onClosed }) {
    ensureIpc();
    this.onAction = onAction;
    this.onClosed = onClosed;
    this.uiReady = false;
    this.state = { title: "준비 중", subtitle: "", steps: [], progress: null, busy: true, message: "", error: null, info: [], actions: [] };
    this.win = new BrowserWindow({
      width: 480,
      height: 420,
      minWidth: 420,
      minHeight: 360,
      show: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: "#FFFFFF",
      title: "HiTESS Model Builder",
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "progress-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const id = this.win.webContents.id;
    byWebContents.set(id, this);
    this.win.on("closed", () => {
      byWebContents.delete(id);
      this.win = null;
      this.onClosed?.();
    });
    // 진행 창 안에서 다른 페이지로 이동·새 창 열기를 막는다(인라인 화면 하나만 쓴다).
    this.win.webContents.on("will-navigate", (e) => e.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.win.once("ready-to-show", () => { if (this.win) this.win.show(); });
    this.win.loadFile(path.join(__dirname, "..", "ui", "progress.html"));
  }

  alive() { return !!this.win && !this.win.isDestroyed(); }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.flush();
  }

  flush() {
    if (!this.alive() || !this.uiReady) return;
    try { this.win.webContents.send("launcher:state", this.state); } catch { /* 닫히는 중 */ }
  }

  handleAction(id) {
    try { this.onAction?.(id); } catch { /* 동작 실패는 흐름 쪽에서 로그 */ }
  }

  focus() {
    if (!this.alive()) return;
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  close() {
    if (this.alive()) this.win.close();
  }
}

module.exports = { ProgressWindow };
