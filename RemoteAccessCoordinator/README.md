# RDP Access Coordinator

Windows Server의 RDP 접속 현황을 보이고, 현재 접속자에게 원격 사용 요청과 채팅을 보내는 사내망 전용 포터블 프로그램입니다.

## 실행

1. `config/remote_ip_owners.txt`에 고정 IP와 이름을 입력합니다.
2. 서버(10.14.42.145)에서 `RdpCoordinatorServer.exe`를 실행한 채로 둡니다.
3. 방화벽에서 서버의 인바운드 TCP `8765`를 사내망에만 허용합니다.
4. 각 개인 PC에서 `dist/electron-client/RDP-Access-Desk-0.1.0.exe`를 실행합니다. 이 Electron 클라이언트가 권장 배포본입니다.

서버가 꺼진 동안에는 현황 확인, 상태 저장, 메시지 전송이 동작하지 않습니다. 메시지와 상태는 서버를 재시작하면 초기화됩니다.

## 개발·빌드

```powershell
cd C:\Coding\WorkBench\RemoteAccessCoordinator
..\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe -m pip install -r requirements.txt
.\build.ps1
```

빌드 결과는 `dist/RdpCoordinatorServer.exe`, `dist/RdpCoordinatorClient.exe`입니다. 서버 EXE와 같은 폴더에 `config/remote_ip_owners.txt`를 유지해야 합니다.

새 Electron 클라이언트는 `client-electron/`에 있으며, `npm install` 후 `npm run dist`로 `dist/electron-client/RDP-Access-Desk-0.1.0.exe`를 다시 만들 수 있습니다.

## 현재 동작

- Windows Terminal Services API로 RDP 세션별 클라이언트 IP를 확인합니다.
- `remote_ip_owners.txt`의 고정 IP를 사람 이름으로 변환합니다.
- 접속 시작 시각과 경과 시간, 활성/연결 끊김 상태를 표시합니다.
- 현재 RDP 세션으로 확인되는 사용자만 상태를 남길 수 있습니다. IP 목록에 등록된 사용자는 RDP에 접속하기 전에도 현재 접속자에게 사용 요청을 보낼 수 있습니다.
- 메시지는 최대 500개를 서버 메모리에 보관합니다.
