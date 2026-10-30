// 로그 — %LOCALAPPDATA%\HiTESS\MBLauncher\logs\yyyyMMdd.log 에 UTF-8 한 줄씩.
// 사용자 PC 는 화면을 원격으로 볼 수 없으므로, 문제 해결의 유일한 근거가 이 파일이다.
"use strict";

const fs = require("fs");
const path = require("path");

const pad = (n, w = 2) => String(n).padStart(w, "0");

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function createLogger(logDir) {
  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* 아래 write 에서 다시 실패하면 콘솔만 */ }
  const fileOf = (d = new Date()) => path.join(logDir, `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.log`);

  function write(level, tag, message) {
    const line = `${stamp()} [${level}]${tag ? ` [${tag}]` : ""} ${message}`.replace(/\r?\n/g, " ⏎ ");
    try { fs.appendFileSync(fileOf(), line + "\r\n", "utf-8"); } catch { /* 로그 실패로 흐름을 멈추지 않는다 */ }
    if (level === "ERROR") console.error(line); else console.log(line);
  }

  const make = (tag) => ({
    info: (m) => write("INFO", tag, m),
    warn: (m) => write("WARN", tag, m),
    error: (m) => write("ERROR", tag, m),
    child: (sub) => make(tag ? `${tag}:${sub}` : sub),
  });

  const root = make("");
  root.dir = logDir;
  root.currentFile = () => fileOf();
  return root;
}

module.exports = { createLogger };
