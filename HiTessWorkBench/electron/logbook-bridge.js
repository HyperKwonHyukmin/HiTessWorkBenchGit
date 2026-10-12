// Hi-TESS LogBook 창 ↔ WorkBench 본체 다리 — Electron 비의존 순수 로직(단위 테스트 대상).
//
// LogBook 창(open-app-window + bridge:'logbook')에는 전용 preload 가 붙어
// window.hitessBridge.sendModel(payload) 하나만 노출된다. main 은 이 요청을
//   ① 보낸 창이 LogBook 창이고 ② 보낸 프레임의 origin 이 그 창을 연 URL 의 origin 과 같을 때만
// 받아 들이고, 본체 렌더러에 'logbook:model-picked' 로 넘긴다.
// 계약 원본: LogBook 저장소 docs/plans/2026-10-08-logbook-18-workbench-link.md 7절.
"use strict";

const LOGBOOK_WINDOW_KEY = "hitess-logbook";
const LOGBOOK_BRIDGE = "logbook";
const RESULT_TIMEOUT_MS = 15000;
// GMU 페이지가 '받았다(pending)' 고 알린 뒤 가져오기·검증 시작까지 기다리는 상한(백엔드 import 120초 + 여유).
const PENDING_TIMEOUT_MS = 180000;
const PENDING_TIMEOUT_MESSAGE =
  "WorkBench가 모델을 가져오는 데 시간이 너무 오래 걸립니다. WorkBench 화면에서 결과를 확인해 주세요.";
const NOT_OPEN_MESSAGE =
  "WorkBench의 Group & Module Unit 권상 화면이 열려 있지 않습니다. 화면을 연 뒤 다시 보내 주세요.";
const TRUSS_NOT_OPEN_MESSAGE =
  "WorkBench의 Truss Structural Assessment 화면이 열려 있지 않습니다. 화면을 연 뒤 다시 보내 주세요.";
// 받을 수 있는 대상 — gmu = GMU 권상(작업 탭 1..4), truss = Truss Structural Assessment(단일 화면, slot 1 고정).
const VALID_TARGETS = new Set(["gmu", "truss"]);
const NAME_MAX = 200;
const ENTRY_MAX = 64;

/** 대상 화면이 응답하지 않을 때(열려 있지 않음) LogBook 창에 보일 문구. */
function notOpenMessage(target) {
  return target === "truss" ? TRUSS_NOT_OPEN_MESSAGE : NOT_OPEN_MESSAGE;
}

/** URL 의 origin. 잘못된 주소·http(s) 아님이면 null. */
function originOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** 발신 프레임 URL 이 기록된 origin 과 같은가. 둘 중 하나라도 없으면 거부. */
function isAllowedSenderOrigin(frameUrl, allowedOrigin) {
  if (!allowedOrigin) return false;
  const origin = originOf(frameUrl);
  return origin !== null && origin === allowedOrigin;
}

function cleanText(value, maxLen) {
  if (typeof value !== "string") return "";
  // 제어 문자를 빼고 길이를 자른다(본체 화면·토스트에 그대로 쓰인다).
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLen);
}

/**
 * LogBook 창이 보낸 payload 검증.
 * 반환 = { ok:true, value:{target:'gmu'|'truss', slot, fileId, entryId, name} } | { ok:false, message }
 */
function validateSendModelPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "보낼 모델 정보가 올바르지 않습니다." };
  }
  if (!VALID_TARGETS.has(payload.target)) {
    return { ok: false, message: "지원하지 않는 대상입니다." };
  }
  const slot = payload.slot;
  if (!Number.isInteger(slot) || slot < 1 || slot > 4) {
    return { ok: false, message: "작업 번호가 올바르지 않습니다." };
  }
  const fileId = payload.fileId;
  if (!Number.isSafeInteger(fileId) || fileId <= 0) {
    return { ok: false, message: "파일 번호가 올바르지 않습니다." };
  }
  let entryId = null;
  if (payload.entryId !== undefined && payload.entryId !== null) {
    if (typeof payload.entryId !== "string") {
      return { ok: false, message: "Entry 번호가 올바르지 않습니다." };
    }
    entryId = cleanText(payload.entryId, ENTRY_MAX) || null;
  }
  const name = cleanText(payload.name, NAME_MAX);
  const target = payload.target;
  // Truss 는 작업 탭이 없다 — 어떤 번호가 와도 1 로 맞춘다(번호 자체의 1..4 검사는 위에서 같이 한다).
  return { ok: true, value: { target, slot: target === "truss" ? 1 : slot, fileId, entryId, name } };
}

/** 본체 렌더러가 돌려준 결과를 { ok, message } 로 정리한다. */
function normalizeResult(msg) {
  const ok = Boolean(msg && msg.ok);
  const message = cleanText(msg && msg.message, 300)
    || (ok ? "WorkBench로 보냈습니다." : "WorkBench가 모델을 받지 못했습니다.");
  return { ok, message };
}

module.exports = {
  LOGBOOK_WINDOW_KEY,
  LOGBOOK_BRIDGE,
  RESULT_TIMEOUT_MS,
  PENDING_TIMEOUT_MS,
  PENDING_TIMEOUT_MESSAGE,
  NOT_OPEN_MESSAGE,
  TRUSS_NOT_OPEN_MESSAGE,
  notOpenMessage,
  originOf,
  isAllowedSenderOrigin,
  validateSendModelPayload,
  normalizeResult,
};
