# 이중관 PSA — 선택 Load Case 해석 (기본 All) 설계

- 작성일: 2026-07-15
- 대상 기능: 이중관 구조 연료배관 해석의 Stress Analysis(전체 Load Case 해석)에서
  사용자가 총 29개 Load Case 중 **특정 LC만 선택**해 해석할 수 있게 한다. 기본값은 **All(전체)**.
- 별도 탭을 추가하지 않고 기존 "Stress Analysis"(all-load-cases) 탭 안에 통합한다.

## 배경 / 문제

현재 배관응력 해석(PSA)은 `PSA_AllLoadCases.exe <csv>` 를 실행해 **항상 전체 29개 Load Case**
(OPE 16 + SUS 1 + OCC 6 + EXP 6)를 해석한다. Abaqus 반복 해석까지 최대 1시간이 걸릴 수 있어,
관심 있는 소수 LC만 빠르게 재검토하려는 요구가 있다.

`InHouseProgram/DoublePipe/`에는 이미 두 폴더가 있다.

- `Piping Stress Analysis for all load cases/` — 백엔드가 실제 실행하는 정본. `PSA_AllLoadCases.exe`
  (106MB, scipy·pyNastran·numpy·openpyxl 번들)와 소스가 있으며 **항상 전체**를 돈다.
- `Piping Stress Analyiss for selected load cases/` — 부분 LC 선택을 지원하는 **완성된 소스**.
  `Main.py` 가 CLI 로 LC 토큰을 받아(예: `L18 L20`) 선택분만 solve 하고, L17(SUS)은 항상 자동 포함한다.
  `FuelLine_PSA_Report.py`(결과 전 셀 clear 후 존재하는 결과만 채움)와
  `FuelLine_F06Format.py`(없는 파일 skip)가 **부분·전체 모두** 올바르게 동작한다. exe 는 없다.

즉 "selected" 소스가 기능적으로 "all"의 상위집합이다. 유일한 공백은 **인자 없이 실행 시 기본이
대화형 프롬프트**라는 점(백엔드/기본값 All 관점에서 부적합).

## 확정된 결정 (사용자 승인)

1. **엔진 구조**: 단일 엔진으로 통합. "selected" 소스를 "all load cases" 폴더로 가져와 통합하고
   `--load-cases`(미지정=전체) 인자를 추가해 단일 `PSA_AllLoadCases.exe` 로 재빌드. 백엔드 경로/exe 이름 유지.
2. **exe 재빌드**: 코드는 Claude 가 전부 수정(엔진·백엔드·프론트). exe 재빌드는 사용자가 기존 검증된
   빌드 방식으로 직접 수행(.spec 부재로 hidden import 누락 위험이 있어 blind 재빌드 회피).
3. **프론트 UI**: 기존 Stress Analysis 탭 안, All 토글 + 개별 체크박스(L1~L29, 카테고리 그룹, L17 잠금).

## 아키텍처

```
[Frontend] all-load-cases 탭: All/선택 토글 + LC 체크박스
   │  load_cases (선택 시 배열, All 이면 생략)
   ▼
[Backend] POST /run-psa | /run-psa-upload  → 검증·정규화(L<n>) → _launch_job
   │  command = [exe, csv] (+ ["--load-cases", "L18,L20,..."] 선택 시)
   ▼
[Engine] PSA_AllLoadCases.exe <csv> [--load-cases ...]
   │  --load-cases 없음 → 전체 29 / 있음 → 그 LC + L17 자동
   ▼  선택분만 Abaqus solve → ASME B31.3 → Report/F06 (부분/전체 모두 정합)
```

## ① 엔진 (Python) — "all load cases" 폴더를 정본으로 통합

"all load cases" 폴더의 3파일을 통합본으로 교체한다.

- **`Main.py`** (재작성): selected 의 선택 로직 + all 의 백엔드 실행 규약을 합친다.
  - CLI: `PSA_AllLoadCases.exe <csv> [--load-cases L18,L20,...]`
    - positional `csv` (선택; 생략 시 실행 폴더 최신 CSV 자동 — 기존 all 동작 유지)
    - `--load-cases` (선택; `nargs='*'`, 콤마/공백 혼용 허용). **미지정 → `requested=None` → 전체 29**.
      지정 → `_parse_cases()` 로 파싱 후 **L17 자동 포함**.
  - `run_pipeline(csv_path, requested)`: `requested is None` 이면 sel = 전체 인덱스, 아니면
    `_select(INP_1st.LC_name, requested)`. 모델 생성은 **항상 29개 inp 전부 생성**(부분이라도 참조 정합
    유지) 후 선택분만 solve/friction/ASME. all 케이스는 sel=전체라 기존과 동일하게 동작.
  - ⚠️ **selected 의 `os.chdir(_app_dir())`(frozen 시 exe 폴더로 이동) 로직은 제거**한다. 백엔드는
    `cwd=job_dir`(CSV 폴더)를 설정해 산출물(Report/txt)이 그 폴더에 모이도록 한다. chdir 하면 동시
    실행 산출물 충돌 + `make_report()` 파일 못 찾음(빈 보고서)이 재발한다. all 방식(chdir 안 함,
    넘어온 절대 csv 경로 사용)을 유지.
  - selected 의 대화형 프롬프트(`_prompt_csv`, interactive `input()`)는 **제외**한다. 백엔드는 항상
    csv 를 positional 로 넘기므로 프롬프트가 필요 없고, CREATE_NO_WINDOW 자식에서 `input()` 이 hang
    될 위험을 없앤다. 인자 없는 직접 실행은 "최신 CSV 자동 선택"으로 폴백.
- **`FuelLine_PSA_Report.py`** ← selected 버전으로 교체. `_clear_all_results()` 로 전 결과 셀을 비운 뒤
  결과 txt 가 존재하는 LC 만 고정 행(`44 + StressFile.index`)에 채운다 → 부분·전체 모두 행 정합.
  DRM 호환(원본 xlsx 제자리 로드, BadZipFile 폴백)도 포함.
- **`FuelLine_F06Format.py`** ← selected 버전으로 교체. displacement/stress 파일이 없으면 skip(부분 안전).

Head_for_FuelLine_ASME_B313_v2018.py 가 `make_report`←FuelLine_PSA_Report,
`F06Format`←FuelLine_F06Format 를 import 하므로 위 두 파일 교체가 그대로 반영된다(별도 수정 불요).

## ② 백엔드 (git 추적 — 서버 145 는 `git pull`+재시작으로 반영)

`app/routers/doublepipe.py`
- `RunPsaRequest` 에 `load_cases: list[str] | None = None` 추가.
- `run_psa_upload` 에 `load_cases: str = Form("")` 추가(멀티파트는 콤마 문자열로 수신).

`app/services/doublepipe_psa_service.py`
- `_normalize_load_cases(raw) -> list[str] | None`: 토큰을 `^L?\d{1,2}$` + 1~29 로 검증·정규화(`L<n>`),
  중복 제거. 빈/None → None(전체). 잘못된 토큰은 400. (엔진도 재검증하지만 서버측 defense-in-depth.)
- `start_psa_job(work_dir, result_csv, employee_id, load_cases)` /
  `start_psa_job_from_upload(csv_bytes, csv_name, employee_id, load_cases)` — load_cases 전달.
- `_launch_job(csv_path, employee_id, load_cases)`:
  `command = [exe, csv] + (["--load-cases", ",".join(lcs)] if lcs else [])`.
  job dict 에 `loadCases`(선택 LC 또는 None) 기록(상태/로그 표시용, get_psa_job 에 노출).

## ③ 프론트 (git 추적 — 재배포) — 별도 탭 없음

`pages/analysis/DoublePipeFuelLineAssessment.jsx` — 기존 "all-load-cases" 탭의 "해석 Load Case" 카드 개편.
- 상태: `lcMode`('all' | 'select', 기본 'all'), `selectedLcs`(Set<string>, 선택 모드에서 사용).
- 카드 헤더에 **All / 선택 토글**.
  - All 모드: 현재 카테고리 요약(읽기 전용) 유지 + 전체 29 배지.
  - 선택 모드: L1~L29 를 CASE_CATS(OPE/SUS/OCC/EXP) 그룹별 개별 체크박스. **L17 은 항상 체크 +
    disabled(선행 배지/자물쇠)**. 그룹별 전체선택/해제 보조 버튼.
- 실행 버튼 라벨: All → `전체 Load Case 해석 실행 (29)`, 선택 → `선택 Load Case 해석 실행 (N)`
  (N = L17 포함 선택 수). 선택 모드에서 L17 외 0개면 버튼 비활성 + 안내.
- `handleRunPsa`: All 이면 `load_cases` 생략. 선택이면 선택 id 배열을 전송 —
  `run-psa`(JSON body `load_cases`), `run-psa-upload`(FormData `load_cases`=콤마 문자열) 양쪽.
  addLog/토스트 문구를 선택 수에 맞게.
- 진행/락/전역 위젯 등 기존 PSA UX 는 변경 없음(load_cases 는 실행 요청에만 영향).

## 엣지 케이스

- **선택 0개(L17만)**: 선택 모드에서 L17 외 아무것도 안 고르면 실행 비활성(엔진 `_parse_cases` 도 빈
  입력을 에러 처리). L17 은 자동 포함이라 "선택 카운트"에서 제외해 최소 1개 강제.
- **잘못된 토큰**: 서버 검증에서 400. 프론트는 정의된 L1~L29 만 보내므로 정상 경로에선 발생 안 함.
- **All 과 전체 선택의 동치**: 사용자가 선택 모드에서 29개를 모두 체크 → load_cases 29개 전송. 엔진은
  전체와 동일 결과. (굳이 All 로 접지 않아도 정상. UX 상 All 토글이 더 간단.)
- **부분 결과 보고서**: 선택분만 채워지고 나머지 LC 시트/Summary 행은 공백(selected report 로직).

## 배포 (CLAUDE.md 규칙 — 커밋 시 필수 고지)

- **엔진(InHouseProgram, git 미추적)**: 사용자가 통합 소스로 `PSA_AllLoadCases.exe` 재빌드 후 **서버 145
  의 `HiTessWorkBenchBackEnd/InHouseProgram/DoublePipe/Piping Stress Analysis for all load cases/` 에
  수동 교체 + 백엔드 재시작** 필요. `git pull` 로는 절대 반영 안 됨.
- **백엔드/프론트(git 추적)**: `git pull` + 백엔드 재시작 + 프론트 재배포.
- "Piping Stress Analyiss for selected load cases/" 폴더는 정본 통합 후 **잉여**. 삭제하지 않고 남기되
  통합됨을 인지(버전 드리프트 방지 위해 이후 수정은 "all load cases" 정본에서만).

## 검증

- 엔진: 통합 `Main.py` `py_compile`. (Abaqus 없는 dev 에선 full solve 불가 — 인자 파싱/분기 단위 확인.)
- 백엔드: `py_compile` + import.
- 프론트: `npm run build` 성공.
