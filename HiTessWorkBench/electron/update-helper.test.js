// 자동 업데이트 헬퍼 VBScript 회귀 테스트.
// 실제 cscript 로 생성된 VBS 를 돌려 자기파괴 버그(destPath == oldPath)를 검증한다.
// Windows 전용 흐름이므로 다른 OS 에서는 건너뛴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { buildUpdateHelperVbs } = require("./update-helper");

const winTest = process.platform === "win32" ? test : test.skip;

function runHelper(root, oldPath, tmpPath) {
  const vbsPath = path.join(root, "helper.vbs");
  fs.writeFileSync(vbsPath, buildUpdateHelperVbs(), "utf8");
  execFileSync("cscript.exe", ["//nologo", vbsPath, oldPath, tmpPath], { stdio: "ignore" });
}

winTest("서버 파일명이 현재 실행 파일과 같아도 새 버전을 지우지 않는다(자기파괴 회귀)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hitess-upd-"));
  try {
    const appDir = path.join(root, "app");
    const dlDir = path.join(root, "download");
    fs.mkdirSync(appDir);
    fs.mkdirSync(dlDir);

    // 동일 파일명 → destPath == oldPath 충돌 재현
    const name = "HiTESS-WorkBench-v1.2.33.cmd";
    const oldPath = path.join(appDir, name);
    const tmpPath = path.join(dlDir, name);
    fs.writeFileSync(oldPath, "@echo OLD\r\n@exit\r\n");
    fs.writeFileSync(tmpPath, "@echo NEW\r\n@exit\r\n");

    runHelper(root, oldPath, tmpPath);

    // destPath(== oldPath) 가 살아있고 새 내용이어야 한다
    assert.ok(fs.existsSync(oldPath), "업데이트 후 실행 파일이 사라짐 (자기파괴 버그)");
    assert.match(fs.readFileSync(oldPath, "utf8"), /NEW/, "새 버전으로 교체되지 않음");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

winTest("서버 파일명이 다르면 구버전을 삭제하고 새 버전을 대상 폴더에 남긴다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hitess-upd-"));
  try {
    const appDir = path.join(root, "app");
    const dlDir = path.join(root, "download");
    fs.mkdirSync(appDir);
    fs.mkdirSync(dlDir);

    const oldPath = path.join(appDir, "HiTESS-WorkBench-v1.2.31.cmd");
    const tmpPath = path.join(dlDir, "HiTESS-WorkBench-v1.2.33.cmd");
    const destPath = path.join(appDir, "HiTESS-WorkBench-v1.2.33.cmd");
    fs.writeFileSync(oldPath, "@exit\r\n");
    fs.writeFileSync(tmpPath, "@echo NEW\r\n@exit\r\n");

    runHelper(root, oldPath, tmpPath);

    assert.ok(fs.existsSync(destPath), "새 버전이 대상 폴더에 없음");
    assert.match(fs.readFileSync(destPath, "utf8"), /NEW/, "대상 파일이 새 버전이 아님");
    assert.ok(!fs.existsSync(oldPath), "구버전이 삭제되지 않음");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
