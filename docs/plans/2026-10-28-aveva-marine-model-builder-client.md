# Aveva Marine(AM) 연동 — Model Builder Studio 독립 클라이언트 계획서

- 작성: 2026-10-28 (초안)
- 대상: HiTESS Model Builder(엔진 `Cmb.Cli.exe` + `model-studio` Studio)
- 상태: **계획서(제안)** — 구현 범위 밖. 6장의 결정은 D4 외에는 추천안이며, 검토 후 확정한다.
- ⚠ **구현 구조는 `2026-10-30-am-client-implementation-plan.md` 로 바뀌었다** — WorkBench 와 완전 별개, 보내는 클라이언트(.NET 4.8) + 내려받는 실행기(Electron) 2개, 1단계 = 접수 확인 / 2단계 = 빌드·Studio. 이 문서의 3.1(Electron 클라이언트 하나)은 대체됨. 서버 API·위험 목록은 여전히 유효.

---

## 1. 목적

설계자가 **AM 안에서 버튼 하나**로 구조해석 모델 확인까지 가게 한다.
지금은 AM 에서 CSV 를 뽑은 뒤 WorkBench 를 따로 켜고, 로그인하고, Model Builder 메뉴에 CSV 3개를 올리고, Studio 를 열어야 한다.
이 중 'WorkBench 를 켜고 파일을 옮기는' 단계를 없애는 것이 이 작업의 전부다. 해석 엔진·Studio·서버는 지금 것을 그대로 쓴다.

**바꾸지 않는 것**
- 해석 엔진(`Cmb.Cli.exe`)과 Nastran 은 서버(145)에서만 돈다. 클라이언트에는 엔진이 없다.
- Studio(`model-studio`) 코드는 고치지 않는 것이 목표다(3.2 참고).
- WorkBench 의 Model Builder 메뉴는 그대로 남는다. 같은 서버·같은 기록(My Projects)을 쓴다.

---

## 2. 사용자 절차 (목표 모습)

| # | 사용자가 하는 일 | 뒤에서 일어나는 일 |
|---|---|---|
| 1 | AM 에서 [구조해석 모델] 버튼 | AM 매크로가 구조·배관·장비 CSV 를 임시 폴더에 추출 |
| 2 | (기다림) | 매크로가 `HiTessMB.exe <사번> <csv1> <csv2> …` 호출 |
| 3 | (기다림 — 진행 창 표시) | 클라이언트가 서버에 로그인 → Studio 최신 버전 확인·설치 → CSV 업로드 → Model Builder 빌드 → 진행률 폴링 |
| 4 | Studio 창에서 모델 확인 | 결과 폴더를 zip 으로 받아 사용자 PC 에 풀고 Studio 를 띄움 |
| 5 | Edit 탭에서 모델 수정 | 편집 intent 가 `_edit.json` 으로 저장 |
| 6 | Analysis 탭에서 경계조건·하중·Load Case 입력 → 해석 | 서버 `modelbuilder/solve` 가 편집 적용 + Nastran 실행, 결과 JSON 을 받아 Studio 에 표시 |
| 7 | 결과 확인 → 보고서 검토 → [보고서 저장] | 서버가 보고서(PDF/xlsx)를 만들어 바이트로 돌려주고, 클라이언트가 저장 대화상자로 **사용자 PC 에 저장** |
| 8 | (선택) Save 탭에서 편집 모델 확정 | 서버 `apply-edit` 로 편집 BDF 생성 → BDF 받기 |

> 1~6, 8 은 지금 기능을 옮기기만 하면 된다. **7(보고서)은 Model Builder 경로에 아직 없다**(4장).
> **1차 출시 범위 = 1~6, 8.** 7(보고서)은 2차(D4 확정).

---

## 3. 구조

```
[AM 매크로]──CSV 추출──▶ HiTessMB.exe 사번 csv…
                              │  (사용자 PC)
                              ├─ 로그인 / 빌드 요청 / 폴링 ─────────▶ [WorkBench 백엔드 145:9091]
                              ├─ Studio zip 확인·설치  ◀── /api/viewers/*   (Cmb.Cli · Nastran · 보고서)
                              ├─ 결과 폴더 zip 받기    ◀── modelflow/result-zip
                              └─ Studio 창 (window.workbenchAPI 주입)
                                   ├ 해석 실행  ──▶ modelbuilder/solve
                                   ├ 편집 확정  ──▶ upload-edit → apply-edit
                                   └ 보고서 저장 ──▶ (신규) modelbuilder/report → 저장 대화상자
```

### 3.1 클라이언트는 무엇으로 만드나 — **추천: Electron(WorkBench 코드 재사용)**

| 안 | 장점 | 단점 |
|---|---|---|
| **A. Electron 경량 앱 (추천)** | Studio 설치·창·`workbenchAPI`·해석 IPC 가 이미 `electron/index.js`·`preload.js` 에 있다. 옮겨 오면 된다. Studio 가 지금과 같은 Chromium 에서 돈다 | exe 크기 ~150MB. Electron 26/40 버전 문제(아래 위험 참고) |
| B. C#(.NET) + WebView2 | AM 애드인과 같은 언어, 작음 | `workbenchAPI` 6개·편집 확정 체인·설치 로직을 C# 으로 다시 짜야 한다. 사내 PC 의 WebView2 런타임 유무 확인 필요 |
| C. WorkBench exe 에 인자 모드 추가 | 새 프로그램 없음 | WorkBench 전체(로그인 화면·대시보드)가 같이 뜬다. "따로 뺀다" 는 목표와 어긋남 |

A 를 추천하는 이유: 새로 짜야 할 것이 '편집 확정 체인 이식' 과 '보고서' 정도로 줄어든다. B 는 같은 기능을 두 언어로 유지하게 된다.

**전제 (2026-10-28 사용자 확인)** — 검토 중 'WorkBench exe 명령줄 모드(안 C 변형)' 가 중복이 없어 더 낫지 않나를 따졌으나, 아래 전제로 **별도 클라이언트(안 A)를 유지**한다.
- 대상 사용자는 AM 사용자이고 **WorkBench 를 쓰지 않는다고 본다.** 목적이 'WorkBench 를 받고 열고 CSV 를 넣는 과정' 을 없애는 것이다.
- Studio 는 AM 안이 아니라 **사용자 PC 에 설치**해 띄운다(AM 은 호출만).
- **AM 으로 돌려보내는 정보는 없다**(단방향). 사용자는 결과를 확인하고 필요하면 보고서를 PC 에 받는다.
- 그래서 R6(호스트 코드 중복)은 피할 수 없고, 공용 모듈로 묶는 것이 1단계 과제다.

### 3.2 Studio 가 호스트에 기대는 것 (조사 결과)

Studio 는 서버를 직접 부르지 않는다. `window.workbenchAPI` 하나만 본다(`ModelBuilderStudio/apps/model-studio/src/host/host.js`).
클라이언트가 **같은 이름·같은 모양**으로 이것을 주면 Studio 를 고칠 필요가 없다.

| API | 하는 일 | 지금 구현 위치 | 클라이언트에서 |
|---|---|---|---|
| `getInitialFolder()` | 시작 폴더의 `.json` 전부를 `{folderPath, files[{name,content}]}` 로 | `electron/index.js` `viewer:getInitialFolder` | 그대로 이식 |
| `pickFolder()` | 다른 결과 폴더 열기 | `viewer:pickFolder` | 그대로 이식 |
| `writeFile(folder, name, content)` | `_edit.json` 저장 | `viewer:writeFile` | 그대로 이식 |
| `runModelBuilderAnalysis(opts)` | 해석 요청 → 폴링 → 결과 JSON | `viewer:runModelBuilderSolve` | 그대로 이식 |
| `onModelBuilderAnalysisProgress(cb)` | 해석 진행률 | 같은 곳 | 그대로 이식 |
| `finalizeEditedModel(folder, req)` | 편집 확정 | **WorkBench 메인 창 페이지(`HiTessModelBuilder.jsx`)에 위임** | **새로 옮겨 짜야 함** (discard-edit / upload-edit → apply-edit → edit-status) |
| (신규) 보고서 생성·저장 | — | 없음 | 4장 |

### 3.3 서버 API 사용 순서

1. `POST /api/login {employee_id}` → `token`(8시간). 이후 모든 요청에 `Authorization: Bearer`.
2. `GET /api/viewers/manifest/model-studio` → 설치본 버전과 다르면 UNC 복사 또는 `download` → SHA256 확인 → `%APPDATA%\<클라이언트>\viewers\model-studio\` 에 압축 해제.
3. `POST /api/analysis/modelflow/request` (multipart: `stru_file`·`pipe_file`·`equip_file`·`employee_id`·`mesh_size`·`hull_no`·`source=AvevaMarine`) → `job_id`.
4. `GET /api/analysis/status/{job_id}` 1.5초 폴링 → 응답 **최상위** `output_dir` (result_info 아님).
5. `GET /api/analysis/modelflow/result-zip?output_dir=` → 로컬 폴더에 풂 → Studio 의 `initialFolder`. 서버 쪽 작업에는 서버 경로 `output_dir` 을 따로 보관.
6. Studio 에서: `modelbuilder/solve`(해석), `upload-edit`·`apply-edit`·`edit-status`(편집 확정), `/api/download`(결과·BDF), (신규) 보고서.

### 3.4 호출 규약 (AM → 클라이언트)

```
HiTessMB.exe <사번> --hull-no <호선> --stru <CSV> [--pipe <CSV>] [--equip <CSV>]
```

- **(2026-10-28 확정, AM 전달 문서 기준)** CSV 종류는 이름 붙은 옵션으로 받는다(순서·파일명·헤더에 기대지 않음). 없는 종류는 옵션째 뺀다.
  구조·배관이 둘 다 없으면 서버가 400 을 주므로 클라이언트가 먼저 막는다.
- **`--hull-no` 는 필수**(호선별 모델 DB 구축용). 형식은 엔진 정규화 규칙과 같다(영문·숫자·`-`·`_` 20자). 파일명 추정은 쓰지 않는다. 선종은 받지 않는다.
- 사번은 AM 이 현재 사용자 사번을 넣는다.
- 이미 실행 중이면 새 프로세스를 띄우지 않고 기존 프로세스에 인자를 넘긴다(Electron `requestSingleInstanceLock` + `second-instance`). 모델마다 Studio 창은 따로(WorkBench 의 `model-studio::<output_dir>` 세션 키 규칙 재사용).
- 종료 코드: 0 = Studio 까지 띄움, 그 밖 = 실패(사유는 창과 로그 파일에). AM 매크로는 기다리지 않고 바로 돌아가도 된다.

> "AM 내부에 상주하며 대기" 는 **필요 없다고 본다.** 호출될 때 뜨고 Studio 창이 닫히면 끝나면 된다. 상주시키면 업데이트·메모리·트레이 아이콘 관리만 늘어난다. 두 번째 호출은 단일 인스턴스 잠금이 받는다.

---

## 4. 새로 만들어야 하는 것

| # | 항목 | 내용 | 규모 |
|---|---|---|---|
| N1 | 클라이언트 exe | 인자 해석·로그인·빌드·폴링·진행 창·Studio 설치·창 관리 | 중 (WorkBench 코드 이식) |
| N2 | 편집 확정 체인 이식 | `HiTessModelBuilder.jsx` 의 finalize 처리를 클라이언트 main 으로 | 소~중 |
| N3 | **MB 구조해석 보고서** | 백엔드 `POST /api/analysis/modelbuilder/report` + Studio Analysis 탭 [보고서] 버튼 + 호스트 API(저장 대화상자) | **대** — 보고서 서식부터 정해야 함 |
| N4 | 결과 파일 받기 | 편집 BDF·F06·OP2 를 Studio/클라이언트에서 받기(지금 MB Studio 에는 UI 없음) | 소 |
| N5 | AM 매크로 | CSV 추출 + exe 호출 버튼 | AM 담당자 협의 |
| N6 | 서버 보강 | `GUARDED_ROUTES` 에 `/api/analysis/modelbuilder/` 추가(지금 solve 는 점검 중에도 열려 있음), `source=AvevaMarine` 통계 구분 | 소 |

### N3 보고서 — 별도 결정 필요

- 참고할 것: Module Unit 의 `unit_lifting_report`(결과 폴더 JSON → xlsx → 서버 Excel 로 PDF, 3D 그림은 백엔드 matplotlib). 같은 틀(collector / figures / sheet / builder)을 쓰면 PDF 변환·DRM 처리를 다시 풀 필요가 없다.
- 하지만 내용은 다르다. 권상 보고서의 필수 입력(`stabilityJson`, 와이어·훅)이 MB 에는 없고, MB 는 사용자가 정한 경계조건·하중·Load Case 가 핵심이다.
- 정할 것: 장 구성(모델 요약 / 경계조건·하중 / Load Case 별 최대 응력·변위 / 판정 기준 σ허용) / 사내 서식 유무 / 판정 기준(허용응력 계수).
- **추천:** 1차는 보고서 없이 1~6·8 단계만 출시하고, 보고서는 서식을 받은 뒤 2차로 붙인다. 보고서가 가장 크고 서식이 정해지지 않아 일정의 대부분을 먹는다.

---

## 5. 단계별 진행

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 0 | 결정(6장) + AM 측 협의(CSV 추출 형식이 지금 WorkBench 가 받는 CSV 와 같은지) | 결정표 채움 |
| 1 | 클라이언트 골격: 인자 → 로그인 → 빌드 → 폴링 → 결과 zip 받기 | 명령줄로 실모델(예: 3529_m04) 빌드 성공, My Projects 에 같은 기록 |
| 2 | Studio 설치·실행 + `workbenchAPI` 5개(finalize 제외) | Studio 에서 모델 보기·편집·해석·결과 표시 |
| 3 | 편집 확정 체인 + 결과 파일 받기(N2·N4) | 편집 BDF 를 사용자 PC 에 저장 |
| 4 | AM 매크로 연결(N5) | AM 버튼 → Studio 까지 한 번에 |
| 5 | 서버 보강(N6) + 배포(클라이언트 배포 경로·자체 업데이트) | 145 반영, 시범 사용자 2~3명 |
| 6 (2차) | 보고서(N3) — 사내 서식 확보 후 착수 | 서식대로 PDF 저장 |

---

## 6. 결정할 것

| # | 질문 | 추천 | 이유 |
|---|---|---|---|
| D1 | 클라이언트 기술 | Electron(안 A) | 기존 호스트 코드 재사용, Studio 실행 환경 동일 |
| D2 | 본인 확인 | 1차: 사번 인자 그대로 + Windows 로그인 계정 기록 / 2차: 계정 ↔ 사번 대조 | 아래 위험 R1 |
| D3 | 상주 여부 | 상주 안 함, 단일 인스턴스 | 3.4 |
| D4 | 보고서 범위·시기 | **확정(2026-10-28): 2차** — 1차는 모델 확인·편집·해석·결과·편집 BDF 저장까지 | 4장 N3. 서식을 받은 뒤 착수 |
| D5 | 클라이언트 업데이트 방식 | Studio 와 같은 manifest 방식(`/api/viewers/manifest/<client>`)으로 서버에서 새 버전 확인 | 이미 있는 배포 경로(StudioProgram·UNC) 재사용 |
| D6 | 결과 폴더 위치 | `%APPDATA%\<클라이언트>\results\<job_id>` (WorkBench 와 같음), 오래된 것 자동 정리 | — |

---

## 7. 위험·확인할 것

- **R1 사번만으로 로그인된다.** `/api/login` 은 사번만 받는다(비밀번호 없음). WorkBench 도 같지만, 명령줄 인자로 남의 사번을 넣으면 그 사람으로 해석이 기록된다. 사내 도구라 1차는 받아들이되 Windows 계정(`os_user`)을 함께 남겨 추적하고, 필요하면 사번 ↔ 계정 대조를 붙인다.
- **R2 Electron 버전.** WorkBench 배포 exe 는 실제로 Electron 26 으로 빌드되고 있다(루트 `node_modules` 문제, CLAUDE.md). 새 클라이언트는 처음부터 버전을 고정하고, Studio 를 그 버전에서 확인한다.
- **R3 서버 주소 기본값 불일치.** 프론트 기본값 70, Electron main 기본값 145 가 다르다. 클라이언트는 설정 파일 한 곳에서 읽고 배포본에 70 이 없는지 검사한다(`release.ps1` 과 같은 방식).
- **R4 AM CSV 형식.** AM 매크로가 지금 WorkBench 에 올리는 CSV 와 **같은 열·같은 인코딩**으로 뽑는지 확인 필요. 다르면 엔진 입력 감사(`00_InputAudit`)에서 대량 제외가 난다.
- **R5 회사 DRM.** 결과 zip 을 사용자 C: 에 푸는 것은 WorkBench 와 같은 방식이라 문제없다(이미 동작). 보고서는 서버가 메모리에서 만들어 바이트로 주고 사용자 PC 에 저장하면 DRM 이 감싸는데, 사용자 PC 에서 여는 데는 지장 없다.
- **R6 WorkBench 와 중복 유지.** 호스트 코드가 두 곳(WorkBench Electron · 클라이언트)에 생긴다. 공통 부분(Studio 설치·`workbenchAPI` 구현·solve·finalize)은 한 모듈로 떼어 두 앱이 같이 쓰게 하는 것을 1단계부터 목표로 한다. 안 그러면 Studio 기능이 늘 때마다 두 곳을 고쳐야 한다.
- **R8 WorkBench 계정이 없는 AM 사용자.** `/api/login` 은 등록되지 않은 사번이면 404, 미승인이면 403 이다(신규 사용자는 기본 비활성 → 관리자 승인). WorkBench 를 안 쓰던 사용자는 첫 실행에서 막힌다.
  **결정(2026-10-28): 웹 가입 페이지.** WorkBench 앱 없이 브라우저로 가입하게 한다. 관리자 승인 절차는 그대로 둔다(자동 승인 안 함 — R1).
  - 클라이언트: 로그인 404(미등록) → 안내 후 브라우저로 `<서버>/signup?employee_id=<사번>` 을 연다. 403(미승인) → '관리자 승인 대기' 안내 후 종료.
  - 서버: 가입 API 는 이미 있다 — `POST /api/register {employee_id, name, company, department, position}`(인증 없음, 사번 형식 `^[A-Z]\d{5,7}$`, 가입 때 PLM 메일 자동 조회). 새로 만들 것은 백엔드가 주는 가입 HTML 한 장(같은 출처라 CORS 무관)뿐.
  - 관리자: 기존 User Management 에서 승인. AM 경유 가입인지 알 수 있게 가입 경로 표시를 둘지는 구현 때 정한다.
  - ⚠ 사번 형식이 위 규칙이므로 AM 이 넘기는 `<사번>` 도 같은 형식이어야 한다(대문자 변환은 클라이언트가 한다).
- **R9 실행 PC.** AM 이 exe 를 부르므로 클라이언트와 Studio 는 **AM 이 도는 PC** 에서 뜬다. AM 을 원격 데스크톱·VDI 로 쓰는 사용자가 있으면 그쪽에서 Studio(WebGL)와 서버 접속이 되는지 확인한다.
- **R7 App 접근 게이트.** 관리자가 HiTESS Model Builder 를 점검 중으로 내리면 빌드 요청이 403 이 된다. 클라이언트는 그 사유(`detail`)를 그대로 보여 줘야 한다.

---

## 8. 참고 코드

| 무엇 | 위치 |
|---|---|
| Studio 호스트 감지·API | `WorkBenchSubModule/ModelBuilderStudio/apps/model-studio/src/host/host.js` |
| Studio 해석 실행 | 같은 앱 `src/hooks/useAnalysisRunner.js`, `src/store/useAnalysisStore.js` |
| Studio 설치·창·IPC | `HiTessWorkBench/electron/index.js` (`viewer:install`, `viewer:open`, `viewer:getInitialFolder`, `viewer:runModelBuilderSolve`, `viewer:finalizeEditedModel`), `preload.js`, `viewer-sessions.js` |
| 빌드 요청·폴링·편집 확정 | `HiTessWorkBench/frontend/src/pages/analysis/HiTessModelBuilder.jsx` |
| 인증 | `HiTessWorkBenchBackEnd/app/routers/auth.py`, `app/sessions.py`, `app/dependencies.py` |
| 빌드·결과 zip·해석 API | `HiTessWorkBenchBackEnd/app/routers/analysis.py` (`modelflow/request`, `modelflow/result-zip`, `modelbuilder/solve`) |
| Studio 배포 | `HiTessWorkBenchBackEnd/app/routers/viewers.py`, `/deploy` 스킬 |
| 보고서 참고 구현 | `HiTessWorkBenchBackEnd/app/services/unit_lifting_report/`, `app/services/xlsx_to_pdf.py` |
