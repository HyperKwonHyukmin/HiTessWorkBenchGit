// Studio 사용자 설정 파일 — Studio 창이 고른 설정(예: MU 자세안정성 평가 모드)을 PC 에 남겨 다음 실행 때 다시 쓴다.
//
// 위치 = <userData>/viewer-settings/<viewerId>.json. Studio 설치 폴더(<userData>/viewers/<viewerId>/)는
// 새 버전을 받을 때 통째로 지워지므로(설치 함수의 rmSync) 그 안에 두면 업데이트마다 설정이 사라진다.
// 계획: docs/plans/2026-11-18-mu-evaluation-mode-rbe-swap-group-bulk.md
//
// - 없으면 {} 를 돌려주고, 첫 저장 때 만든다.
// - 저장은 덮어쓰기가 아니라 합치기(patch) — 모르는 키를 지우지 않는다. 값이 null 이면 그 키를 지운다.
// - 깨진 파일은 .bak 로 옮겨 두고 {} 로 읽는다(사용자가 손으로 고친 파일을 조용히 덮어쓰지 않게).
// - 쓰기는 임시 파일 → rename(쓰다 끊겨도 반쪽 파일이 남지 않게).
const fs = require("fs");
const path = require("path");

const MAX_BYTES = 64 * 1024;

function safeViewerId(viewerId) {
  const safe = String(viewerId ?? "").replace(/[^a-z0-9_-]/gi, "");
  return safe || null;
}

function settingsPath(userDataDir, viewerId) {
  const safe = safeViewerId(viewerId);
  if (!safe) return null;
  return path.join(userDataDir, "viewer-settings", `${safe}.json`);
}

function readSettings(file) {
  if (!file || !fs.existsSync(file)) return {};
  try {
    const raw = fs.readFileSync(file, "utf8");
    const obj = JSON.parse(raw.replace(/^﻿/, ""));
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    throw new Error("not an object");
  } catch {
    try { fs.renameSync(file, `${file}.bak`); } catch { /* 옮기지 못해도 읽기는 기본값으로 */ }
    return {};
  }
}

function writeSettings(file, patch) {
  if (!file) return { ok: false, error: "설정 파일 위치를 정할 수 없습니다." };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "설정 값이 올바르지 않습니다." };
  const next = { ...readSettings(file) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else if (v !== undefined) next[k] = v;
  }
  const text = JSON.stringify(next, null, 2);
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) return { ok: false, error: "설정 파일이 너무 큽니다." };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
  return { ok: true, settings: next, path: file };
}

module.exports = { settingsPath, readSettings, writeSettings, safeViewerId };
