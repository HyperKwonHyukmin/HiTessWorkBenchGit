# HiTESS WorkBench 운영 가이드

> 이 문서는 HiTESS WorkBench 시스템의 일상적 운영, 배포, 유지보수 절차를 기록한 참조 문서입니다.
> 오랜 시간이 지나도 이 문서만 보고 모든 운영 작업을 수행할 수 있도록 작성되었습니다.

---

## 1. 시스템 구성도

```
[개발 PC: 10.133.122.70]
    ↓ git push
[GitHub: HyperKwonHyukmin/HiTessWorkBenchGit]
    ↓ git pull (서버 GUI의 Update 버튼)
[서버 PC: 10.14.42.145]
    └─ FastAPI (uvicorn, port 9091)
    └─ MySQL (port 3306)
    └─ InHouseProgram/ (해석 exe 파일들)
    └─ LastestVersionProgram/ (배포용 최신 클라이언트 exe)
         ↑ 사용자 버전 불일치 시 다운로드
[사용자 PC]
    └─ HiTESS-WorkBench-vX.X.X.exe (Electron 앱)
        → http://10.14.42.145:9091 으로 통신
```

**서버 PC 주요 경로:**
```
C:\KHM\HiTessWorkbench\HiTessWorkBenchGit\
    ├── WorkBenchEnv\                   ← Python 가상환경
    ├── HiTessWorkBenchBackEnd\
    │   ├── app\
    │   │   └── routers\system.py       ← 서버 버전 정의
    │   ├── server_manager.py           ← 서버 관리 GUI
    │   ├── HiTESS_Server.bat           ← 서버 실행 배치파일
    │   ├── InHouseProgram\             ← 해석 exe (git 미포함, 수동 복사)
    │   ├── LastestVersionProgram\      ← 배포용 클라이언트 exe
    │   └── .env                        ← 환경변수 (git 미포함, 수동 생성)
    └── HiTessWorkBench\
        └── frontend\
            └── package.json            ← 클라이언트 버전 정의
```

---

## 2. 버전 업데이트 절차 ★가장 빈번한 작업★

클라이언트(exe)와 서버의 버전이 일치하지 않으면 로그인 화면에서 "업데이트 필요" 경고가 표시되고 로그인이 차단됩니다.

### 버전이 관리되는 파일 2곳

| 파일 | 위치 | 역할 |
|------|------|------|
| `HiTessWorkBench/frontend/package.json` | `"version": "0.0.1"` | 클라이언트(exe) 버전 |
| `HiTessWorkBenchBackEnd/app/routers/system.py` | `SERVER_VERSION = "0.0.1"` | 서버 버전 |

> **반드시 두 값을 동일하게 맞춰야 합니다.**

### 버전 업데이트 전체 순서

```
Step 1. [개발 PC] 코드 수정 완료 후:
        frontend/package.json → "version": "신버전"
        HiTessWorkBenchBackEnd/app/routers/system.py → SERVER_VERSION = "신버전"

Step 2. [개발 PC] GitHub에 업로드:
        git add -A
        git commit -m "버전 x.x.x 업데이트"
        git push origin main

Step 3. [서버 PC] server_manager.py GUI에서 "Update" 버튼 클릭
        (서버 자동 재시작됨)

Step 4. [개발 PC] Electron exe 재빌드:
        cd C:\Coding\WorkBench\HiTessWorkBench
        npm run dist
        → 결과물: dist_electron\HiTESS-WorkBench-v신버전.exe

Step 5. [서버 PC] 새 exe를 LastestVersionProgram 폴더에 복사:
        C:\KHM\HiTessWorkbench\HiTessWorkBenchGit\HiTessWorkBenchBackEnd\LastestVersionProgram\
        (이전 버전 파일은 삭제하거나 남겨둬도 무방 — 가장 최근 수정된 파일이 자동 선택됨)

Step 6. [사용자] 기존 exe 실행 → 버전 불일치 화면 → "최신 버전 다운로드" 클릭
        → 새 exe 다운로드 → 설치 후 사용
```

---

## 3. 일상적 코드 배포 (버전 변경 없는 버그 수정/기능 추가)

버전 숫자를 올릴 필요가 없는 경우 (서버 코드만 수정, 프론트는 그대로인 경우):

```
Step 1. [개발 PC] 코드 수정 → commit → push:
        git add -A
        git commit -m "수정 내용"
        git push origin main

Step 2. [서버 PC] server_manager.py GUI에서 "Update" 버튼 클릭
        내부 동작:
          ① 서버 중지
          ② git pull origin main
          ③ pip install -r requirements.txt (패키지 추가된 경우 자동 반영)
          ④ 서버 재시작

※ 프론트엔드(React)만 수정했다면 exe 재빌드도 필요합니다.
※ 백엔드(Python)만 수정했다면 exe 재빌드 불필요.
```

---

## 4. Electron exe 빌드 방법

```bash
# 개발 PC에서 실행
cd C:\Coding\WorkBench\HiTessWorkBench
npm run dist
```

- 내부 순서: React 빌드(vite) → Electron packaging(electron-builder)
- 결과물: `dist_electron\HiTESS-WorkBench-v{version}.exe`
- 빌드 시간: 약 1~3분

### exe 재빌드가 필요한 경우

| 변경 사항 | exe 재빌드 필요 |
|-----------|----------------|
| 프론트엔드(React) 코드 수정 | ✅ 필요 |
| 버전 번호 변경 | ✅ 필요 |
| 서버 IP/포트 변경 | ✅ 필요 |
| 백엔드(Python) 코드만 수정 | ❌ 불필요 |
| 관리자 설정, DB 데이터 변경 | ❌ 불필요 |

---

## 5. 서버 IP 또는 포트 변경 시

현재 설정: `http://10.14.42.145:9091`

변경이 필요한 경우 아래 파일들을 모두 수정해야 합니다.

### 코드 파일 (필수)

| 파일 | 수정 위치 |
|------|-----------|
| `HiTessWorkBench/frontend/src/config.js` | 5번째 줄 `DEFAULT_API_BASE_URL` |
| `HiTessWorkBenchBackEnd/server_manager.py` | 27번째 줄 `SERVER_CMD --port` |
| `HiTessWorkBenchBackEnd/server_manager.py` | `_kill_port(9091)`, `_kill_port(8000)` 숫자 |
| `HiTessWorkBenchBackEnd/server_manager.py` | UI 텍스트 "port 9091" |
| `HiTessWorkBench/frontend/src/components/layout/Layout.jsx` | placeholder 텍스트 |

### 데이터/문서 파일 (권장)

| 파일 | 내용 |
|------|------|
| `HiTessWorkBenchBackEnd/app/seed_guides.py` | 사용자 가이드 텍스트 내 주소 |
| `CLAUDE.md` | 프로젝트 문서 |
| `README.md` | 리드미 |
| `.claude/docs/DEPLOYMENT_GUIDE.md` | 배포 가이드 |

### 변경 후 추가 작업

```bat
# 서버 PC 방화벽에서 새 포트 허용 (서버 PC에서 실행)
netsh advfirewall firewall add rule name="HiTESS WorkBench 새포트" dir=in action=allow protocol=TCP localport=새포트

# exe 재빌드 필수 (개발 PC)
cd C:\Coding\WorkBench\HiTessWorkBench && npm run dist
```

---

## 6. 서버 PC 관리

### 서버 실행 방법

서버 PC에서 `HiTESS_Server.bat` 더블클릭. 또는 직접 실행:

```bat
cd C:\KHM\HiTessWorkbench\HiTessWorkBenchGit
call WorkBenchEnv\Scripts\activate
cd HiTessWorkBenchBackEnd
python server_manager.py
```

### server_manager.py GUI 기능

| 버튼 | 동작 |
|------|------|
| Start | uvicorn 서버 시작 (포트 9091) |
| Stop | 서버 중지 |
| Update | git pull + pip install + 서버 재시작 (GitHub 최신 코드 반영) |
| Clear | 로그 창 지우기 |

- GUI를 실행하면 서버가 자동으로 시작됩니다.
- GUI 시작 시 9091/8000 포트를 점유한 좀비 프로세스를 자동으로 종료합니다.
- GUI 창을 닫으면(X 버튼) 서버도 함께 종료됩니다.

---

## 7. 서버 PC 초기 설정 (새 서버로 이전 시)

### 필수 소프트웨어 설치

- [ ] Python 3.10 이상
- [ ] Git
- [ ] MySQL 8.0

### 프로젝트 설정

```bat
# 1. 코드 클론
cd C:\KHM\HiTessWorkbench
git clone https://github.com/HyperKwonHyukmin/HiTessWorkBenchGit.git
cd HiTessWorkBenchGit

# 2. 가상환경 생성 (git 루트에서)
python -m venv WorkBenchEnv

# 3. 패키지 설치
call WorkBenchEnv\Scripts\activate
pip install -r HiTessWorkBenchBackEnd\requirements.txt
```

### MySQL DB 생성

```sql
-- MySQL에서 실행
CREATE DATABASE hitessworkbench CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'admin'@'localhost' IDENTIFIED BY '비밀번호';
GRANT ALL PRIVILEGES ON hitessworkbench.* TO 'admin'@'localhost';
FLUSH PRIVILEGES;
```

### .env 파일 생성

`HiTessWorkBenchBackEnd\.env` 파일을 `.env.example`을 참고하여 생성:

```env
DB_USER=admin
DB_PASSWORD=실제비밀번호
DB_HOST=localhost
DB_PORT=3306
DB_NAME=hitessworkbench

REPORTS_DIR=C:\KHM\HiTessWorkbench\HiTessWorkBenchGit\HiTessWorkBenchBackEnd\reports_data
OLLAMA_BASE_URL=http://localhost:11434
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

### 수동 복사 필요한 폴더 (git에 포함되지 않음)

```
HiTessWorkBenchBackEnd\
    InHouseProgram\          ← 해석 exe 파일들 (이전 서버에서 복사)
    LastestVersionProgram\   ← 폴더 생성 후 최신 클라이언트 exe 복사
```

### 방화벽 설정

```bat
netsh advfirewall firewall add rule name="HiTESS WorkBench 9091" dir=in action=allow protocol=TCP localport=9091
```

---

## 8. 트러블슈팅

### 포트 충돌 오류 (Errno 10048)

서버 시작 시 `error while attempting to bind on address ('0.0.0.0', 9091)` 발생:

```bat
# 점유 프로세스 확인
netstat -ano | findstr :9091
# PID 확인 후 강제 종료
taskkill /PID <PID번호> /F
```

→ server_manager.py를 통해 재시작하면 자동으로 처리됨.

### 클라이언트 "Offline" 표시

1. 서버 PC에서 서버가 실행 중인지 확인 (server_manager.py GUI 확인)
2. 브라우저에서 `http://10.14.42.145:9091/api/version` 접속 테스트
3. 응답 없으면 → 방화벽 규칙 확인
4. 응답 있는데 앱이 Offline → `config.js`의 `DEFAULT_API_BASE_URL` 확인
5. `localStorage`에 이전 URL이 저장된 경우 → 앱 내 서버 URL 설정에서 수동 변경

### 버전 불일치 화면이 계속 뜨는 경우

`frontend/package.json`의 `version` 값과 `system.py`의 `SERVER_VERSION` 값을 동일하게 맞추고, 서버를 재시작하고 exe를 재빌드합니다.

### Python 실행 파일 못 찾는 오류

server_manager.py 실행 시 "Python 실행 파일을 찾을 수 없습니다" 메시지:

- `C:\KHM\HiTessWorkbench\HiTessWorkBenchGit\WorkBenchEnv\Scripts\python.exe` 존재 확인
- 없으면 `python -m venv WorkBenchEnv` 재생성 후 `pip install -r requirements.txt` 재실행

### Update 버튼 실행 시 git pull 실패

- GitHub 자격증명 만료: `git config --global credential.helper store` 후 수동 pull 1회 실행
- 로컬 충돌 파일 존재: 충돌 파일 확인 후 `git checkout -- <파일>` 또는 삭제

---

## 9. 현재 설정 현황 (최종 업데이트: 2026-04-06)

| 항목 | 값 |
|------|----|
| 서버 PC IP | 10.14.42.145 |
| 서버 포트 | 9091 |
| 현재 버전 | 0.0.1 |
| GitHub | https://github.com/HyperKwonHyukmin/HiTessWorkBenchGit |
| 서버 경로 | C:\KHM\HiTessWorkbench\HiTessWorkBenchGit\ |
| 가상환경 | git 루트\WorkBenchEnv\ |
