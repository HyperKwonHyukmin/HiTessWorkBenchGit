# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 상위 `C:\Coding\WorkBench\CLAUDE.md`(HiTESS WorkBench)와 전역 규칙(한국어 주석·커밋 메시지 등)은 그대로 적용된다. 이 문서는 **RemoteAccessCoordinator 전용** 내용만 다룬다.

## 이 프로젝트의 정체

**RDP Access Coordinator** — 팀이 공유하는 Windows RDP 호스트(`10.14.42.145`)의 접속 현황을 실시간으로 보여주고, 접속 전 현재 작업자에게 "원격 사용 요청"과 채팅을 보내는 **사내망 전용 포터블 도구**다. 순서 없이 서로 원격에 붙으면 세션을 뺏는 문제를 조율하기 위한 것.

- WorkBench 폴더 안에 있지만 **WorkBench git 레포에 untracked**(별개의 독립 도구, 현재 버전관리 밖). WorkBench 백엔드/프론트와 코드 의존성 없음 — 유일한 공유물은 빌드에 쓰는 `..\HiTessWorkBenchBackEnd\WorkBenchEnv` 파이썬 가상환경뿐이다.
- 3개 실행체: **서버 1개 + 클라이언트 2개**(신형 Electron 권장 / 구형 Tkinter 레거시).

## 아키텍처

```
[server.py]  FastAPI :8765  — 공유 RDP 호스트(10.14.42.145)에서 상주 실행
   │  Windows Terminal Services에서 RDP 세션·클라이언트 IP를 직접 읽음
   │  메시지·상태를 인메모리 보관(재시작 시 소실)
   ├── client-electron/  Electron + React  ← 권장 배포본, 각 개인 PC에서 실행
   └── client.py         Tkinter 데스크톱   ← 레거시(같은 API를 쓰는 단순 버전)
```

- 클라이언트는 **자기 IP를 서버로 UDP 소켓을 열어 로컬 sockname으로 알아낸다**(`client.py:own_ip`, `main.cjs:getLocalAddress`). 이 IP가 사용자 신원의 핵심이다 — 서버는 이 IP로 "현재 RDP 접속자인가"를 판별한다.
- 클라이언트는 3초마다 `GET /api/status` + `GET /api/messages`를 폴링한다(웹소켓 없음).

## 서버 RDP 탐지 내부 동작 (`server.py`, 이 프로젝트의 핵심·비자명 영역)

`read_rdp_sessions()`가 여러 Windows 소스를 조합해 세션 목록을 만든다. 수정 시 이 폴백 순서를 반드시 이해할 것:

1. **세션 목록**: `qwinsta`(1순위, `parse_qwinsta_output`) → 결과가 비었을 때만 `query user`(`parse_query_user`)를 2차로 사용. `query user`는 idle/logon 시각 보강용.
2. **클라이언트 IP**: Windows Terminal Services API `WTSQuerySessionInformationW`(WTSClientAddress=14)를 ctypes(`wtsapi32`)로 직접 호출(`session_client_ip`).
3. **IP 폴백**: 일부 서버 정책은 WTSClientAddress를 막는다. 이때 **IP 미확인 세션이 정확히 1개 + 3389 established 피어가 정확히 1개**면 그 TCP 피어로 채운다(`active_rdp_tcp_ips`, `Get-NetTCPConnection`).
4. **접속 시각**: `Get-WinEvent`로 TerminalServices RemoteConnectionManager/Operational **Event ID 1149**를 읽어 사용자별 최근 로그온 시각을 얻음(`recent_rdp_logon_times`, **30초 캐시**).
5. **이름 매핑**: `config/remote_ip_owners.txt`의 `IP : 이름`으로 IP→표시 이름 변환.

⚠️ **서버는 Windows 전용**이다. `os.name != "nt"`면 `read_rdp_sessions`가 빈 리스트를 반환한다(ctypes WinDLL·qwinsta·powershell 의존). 다른 OS에서 로직 테스트는 이 함수들을 우회해야 한다.

## API

| 엔드포인트 | 인가 규칙 |
|---|---|
| `GET /api/status` | 서버 시각 + 현재 세션 목록(각 세션에 `connected_duration`·`status` 포함) |
| `POST /api/status` | `client_ip`가 **현재 RDP 세션 IP일 때만** 상태 저장(아니면 403). `StatusIn`: message ≤200자, expected_minutes 1~1440 |
| `GET /api/messages?client_ip=&after_id=` | 해당 IP가 보내거나 받은, `after_id` 이후 메시지만 |
| `POST /api/messages` | `from_ip`·`to_ip` **둘 다 owners 파일에 등록**돼야 함. 원칙: 최초 요청은 현재 RDP 작업자에게만 → 이후 작업자는 아직 RDP 미접속인 요청자에게 답장 가능(`MessageIn.kind` = `chat`/`access_request`, text 1~1000자, 최대 500개 인메모리) |

- `current_sessions()`는 매 호출 시 현재 활성 IP에 없는 저장 상태(status)를 정리한다.
- 상태·메시지는 전부 인메모리(`statuses` dict, `messages` list)이며 `threading.Lock`으로 보호. **서버 재시작 시 전부 초기화**된다.

## 빌드 & 실행

```powershell
# 파이썬 EXE (서버 + Tkinter 클라이언트) — RemoteAccessCoordinator/ 에서
..\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe -m pip install -r requirements.txt
.\build.ps1        # PyInstaller onefile → dist\RdpCoordinatorServer.exe, dist\RdpCoordinatorClient.exe (+ config 복사)

# 서버 로컬 실행(개발)
python server.py   # :8765, host 0.0.0.0

# Electron 클라이언트 — client-electron/ 에서
npm install
npm run dev        # vite(:5188 strictPort) + electron 동시 실행
npm run dist       # → ../dist/electron-client/RDP-Access-Desk-<version>.exe (portable)
```

- `build.ps1`은 WorkBench 가상환경 파이썬(`..\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe`)을 우선 쓰고 없으면 시스템 `python`으로 폴백한다.
- `RdpCoordinatorServer.spec`은 `console=True`(서버는 콘솔 창), `RdpCoordinatorClient.spec`은 `console=False`(Tkinter는 windowed). `.spec`은 PyInstaller가 생성한 산출물.
- Electron 버전은 `client-electron/package.json` 한 곳(현재 `0.1.7`). ⚠️ README는 `0.1.0`을 예시로 적어 **드리프트가 있으니 README 문자열을 정본으로 믿지 말 것**.
- 클라이언트는 로그인 시 자동 실행(자가 등록) + 시스템 트레이 상주 앱이다. 자동시작 등록은 **패키징된 exe에서만**(`app.isPackaged`), 포터블 실경로(`PORTABLE_EXECUTABLE_FILE`)를 `--hidden` 인자와 함께 HKCU Run에 등록. 창을 닫으면 종료가 아니라 트레이로 숨고, 새 수신 메시지는 `app:notify` IPC로 네이티브 토스트 + `flashFrame`으로 알린다. 트레이/창/exe 아이콘은 `electron/icon.png`·`build/icon.ico`(Pillow 생성).

## 배포

1. 서버 EXE를 `10.14.42.145`에서 상주 실행. **`config/remote_ip_owners.txt`를 서버 EXE와 같은 폴더에 둔다**(frozen 시 `APP_DIR`이 exe 위치로 잡힘). owners 파일은 `utf-8-sig` → 실패 시 `cp949`로 읽음.
2. 방화벽에서 인바운드 TCP **8765**를 사내망에만 허용.
3. 각 개인 PC에서 `dist/electron-client/RDP-Access-Desk-<version>.exe` 실행.
4. owners 파일을 바꾸면 서버 재시작 또는 API 새로고침으로 반영.

## 함정 · 주의

- **서버 IP `10.14.42.145`가 3곳에 하드코딩**돼 있다 — `client.py`(`SERVER_HOST`), `client-electron/frontend/src/main.jsx`(`BASE_URL`), `client-electron/electron/main.cjs`(`getLocalAddress`의 UDP 대상 + `mstsc.exe /v:` 인자). 서버 주소를 바꾸면 **세 곳을 함께** 고쳐야 한다.
- Electron `main.cjs`의 `rdp:connect`는 `mstsc.exe /v:10.14.42.145 /prompt`를 spawn해 실제 원격 데스크톱을 연다. preload는 `window.rdpDesk`(`localIp()`, `connect()`)만 노출(contextIsolation on, nodeIntegration off).
- 브라우저(비-Electron) 미리보기에서는 `window.rdpDesk`가 없어 IP가 "브라우저 미리보기"로 뜨고 원격 연결 버튼이 동작하지 않는다 — 정상 폴백.
- 서버 CORS는 `allow_origins=["*"]`(사내망 신뢰 전제).
