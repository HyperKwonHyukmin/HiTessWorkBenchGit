// LogBook 다리 검증 로직 회귀 테스트 — 발신 origin 확인과 payload 검증이 느슨해지지 않게 잡는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  originOf, isAllowedSenderOrigin, validateSendModelPayload, normalizeResult,
  notOpenMessage, NOT_OPEN_MESSAGE, TRUSS_NOT_OPEN_MESSAGE,
} = require("./logbook-bridge");

test("originOf 는 http(s) 주소의 origin 만 돌려준다", () => {
  assert.equal(originOf("http://10.14.42.145:9095/sso?code=x"), "http://10.14.42.145:9095");
  assert.equal(originOf("file:///C:/x.html"), null);
  assert.equal(originOf("javascript:alert(1)"), null);
  assert.equal(originOf("not a url"), null);
});

test("발신 프레임 origin 이 기록된 origin 과 같아야 한다", () => {
  const allowed = "http://10.14.42.145:9095";
  assert.equal(isAllowedSenderOrigin("http://10.14.42.145:9095/v/4512", allowed), true);
  assert.equal(isAllowedSenderOrigin("http://10.14.42.145:9091/", allowed), false);
  assert.equal(isAllowedSenderOrigin("https://10.14.42.145:9095/", allowed), false);
  assert.equal(isAllowedSenderOrigin("http://evil.example/", allowed), false);
  assert.equal(isAllowedSenderOrigin("http://10.14.42.145:9095/", null), false);
  assert.equal(isAllowedSenderOrigin(undefined, allowed), false);
});

test("정상 payload 는 정리된 값으로 통과한다", () => {
  const r = validateSendModelPayload({
    target: "gmu", slot: 2, fileId: 4512, entryId: " E000123 ", name: "  3542_m09.bdf\n", extra: "x",
  });
  assert.deepEqual(r, {
    ok: true,
    value: { target: "gmu", slot: 2, fileId: 4512, entryId: "E000123", name: "3542_m09.bdf" },
  });
  const noEntry = validateSendModelPayload({ target: "gmu", slot: 1, fileId: 1, entryId: null, name: "a" });
  assert.equal(noEntry.value.entryId, null);
});

test("잘못된 payload 는 거부한다", () => {
  const base = { target: "gmu", slot: 1, fileId: 10, entryId: null, name: "a" };
  for (const bad of [
    null, [], "x",
    { ...base, target: "bdfscanner" },
    { ...base, slot: 0 }, { ...base, slot: 5 }, { ...base, slot: "2" }, { ...base, slot: 1.5 },
    { ...base, fileId: 0 }, { ...base, fileId: -3 }, { ...base, fileId: "10" }, { ...base, fileId: 2 ** 60 },
    { ...base, entryId: 123 },
  ]) {
    assert.equal(validateSendModelPayload(bad).ok, false, JSON.stringify(bad));
  }
});

test("이름은 길이를 자른다", () => {
  const r = validateSendModelPayload({ target: "gmu", slot: 1, fileId: 1, name: "a".repeat(500) });
  assert.equal(r.value.name.length, 200);
});

test("결과 정리", () => {
  assert.deepEqual(normalizeResult({ ok: true, message: "작업 2로 가져왔습니다." }), { ok: true, message: "작업 2로 가져왔습니다." });
  assert.equal(normalizeResult(null).ok, false);
  assert.equal(normalizeResult({ ok: 1 }).message, "WorkBench로 보냈습니다.");
});

test("truss 대상은 받고 작업 번호를 1 로 맞춘다", () => {
  const r = validateSendModelPayload({ target: "truss", slot: 3, fileId: 77, entryId: null, name: "truss.bdf" });
  assert.deepEqual(r, {
    ok: true,
    value: { target: "truss", slot: 1, fileId: 77, entryId: null, name: "truss.bdf" },
  });
  // 번호 자체의 1..4 검사는 truss 도 같다.
  assert.equal(validateSendModelPayload({ target: "truss", slot: 0, fileId: 1 }).ok, false);
  assert.equal(validateSendModelPayload({ target: "truss", slot: "1", fileId: 1 }).ok, false);
  // gmu 는 번호를 그대로 둔다.
  assert.equal(validateSendModelPayload({ target: "gmu", slot: 3, fileId: 1 }).value.slot, 3);
  assert.equal(validateSendModelPayload({ target: "TRUSS", slot: 1, fileId: 1 }).ok, false);
});

test("화면이 열려 있지 않음 문구는 대상별로 다르다", () => {
  assert.equal(notOpenMessage("gmu"), NOT_OPEN_MESSAGE);
  assert.match(NOT_OPEN_MESSAGE, /Group & Module Unit 권상/);
  assert.equal(notOpenMessage("truss"), TRUSS_NOT_OPEN_MESSAGE);
  assert.equal(
    TRUSS_NOT_OPEN_MESSAGE,
    "WorkBench의 Truss Structural Assessment 화면이 열려 있지 않습니다. 화면을 연 뒤 다시 보내 주세요.",
  );
});
