// 등록한 PC 로그인 — 회사 도메인에 없는 계열사 PC 용 (2026-11-10). 서버 routers/device_login.py.
//
// 왜: 계열사 PC 는 도메인에 가입하지 않은 로컬 계정이라(whoami = a590063\a590063) Windows 자동 로그인이 안 되고,
// 회사 Windows 비밀번호를 입력하게 하면 보안 문제로 주목받는다(사용자 결정). 그래서 이 PC 의 열쇠로 본인임을 증명한다.
//
// - 열쇠: Ed25519. 비밀 열쇠는 safeStorage(Windows DPAPI, 지금 Windows 사용자 단위)로 잠가 userData 에 둔다 —
//   같은 PC 의 다른 Windows 계정이나 파일만 복사해 간 곳에서는 풀 수 없다.
// - 서명: SIGN_PREFIX 로 시작하는 글만 서명한다(아무 글이나 서명해 주는 도구가 되지 않게).
// - 저장 단위: 서버 호스트 + 사번. 주소 표기(9443 → 9091, http → https)가 바뀌어도 같은 열쇠를 쓰려고 호스트만 쓴다.
// 네트워크 요청은 하지 않는다 — 화면(axios)이 서버와 주고받고, 여기는 열쇠만 다룬다.

const fs = require("fs");
const crypto = require("crypto");

const SIGN_PREFIX = "hitess-device-login:";
const STORE_FILE = "device-keys.json";

// 도메인에 가입하지 않은 로컬 계정인가 — 로컬 계정은 USERDOMAIN 이 PC 이름(COMPUTERNAME)과 같다.
// 도메인 계정이면 USERDOMAIN = HHI 등. Windows 가 아니면 false(이 기능을 쓰지 않음).
function isLocalAccount(env = process.env, platform = process.platform) {
  if (platform !== "win32") return false;
  const domain = String(env.USERDOMAIN || "").trim().toUpperCase();
  const computer = String(env.COMPUTERNAME || "").trim().toUpperCase();
  if (!computer) return false;
  return !domain || domain === computer;
}

function storeKey(serverUrl, employeeId) {
  let host = "";
  try { host = new URL(String(serverUrl || "")).hostname.toLowerCase(); } catch { return null; }
  const emp = String(employeeId || "").trim().toUpperCase();
  if (!host || !/^[A-Z]\d{5,7}$/.test(emp)) return null;
  return `${host}|${emp}`;
}

function readStore(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(filePath, store) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function rawPublicKey(publicKeyObject) {
  // SPKI DER 의 마지막 32바이트가 Ed25519 공개 열쇠 그 자체다.
  const der = publicKeyObject.export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(der.length - 32)).toString("base64");
}

function createDeviceKeys({ filePath, safeStorage }) {
  const available = () => {
    try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch { return false; }
  };

  // 이 사번의 열쇠(없으면 만든다). 결과 { publicKey, deviceId|null }.
  function ensureKey(serverUrl, employeeId) {
    const key = storeKey(serverUrl, employeeId);
    if (!key) return { error: "invalid_input" };
    if (!available()) return { error: "unavailable" };
    const store = readStore(filePath);
    const entry = store[key];
    if (entry && entry.publicKey && entry.privateKey) {
      return { publicKey: entry.publicKey, deviceId: entry.deviceId ?? null };
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
    store[key] = {
      publicKey: rawPublicKey(publicKey),
      privateKey: safeStorage.encryptString(pkcs8.toString("base64")).toString("base64"),
      deviceId: null,
      createdAt: new Date().toISOString(),
    };
    writeStore(filePath, store);
    return { publicKey: store[key].publicKey, deviceId: null };
  }

  function peek(serverUrl, employeeId) {
    const key = storeKey(serverUrl, employeeId);
    if (!key) return null;
    const entry = readStore(filePath)[key];
    return entry && entry.publicKey ? { publicKey: entry.publicKey, deviceId: entry.deviceId ?? null } : null;
  }

  function setDeviceId(serverUrl, employeeId, deviceId) {
    const key = storeKey(serverUrl, employeeId);
    const id = Number(deviceId);
    if (!key || !Number.isInteger(id) || id <= 0) return false;
    const store = readStore(filePath);
    if (!store[key]) return false;
    store[key].deviceId = id;
    writeStore(filePath, store);
    return true;
  }

  // 해지·거절·만료된 열쇠를 버린다 — 다음 등록 요청은 새 열쇠로.
  function forget(serverUrl, employeeId) {
    const key = storeKey(serverUrl, employeeId);
    if (!key) return false;
    const store = readStore(filePath);
    if (!store[key]) return false;
    delete store[key];
    writeStore(filePath, store);
    return true;
  }

  function sign(serverUrl, employeeId, message) {
    const text = String(message || "");
    if (!text.startsWith(SIGN_PREFIX) || text.length > 300) return { error: "invalid_message" };
    const key = storeKey(serverUrl, employeeId);
    if (!key) return { error: "invalid_input" };
    if (!available()) return { error: "unavailable" };
    const entry = readStore(filePath)[key];
    if (!entry || !entry.privateKey) return { error: "no_key" };
    let privateKey;
    try {
      const b64 = safeStorage.decryptString(Buffer.from(entry.privateKey, "base64"));
      privateKey = crypto.createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
    } catch {
      return { error: "key_unreadable" }; // 다른 Windows 계정·다른 PC 로 옮긴 파일
    }
    return { signature: crypto.sign(null, Buffer.from(text, "utf8"), privateKey).toString("base64") };
  }

  return { available, ensureKey, peek, setDeviceId, forget, sign };
}

module.exports = { createDeviceKeys, isLocalAccount, storeKey, SIGN_PREFIX, STORE_FILE };
