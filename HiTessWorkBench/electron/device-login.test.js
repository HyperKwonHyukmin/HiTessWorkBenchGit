const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { createDeviceKeys, isLocalAccount, storeKey, SIGN_PREFIX } = require("./device-login");

// safeStorage 대역 — 실제는 Windows DPAPI. 여기선 뒤집기만 해 '평문 그대로 저장되지 않음'을 확인한다.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s.split("").reverse().join(""), "utf8"),
  decryptString: (b) => b.toString("utf8").split("").reverse().join(""),
};

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devkeys-")), "device-keys.json");
}

test("로컬 계정 판별 — USERDOMAIN 이 PC 이름이면 로컬", () => {
  assert.equal(isLocalAccount({ USERDOMAIN: "A590063", COMPUTERNAME: "A590063" }, "win32"), true);
  assert.equal(isLocalAccount({ USERDOMAIN: "a590063", COMPUTERNAME: "A590063" }, "win32"), true);
  assert.equal(isLocalAccount({ USERDOMAIN: "HHI", COMPUTERNAME: "HHI-PC01" }, "win32"), false);
  assert.equal(isLocalAccount({ USERDOMAIN: "VMDC", COMPUTERNAME: "VDI-123" }, "win32"), false);
  assert.equal(isLocalAccount({ USERDOMAIN: "A590063", COMPUTERNAME: "A590063" }, "linux"), false);
});

test("저장 키 = 서버 호스트 + 사번 (포트·프로토콜이 바뀌어도 같은 열쇠)", () => {
  assert.equal(storeKey("https://10.14.42.145:9091", "a590063"), "10.14.42.145|A590063");
  assert.equal(storeKey("http://10.14.42.145:9443/", "A590063"), "10.14.42.145|A590063");
  assert.equal(storeKey("not a url", "A590063"), null);
  assert.equal(storeKey("https://10.14.42.145", "홍길동"), null);
});

test("열쇠 만들기·다시 읽기·서명이 공개 열쇠로 확인된다", () => {
  const file = tmpFile();
  const keys = createDeviceKeys({ filePath: file, safeStorage: fakeSafeStorage });
  const first = keys.ensureKey("https://10.14.42.145:9091", "A590063");
  assert.equal(first.deviceId, null);
  assert.equal(Buffer.from(first.publicKey, "base64").length, 32);
  const again = keys.ensureKey("https://10.14.42.145:9443", "a590063");
  assert.equal(again.publicKey, first.publicKey);

  // 비밀 열쇠가 평문으로 저장되지 않는다
  const raw = fs.readFileSync(file, "utf8");
  const stored = JSON.parse(raw)["10.14.42.145|A590063"].privateKey;
  assert.throws(() => crypto.createPrivateKey({ key: Buffer.from(stored, "base64"), format: "der", type: "pkcs8" }));

  const message = `${SIGN_PREFIX}7:nonce-abc`;
  const { signature } = keys.sign("https://10.14.42.145:9091", "A590063", message);
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(first.publicKey, "base64")]);
  const pub = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  assert.equal(crypto.verify(null, Buffer.from(message), pub, Buffer.from(signature, "base64")), true);
});

test("정해진 머리가 아닌 글은 서명하지 않는다", () => {
  const keys = createDeviceKeys({ filePath: tmpFile(), safeStorage: fakeSafeStorage });
  keys.ensureKey("https://10.14.42.145", "A590063");
  assert.equal(keys.sign("https://10.14.42.145", "A590063", "anything else").error, "invalid_message");
  assert.equal(keys.sign("https://10.14.42.145", "A111111", `${SIGN_PREFIX}1:x`).error, "no_key");
});

test("기기 번호 저장·잊기", () => {
  const keys = createDeviceKeys({ filePath: tmpFile(), safeStorage: fakeSafeStorage });
  const { publicKey } = keys.ensureKey("https://10.14.42.145", "A590063");
  assert.equal(keys.setDeviceId("https://10.14.42.145", "A590063", 12), true);
  assert.deepEqual(keys.peek("https://10.14.42.145:9091", "A590063"), { publicKey, deviceId: 12 });
  assert.equal(keys.forget("https://10.14.42.145", "A590063"), true);
  assert.equal(keys.peek("https://10.14.42.145", "A590063"), null);
  const fresh = keys.ensureKey("https://10.14.42.145", "A590063");
  assert.notEqual(fresh.publicKey, publicKey);
});

test("safeStorage 를 못 쓰면 열쇠를 만들지 않는다", () => {
  const keys = createDeviceKeys({ filePath: tmpFile(), safeStorage: { isEncryptionAvailable: () => false } });
  assert.equal(keys.ensureKey("https://10.14.42.145", "A590063").error, "unavailable");
});
