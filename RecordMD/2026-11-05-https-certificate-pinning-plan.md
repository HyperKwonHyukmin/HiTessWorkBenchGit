# AD 자동 로그인 + HTTPS 인증서 고정 — 통합 계획 (보안팀 협조 없이)

작성 2026-11-05 · 상태: **0단계(가능성 시험) 진행 중** · 선행: 사내 AD 로그인(2026-11-04 145 운영 켜짐)
결정(사용자, 2026-11-05): 자동 로그인(Windows 통합 인증)과 HTTPS + 인증서 고정을 **함께** 한다. 비밀번호 입력 칸은 예비로 남긴다.

## 1. 왜 하나

2026-11-04 AD 로그인으로 "사번만 알면 로그인" 구멍은 닫혔다. 그런데 9091 이 **평문 HTTP** 라 다음이 망에 그대로 흐른다.

| 흐르는 것 | 누가 엿보면 |
|---|---|
| AD 비밀번호(`POST /api/login`) | **회사 PC 계정 자체**를 빼앗긴다(메일·PLM 등 사내 전체) |
| 세션 토큰(8시간) | 그 사람으로 WorkBench·외부 App 사용 |
| 외부 App 프록시 쿠키, JWKS 공개키 | 위조 공개키로 아무 사번 토큰 위조(외부 App 이 HTTP 로 JWKS 를 받을 때) |

AD 를 붙이면서 **흘렀을 때의 피해가 커졌다**(예전엔 사번, 이제는 회사 비밀번호).

## 2. 두 방식이 맡는 것

| 방식 | 막는 것 | 원리 |
|---|---|---|
| **AD 자동 로그인**(Windows 통합 인증, Negotiate) | 비밀번호 전송 자체를 없앤다 | 서버가 `401 WWW-Authenticate: Negotiate` → Windows 가 지금 로그인한 계정으로 일회용 증명 토큰을 만들어 보냄 → 서버가 도메인 컨트롤러로 확인해 계정(`HHI\<사번>`)을 얻음. 사번 입력도 필요 없다 |
| **HTTPS + 인증서 고정** | 로그인 뒤 오가는 토큰·데이터 엿보기, 가짜 서버 바꿔치기 | 자체 인증서를 145 에 달고, 앱 3개가 그 **공개키 지문(SPKI sha256)** 을 들고 있다가 일치할 때만 연결. 회사 PC 신뢰 저장소를 건드리지 않음. 예비 키 지문도 함께 고정 |

## 3. 대상

| 구성 | 지금 | 자동 로그인 | 인증서 고정 |
|---|---|---|---|
| 서버 145 | uvicorn 1개, `0.0.0.0:9091` HTTP(`server_manager.py` `SERVER_CMD`) | 로그인에 Negotiate 처리(pywin32 `sspi`) | HTTPS 수신 추가 |
| WorkBench exe(Electron 26) | 화면 axios = `config.js`, main = `DEFAULT_BACKEND_BASE_URL` | `app.commandLine.appendSwitch('auth-server-allowlist', …)` | `session.setCertificateVerifyProc` |
| AmLauncher(Electron 40) | `lib/server-client.js` | 같음 | 같음 |
| HiTessMB.exe(.NET 4.8) | `Submitter` HttpClient | `HttpClientHandler.UseDefaultCredentials = true`(비밀번호 창은 예비로) | `ServerCertificateCustomValidationCallback` |

⚠ 확인할 것: WorkBench main 프로세스가 Node 자체 TLS·HTTP(`https` 모듈·Node fetch)로 서버를 부르는 곳은 Chromium 의 Negotiate·인증서 검사가 적용되지 않는다 — 구현 첫 단계에서 전수 검색.

## 4. 단계

### 0단계 — 가능성 시험 (운영 코드 무변경)
시험 도구: `outputs/auth-feasibility/`(git 미추적)
- `feasibility_server.py sso [9099]` — Negotiate 로 들어온 계정·방식(NTLM/Kerberos)을 돌려준다
- `feasibility_server.py tls [9443]` — 1일짜리 자체 인증서로 HTTPS, 서버 지문을 돌려준다(키는 끝날 때 지움)
- `feasibility_client.ps1 -Server <IP> [-Fqdn <이름>]` — 다른 PC 에서 두 시험을 한 번에(PS 5.1, 비밀번호 안 물음)

| 시험 | 결과 | 날짜 |
|---|---|---|
| 70 → 70(같은 PC) SSO | 성공, `HHI\A476854`, NTLM(IP·FQDN 둘 다) | 2026-11-05 |
| 70 → 70 TLS 지문 | 같음(같은 PC 라 DLP 판단 근거 아님) | 2026-11-05 |
| 145 → 70 TLS 지문 | **같음** — 사내망을 건너도 인증서 바꿔치기 없음 | 2026-11-05 |
| 145 → 70 SSO(145 로컬 계정 `HHIPW170658\CF40Admin`) | 403, 서버 `SEC_E_LOGON_DENIED` — **로컬 계정이라 도메인이 확인 못 하는 것이 정상**(실패 근거 아님) | 2026-11-05 |
| 145 → 70 SSO(도메인 계정, `runas /netonly /user:HHI\A476854`) | **성공** — 서버가 본 계정 `HHI\A476854`, NTLM. 비밀번호는 145 의 runas 창에만 입력 | 2026-11-05 |
| 70 → 145 SSO, IP `10.14.42.145`(145 가 서버 — 실제 운영 방향, 145 WorkBench venv python) | **성공** — `HHI\A476854`, NTLM | 2026-11-05 |
| 70 → 145 SSO, FQDN `HHIPW170658.HDShipGroup.HHI.co.kr` | **성공** — `HHI\A476854`, **Kerberos** | 2026-11-05 |
| 70 → 145 TLS 지문 | **같음** — 사용자 PC → 145 경로도 DLP 가로채기 없음 | 2026-11-05 |

**0단계 결론(2026-11-05): 두 방식 모두 보안팀·IT 협조 없이 가능.**
- 145 는 도메인 가입 PC 이고, 로컬 계정(`HHIPW170658\CF40Admin`)으로 도는 서버 프로그램도 도메인 계정을 확인한다.
- **FQDN 으로 부르면 Kerberos** 가 된다(70 서버 시험에서는 NTLM 이었음 — 145 쪽에서는 측정상 Kerberos 로 수락됐다. 왜 로컬 계정 프로세스가 기계 계정 티켓을 받는지는 확인 안 함, 측정 결과만 기록).
  Kerberos 는 NTLM 중계 공격·NTLM 폐지 위험이 없어 낫다 → 1단계에서 앱 기본 주소를 FQDN 으로 두고, IP 로 부르면 NTLM 으로 내려가게 한다. 인증서 SAN 에 FQDN·IP 둘 다.
- 사내 PC 사이 HTTPS 를 DLP 가 가로채지 않는다(145 → 70, 70 → 145 두 방향).
- 시험은 70·145 두 대뿐이다. 다른 부서 PC(다른 DLP 정책 가능성)는 1단계 배포 초기 사용자 반응으로 확인.
시험 중 실수: `pushd` 가 잡은 `Z:` 는 `runas` 새 창에 없어서 스크립트가 실행되지 않았다 — 로컬(C:) 복사본으로 실행할 것.

알게 된 것: 145 의 역방향 DNS = `HHIPW170658.HDShipGroup.HHI.co.kr` → 도메인 가입 PC 로 보인다(`systeminfo` 로 확정 필요).
FQDN 으로 불러도 NTLM 이 됐다 — 서버가 일반 사용자 계정으로 돌면 Kerberos(기계 계정 SPN)를 받지 못하기 때문으로 본다. Kerberos 가 필요하면 서버를 서비스 계정(LocalSystem/NetworkService)으로 돌리고 FQDN 으로 불러야 한다.

판단 기준:
- SSO 실패(다른 PC 에서 403·401 반복) → 회사 정책이 NTLM 을 막았을 수 있음 → 자동 로그인 보류, 비밀번호 입력 유지
- TLS 지문 다름 → DLP 가 가로챔 → 인증서 고정 보류(보안팀에 145 예외 요청 필요), 자동 로그인만 진행

### 1단계 — 자동 로그인 구현 (작업 작고 효과 큼 → 먼저)
상태(2026-11-05): **커밋 `ca3e1c4`**(HiTessMB `ef8f22c`), 미배포. 서버 `POST /api/login/windows`(`services/windows_auth.py`) · WorkBench Electron `electron/windows-login.js` + 로그인 화면 ·
HiTessMB 0.3.0 · mb-launcher 0.1.3. 시험 서버(uvicorn + 실제 SSPI)에서 Electron 26 `net.request`·.NET 4.8·HiTessMB exe 모두 비밀번호 없이 로그인 확인.
남음: 70 개발 서버 AD 모드로 앱 화면에서 실제 로그인 확인 → 배포.
- 서버: `POST /api/login/windows`(또는 기존 login 확장) — Negotiate 성공 → 계정 `HHI\<사번>` 에서 사번을 얻어 기존 세션 발급 흐름. 도메인은 `HHI` 만 허용. 기존 사번 + 비밀번호 로그인은 예비로 유지.
- NTLM 은 한 TCP 연결 안에서 두 번 오가야 한다 — uvicorn keep-alive 에서 연결별 상태를 어떻게 잡을지가 구현 핵심(시험 서버는 연결당 핸들러 객체로 해결).
- 앱 3개: 자동 시도 → 실패하면 지금의 비밀번호 화면. 버전 WorkBench 1.7.x · mb-launcher 0.1.3 · HiTessMB 0.3.0.
- 1단계 뒤에도 토큰은 평문 — 2단계가 필요한 이유.

### 2단계 — 인증서 만들기 + 145 HTTPS 병행 (9091 그대로)
상태(2026-11-05): **커밋 `0823543`**, 미배포. 70 실측 = 9443 TLS 1.3·지문 일치·HTTPS 위 Windows 로그인 200. `app/services/https_listener.py` — 앱 lifespan 이 같은 app 으로 두 번째 uvicorn Server(TLS, lifespan 끔)를 돌린다.
서버 관리자 실행 명령은 그대로(관리자 프로그램 재시작 불필요). `.env` `HTTPS_PORT` 없으면 지금과 같고, 인증서 없음·깨짐·포트 사용 중이면 HTTPS 만 건너뛴다.
인증서 = `scripts/make_tls_cert.py`(145 에서 실행, RSA 2048·5년, 지금 키 + 예비 키, 끝에 고정값 출력, 덮어쓰기는 `--force`, 교체는 `--from-backup`).
실측: 바깥 HTTP uvicorn 안에서 HTTPS 가 같이 열려 응답하고, 종료 때 포트가 풀림. 테스트 `tests/test_https_listener.py` 8건.
- 키 2벌(현재·예비), SAN = `IP:10.14.42.145` + 호스트 이름, 유효 5년. 개인 키는 145 `.secrets/`(git 제외).
- ⚠ **uvicorn 을 하나 더 띄우면 안 된다** — 작업 상태(`job_status_store`)·로그인 시도 횟수가 프로세스 메모리. 추천: 한 프로세스에서 두 수신(uvicorn `Server` 2개, 같은 app, 둘째는 lifespan 끔). 구현 전 시험.
- 새 포트 예: `9443`. JWKS 도 9443 에서.

### 3단계 — 앱 3개에 고정 넣고 배포
- 기본 주소 `https://10.14.42.145:9443`, 지문 2개 내장. 안 맞으면 멈춘다(HTTP 로 되돌아가지 않음 = 내려가기 공격 방지).
- 저장된 `server_url` 이 145 http 면 https 로 바꿔 저장.
- 배포 순서는 AD 때와 같다(실행기 zip → HiTessMB → WorkBench exe). 1단계와 한 번에 묶어 배포할 수도 있다.
- 상태(2026-11-05): 구현·70 실측 완료, 미커밋. 145 지문 = 지금 `y5rOaChW9frcyuJTf9rulsY0IyxPTmPfNeaNkpHZwCk=` · 예비 `u1mZtu+qFaU7wUx16vhHgvJAZP/QKJJ5L+GMxh26f9g=`(145 키 첫 줄 PEM 확인 — DRM 안 감쌈).
  배포 순서는 실제로는 **145 HTTPS 켜기 → 실행기 0.1.4 zip → WorkBench exe → HiTessMB 0.4.0**(새 HiTessMB 는 https 를 넘겨 0.1.3 실행기가 받지 못함). 직접 입력한 서버 주소는 바꾸지 않는 비상구를 두었다.

### 4단계 — 9091 에서 로그인 거부 + 남은 HTTP 정리
- 새 exe 가 퍼진 뒤 로그인은 HTTPS 수신에서만(`.env` 스위치). 9091 `POST /api/login` 은 "앱 업데이트 필요".
- 9091 에 남길 것: `hitessbeam` 레거시 계약, `/signup`(비밀번호 없음). 나머지는 닫거나 방화벽.
- 외부 App 개발자: JWKS 를 9443 에서 받고 지문 고정(각 개발자 몫).

## 5. 효과

| 공격 | 지금(AD 입력 + HTTP) | 1단계 후(자동 로그인) | 4단계 후(둘 다) |
|---|---|---|---|
| 사번만으로 로그인 | 막힘 | 막힘 | 막힘 |
| 망에서 비밀번호 엿보기 | **뚫림** | 막힘(안 보냄) | 막힘 |
| 망에서 세션 토큰 엿보기 | **뚫림** | **뚫림** | 막힘 |
| 가짜 서버 바꿔치기(중간자) | **뚫림** | **뚫림** | 막힘(회사 PC 가 믿는 인증서로도 불가) |
| NTLM 중계(relay) | 해당 없음 | 위험 | 크게 줄어듦 |
| 위조 JWKS 로 외부 App 토큰 위조 | 뚫림(HTTP 로 받으면) | 뚫림 | 막힘(외부 App 이 고정하면) |
| 비밀번호 틀려 회사 계정 잠김 | 위험 | 거의 없음 | 거의 없음 |
| 본인 계정으로 만든 스크립트 | 가능 | 가능 | **가능** — 막을 대상 아님, 서버 권한 검사가 맡음 |
| 잠그지 않고 비운 PC | 비밀번호 필요 | **바로 들어감** | 같음 — 화면 잠금 정책 영역 |
| 사용자 PC 감염 | 가능 | 가능 | **가능** — UAC 꺼진 PC, 단말 보안 영역 |
| `hitessbeam` 등 HTTP 옛 경로 | 열림 | 열림 | 4단계 정리 + 방화벽 |

한 줄 요약: **앱을 켜면 바로 들어가고(편의↑), 비밀번호·토큰이 망에 드러나지 않는다(보안↑).** 남는 것은 본인 권한 안의 행위·잠그지 않은 PC·단말 감염이며 감사 로그(`activity_logs`·접속 이력)로 사후 추적한다.

## 6. 위험과 대응

| 위험 | 대응 |
|---|---|
| 회사 정책이 NTLM 차단·향후 폐지(Microsoft 단계적 폐지 중) | 비밀번호 로그인을 예비로 유지. 길게는 Kerberos(서비스 계정 + FQDN)로 |
| DLP 가로채기로 앱 불통 | 0단계에서 먼저 확인. 가로채면 고정 보류 |
| 개인 키 유출 | 예비 키로 교체(앱 재배포 없음) → 새 예비 키를 다음 릴리스에 |
| 인증서 만료(5년) | 같은 키로 재발급하면 앱 무변경. 만료 1년 전 알림을 Server Manager 에 |
| 공용 PC·다른 계정 | 자동 실패 또는 "다른 계정으로" → 비밀번호 화면 |
| 되돌리기 | 1~3단계는 9091 과 비밀번호 로그인이 그대로라 언제든. 4단계는 `.env` 스위치 |

## 7. 규모 추정

| 단계 | 작업량 | 사용자 몫 |
|---|---|---|
| 0 | 반나절 | 다른 PC 에서 클라이언트 실행, 145 에서 서버 스크립트 실행 |
| 1 | 2일(서버 + 앱 3개) | 배포 |
| 2 | 1일 | 145 `.secrets/` 키 배치, 재시작 |
| 3 | 2일 | exe·zip 배포 |
| 4 | 반나절 + 외부 개발자 안내 | 스위치, 방화벽 |
