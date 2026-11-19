// Studio 사용자 설정 파일 — 없으면 빈 값, 합쳐 저장, 깨진 파일은 .bak, 설치 폴더 밖 위치.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { settingsPath, readSettings, writeSettings } = require("./studio-settings");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "studio-settings-"));
}

test("위치는 viewers 설치 폴더 밖, viewerId 는 글자 제한", () => {
  const p = settingsPath("C:/ud", "module-unit-studio");
  assert.equal(p, path.join("C:/ud", "viewer-settings", "module-unit-studio.json"));
  assert.equal(settingsPath("C:/ud", "../../x"), path.join("C:/ud", "viewer-settings", "x.json"));
  assert.equal(settingsPath("C:/ud", ""), null);
});

test("없으면 빈 값, 저장하면 만들고 합친다(모르는 키 유지, null 은 지움)", () => {
  const file = settingsPath(tmpDir(), "module-unit-studio");
  assert.deepEqual(readSettings(file), {});
  assert.equal(writeSettings(file, { evaluationMode: "advisory", other: 1 }).ok, true);
  assert.deepEqual(readSettings(file), { evaluationMode: "advisory", other: 1 });
  writeSettings(file, { evaluationMode: "strict" });
  assert.deepEqual(readSettings(file), { evaluationMode: "strict", other: 1 });
  writeSettings(file, { other: null });
  assert.deepEqual(readSettings(file), { evaluationMode: "strict" });
});

test("깨진 파일은 .bak 로 옮기고 빈 값으로 읽는다", () => {
  const file = settingsPath(tmpDir(), "module-unit-studio");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{ 깨짐", "utf8");
  assert.deepEqual(readSettings(file), {});
  assert.equal(fs.existsSync(`${file}.bak`), true);
});

test("객체가 아닌 값은 저장하지 않는다", () => {
  const file = settingsPath(tmpDir(), "module-unit-studio");
  assert.equal(writeSettings(file, null).ok, false);
  assert.equal(writeSettings(file, ["a"]).ok, false);
});
