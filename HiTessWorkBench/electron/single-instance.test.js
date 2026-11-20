// 중복 실행 막기 — 배포 exe 만 잠그고, 두 번째 실행은 끝내며 기존 창을 앞으로 가져온다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { installSingleInstance } = require("./single-instance");

function fakeApp({ isPackaged = true, gotLock = true, ready = true } = {}) {
  const app = {
    isPackaged, quitCalled: 0, lockCalls: 0, handlers: {},
    requestSingleInstanceLock() { this.lockCalls += 1; return gotLock; },
    quit() { this.quitCalled += 1; },
    on(name, fn) { this.handlers[name] = fn; },
    isReady() { return ready; },
  };
  return app;
}

function fakeWindow({ minimized = false, destroyed = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  };
}

test("개발 실행은 잠그지 않는다", () => {
  const app = fakeApp({ isPackaged: false });
  const ok = installSingleInstance({ app, getMainWindow: () => null, getAllWindows: () => [], createWindow() {} });
  assert.equal(ok, true);
  assert.equal(app.lockCalls, 0);
  assert.equal(app.handlers["second-instance"], undefined);
});

test("이미 실행 중이면 이 실행을 끝낸다", () => {
  const app = fakeApp({ gotLock: false });
  const ok = installSingleInstance({ app, getMainWindow: () => null, getAllWindows: () => [], createWindow() {} });
  assert.equal(ok, false);
  assert.equal(app.quitCalled, 1);
  assert.equal(app.handlers["second-instance"], undefined);
});

test("두 번째 실행이 오면 최소화된 본창을 복원해 앞으로 가져온다", () => {
  const app = fakeApp();
  const main = fakeWindow({ minimized: true });
  assert.equal(installSingleInstance({ app, getMainWindow: () => main, getAllWindows: () => [main], createWindow() {} }), true);
  app.handlers["second-instance"]();
  assert.deepEqual(main.calls, ["restore", "show", "focus"]);
  assert.equal(app.quitCalled, 0);
});

test("본창이 닫혀 있으면 남은 창을, 창이 없으면 본창을 새로 만든다", () => {
  const app = fakeApp();
  const studio = fakeWindow();
  let windows = [studio];
  let created = 0;
  installSingleInstance({
    app, getMainWindow: () => fakeWindow({ destroyed: true }), getAllWindows: () => windows,
    createWindow: () => { created += 1; },
  });
  app.handlers["second-instance"]();
  assert.deepEqual(studio.calls, ["show", "focus"]);
  windows = [];
  app.handlers["second-instance"]();
  assert.equal(created, 1);
});
