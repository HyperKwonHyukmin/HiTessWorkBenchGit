# 외부 App 사용자 신원 전달 — 서명된 신원 헤더 계획서

- 작성일: 2026-11-03 (같은 날 개정 2 — Cookie Manager(45번) 구조 통합)
- 상태: **WorkBench 쪽 구현됨(2026-11-03, 미커밋·145 미반영)** — 외부 App 쪽 검증(2단계)은 각 App 일정
- 대상: WorkBench 안에서 열리는 외부 웹 App 개발자 (Block Weld · Independent Tank · Heavy Block Lifting · SALA(SubAssy Lug Arrange) · App Settings 로 등록한 App)
- 문의: Hi-TESS WorkBench 담당

> **개정 2 요약** — 45번 Cookie Manager 의 모듈 쪽 구조(사용자 확인 함수 한 곳, 401/403/503 구분, 옛 페이지 임시 차단 스위치, 무쿠키 점검, 시험 도구)를 그대로 쓰고,
> 신원은 WorkBench 한 곳에서 발급한다. 토큰 내용 이름을 Cookie Manager 의 사용자 정보(`employee_id`·`display_name`·`role`·`modules` …)와 맞췄고,
> 쓰기 요청의 위조 방지(CSRF)는 WorkBench 게이트웨이가 맡는다. .NET 은 NuGet 없이 검증하는 예제를 넣었다. 대응표는 7절.

---

## 1. 왜 바꾸나

지금 외부 App 은 **주소의 첫 칸**(`/A123456`)을 보고 로그인한 사람을 정합니다.

WorkBench 를 거쳐 들어오면 문제가 없습니다. WorkBench 가 로그인과 계정 상태를 확인하고, 다른 사람 사번 주소를 막기 때문입니다.
그러나 외부 App 주소(예: `http://10.14.42.145:31880/`)로 **직접** 들어오면 이 확인을 거치지 않습니다.
주소의 사번만 바꾸면 다른 사람으로 들어갈 수 있습니다. 지금은 방화벽 설정에만 기대고 있습니다.

바꾼 뒤에는 WorkBench 가 요청마다 **위조할 수 없는 신원 증명(서명된 토큰)** 을 붙여 보냅니다.
외부 App 은 이 토큰을 검증해서 사용자를 정합니다. 직접 들어온 요청에는 토큰이 없으므로 거부할 수 있습니다.

### 1.1 별도 로그인 플랫폼(Cookie Manager 방식)을 운영에 세우지 않는 이유

45번 Cookie Manager 는 별도 플랫폼이 로그인·세션을 갖고, 모듈이 요청마다 플랫폼에 세션을 물어보는 구조입니다. 운영에 그대로 세우지 않고 모듈 쪽 구조만 가져옵니다.

| 이유 | 내용 |
|---|---|
| 로그인이 두 개가 됨 | WorkBench 로그인과 별개로 플랫폼 로그인·세션 DB 가 생기고, 계정 상태를 두 곳에서 판단한다 |
| 운영 주소가 HTTP | Cookie Manager 와 SALA 패치는 loopback 이 아닌 HTTP 주소를 거부한다. 145 는 `http://10.14.42.145` 다 |
| 앱 포트가 브라우저에 열려야 함 | 쿠키를 같은 호스트의 다른 포트로 보내는 방식이라, 이 계획이 막으려는 직접 접속 경로가 오히려 필요하다 |
| 프록시가 쿠키를 넘기지 않음 | WorkBench 프록시는 자기 세션 쿠키(`wb_ext_*`)를 지우고 넘긴다 |

사용자 원본은 두 방식 모두 같은 WorkBench MySQL `users` 테이블이라, 신원 발급을 WorkBench 로 모아도 잃는 정보가 없습니다.

### 1.2 세션이 발급되고 처리되는 흐름

세션은 세 겹입니다. 겹마다 수명과 보관 위치가 다르고, 외부 App 이 직접 보는 것은 맨 마지막 토큰뿐입니다.

| 겹 | 무엇 | 수명 | 보관 | 누가 봄 |
|---|---|---|---|---|
| ① WorkBench 로그인 세션 | `Authorization: Bearer <토큰>` | WorkBench 로그인 정책 | WorkBench 서버 | WorkBench API 만. 외부 App 으로 넘어가지 않음 |
| ② 실행권(grant) | 주소의 `?grant=` 일회용 값 | **45초, 1회** | 서버 메모리 | 게이트웨이(쿠키로 바꿀 때 한 번) |
| ③ 외부 App 창 세션 | 쿠키 `wb_ext_<App>` (HttpOnly, SameSite=Lax, Path=/external-apps) | **8시간** | 서버 메모리 | 게이트웨이(요청마다) |
| ④ 신원 토큰 | 헤더 `X-HiTESS-Assertion` (RS256 JWT) | **60초** | 저장 안 함(요청마다 새로 서명) | **외부 App** |

**1) 실행 — WorkBench 앱에서 [실행] 을 누를 때**

```text
WorkBench 앱 ──POST /external-apps/<App>/__wb_bootstrap (Bearer ①)──▶ 게이트웨이
   · 로그인 확인, App 서비스 상태(점검·개발 중) 확인
   · 실행권 ② 발급 (무작위 32바이트, 45초, 이 App 전용)
◀── { launchPath: "/external-apps/<App>/__wb_bootstrap?grant=②" }

외부 App 창(Electron) ──GET launchPath──▶ 게이트웨이
   · ② 를 꺼내 지운다(다시 쓰면 401)
   · 창 세션 ③ 발급 (무작위, 8시간, 이 App 전용) → Set-Cookie wb_ext_<App>
◀── 303 → /external-apps/<App>/<사번>
```

로그인 토큰 ① 은 주소·쿠키 어디에도 들어가지 않습니다. 창에는 이 App 에서만 통하는 쿠키 ③ 만 남습니다.

**2) 사용 — 그 창에서 일어나는 모든 요청(페이지·API·JS·이미지)**

```text
창 ──요청 + 쿠키 ③──▶ 게이트웨이
   1. ③ 확인: 있나 · 이 App 것인가 · 8시간 안인가          → 아니면 401
   2. DB 에서 계정 다시 확인: 있고 활성인가                  → 아니면 그 사람의 모든 ③ 폐기 + 401
   3. 주소 첫 칸이 다른 사람 사번인가                        → 403
   4. 쓰기 요청(POST·PUT·PATCH·DELETE)이면 출처가 WorkBench 인가 → 아니면 403
   5. 넘기기 전에 지움: Authorization(①), wb_ext_* 쿠키(③), Forwarded·X-Forwarded-*, 브라우저가 보낸 X-HiTESS-*
   6. 신원 토큰 ④ 서명: 사번·이름·부서·회사·역할·aud(이 App)·60초  → 서명 실패면 503
   7. 외부 App(App Settings 의 IP·Port)으로 전달
                                     ──요청 + ④──▶ 외부 App: ④ 검증 → 사용자 확정
◀── 응답: HTML 은 경로 보정, 외부 App 쿠키는 wb_ext_* 이름만 막고 통과
```

**3) 끝나는 경우**

| 상황 | 결과 |
|---|---|
| 창을 연 지 8시간 | ③ 만료 → 401, WorkBench 에서 다시 실행 |
| WorkBench 서버 재시작 | ②·③ 이 메모리에 있어 모두 사라짐 → 다시 실행 |
| 관리자가 계정 비활성화 | 다음 요청에서 그 사람의 ③ 전부 폐기 → 401 |
| 토큰 ④ 를 누가 가로챔 | 60초 뒤 무효, 다른 App(aud 다름)에는 처음부터 무효 |
| 외부 App 주소로 직접 접속 | ④ 가 없음 → 외부 App 이 검증을 넣었다면 401 |

**4) 서명 키**

④ 는 WorkBench 서버만 가진 개인키로 서명합니다(`HiTessWorkBenchBackEnd/.secrets/external_app_signing_key.pem`, 처음 쓸 때 자동 생성, git 제외).
외부 App 은 `GET /api/external-apps/jwks` 의 공개키로 검증합니다. 공개키는 위조에 쓸 수 없어 아무나 받아도 됩니다.
서버(70·145)마다 키가 따로라 토큰도 서버별입니다. 키를 바꾸면 이전 키를 `*.previous.pem` 으로 같은 폴더에 두어 하루 동안 JWKS 에 함께 싣습니다.

## 2. 외부 App 개발자가 할 일 요약

1. 요청 헤더 `X-HiTESS-Assertion` 의 토큰을 **검증**하는 함수를 **한 곳**에 둡니다(4절 예제). 모든 보호 경로가 이 함수를 먼저 지나게 합니다.
2. 사용자 사번은 토큰의 `employee_id` 에서 읽습니다. 요청 본문·주소·다른 헤더의 사번을 작성자로 쓰지 않습니다. 주소 첫 칸의 사번은 토큰과 같은지만 확인합니다.
3. 토큰이 없거나 검증에 실패하면 **401**, 권한이 없으면 **403** 으로 응답합니다(4.4절).

비밀값을 받아 보관할 필요는 없습니다. WorkBench 가 공개하는 **공개키**만 있으면 검증할 수 있습니다.
공개키로는 토큰을 만들 수 없으므로 외부 App 서버가 털려도 신원을 위조할 수 없습니다.

## 3. 토큰 규격

### 3.1 전달 방식

- 헤더 이름: `X-HiTESS-Assertion`
- 값: JWT (JSON Web Token, RFC 7519) 한 줄
- WorkBench 를 거친 **모든 요청**(페이지·API·JS·CSS·이미지)에 붙습니다.
- 브라우저가 보낸 `X-HiTESS-*` 헤더는 WorkBench 가 지운 뒤 자기 값을 붙입니다. 사용자가 이 헤더를 직접 만들어 넣을 수 없습니다.

### 3.2 서명

| 항목 | 값 |
|---|---|
| 알고리즘 | `RS256` (RSA 2048, SHA-256) 하나만 |
| JWT 헤더 | `{"alg": "RS256", "typ": "JWT", "kid": "<키 번호>"}` |
| 공개키 주소 (JWKS) | `http://10.14.42.145:9091/api/external-apps/jwks` (인증 없음) |

`kid` 는 키를 바꿀 때 쓰는 키 번호입니다. 키를 교체하는 동안에는 JWKS 에 키가 두 개 들어 있습니다.

### 3.3 토큰 내용 (claims)

이름은 45번 Cookie Manager 의 사용자 정보(`/internal/sessions/validate` 응답의 `user`)와 같게 했습니다. 그 구조로 만든 모듈 코드는 사용자 객체를 바꾸지 않아도 됩니다.

| 이름 | 예 | 뜻 |
|---|---|---|
| `iss` | `hitess-workbench` | 발급자. 항상 이 값 |
| `aud` | `block-weld` | 이 토큰을 받을 App(문자열 하나). **자기 App 값이 아니면 거부** |
| `sub` | `A123456` | 사번 (JWT 표준 이름) |
| `employee_id` | `A123456` | 사번 (`sub` 와 같음, Cookie Manager 이름) |
| `display_name` | `홍길동` | 이름 |
| `department` | `구조시스템연구실` | 부서 (없으면 `null`) |
| `company` | `HD현대중공업` | 회사 (없으면 `null`) |
| `role` | `member` | `admin`(WorkBench 관리자) 또는 `member` |
| `modules` | `["block-weld"]` | 이 사용자가 열 수 있는 App. WorkBench 가 App 열기 권한을 확인한 뒤에만 토큰을 발급하므로 항상 `aud` 하나 |
| `iat` | `1793680000` | 발급 시각 (Unix 초) |
| `exp` | `1793680060` | 만료 시각. 발급 후 **60초** |
| `jti` | `k3J…` | 토큰 고유 번호 |

App 별 `aud` 값:

| App | `aud` |
|---|---|
| Block Weld Assessment | `block-weld` |
| Independent Tank Assessment | `independent-tank` |
| Heavy Block Lifting Simulation | `heavy-block-lifting` |
| SALA, 그 밖에 App Settings 로 등록한 App | 등록 때 정한 주소 이름(slug). WorkBench 입구 `/external-apps/<slug>` 의 그 값 |

`aud` 를 확인해야 하는 이유: 한 App 이 받은 토큰을 다른 App 에 그대로 넣어도 통하지 않게 하려는 것입니다.

### 3.4 세션 수명과 로그아웃

- 브라우저 쪽 세션은 WorkBench 가 관리합니다. App 을 연 뒤 **8시간**이 지나면 WorkBench 에서 다시 열어야 합니다.
  (Cookie Manager 의 '마지막 요청 후 4시간' 과 다릅니다. 신원을 WorkBench 가 발급하므로 WorkBench 기준을 따릅니다.)
- WorkBench 는 요청마다 계정 활성 상태를 다시 확인한 뒤에만 토큰을 붙입니다. 계정이 정지되면 다음 요청부터 토큰이 없습니다.
- 토큰 자체는 60초면 만료되므로, App 이 토큰을 붙잡아 두어도 오래 쓸 수 없습니다.

### 3.5 토큰을 다루는 범위

- 토큰은 요청 하나를 위한 것입니다. **저장하거나 다른 서버로 넘기지 마세요.** 로그에 그대로 남기지도 마세요.
- 매 요청에 새 토큰이 붙으니 외부 App 이 따로 로그인 세션을 만들 필요가 없습니다.

### 3.6 쓰기 요청 위조 방지 (CSRF)

Cookie Manager 는 모듈이 쓰기 요청마다 `X-CSRF-Token` 을 확인했습니다. 이 구조에서는 **WorkBench 게이트웨이가 대신 막습니다.**

- `GET`·`HEAD`·`OPTIONS` 가 아닌 요청은 `Origin` 헤더가 WorkBench 주소와 같을 때만 App 으로 넘깁니다. 다르거나 없으면 WorkBench 가 403 으로 끊습니다.
- 게이트웨이 세션 쿠키는 `SameSite=Lax` 라 다른 사이트에서 보낸 쓰기 요청에는 처음부터 실리지 않습니다.
- 따라서 App 은 CSRF 토큰을 따로 구현하지 않아도 됩니다. Cookie Manager 방식의 CSRF 검사가 이미 있으면 빼거나, 토큰이 없을 때 통과하게 바꿉니다.

## 4. 검증 예제

검증할 것은 다섯 가지입니다. 서명(공개키), `alg = RS256`, `iss`, `aud`, `exp`.
시계 차이를 감안해 30초 여유(leeway)를 둡니다.

### 4.1 Python (FastAPI · Flask · Starlette 공통)

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

**Cookie Manager(`cookie_manager/auth_client.py`) 구조를 쓰는 모듈**은 `PlatformAuthClient.current_user()` 안의
`/internal/sessions/validate` 호출 부분만 `hitess_user(request.headers)` 로 바꾸고, `User.from_dict(claims)` 로 같은 사용자 객체를 만들면 됩니다.
`RequirePlatformSession`(모듈 경로 전체 보호)·`require_admin()` 은 그대로 씁니다. 쿠키 갱신 헤더(`session_cookie_headers`)는 필요 없어 뺍니다.

### 4.2 Node.js (Express 등)

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

### 4.3 .NET 8 (ASP.NET Core) — NuGet 패키지 없이

사내망에서 NuGet 받기가 막힐 수 있어 .NET 기본 기능만 씁니다. 알고리즘을 `RS256` 하나로 고정하므로 직접 검증해도 안전합니다.
이 클래스는 다른 알고리즘(`none`·`HS256`)의 토큰을 받지 않습니다.

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

ASP.NET Core 에 등록하는 예 — 45번 SALA 패치(`SessionTestPage.cs`)처럼 `UseDefaultFiles` **앞**에 둡니다(SPA fallback 이 보호 경로를 먼저 가져가지 않게).

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

### 4.4 응답 규칙 (Cookie Manager 와 같음)

| 상황 | 응답 | 화면 |
|---|---|---|
| 토큰 없음·검증 실패·만료 | **401**, `{"code": "SESSION_INVALID"}` | 'WorkBench 에서 다시 실행해 주세요' |
| 사용자는 맞지만 그 기능 권한 없음(관리자 전용 등) | **403** | 권한 없음 안내 |
| 공개키를 받을 수 없음(WorkBench 장애) | **503** | 잠시 후 다시 |

### 4.5 다른 언어

JWT 라이브러리 가운데 **JWKS(원격 공개키)** 와 **RS256** 을 지원하는 것을 쓰면 됩니다(Java `nimbus-jose-jwt` 등).
허용 알고리즘은 반드시 `RS256` 하나로 고정합니다. `alg` 를 `none` 이나 `HS256` 으로 바꾼 위조 토큰을 놓치기 쉽습니다.

## 5. 전환 순서

기존 App 이 깨지지 않게 세 단계로 나눕니다. 2단계는 45번 SALA 패치의 '옛 사번 페이지 임시 차단' 방식을 그대로 씁니다.

| 단계 | WorkBench | 외부 App | 결과 |
|---|---|---|---|
| 1. 헤더 추가 | 토큰 헤더와 쓰기 요청 Origin 확인을 시작. 주소 사번(`/A123456`)도 그대로 보냄 | 할 일 없음. SALA 는 App Settings 에 외부 App 으로 등록 | 지금과 똑같이 동작 |
| 2. 검증 적용 | 그대로 | 4절대로 검증을 넣고 토큰 없는 요청은 401. 옛 사번 진입 페이지는 설정 스위치(예: `LegacyPagesEnabled=false`)로 닫았다가 문제 있으면 다시 열 수 있게 | 직접 접속이 막힘 |
| 3. 확인 | 개발자 안내문 갱신 | 5.1 의 무쿠키 점검 통과 | 방화벽 없이도 안전 |

1단계 적용 날짜는 WorkBench 담당이 따로 알립니다. 2단계는 각 App 일정에 맞춰 진행하면 됩니다.
2단계 전에 WorkBench 로 열어 `X-HiTESS-Assertion` 헤더가 실제로 들어오는지 먼저 로그로 확인하세요(토큰 값 자체는 로그에 남기지 말고 길이만).

### 5.1 직접 접속 점검 (45번 안내의 무쿠키 점검을 헤더 기준으로)

App 서버에 WorkBench 를 거치지 않고 요청해 봅니다. `-q` 는 사용자 curl 설정을 읽지 않게 합니다.

```powershell
# 기대: 401 (토큰 없음)
curl.exe -q --noproxy "*" -sS -D - -o NUL --max-time 8 http://10.14.42.145:31880/api/<보호 API>

# 기대: 401 (가짜 토큰)
curl.exe -q --noproxy "*" -sS -D - -o NUL --max-time 8 -H "X-HiTESS-Assertion: a.b.c" http://10.14.42.145:31880/api/<보호 API>

# 기대: 401 또는 옛 페이지 임시 중지(503) — 200 으로 화면이 열리면 실패
curl.exe -q --noproxy "*" -sS -D - -o NUL --max-time 8 http://10.14.42.145:31880/A123456
```

## 6. 자주 묻는 것

**연결 상태 확인(GET `/`)은 어떻게 되나요?**
WorkBench 는 App 이 살아 있는지 보려고 `GET /` 를 부르는데, 이 요청에는 사용자가 없어 토큰이 붙지 않습니다.
WorkBench 는 **500 미만**이면 정상으로 보므로 `/` 가 401(또는 임시 중지 503 이 아닌 4xx)을 돌려줘도 괜찮습니다. **5xx 는 내지 마세요** — 옛 페이지 임시 차단을 503 으로 하면 `/` 만은 예외로 두어야 합니다.

**JS·CSS·이미지에도 검증해야 하나요?**
선택입니다. 토큰은 모든 요청에 붙어 있습니다. 최소한 **사용자 데이터를 읽고 쓰는 API 와 첫 페이지**는 검증하세요.

**공개키를 매번 받아 오나요?**
아닙니다. 예제는 공개키를 캐시하고, 모르는 `kid` 가 오면 그때만(.NET 예제는 최대 1분에 한 번) 다시 받습니다.
외부 App 서버에서 WorkBench(`10.14.42.145:9091`)로 접속할 수 없다면 알려 주세요. 공개키 PEM 파일을 따로 드립니다. 그 경우 키 교체 때 파일을 바꿔 넣어야 합니다.

**만료가 60초면 오래 걸리는 계산은 어떻게 하나요?**
토큰은 요청을 받는 순간에만 검증하면 됩니다. 계산이 길어도 상관없습니다. 다음 요청(상태 확인 폴링 등)에는 새 토큰이 붙어 옵니다.

**Cookie Manager 처럼 플랫폼에 물어보는 방식(서버 간 확인)은 안 되나요?**
기본은 토큰을 직접 검증하는 방식입니다. 서버 간 호출이 없어 WorkBench 장애 때도 이미 받은 공개키로 동작합니다.
직접 검증을 도저히 넣을 수 없는 App 이 있으면 알려 주세요. WorkBench 가 받은 토큰을 확인해 주는 API(Cookie Manager `/internal/sessions/validate` 와 같은 응답 모양)를 추가로 검토합니다.

**WorkBench 밖(일반 브라우저)에서 바로 열고 싶다면?**
이 방식에서는 안 됩니다. WorkBench 를 거친 요청에만 토큰이 붙습니다.

**사번 외에 다른 정보가 필요하면?**
필요한 항목을 알려 주세요. 토큰에 추가할 수 있습니다. 다만 토큰은 요청마다 붙으므로 작게 유지합니다.

## 7. 45번 Cookie Manager 와의 대응

| Cookie Manager | 이 계획 | 처리 |
|---|---|---|
| 플랫폼 로그인(8000)·SQLite 세션 | WorkBench 로그인·게이트웨이 세션 | **쓰지 않음** |
| 쿠키 `platform_session` + 서버 간 `/internal/sessions/validate` + 모듈 키 | 헤더 `X-HiTESS-Assertion` + 공개키 검증 | 바꿈 — 비밀 모듈 키 배포가 없어짐 |
| 사용자 정보 `employee_id`·`display_name`·`department`·`company`·`role`·`modules` | 토큰 내용 같은 이름 | **그대로** |
| `current_user()` 한 곳 + `RequirePlatformSession`(경로 전체 보호) + `require_admin()` | 같은 구조, 확인 부분만 토큰 검증 | **그대로**(한 함수 교체) |
| 401 `SESSION_INVALID` / 403 권한 / 503 인증 장애 | 4.4절 | **그대로** |
| 모듈마다 `X-CSRF-Token` + Origin 확인 | 게이트웨이가 Origin 확인 | 앱에서는 빼도 됨 |
| 유휴 4시간·절대 만료 없음, 응답마다 쿠키 갱신 | 절대 8시간(WorkBench 기준), 갱신 없음 | 바꿈 |
| `LegacyPagesEnabled` — 옛 사번 페이지 임시 503 | 전환 2단계 스위치 | **그대로**(단 `/` 는 5xx 금지) |
| 미들웨어를 `UseDefaultFiles` 앞에 | 4.3절 등록 예 | **그대로** |
| 무쿠키 curl 점검 | 5.1절 무토큰 점검 | 헤더 기준으로 바꿔 씀 |
| `sala-check`(실제 ASP.NET 두 개 + 가짜 인증) | 가짜 인증을 '시험용 키로 서명한 토큰' 으로 바꿔 재사용 | 재사용 |
| HTTPS 또는 loopback 만 허용 | WorkBench 운영 HTTP 그대로 | 이 제한은 가져오지 않음 |

---

## 부록 — WorkBench 내부 작업 (외부 개발자에게 넘길 때는 빼도 됨)

### A.0 구현 상태 (2026-11-03)

A.1 표 전부 구현(미커밋). 개인키 기본 위치 `HiTessWorkBenchBackEnd/.secrets/external_app_signing_key.pem`(루트 `.gitignore` 에 `.secrets/`, DRM 이 `.pem` 을 감싸지 않음 실측),
테스트는 conftest 가 키를 임시 폴더로 돌린다. 기존 `_employee_is_active` → `_employee_profile`(활성 사용자 정보 또는 None).
- 시험: `tests/test_external_app_identity.py`(서명·claims·키 파일·교체·게이트웨이 주입·위조 헤더·쓰기 출처 24경우·JWKS) + 기존 외부 App 시험 갱신(쓰기 요청에 Origin). 백엔드 전체 실패 0, 프론트 `node --test` 391 통과·빌드 통과.
- E2E(새 코드만 9197 에 띄움, dev DB 읽기 전용, 실제 Chrome 헤드리스): 실행권 → 쿠키 → 가짜 외부 App(4.1 예제 코드 그대로)이 토큰 검증(사번·aud·role) → 같은 출처 POST 200 /
  다른 포트 공격 페이지의 fetch·form POST 는 쿠키가 실렸는데도 게이트웨이 403(외부 App 도달 0) / 외부 App 직접 접속 401 / 연결 상태 확인 ok(외부 App `/` 401).
  Chromium 이 같은 출처 POST 에 Origin 을 보내는 것을 확인(Electron 26 = Chromium 116 이라 같다고 봄, Electron 창 자체는 미확인).
- 모든 외부 App 적용: Block Weld·Independent Tank·Heavy Block Lifting·App Settings 등록 App 이 전부 같은 `_proxy_request` 를 지난다(RAW 직접 열기 App 없음).
  `test_every_external_app_gets_its_own_audience` 가 네 경우 모두 실행 → 페이지·쓰기 요청에 자기 aud 토큰이 붙는지 확인. dev DB 에 등록 App 은 없음(2026-11-03).
- 70 반영: 9091 재시작 후 `/api/external-apps/jwks` 200, 키 파일 생성. 사용자가 Block Weld 실행·연결 상태 확인 정상 확인(2026-11-03).
- 확인 안 함: 외부 App 쪽 토큰 검증(아직 외부 App 에 코드 없음 — 헤더를 무시하므로 동작은 이전과 같음), Independent Tank·Heavy Block Lifting 실제 실행, ESLint(프로젝트에 `@eslint/js` 없음).
- ⚠ 70 의 9091 이 재시작 후 응답하지 않으면 WMI 멈춤을 먼저 의심 — Python 3.12+ `platform` 이 WMI 로 OS 정보를 물어 SQLAlchemy import 가 멈춘다(2026-11-03 실제 발생, `Restart-Service winmgmt -Force` 로 해결).

### A.1 바꿀 곳

| 파일 | 내용 |
|---|---|
| `app/services/external_app_identity.py` (신규) | RSA 키 불러오기, JWT 서명(`cryptography` 로 직접 RS256 — 새 의존성 없음), JWKS 만들기, 3.3절 claims 조립 |
| `app/routers/external_apps.py` `_proxy_request` | 요청 헤더에서 `x-hitess-*` 를 먼저 지우고 `X-HiTESS-Assertion` 을 붙인다. `aud` = 코드 App `config.key` · 등록 App 은 `registered:` 를 뗀 slug |
| `app/routers/external_apps.py` `_proxy_request` | 쓰기 메서드(GET·HEAD·OPTIONS 외)는 `Origin` 이 요청 기준 WorkBench origin 과 같을 때만 통과, 아니면 403(3.6절). ⚠ Electron 자식 창·업로드(`multipart`)·`fetch` 가 실제로 보내는 Origin 을 먼저 실측 |
| `app/routers/external_apps.py` | `GET /api/external-apps/jwks` (인증 없음, `Cache-Control: max-age=3600`). ⚠ 라우터 프리픽스가 `/external-apps` 라 경로 위치를 정할 것, 동적 `/{slug}` 경로보다 먼저 등록 |
| `_filter_headers` | `x-hitess-` 접두 헤더를 막는 목록에 추가(위조 방지) |
| `frontend/src/utils/externalAppDeveloperNotes.js` + 테스트 | '주소 첫 칸에서 사번을 읽으세요' → '헤더를 검증하세요', 이 문서 링크 |

claims 의 이름·부서·회사·관리자 여부는 `models.User`(`name`·`department`·`company`·`is_admin`)에서 읽는다. 이미 `_employee_is_active` 가 요청마다 사용자를 조회하므로 같은 조회에서 함께 가져와 DB 왕복을 늘리지 않는다.

### A.2 키 관리

- 개인키 경로 = `.env` `EXTERNAL_APP_SIGNING_KEY_PATH` (git 미추적, 70·145 각각). 없으면 서버 시작 때 만들고 경고 로그.
- `kid` = 공개키 지문(sha256 앞 16자).
- 교체: 새 키를 추가하면 JWKS 에 이전 공개키도 하루 동안 함께 싣는다.
- ⚠ 회사 DRM 이 `.pem` 을 감싸는지 확인할 것(xlsx·zip·pdf 는 감쌈). 감싸면 키를 `.env` 에 base64 로 두는 방식으로 바꾼다.
- 개인키 내용은 대화창·커밋·로그에 남기지 않는다.

### A.3 시험

- 예제 확인(2026-11-03, 개정 2): 4.1 Python(PyJWT 2.15)·4.3 .NET 8 검증 클래스를 이 문서에서 그대로 뽑아, 시험 키로 만든 JWKS 를 로컬 http 서버에 올려 실행.
  정상 1 통과 · aud/iss 다름 · 만료 · alg none · 본문 변조 · 모르는 kid · 깨진 토큰 · 빈 값 거부, 주소 사번 불일치 거부, JWKS 서버 없음 → Python `AuthUnavailable`·.NET `HttpRequestException`(503 경로). 4.2 Node·4.3 ASP.NET 등록 예(미들웨어)는 실행 안 함.
- 서명한 토큰을 4.1(PyJWT)·4.3(.NET) 예제 그대로 검증(정상), `aud`·`iss` 변조·만료·`alg` 바꿈·서명 변조 토큰은 거부되는지.
- 브라우저가 보낸 `X-HiTESS-Assertion` 이 업스트림에 그대로 넘어가지 않는지.
- 쓰기 요청: Origin 같음 → 통과, 다름·없음 → 403. GET 은 Origin 없이 통과.
- 등록 App 의 `aud` 가 slug 인지, 코드 App 세 개가 각자 `aud` 를 받는지, `modules == [aud]` 인지.
- 기존 `tests/test_external_apps_security.py` 통과.
- 45번 `sala-check` 를 시험용 키 서명 토큰으로 바꿔 .NET 쪽 401/200 확인.
- 가짜 외부 App 을 띄워 Electron 창으로 열어 실제로 사번이 읽히는지, 직접 주소 접속이 401 인지.

### A.4 배포

- 백엔드 코드뿐 → 145 `git pull` + 재시작. InHouse 교체·exe 재배포 없음.
- 145 `.env` 에 키 경로 한 줄(또는 자동 생성 확인).
- SALA 를 App Settings 외부 App 으로 등록(주소 145:31810, slug 결정).
- 1단계 적용 후 외부 개발자에게 이 문서(부록 제외)와 적용 날짜를 전달.

### A.5 남은 확인

- 각 외부 App 이 사번을 권한 판단에 쓰는지, 저장 폴더 이름으로만 쓰는지(위험 크기 판단).
- 145 의 31810·31860·31870·31880 포트가 다른 PC 에서 열리는지(지금 직접 접속이 가능한지).
- 외부 App 서버에서 145:9091 JWKS 에 접속되는지(같은 서버라 될 것으로 보지만 미확인).
- 세션 수명을 WorkBench 8시간 절대 만료로 두는 것에 SALA 쪽 이견이 없는지(Cookie Manager 는 유휴 4시간).
