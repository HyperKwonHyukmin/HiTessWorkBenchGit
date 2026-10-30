# AM 연동 구현 계획 — 보내는 클라이언트 + 내려받는 실행기 (2026-10-30)

- 앞 문서: `2026-10-28-aveva-marine-model-builder-client.md`(배경·서버 API·위험). 이 문서가 **구현 구조를 대체**한다.
- 바뀐 점(2026-10-30 사용자 결정):
  - **WorkBench 와 완전히 별개**로 간다. 사용자 PC 에 WorkBench 가 없어도 된다.
  - AM 에 넣는 **클라이언트는 정보를 보내고 끝난다.** 그 뒤 Studio 설치·실행은 WorkBench 와 같은 방식으로 한다.
  - AM 은 사용자 본인 PC 에서 돈다(원격·VDI 고려 안 함).
- 그래서 앞 문서 D1(클라이언트 = Electron)을 바꾼다. 프로그램을 둘로 나눈다.

| 프로그램 | 어디 | 무엇으로 | 하는 일 |
|---|---|---|---|
| **HiTessMB.exe** (보내는 클라이언트) | AM 이 부름, AM 설치 폴더 등 | C# .NET Framework 4.8, 단일 exe(수십 KB) | 인자 확인 → 로그인 → CSV 업로드 → (2단계) 실행기 받아 실행 → 종료 |
| **HiTESS MB 실행기** (Studio 호스트) | 사용자 PC `%LOCALAPPDATA%\HiTESS\MBLauncher\` | Electron (WorkBench Studio 호스트 코드 재사용) | 빌드 진행 표시 → 결과 받기 → Studio zip 설치 → Studio 창 |

클라이언트를 .NET Framework 4.8 로 하는 이유: Windows 10/11 에 기본으로 있어 설치가 필요 없고 exe 가 아주 작다. AM 도 .NET 기반이라 같은 환경이다.
이 PC 에 4.8 참조 어셈블리가 설치돼 있어 NuGet(사내망에서 막힘) 없이 빌드된다(2026-10-30 확인).
AM 쪽 호출 규약은 앞 문서 3.4 와 **같다** — AM 개발팀에 보낸 요청 문서를 바꿀 필요가 없다.

```
HiTessMB.exe <사번> --hull-no <호선> --stru <CSV> [--pipe <CSV>] [--equip <CSV>]
```

---

## 1단계 — 클라이언트가 보내고, 서버가 받았는지 확인한다

목표: AM 이 만든 CSV 가 **손상 없이, 엔진이 읽을 수 있는 모양으로** 서버에 도착하는지 확인. 빌드는 아직 돌리지 않는다.

### 1-1. 서버: 접수 API

`POST /api/am/submissions` (multipart, `Authorization: Bearer`)
- 입력: `employee_id` · `hull_no` · `stru_file`/`pipe_file`/`equip_file`(최소 stru 또는 pipe 하나) · `client`(JSON: 클라이언트 버전, PC 이름, Windows 계정, 원본 파일 경로).
- 저장: `userConnection/<ts>_<사번>_AmToModelBuilder/` 에 원본 그대로 + `submission.json`(받은 시각·사번·호선·파일별 크기·sha256·검사 결과·client 정보).
- 검사(응답에 그대로 싣는다 — 1단계의 핵심):
  1. **크기·sha256** — 클라이언트가 보낸 값과 대조(전송 손상 확인).
  2. **DRM 암호문** — 파일 앞이 `HHIDRMC` 면 거절 사유로 알림. AM 이 쓴 CSV 를 DRM 이 감싸면 평범한 프로세스(클라이언트)는 암호문을 읽는다 — 그 경우를 여기서 잡는다.
  3. **종류·헤더** — WorkBench MB 페이지와 같은 기준(구조 `ori`, 배관 `outdia`, 장비 `cog`)으로 `--stru` 등 지정이 맞는지, 필수 열이 있는지.
  4. **인코딩·행 수** — UTF-8/CP949 판별, 데이터 행 수.
  5. **호선** — 엔진 정규화 규칙(`app/services/hull_no.py`)으로 검사.
- 응답: `{submission_id, files:[{kind, name, size, sha256, encoding, rows, header_ok, issues[]}], ok}`.
- 기록: activity 로그 `AM_SUBMIT`. My Projects·통계에는 아직 넣지 않는다(빌드 기록이 아니므로).
- `main.py` 등록 + `GUARDED_ROUTES` 에 `/api/am/` 등록(관리자가 HiTESS Model Builder 를 점검 중으로 내리면 함께 막힘).
- 테스트: 정상 3종 · stru 만 · 둘 다 없음(400) · sha256 불일치 · `HHIDRMC` · 종류 뒤바뀜 · 호선 형식 오류.

### 1-2. 클라이언트: HiTessMB.exe

- 소스: `C:\Coding\WorkBenchSubModule\HiTessMBClient\` (새 git 저장소).
- 순서: 인자 해석 → 파일 존재·크기 확인 → 사번 대문자화·형식 `^[A-Z]\d{5,7}$` → `POST /api/login` → 접수 API 업로드 → 결과 표시.
- 서버 주소: exe 옆 `HiTessMB.config.json`(기본 145). 배포본에 70 주소가 없는지 빌드 스크립트가 검사한다.
- 결과 표시: 작은 창 하나(성공 = 파일별 행 수 / 실패 = 사유). 로그는 `%LOCALAPPDATA%\HiTESS\MBClient\logs\`.
- 종료 코드: 0 성공 · 2 인자 오류 · 3 미가입(404) · 4 미승인(403) · 5 접수 검사 실패 · 6 서버 접속 실패 · 7 그 밖의 서버 거절(점검 중 등).
  AM 매크로는 기다리지 않아도 된다.
- 미가입·미승인은 1단계에서는 안내 문구만(가입 페이지 열기는 2단계).

### 1-3. 1단계 완료 기준

1. 70 백엔드 + 이 PC 명령줄에서 실모델 CSV(3529_m04 등)로 접수 → 서버 폴더 파일이 원본과 sha256 동일, 검사 결과 정상.
2. 일부러 망가뜨린 입력(종류 뒤바뀜, 빈 파일, 호선 오류)이 사유와 함께 거절됨.
3. **AM 개발팀이 AM 버튼으로 145 에 접수 성공** — 실제 AM CSV 의 인코딩·헤더·DRM 여부를 여기서 처음 확인한다(앞 문서 R4).

---

## 2단계 — 빌드하고, 실행기를 내려받아 Studio 를 연다

### 2-1. 서버

- 접수 API 에 빌드 시작을 붙인다: 검사가 통과하면 저장한 CSV 로 기존 `task_execute_modelflow` 를 띄우고 `job_id` 를 응답에 싣는다
  (`source=AvevaMarine`, 이때부터 My Projects·통계에 MB 실행으로 기록).
- 실행기 배포: Studio 와 같은 manifest 방식 — viewer id `mb-launcher` 로 `StudioProgram\` 에 zip 을 두고
  `GET /api/viewers/manifest/mb-launcher`·`download/mb-launcher` 로 준다(새 라우트 불필요, DRM 대응도 이미 됨).
- 가입 페이지: `GET /signup?employee_id=` HTML 한 장(기존 `POST /api/register` 사용, 관리자 승인 유지).

### 2-2. 클라이언트 (1단계 exe 에 추가)

접수 성공 후:
1. `manifest/mb-launcher` 확인 → 설치본 버전이 다르면 내려받아 sha256 확인 → `%LOCALAPPDATA%\HiTESS\MBLauncher\<버전>\` 에 풂.
   zip 은 **디스크에 쓰지 않고 메모리에서 바로 푼다** — 사용자 C: 에 쓴 zip 을 DRM 이 감쌀 수 있다.
2. `MBLauncher.exe --server <주소> --employee <사번> --job <job_id>` 실행 → 클라이언트 종료.
3. 404 면 브라우저로 가입 페이지를 열고 종료.

### 2-3. 실행기 (Electron)

- 소스 위치: WorkBench 저장소 `AmLauncher/`. WorkBench `electron/` 의 Studio 호스트 코드
  (`viewer:install`·`viewer:open`·`getInitialFolder`·`pickFolder`·`writeFile`·`runModelBuilderSolve`, `viewer-sessions.js`)를
  **공용 모듈로 떼어 두 앱이 같이 쓴다** — 복사하면 Studio 기능이 늘 때마다 두 곳을 고쳐야 한다(앞 문서 R6).
- 동작: 로그인(사번) → 빌드 진행 창(1.5초 폴링) → `modelflow/result-zip` 을 `%LOCALAPPDATA%\HiTESS\MBLauncher\results\<job_id>` 에 풂
  → `model-studio` manifest 확인·설치 → Studio 창(`window.workbenchAPI` 주입).
- 새로 짤 것: `finalizeEditedModel`(편집 확정) — 지금은 WorkBench `HiTessModelBuilder.jsx` 에 있다. discard-edit / upload-edit → apply-edit → edit-status 를 실행기 main 으로 옮긴다.
- 단일 인스턴스: 실행 중에 또 불리면 새 작업만 받아 Studio 창을 하나 더 연다(모델마다 창, 세션 키 `model-studio::<output_dir>`).
- Electron 버전을 처음부터 고정하고(WorkBench 는 26/40 이 섞여 있음), 그 버전에서 Studio 를 확인한다.

### 2-4. 2단계 완료 기준

1. 이 PC 명령줄 한 줄 → 실행기 자동 설치 → 빌드 → Studio 에 모델이 열림 → 편집·해석·편집 BDF 저장. **화면은 사용자가 확인**(이 PC 는 헤드리스 브라우저 불가).
2. 실행기·Studio 새 버전을 올리면 다음 호출 때 자동으로 바뀜.
3. AM 버튼 → Studio 까지 한 번에(AM 개발팀과 함께).

---

## 위험·확인할 것 (이 구조에서 새로 생긴 것)

- **내려받은 exe 실행이 사내 보안에 막힐 수 있다.** WorkBench 포터블 exe 는 사용자 폴더에서 돌고 있어 가능성은 높지만,
  `%LOCALAPPDATA%` 아래 새 exe 실행이 백신·실행 통제에 걸리는지 **2단계 첫 작업으로 확인**한다. 막히면 실행기를 UNC 에서 직접 실행하는 방법으로 바꾼다.
- **첫 실행 다운로드 ~150MB**(Electron). 사내망이라 수십 초 수준으로 보지만 진행 창을 띄워야 한다(클라이언트에 진행률 표시).
- **사번만으로 로그인**(앞 문서 R1) — client 정보(PC 이름·Windows 계정)를 접수 기록에 남겨 추적한다.
- 실행기에 사번을 명령줄로 넘긴다(토큰은 넘기지 않음). 실행기가 다시 로그인한다.

## 진행 상태 (2026-10-30)

- **1 완료** — `app/routers/am_intake.py` · `app/services/am_intake.py` · `GUARDED_ROUTES` `/api/am/` · 등록부 `AmToModelBuilder`(MB 재실행 어댑터 공유)
  · 프론트 `DashboardContext` MB `programNames` 에 `AmToModelBuilder`(화면 앱별 집계는 MB 에 합산, 관리자 사용량 보고서는 따로). DRM 검사는 넣지 않음(CSV 는 DRM 대상 아님, 사용자 확인).
  활동 로그 `AM_SUBMIT`. 다른 폴더의 같은 이름 CSV 는 `<kind>_<이름>` 으로 저장(덮어쓰기 방지).
- **2 완료(미커밋)** — `C:\Coding\WorkBenchSubModule\HiTessMBClient\`(git init 만, 원격 없음). 70 실측 5경우(README 표). 결과 창은 눈으로 확인 안 함.
- **이름 확정(사용자 지시)**: 폴더·program_name·source 모두 `AmToModelBuilder`(옛 시험 이름 `AvevaMarineIntake` 는 등록부 별칭으로만 남김).
  이중 집계는 '검사 통과 → 빌드 작업이 기록 1건을 남김 / 실패 → Failed 1건' 으로 해결(빌드 함수에 `program_name` 인자 추가).
- **2단계 완료(미커밋→이번 커밋)** — 서버 빌드 시작 · 실행기 `AmLauncher/`(사본) · 클라이언트 실행기 받기·실행(`--no-launch` 로 생략 가능, 실패 = 종료 코드 8) ·
  가입 페이지 `GET /signup` + 클라이언트가 로그인 404 때 브라우저로 염. 70 전체 흐름 실측: 클라이언트 실행 → 약 20초 뒤 Studio 에 3454 모델(사용자가 화면 확인).
- 실행통제 실측: `%LOCALAPPDATA%` 에서 내려받은 Electron exe 실행 가능. 단 이름을 바꾸면 Chromium 샌드박스 하위 프로세스가 막혀 `no-sandbox` 사용(보안팀 exe 등록 문의 후보).
- 공용 모듈화는 하지 않았다 — WorkBench `index.js` 를 쪼개면 exe 재빌드·화면 확인 위험이 WorkBench 에 생겨서. 사본마다 원본 위치 주석.
- 남은 것: Studio 안 '해석 실행'·'모델 저장' 클릭 시험, 145 반영(아래), AM 개발팀에 `dist\` 전달, 보고서(2차).
- 145 반영: `git pull` + 백엔드 재시작(새 라우터) → 145 `StudioProgram\` 에 `mb-launcher-<ver>.zip` 복사 → 145 `studio_release.json` 에 `mb-launcher` 를 넣지 않으면 최고 버전이 나간다.
- 알려진 부작용: 클라이언트의 `/api/login` 이 그 사용자의 WorkBench 접속 이력 행을 'relogin' 으로 닫는다(토큰은 따로라 WorkBench 는 안 끊김).

## 진행 순서

| # | 작업 | 확인 |
|---|---|---|
| 1 | 서버 접수 API + 테스트 | pytest, 70 재시작 후 200 |
| 2 | 클라이언트 exe (명령줄, 결과 창) | 실모델 CSV 접수, sha256 일치 |
| 3 | AM 개발팀에 exe 전달 → AM 버튼 접수 | 145 에서 실제 AM CSV 검사 결과 |
| 4 | 실행 통제 확인: 내려받은 exe 가 `%LOCALAPPDATA%` 에서 뜨는지 | 빈 Electron 앱으로 시험 |
| 5 | 서버 빌드 시작 + `mb-launcher` 배포 경로 + 가입 페이지 | pytest |
| 6 | WorkBench Studio 호스트 코드를 공용 모듈로 분리 | WorkBench 동작 그대로(빌드·기존 테스트) |
| 7 | 실행기: 진행 창·결과 받기·Studio 설치·창 | Studio 에 모델 열림 |
| 8 | 실행기: 편집 확정 이식 | 편집 BDF 저장 |
| 9 | 클라이언트에 실행기 받기·실행 추가 | 명령줄 한 줄로 Studio 까지 |
| 10 | 145 배포 + AM 버튼 연결 | 시범 사용자 |
