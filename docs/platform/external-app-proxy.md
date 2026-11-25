# 외부 웹 App 프록시와 보안 점검

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### 외부 웹 App 프록시 — 사용자 신원 전달 (2026-11-03 구현, 1.7.0 포함)

Block Weld·Independent Tank·Heavy Block Lifting·App Settings 등록 App 은 백엔드 `routers/external_apps.py` 가 `/external-apps/<key>` 로 프록시한다
(grant 45초 → HttpOnly 쿠키 세션 8시간, `services/external_app_access.py`). 이 세션은 브라우저↔게이트웨이 사이에만 있고 `Authorization`·`wb_ext_*` 쿠키는 업스트림에 안 간다.
⚠ 외부 App 은 **주소 첫 칸(`/A123456`)으로 사용자를 정한다** — 업스트림 포트(145:31860/31870/31880)로 직접 들어오면 사번을 바꿔 들어갈 수 있다(방화벽 의존, 실제 열림 여부 미확인).
- **Independent Tank 는 HTTPS 로만 받는다**(2026-11-25, 자체 서명 인증서 `CN=Independent Tank HTTPS`, 2027-11-24 까지). 프록시 기본 주소 = `https://127.0.0.1:31870/`, 앱 인증서 하나만 믿도록 고정(`app/certs/independent_tank.pem`, 주소 이름 검사는 끔). 앱이 다른 PC 에 임시로 뜨면 관리자 App Settings 에서 IP 만 바꾼다(https 는 기본값을 따름). ⚠ 앱이 145 로 돌아오면 **그 칸을 비운다** — `10.14.42.145` 를 넣으면 앱이 `127.0.0.1` 에만 떠 있을 때 연결 거부(502), loopback 은 App Settings 에 못 넣는다. 앱 담당자가 인증서를 새로 만들면 이 파일을 바꿔야 한다. 앱은 145 에서 온 요청만 받는다(70 에서 직접 부르면 403) — 시험은 145 에서 한다. 11-24 장애: 145 의 R_261124 가 HTTP 로 `127.0.0.1` 에만 떠 있었고 프록시는 `http://10.14.42.145:31870` 을 불러 연결 거부.
결정(사용자, 2026-11-03): **A안 = 게이트웨이가 요청마다 `X-HiTESS-Assertion`(RS256 JWT, aud = App 키/slug, exp 60초)을 붙이고 공개키를 JWKS 로 공개**, 외부 App 이 검증.
계획서·외부 개발자 전달본 = `RecordMD/2026-11-03-external-app-signed-identity-plan.md`(부록 = WorkBench 내부 작업, 전달 시 뺌).
**WorkBench 쪽 구현됨(2026-11-03, 미커밋)** — `services/external_app_identity.py`(RS256 서명·JWKS, 키 = `.env` `EXTERNAL_APP_SIGNING_KEY_PATH` 기본 `<백엔드>/.secrets/`, git 제외) ·
`external_apps.py` 가 요청마다 `X-HiTESS-Assertion` 을 붙이고 브라우저의 `x-hitess-*` 는 지움 · 쓰기 요청은 같은 출처(Origin/Referer)만 통과(403) · `GET /api/external-apps/jwks`(`jwks_router`, main.py 등록).
⚠ 쓰기 요청 출처 확인이 생겨 Origin 없는 POST 는 프록시가 403 — 테스트에서 쓰기 요청을 보낼 때 `Origin: http://testserver` 를 붙일 것. 반영 = 145 `git pull` + 재시작(키 파일은 처음 요청 때 자동 생성).
모든 외부 App(코드 3개 + 등록 App)이 같은 `_proxy_request` 를 지나 따로 할 일 없음(`test_every_external_app_gets_its_own_audience`). 70 반영·사용자가 Block Weld 연결 상태 확인(2026-11-03).
**외부 개발자 전달본 = `RecordMD/2026-11-03-external-app-integration-handoff.md`**(현재 작동 체계 + 검증 예제, 예제는 계획서 코드 블록을 그대로 옮겨 재실행 확인). 계획서는 내부 기록용.
커밋 `87322fd`(독립 리뷰 막아야 함 0) · **WorkBench 1.7.0 에 포함**(2026-11-03 빌드·푸시, 145 미반영).
남은 일: 145 반영(⟳ Update + 재시작) 후 Block Weld 를 열어 145 `.secrets/` 키 생성·쓰기 동작(저장·계산) 403 없음 확인 → 반영일을 적어 전달본 송부. 외부 App 쪽 검증 코드는 각 개발자 몫.
개정 2(같은 날): 45번 Cookie Manager(`HanByul/45_Cookie_Manager`, 별도 로그인 플랫폼 + 서버 간 세션 확인)는 운영에 세우지 않고(HTTP 거부·로그인 이중화·앱 포트 노출) 모듈 쪽 구조만 쓴다 —
claims 이름을 그 사용자 정보(`employee_id`·`display_name`·`role`·`modules`)와 맞춤, CSRF 는 게이트웨이 Origin 확인, .NET 은 NuGet 없는 RS256 검증 예제(Python·.NET 예제 실행 확인) — 개발자 안내문 `utils/externalAppDeveloperNotes.js` 도 구현 때 함께 바꾼다.

**보안 점검 (2026-11-04, 읽기 전용 — 코드 변경 없음)** — 위 '외부 웹 App 프록시' 절의 "실제 열림 여부 미확인" 중 **무인증 직접 접근·경로 첫 칸 사번 위장은 닫힘 확인**:
업스트림에 직접 붙어도 `/`·`/A<사번>` 모두 **401 `SESSION_INVALID`**(앱이 유효 WorkBench 세션을 요구, 경로 칸을 신뢰 안 함). 참조 검증기 `outputs/external-app-assertion-testkit/sample_app.py` 는
`algorithms=["RS256"]`+`require=[iss,aud,sub,iat,exp]`+aud·iss 핀+JWKS kid 조회로 alg:none·RS/HS 혼동·kid 주입·unknown-key·tampered·expired·wrong-aud/iss·no-exp **7종 거부** — 토큰 위조 경로는 견고.
- **남은 결함은 암호화가 아니라 전송/배포** (WorkBench.exe 무관, exe 재빌드 불필요): JWKS(`9091/api/external-apps/jwks`)·게이트웨이→App 이 **평문 HTTP**(`external_apps.py` 35~39행 `http://10.14.42.145:318xx`).
  **공격자가 LAN 온-패스일 때만** ① assertion 재생(exp60+leeway30 ≈ 90초 창, 검증기에 jti 재생 캐시 없음) ② 위조 JWKS 로 아무 사번 토큰 위조. 둘 다 401 을 뚫는 게 아니라 "401 통과 재료(토큰·공개키)"를 평문 구간에서 조작하는 방식.
- **심각도 열쇠 = 운영 .145 의 318xx 바인딩이 loopback 이냐 0.0.0.0 이냐** (미확인). `.114:31880` 이 응답한 건 **개발자 PC 테스트 인스턴스**(운영 누수 아님)이고, 그게 0.0.0.0 바인딩이라 타 PC 에서 닿았다 — 운영도 같은 식이면 ①② 성립, loopback 이면 사실상 닫힘. 확인: 145 에서 `netstat -ano | findstr :31880` 또는 타 PC 에서 `.145:31880` 접근.
- **막는 순서**: ① 업스트림 포트(31880/31870/31860)를 게이트웨이에서만(방화벽 또는 loopback 바인딩, **코드 아님·사용자 수동**, 가장 싸고 효과 큼) ② JWKS·업스트림 HTTPS/mTLS ③ 외부 App 에 공개키 핀 ④ 검증기 `leeway` 30→5~10s + jti 단기 캐시(참조 샘플 + 각 외부 App=타 개발자, 샘플만 조여선 운영 보안 안 바뀜) ⑤ 핸드오프 문서에 검증 3대 불변식(RS256 전용·aud/iss/exp 필수·JWKS 인증 채널).
- ⚠ 라이브 서버(10.14.42.x) 침투·재생 **실제 시연은 안 함** — 승인·테스트 계정 전까지 하지 말 것. ①(방화벽)은 공격 없이도 적용되는 네트워크 설정이라 선행 가능.
- **백엔드 보안 수정 커밋·푸시 `35fc57b`** (2026-11-04 — 145 `git pull`+재시작 반영, exe 무관·프론트 무관): ① `app_settings.py` `effective_external_endpoint` 가 `external_host` 오버라이드의 loopback/link-local/unspecified/localhost 거부(`_is_blocked_external_host`) — 관리자 오버라이드로 프록시를 내부 포트(MySQL 3306·Ollama 11434)로 돌리는 SSRF 피벗 차단, 신원/세션 경로 무관 ② `GUARDED_ROUTES` 에 `modelbuilder/solve`·`module-unit/export-bdf`·`groupmodule/cog` 등록(점검·개발 중 앱 우회 실행 fail-open 메움) ③ `viewers.py` `_find_zip` 의 `viewer_id` 를 `^[A-Za-z0-9_-]+$` 로 제한(백슬래시 `%5C`·`..` 경로탈출). 커밋 전 독립 리뷰 막아야함 0, 백엔드 테스트 169 통과. ⚠ 레거시 `hitessbeam.py` 무인증 다운로드는 **닫지 않음**(배포 exe 계약 `test_hitessbeam_legacy_client.py`, 2026-07-28 401 사고) — 네트워크 격리로만.
- **외부 App 등록 규약 = `aud` 는 등록 slug** (2026-11-04 진단, BlockWeld_Test 401). 외부 App 이 `aud` 를 하드코딩하면(testkit `sample_app.py:16` 기본 `block-weld`) 등록 slug(예 `blockweld-test`)와 어긋나 App 이 **401 `SESSION_INVALID`** 를 낸다 — **WorkBench 수정 아님**, App 이 `aud` 를 등록 slug(설정값)로 맞춰야. 등록하면 `/external-apps/<slug>` 프록시·카탈로그 카드가 **동적 생성**(App 별 코드 변경 불필요)이고, 매 App 조건은 host=사설 IPv4(`is_private_ipv4`)·slug 비예약(`RESERVED_SLUGS`)·상태 Active·양방향 네트워크(게이트웨이→App, App→`145:9091/jwks`). 진단·외부 개발자 전달문서 `RecordMD/2026-11-04-external-app-aud-mismatch-handoff.md`.

### Independent Tank HTTPS 전환 진행 (2026-11-25)

- 커밋 `b87b501`(푸시함): 기본 주소 `https://127.0.0.1:31870/` + 인증서 고정 + `tests/test_independent_tank_tls.py`. 배포 = 145 `git pull` + 백엔드 재시작.
- 앱은 지금 담당자 개발 PC `10.14.42.114:31870`(HTTPS)에 임시로 떠 있다. 145 에서 운영 키 토큰으로 시험 통과(토큰 없음 401, `/api/me` 404, `/<사번>` 화면 HTML).
- 남은 일: 145 반영 → App Settings Independent Tank 주소 `10.14.42.114` → WorkBench 에서 창 열림 확인(**미확인**). 앱이 145 로 돌아오면 App Settings 칸 비우기.
- 담당자 전달본: `RecordMD/2026-11-24-Independent-Tank-접속장애.md`(포트 31870 과 HTTPS 유지, 인증서 교체 시 알림, 145 의 R_261124 `bin\Debug` HTTP 판 정리).
