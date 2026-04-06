# HiTESS WorkBench 서버 배포 가이드

> 작성일: 2026-04-06  
> 개인 PC(10.133.122.70)에서 백엔드 서버를 별도 서버 컴퓨터로 이전하는 절차서.  
> **GitHub를 통한 Git 동기화**로 이후 코드 업데이트를 간편하게 관리.

---

## 전체 흐름

```
[개인 PC]                         [서버 PC]
  코드 수정                         git clone (최초 1회)
  git commit + push  ──GitHub──>   update.bat 실행 (수동)
                                     → git pull
                                     → pip install
                                     → 서비스 재시작
```

**Git 동기화 대상**: 소스 코드, requirements.txt, update.bat, .env.example  
**Git 제외 (최초 수동 세팅 필요)**: `.env`, `InHouseProgram/`, `WorkBenchEnv/`, `userConnection/`, `vectorstore/`

---

## Part A — 개인 PC 작업 (배포 전 1회)

이미 완료된 코드 수정 사항 (커밋 반영):
- `app/AI/config.py`: `REPORTS_DIR`, `OLLAMA_BASE_URL` 환경변수화
- `app/AI/ingest.py`: `TESSERACT_CMD` 환경변수화
- `requirements.txt`: AI/모니터링 패키지 통합
- `update.bat`: 서버 업데이트 스크립트
- `.env.example`: 환경변수 템플릿

---

## Part B — 서버 컴퓨터 최초 설치

### B-1. 기본 소프트웨어 설치

| 소프트웨어 | 필수 여부 | 비고 |
|-----------|:---------:|------|
| Python 3.10+ | 필수 | 시스템 PATH 등록 |
| MySQL 8.0 | 필수 | — |
| Git for Windows | 필수 | GitHub clone용 |
| NSSM | 필수 | Windows 서비스 등록 |
| Ollama + 모델 | AI 사용 시 | qwen2.5:7b, bge-m3 |
| Tesseract OCR | 이미지 PDF 시 | 기본 경로 권장 |

Ollama 모델 pull:
```bash
ollama pull qwen2.5:7b
ollama pull bge-m3
```

### B-2. DB 생성

```sql
CREATE DATABASE hitessworkbench CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'admin'@'localhost' IDENTIFIED BY '원하는비밀번호';
GRANT ALL PRIVILEGES ON hitessworkbench.* TO 'admin'@'localhost';
FLUSH PRIVILEGES;
```

### B-3. 프로젝트 클론 + 환경 세팅

```bat
cd C:\원하는경로
git clone https://github.com/HyperKwonHyukmin/HiTessWorkBenchGit.git
cd HiTessWorkBenchGit\HiTessWorkBenchBackEnd

:: 가상환경 생성
python -m venv WorkBenchEnv
call WorkBenchEnv\Scripts\activate
pip install -r requirements.txt

:: .env 작성
copy .env.example .env
:: → .env를 메모장으로 열어 DB 비밀번호 등 편집
```

**.env 편집 내용** (최소 필수):
```env
DB_USER=admin
DB_PASSWORD=B-2에서_설정한_비밀번호
DB_HOST=localhost
DB_PORT=3306
DB_NAME=hitessworkbench
```

AI 사용 시 추가:
```env
REPORTS_DIR=C:\학습문서경로
OLLAMA_BASE_URL=http://localhost:11434
```

### B-4. InHouseProgram 배치 (USB/네트워크로 수동 복사)

개인 PC의 `HiTessWorkBenchBackEnd\InHouseProgram\` 폴더 전체를 서버의 동일 위치에 복사:

```
HiTessWorkBenchBackEnd\InHouseProgram\
  ├── TrussModelBuilder\    ← exe + Reference\ 폴더 포함
  ├── TrussAssessment\      ← exe
  ├── SimpleBeamAssessment\ ← exe
  └── PostDavitCalculation\ ← exe
```

> ※ `.gitignore`에 의해 Git에 포함되지 않으므로 매번 수동 복사 필요 없음.  
> **exe 파일이 변경된 경우에만** 재복사.

### B-5. Windows 서비스 등록

NSSM으로 서버 PC 시작 시 자동 실행:

```bat
:: 아래 "C:\원하는경로"를 실제 경로로 교체
nssm install HiTessBackend "C:\원하는경로\HiTessWorkBenchGit\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe" "-m" "uvicorn" "app.main:app" "--host" "0.0.0.0" "--port" "8000"
nssm set HiTessBackend AppDirectory "C:\원하는경로\HiTessWorkBenchGit\HiTessWorkBenchBackEnd"
nssm set HiTessBackend DependOnService MySQL80
nssm start HiTessBackend
```

> `DependOnService MySQL80` — MySQL이 완전히 시작된 후 앱이 뜨도록 의존성 설정.

### B-6. 방화벽 포트 개방

- **8000** (FastAPI 백엔드) — 필수
- **11434** (Ollama) — AI 사용 시

### B-7. AI 벡터스토어 구축 (AI 사용 시)

1. `.env`의 `REPORTS_DIR` 경로에 학습 문서(PDF/DOCX/TXT) 배치
2. 관리자 계정 로그인 → 앱 내 "인덱싱" 실행, 또는:
```bash
curl -X POST http://서버IP:9091/api/ai/ingest
```

또는 기존 `app/AI/vectorstore/` 폴더를 USB로 복사해도 됨.

---

## Part C — 코드 업데이트 (일상)

### 개인 PC:
```bash
git add .
git commit -m "변경 내용"
git push
```

### 서버:
```
update.bat 더블클릭
```

`update.bat`이 자동으로:
1. `git pull origin main` — 최신 코드 반영
2. `pip install -r requirements.txt` — 패키지 동기화
3. `nssm restart HiTessBackend` — 서비스 재시작

---

## 검증 체크리스트

| # | 항목 | 방법 |
|---|------|------|
| 1 | 헬스 체크 | 브라우저 `http://서버IP:9091/` → `{"status":"ok"}` |
| 2 | DB 연결 | System Settings 페이지 DB 상태 초록 확인 |
| 3 | 해석 엔진 | Truss Analysis 파일 업로드 → 결과 확인 |
| 4 | AI | AI Lab Assistant 채팅 답변 생성 확인 |
| 5 | 모니터링 | System Settings CPU/메모리 정상 표시 |

---

## 하드코딩 경로 요약 (서버별 .env에서 관리)

| 환경변수 | 기본값 | 용도 |
|---------|-------|------|
| `DB_PASSWORD` | (없음, 필수) | MySQL 비밀번호 |
| `REPORTS_DIR` | `app/AI/reports_data` | AI 학습 문서 폴더 |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama 서버 주소 |
| `TESSERACT_CMD` | `C:\Program Files\Tesseract-OCR\tesseract.exe` | Tesseract 경로 |

---

## 운영 안정화 (선택)

### userConnection 정리

해석 작업 임시 파일이 `userConnection/`에 누적됨. Windows 작업 스케줄러로 오래된 폴더 주기적 삭제 권장.

### DB 백업

```bat
mysqldump -u admin -p hitessworkbench > backup_%date:~0,4%%date:~5,2%%date:~8,2%.sql
```
