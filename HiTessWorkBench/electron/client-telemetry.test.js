// 크래시 보관함·PC 정보 테스트. 실행: node --test client-telemetry.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const telemetry = require("./client-telemetry");

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-telemetry-"));
  return path.join(dir, "sub", "pending.json");
}

test("보관함은 쌓았다가 꺼내면 비워진다", () => {
  const file = tempFile();
  telemetry.appendPending(file, { kind: "render-process-gone", message: "a" });
  telemetry.appendPending(file, { kind: "child-process-gone", message: "b" });
  const taken = telemetry.takePending(file);
  assert.equal(taken.length, 2);
  assert.ok(taken[0].occurred_at);
  assert.deepEqual(telemetry.takePending(file), []);
});

test("보관함은 최근 MAX_PENDING 건만 남긴다", () => {
  const file = tempFile();
  for (let i = 0; i < telemetry.MAX_PENDING + 5; i += 1) {
    telemetry.appendPending(file, { kind: "x", message: String(i) });
  }
  const list = telemetry.readPending(file);
  assert.equal(list.length, telemetry.MAX_PENDING);
  assert.equal(list[0].message, "5");
});

test("깨진 보관 파일은 빈 목록으로 읽는다", () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{not json", "utf8");
  assert.deepEqual(telemetry.readPending(file), []);
});

test("정상 종료는 크래시로 기록하지 않는다", () => {
  assert.equal(telemetry.renderGoneRecord({ reason: "clean-exit" }), null);
  assert.equal(telemetry.childGoneRecord({ reason: "clean-exit", type: "GPU" }), null);
  const rec = telemetry.renderGoneRecord({ reason: "oom", exitCode: -536870904 }, "Model Studio", "file:///x");
  assert.equal(rec.kind, "render-process-gone");
  assert.equal(rec.extra.window, "Model Studio");
  assert.equal(telemetry.childGoneRecord({ reason: "crashed", type: "GPU" }).extra.type, "GPU");
});

test("PC 정보에 호스트명이 있다", () => {
  const info = telemetry.clientInfo();
  assert.ok(info.hostname.length > 0);
  assert.ok(info.platform.startsWith(process.platform));
});
