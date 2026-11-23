# Model Builder Studio (엔진, Studio, 편집, CSV 추적, AM 연동)

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### Model Builder Studio — 2개 구성요소(엔진 / 스튜디오)와 배포 흐름 ★작업 전 필독

Model Builder Studio는 **별개의 두 프로젝트**로 구성된다. 작업 시 어느 쪽을 건드리는지 먼저 구분할 것.

**① 해석 엔진 (C#)**
- 소스: `C:\Coding\WorkBenchSubModule\HiTessModelBuilder\` (`Cmb.*` 솔루션, `HiTessModelBuilder.sln`)
- 빌드 산출물(실사용): `HiTessWorkBenchBackEnd\InHouseProgram\HiTessModeBuilder\Cmb.Cli.exe`
  - ⚠️ 폴더명은 `HiTessModeBuilder` ('l' 빠진 형태가 정확함, 오타 아님). InHouse 프로그램 규칙(위) 그대로 적용 — **git 미추적, 서버(145) 수동 교체 필요**.

**② 스튜디오 (React UI 뷰어)**
- 소스: `C:\Coding\WorkBenchSubModule\ModelBuilderStudio\apps\model-studio\` (viewer id=`model-studio`, 연결 메뉴=`HiTess Model Builder`)
- 사용 흐름: WorkBench가 `GET /api/viewers/manifest|download/model-studio`로 백엔드에서 최신 zip을 받아 로컬에 설치해 띄운다. `viewers.py`의 `_find_zip`은 후보 폴더를 순서대로 보고 **첫 번째 폴더(백엔드-로컬 `StudioProgram\`)의 최고 버전**을 내려준다. 배포 절차·버전 핀(`MODEL_BUILDER_STUDIO_VERSION`)은 `/deploy` 스킬.
- ⚠️ **회사 DRM**이 로컬 C:에 쓴 zip을 정확히 +4096B 암호화한다(백엔드는 `read()`로 복호화해 읽음). 그래서 `app/routers/viewers.py`는 size/sha256/다운로드 본문을 **모두 `read()`한 바이트 기준**으로 서빙해야 한다. `os.path.getsize`나 `FileResponse`(Content-Length=stat)를 쓰면 **`ERR_CONTENT_LENGTH_MISMATCH`** 로 신규 버전 다운로드가 실패한다.

**런타임 파이프라인 — 엔진↔스튜디오가 실제로 맞물리는 절차 (오케스트레이터: `app/services/hitess_modelflow_service.py`)**

배포 흐름(위)이 "프로그램을 어디 두나"라면, 이건 "사용자가 누르면 무슨 일이 일어나나"다. 두 task 로 구성된다.

1. **빌드** — `POST /api/analysis/modelflow/request` → `task_execute_modelflow`
   - 업로드: `stru_file`(필수) + `pipe_file`·`equip_file`(선택). UI 옵션 → CLI 플래그: `mesh_size→--mesh-size`, `ubolt_full_fix→--ubolt-full-fix`, `run_nastran→--run-nastran(+--nastran-path,--leg-z-tol)` 등.
   - 실행: `Cmb.Cli.exe build-full --stru <csv> [--pipe --equip] --mesh-size N [...]` (cwd=work_dir, timeout 20분).
   - 산출: `userConnection/<ts>_<id>_HiTessModelBuilder/<yyyyMMdd_HHmmss>/` 안에 **phase 파일**(`00_InputAudit.json`, `00_StageSummary.json`, `NN_*.json/.bdf` — 정규식 `^\d{2}_[A-Za-z]+\.(json|bdf)$`) + **최종 산출물** `<designName>.json/.bdf`.
   - output_dir 확정: 백엔드가 stdout 첫 줄 `출력 폴더: <path>`(또는 `폴더:`)를 파싱, 못 찾으면 성공/실패 모두 해당 요청의 work_dir 바로 아래 최신 `yyyyMMdd_HHmmss` 폴더로 폴백. exit **0=완료, 2=검증 Error, 1=실행/파이프라인 실패**. 실패해도 phase JSON/감사 경로를 보존해 진단을 표시하며, 실패 phase BDF는 최종 산출물로 제공하지 않는다.
   - 뷰: 스튜디오(`model-studio`)가 이 output_dir 을 **initialFolder 로 받아 phase JSON 을 일괄 자동 로드** → 3D 뷰/검증/편집.

2. **편집 적용** — `task_execute_apply_edit` (apply-edit 엔드포인트)
   - 스튜디오가 편집 결과를 output_dir 에 `*_edit.json`(intents)으로 기록.
   - 기본 경로: `Cmb.Cli.exe apply-edit-intent <output_dir> [--strict]` → `edited/` 에 `<base>.bdf` + `<base>.json` + `apply-trace.json`. exit **0=성공, 2=intents 빔, 64/65/70=실패**.
   - **엔진 하나만 적용한다** — 예전 Python fallback(exit 65 면 `nastran_bridge.py` 가 대신 적용)은 2026-10-29 걷어냈다. 엔진이 모르는 kind 면(`unsupported intent kind`) 실패하고 '엔진 교체 필요' 를 남긴다.
   - 후속 체인: `run_nastran` → `nastran.exe <bdf> scr=yes old=no batch=no` (f06/op2/log) → `parse_f06` → `F06Parser.Console.exe <f06> --output-dir` (`_results.json` + `_SC*_*.csv`). F06 의 `*** USER/SYSTEM FATAL|ERROR` 는 `scan_f06_diagnostics` 가 별도 수집.

**런타임에 필요한 InHouse 프로그램 3종 (Cmb.Cli 1개가 아니다 — 모두 서버(145) 수동 반영 대상)**

| 경로 | 역할 |
|------|------|
| `InHouseProgram/HiTessModeBuilder/Cmb.Cli.exe` | 엔진 (build-full + apply-edit-intent, MB 편집의 **유일한** 적용 경로) |
| `InHouseProgram/F06Parser/F06Parser.Console.exe` | F06 → 결과 JSON(`_results.json`)/CSV 파서 |
| 외부 MSC `nastran.exe` (`C:\MSC.Software\MSC_Nastran\20131\bin`, `--nastran-path` override) | 해석기. InHouse 아님 — 서버에 **MSC 설치** 필요 |

**편집 정합성 계약 (2026-10-02)** — 같은 편집 intent 를 Studio 미리보기·C# 엔진·Analysis 탭 해석 실행이 같은 모델로 만들어야 한다.
해석 실행(`modelbuilder_solve_service`)도 이제 Studio 가 보낸 `edits.intent_document` + `base_name` 으로 **편집 적용과 같은 함수**
`hitess_modelflow_service.apply_edit_intents`(C# 엔진)를 거쳐 편집 BDF 를 만든다(예전 삭제·RBE 추가 직접 반영 경로는 옛 Studio 호환용).
엔진마다 규칙을 맞추는 대신 Studio 가 결정값을 intent 에 박는다 — 회전 `pivot`, 무게중심 RBE 의 미리 거른 종속 + `independentCoord`(산술 평균),
일반 RBE 종속 중복 = 오류, 회전은 노드 추가·무게중심 RBE 보다 먼저. 상세·지원 표: Studio `docs/edit-intent-spec.md` 맨 앞 '현재 계약'.
계약 테스트 `tests/test_modelbuilder_edit_contract.py` — 새 kind 는 C# ↔ Studio 미리보기(`scripts/previewEditedModel.mjs`), 옛 kind(회전·무게중심 RBE·유체 비움)는
C# ↔ bridge 비교 2건을 독립 기준으로 남겼다(bridge 는 Mooring·SP 편집 엔진). 새 빌드 검증 시 `CMB_CLI_EXE`·`NASTRAN_BRIDGE_PY` 로 지정.
⚠ 새 intent kind 를 만들면 **Studio·C#·계약 테스트 3곳**을 함께 고칠 것(MB 경로 bridge fallback 은 2026-10-29 제거 — bridge 는 고치지 않는다).

**기본 모델 편집 기능 (2026-10-28 결정, 진행 중)** — 요소 삭제·추가, 노드 이동, 단면 변경, 질량 추가·수정·삭제, RBE 수정 등 9개.
이 작업에서 **MB 경로 엔진을 C# 하나로 통일**했다(`deleteRigid`·`addNode` C# 이식 → 145 exe 교체 뒤 MB 의 bridge fallback 제거, 2026-10-29).
결정 전체·진행 단계: Studio `docs/edit-intent-spec.md` 맨 앞 '기본 모델 편집 기능 계획'.
상태(2026-10-28 세션 끝) — 세부·버전별 경과는 Studio `docs/edit-intent-spec.md` 진행 단계 ①②.
- **완료(코드)**: ① C# 이 `deleteRigid`·`addNode` 직접 적용. ② `deleteElements`·`deleteMasses`·`deleteOrphanNodes`.
  ③④에서 앞당김(사용자 결정) `moveNodes`·`addElement`, ③ `changeSection`, ③④ `changeMasses`·`addMasses`(2026-10-29, 상세 Studio spec — **70 로컬만**: model-studio 0.1.3(0.1.2~0.1.3 = 값 수정 클릭 = 바꿔 선택·지금 값 미리 채움·다른 도구로 가면 앞 창 닫고 선택 비움)·핀 0.1.3 ·
  InHouse `Cmb.Cli.exe` sha256 8055258d…(백업 `.bak_20261029_before_mass_edits`). ⚠ 145: exe 교체 **먼저** → `/studio-release model-studio`
  (옛 exe 면 질량 편집이 `unsupported intent kind` 로 실패 — bridge fallback 없음). 화면 눈으로 확인 안 함). fallback 제거(2026-10-29) — `BRIDGE_ONLY/KNOWN_INTENT_KINDS` 없음,
  옛 엔진이면 '엔진 교체 필요' 로 실패(`test_modelbuilder_edit_fallback_guard.py`).
- **화면**: 편집 작업의 단일 진입점 = 뷰포트 왼쪽 도구 막대 `EditToolPalette`(노드·부재·질량·RBE·정리). 왼쪽 패널 = 선택 필터·수정 내역,
  아래 선택 바 = 선택 수·해제·목록. 형상 편집은 파생 모델(`data/geometryEdits.js`)로 편집 대상 뷰포트에만 그린다(원본 StageData 불변).
- **계약 테스트** = C# ↔ Studio 미리보기(`scripts/previewEditedModel.mjs`, node 필요) — `test_modelbuilder_edit_contract.py`. 옛 exe 면 해당 테스트는 건너뛴다.
- **배포(로컬 70만)**: InHouse `Cmb.Cli.exe`(sha256 12f1f3aa…, 백업 `.bak_20261028_before_delete_edits`·`.bak_20261028_before_move_add`) ·
  `model-studio-0.0.121`(로컬·UNC, **릴리스 표 0.0.121 = 145 공개**(`d27df93`, 2026-10-29) — 0.0.115 새 부재 삭제 시 새 노드도 정리, 0.0.116 '삭제' 먼저 → 고르기 도구, 0.0.117~0.0.119 '도움말·셸 정리', 0.0.120 작업 패널 통일, 0.0.121 좌하단 버전 표시) · **0.0.122 는 70 로컬만**(2026-10-29, 커밋 전 독립 리뷰 반영 — 새 구조 단면 PID 를 배관 구간(≥101) 밖에서 고름 `suggestNextPropertyId`·
  그룹 삭제 시 그 노드를 쓰는 `addElement` 도 함께 취소·대화상자 한글 조합 Enter) · 0.0.123 **부재 단면 변경**(`changeSection`, 상세 Studio `docs/edit-intent-spec.md` 진행 단계) ·
  0.0.124 단면 변경 패널 기본값이 고른 부재의 지금 단면이면 '이미 단면 P19' 가 뜨던 것 수정 · **0.1.0**(같은 내용, 사용자 지시로 번호만) = **릴리스 표 0.1.0**(`42108bb`, UNC 업로드·검증됨) · 핀 0.1.0(표시용).
  InHouse `Cmb.Cli.exe` 70 교체(sha256 c9bb1e11…, changeSection + 새 PID 가 base BDF `PipePidBase` 이상이면 65, 백업 `.bak_20261029_before_change_section`).
  **145 반영 완료**(사용자, 2026-10-29): InHouse `Cmb.Cli.exe` 교체 + ⟳ Update(표 0.1.0). exe 가 옛것이면 0.1.0 의 단면 변경·삭제·노드 이동·부재 추가가 실패한다.
  릴리스 표는 git 이라 `/studio-release` 후 145 ⟳ Update 가 늘 필요하다(사용자 확인, 2026-10-29 — 자동 pull·UNC 표는 하지 않기로). `/studio-release` 보고 첫 줄에 그 문장을 넣게 바꿨다.
  WorkBench 1.6.30(`83fef8b`) 릴리스·푸시. 145 반영(InHouse 교체·⟳ Update·재시작)은 사용자가 마침(2026-10-29).
- **도움말·셸 정리 (2026-10-29, 0.0.117~0.0.119)** — Studio 안 사용자 가이드: 상단 `도움말`(따라하기 7개 · F1 버튼 설명 모드 · 기능 찾기 · 단축키 · 용어),
  원본은 Studio `src/data/helpContent.js` 한 곳(버튼·구역 `data-help`, 테스트가 누락을 잡음). `/design` 검토(27/40) 후 사용자 결정으로 셸 규칙을 정함 —
  보이기 설정은 오른쪽 '표시' 도크 한 곳(9-11 Model 탭 배치를 되돌림) · Model Check = 보기·제안, 그룹 삭제는 Edit · 탭 푸터 = 다음 행동 1개 ·
  노드·부재 입력 창 = 뷰포트 아래 비모달 패널(3D 클릭이 주황 칸에 바로 들어감) · 노드 중점 생성 · 직교 카메라 near 음수(확대 시 모델 잘림 수정) · CSV '모델 없음' 행 점선 상자.
  규칙·남은 것·**Module Unit Studio 로 넓힐 목록** = Studio `apps/model-studio/docs/shell-conventions.md`(MB 개선을 마친 뒤 사용자가 확산 요청 예정).
  **작업 패널 통일(2026-10-29, 0.0.120~)**: 노드·부재·삭제·RBE·고립 노드 정리가 모두 같은 아래쪽 패널(`components/edit/WorkPanelFrame.jsx`) —
  모드 표시(삭제 = 빨간 테두리) · 대상 칸 · 옵션 · 주 버튼 하나 · Esc. 패널이 열린 동안 3D 클릭 = 대상 넣기/빼기(스토어 `pickTool` 이 패널 열림과 함께 움직임).
  사용자 결정: 적용 후 패널 유지 · 삭제 확인 모달 없음(Ctrl+Z, 패널이 끊김·함께 지워질 노드를 미리 보임). 선택 바 [삭제 Del] [RBE로 묶기 Enter] 로 단축키 안내.
  규칙 원본 = Studio `docs/shell-conventions.md` 11번.
- **git (2026-10-29 커밋·푸시)**: 엔진 → `HiTessModelBuilder.git` `main`(`ecfe841`, 옛 엔진 이력은 `-s ours` 병합으로 보존) ·
  Studio → `ModelBuilerStudio.git`(Private, 옛 이름 ClaudeModelBuilerViewer) **`model-studio` 브랜치**(`c0fa8db`). 그 저장소 `master` 는 **Module Unit Studio** 라
  GitHub 의 'model-studio → master' PR 제안을 누르지 말 것. ModelBuilderStudio 로컬 `master` 가 `origin/model-studio` 추적(`push.default upstream`, PC 마다 설정).
  **Module Unit Studio 는 2026-11-03 별도 저장소 `ModuleUnitStudio.git`(Private, `master`)로 옮겼다** — 로컬 옛 원격은 `legacy`. `ModelBuilerStudio.git` 의 `master` 에 옛 MU 코드가 남아 있다(정리는 사용자 결정).
  세 저장소에 시험용 샘플: 엔진 `csv/`·`samples/`(기존) · MB Studio `samples/3454-35020-A505080` · MU Studio `samples/3496-35210-A508372`. ⚠ 엔진 저장소 `HiTessModelBuilder.git` 은 **Public** 이라 사내 CSV 가 공개돼 있다(2026-11-03 확인, Private 전환 권함).
  리뷰에서 '고치면 좋음'으로 남긴 엔진 항목: 과학 표기 양수 지수 부호 빠짐(`BdfField.FormatPrecise`, 1e6 이상) · `edited/` 교체 실패 시 옛 결과 유실 · 옛 무게중심 intent null 예외.
- **남은 일**: 화면 눈으로 확인 안 함(0.0.113~0.0.116 편집 도구, 0.0.117~0.0.119 도움말·셸 정리·아래쪽 패널은 사용자 확인 중) ·
  3529_m04 실모델 미확인(이 PC 에 없음) · 단면 변경 커밋·푸시(2026-10-29): Studio `a4da5e5`(model-studio 브랜치) · 엔진 `959493f` · WorkBench 계약 테스트·핀·`studio-release.md`
  (커밋 전 독립 리뷰 마침 — 막아야 함 0) · 0.0.122~0.1.3 화면 눈으로 확인 안 함(0.1.1~0.1.3 질량 추가·값 수정은 사용자 확인 중) ·
  **145 남은 일(2026-10-29 세션 끝)**: `git pull` + 재시작 1회(`dd8f576` fallback 제거) → InHouse `Cmb.Cli.exe`(sha256 8055258d…) 교체 →
  `/studio-release model-studio`(0.1.3) → ⟳ Update. 커밋: 엔진 `2216d6a` · Studio `dbe878e`·`556a1c4` · WorkBench `dd8f576`·`8b165ab`·`8c3f651` ·
  단면 변경의 '기존 PBEAML 복사 후 치수 수정' 미구현(카탈로그 = L 만) ·
  계획의 나머지(RBE 종속 수정, 하류: BDF 편집 요약 주석·CSV 탭 '편집으로 삭제됨'·
  판정 재계산) · 질량 요약 오버레이가 편집을 반영하지 않음(기존 한계).

**Analysis 탭 재설계 (2026-11-09~10, Studio 0.1.5~0.1.8, 릴리스 표 0.1.8 `4ed1896`)** — 초보자가 따라 하도록 ① 고정 ② 힘 ③ 중력 → 푸터 [해석 실행] → 결과.
Load Case 단계 없음(스토어 `effectiveLoadCases`: 기본 '모두 한 번에', 접힌 '해석 케이스'에서 '하중마다 따로'). 고정·힘은 Edit 와 같은 아래쪽 작업 패널(`panels/analysis/AnalysisWorkPanels.jsx`, 확인 창 없음).
사용자 결정: 힘 단위 N · 중력(자중) 기본 꺼짐. 서버로 보내는 형식은 그대로. 규칙·결정 원본 = Studio `docs/shell-conventions.md` 12번.
- 확정한 항목만 실행·페이로드에 넣는다(`committedInputs` — 고르기만 한 항목이 해석에 들어가던 리뷰 '막아야 함').
- 0.1.6: **노드 클릭이 고정·힘에 안 들어가던 결함(0.1.4 부터)** — ThreeViewport 클릭 처리기가 첫 렌더의 `onPick` 을 굳혀 Model 탭에서 연 모델은 Analysis 에서도 일반 선택이 됐다 → `onPickRef`.
- 0.1.7: 자동 변형 배율이 늘 ×1 — `modelDiagonalMm` 이 실제 bbox 모양(`minX…`)을 못 읽었다(테스트 가짜 bbox 도 틀린 모양이었다). 경계조건·힘 표식은 모델 대각선 비례(`overlaySizes`, 예전 값이 상한).
- 0.1.8: 힘 화살표 꼬리에 크기 라벨(`collectForceLabels`, 노드 12개 넘으면 첫 노드에 '× N').
- 상태: 145 ⟳ Update 는 사용자 몫. WorkBench 앱 안 화면·실제 Nastran 해석은 눈으로 확인 안 함(헤드리스 Chrome 실제 클릭·캡처까지).
  ⚠ 2026-11-09 저장 중 `AnalysisInputOverlay.js`·테스트가 통째로 NUL 바이트가 된 일이 있었다(원인 미상, 커밋본으로 복구) — 이상하면 `tr -d '\000'` 로 먼저 본다.

**3D 위 자리 규칙·다크 전용 (2026-11-10, Studio 0.1.9 · MU 0.0.208, 릴리스 표 `b316b43` = 145 공개(⟳ Update 는 사용자 몫) · 두 Studio 저장소 코드는 미커밋)** — `/design` 전체 검토(25/40, 화면 실측) 후 사용자 결정 4건.
규칙·남은 P2 원본 = Studio `docs/shell-conventions.md` 13번, 진단 기록 = Studio `.impeccable/critique/2026-11-10T01-56-01Z__src-app-jsx.md`.
- **다크 전용** — 테마 단추 삭제, `palette()` 는 인자를 무시(MU·Mooring 과 같음). 컴포넌트의 `theme === 'light'` 분기는 타지 않는 옛 코드.
- **알림 = 칩**(`components/ViewportNotices.jsx`, 뷰 도구줄 아래 줄) — 분리 그룹(Model 탭, [Model Check 에서 잇기]) > 장비 COG > CSV 빈 자리. 위쪽 가운데 띠는 없앴다.
  화면의 CSV 문제 수는 '모델에 없는 행'(탭 배지 = 아래 도크 머리) 하나, 칩은 '곳'을 센다.
- **작업 패널은 뷰포트 그릇 안**(`WorkPanelFrame` 이 `data-viewport-root` 로 portal) — 떠 있는 동안 조작 안내줄 숨김. 범례는 늘 bottom 46.
- **색** — 편집 선택 = 흰색 + 어두운 외곽, 그룹 1(본 구조) = 회청색(그룹은 요소 수 내림차순이라 1번이 본 구조). 주황은 편집 도구에만.
- Model Check 는 떨어진 그룹이 있으면 '자동 연결'이 그룹 목록 위. '표시' 도크 자동 펼침은 창 폭 1400px 이상만. `EDIT MODE` 배지·Analysis 위쪽 안내줄·`InputAuditPanel.jsx`·`BottomReviewDock.jsx` 삭제.
- 상태: zip 0.1.9 = 70 로컬·UNC(검증 MATCH) · 핀 0.1.9 · 릴리스 표 0.1.9(`b316b43`, Update History 항목 포함). Studio 저장소·WorkBench 핀·이 문서는 미커밋, 커밋 전 독립 리뷰 미실행.
  헤드리스 Chrome 세 폭(1600·1280·1024)에서 겹침 측정까지 — WorkBench 앱 안 화면·Analysis 노드 클릭 흐름은 눈으로 확인 안 함.
- **MU 에도 옮김 (같은 날, `/studio-sync`, MU 0.0.206~0.0.208 · 릴리스 표 0.0.208 `b316b43` · Studio 저장소 미커밋·핀 0.0.208)** — 싱크 대장 9~12·14·15번 도입함, 13번 해당 없음.
  0.0.207~0.0.208 = **그룹 목록을 MB 모양으로**(사용자 요청 '모델 빌더 스타일로 다') — Model Check·Edit 둘 다 [전체 표시] [전체 숨김] + 색 카드 한 줄, Edit 는 오른쪽 휴지통.
  MU 의 '그룹 관리' 상자(기준 전환·확인·단독·그룹 새로고침)는 없앴다 — 되살리지 말 것. 부재 종류(구조·배관) 삭제만 목록 아래 '부재 종류로 지우기'로 남김. Edit 구역 이름 = '그룹'.
  옮긴 것 = 편집 선택 흰색(부재 굵기는 화면 픽셀 기준) · 그룹 1 회청색 · 작업 패널을 뷰포트 그릇 안으로 · 분리 그룹 칩(MU `components/ViewportNotices.jsx`, Model 탭, 막지 않음) ·
  Model Check 자동 연결을 그룹 목록 위·펼친 채 · '표시' 도크 자동 펼침 1400px 이상 · 뷰포트 머리 `N: E:` 삭제. 상세 = MU `docs/plans/2026-10-29-mb-features-to-mu.md` '3D 위 자리·선택색'.
  확인: MU 테스트 1010건·빌드 통과(lint 는 예전부터 있던 15건 그대로), MB 샘플 3454(그룹 9개)를 넣은 헤드리스 캡처. WorkBench 앱 안 화면은 눈으로 확인 안 함.
  ⚠ MU 그룹 줄을 누르는 것은 **숨김**이고 해석 모델에서 빠지지 않는다 — 지우려면 Edit 탭 오른쪽 휴지통(2026-11-10 사용자가 숨김을 삭제로 알고 해석해 FATAL 9050, 3469 M02 그룹 2).
- **프로그램 비정상 종료 문구 (2026-11-10, 미커밋)** — 외부 프로그램이 Windows 예외(종료 코드 ≥ 0xC0000000, 예 3221225477 = 0xC0000005)로 죽으면
  '입력 모델 문제가 아니라 실행 환경 문제' 로 안내한다. 판정·문구 원본 = 백엔드 `app/services/exit_codes.py` ↔ 프론트 `utils/abnormalExit.js`(사본, +테스트).
  적용 = 권상 BDF 검증(`groupmoduleunit_service`, 결과에 `abnormalExit`) · 구조 해석 편집 적용(`unit_structural_service`) · GMU 판정 카드(`gmuLiftingVerdict` `jobLog`)·알림. 다른 앱의 실패 경로는 아직 예전 문구.
  반영 = 145 `git pull + 재시작`(백엔드) · 판정 카드·알림은 다음 exe. 프론트 lint 는 `@eslint/js` 미설치로 못 돌림.
  **결과를 다 쓴 뒤 죽으면 계속 간다 (2026-11-11, `697b6cd` · WorkBench 1.7.19)** — 권상 구조 해석의 편집 BDF 생성·Wire BDF 생성(`unit_structural_service.build_lifting_bdf`)은 Windows 예외 종료여도
  `exit_codes.outputs_complete_after_crash`(이번 실행에 새로 썼고 · BDF 끝 = ENDDATA · JSON 이 끝까지 읽힘)가 참이면 엔진 로그에 '[경고] … 계속 진행' 을 남기고 진행한다.
  실례 `20261111_105028_A476854_GroupModuleUnit`(Dev_Server_70.bat 로 띄운 백엔드에서 DRM 이 종료 순간 끊음). 시험 `tests/test_exit_codes_crash_tolerance.py`.
  **BDF 검증(GMU·Side Passage·해상 운송 공용 `task_execute_groupmoduleunit`)도 같은 규칙 (2026-11-12, 미커밋)** — 모델 파싱(`<stem>.json`)·validate-run 준비(`_validation.json`+`_validation.bdf`) 두 bridge 호출.
  실례 `20261112_101950_A476854_GroupModuleUnit`(JSON 1.3 MB 를 다 쓴 1초 뒤 HIDRMH.DLL 0xC0000005 → '프로그램 비정상 종료'). 경고 문구는 공용 `exit_codes.crash_tolerated_note`. 시험 `tests/test_gmu_validation_crash_tolerance.py`.
  끊긴 뒤 넘어가는 경로는 시험으로만 확인(실제 5회 재실행에서 재현 안 됨). 반영 = 70 백엔드 재시작 · 145 `git pull + 재시작`.

**엔진 전면 개선 (2026-11-12~, 진행 중)** — 수집 CSV 로 회귀를 재며 엔진 결함을 하나씩 고친다. 코퍼스 = `E:\HiTESS\ModelBuilderCsv_raw`(145 작업 폴더 사본, 11-20) + `E:\HiTESS\ModelBuilderCsv` → **168묶음**.
계획과 진행 기록·결정표(D1~D13) = `docs/plans/2026-11-12-modelbuilder-engine-overhaul-plan.md`, 회귀 장치 = `scripts/mb_engine_regress/`(`regress.py run|compare`, 끊기면 `run --force --resume`, 결과 `outputs/mb-engine-regress/<label>/`, git 미추적).
엔진 수정은 회귀로 이전 결과와 비교한 뒤에만 커밋(엔진 `HiTessModelBuilder` 로컬 커밋, 푸시 안 함 — Public 저장소라 Private 전환 뒤). **70 InHouse = 엔진 `a6188b0`(2026-11-23)**, 백업 사슬 `.bak_20261123_before_*`. **145 는 아직 11-17 이전 exe** — InHouse `Cmb.Cli.exe` 수동 교체가 백엔드 `git pull`, `/studio-release model-studio` 0.1.17 보다 먼저(사용자 몫).

**검토 분류 규칙 (D13, 2026-11-23 사용자 지시 '승인이 필요한 일을 엄밀히 구분')** — 고치기 전 꼭 알 것.
- 결정마다 승인 / 결함 / 기록을 정하는 곳은 엔진 `src/Cmb.Cli/Dto/ReviewCatalog.cs` **한 곳뿐**. 기준값(질량점 이동 500 mm, 그룹 이동 10 mm, 승인 알림 20건, 받침 없이 긴 배관 5 m)도 여기만.
  `00_Review.json` 2.0 이 단위마다 label, hint 를 싣고 Studio, WorkBench 는 그대로 보여 준다 — 화면에서 다시 분류하지 말 것. WorkBench `utils/mbReview.js`, Studio `data/reviewData.js` 의 이름표 표는 옛 1.0 결과용 대체값(새 종류를 더할 때 같이 맞춘다).
- 승인 = 규칙 밖 추정만(B 연결, U-bolt 없는 배관 받침 `pipe_rest`, 받칠 구조 없는 U-bolt(배관끼리만 이은 성분 단위), 먼 질량점 이동, 큰 그룹 이동, 구조를 배관에 잇는 `GROUP_CONNECT_RBE/PIPE`). 결함 = 이어지지 않은 그룹, 빠진 질량, 받침 없이 긴 배관(BDF 머리 `Defects=`, 편집 뒤 다시 셈 — `ReviewOutcome.Recount`).
- '받침 없이 긴 배관' 은 받침에서 배관을 따라 **가장 먼 거리**로 잰다(조각 길이 합은 TEE 가지 때문에 정상 모델을 잡는다). 받침 = 구조와 같은 RBE 의 배관 노드, 구조와 노드를 같이 쓰는 배관 노드, SPC.
- GroupConnect: 이미 RBE 로 이어진 그룹은 다시 잇지도 옮기지도 않는다(정리 단계가 표식을 MERGED_SHARED_DEP 로 바꿔도). 연결 판정에서 배관은 뺀다(배관에만 매달린 구조를 '이어짐' 으로 보면 변위 349 → 1,251 mm). 10 mm 넘게는 옮기지 않는다.

**장비 COG 위치 오류 `EQUIPMENT_COG_FAR` (2026-10-27)** — 장비 CSV 의 `cog` 가 잘못 나오면(실례 3529_m04 `=30137/754429` 715 kg, X 만 50 m 어긋남)
엔진이 그 좌표에 COG 노드를 만들고 부착점과 RBE2 로 묶어, Studio 에 모델 밖으로 길게 뻗은 RBE 가 생긴다. 같은 오류가 `3592_m10`(`=21945/1855177` 153 m)에도 있다.
- 엔진 `FinalValidationStage.CheckEquipmentCogDistance`: 장비 RBE 의 COG ↔ 가장 가까운 부착점 > **5 m** 면 **Warning**(모델은 그대로).
  기준 근거: 리뷰 모델 장비 80행 중 정상은 ≤1.4 m, 오류는 47~153 m. 질량 0 장비는 엔진이 RBE 를 만들지 않아 대상이 아니다.
  ⚠ 최종 JSON(`<designName>.json`, Studio 의 '07 Final')의 진단은 모델 상태로 **다시 계산**해 단계 경고가 빠진다 —
  Studio 는 Final 을 기본으로 열고 편집하므로 `CliCommands` 가 이 경고만 Final 에 이어 붙인다(`EquipmentCogFarOutputTests`).
  사용자가 꼭 봐야 할 단계 경고를 새로 만들면 같은 자리에 추가할 것.
  메시지 키 `SourceName=…; distance=…mm; massKg=…; cog=(x, y, z)mm` 를 `utils/modelValidation.js` `parseEquipmentCogFar`(WorkBench·Studio 사본)가 읽는다.
- WorkBench: 판정 '검토 필요'(`equipment-cog-far`, 편집 모델에 그 장비 RBE 가 sourceName 으로 남아 있을 때만) + 진단 카드.
- Studio(0.0.98, 핀 동기화): 뷰포트 상단 알림 · 그 RBE/COG 노드/장비 질량에 마우스를 올리면 말풍선 · 클릭하면 카드의 [삭제…] → 확인창 →
  `deleteRigid { removeMass: true }`(RBE + COG 노드 장비 질량 + 고립 COG 노드 제거). Model Check 진단 목록 '입력값 오류' 필터에도 [삭제…].
  바른 수정은 CSV cog 를 고치는 것이라 확인창에 질량이 함께 빠진다고 알린다.

**CSV 추적 — 빈 공간이 CSV 의 어느 줄 때문인가 (Studio 0.0.101, 2026-10-27)** — 레이어 'CSV 추적'(기본 켬), 엔진 변경 없음.
⚠ **"제외된 행 = 빈 공간" 이 아니다.** 3542_35320 의 길이 0 TEE 7건(pos=apos=lpos=p3Pos 한 점)은 앞뒤 직관이 교차부를 이미 채워
빈 공간의 원인이 아니었고, 실제 빈 공간(N74↔N173, 270 mm)은 CSV 에 **행이 아예 없는** 구간(14행 OD 318.5 끝 → 15행 FLAN → 94행 OD 508 시작)이었다.
없는 행은 그릴 수 없으므로 **끊긴 양 끝이 CSV 몇 번째 줄에서 끝나는지**를 보여 주는 것이 중심이다.
- ① 끊긴 배관 `data/pipeGaps.js`: 배관 끝(연결 1 + RBE 없음) 두 개가 1.5 m 안에서 **서로를 향할 때만**(바깥 방향 30° 이내, 벤트·드레인 오인 방지),
  서로 가장 가까운 짝 하나. 양 끝 CSV 행 = 요소 sourceName ↔ 감사 name 중 끝 좌표에 가장 가까운 줄, 사이 행 = 두 끝 상자 안 좌표.
  편집 미리보기에서 addRigid 로 그 끝을 이으면 표시를 거둔다. 실모델 3542_35320 에서 정확히 1곳.
- ② 제외 행 상자 `data/excludedRowGhosts.js`: 영역 = CSV `wvol` → 없으면 좌표 칸 범위(60 mm 미만은 픽용 확대). 정상 제외(질량 0 장비 등)는 빼고,
  **모델 부재가 지나가는 상자도 뺀다**(`ghostsOutsideModel`). 사유 문구는 WorkBench `REASON_LABELS` 사본. 회전 편집이 있으면 ②만 숨김(CSV 좌표와 어긋남).
- 표시 `three/ExcludedGhostOverlay.js`(`buildCsvTraceOverlay`) · 말풍선 `components/ExcludedRowTooltip.jsx` — 모델 부재가 안 잡히는 자리에서만 픽, 클릭 고정.
- **CSV 탭 (Studio 0.0.104, 2026-10-27)** — 하단 도크에 숨어 있던 변환 감사를 상단 탭으로 올렸다(사용자 요청: 잘 안 보이고 CSV 모양이 아님).
  배치 = 상단 `CSV ⚠n`(모델에 없는 행 수) → 왼쪽 `panels/CsvPanel`(파일별 요약·선택한 행의 원문 칸 전부·[3D에서 보기]·[원문 줄 복사]) |
  가운데 위 3D / 아래 `csv/CsvSheet`(하단 도크 자리, 위 경계로 높이 조절 — 비율 localStorage). 시트는 **CSV 칸·줄 순서 그대로**,
  왼쪽 줄·상태·name / 오른쪽 '모델 대응' 고정, 좌표는 숫자만(원문은 패널·툴팁), 보이는 행만 그림. 행 클릭·Enter = 강조 + 카메라, ↑↓ = 강조만,
  3D 부재 클릭 → 그 행으로(사용자 선택·카메라 유지). 대응 기준 = 활성 뷰포트 단계. [닫기]·Esc(0.0.105) = 들어오기 직전 탭(`modeBeforeCsv`)으로 돌아가 3D 원래 크기 + CSV 행 강조 해제. 자료 = `hooks/useCsvData`(모듈 캐시) + `data/csvSheet.js`(+test),
  상태 = `store/useCsvSheetStore`(`openCsvRow`·`openCsvTab` — 알림·말풍선·Model Check 진입점). 하단 도크 '변환 감사' 는 요약 + 이동 버튼만 남겼다.
  `InputAuditPanel.jsx` 는 이제 어디서도 쓰지 않는다(옛 `BottomReviewDock.jsx` 만 참조 — 둘 다 정리 후보).
- ⚠ **1점 TEE 는 '제외' 오류로 유지한다 (사용자 결정 2026-10-27)** — CSV 의 TEE 는 두 형식이 섞여 나온다: 3점 TEE(apos·pos·lpos·p3Pos 가 따로,
  엔진이 직관 2 + 분기 1 로 모델링)와 **1점 TEE**(네 좌표가 교차 중심 한 점 → `zero_length_pipe` 제외). 1점 TEE 는 앞뒤·분기 배관 행이 그 점에서
  직접 이어져 모델이 끊기지 않고 질량도 0 이지만(리뷰 모델 36개 중 35개가 배관 끝 3개 이상 만남), **CAD 쪽 모델링 방식의 문제라 사용자에게 알려야 하는
  항목**이다. '접합점' 같은 정상 분류로 바꾸거나 문제 건수에서 빼지 말 것(그 제안을 사용자가 거부했다).
- **CSV 행 ↔ 모델 대응 (Studio 0.0.102)** — `data/csvRowMapping.js` `mapCsvRows`. ⚠ **이름만으로 맞추지 말 것**:
  CSV 는 한 부품을 여러 줄이 같은 name 으로 쓴다(3542 는 127행 중 44행). 예전 표는 제외된 TEE 줄이 옆 줄 TUBI 부재를 `E×1` 로 가리켰다.
  규칙: 직선 행 = 시작–끝 직선 위(수직 ≤50 mm)에서 구간이 겹치는 부재(엔진이 끝을 늘여도 맞음) · 곡관 = 시작·끝·p3Pos 범위에 한쪽 끝 ·
  그 밖 = 같은 이름 질량점/RBE(행 좌표 1 m 안) · U-bolt 는 150 mm 안 다른 이름 U-bolt RBE 를 '추정'으로 · 없으면 첫 단계 trace
  `ElementSkipped` 문구('질량 8.2kg 누락: CoG 10mm 내 유효 부착 노드 없음') → 첫 단계엔 있었으면 '엔진 처리 중 지워짐' → '대응 없음'.
  제외 행은 그 자리(wvol)를 채우는 다른 행을 '이 자리에는 22행 TUBI 부재가 있음' 으로 알린다. 행 클릭은 `pickedEntity.sourceName` 에
  `elementIds·massIds·rigidIds·box·csvLine·mapLabel` 을 실어 **그 번호만** 강조·포커스하고, 모델에 없으면 그 자리에 점선 상자.
  실측: 3542 → 부재 72·질량점 33·RBE 10·제외 9·지워짐 3 / 3529 → 부재 491·질량점 96·RBE 145·제외 21·지워짐 8·엔진이 뺀 장비 5.
- **장비 질량 누락 → 입력 감사 `error` / `equipment_mass_not_attached` (엔진, 2026-10-27)** — 질량이 있는데 부착 노드를 못 찾으면
  (`BuildEquips`: interPos 10 mm 안 노드 없음, 또는 interPos 없이 CoG 10 mm 안 노드 없음) 엔진이 질량을 뺀다. 예전엔 trace 에만 남고
  입력 감사는 'converted' 라 WorkBench 판정이 못 잡았다(3529_m04 5행 84.2 kg). 이제 `FeModel.DroppedEquipment` → `InputAuditJson.Build(…, droppedEquipment)`
  가 그 행(같은 name 의 첫 converted 장비 행)을 error 로 바꾸고, 판정 `massBearingExclusions` 가 그대로 '검토 필요' 로 잡는다. 사유 문구는
  WorkBench `REASON_LABELS`·Studio `excludedRowGhosts.REASON_LABELS` 사본('장비 부착 노드 없음 — 질량 누락'). 테스트 `EquipmentMassDroppedAuditTests`.
- 남은 후보: 3D 부재 클릭 → 정보 패널에 CSV 줄 표시·표 해당 행으로 이동(CSV 탭에서는 이미 됨, 다른 탭에서도 할지).

**RBE 노드 공유 규칙 — 추적 결과와 다음 작업 (2026-10-27)** — 사용자 고민: 간격 메움 RBE(엔진 FREE_END·GROUP_CONNECT·LOOP_CLOSE, 대부분 ≤170 mm)가 촘촘해
COG 노드 + 질량을 두고 주변 부재에 RBE 로 묶기가 어렵다(3529_m04 구조 노드 677 중 370개(55%)가 이미 RBE 에 걸림, 그중 cm=123456 274개 · U-bolt 부분 cm 96개).
- Nastran 실측(MSC 2013): **금지는 종속 중복뿐**(FATAL 5289 "DEPENDENT DOF … ON MORE THAN ONE MPC OR RIGID ELEMENT"), 사슬(종속 → 다른 RBE 의 독립)은 정상 해석.
- 프로젝트는 더 엄격한 **"한 노드 = RBE 하나"** 를 지킨다: 엔진 `RigidSharedNodeMergeStage`(Union-Find 병합, cm 합집합) · bridge `add_rigid_from_params`/`normalize_rigid_node_sharing`(흡수 병합) ·
  Studio '병합 연결'(`computeRigidMerge`). 반면 **C# `ApplyAddRigid` 는 점유 종속을 조용히 빼고 사슬은 그대로**, Studio 점유 검사(`collectOccupiedRbeNodes`)도 종속만 본다
  → 사슬 모양 RBE 가 **C# 경로=사슬, bridge 경로=병합** 으로 갈린다(편집 정합성 계약 위반, 미수정).
- 무게중심 RBE(`connectRigidCentroid`)는 RBE 멤버(독립+종속)를 전부 빼서(`collectRbeMemberNodes`) 위 모델에서 고른 노드 절반 이상이 빠진다.
- **추가 실측 (같은 날 FE 평가)**: RBE2 종속 노드를 **RBE3 독립 노드로 쓰는 것은 정상**(RBE3 종속은 COG 하나라 중복 없음). RBE3 독립 2점은 특이(FATAL 2038) —
  한 직선 위에 있지 않은 3점 이상 필요. 같은 1 t 질량에서 RBE2 스파이더는 연결점 사이 보를 강체로 만들어 처짐이 RBE3 대비 약 41% 작았다(연결점 하나 다름, 경향 비교).
  3529 U-bolt 111개 중 15개가 cm=123456 인데 공유 병합 흔적 0 — 의도(BOX 등) 미확인.
- **다음 작업(사용자 확인 대기)** — 방향을 바꿨다: 무게중심 RBE 에 **RBE2(단단한 장비) / RBE3(질량 분배) 선택지**를 두는 것이 1순위
  (강성 왜곡과 'RBE 에 걸린 노드에 묶기 어려움'을 함께 해결, Studio·C#·bridge·계약 테스트 동시 수정, 새 intent 또는 addRigid 확장).
  RBE2 를 고를 때만 cm=123456 RBE **흡수**(deleteRigid + 합친 종속, 같은 batchId, U-bolt 제외), 일반 연결의 사슬도 흡수로 맞춰 C#/bridge 어긋남 해소.
  그다음 구조 CSV `weld`·`stru` 칸이 실제 연결 근거인지 조사(근거 없는 근접 연결 = '추정 연결' 표시), 대표 모델 cm 123456 ↔ 123 민감도 해석.
  검증: 계약 테스트 + 실제 Nastran. 시험 BDF 는 세션 스크래치패드에만 있었다(필요하면 다시 작성).
- **다른 Studio 로 넓힐지 검토 (2026-10-28)** — 10-27 MB 기능(CSV 탭·제외 행 상자·끊긴 배관·COG 경고·deleteRigid removeMass)은
  "입력 = CSV + 엔진 행별 변환 감사" 전제라 **MB 전용으로 둔다**(MU·SP 는 BDF 입력, Plate 는 직접 모델링, Mooring 은 행↔요소 대응이 없고 DIAGNOSIS.json 이 빠진 행을 알림).
  후보 2가지만 남겼다: ① MU·SP Model Check 에 'RBE 독립–종속 거리 > 5 m' 기하 경고(MB 가 만든 잘못된 장비 RBE 가 BDF 로 넘어오는 경우, 삭제 intent 없이 경고만)
  ② RBE 공유 규칙·무게중심 RBE2/RBE3 는 **MB 에서 확정한 뒤** MU·SP 로 이식(중복 방지 `collectDependentNodes` 가 MU=SP, MB 는 이미 갈라짐).
  MU·SP 의 `InputAuditPanel`·`AuditTab`(MB 사본)은 BDF 입력에서 늘 비어 정리 후보. Studio 목록은 메모리 `reference_all_studios`.
- 공유 설명 페이지(비공개, Share 필요): FE 평가 https://claude.ai/artifact/81RNFK7nSMSaSSy1eEBbYG ·
  'RBE 로 잇는 이유'(문의 응대용, 3529 간격 67~114 mm vs 부재 길이 중앙 378 mm) https://claude.ai/artifact/AKo9Y5qkwqWx6fzRbtH1QD
- **새로 받은 문제(미착수)**: 앵글(L) 부재가 다리 방향이 뒤집혀 보이는 경우를 바르게 표시. 확인할 것 = 화면이 Patran 등에서 연 BDF 인지(그러면 BDF 방향 벡터 문제 → 엔진),
  모델·부재 name. 구조 CSV `ori` ↔ 엔진 `BeamOrientation.Resolve`(평행일 때만 기본 규칙) ↔ BDF v 벡터 비교로 원인을 가른다.

**Aveva Marine 연동 독립 클라이언트 (2026-10-30 구현, 145 반영 — 접수·전체 흐름 통과, Studio 안 편집·해석·저장 클릭 시험 남음)** — AM 버튼 → `HiTessMB.exe` → 서버 빌드 → 실행기 → Studio 까지 한 번에(실측 약 20초).
145 의 실행기 zip = 145 로컬 `StudioProgram\mb-launcher-<ver>.zip`(릴리스 표에 없음 → 최고 버전 — ⚠ `scripts/studio_release.py --all` 이 UNC 의 mb-launcher 를 표에 넣으려 한다(2026-11-06, 세 번 되돌림). `/wb-release` 때 그 줄은 빼고 커밋할 것, 145 = 0.1.1(WorkBench 아이콘·smoke 분리, 2026-10-30 사용자 반영·아이콘 확인), 복사는 사용자).
실행기 버전을 올리면 설치된 PC 도 다음 실행 때 새로 받는다. ⚠ `--smoke` 는 데이터 폴더(`MBLauncher\smoke-data`)·단일 인스턴스 잠금을 따로 쓴다 — 같은 잠금이면 smoke 종료가 사용자 Studio 창을 닫는다(2026-10-30 실제로 일어남). 70 로컬 zip 은 DRM 암호문이라 그대로 복사하면 깨진다 — 새 버전은 `AmLauncher\build.ps1 -OutDir <UNC>` 후 `verify-studio-zips.ps1 -ViewerId mb-launcher`.
계획서 `docs/plans/2026-10-28-aveva-marine-model-builder-client.md`(배경·결정표 D1~D6) · **구현 `docs/plans/2026-10-30-am-client-implementation-plan.md`(이것이 우선, 진행 상태 표)**.
구성 3개 — WorkBench 와 완전 별개(사용자 PC 에 WorkBench 불필요):
- 클라이언트 `C:\Coding\WorkBenchSubModule\HiTessMBClient\`(.NET 4.8, 별도 git) — 접수 후 실행기를 받아 띄우고 끝. 종료 코드 0·2~8(README).
- 서버 `app/routers/am_intake.py` `POST /api/am/submissions` — CSV 검사(sha256·인코딩·종류·행 수, DRM 검사 없음 — CSV 는 DRM 대상 아님) 통과 시 `task_execute_modelflow(program_name="AmToModelBuilder")` 로 빌드하고 `job_id` 반환.
  **AM 호출 1번 = analysis 기록 1건**(program_name·source `AmToModelBuilder`, 검사 실패는 Failed 1건) — 이중 집계 금지. 폴더 `<ts>_<사번>_AmToModelBuilder`. 같은 파일의 `GET /signup` = 미가입 사번 가입 페이지(`app/static/signup/signup.html`, 선택지는 RegisterModal 사본 — 테스트가 잡음).
- 실행기 `AmLauncher/`(Electron 40, viewer id `mb-launcher`, `build.ps1` → `StudioProgram\mb-launcher-<ver>.zip`) — WorkBench electron 코드 **사본**(원본 위치 주석, 공용 모듈화는 별도 작업). ⚠ `--server=URL` 처럼 `=` 로 붙여 넘길 것(Electron 이 URL 모양 인자 뒤 인자가 있으면 실행하지 않음) · 이름을 바꾼 exe 는 사내 보안 때문에 `no-sandbox` 로 띄운다(외부 페이지 이동·새 창 차단).
확정: 보고서는 2차(1차 = 모델 확인·편집·해석·결과·편집 BDF 저장).
확정(같은 날): 대상은 WorkBench 를 안 쓰는 AM 사용자라 **별도 클라이언트**(WorkBench 명령줄 모드 아님), AM 으로 돌려보내는 정보 없음(단방향).
호출 규약 `HiTessMB.exe <사번> --hull-no <호선> --stru <CSV> [--pipe] [--equip]` — 호선 필수·선종 없음·사번 형식 `^[A-Z]\d{5,7}$`.
미가입 사번(로그인 404)은 **웹 가입 페이지**(`<서버>/signup`, 기존 `POST /api/register` 사용, 관리자 승인 유지)를 자동으로 연다.
AM 개발팀 전달본 = UNC `[개인 자료]\권혁민 책임연구원\UnLock\HiTESS_ModelBuilder_AM연동_요청.docx`(같은 폴더 PDF 는 옛 내용).
Studio 는 `window.workbenchAPI` 만 보므로 클라이언트가 같은 API 를 주면 Studio 무수정 — 단 `finalizeEditedModel` 은 지금 `HiTessModelBuilder.jsx` 에 묶여 있어 이식 필요.

**입력 CSV 보관 (2026-11-12, `7b7c3db`)** — 작업 폴더는 30일 뒤 지워지므로 MB 입력 CSV 를 `HiTessWorkBenchBackEnd/DataStorage/ModelBuilderCsv/<호선>/` 에 모은다(git·30일 정리 대상 아님, `MB_CSV_ARCHIVE_DIR` 로 변경).
`app/services/mb_csv_archive.py` — 내용(sha256)이 같으면 한 번만 저장, 같은 이름·다른 내용은 `<이름>__<sha256 앞 8자리>.csv` 로 따로 저장(2026-11-23 사용자 결정 — 11-12 의 '먼저 본 것 하나만'은 고쳐 다시 올린 판을 버렸다. 그 시기 manifest 의 `stored_path` 빈 줄은 수집 스크립트를 다시 돌리면 원본이 남아 있는 것만 되살아남), `manifest.csv` 에 본 자리마다 한 줄(원래 폴더·사번·실행 시각·종류), DRM 암호문은 건너뜀.
새 실행 = `task_execute_modelflow` 첫머리(MB·AM 연동 공통, 실패해도 모델 생성 계속) · 이미 쌓인 것 = `scripts/collect_mb_csv.py [--dry-run]`(다시 돌려도 안전). 끄기 `MB_CSV_ARCHIVE=0`(테스트 conftest 가 끔). 시험 `tests/test_mb_csv_archive.py`.
70 실측: 작업 폴더 30개 CSV 81개 → 내용 9개. 같은 파일명 규칙 = `a21574f`.
145 반영·첫 수집 완료(2026-11-12, dry-run 683개 → 실제 실행 사용자 확인). 이후는 자동 보관이라 스크립트는 1회용(재시작 안 한 동안 빠진 것·보관 폴더 재구성 때만 다시).
남은 확인: 145 보관 사본이 DRM 에 감싸지지 않았는지(메모장으로 열어 보기) · 145 실제 저장 건수.

**호선 주석 (2026-10-20)** — Model Builder BDF **첫 줄**에 `$ HiTessModelBuilder: HullNo=3454` 를 남긴다(해석 무관).
권상(GMU)에 올라온 BDF 를 LogBook 으로 보낼 때 호선을 알아내는 통로다. 입력은 **선택**: Model Builder 옵션의 '호선' 칸 →
비우면 CSV 파일명 앞 4자리(`^\d{4}` 뒤에 `-`/`_`, `5PPP_-…` 같은 예외는 제안 없음) → 둘 다 없으면 주석 없음.
**실행 전 호선 확인 창 (2026-11-06, 1.7.7)** — Model Builder(칸·CSV 파일명)와 GMU 권상(BDF 호선 주석·파일명)에서 호선을 못 찾으면 실행·검증 버튼(Ctrl+Enter·대시보드 자동 실행 포함) 때
`HullPromptDialog` 가 한 번 묻는다 — 창에서 적고 진행 / '호선 없이 진행'(막지 않음, 같은 입력이면 다시 안 물음). 규칙·문구 `utils/hullNo.js`(`needsHullPrompt`·`readHullNoFromBdfText`).
GMU 검증 라우트 2개가 `hull_no` Form 을 받아 `input_info.hull_no_source = user` 로 남기고 재실행·deck-fix·다시 검증·결과 다시 열기·최근 입력에서 이어받는다. 다른 App 에서 넘어온 서버 BDF 는 묻지 않는다.
서버 호선 주석 읽기는 대소문자 무시(화면과 같게). ⚠ 서버를 먼저 반영할 것 — 옛 서버는 화면이 보낸 호선을 조용히 버린다.
- 경로: 프론트 `hull_no` → `task_execute_modelflow`(`input_info.hull_no`/`hull_no_source`=user|filename) → `Cmb.Cli build-full --hull-no`
  → BDF 주석 + JSON `meta.hullNo` → `apply-edit-intent`·bridge `lift-run`(Wire BDF)이 다시 쓴다.
  GMU 검증은 `hull_no.resolve_bdf_hull_no`(주석 → 파일명)로 `input_info.hull_no`/`hull_no_source`=comment|filename 을 남긴다.
- 정규화 규칙(대문자, 영문·숫자·`-`·`_` 20자)은 C# `FeModel.NormalizeHullNo` · bridge `normalize_hull_no` · `app/services/hull_no.py` ·
  프론트 `utils/hullNo.js` 가 같아야 한다.
- ⚠ 옛 `Cmb.Cli.exe` 는 `--hull-no` 를 모르면 인자 오류로 실패한다 → 백엔드는 `engine_supports_hull_no()`(`--help` 확인, exe mtime 캐시)로
  지원할 때만 넘긴다. 그래서 서버에서 백엔드·엔진 반영 순서가 바뀌어도 깨지지 않는다(엔진 교체 전에는 경고만 로그에 남음).
- 계약 테스트 `test_engine_keeps_hull_no` 가 편집 BDF 첫 줄 주석을 확인한다(호선 이전 엔진이면 skip).
- 배포 상태: 백엔드와 프론트는 v1.6.20 부터. 70 InHouse `Cmb.Cli.exe`(2026-10-29 판)는 `build-full --hull-no` 를 알고 `nastran_bridge.py` 에도 `normalize_hull_no` 가 있다(2026-11-13 확인). 145 는 10-29 에 같은 판으로 교체했다는 기록만 있고 직접 확인은 안 함.
  권상 Wire 포함 BDF(lift-run)의 호선 주석은 단위 테스트만 했고 실제 권상 해석으로는 확인 안 함.

**⚠️ 교정/함정 (이번 재검토에서 발견)**
- **편집 BDF 포맷 fix 의 적용 범위**: `nastran_bridge.py` 의 BDF 포맷 수정은 ModelBuilder 편집에 **효력이 없다**(MB 편집 BDF writer 는 C# `Cmb.Cli.exe` 하나, 2026-10-29 fallback 제거). MB 편집 BDF 가 깨지면 C# 엔진을 고친다. Mooring/SidePassage 스튜디오의 apply-edit 는 `analysis.py` 가 nastran_bridge 를 **기본 경로로** 직접 호출 → 그쪽 BDF 는 Python fix 로 완결.

**그룹 일괄 삭제 (MB 0.1.14, 2026-11-19, 커밋 `a2c2a77`, 릴리스 표 0.1.14 `c39b8aa` — 0.1.13 Review 탭과 함께, 145 InHouse `Cmb.Cli.exe` 11-17 판 교체 뒤)** — MU 0.0.224 의 같은 기능을 `/studio-sync` 로 옮겼다(싱크 대장 48).
Edit › 그룹 줄 왼쪽 체크박스, [전체 선택](본 구조 제외), [선택 해제], [선택한 N개 그룹 삭제](앱 안 확인 창). 지우기는 원래 있던 스토어 `deleteGroups` 한 번 = 같은 batchId(Ctrl+Z 한 번)이고,
그 그룹 노드를 쓰던 추가 RBE 와 부재도 예전처럼 함께 정리한다. RBE 병합 미리보기 줄은 원본 그룹 여러 개를 한 번에 지운다(`data/groupBulkDelete.js`, MU 판과 내용이 달라 `same` 아님).
확인: 시험 686 · lint(바꾸기 전과 같은 경고 2건) · 빌드 · 헤드리스(샘플 3454 그룹 9개 — 8/9 선택, 확인 창, 같은 batchId 8건, Ctrl+Z 한 번에 0). WorkBench 앱 안은 확인 안 함.

**짝 싱크로 받은 것 (MB 0.1.15, 2026-11-19, 커밋 `a2c2a77`, 릴리스 표 0.1.15 `1e2405e`, 안내 `/updates/2026-11-19-mb-group-bulk-mass-info`)** — 대장 22번(질량을 '정보' 탭에 바로: '표시' 를 보던 중이라도 질량점이나 질량 걸린 노드를 고르면 '정보' 로, 질량 추가나 값 수정 뒤 첫 질량을 골라 '정보' 탭)과
51번([보기]·찾기 화면 이동이 아래 작업 패널을 비켜 대상을 놓음, `three/viewportGeometry.js` `focusEntity` 직교 갈래). `data/infoDockFocus.js` 는 MU 와 `same`.
확인: 시험 689 · lint(예전 경고 2건) · 빌드 · 헤드리스(샘플 3454 — 표시 → 정보, 질량 없는 노드는 표시 그대로, 부재 삭제 패널 연 채 화면 이동 시 대상이 패널 오른쪽 빈 곳). WorkBench 앱 안은 확인 안 함.
