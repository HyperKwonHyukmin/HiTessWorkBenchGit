// 실행 인자 — 옛 HiTessMB 가 넘기는 145 평문 주소를 HTTPS 로 바꾸는지(통합 계획 3단계).
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("./args");

const base = ["--employee=A123456", "--job=0123456789abcdef"];

test("145 평문 9091 → https 9443", () => {
  assert.equal(parseArgs(["--server=http://10.14.42.145:9091", ...base]).server, "https://10.14.42.145:9443");
  assert.equal(parseArgs(["--server", "10.14.42.145:9091", ...base]).server, "https://10.14.42.145:9443");
});

test("다른 주소·이미 https 는 그대로", () => {
  assert.equal(parseArgs(["--server=https://10.14.42.145:9443", ...base]).server, "https://10.14.42.145:9443");
  assert.equal(parseArgs(["--server=http://10.133.122.70:9091", ...base]).server, "http://10.133.122.70:9091");
});
