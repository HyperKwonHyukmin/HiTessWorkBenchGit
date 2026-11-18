# 인증 (AD, Windows 자동 로그인, PC 등록, HTTPS 고정)

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### 인증

- 로그인 방식은 `.env` `AUTH_MODE` 로 갈린다. 비우면 사번만, `ad` 면 사번 + 회사 PC(AD) 비밀번호(145 는 2026-11-04 부터 `ad`). 회사 PC 자동 로그인, 등록한 PC 로그인은 아래 단락. 신규 사용자는 기본 비활성이며 관리자 승인 후 사용 가능.
- 로그인하면 서버가 세션 토큰을 준다. 화면은 `AuthContext` 가 `localStorage` 의 `'user'`(사용자 정보)와 `'session_token'` 에 두고, API 요청에 `Authorization: Bearer` 로 싣는다(JWT 아님).
- `User` 모델의 `is_admin` 플래그로 관리자 페이지 접근 제어.

**사내 AD 로그인 (2026-11-04 — ★145 운영 켜짐: `.env` `AUTH_MODE=ad`, WorkBench 1.7.1 · mb-launcher 0.1.2 반영)**
145 확인(같은 날): `/api/login/options` → `ad`, 사번만 `POST /api/login` → 401 `password_required`(보안 테스트 1단계 차단), 사용자가 1.7.1 로 로그인 성공.
되돌리기 = 145 `.env` 의 그 줄 삭제 + Server Manager 재시작(⟳ Update 만으로는 `.env` 를 다시 읽지 않는다).
남은 일: AM 사용자 PC 에 `HiTessMB.exe` 0.2.0 배포(옛 0.1.0 은 AD 서버에서 로그인 못 함) · AM 개발팀에 종료 코드 9 알림 · hitess-core 로그인 계약 문서 갱신 · `HiTessMBClient` 원격 저장소 없음(이 PC 에만 있음). — 보안 테스트(`HanByul/99_Security_Test_Re`)가 `POST /api/login {employee_id}` 만으로 토큰을 받아
외부 App 을 브라우저로 열었다. 원인은 세션 설계가 아니라 **인증 부재**(사번은 비밀이 아님, 9091 은 전사 개방). 그래서 `.env` `AUTH_MODE=ad` 이면 `/api/login` 이
사번 + 회사 PC(AD) 비밀번호를 요구한다. 비우면 예전 계약 그대로(`test_auth_contract.py`).
- 서버 `app/services/ad_auth.py`: ldaps `HHIWVRA06.HHI.co.kr:636`, bind `HHI\<사번 소문자>`(AD 계정명 = 사번 확인). 비밀번호는 저장·기록 안 함(`schemas.LoginRequest.password` = `SecretStr`).
  ⚠ 사내 AD 인증서가 **RSA 1024** 라 OpenSSL 기본이 거부한다 → 검증·이름 확인은 켠 채 `SECLEVEL=1`(`.env` `AD_LDAP_TLS_SECLEVEL`). 빈 비밀번호는 AD 에 보내지 않는다(익명 bind 함정).
  틀린 시도는 **AD 에 묻기 전에** 사번별 15분 4회·IP별 20회로 끊는다(429) — AD 잠금이 직원 회사 PC 계정까지 잠그기 때문. AD 확인을 DB 사번 조회보다 먼저 해 '등록된 사번인지' 를 흘리지 않는다.
  ⚠ 횟수는 **프로세스 메모리**에 센다 — 145 는 `server_manager.py` 가 uvicorn 을 워커 1개로 띄워 맞다. `--workers N` 으로 바꾸면 제한이 N배로 느슨해져 AD 잠금 기준을 넘으니 그때는 DB 로 옮긴다.
  반대로 남이 내 사번으로 4번 틀리면 나도 15분 WorkBench 에 못 들어온다(회사 계정 잠금을 막으려고 감수한 절충 — 문의 오면 이 설명).
  응답 detail: `password_required`·`invalid_credentials`·`account_locked`·`password_expired`·`account_disabled`(401) · `too_many_attempts`(429) · `auth_unavailable`(502). 화면 문구 = `LoginScreen.jsx` `AD_LOGIN_MESSAGES`.
- 로그인 방식 조회 `GET /api/login/options` → `{auth_mode}`(`/api/version` 은 키 하나 계약이라 건드리지 않음). 프론트 `getLoginOptions` 가 옛 서버(404)면 사번만.
- 테스트 `tests/test_ad_login.py`(AD 대역). 실제 AD 확인(2026-11-04, 70): 사번만 → 401 password_required, 없는 계정 틀린 비번 → 401 invalid_credentials. 맞는 비밀번호 → 사용자가 개발 WorkBench 로그인 화면에서 직접 입력해 로그인 성공 확인(같은 날).
- **AM 연동 2단계 (2026-11-04 구현)**: `HiTessMB.exe` **0.2.0**(`HiTessMBClient`, 별도 git)이 AD 서버면 비밀번호 창(최대 3회, 종료 코드 9)을 띄우고,
  받은 토큰을 **환경 변수 `HITESS_WB_TOKEN`** 으로 실행기에 넘긴다. 실행기 `mb-launcher` **0.1.2**(`AmLauncher/`)가 그 토큰을 `GET /api/session/context` 로
  확인(같은 사번만)해 쓰고, 이미 떠 있는 실행기에는 single-instance additionalData 로 넘긴다. 토큰이 없으면 예전 사번 로그인(스위치 꺼진 서버에서는 그대로 동작).
  실사용 확인(2026-11-04, 70 AD 모드): 비밀번호 창 → `로그인 200 (AD)` → 접수 #3207 → 실행기 0.1.2 `넘겨받은 로그인 정보 사용` → Studio 3454 열림(사용자 확인).
  같은 시험에서 기존 결함 2건이 드러나 고쳤다 — 작은따옴표 경로(cmd)에서 .NET `NotSupportedException` 으로 로그 없이 종료 → 인자 오류(종료 코드 2),
  실행기 폴더 이름 바꾸기가 방금 푼 파일을 보안 검사가 잡아 '액세스 거부' → 최대 9회·약 21초 재시도(재시도 경로는 실제로 타 보지 못함, 빌드만 확인).
  상세: 각 README. ⚠ 배포 순서 = 145 `StudioProgram\mb-launcher-0.1.2.zip`(UNC 경로로 `AmLauncher\build.ps1 -OutDir` — 70 로컬 zip 은 DRM 암호문) → 새 `HiTessMB.exe` 배포 → 스위치.
- **테스트 계정 비밀번호 로그인 (2026-11-12)** — 중형선 `A888888`·삼호 `A878787` 시험 사번은 AD 에 없어 AD 모드 뒤 못 들어왔다.
  `.env` `TEST_LOGIN_ACCOUNTS=A888888,A878787` + `TEST_LOGIN_PASSWORD_SHA256=<sha256>`(원문은 어디에도 두지 않음) 이면 그 사번만 서버가 비밀번호를 직접 확인한다(`ad_auth.verify_test_password`, AD 에 안 물음).
  실패 횟수 제한·관리자 승인은 그대로, 성공 기록은 `method: test_account`. 둘 중 하나라도 비면 꺼짐. `/api/login/options` 의 `password_login_ids` 로 화면이 그 사번이면 등록한 PC 화면에서도 비밀번호 칸을 연다(새 exe 부터, 도메인 PC 는 옛 exe 도 Windows 불일치 뒤 비밀번호 칸이 떠서 됨).
  ⚠ 사번 목록이 로그인 없이 보이고 비밀번호가 단순하다 — 시험이 끝나면 `.env` 두 줄을 지울 것. 시험 `tests/test_ad_login.py`.
  상태(2026-11-12): 커밋 `127ec88` · **WorkBench 1.7.23**(`cc1e4cb`) 빌드·푸시. 70 `.env` 켜짐(70 DB 에는 두 계정이 없음). 145 는 코드는 받았으나 `/api/login/options` 목록이 비어 있음 = `.env` 두 줄 미반영 → 넣고 **서버 관리자 창을 닫았다 다시 열기**(⟳ Update 는 `.env` 를 다시 읽지 않음). 그 뒤 145 에서 두 계정 승인 상태 확인 · 실제 로그인 확인은 아직.
- **회사 PC 계정 자동 로그인 (2026-11-05, `ca3e1c4`, WorkBench 1.7.2 에 포함)** — 계획·0단계 시험 = `RecordMD/2026-11-05-https-certificate-pinning-plan.md`.
  `POST /api/login/windows`(Windows 통합 인증 Negotiate, `services/windows_auth.py`): 비밀번호·사번을 받지 않고 Windows 가 만든 토큰을 SSPI(pywin32 `sspi`)로 확인해
  `HHI\<사번>` 에서 사번을 얻는다 → 기존 세션 발급(`auth._complete_login`). NTLM 은 같은 연결에서 두 번 오가서 연결(IP+포트)별 상태를 30초 든다.
  `AUTH_MODE=ad` 면 저절로 켜지고 `AD_WINDOWS_LOGIN=0` 으로 끈다. `/api/login/options` 에 `windows_login` 이 붙었다.
  클라이언트: WorkBench Electron main `electron/windows-login.js`(화면 axios 는 교차 출처라 HTTP 인증이 안 실림 → IPC `auth:windowsLogin`) · 로그인 화면 '회사 PC 계정으로 로그인' + 화면이 뜨면 1회 자동(직접 로그아웃한 뒤엔 앱을 다시 켤 때까지 안 함) ·
  Studio 세션 갱신 `refreshWorkbenchSession` 도 먼저 자동 로그인(같은 사번만) · HiTessMB 0.3.0(`UseDefaultCredentials`, 사번 다르면 비밀번호 창) · mb-launcher 0.1.3(`lib/windows-login.js` 사본).
  실측(70): 145 → 70·70 → 145 시험 서버 모두 성공(IP = NTLM, FQDN = Kerberos), Electron 26 `net.request`·.NET 4.8 이 스스로 Negotiate 처리. 145 는 도메인 가입 PC(로컬 계정 `CF40Admin` 으로 돌아도 도메인 계정 확인됨).
  화면(사용자 결정 2026-11-05): 별도 버튼·'회사 PC 계정' 문구 없음 — 사번 칸 + ACCESS 만, 누르면 Windows 계정으로 확인하고 안 되면 그때 비밀번호 칸.
  **쿼리 `?employee_id=` 로 입력 사번을 보내고, 서버가 Windows 계정과 다르면 세션을 만들기 전에 403 `windows_account_mismatch`**
  (커밋 전 리뷰 — 남의 PC 에서 그 PC 주인 이름으로 로그인 처리·미가입 오판이 일어났다). ⚠ 본문(JSON)으로 보내면 **Electron 40 이 NTLM 3번째 메시지를 보내지 않고 멈춘다**(실측, 26 은 정상) — 본문을 싣지 말 것.
  NTLM 3번째 메시지에 평문으로 든 사용자 이름(`ntlm_claimed_account`)으로 **SSPI 에 묻기 전에** 비밀번호 로그인과 같은 횟수 제한(사번 15분 4회·IP 20회, 두 경로 합산)을 건다 — 없으면 이 경로로 직원 계정을 잠글 수 있다. 누군지 모르는 실패는 IP 별 키(`windows-ip:<ip>`).
  Electron IPC 는 본창만 받고(`event.sender`), Windows 자격 증명은 사내 주소(사설 IPv4·`*.hhi.co.kr`)로만 보낸다(`isInternalHost`).
  개발 앱에서 한 번 15초 시간 초과가 났다 — 원인 미확정(본문 문제 이전 코드에서도 1회 발생). 실패해도 ACCESS 재시도 → 비밀번호 칸으로 막히지 않는다.
  70 AD 모드 실제 로그인 확인함. 비밀번호 로그인은 예비로 유지.
  **보안 재시험(2026-11-05, 145:9443, `HanByul/Open-ModuleTest-InBrowser`)**: 남의 사번 `?employee_id=` → 403 `windows_account_mismatch` · 사번만 `/api/login`(9443·9091) → 401 · 토큰 없는 `__wb_bootstrap` → 401.
  본인 AD 계정으로 로그인한 Windows 세션에서 본인 사번이면 통과해 외부 App 을 브라우저로도 열 수 있다 — 앱과 같은 권한이라 취약점으로 보지 않음(사용자 확인). 시험 사번은 동료 대신 없는 계정 `Z999998`(실패 횟수가 동료 계정에 쌓이지 않게).
  **VMDC(가상 PC) 계정 (2026-11-09)** — AM 사용자 A453013 이 HiTessMB 0.4.0 에서 계속 비밀번호 창을 봤다. 145 활동 로그 = `account_not_employee`·`account: VMDC\A453013`(IP 10.14.45.74).
  145 가 트러스트로 인증까지 마친 뒤 도메인이 HHI 가 아니라 거절한 것이고, 비밀번호 창은 HHI 비밀번호를 묻기 때문에 VMDC 사용자에게 맞지 않는다.
  → `.env` `AD_WINDOWS_DOMAINS=HHI,VMDC`(`AD_NETBIOS_DOMAIN` 은 늘 포함 — 리뷰 반영)로 자동 로그인이 받을 도메인을 넓혔다(`windows_auth.windows_domains`). 비밀번호 로그인(LDAP bind)은 그대로 HHI.
  ⚠ 넣는 도메인은 **계정 이름 = 본인 사번** 이 보장되는 곳만(VMDC 는 IT 확인 권장, 아직 안 함). 클라이언트 재배포 불필요 — 145 `git pull` + `.env` 한 줄 + 재시작.
  상태: `1888654` 푸시 · **145 반영(`.env AD_WINDOWS_DOMAINS=VMDC`) 후 VMDC 사용자 자동 로그인 동작 확인**(사용자, 같은 날).
  같은 날 로그에 AM 이 CSV 인자 없이 HiTessMB 를 부른 기록(인자 오류) 3건 — AM 쪽 호출 문제.
  **계열사 PC = 등록한 PC 로그인 (2026-11-10, `9946fc7` · 릴리스 1.7.17 `228995d`)** — 계열사 직원 PC 는 도메인에 가입하지 않은 **로컬 계정**이다(`whoami` = `a590063\a590063`, A590063·A540031 확인).
  그래서 Windows 자동 로그인은 원리상 안 되고(`windows_auth_failed`), 비밀번호 칸이 떴다. 비밀번호 로그인 자체는 HHI AD 로 된다(A590063 성공 확인).
  사용자 결정: **회사 Windows 비밀번호를 계열사 직원에게 입력하게 하지 않는다**(보안 이슈로 주목받을 수 있음) · **본사(도메인) PC 는 지금 그대로**.
  → 앱이 PC 마다 Ed25519 열쇠를 만들어 비밀 열쇠는 safeStorage(DPAPI, Windows 사용자 단위)로 잠가 두고, 관리자가 한 번 승인하면 이후 서명으로 들어온다.
  - 판별: Electron `electron/device-login.js` `isLocalAccount` = `USERDOMAIN == COMPUTERNAME`. 이 PC 는 Windows 자동 로그인을 시도하지 않고 비밀번호 칸도 없다(`utils/deviceLogin.js` `isDeviceMode`).
  - 서버 `services/device_login.py` · `routers/device_login.py`(`/api/login/device/enroll|challenge`, `/api/login/device`, 관리자 `/api/admin/devices[/{id}/approve|reject|revoke]`), 표 `trusted_devices`(create_all).
    서명 글 = `hitess-device-login:<device_id>:<nonce>`(nonce 60초·한 번), 앱은 이 머리의 글만 서명한다. 상태(대기·해지)는 서명이 맞은 뒤에만 알려 준다. 90일 안 쓰면 만료.
    ⚠ 문제는 **nonce 값으로** 찾는다(기기 번호로 하나만 들면 남이 같은 번호로 문제를 받아 정상 PC 의 문제를 덮어써 401 → 앱이 승인된 열쇠를 지웠다, 커밋 전 리뷰 '막아야 함').
    낡은 문제 = 409 `challenge_stale`, 서명 불일치 = 401. 앱은 401·409 에 새 문제로 한 번 더 시도한 뒤에만 열쇠를 버린다. 사용자 삭제 시 그 사번 PC 등록도 해지.
    **기본 확인 = 회사 메일 코드**(사용자 결정 2026-11-10: 관리자가 직원에게 코드를 묻지 않게) — 등록 요청 때 `users.email` 로 6자리 코드를 보내고(`services/mailer.py`, `.env` `SMTP_HOST`·`SMTP_PORT`·`SMTP_FROM`·`SMTP_USER`·`SMTP_PASSWORD`·`SMTP_STARTTLS`),
    직원이 앱에 입력하면 바로 승인(`/api/login/device/verify`, 10분·5회 틀리면 무효, `/resend` 60초·5통). 확인·다시 보내기도 그 PC 열쇠 서명(`hitess-device-login:verify|resend:<id>:<nonce>`)이 필요하다.
    메일이 없거나 SMTP 설정이 없거나 발송 실패면 **관리자 승인**으로 넘어간다 — 확인 코드(공개 열쇠 지문 `XXX-XXX`)를 관리자가 이미 아는 연락처로 직원에게 물어 적어야 승인(`confirm_code_mismatch`).
    두 번째 커밋 전 리뷰 반영: 틀린 횟수는 비교 전에 한 줄 UPDATE 로 올린다(읽고 더하면 동시 요청에서 유실 → 5회 제한 우회, '막아야 함' — MySQL 동시 20건 = 틀림 5·잠김 15 확인) · 확인 요청 IP당 시간 60회 ·
    대기 요청 24시간 만료(남이 대기 3건을 채워 본인 등록 막기 방지) · 메일 본문 PC 이름은 NetBIOS 모양만(`safe_hostname`) + 요청 IP · 메일 방식 화면에도 관리자용 확인 코드 작게 · STARTTLS 인증서 확인.
    남긴 것: 등록 요청 응답이 사번 가입 여부·메일 앞 2자를 드러냄(`/check_user` 와 같은 수준이라 그대로), 계정이 있는데 STARTTLS 를 안 켜면 SMTP AUTH 가 평문(사내망).
    SMTP: 사내 메일 서버 `exmail.hhi.co.kr:25` 는 `AUTH LOGIN` 만 받고 **STARTTLS 미지원**(`SMTP_STARTTLS` 넣지 말 것 — 계정은 사내망 평문, 기존 `Postman_Console` 과 같음).
    계정·보내는 주소는 `Postman_Console/Program.cs` 의 발송 계정(21·22·25행)을 사용자가 70 `.env` 에 넣음(2026-11-10). **70 실제 발송 확인**: 본인 메일(`@hd.com`)로 코드 수신 → 코드 입력 승인 → 로그인 토큰까지 통과.
    145 는 `.env` 에 같은 SMTP 줄 + 145 에서 25번 접속 확인이 남았다(**없으면 메일 대신 관리자 승인으로 넘어간다** — 공지 메일은 '메일로 코드가 온다'고 안내하므로 넣은 뒤 보낼 것). 계열사 직원 메일함 도착은 확인 안 함.
    상태(2026-11-10): 145 서버 1.7.17 반영(사용자 ⟳ Update+재시작). 공지 메일(새 exe 받기 + PC 등록 방법)은 Outlook 초안으로만 만들었고 발송은 사용자 몫.
  - 화면: 로그인 화면 '이 PC 등록 요청' → (메일) 6자리 코드 칸·코드 다시 보내기 / (관리자) 확인 코드 표시 + 15초마다 확인, 승인되면 저절로 들어감. 관리자 = User Management 'PC 등록 [대기 N]'(`TrustedDevicesModal`). 활동 로그 `DEVICE_ENROLL/APPROVE/REJECT/REVOKE`, 로그인 기록 `method: device`.
  - 끄기 `.env DEVICE_LOGIN=0`(AD 모드에서만 켜짐). 반영 = 145 ⟳ Update + 재시작(새 표) + **새 exe**(Electron IPC `device:info`·`device:op`). 옛 exe 는 예전처럼 비밀번호 칸.
  - 확인: 서버 시험 + 70 MySQL 임시 서버로 등록~승인~서명 로그인~해지 실제 호출, Electron 26 에서 만든 서명을 서버가 검증. **로그인 화면·관리 창은 눈으로 확인 안 함**, 실제 계열사 PC 시험 안 함.
  - 범위 밖: Studio 세션 갱신(`refreshWorkbenchSession`)은 등록 PC 로 재로그인하지 않는다(만료 시 본창 로그인 화면으로 — 거기서 자동으로 들어감). AM 실행기·HiTessMB 는 미적용.
- **HTTPS + 인증서 고정 (2026-11-05, 통합 계획 2·3단계)** — 2단계 `0823543`: 같은 프로세스가 9091 옆에 9443 HTTPS(`services/https_listener.py`, `.env` `HTTPS_PORT`, 인증서 `scripts/make_tls_cert.py` — 145 에서 실행, 키는 `.secrets/tls/`).
  3단계(`9a14ec7`·`881eeb3`, 릴리스 1.7.2 `6045358`): 앱이 145 인증서의 공개키 지문(지금 `y5rO…`·예비 `u1mZ…`)이 같을 때만 연결 — **원본 `electron/server-pins.js`**, 사본 `AmLauncher/lib/server-pins.js`·HiTessMB `src/ServerPins.cs`·프론트 `utils/secureServerUrl.js`(주소 바꾸기만). 지문·주소를 바꾸면 네 곳 다.
  규칙: 지문 일치 = 통과 · 145 주소인데 불일치 = 거부(회사가 믿는 Somansa 인증서여도) · 그 밖 = 기본 검사. 개발 실행만 70 시험 지문(`DEV_PINS`)도 받는다.
  ⚠ Electron main 의 Node `fetch`·`https.get` 은 고정 검사를 거치지 않는다 → 서버 요청은 `serverFetch`(net.fetch)·`net.request` 로만. 검사 함수는 첫 요청 전에 건다(Chromium 이 세션별로 결과를 기억).
  화면은 시작 때(`secureServerBootstrap.js`) 저장된 `http://10.14.42.145:9091` 을 `https://…:9443` 으로 바꾼다. 사용자가 서버 설정에 직접 넣은 주소(`wb_server_url_manual`)는 그대로 — 145 HTTPS 장애 때 평문으로 되돌리는 비상구.
  이중관 Mode Shape 뷰어·HiTessMB 가입 페이지(브라우저)는 평문 그대로. 버전: 실행기 0.1.4 · HiTessMB 0.4.0. 실측(70:9443): 개발 앱 로그인·내 작업·Studio, Electron 26·40 Windows 로그인·FormData·자체 업데이트 다운로드, HiTessMB 지문 있음/없음.
  **상태(2026-11-05 세션 끝)**: 145 HTTPS 켜짐(`.env HTTPS_PORT=9443`, 70 에서 지문 일치·앱 코드로 Windows 로그인 200) · 145 `StudioProgram\mb-launcher-0.1.4.zip` 복사됨 · exe 1.7.2 빌드·푸시(`dist_electron\HiTESS-WorkBench-v1.7.2.exe`).
  **같은 포트 HTTPS (2026-11-10, 1.7.16)** — 계열사 다른 위치가 보안 정책으로 145 의 **9091 만** 방화벽을 열어 둬, 1.7.2~ 앱이 9443 에 못 붙었다
  (로그인 화면 '서버 연결을 복구해야…', AD 와 무관 — 버전 확인 단계에서 실패). 사용자 결정: 수동 주소 변경은 번거로워 안 하고, **9091 이 평문과 HTTPS 를 함께 받게** 한다.
  `app/services/port_mux.py` `MuxHTTPProtocol` — 연결의 첫 바이트가 0x16(TLS)이면 그 자리에서 asyncio `SSLProtocol` 로 바꾸고 받은 바이트를 넘긴다(scheme=https·접속 IP 그대로), 아니면 uvicorn 기본 처리.
  켜짐 = `server_manager.py` `SERVER_CMD` 의 `--http app.services.port_mux:MuxHTTPProtocol` + `.env HTTPS_PORT`(같은 인증서), 끔 = `HTTP_PORT_TLS=0`. ⚠ `asyncio.sslproto` 내부 API — 파이썬을 올리면 `tests/test_port_mux.py` 로 확인.
  앱 주소표(`electron/server-pins.js`·`utils/secureServerUrl.js`): `http://…145:9091` 과 1.7.2~1.7.15 가 저장한 `https://…145:9443` → **`https://…145:9091`**. 인증서 고정은 그대로(호스트 기준).
  9443 은 옛 exe·실행기(AmLauncher)·HiTessMB 용으로 계속 연다 — 그 둘은 9443 그대로(사용자 결정: 외부 쪽은 안 바꿈). 직접 넣은 주소(수동)는 바꾸지 않는다.
  ⚠ **반영 순서**: 145 `git pull` → **서버 관리자 창을 닫고 다시 열기**(⟳ Update 는 메모리의 옛 `SERVER_CMD` 로 재시작해 `--http` 가 안 붙는다) → 다른 PC 에서 `curl -k https://10.14.42.145:9091/api/version` 확인 → 새 exe 배포.
  서버보다 exe 가 먼저 나가면 **모든 사용자가 접속 못 한다**. 계열사 사용자는 지금 접속이 안 돼 자동 업데이트를 못 받으니 새 exe 를 따로 전달해야 한다.
  확인: 실제 uvicorn(시험·명령줄)에서 평문·TLS·keep-alive·3MB 업로드·깨진 TLS 뒤 회복, 헤드리스 Chrome 이 같은 포트 HTTPS 로 받음.
  **145 반영(2026-11-10)**: 1.7.16(`2493283`) ⟳ Update 만 한 동안은 9091 이 TLS 에 평문으로 답해(`SEC_E_INVALID_TOKEN`) 새 exe 가 '서버 연결을 복구해야…' 로 막혔고,
  서버 관리자를 끄고 다시 연 뒤 70 에서 `https://…145:9091`·`http://…145:9091`·`https://…145:9443` 모두 1.7.16, 사용자 1.7.16 exe 로그인 확인.
  ⚠ 옛 exe(1.7.2~1.7.15)는 9443 으로만 붙어 그 계열사에서 **업데이트 창도 안 뜬다**(2026-11-10 실제 문의) — 새 exe 를 직접 전달하는 것이 기본.
  **메일용 내려받기 주소 `http://10.14.42.145:9091/download`** (2026-11-10, `c39e8b2`) — 로그인 없이 `LastestVersionProgram` 의 가장 새 exe(mtime 기준)를 준다(`system.public_router`, `/api/download/client` 와 같은 `_serve_latest_client`, 활동 로그 type `direct_link`). 145 반영·1.7.17 내려받기 확인함. 메일 미리보기가 링크를 먼저 열면 내려받기 기록이 부풀 수 있다. ⚠ '최신' = 버전 번호가 아니라 **파일 수정 시각**(`system.py` `_serve_latest_client`) — 옛 exe 를 나중에 그 폴더로 복사하면 옛것이 나간다. 폴더에는 최신 exe 하나만 둔다(사용자 운영 방식, 이름 버전 정렬로 바꾸는 안은 보류).
  예비: 옛 exe 서버 주소를 `http://10.14.42.145:9091` 로 직접 넣어 업데이트를 받은 뒤, 새 exe 에서 `https://10.14.42.145:9091` 을 다시 직접 넣는다
  (직접 넣은 주소는 '수동' 이라 새 exe 도 바꾸지 않아 평문으로 남는다. 서버 설정 '기본값' 은 config 기본 9443 이라 누르지 말 것).
  남은 일: 계열사 PC 에 1.7.16 exe 따로 전달 후 접속 확인 — 안 되면 그 PC 에서 `curl.exe -skv https://10.14.42.145:9091/api/version`
  (TLS 단계 실패면 그쪽 보안 장비의 HTTPS 가로채기 → 인증서 고정이 끊는 경우). HiTessMB `ServerPins.cs` 주석은 실행기처럼 '9443 유지' 로 고치지 않았다(별도 저장소).
  남은 일: exe 1.7.2 배포 → 145 ⟳ Update + 재시작(서버 버전 1.7.2) · HiTessMB 0.4.0(`cab9bf7`, 원격 없음) AM PC 배포 · 외부 App 저장·계산 확인(화면 열림만 확인) · 외부 개발자에게 `RecordMD/2026-11-05-external-app-https-pinning-handoff.md`(+11-03 문서) 전달 · 70 `.env` 시험 줄(`AUTH_MODE=ad`·`HTTPS_PORT=9443`) 정리 · 4단계(9091 로그인 거부)는 1.7.2 가 퍼진 뒤.
  릴리스 스크립트는 로컬 145 줄이 `https://10.14.42.145:9443`·`http://…:9091` 어느 쪽이든 받는다(`2266080`). `http://…:9443` 은 네 사본 모두 https 로 고친다(`881eeb3`).
  ⚠ **배포 순서**: 145 HTTPS 켜기(인증서 → `.env HTTPS_PORT=9443` → 재시작 → 방화벽 9443 → 다른 PC 에서 확인) → 145 `mb-launcher-0.1.4.zip` → WorkBench exe → HiTessMB 0.4.0(0.1.3 실행기는 HTTPS 를 못 받는다). 새 exe 를 한 번 켠 PC 는 옛 exe 로 되돌리면 접속 못 한다(저장 주소가 https).
- ⚠ **스위치를 켜기 전에 반드시**: ① 새 WorkBench exe(1.7.1, 비밀번호 칸) 배포 ② 위 AM 연동 두 프로그램 배포
  ③ 145 `pip install -r requirements.txt`(`ldap3`) + 145 에서 AD 636 접속 확인(70 만 확인함).
  Electron `refreshWorkbenchSession`(401 때 사번만 재로그인)은 고치지 않았다 — AD 모드에선 실패하고, 본체 화면 하트비트 401 → `App.jsx` 인터셉터가 로그인 화면으로 보낸다.
  `check_user`(토큰 안 줌)·`hitessbeam` 익명 업로드는 이번 범위 밖. 켤 때 hitess-core 로그인 계약 문서(`docs/20-phase2-identity.md`)도 갱신.
