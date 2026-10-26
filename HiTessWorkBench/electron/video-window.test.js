// 영상 전용 창 재생 요청 검증 — 이 창에 임의 주소를 띄우지 못하게 잡는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildVideoInfo } = require("./video-window");

const base = { apiBase: "http://10.14.42.145:9091", streamPath: "/api/videos/stream/abc?t=1.2.3", title: "제목", watermark: "홍길동 A1" };

test("API 서버 + 스트리밍 경로만 재생 주소로 만든다", () => {
  const info = buildVideoInfo(base);
  assert.equal(info.url, "http://10.14.42.145:9091/api/videos/stream/abc?t=1.2.3");
  assert.equal(info.title, "제목");
  assert.equal(info.watermark, "홍길동 A1");
});

test("다른 경로·다른 서버·잘못된 주소는 거절한다", () => {
  assert.ok(buildVideoInfo({ ...base, streamPath: "/api/download?filepath=x" }).error);
  assert.ok(buildVideoInfo({ ...base, streamPath: "//evil.example/api/videos/stream/a" }).error);
  assert.ok(buildVideoInfo({ ...base, streamPath: "/api/videos/stream/../../download" }).error);
  assert.ok(buildVideoInfo({ ...base, apiBase: "file:///C:/" }).error);
  assert.ok(buildVideoInfo({ ...base, apiBase: "not a url" }).error);
  assert.ok(buildVideoInfo(null).error);
});

test("제목이 없으면 기본 제목, 긴 글자는 자른다", () => {
  assert.equal(buildVideoInfo({ ...base, title: "" }).title, "HiTESS 영상");
  assert.equal(buildVideoInfo({ ...base, watermark: "가".repeat(100) }).watermark.length, 60);
});
