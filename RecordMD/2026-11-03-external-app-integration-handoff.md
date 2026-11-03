# Hi-TESS WorkBench 외부 App 연동 — 현재 작동 체계

- 기준일: 2026-11-03
- 대상: WorkBench 안에서 열리는 외부 웹 App 개발자 (Block Weld · Independent Tank · Heavy Block Lifting · SALA · App Settings 로 등록하는 App)
- 문의: Hi-TESS WorkBench 담당

이 문서는 WorkBench 가 외부 App 을 어떻게 열고, 사용자를 어떻게 알려 주는지 **지금 동작 기준**으로 정리한 것입니다.
외부 App 쪽에서 할 일은 5절(토큰 검증) 하나입니다.

---

## 1. 한눈에

```text
 사용자 PC                         WorkBench 서버 (10.14.42.145:9091)          외부 App 서버
┌──────────────────┐            ┌──────────────────────────────────┐        ┌──────────────────┐
│ WorkBench 앱      │─[실행]────▶│ 로그인 확인 → 실행권 발급(45초)      │        │                  │
│                  │            │                                  │        │ Block Weld :31880│
│ 외부 App 창       │─요청+쿠키─▶│ 게이트웨이 /external-apps/<App>/…   │─요청──▶│ Indep. Tank:31870│
│ (WorkBench 가 띄움)│◀──응답────│  · 세션·계정·출처 확인              │+ 신원  │ Heavy Lift :31860│
└──────────────────┘            │  · 신원 토큰 서명해 붙임            │ 토큰   │ 등록 App   :IP:Port│
                                │ 공개키 /api/external-apps/jwks     │◀─받기──│ (토큰 검증)        │
                                └──────────────────────────────────┘        └──────────────────┘
```

- 사용자는 외부 App 주소를 직접 열지 않습니다. WorkBench 서버 한 주소(`:9091`) 아래 `/external-apps/<App>/` 로 열리고, WorkBench 가 외부 App 서버로 전달합니다.
- 외부 App 은 요청 헤더 **`X-HiTESS-Assertion`**(WorkBench 가 서명한 JWT)으로 로그인한 사람을 확인합니다.
- WorkBench 로그인 토큰·쿠키는 외부 App 으로 넘어가지 않습니다.

App 별 WorkBench 입구와 토큰의 `aud` 값:

| App | WorkBench 입구 | 외부 App 서버 | `aud` |
|---|---|---|---|
| Block Weld Assessment | `/external-apps/block-weld` | `10.14.42.145:31880` | `block-weld` |
| Independent Tank Assessment | `/external-apps/independent-tank` | `10.14.42.145:31870` | `independent-tank` |
| Heavy Block Lifting Simulation | `/external-apps/heavy-block-lifting` | `10.14.42.145:31860` | `heavy-block-lifting` |
| App Settings 로 등록한 App(SALA 등) | `/external-apps/<주소 이름>` | 등록한 IP:Port | 등록한 주소 이름 |

외부 App 서버 주소는 관리자가 App Settings 에서 바꿀 수 있습니다(위는 기본값).

## 2. 세션 — 세 겹

| 겹 | 무엇 | 수명 | 외부 App 이 보나 |
|---|---|---|---|
| 실행권 | 주소의 `?grant=` 일회용 값 | 45초, 1회 | 아니오 |
| 창 세션 | 쿠키 `wb_ext_<App>` (HttpOnly · SameSite=Lax · Path=/external-apps) | 8시간 | 아니오 (WorkBench 가 지우고 넘김) |
| 신원 토큰 | 헤더 `X-HiTESS-Assertion` (RS256 JWT) | 60초 | **예 — 이것으로 사용자 확인** |

### 2.1 App 을 열 때

```text
WorkBench 앱 ──[실행]──▶ WorkBench: 로그인 확인 · App 서비스 상태(점검·개발 중) 확인
                         → 실행권 발급(무작위 값, 45초, 이 App 전용)
외부 App 창 ──실행권 주소로 이동──▶ WorkBench: 실행권을 꺼내 지움(재사용하면 401)
                         → 창 세션 쿠키 발급(8시간, 이 App 전용)
                         → /external-apps/<App>/<사번> 으로 이동
```

### 2.2 그 창의 모든 요청(페이지·API·JS·이미지)마다

1. 창 세션 쿠키 확인 — 없거나 다른 App 것이거나 8시간이 지났으면 **401**
2. WorkBench DB 에서 계정이 아직 활성인지 확인 — 아니면 그 사람의 창 세션을 모두 끊고 **401**
3. 주소 첫 칸이 다른 사람 사번이면 **403**
4. 쓰기 요청(POST·PUT·PATCH·DELETE)은 WorkBench 창에서 온 것만 통과 — 아니면 **403** (4절)
5. 넘기기 전에 지움: WorkBench 로그인 정보, `wb_ext_*` 쿠키, `Forwarded`·`X-Forwarded-*`, 브라우저가 보낸 `X-HiTESS-*`
6. 신원 토큰을 새로 서명해 `X-HiTESS-Assertion` 으로 붙임
7. 외부 App 서버로 전달. 응답의 HTML 은 경로를 보정하고, 외부 App 이 만든 쿠키는 그대로 돌려줌(`wb_ext_*` 이름만 막음)

### 2.3 끝나는 경우

| 상황 | 결과 |
|---|---|
| 창을 연 지 8시간 | 401 — WorkBench 에서 App 을 다시 실행 |
| WorkBench 서버 재시작 | 창 세션이 모두 사라짐 — 다시 실행 |
| 관리자가 계정 비활성화 | 다음 요청부터 401 |
| 토큰을 누가 가로챔 | 60초 뒤 무효, 다른 App 에는 처음부터 무효(`aud`) |
| 외부 App 주소로 직접 접속 | 토큰 없음 — 외부 App 이 5절 검증을 넣었다면 401 |

## 3. 신원 토큰 규격

### 3.1 서명

| 항목 | 값 |
|---|---|
| 헤더 이름 | `X-HiTESS-Assertion` |
| 형식 | JWT (RFC 7519) |
| 알고리즘 | `RS256` 하나만 (RSA 2048, SHA-256) |
| JWT 헤더 | `{"alg": "RS256", "typ": "JWT", "kid": "<키 번호>"}` |
| 공개키(JWKS) | `http://10.14.42.145:9091/api/external-apps/jwks` (로그인 필요 없음) |

공개키로는 토큰을 만들 수 없으니 외부 App 은 비밀값을 보관할 필요가 없습니다.
키를 바꾸는 동안에는 JWKS 에 키가 두 개 들어 있고, 토큰 헤더의 `kid` 로 고릅니다.

### 3.2 내용(claims)

| 이름 | 예 | 뜻 |
|---|---|---|
| `iss` | `hitess-workbench` | 발급자. 항상 이 값 |
| `aud` | `block-weld` | 이 토큰을 받을 App(문자열 하나). **자기 값이 아니면 거부** |
| `sub` | `A123456` | 사번 (JWT 표준 이름) |
| `employee_id` | `A123456` | 사번 (`sub` 와 같음) |
| `display_name` | `홍길동` | 이름 |
| `department` | `구조시스템연구실` | 부서 (없으면 `null`) |
| `company` | `HD현대중공업` | 회사 (없으면 `null`) |
| `role` | `member` | `admin`(WorkBench 관리자) 또는 `member` |
| `modules` | `["block-weld"]` | 열 수 있는 App. 항상 `aud` 하나 |
| `iat` / `exp` | `1793680000` / `1793680060` | 발급·만료 시각(Unix 초). 60초 |
| `jti` | `k3J…` | 토큰 고유 번호 |

이름은 45번 Cookie Manager 의 사용자 정보(`employee_id`·`display_name`·`role`·`modules` …)와 같습니다.

### 3.3 다루는 법

- 토큰은 요청 하나를 위한 것입니다. **저장하거나 다른 서버로 넘기지 마세요. 로그에도 남기지 마세요**(필요하면 길이만).
- 매 요청에 새 토큰이 오므로 외부 App 이 자체 로그인 세션을 만들 필요가 없습니다.
- 작성자·소유자는 토큰의 `employee_id` 로 정합니다. 요청 본문·주소·다른 헤더의 사번을 쓰지 마세요.

## 4. 쓰기 요청 위조 방지 — 외부 App 은 할 일 없음

WorkBench 가 쓰기 요청(POST·PUT·PATCH·DELETE)의 `Origin`(없으면 `Referer`)이 WorkBench 주소와 같을 때만 넘깁니다.
다른 주소의 페이지가 사용자 몰래 보낸 요청은 쿠키가 실려 있어도 WorkBench 가 403 으로 끊습니다(실제 브라우저로 확인).
외부 App 은 CSRF 토큰을 따로 구현하지 않아도 됩니다.

## 5. 외부 App 이 할 일 — 토큰 검증

검증 항목은 다섯 가지입니다: 서명(공개키) · `alg = RS256` · `iss` · `aud` · `exp`. 시계 차이는 30초 여유를 둡니다.
검증 함수를 **한 곳**에 두고 보호할 경로가 모두 그 함수를 먼저 지나게 합니다.

### 5.1 Python (FastAPI · Flask · Starlette)

```bash
pip install "PyJWT[crypto]>=2.8"
```

```python
import jwt
from jwt import PyJWKClient

JWKS_URL = "http://10.14.42.145:9091/api/external-apps/jwks"
APP_AUDIENCE = "block-weld"          # 자기 App 의 aud 값
_jwks = PyJWKClient(JWKS_URL, cache_jwk_set=True, lifespan=3600)


class NotAuthenticated(Exception):
    pass


class AuthUnavailable(Exception):
    """공개키를 받을 수 없음(WorkBench 장애) — 503 으로 응답한다."""


def hitess_user(headers, path_employee_id: str | None = None) -> dict:
    """WorkBench 가 붙인 토큰을 검증하고 사용자 정보를 돌려준다."""
    token = headers.get("X-HiTESS-Assertion")
    if not token:
        raise NotAuthenticated("WorkBench 에서 다시 실행해 주세요.")
    try:
        key = _jwks.get_signing_key_from_jwt(token).key
    except jwt.PyJWKClientConnectionError as exc:
        raise AuthUnavailable("인증 서버에 연결할 수 없습니다.") from exc
    except jwt.PyJWTError as exc:
        raise NotAuthenticated("WorkBench 에서 다시 실행해 주세요.") from exc
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=APP_AUDIENCE,
            issuer="hitess-workbench",
            leeway=30,
            options={"require": ["iss", "aud", "sub", "iat", "exp"]},
        )
    except jwt.PyJWTError as exc:
        raise NotAuthenticated("WorkBench 에서 다시 실행해 주세요.") from exc

    # 주소 첫 칸의 사번을 계속 쓰는 App 이면 토큰과 같은지 확인한다.
    if path_employee_id and path_employee_id.upper() != claims["employee_id"].upper():
        raise NotAuthenticated("주소의 사번이 로그인 사용자와 다릅니다.")
    return claims
```

FastAPI 에서 쓰는 예:

```python
from fastapi import Depends, FastAPI, HTTPException, Request

app = FastAPI()

def current_user(request: Request) -> dict:
    try:
        return hitess_user(request.headers)
    except NotAuthenticated as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except AuthUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))

@app.get("/api/my-jobs")
def my_jobs(user: dict = Depends(current_user)):
    return {"employeeId": user["employee_id"], "name": user["display_name"]}
```

45번 Cookie Manager(`auth_client.py`) 구조를 쓰는 모듈은 `PlatformAuthClient.current_user()` 안의 `/internal/sessions/validate` 호출만
`hitess_user(request.headers)` 로 바꾸고 `User.from_dict(claims)` 로 사용자 객체를 만들면 됩니다. `RequirePlatformSession`·`require_admin()` 은 그대로 쓰고, 쿠키 갱신 헤더는 뺍니다.

### 5.2 .NET 8 (ASP.NET Core) — NuGet 패키지 없이

사내망에서 NuGet 받기가 막힐 수 있어 .NET 기본 기능만 씁니다. `RS256` 이 아닌 토큰(`none`·`HS256`)은 받지 않습니다.

```csharp
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public sealed class HitessAssertionVerifier(HttpClient http, string jwksUrl, string audience)
{
    private const string Issuer = "hitess-workbench";
    private const int LeewaySeconds = 30;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private Dictionary<string, RSA> _keys = new();
    private DateTime _fetchedUtc = DateTime.MinValue;

    /// <summary>검증에 성공하면 토큰 내용, 실패하면 null. 공개키를 받지 못하면 HttpRequestException 등을 그대로 던진다(호출자가 503).</summary>
    public async Task<JsonElement?> VerifyAsync(string? token)
    {
        try
        {
            var parts = token?.Split('.');
            if (parts is not { Length: 3 }) return null;
            using var header = JsonDocument.Parse(Base64Url(parts[0]));
            if (header.RootElement.GetProperty("alg").GetString() != "RS256") return null;
            var kid = header.RootElement.GetProperty("kid").GetString() ?? "";
            var rsa = await KeyAsync(kid);
            if (rsa is null) return null;

            var signed = Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]);
            if (!rsa.VerifyData(signed, Base64Url(parts[2]), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
                return null;

            using var body = JsonDocument.Parse(Base64Url(parts[1]));
            var claims = body.RootElement.Clone();
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (claims.GetProperty("iss").GetString() != Issuer) return null;
            if (claims.GetProperty("aud").GetString() != audience) return null;
            if (claims.GetProperty("exp").GetInt64() + LeewaySeconds < now) return null;
            if (claims.GetProperty("iat").GetInt64() - LeewaySeconds > now) return null;
            if (string.IsNullOrEmpty(claims.GetProperty("employee_id").GetString())) return null;
            return claims;
        }
        catch (Exception e) when (e is FormatException or JsonException or KeyNotFoundException
                                       or InvalidOperationException or CryptographicException)
        {
            return null;
        }
    }

    private async Task<RSA?> KeyAsync(string kid)
    {
        if (_keys.TryGetValue(kid, out var cached) && DateTime.UtcNow - _fetchedUtc < TimeSpan.FromHours(1))
            return cached;
        await _lock.WaitAsync();
        try
        {
            // 모르는 kid 가 계속 와도 1분에 한 번만 다시 받는다.
            if (DateTime.UtcNow - _fetchedUtc > TimeSpan.FromMinutes(1))
            {
                using var doc = JsonDocument.Parse(await http.GetStringAsync(jwksUrl));
                var keys = new Dictionary<string, RSA>();
                foreach (var jwk in doc.RootElement.GetProperty("keys").EnumerateArray())
                {
                    if (jwk.GetProperty("kty").GetString() != "RSA") continue;
                    var rsa = RSA.Create();
                    rsa.ImportParameters(new RSAParameters
                    {
                        Modulus = Base64Url(jwk.GetProperty("n").GetString()!),
                        Exponent = Base64Url(jwk.GetProperty("e").GetString()!),
                    });
                    keys[jwk.GetProperty("kid").GetString()!] = rsa;
                }
                _keys = keys;
                _fetchedUtc = DateTime.UtcNow;
            }
        }
        finally { _lock.Release(); }
        return _keys.GetValueOrDefault(kid);
    }

    private static byte[] Base64Url(string s)
    {
        var b = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(b.PadRight(b.Length + (4 - b.Length % 4) % 4, '='));
    }
}
```

등록 예 — `UseDefaultFiles`·`UseStaticFiles` **앞**에 둡니다(SPA fallback 이 보호 경로를 먼저 가져가지 않게).

```csharp
var verifier = new HitessAssertionVerifier(new HttpClient { Timeout = TimeSpan.FromSeconds(5) },
    "http://10.14.42.145:9091/api/external-apps/jwks", "sala");

app.Use(async (context, next) =>
{
    JsonElement? claims;
    try { claims = await verifier.VerifyAsync(context.Request.Headers["X-HiTESS-Assertion"]); }
    catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
    {
        // 공개키를 받을 수 없음(WorkBench 장애)
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        await context.Response.WriteAsJsonAsync(new { detail = "인증 서버에 연결할 수 없습니다." });
        return;
    }
    if (claims is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { code = "SESSION_INVALID", detail = "WorkBench 에서 다시 실행해 주세요." });
        return;
    }
    context.Items["HitessUser"] = claims;   // 업무 코드는 여기서 employee_id 를 읽는다
    await next(context);
});

app.UseDefaultFiles();
app.UseStaticFiles();
```

### 5.3 Node.js

```bash
npm install jose
```

```js
import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS = createRemoteJWKSet(new URL('http://10.14.42.145:9091/api/external-apps/jwks'))
const APP_AUDIENCE = 'block-weld' // 자기 App 의 aud 값

export async function hitessUser(req) {
  const token = req.headers['x-hitess-assertion']
  if (!token) throw new Error('WorkBench 에서 다시 실행해 주세요.')
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: 'hitess-workbench',
    audience: APP_AUDIENCE,
    algorithms: ['RS256'],
    clockTolerance: 30,
    requiredClaims: ['sub', 'iat', 'exp'],
  })
  return payload
}

// Express 미들웨어
export async function requireHitessUser(req, res, next) {
  try {
    req.hitessUser = await hitessUser(req)
    next()
  } catch {
    res.status(401).json({ detail: 'WorkBench 에서 다시 실행해 주세요.' })
  }
}
```

### 5.4 다른 언어

JWKS(원격 공개키)와 `RS256` 을 지원하는 JWT 라이브러리를 쓰고, 허용 알고리즘을 `RS256` 하나로 고정하세요.

### 5.5 응답 규칙

| 상황 | 응답 |
|---|---|
| 토큰 없음·검증 실패·만료 | **401** `{"code": "SESSION_INVALID", "detail": "WorkBench 에서 다시 실행해 주세요."}` |
| 사용자는 맞지만 그 기능 권한 없음(관리자 전용 등) | **403** |
| 공개키를 받을 수 없음(WorkBench 장애) | **503** |

## 6. 그 밖의 약속

| 항목 | 내용 |
|---|---|
| 연결 상태 확인 | WorkBench 가 외부 App 의 `GET /` 를 토큰 없이 부릅니다. **500 미만이면 정상**으로 봅니다 — 401 은 괜찮고 5xx 는 안 됩니다 |
| 주소 | 사용자는 `/<사번>` 으로 들어옵니다(예전과 같음). 사번은 토큰의 `employee_id` 와 같은지만 보세요 |
| 경로 | `/` 로 시작하는 경로·상대 경로 모두 됩니다. `http://IP:Port/…` 처럼 외부 App 주소를 통째로 쓴 요청은 WorkBench 를 거치지 않아 실패합니다 |
| 새 창 | `window.open`·`target="_blank"` 는 WorkBench 밖 브라우저로 열려 로그인이 없습니다. 같은 창 안에서 이동하세요 |
| 시간 | 요청 하나는 **30초** 안에 응답해야 합니다(넘으면 504). 긴 계산은 시작 → 상태 확인(폴링)으로 나누세요 |
| 크기 | 요청 본문(업로드) **25MB** 까지. 다운로드는 제한 없음 |
| WebSocket | 지원하지 않습니다 |
| 쿠키·localStorage | 모든 외부 App 이 WorkBench 주소 하나에서 열리므로 이름 앞에 App 이름을 붙이세요(예: `blockweld_…`). `wb_ext_` 로 시작하는 쿠키 이름은 쓸 수 없습니다 |
| 공개키 접속 | 외부 App 서버에서 `10.14.42.145:9091` 에 접속할 수 없으면 알려 주세요. 공개키 파일을 따로 드립니다 |

## 7. 적용 순서와 점검

| 단계 | WorkBench | 외부 App | 결과 |
|---|---|---|---|
| 1 | 토큰 헤더·쓰기 출처 확인 적용(145 반영일은 따로 알림) | 할 일 없음 | 예전과 똑같이 동작(헤더를 무시하므로) |
| 2 | — | 5절 검증 적용, 토큰 없는 요청은 401. 옛 사번 진입 페이지는 설정 스위치로 닫았다가 다시 열 수 있게 | 외부 App 직접 접속이 막힘 |
| 3 | 확인 | 아래 점검 통과 | 방화벽 없이도 안전 |

2단계 전에 WorkBench 로 App 을 열어 `X-HiTESS-Assertion` 헤더가 들어오는지 로그로 먼저 확인하세요(토큰 값 대신 길이만).

직접 접속 점검(WorkBench 를 거치지 않고):

```powershell
# 기대: 401 (토큰 없음)
curl.exe -q --noproxy "*" -sS -D - -o NUL --max-time 8 http://10.14.42.145:31880/api/<보호 API>

# 기대: 401 (가짜 토큰)
curl.exe -q --noproxy "*" -sS -D - -o NUL --max-time 8 -H "X-HiTESS-Assertion: a.b.c" http://10.14.42.145:31880/api/<보호 API>

# 기대: 401 또는 옛 페이지 임시 중지 — 200 으로 화면이 열리면 실패
curl.exe -q --noproxy "*" -sS -D - -o NUL --max-time 8 http://10.14.42.145:31880/A123456
```

## 8. 확인된 것과 아닌 것 (2026-11-03)

- 5.1 Python·5.2 .NET 검증 클래스는 시험 키로 실행해 정상 토큰 통과, `aud`·`iss` 다름·만료·`alg none`·본문 변조·모르는 키·깨진 값·빈 값 거부, 공개키 서버 장애 시 503 경로를 확인했습니다.
- WorkBench 게이트웨이 + 가짜 외부 App(5.1 코드 그대로) + 실제 Chrome 으로 실행 → 토큰 검증 → 쓰기 요청 통과 / 다른 주소 페이지의 쓰기 요청 403 / 직접 접속 401 을 확인했습니다.
- 5.2 의 ASP.NET 등록 예와 5.3 Node 예제는 실행하지 않았습니다.
