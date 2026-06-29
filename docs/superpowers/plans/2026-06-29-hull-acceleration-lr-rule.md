# 선체 가속도 LR Rule 추가/교정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선체 가속도 앱에서 제외돼 있던 LR(Lloyd's Register) Rule 을 AddLR 엑셀 LR 시트 기준으로 교정·검증해 비교표·Envelope 에 다시 포함한다.

**Architecture:** 엔진의 `lr.py` 조건별 수식은 AddLR LR 시트와 한 줄(`lcg_rule` 의 LCG 소스)만 다르다. `c.mtc → c.lcg` 교정 + `RULE_KEYS` 재등록 + 오라클(AddLR 재추출) 갱신 + 프론트 숨김 해제로 끝난다. 엔진/프론트 모두 rule 을 generic 처리하므로 신규 코드 경로는 없다.

**Tech Stack:** Python 3.14 (pytest 9, pywin32/Excel COM), React + Vite. 선급 Rule 모듈 패키지 `ts_rules`.

---

## 핵심 경로 / 환경

- 엔진 dev 소스(★git 미추적): `C:\Coding\WorkBenchSubModule\TS` (이하 `$TS`)
- 엔진 런타임 사본(★gitignore, 서버 수동): `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\TS\ts_rules`
- 프론트(WorkBench git repo, `feat/hull-accel-lr-rule` 브랜치): `C:\Coding\WorkBench\HiTessWorkBench\frontend`
- Python(둘 다 보유: pytest 9.0.3 + win32com): `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe` (이하 `$PY`)
- AddLR 오라클: `C:\Coding\WorkBenchSubModule\TS\Data\3441_Rule_acceleration_at_any_points_AddLR.xlsx`

## git 토폴로지 주의 (필독)

- `$TS` 와 `InHouseProgram/TS` 는 **git 으로 추적되지 않는다.** 따라서 엔진(`lr.py`, `__init__.py`) 변경은 git 커밋에 안 잡히고, **운영 서버(145) 반영은 `InHouseProgram/TS/ts_rules/` 수동 복사 + 백엔드 재시작이 유일한 경로**다.
- WorkBench repo 의 git 커밋 대상은 **프론트엔드 변경 + 문서(spec/plan)** 뿐.
- 오라클(`expected_lr.json`, `ts_3441_fixture.json`)·도구(`extract_rule_expected.py`)는 `$TS` 안(미추적)에 있어 dev 검증용이며 git 에는 안 올라간다(런타임도 미사용).

## 파일 구조 (생성/수정)

| 파일 | 작업 | 책임 |
|------|------|------|
| `$TS/tools/extract_rule_expected.py` | 수정 | XLSX 경로 인자 override 추가(AddLR 재추출용) |
| `$TS/tests/fixtures/expected_lr.json` | 재생성 | LR 조건별 ax/ay/az 오라클(AddLR) |
| `$TS/tests/fixtures/ts_3441_fixture.json` | 수정 | `rule_expected_summary["lr"]` y/z 교정 |
| `$TS/ts_rules/lr.py` | 수정 | lcg_rule 의 `c.mtc → c.lcg` 교정 |
| `$TS/ts_rules/__init__.py` | 수정 | `RULE_KEYS` 에 `"lr"` 추가 + 주석 갱신 |
| `InHouseProgram/TS/ts_rules/lr.py`,`__init__.py` | 복사 | 런타임 사본 동기화 |
| `HiTessWorkBench/frontend/src/pages/analysis/HullAccelerationPage.jsx` | 수정 | LR 숨김 필터 제거 + 주석 갱신 |

---

## Task 1: LR 오라클을 AddLR 에서 재생성 (RED 준비)

**Files:**
- Modify: `$TS/tools/extract_rule_expected.py:15,50,57,82-83`
- Regenerate: `$TS/tests/fixtures/expected_lr.json`
- Modify: `$TS/tests/fixtures/ts_3441_fixture.json:849-864`

- [ ] **Step 1: 현재 베이스라인 기록**

Run:
```powershell
Set-Location C:\Coding\WorkBenchSubModule\TS
& "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe" -m pytest tests/test_rules.py -k lr -v
```
현재 LR 테스트 상태(통과/실패)를 메모만 한다. 이후 오라클을 AddLR(정답)로 바꾸면 RED 가 보장되므로 결과값 자체는 참고용.

- [ ] **Step 2: 추출 도구에 XLSX override 추가**

`extract_rule_expected.py` 를 다음과 같이 수정한다. (lr 의 SPEC `("LR",{ax:44,ay:45,az:46},24,7,44)` 은 AddLR 와 그대로 호환되어 변경 불필요)

Edit 1 — 상수명 변경 (line 15):
```python
XLSX = str(Path(__file__).resolve().parent.parent / "Data" / "3441_Rule_acceleration_at_any_points.xlsx")
```
→
```python
XLSX_DEFAULT = str(Path(__file__).resolve().parent.parent / "Data" / "3441_Rule_acceleration_at_any_points.xlsx")
```

Edit 2 — 시그니처 + open (line 50, 57):
```python
def extract(rule):
    sheet_name, rows, cond_row, c0, c1 = SPEC[rule]
```
→
```python
def extract(rule, xlsx=None):
    xlsx = xlsx or XLSX_DEFAULT
    sheet_name, rows, cond_row, c0, c1 = SPEC[rule]
```
그리고
```python
        wb = excel.Workbooks.Open(XLSX, 0, True)
```
→
```python
        wb = excel.Workbooks.Open(xlsx, 0, True)
```

Edit 3 — `__main__` (line 82-83):
```python
if __name__ == "__main__":
    extract(sys.argv[1] if len(sys.argv) > 1 else "dnvgl")
```
→
```python
if __name__ == "__main__":
    rule = sys.argv[1] if len(sys.argv) > 1 else "dnvgl"
    xlsx = sys.argv[2] if len(sys.argv) > 2 else None
    extract(rule, xlsx)
```

- [ ] **Step 3: AddLR 에서 expected_lr.json 재추출**

Run:
```powershell
Set-Location C:\Coding\WorkBenchSubModule\TS
& "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe" tools/extract_rule_expected.py lr "C:\Coding\WorkBenchSubModule\TS\Data\3441_Rule_acceleration_at_any_points_AddLR.xlsx"
```
Expected: `wrote ...\tests\fixtures\expected_lr.json n_cond= 38`

검증(헤드 확인) — ax LC4 가 0.8985 근처여야 한다:
```powershell
& "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe" -c "import json; d=json.load(open(r'C:\Coding\WorkBenchSubModule\TS\tests\fixtures\expected_lr.json',encoding='utf-8')); i=d['conditions'].index(4); print('cond4 ax/ay/az=', d['values']['ax'][i], d['values']['ay'][i], d['values']['az'][i])"
```
Expected: `cond4 ax/ay/az= 0.8985018281570468 7.4715499386899324 2.105812844531739`

> **COM 폴백:** Excel COM 이 불가한 환경이면, 위 추출 대신 본 plan 과 동일한 캐시값으로 `expected_lr.json` 을 직접 작성한다 — 38개 조건(3~40)의 ax/ay/az 는 spec `docs/superpowers/specs/2026-06-29-hull-acceleration-lr-rule-design.md` §4 및 LR 시트 덤프(행 44/45/46)에 전수 존재한다. 본 환경에서는 COM 이 검증되어 폴백 불필요.

- [ ] **Step 4: fixture summary 의 lr 항목 교정**

`$TS/tests/fixtures/ts_3441_fixture.json` 의 `rule_expected_summary.lr` 블록을 교체한다.

Old:
```json
    "lr": {
      "x": {
        "max": 0.8985018281570468,
        "g": 0.09159040042375605,
        "lc": 4.0
      },
      "y": {
        "max": 17.398927787144803,
        "g": 1.7735910078638941,
        "lc": 37.0
      },
      "z": {
        "max": 47.34406751953192,
        "g": 4.8261027033162,
        "lc": 37.0
      }
    }
```
New:
```json
    "lr": {
      "x": {
        "max": 0.8985018281570468,
        "g": 0.09159040042375605,
        "lc": 4.0
      },
      "y": {
        "max": 7.4715499386899324,
        "g": 0.7616258856972408,
        "lc": 4.0
      },
      "z": {
        "max": 2.105812844531739,
        "g": 0.2146598210531844,
        "lc": 4.0
      }
    }
```

- [ ] **Step 5: RED 확인 — lr.py 미수정 상태에서 LR 테스트 실패**

Run:
```powershell
Set-Location C:\Coding\WorkBenchSubModule\TS
& "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe" -m pytest tests/test_rules.py -k lr -v
```
Expected: **FAIL** — `test_per_condition[lr...]` 의 ay/az 와 `test_summary_matches_general[lr...]` 의 y/z 가 불일치(현재 `lr.py` 는 `c.mtc` 사용 → ay≈17, az≈47). ax(X) 는 통과. 실패 사유가 ay/az 임을 로그로 확인한다.

(이 Task 는 RED 상태라 커밋하지 않는다 — Task 2 에서 수정과 함께 검증 완료 후 진행)

---

## Task 2: lr.py 교정 + RULE_KEYS 재등록 (GREEN)

**Files:**
- Modify: `$TS/ts_rules/lr.py:25`
- Modify: `$TS/ts_rules/__init__.py:67-70`

- [ ] **Step 1: lr.py 의 두 필드 소스 교정 (LCG + GM)**

> 실행 중 발견: lcg_rule 외에 GM 소스(`c.gom`→`c.gm`)도 교정해야 AddLR 시트와 1e-6 일치. 둘 다 ay/az 지배항에만 영향(ax 무관).

`$TS/ts_rules/lr.py` — lcg_rule:
```python
    lcg_rule = c.mtc + k.lbp / 2 - (k.lbp - L)
```
→
```python
    lcg_rule = c.lcg + k.lbp / 2 - (k.lbp - L)   # LCG(General col15) 사용 (mtc 아님)
```
`$TS/ts_rules/lr.py` — kappa 의 GM 소스:
```python
    GM = c.gom
```
→
```python
    GM = c.gm   # LR 은 자유표면 보정 전 고체 GM(General col16) 사용 (gom 아님)
```

- [ ] **Step 2: GREEN 확인 — LR 테스트 통과**

Run:
```powershell
Set-Location C:\Coding\WorkBenchSubModule\TS
& "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe" -m pytest tests/test_rules.py -k lr -v
```
Expected: **PASS** — LR 조건별(abs_tol 1e-6) + summary(x/y/z max·lc) 모두 통과.

- [ ] **Step 3: RULE_KEYS 에 lr 추가 + 주석 갱신**

`$TS/ts_rules/__init__.py` line 67-70:
```python
# rule 레지스트리 — 모듈을 늦게 import 해 순환참조/부분구현 상태에서도 안전하게 동작.
# NOTE: "lr"(Lloyd's Register)은 현재 계산값이 정확하지 않아 결과(비교표·Envelope)에서 제외한다.
#       lr.py 모듈 자체는 남겨두며, 검증이 끝나면 다시 추가하면 된다.
RULE_KEYS = ["dnvgl", "csr", "igc", "bv"]
```
→
```python
# rule 레지스트리 — 모듈을 늦게 import 해 순환참조/부분구현 상태에서도 안전하게 동작.
# LR(Lloyd's Register)은 lcg_rule 의 LCG 소스 교정(c.mtc→c.lcg) 후 AddLR 엑셀 LR 시트와
# 1e-6 이내로 일치 검증되어 비교표·Envelope 에 다시 포함한다.
RULE_KEYS = ["dnvgl", "csr", "igc", "bv", "lr"]
```

- [ ] **Step 4: 전체 회귀 테스트**

Run:
```powershell
Set-Location C:\Coding\WorkBenchSubModule\TS
& "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe" -m pytest -v
```
Expected: **전부 PASS** — dnvgl/csr/bv/igc 불변, lr 신규 GREEN. 실패 0.

- [ ] **Step 5: (커밋 없음) — 엔진 변경은 git 미추적**

`$TS` 는 git repo 가 아니므로 커밋 단계 없음. 변경 사실은 본 plan/spec(문서, 별도 커밋)으로 추적하고, 실제 반영은 Task 3(InHouse 복사)에서 한다.

---

## Task 3: InHouseProgram 런타임 사본 동기화

**Files:**
- Copy: `$TS/ts_rules/lr.py`, `$TS/ts_rules/__init__.py` → `InHouseProgram/TS/ts_rules/`

- [ ] **Step 1: 두 파일 복사**

Run:
```powershell
Copy-Item "C:\Coding\WorkBenchSubModule\TS\ts_rules\lr.py" "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\TS\ts_rules\lr.py" -Force
Copy-Item "C:\Coding\WorkBenchSubModule\TS\ts_rules\__init__.py" "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\TS\ts_rules\__init__.py" -Force
```

- [ ] **Step 2: 사본 일치 검증(해시)**

Run:
```powershell
$src1="C:\Coding\WorkBenchSubModule\TS\ts_rules\lr.py"; $dst1="C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\TS\ts_rules\lr.py"
$src2="C:\Coding\WorkBenchSubModule\TS\ts_rules\__init__.py"; $dst2="C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\TS\ts_rules\__init__.py"
"lr.py match: " + ((Get-FileHash $src1).Hash -eq (Get-FileHash $dst1).Hash)
"__init__.py match: " + ((Get-FileHash $src2).Hash -eq (Get-FileHash $dst2).Hash)
```
Expected: `lr.py match: True` / `__init__.py match: True`

- [ ] **Step 3: (선택) 엔진 스모크 — 3441 PDF 가 로컬에 있고 실행 가능할 때만**

Run (가능 시):
```powershell
Set-Location C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\TS
& "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe" ts_hull_acceleration.py "C:\Coding\WorkBenchSubModule\TS\Data\PDF\H3441 PROVISIONAL TRIM AND STABILITY BOOKLET.pdf" --out C:\Users\HHI\AppData\Local\Temp\claude\lr_smoke.json --work-dir C:\Users\HHI\AppData\Local\Temp\claude\lr_smoke
```
Expected stdout 에 `X=/Y=/Z=` envelope 라인이 찍히고, 결과 JSON 의 `rules` 에 `lr` 키, `envelope.ranking` 각 축에 LR 항목이 포함됨. (회사 DRM PDF 라 로컬 추출이 막히면 이 단계는 건너뛰고 서버에서 확인)

---

## Task 4: 프론트엔드 — LR 결과 노출

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/HullAccelerationPage.jsx:146,418-420,915`

- [ ] **Step 1: LR 숨김 필터 제거**

line 418-420:
```jsx
  // LR(Lloyd's Register)은 현재 계산값이 부정확하여 결과에서 제외한다.
  // (서버 백엔드 미반영분이나 캐시된 과거 결과에 LR 이 남아있어도 표에 노출되지 않도록 방어)
  const ruleRows = Object.values(rules).filter((rule) => rule.key !== 'lr');
```
→
```jsx
  // 5개 선급 Rule(DNVGL/CSR/IGC/BV/LR) 결과를 모두 표시한다.
  const ruleRows = Object.values(rules);
```

- [ ] **Step 2: 주석 갱신 (탭 키 목록)**

line 146:
```jsx
  // 가속도 최대값 탭: 'envelope'(방향별 최대값) | 선급 key('dnvgl' | 'csr' | 'igc' | 'bv')
```
→
```jsx
  // 가속도 최대값 탭: 'envelope'(방향별 최대값) | 선급 key('dnvgl' | 'csr' | 'igc' | 'bv' | 'lr')
```

- [ ] **Step 3: 주석 갱신 (탭 바 라벨)**

line 915:
```jsx
                        {/* 탭 바: 방향별 최대값(Envelope) + 선급별(DNVGL/CSR/IGC/BV) */}
```
→
```jsx
                        {/* 탭 바: 방향별 최대값(Envelope) + 선급별(DNVGL/CSR/IGC/BV/LR) */}
```

- [ ] **Step 4: 빌드 검증**

Run:
```powershell
Set-Location C:\Coding\WorkBench\HiTessWorkBench\frontend
npm run build
```
Expected: vite build 성공(에러 0). LR 탭은 `r.key.toUpperCase()` 로 "LR" 라벨 자동 생성됨(추가 코드 불필요).

- [ ] **Step 5: 커밋 (WorkBench repo, feat 브랜치)**

```powershell
Set-Location C:\Coding\WorkBench
git add HiTessWorkBench/frontend/src/pages/analysis/HullAccelerationPage.jsx
git commit -m @'
✨ feat: 선체 가속도 LR Rule 결과 표시 활성화

- HullAccelerationPage 의 LR 숨김 필터 제거 → 비교표/탭에 LR 노출
- 엔진 lr.py lcg_rule 교정(c.mtc→c.lcg)으로 LR 값 검증 완료(별도 배포)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```
> ⚠️ `config.js` 는 절대 스테이징하지 않는다(로컬 전용). 위 `git add` 는 jsx 만 명시 추가하므로 안전.

---

## Task 5: 배포/보고 마무리

- [ ] **Step 1: 서버(145) 수동 반영 항목 보고**

커밋 보고에 다음을 **반드시 명시**한다:
- `git pull` 만으로 끝나지 않음. 엔진은 git 미추적.
- 서버 `HiTessWorkBenchBackEnd\InHouseProgram\TS\ts_rules\` 에 **수동 교체**할 파일: `lr.py`, `__init__.py`.
- 교체 후 **백엔드 재시작** 필요.
- 프론트엔드(jsx)는 git 으로 반영(서버 프론트 빌드/배포 절차 따름).
- 과거 DB 캐시 결과엔 LR 없음 → 신규 실행분부터 LR 표시(정상).

---

## Self-Review 결과

- **Spec 커버리지:** spec §5 A1~A4(도구/오라클/lr.py/__init__)=Task1·2, A6(InHouse 동기화)=Task3, B5(프론트)=Task4, C(배포보고)=Task5. 누락 없음.
- **Placeholder:** 없음(모든 Edit 의 old/new 전문 기재, COM 폴백도 구체 데이터 출처 명시).
- **타입/이름 일관성:** `c.lcg`(ts_models.LoadingCondition 필드 존재), `RULE_KEYS` 리스트, `ruleRows` 변수명 일치. 검증 타깃값은 spec §4 와 동일.
