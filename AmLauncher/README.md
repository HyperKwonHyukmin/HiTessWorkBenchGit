# HiTESS MB 실행기 (AmLauncher)

Aveva Marine(AM) 연동용 **Model Builder Studio 호스트**. AM 클라이언트 `HiTessMB.exe` 가 CSV 를 서버에 보내고
`job_id` 를 받은 뒤, 이 실행기를 서버에서 내려받아(`viewer id = mb-launcher`) 실행하고 끝난다.
실행기는 WorkBench 를 쓰지 않는 사용자 PC 에서 WorkBench 와 같은 방식으로 Studio 를 띄운다.

계획: `docs/plans/2026-10-30-am-client-implementation-plan.md` 2-3 절, `docs/plans/2026-10-28-aveva-marine-model-builder-client.md` 3.2·3.3 절.

## 하는 일

1. 로그인 — `POST /api/login {employee_id}` → token. 401 이면 한 번 다시 로그인. **로그아웃은 부르지 않는다**(같은 사번의 다른 앱 세션을 끊을 수 있음).
2. 모델 생성 진행 — `GET /api/analysis/status/{job}` 1.5초 폴링(최대 25분). 완료 응답 **최상위** `output_dir` 를 서버 경로로 보관.
   빌드가 실패해도 `output_dir` 가 있으면 [Studio 에서 진단 보기] 로 단계별 JSON 을 열 수 있다.
3. 결과 받기 — `GET /api/analysis/modelflow/result-zip?output_dir=` → `data\results\<job_id>` 에 풂(Studio 의 initialFolder).
4. Studio 확인·설치 — `GET /api/viewers/manifest/model-studio` 버전 ≠ 설치본이면 UNC 복사 → 실패 시 HTTP, sha256 확인 후 `data\viewers\model-studio` 에 풂.
5. Studio 창 — `window.workbenchAPI` 를 WorkBench 와 같은 이름·모양으로 주입. 창이 뜨면 진행 창은 닫는다.
   모델(서버 `output_dir`)마다 창을 따로 연다(세션 키 `model-studio::<output_dir>`).

Studio 안에서:

| workbenchAPI | 실행기 처리 |
|---|---|
| `getInitialFolder()` | 받은 결과 폴더의 `.json` 전부 |
| `pickFolder()` | 폴더 고르기 대화상자 |
| `writeFile(folder, name, content)` | `_edit.json` 저장(폴더 밖 경로 차단) |
| `runModelBuilderAnalysis(opts)` + `onModelBuilderAnalysisProgress(cb)` | `POST /api/analysis/modelbuilder/solve`(work_dir = 서버 `output_dir`) → 폴링 → 결과 JSON 다운로드 |
| `finalizeEditedModel(folder, req)` | 수정 0건 → `discard-edit` / 있으면 `upload-edit` → `apply-edit` 시작까지 Studio 에 회신(Studio 창 닫힘) → 진행 창이 폴링 → `edit-status` → 편집 BDF 를 `data\results\<job>\edited\` 로 받고 [다른 위치에 저장…]·[폴더 열기] |

## 인자

```
HiTessMBLauncher.exe --server=<http://host:9091> --employee <사번> --job <job_id> [--hull-no <호선>] [--smoke]
```

- ⚠ **`--server` 는 `=` 로 붙여서 넘긴다.** Electron 은 `http://…` 모양의 인자 **뒤에** 다른 인자가 있으면 JS 를 실행하지 않고
  바로 종료한다(Windows 프로토콜 처리기 주입 방지, 종료 코드 -1·로그 없음 — 2026-10-30 실측). `--server 10.14.42.145:9091`(스킴 생략) 이나
  `--server http://…` 를 맨 뒤에 두는 것도 된다. **HiTessMB.exe 를 만들 때 이 형식으로 호출할 것.**
- 서버 주소의 기본값은 코드에 없다(배포본에 `10.133.122.70` 이 있으면 build.ps1 이 실패).
- 사번 `^[A-Z]\d{5,7}$`, 호선 영문·숫자·`-`·`_` 20자.
- 이미 실행 중이면 새 인자를 기존 실행기로 넘기고 바로 끝난다(`requestSingleInstanceLock` + `second-instance`).
  `second-instance` 의 commandLine 은 Chromium 이 순서를 바꾸므로 원래 argv 를 `additionalData` 로 넘긴다.
- 종료 코드: 0 = 정상(창을 모두 닫음) · 1 = 실패 · 2 = 인자 오류. HiTessMB.exe 는 기다리지 않아도 된다.

## 폴더

```
%LOCALAPPDATA%\HiTESS\MBLauncher\
  <버전>\HiTessMBLauncher.exe …   ← HiTessMB.exe 가 zip 을 푸는 곳
  data\                           ← Electron userData
    results\<job_id>\             ← 결과 폴더(편집 BDF 는 edited\)
    viewers\model-studio\         ← Studio 설치본
  logs\yyyyMMdd.log               ← UTF-8 한 줄씩
  logs\smoke-<job_id>.json        ← --smoke 결과
```

## 빌드

```
pwsh -File AmLauncher\build.ps1        (Windows PowerShell 5.1 도 됨)
```

- Electron 바이너리 = `HiTessWorkBench\electron\node_modules\electron\dist`(**v40.0.0 고정** — 다르면 실패).
  `electron.exe` → `HiTessMBLauncher.exe`, `locales` 는 ko·en-US 만, `resources\default_app.asar` 삭제, 앱은 `resources\app\`.
- zip 루트 `manifest.json` = `{ id: "mb-launcher", version, entry: "HiTessMBLauncher.exe", electron }`.
- 결과 `HiTessWorkBenchBackEnd\StudioProgram\mb-launcher-<버전>.zip` (+ `.sha256`). **70 로컬 시험용 — UNC 에는 올리지 않는다.**
- 버전은 `package.json` 한 곳만 올린다.
- ⚠ 회사 DRM 이 디스크에 쓴 zip 을 감싼다(`HHIDRMC` + 4096B). 서버(파이썬)는 평문으로 읽어 내려주므로 시험은
  `GET /api/viewers/download/mb-launcher` 로 받은 zip 으로 한다(디스크의 zip 을 PowerShell 로 바로 풀면 "중앙 디렉터리 끝 레코드 없음").

## smoke (자동 검증)

화면을 사람이 못 보는 PC 용. `--smoke` 를 붙이면 전체 흐름을 돌린 뒤 Studio `did-finish-load` 후 8초 기다렸다가
콘솔 오류(level error)·로드 실패·렌더러 종료·`getInitialFolder` 로 넘긴 JSON 수·창 제목·DOM(3D 캔버스 수, 단계 이름 글자)을
로그와 `logs\smoke-<job>.json` 에 남기고 **0(문제 없음) / 1** 로 끝난다. 실패 단계에서 멈추면 그 사유로 1.

## ⚠ Chromium 샌드박스를 끈다 (`--no-sandbox`)

이 회사 PC 에서는 같은 Electron 40 바이너리라도 이름이 `electron.exe` 면 되고 `HiTessMBLauncher.exe` 로 바꾸면
GPU·렌더러 하위 프로세스가 `launch failed: error_code=40` 으로 못 떠서 `GPU process isn't usable. Goodbye.` 로 끝난다(종료 코드 0, JS 로그 없음).
사내 보안 제품이 모르는 exe 이름의 샌드박스 프로세스를 막는 것으로 보여 `main.js` 에서 `no-sandbox` 를 켠다.
창에는 sha256 을 확인한 로컬 Studio(file://)와 실행기 화면만 띄우고 외부 이동·새 창을 막는다(contextIsolation 유지).
대안(보안팀 화이트리스트 등록 또는 하위 프로세스 실패 시에만 `--no-sandbox` 로 재실행)은 아직 하지 않았다.

## WorkBench 에서 옮긴 부분 (사본 — 공용 모듈로 합칠 대상)

계획(2-3)은 공용 모듈로 떼어 두 앱이 같이 쓰는 것이지만, 이번에는 WorkBench 코드를 고치지 않기로 해 **사본**으로 두었다(의도된 부채).
Studio 호스트 기능을 바꾸면 아래 두 곳을 같이 고칠 것.

| 실행기 | WorkBench 원본 |
|---|---|
| `lib/viewer-sessions.js` | `HiTessWorkBench/electron/viewer-sessions.js` (그대로) |
| `lib/install.js` `downloadToFile`·`sha256OfFile`·`extractZip`·`readJsonFolderRecursive` | `electron/index.js` 같은 이름 함수(`extractZipWithTar`) |
| `lib/install.js` `installViewer` | `electron/index.js` `viewer:install` + `HiTessModelBuilder.jsx` 의 manifest 버전 비교 |
| `lib/install.js` `fetchResultDir` | `electron/index.js` `viewer:fetchResultDir` |
| `lib/studio-host.js` `openStudio` | `electron/index.js` `viewer:open` |
| `lib/studio-host.js` `viewer:pickFolder`·`viewer:getInitialFolder`·`viewer:writeFile` | `electron/index.js` 같은 이름 핸들러 |
| `lib/studio-host.js` `runModelBuilderSolve` | `electron/index.js` `viewer:runModelBuilderSolve` |
| `lib/studio-host.js` `viewer:finalizeEditedModel` + `lib/finalize.js` | `electron/index.js` `viewer:finalizeEditedModel` → `HiTessModelBuilder.jsx` `modelflow:finalize-edit-request` 리스너·`startApplyEditJob`·`pollEditJobInBackground`·`refreshEditStatus` |
| `lib/server-client.js` | `electron/index.js` `getWorkbenchRuntimeConfig`·`refreshWorkbenchSession`·`fetchWithSessionRefresh`·`readBackendError` |
| `preload/studio-preload.js` | `electron/preload.js` 의 `workbenchAPI` 중 model-studio 가 쓰는 6개 |

WorkBench 와 다른 점: 결과 폴더는 서버와 같은 PC 여도 **항상** result-zip 으로 받고(편집 확정은 항상 upload-edit),
다른 폴더를 '폴더 열기' 로 연 모델은 저장을 거부한다(어느 서버 모델의 편집인지 알 수 없음).
