// 사용 기록용 클라이언트 정보 + 크래시 보관함.
//
// - clientInfo(): 접속 이력(access_sessions)에 남길 PC 정보. 렌더러가 하트비트에 실어 보낸다.
// - 크래시 보관함: 화면(렌더러)이 죽으면 그 화면은 서버로 보낼 수 없다. 그래서 main 이
//   userData 의 JSON 파일에 쌓아 두고, 다음에 로그인한 화면이 꺼내 서버로 보낸다.
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_PENDING = 50;

function clientInfo() {
  let osUser = "";
  try { osUser = os.userInfo().username || ""; } catch { /* 계정 정보를 못 읽는 환경 */ }
  return {
    hostname: os.hostname() || "",
    os_user: osUser,
    platform: `${process.platform} ${os.release()}`.trim(),
    electron: process.versions.electron || "",
  };
}

function readPending(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendPending(filePath, record) {
  const list = readPending(filePath);
  list.push({ ...record, occurred_at: record.occurred_at || new Date().toISOString() });
  const trimmed = list.slice(-MAX_PENDING);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(trimmed), "utf8");
  } catch {
    // 기록 실패가 앱 동작을 막으면 안 된다.
  }
  return trimmed.length;
}

function takePending(filePath) {
  const list = readPending(filePath);
  try { fs.rmSync(filePath, { force: true }); } catch { /* 다음 번에 다시 보낸다 */ }
  return list;
}

// app 'render-process-gone' 의 details → 보관 레코드. 정상 종료(clean-exit)는 기록하지 않는다.
function renderGoneRecord(details, windowTitle, url) {
  if (!details || details.reason === "clean-exit") return null;
  return {
    kind: "render-process-gone",
    message: `화면 프로세스 종료: ${details.reason}`,
    extra: {
      reason: details.reason,
      exitCode: details.exitCode,
      window: windowTitle || "",
      url: String(url || "").slice(0, 200),
    },
  };
}

// app 'child-process-gone'(GPU·유틸리티 프로세스) → 보관 레코드.
function childGoneRecord(details) {
  if (!details || details.reason === "clean-exit") return null;
  return {
    kind: "child-process-gone",
    message: `${details.type || "child"} 프로세스 종료: ${details.reason}`,
    extra: {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name || details.serviceName || "",
    },
  };
}

module.exports = {
  MAX_PENDING,
  clientInfo,
  readPending,
  appendPending,
  takePending,
  renderGoneRecord,
  childGoneRecord,
};
