# HiTESS WorkBench — 릴리즈 프로세스

## 개요

배포는 개발 PC에서 `scripts/release.ps1`로 릴리즈 산출물을 만들고,
생성된 exe를 개발 PC의 백엔드 배포 폴더(`HiTessWorkBenchBackEnd/LastestVersionProgram/`)에 모으는 방식으로 진행합니다.
서버 PC의 `LastestVersionProgram/` 반영은 운영자가 수동 복사합니다.
이후 서버 PC에서 `server_manager.py`의 Update 버튼을 클릭하면 서버 코드가 갱신됩니다.

---

## 사전 준비

| 조건 | 명령 |
|------|------|
| Node.js + npm 설치 | `node -v` |
| Python 가상환경 활성 | `HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\activate` |
| PowerShell 7+ | `pwsh --version` |
| git 인증 완료 | `git remote -v` |

---

## 버전 관리

4곳의 버전을 항상 동일하게 유지해야 합니다:

| 파일 | 버전 필드 |
|------|-----------|
| `HiTessWorkBench/package.json` | `"version"` |
| `HiTessWorkBench/frontend/package.json` | `"version"` |
| `HiTessWorkBench/electron/package.json` | `"version"` |
| `HiTessWorkBenchBackEnd/app/routers/system.py` | `SERVER_VERSION` |

**일괄 갱신:**

```powershell
pwsh scripts/check-versions.ps1 -SetVersion 1.2.0
```

**검증만:**

```powershell
pwsh scripts/check-versions.ps1
```

---

## 전체 릴리즈 절차

### 1단계: 사전 검증 (선택)

```powershell
pwsh scripts/smoke-test.ps1 -SkipBuild
```

빌드 없이 Python 문법, 필수 파일, 버전 동기화만 빠르게 확인합니다.

### 2단계: 릴리즈 실행

```powershell
# 대화형 (각 단계 [Y/n] 확인)
pwsh scripts/release.ps1

# 완전 자동
pwsh scripts/release.ps1 -Yes

# 드라이 런 (명령 미리 보기)
pwsh scripts/release.ps1 -Dry

# 버전 변경 포함
pwsh scripts/release.ps1 -SetVersion 1.2.0 -Yes

# 이미 빌드된 경우 검증·복사만
pwsh scripts/release.ps1 -SkipBuild -Yes
```

`release.ps1` 내부 단계:

1. Git 상태 점검
2. 버전 동기화 검증 (`check-versions.ps1` 호출)
3. Python 문법 체크 (`compileall`)
4. Frontend build (`npm run build`)
5. Electron dist (`npm run dist`)
6. 산출물 검증 (exe 파일 존재 + 크기)
7. 배포 폴더 복사 (`LastestVersionProgram/`)
8. Git 태그 생성 및 push

### 3단계: 클라이언트 exe 서버 반영

`release.ps1`은 개발 PC의 `HiTessWorkBenchBackEnd/LastestVersionProgram/`에 exe를 복사합니다.
이 폴더는 Git에 포함되지 않으므로, 서버 PC의 아래 폴더로 새 exe를 수동 복사해야 합니다.

```text
<서버 repo>\HiTessWorkBenchBackEnd\LastestVersionProgram\
```

이전 exe는 남겨둬도 됩니다. `/api/download/client`는 수정 시간이 가장 최신인 exe를 제공합니다.

### 4단계: 서버 업데이트

서버 PC에서:

1. `server_manager.py` 실행 (또는 이미 실행 중)
2. **Update 버튼** 클릭
3. 로그에서 `Before: <hash>` → `After: <hash>` 확인
4. `Server: v1.x.x` 헬스 체크 메시지 확인

### 5단계: 클라이언트 배포 확인

클라이언트 앱에서 "새 버전 확인" → `LastestVersionProgram/`의 exe가 자동 제공됩니다.

---

## 배포 경로

| 산출물 | 경로 |
|--------|------|
| Electron exe | `HiTessWorkBench/dist_electron/HiTESS-WorkBench-v{version}.exe` |
| 개발 PC 로컬 배포 폴더 | `HiTessWorkBenchBackEnd/LastestVersionProgram/` |
| 서버 PC 배포 폴더 | `<서버 repo>/HiTessWorkBenchBackEnd/LastestVersionProgram/` |
| 환경 변수 오버라이드 | `LATEST_CLIENT_DIR` |

---

## 트러블슈팅

| 증상 | 확인 사항 |
|------|-----------|
| 버전 불일치 오류 | `check-versions.ps1 -SetVersion X.Y.Z` 실행 |
| exe 산출물 없음 | `SkipBuild` 없이 재실행, `dist_electron/` 확인 |
| git pull 실패 | 네트워크 / 인증 / 충돌 확인 |
| 헬스 체크 실패 | 5초 타임아웃 → 서버 기동 지연, uvicorn 로그 확인 |
