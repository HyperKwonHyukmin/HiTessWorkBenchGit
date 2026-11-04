# 외부 App 401 SESSION_INVALID 진단 — aud 불일치 (외부 개발자 전달용)

작성: 2026-11-04 · 대상 App: BlockWeld_Test (등록 App, `10.14.42.114:31880`, slug `blockweld-test`)

## 한 줄 결론

**WorkBench는 수정할 것이 없다. 외부 App이 기대하는 `aud` 값을 등록 slug(`blockweld-test`)와 맞추면 된다.**

## 증상

WorkBench에서 이 App을 실행하면 App이 아래를 반환하며 열리지 않는다.

```json
{"type":"https://tools.ietf.org/html/rfc9110#section-15.5.2",
 "title":"WorkBench 에서 다시 실행해 주세요.","status":401,
 "detail":"WorkBench 에서 다시 실행해 주세요.","code":"SESSION_INVALID",
 "traceId":"0HNPQ2HJLCCFM:00000001"}
```

- 이 401은 **WorkBench가 아니라 외부 App(ASP.NET Core)**이 반환한 것이다. (우리 백엔드의 세션 없음 메시지는 `"...세션이 없거나 만료되었습니다. WorkBench에서 다시 실행해주세요."` 붙여쓰기 형식이고, ProblemDetails·`code:SESSION_INVALID`·Kestrel traceId(`0HN...`)는 .NET App 형식이다.)
- App이 신원 토큰 검증을 구현했다는 뜻이며(보안상 긍정), 그 검증이 우리 토큰을 거부하고 있는 상태다.

## 원인 — `aud`(audience) 불일치

WorkBench 게이트웨이가 모든 요청에 붙이는 서명 토큰 `X-HiTESS-Assertion`의 `aud` 클레임에는 **"이 App이 WorkBench에 등록된 slug"**가 들어간다.

| | aud 값 |
|---|---|
| **WorkBench가 보내는 토큰** | `blockweld-test` (= 등록 App의 slug, 화면 경로 `/blockweld-test`) |
| **외부 App이 기대하는 값** | `block-weld` (testkit `sample_app.py:16` `HITESS_AUDIENCE` 기본값, `hitess_test_issuer.py` 도 `--aud block-weld`로 테스트) |

JWT 검증이 `InvalidAudience`로 떨어져 App이 401을 낸다. testkit이 나머지 계약(iss·RS256·JWKS·require 클레임)을 그대로 따르고 있어 **다른 건 모두 맞고 `aud`만 어긋났다.**

근거(외부 개발자 testkit `98_HiTess_External_App_TestKit`):
- `sample_app.py:16` — `APP_AUDIENCE = os.environ.get("HITESS_AUDIENCE", "block-weld")`
- `sample_app.py:42-44` — `algorithms=["RS256"], audience=APP_AUDIENCE, issuer="hitess-workbench"`

## 누가 고치나

| | 판정 | 이유 |
|---|---|---|
| WorkBench 수정 | **아니다** | `aud = 등록 slug`는 멀티 App 게이트웨이의 표준 규약. 바꾸면 다른 모든 App 연동이 함께 깨진다 |
| 외부 App 수정 | **맞다** | App이 `aud`를 `block-weld`로 하드코딩한 게 원인. App은 자기 등록 slug를 **설정값**으로 받아 검증해야 환경(테스트/운영)이 바뀌어도 안 깨진다 |

"이 토큰의 aud가 무엇이 되는지"를 정하는 것은 **보내는 쪽(WorkBench 등록 slug)**이다. 받는 App이 그 규약에 맞춰야 한다.

---

## 외부 App Claude에게 전달할 지시서 (이 아래를 그대로 전달)

> **[Hi-TESS WorkBench 연동] 401 SESSION_INVALID 원인 = aud 불일치. App 쪽 수정 필요**
>
> **원인:** WorkBench 게이트웨이가 `X-HiTESS-Assertion`(JWT)의 `aud` 클레임에 "이 App이 WorkBench에 등록된 slug"를 넣어 보낸다. 현재 이 App의 등록 slug는 **`blockweld-test`**인데, App 검증 코드는 `aud`를 **`block-weld`**로 기대하고 있어 `InvalidAudience`로 거부된다.
>
> **고칠 것:** 검증기의 기대 audience를 **등록 slug(`blockweld-test`)**와 일치시킨다. 하드코딩하지 말고 **환경변수/설정으로 빼서** 등록 slug가 바뀌어도 대응되게 한다.
>
> - **.NET (ASP.NET Core):** `TokenValidationParameters.ValidAudience = "blockweld-test";` (또는 설정 키로 주입하는 `ValidAudiences`)
> - **FastAPI/Python(testkit 기준):** 환경변수 `HITESS_AUDIENCE=blockweld-test`
>
> **나머지는 그대로 유지(이미 맞음):**
> - 알고리즘 **RS256 전용** (`alg:none`·HS256 거부)
> - `issuer = "hitess-workbench"` 필수 대조
> - 서명키는 **JWKS에서 kid로 매칭**해 받는다 — 운영 JWKS = `http://10.14.42.145:9091/api/external-apps/jwks` (키 교체 대비 kid 하드코딩 금지, 캐시 사용)
> - `require: [iss, aud, sub, iat, exp]`, `exp` TTL 60초 + leeway 30초
>
> **고친 뒤에도 401이면 2차 확인:**
> 1. **JWKS 접근** — App이 뜬 호스트(`10.14.42.114`)에서 `http://10.14.42.145:9091/api/external-apps/jwks`에 실제로 HTTP로 닿는지(`curl`로 keys가 오는지). 못 닿으면 서명 검증 불가로 401.
> 2. **시계** — `.114`와 `.145`의 시각차가 30초(leeway)를 넘으면 `exp`로 거부.
>
> **참조:** 「외부 App 연동 — 현재 작동 체계」 문서 3절(토큰 규격)·5절(검증 코드).

---

## 참고 — WorkBench가 실제로 보내는 토큰 (검증 대조용)

```
헤더 이름: X-HiTESS-Assertion
JWT 헤더:  {"alg":"RS256","typ":"JWT","kid":"<공개키 지문>"}
claims:
  iss          = "hitess-workbench"
  aud          = "<등록 slug>"        ← 현재 "blockweld-test"
  sub / employee_id = 사번
  display_name, department, company, role("admin"|"member")
  modules      = ["<등록 slug>"]
  iat, exp     = iat + 60초
  jti
JWKS: /api/external-apps/jwks → {"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":...,"n":...,"e":"AQAB"}]}
```

## 설계 메모

운영에서 이 App이 코드앱 `block-weld`(aud=`block-weld`)로 갈 거면, 테스트 등록앱 slug와 운영 aud가 달라 헷갈린다. App이 `ValidAudiences`로 **여러 aud를 허용**(테스트·운영 둘 다)하게 두면 배포 때 덜 깨진다. 지금은 테스트 목적이므로 등록 slug(`blockweld-test`)에 맞추는 것이 가장 빠르다.
