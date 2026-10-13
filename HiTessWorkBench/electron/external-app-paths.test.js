"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { externalAppBinding, redirectIntoExternalApp } = require("./external-app-paths");

const API = "http://10.14.42.145:9091";

test("프록시로 연 창만 기준점을 가진다", () => {
  assert.deepEqual(
    externalAppBinding(`${API}/external-apps/block-weld/__wb_bootstrap?grant=abc`),
    { origin: API, base: "/external-apps/block-weld" },
  );
  assert.deepEqual(
    externalAppBinding(`${API}/external-apps/block-lug`),
    { origin: API, base: "/external-apps/block-lug" },
  );
  // LogBook 처럼 다른 서버를 직접 여는 창, 이상한 주소는 대상이 아니다.
  assert.equal(externalAppBinding("http://10.14.42.145:9095/models"), null);
  assert.equal(externalAppBinding(`${API}/api/app-settings`), null);
  assert.equal(externalAppBinding("file:///C:/x.html"), null);
  assert.equal(externalAppBinding("not a url"), null);
});

test("같은 서버의 프록시 밖 요청만 앱 경로 아래로 돌린다", () => {
  const binding = externalAppBinding(`${API}/external-apps/block-lug/__wb_bootstrap?grant=x`);
  // 새로고침·뒤로 가기(주소창이 /<사번>)
  assert.equal(
    redirectIntoExternalApp(`${API}/A100001/page2?tab=1#top`, binding),
    `${API}/external-apps/block-lug/A100001/page2?tab=1#top`,
  );
  // CSS url(/…)·JS 로 만든 이미지
  assert.equal(
    redirectIntoExternalApp(`${API}/assets/dot.png`, binding),
    `${API}/external-apps/block-lug/assets/dot.png`,
  );
  // 이미 프록시 경로·다른 앱 경로·다른 서버는 그대로
  assert.equal(redirectIntoExternalApp(`${API}/external-apps/block-lug/assets/a.js`, binding), null);
  assert.equal(redirectIntoExternalApp(`${API}/external-apps/block-weld/A1`, binding), null);
  assert.equal(redirectIntoExternalApp(`${API}/external-apps/block-lug`, binding), null);
  assert.equal(redirectIntoExternalApp("https://cdn.example.com/lib.js", binding), null);
  assert.equal(redirectIntoExternalApp("http://10.14.42.145:31890/A1", binding), null);
  assert.equal(redirectIntoExternalApp(`${API}/A1`, null), null);
});
