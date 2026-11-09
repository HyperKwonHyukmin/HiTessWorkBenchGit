// 서버 인증서 고정 규칙(통합 계획 3단계). 인증서는 시험용 localhost 자체 인증서(공개 부분만).
const test = require("node:test");
const assert = require("node:assert/strict");
const pins = require("./server-pins");

const LOCAL_CERT = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUdHDM9+Dy85OGs8P2PtwK2OqkFhcwDQYJKoZIhvcNAQEL
BQAwLDEZMBcGA1UEAwwQSGlURVNTIFdvcmtCZW5jaDEPMA0GA1UECgwGSGlURVNT
MB4XDTI2MTEwNDIzNDIyM1oXDTMxMTEwMzIzNDcyM1owLDEZMBcGA1UEAwwQSGlU
RVNTIFdvcmtCZW5jaDEPMA0GA1UECgwGSGlURVNTMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA7aSaHW0ja1eVLT6n29V32yuLodxeesRic7gsoLY5yYcC
tIc4nix0/sZ4gymBzugEhqEF3JTUsOUSwajMJqyIIIsR57VTbkBtj1ENSoEsSm5B
ZR8UDWGb2FF47VNYmwcxGbmZFQ9ciHQ9l0ZqQqa2xThFfdOOT6+315w7e3QbnKCP
2nVEuRryTJ3NUR3DEIW2MMyt9QbblpFi215ZAfMmFUvQaiXl//tHHGsSgze/BLvF
1b+51niCgU3J6Q4kMWIBoGegJZEq9cYviPMNJSIEKzN+JF7LNbTsWcvztasswub+
HEq8NaZU5Igj9qSNsg1tt5xNyEaE/5B68LBYOo0+IQIDAQABo0EwPzAaBgNVHREE
EzARhwR/AAABgglsb2NhbGhvc3QwDAYDVR0TAQH/BAIwADATBgNVHSUEDDAKBggr
BgEFBQcDATANBgkqhkiG9w0BAQsFAAOCAQEAIroMCzMPAls7ncHYwLf5bJROVq33
D48hHk9PKOPjREkY9YD0hLPj7Ui0RHHl09ZARPkgMF7OcfXp5jlbPBN+Yev2kfoW
AL4TDcYHpCDyjGVJoAeTAM9MP/BKNkKwYBZuG9imSSf/lk4d35Vym8OdT5pVHkXP
8poZhy7YI/fabmhI3w5ibTs9cpkmL7GcZt4nSH/GGx30o9HELMT+uvrNGzV1RmWa
P7lGI3h9wPrUMHBmXZCkhaQGTHmhPMEiEJ2qVbmp/vGnGVMl3lP5yrvnhkCTVY6F
3lqchHVA+NkV+vJmaoBVX8qPtBBjmIXmdnVsnmAkiUQNXIMv74ftFtWSYQ==
-----END CERTIFICATE-----
`;

function verify(opts, hostname, data = LOCAL_CERT) {
  let code = null;
  pins.makeCertificateVerifyProc(opts)({ hostname, certificate: { data } }, (c) => { code = c; });
  return code;
}

test("지문이 맞으면 통과(0) — 주소와 상관없이", () => {
  const pin = pins.spkiPinFromPem(LOCAL_CERT);
  assert.equal(verify({ pins: [pin] }, "localhost"), 0);
  assert.equal(verify({ pins: [pin] }, "10.14.42.145"), 0);
  assert.equal(verify({ extraPins: [pin] }, "10.14.42.145"), 0);
});

test("145 주소인데 지문이 다르면 거부(-2) — 회사가 믿는 인증서를 내밀어도", () => {
  assert.equal(verify({}, "10.14.42.145"), -2);
  assert.equal(verify({}, "HHIPW170658.HDShipGroup.HHI.co.kr"), -2);
  assert.equal(verify({}, "10.14.42.145", "깨진 인증서"), -2);
});

test("그 밖의 주소는 Chromium 기본 검사(-3)", () => {
  assert.equal(verify({}, "localhost"), -3);
  assert.equal(verify({}, "github.com"), -3);
});

test("운영 지문 2개(지금·예비)와 개발 지문은 서로 다르고 sha256 길이", () => {
  const all = [...pins.SERVER_PINS, ...pins.DEV_PINS];
  assert.equal(new Set(all).size, 4);
  for (const p of all) assert.equal(Buffer.from(p, "base64").length, 32);
});

test("옛 145 주소(평문 9091·HTTPS 9443)는 같은 포트 HTTPS 9091 로, 나머지는 그대로", () => {
  assert.equal(pins.secureServerUrl("http://10.14.42.145:9091/"), "https://10.14.42.145:9091");
  assert.equal(pins.secureServerUrl("http://10.14.42.145:9091/api/x"), "https://10.14.42.145:9091/api/x");
  assert.equal(pins.secureServerUrl("http://10.14.42.145:9095"), "http://10.14.42.145:9095");
  assert.equal(pins.secureServerUrl("https://10.14.42.145:9443"), "https://10.14.42.145:9091");
  assert.equal(pins.secureServerUrl("http://10.14.42.145:9443"), "https://10.14.42.145:9091"); // 오타 고친 뒤 9091 로
  assert.equal(pins.secureServerUrl("https://10.14.42.145:9091"), "https://10.14.42.145:9091");
  assert.equal(pins.secureServerUrl("https://HHIPW170658.hdshipgroup.hhi.co.kr:9443"), "https://hhipw170658.hdshipgroup.hhi.co.kr:9091");
  assert.equal(pins.secureServerUrl("http://10.133.122.70:9443/"), "https://10.133.122.70:9443"); // 9443 은 https 전용
  assert.equal(pins.secureServerUrl("http://10.133.122.70:94430"), "http://10.133.122.70:94430");
});

test("serverFetch — http 는 Node fetch, https 는 net.fetch 에 FormData 를 바이트로 바꿔 넘긴다", async () => {
  const calls = [];
  const net = { fetch: async (url, init) => { calls.push({ url, init }); return { ok: true }; } };
  const form = new FormData();
  form.append("file", new Blob(["abc"], { type: "text/plain" }), "a.txt");
  await pins.serverFetch(net, "https://10.14.42.145:9443/x", { method: "POST", body: form });
  const { init } = calls[0];
  assert.ok(Buffer.isBuffer(init.body));
  assert.match(init.headers.get("content-type"), /^multipart\/form-data; boundary=/);
  assert.match(init.body.toString(), /filename="a.txt"[\s\S]*abc/);

  await pins.serverFetch(net, "https://10.14.42.145:9443/y", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(calls[1].init.body, "{}");
  assert.equal(calls[1].init.headers.get("content-type"), "application/json");
});
