# HiTESS WorkBench

사내 구조 해석 플랫폼. 레거시 구조 해석 실행 파일(`.exe`)들을 현대적인 웹 UI로 통합하고, AI 어시스턴트를 결합한 Electron 데스크톱 애플리케이션입니다.

## 주요 기능

| 분류 | 기능 | 상태 |
|------|------|------|
| 파일 기반 해석 | Truss Model Builder (CSV → 3D 모델 + 해석) | 운영 중 |
| 파일 기반 해석 | Truss Structural Assessment (BDF → 구조 안정성 평가) | 운영 중 |
| 파일 기반 해석 | Beam Result Viewer (JSON/CSV 결과 시각화) | 운영 중 |
| 대화형 해석 | Simple Beam Assessment (단면 입력 → 실시간 응력 평가) | 운영 중 |
| AI | AI Lab Assistant (RAG 기반 사내 문서 질의응답) | 운영 중 |
| AI | Hi-Lab Insight | 운영 중 |

## 기술 스택

- **프론트엔드**: React 18, Vite, Tailwind CSS, Three.js (3D 뷰어)
- **백엔드**: Python, FastAPI, SQLAlchemy, MySQL
- **데스크톱**: Electron
- **AI**: Ollama (`qwen2.5:7b`), BGE-M3 임베딩, FAISS + BM25 하이브리드 검색

## 프로젝트 구조

```
WorkBench/
├── HiTessWorkBench/              # Electron + React 프론트엔드
│   ├── electron/                 # Electron 메인 프로세스
│   └── frontend/                 # React SPA (Vite)
│       └── src/
│           ├── api/              # 백엔드 API 호출 함수
│           ├── components/       # 공용 UI 컴포넌트
│           ├── contexts/         # 전역 상태 (DashboardContext)
│           ├── hooks/            # 커스텀 훅
│           └── pages/            # 페이지 컴포넌트
└── HiTessWorkBenchBackEnd/       # FastAPI 백엔드
    ├── app/
    │   ├── routers/              # API 라우터
    │   ├── services/             # 해석 작업 서비스 (job_manager, *_service)
    │   ├── AI/                   # AI 파이프라인 (ingest, chain, config)
    │   ├── models.py             # SQLAlchemy DB 모델
    │   └── main.py               # FastAPI 앱 진입점
    ├── InHouseProgram/           # 사내 해석 실행 파일 (.exe)
    └── userConnection/           # 사용자 작업 파일 저장소
```

## 빠른 시작

### 백엔드 서버

```bash
cd HiTessWorkBenchBackEnd
WorkBenchEnv/Scripts/activate          # 가상환경 활성화 (Windows)
pip install -r requirements.txt        # 최초 설치 시
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 프론트엔드 개발 (Electron 포함)

```bash
cd HiTessWorkBench
npm install                            # 최초 설치 시
npm run dev                            # React 개발 서버 + Electron 동시 실행
```

### 배포용 빌드

```bash
cd HiTessWorkBench/frontend
npm run build                          # React 빌드

cd HiTessWorkBench
npm run dist                           # 포터블 .exe 생성
```

## 서버 설정

프론트엔드가 바라보는 백엔드 URL은 `HiTessWorkBench/frontend/src/config.js`의 `API_BASE_URL`에서 변경합니다.

```js
// 팀 서버 IP로 변경
export const API_BASE_URL = 'http://10.133.122.70:9091';
```

데이터베이스 접속 정보는 `HiTessWorkBenchBackEnd/app/database.py`에서 설정합니다. 서버 최초 실행 시 SQLAlchemy가 테이블을 자동으로 생성합니다.

## 인증

사번(employee_id)만으로 로그인합니다. 신규 가입 후 관리자 승인이 완료되어야 서비스를 이용할 수 있습니다.

## AI 기능 초기 설정

AI Lab Assistant 사용 전, 관리자가 문서를 색인화해야 합니다.

1. Ollama가 실행 중이고 `qwen2.5:7b` 및 `bge-m3` 모델이 설치되어 있어야 합니다.
2. 관리자 계정으로 로그인 후 `POST /api/ai/ingest`를 호출하여 사내 문서를 색인화합니다.
3. 색인 완료 후 AI Lab Assistant에서 질의응답이 가능합니다.
