// Studio 세션 레지스트리 회귀 테스트.
// 검증 대상은 다중 Studio 의 안전 규약이다: IPC 는 '보낸 창'의 컨텍스트로만 해소되어야 하며,
// 절대 다른 Studio 의 컨텍스트로 폴백해서는 안 된다(잘못된 모델에 해석이 걸리는 무증상 사고 방지).
const test = require("node:test");
const assert = require("node:assert/strict");
const { ViewerSessionRegistry, isSourceStale, sessionKeyOf } = require("./viewer-sessions");

// 가짜 BrowserWindow — isDestroyed 만 흉내낸다.
function fakeWin(id) {
  return { id, destroyed: false, isDestroyed() { return this.destroyed; } };
}

function makeRegistryWithTwoStudios() {
  const reg = new ViewerSessionRegistry();
  const mbWin = fakeWin("mb");
  const muWin = fakeWin("mu");
  reg.register({
    viewerId: "model-studio",
    win: mbWin,
    initialFolder: "C:/out/modelbuilder",
    parentAnalysisId: 11,
    outputDir: "C:/server/modelbuilder",
  }, 101);
  reg.register({
    viewerId: "module-unit-studio",
    win: muWin,
    initialFolder: "C:/out/moduleunit",
    parentAnalysisId: 22,
    outputDir: "C:/server/moduleunit",
  }, 202);
  return { reg, mbWin, muWin };
}

test("두 Studio 가 동시에 떠 있어도 각 창은 자기 컨텍스트만 해소한다", () => {
  const { reg } = makeRegistryWithTwoStudios();

  const fromModelBuilder = reg.fromWebContentsId(101);
  const fromModuleUnit = reg.fromWebContentsId(202);

  assert.equal(fromModelBuilder.viewerId, "model-studio");
  assert.equal(fromModelBuilder.parentAnalysisId, 11);
  assert.equal(fromModelBuilder.outputDir, "C:/server/modelbuilder");

  assert.equal(fromModuleUnit.viewerId, "module-unit-studio");
  assert.equal(fromModuleUnit.parentAnalysisId, 22);
  assert.equal(fromModuleUnit.outputDir, "C:/server/moduleunit");
});

test("나중에 연 Studio 가 먼저 연 Studio 의 컨텍스트를 덮어쓰지 않는다(전역 스왑 회귀)", () => {
  const { reg } = makeRegistryWithTwoStudios();

  // 세 번째 Studio 를 추가로 열어도 앞선 두 세션은 그대로여야 한다.
  reg.register({
    viewerId: "side-passage-studio",
    win: fakeWin("sp"),
    initialFolder: "C:/out/sidepassage",
    parentAnalysisId: 33,
    outputDir: "C:/server/sidepassage",
  }, 303);

  assert.equal(reg.fromWebContentsId(101).outputDir, "C:/server/modelbuilder");
  assert.equal(reg.fromWebContentsId(202).outputDir, "C:/server/moduleunit");
  assert.equal(reg.fromWebContentsId(303).outputDir, "C:/server/sidepassage");
});

test("미등록 발신자는 다른 세션으로 폴백하지 않고 null 을 반환한다", () => {
  const { reg } = makeRegistryWithTwoStudios();
  // 999 는 등록된 적 없는 webContents (예: WorkBench 본체, 또는 이미 정리된 창)
  assert.equal(reg.fromWebContentsId(999), null);
});

test("Studio 를 하나도 열지 않았으면 어떤 발신자도 세션을 얻지 못한다", () => {
  const reg = new ViewerSessionRegistry();
  assert.equal(reg.fromWebContentsId(101), null);
  assert.deepEqual(reg.live(), []);
});

test("창이 닫히면 세션과 webContents 역매핑이 함께 사라진다", () => {
  const { reg, mbWin } = makeRegistryWithTwoStudios();

  mbWin.destroyed = true;
  reg.remove("model-studio", 101, mbWin);

  // 닫힌 Studio 의 컨텍스트는 더 이상 해소되지 않는다.
  assert.equal(reg.fromWebContentsId(101), null);
  assert.equal(reg.get("model-studio"), null);
  // 살아 있는 다른 Studio 는 영향 없음.
  assert.equal(reg.fromWebContentsId(202).viewerId, "module-unit-studio");
});

test("webContents.id 가 재사용돼도 닫힌 Studio 의 컨텍스트가 되살아나지 않는다", () => {
  const { reg, mbWin } = makeRegistryWithTwoStudios();
  mbWin.destroyed = true;
  reg.remove("model-studio", 101, mbWin);

  // 같은 id(101)로 전혀 다른 Studio 가 새로 열린 상황
  const newWin = fakeWin("sp");
  reg.register({
    viewerId: "side-passage-studio",
    win: newWin,
    initialFolder: "C:/out/sidepassage",
    outputDir: "C:/server/sidepassage",
  }, 101);

  assert.equal(reg.fromWebContentsId(101).viewerId, "side-passage-studio");
  assert.equal(reg.fromWebContentsId(101).outputDir, "C:/server/sidepassage");
});

test("같은 Studio 를 다른 모델로 재오픈하면 컨텍스트가 새 모델로 교체된다", () => {
  const { reg, muWin } = makeRegistryWithTwoStudios();

  reg.register({
    viewerId: "module-unit-studio",
    win: muWin,                       // 같은 창 재사용
    initialFolder: "C:/out/moduleunit-v2",
    parentAnalysisId: 99,
    outputDir: "C:/server/moduleunit-v2",
  }, 202);

  const s = reg.fromWebContentsId(202);
  assert.equal(s.parentAnalysisId, 99);
  assert.equal(s.outputDir, "C:/server/moduleunit-v2");
  // 다른 Studio 는 그대로.
  assert.equal(reg.fromWebContentsId(101).outputDir, "C:/server/modelbuilder");
});

test("live() 는 살아 있는 세션만 돌려주고 죽은 세션은 정리한다", () => {
  const { reg, mbWin } = makeRegistryWithTwoStudios();
  assert.equal(reg.live().length, 2);

  mbWin.destroyed = true;             // 창은 죽었지만 remove 가 아직 안 불린 상태
  const alive = reg.live();
  assert.equal(alive.length, 1);
  assert.equal(alive[0].viewerId, "module-unit-studio");
  assert.equal(reg.get("model-studio"), null);
});

test("windowOf 는 죽은 창을 null 로 걸러낸다(닫힌 Studio 로 progress 전송 방지)", () => {
  const { reg, muWin } = makeRegistryWithTwoStudios();
  const session = reg.fromWebContentsId(202);
  assert.equal(reg.windowOf(session), muWin);

  muWin.destroyed = true;
  assert.equal(reg.windowOf(session), null);
  assert.equal(reg.windowOf(null), null);
});

// ── 원본 모델 갱신 판정 ────────────────────────────────────────────────
// 배너는 '정말 모델이 갈아엎힌 경우'에만 떠야 한다. 매번 뜨면 사용자가 무시하게 되고,
// 그러면 애초에 이 경고를 넣은 이유(잘못된 모델에 해석이 걸리는 무증상 사고)가 사라진다.

test("모델이 새 산출물로 바뀌면 갱신으로 판정한다", () => {
  assert.equal(isSourceStale({ sourceKey: "C:/out/build-1" }, "C:/out/build-2"), true);
});

test("같은 모델이면 갱신이 아니다(거짓 경보 방지)", () => {
  assert.equal(isSourceStale({ sourceKey: "C:/out/build-1" }, "C:/out/build-1"), false);
});

test("식별자를 모르면 경보하지 않는다(판단 불가는 침묵)", () => {
  assert.equal(isSourceStale({ sourceKey: null }, "C:/out/build-2"), false);
  assert.equal(isSourceStale({ sourceKey: "C:/out/build-1" }, null), false);
  assert.equal(isSourceStale({ sourceKey: "C:/out/build-1" }, undefined), false);
  assert.equal(isSourceStale({}, "C:/out/build-2"), false);
  assert.equal(isSourceStale(null, "C:/out/build-2"), false);
});

// ── 모델별 창(model-studio): Model Builder 작업 탭마다 자기 Studio 를 띄운다 ──

test("model-studio 는 모델(sourceKey)마다 다른 세션 키를 쓴다", () => {
  const a = sessionKeyOf("model-studio", "C:\\userConnection\\A\\20261002_100000");
  const b = sessionKeyOf("model-studio", "C:\\userConnection\\B\\20261002_100500");
  assert.notEqual(a, b);
  assert.notEqual(a, "model-studio");
});

test("같은 모델은 경로 표기가 달라도 같은 키다(역슬래시·대소문자·끝 슬래시)", () => {
  assert.equal(
    sessionKeyOf("model-studio", "C:\\UserConnection\\A\\out\\"),
    sessionKeyOf("model-studio", "c:/userconnection/a/out"),
  );
});

test("sourceKey 를 모르면 viewerId 하나로 묶는다(같은 창이 쌓이지 않게)", () => {
  assert.equal(sessionKeyOf("model-studio", null), "model-studio");
  assert.equal(sessionKeyOf("model-studio", "   "), "model-studio");
});

test("모델별 창 목록에 없는 Studio 는 sourceKey 가 있어도 viewerId 당 창 1개다", () => {
  assert.equal(sessionKeyOf("mooring-fitting-studio", "C:/a.bdf"), "mooring-fitting-studio");
  assert.equal(sessionKeyOf("side-passage-studio", "C:/a.bdf"), "side-passage-studio");
});

test("GMU 권상(module-unit-studio)도 검증한 BDF 마다 창을 따로 둔다", () => {
  assert.notEqual(
    sessionKeyOf("module-unit-studio", "C:/uc/A/A.bdf"),
    sessionKeyOf("module-unit-studio", "C:/uc/B/B.bdf"),
  );
});

test("두 모델의 model-studio 가 동시에 떠도 각 창은 자기 모델 컨텍스트만 해소한다", () => {
  const reg = new ViewerSessionRegistry();
  const winA = fakeWin("a");
  const winB = fakeWin("b");
  const keyA = sessionKeyOf("model-studio", "C:/out/A");
  const keyB = sessionKeyOf("model-studio", "C:/out/B");
  reg.register({ viewerId: "model-studio", sessionKey: keyA, win: winA, outputDir: "C:/out/A" }, 301);
  reg.register({ viewerId: "model-studio", sessionKey: keyB, win: winB, outputDir: "C:/out/B" }, 302);

  assert.equal(reg.fromWebContentsId(301).outputDir, "C:/out/A");
  assert.equal(reg.fromWebContentsId(302).outputDir, "C:/out/B");
  assert.equal(reg.liveOfViewer("model-studio").length, 2);

  // A 창을 닫아도 B 는 그대로 남는다.
  winA.destroyed = true;
  reg.remove(keyA, 301, winA);
  assert.equal(reg.fromWebContentsId(301), null);
  assert.equal(reg.fromWebContentsId(302).outputDir, "C:/out/B");
  assert.equal(reg.liveOfViewer("model-studio").length, 1);
});
