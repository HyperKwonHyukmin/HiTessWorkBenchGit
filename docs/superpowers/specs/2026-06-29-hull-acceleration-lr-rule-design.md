# 선급 Rule 기반 선체 가속도 — LR(Lloyd's Register) Rule 추가/교정 설계

- 작성일: 2026-06-29
- 대상 앱: WorkBench "선급 Rule 기반 선체 가속도 Calculation" (HullAcceleration)
- 참조 원천(Oracle): `C:\Coding\WorkBenchSubModule\TS\Data\3441_Rule_acceleration_at_any_points_AddLR.xlsx` 의 `LR` 시트
- 선행 스펙: `docs/superpowers/specs/2026-06-23-hull-acceleration-rule-calculation-design.md`

## 1. 배경 / 문제

선체 가속도 앱은 5개 선급 Rule(DNVGL, BV, IGC, CSR, LR)로 조건별 가속도를 계산하고
방향별(X/Y/Z) Envelope·Rule별 비교표를 보여준다. 그러나 **LR 은 계산값이 부정확하여 결과에서 제외**되어 있다:

- 엔진: `ts_rules/__init__.py` 의 `RULE_KEYS = ["dnvgl","csr","igc","bv"]` (lr 누락 + 제외 주석).
- 프론트: `HullAccelerationPage.jsx:420` 의 `ruleRows = Object.values(rules).filter((rule) => rule.key !== 'lr')` 방어적 숨김.

사용자는 AddLR 엑셀의 LR 시트(Machinery on deck, LR 2019 JULY)를 기준으로 **LR 계산 결과를 다시 산출·표시**하기를 원한다.

## 2. 근본 원인 (정량 확정)

`ts_rules/lr.py` 의 조건별 수식 체인은 AddLR `LR` 시트와 **한 줄을 제외하고 1:1 일치**한다.

| 항목 | AddLR LR 시트 | 현재 `lr.py` | 판정 |
|------|---------------|--------------|------|
| LCG rule (row 31 / line 25) | `HLOOKUP(General,15)[=LCG] + LBP/2 - (LBP-L)` | `c.mtc + lbp/2 - (lbp-L)` | ❌ `mtc` 오용 |
| 그 외 a0/aheave/apitch/asway/ayaw/arollz/arolly/A/ax/ay/az | — | — | ✅ 동일 |

근거(조건 3 기준): Excel `G31 = 137.6`. 역산 `137.6 - LBP/2(140.65) = -3.05`.
fixture 의 condition 3 은 `lcg = -3.05`, `mtc = 1715.41` → **`-3.05` 는 `lcg` 와 정확히 일치**, mtc 아님.

버그의 지문은 기존 fixture `rule_expected_summary["lr"]` 에 그대로 남아 있다:

| 축 | 기존 fixture(버그) | AddLR LR 시트(정답) |
|----|--------------------|---------------------|
| x (ax) | 0.8985 / LC4 | 0.8985 / LC4 (ax 는 lcg 무관 → 멀쩡) |
| y (ay) | 17.399 / LC37 | **7.4715 / LC4** (ayaw 가 lcg 사용 → 폭발) |
| z (az) | 47.344 / LC37 | **2.1058 / LC4** (apitch 가 lcg 사용 → 폭발) |

→ 수정의 핵심은 `lr.py:25` 의 **`c.mtc` → `c.lcg`** 한 글자. ax 만 정상이고 ay/az 만 틀린 패턴이 이 진단을 그대로 뒷받침한다.

## 3. 결정 사항

- **검증 오라클 갱신 방식**: AddLR 엑셀에서 Excel COM 으로 재추출 (`extract_rule_expected.py` 활용). 회사 DRM 때문에 openpyxl 직접 로드 불가 → COM(화이트리스트) 경로 유지.
- **LR 표시 라벨**: `"LR"` 그대로 (탭/헤더 모두). 메타정보 풍성화는 하지 않음(YAGNI).
- **Envelope 참여**: LR 을 `RULE_KEYS` 에 넣으면 `build_envelope` 랭킹에 자동 포함된다. LR 값(x0.90/y7.47/z2.11)은 5개 중 모두 최소 → **Envelope 최대값 자체는 불변**, 비교표/랭킹에만 LR 행이 추가된다. 의도와 일치하므로 그대로 둔다.

## 4. 검증 타깃 (AddLR `LR` 시트 캐시값)

per-condition: 행 44(ax)/45(ay)/46(az), 조건 3~40(열 G~AR, 38개). 발췌:

| LC | ax [m/s²] | ay [m/s²] | az [m/s²] |
|----|-----------|-----------|-----------|
| 3 (G) | 0.8865496421 | 6.8384152276 | 2.0736274390 |
| 4 (H) | 0.8985018282 | 7.4715499387 | 2.1058128445 |
| 5 (I) | 0.8858794036 | 6.7746914193 | 2.0677365405 |

summary (LR 시트 `I15:N18`):

| 축 | char | max [m/s²] | max [g] | Max.LC |
|----|------|-----------|---------|--------|
| x | ax | 0.8985018281570468 | 0.09159040042375605 | 4 |
| y | ay | 7.4715499386899324 | 0.7616258856972408 | 4 |
| z | az | 2.105812844531739 | 0.2146598210531844 | 4 |

## 5. 변경 범위 (파일별)

### A. 계산 엔진 — `C:\Coding\WorkBenchSubModule\TS`
1. `ts_rules/lr.py`
   - `lcg_rule = c.mtc + k.lbp / 2 - (k.lbp - L)` → `c.lcg` 로 교정.
   - LABEL = `"LR"` 유지. 그 외 식 변경 없음.
2. `ts_rules/__init__.py`
   - `RULE_KEYS = ["dnvgl", "csr", "igc", "bv", "lr"]` (lr 추가).
   - 라인 68~69 의 "lr 제외" 주석 제거/갱신.
3. `tools/extract_rule_expected.py` (개발 도구)
   - `XLSX` 를 인자/환경변수로 override 가능하게 소폭 확장(`sys.argv[2]` 또는 `TS_RULE_XLSX`), 기본값은 기존 파일 유지. lr 의 SPEC(`("LR", {ax:44,ay:45,az:46}, cond_row=24, c0=7, c1=44)`)은 AddLR 와 그대로 호환되어 변경 불필요.
4. 오라클 갱신
   - `tests/fixtures/expected_lr.json`: AddLR `LR` 시트에서 `extract_rule_expected.py lr` 재추출(조건 3~40 ax/ay/az).
   - `tests/fixtures/ts_3441_fixture.json` 의 `rule_expected_summary["lr"]`: §4 summary 값으로 갱신(x 동일, y/z 교정).

### B. 프론트엔드 — `C:\Coding\WorkBench\HiTessWorkBench\frontend`
5. `src/pages/analysis/HullAccelerationPage.jsx`
   - line 420 `const ruleRows = Object.values(rules).filter((rule) => rule.key !== 'lr');` → `const ruleRows = Object.values(rules);`
   - 관련 주석(146·147·418~420·915)을 LR 포함(DNVGL/CSR/IGC/BV/LR)으로 갱신.
   - 탭 렌더링(918)·상세(975~)는 generic → LR 탭(라벨 "LR") 자동 노출. 추가 변경 없음.
   - `src/utils/hullAcceleration.js` 및 `hullAcceleration.test.js` 는 rule-agnostic → **변경 없음**.

### C. 배포 동기화 — `InHouseProgram/TS`
6. 런타임 사본 갱신: `ts_rules/lr.py`, `ts_rules/__init__.py` 를
   `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\TS\ts_rules\` 로 복사.
   (fixtures/tools 는 테스트 전용 → 런타임 미사용, 동기화 불필요)

## 6. 검증 방법 (TDD)

1. **RED**: 오라클 갱신(expected_lr.json + fixture summary) 후, 수정 전 `lr.py` 로
   `pytest tests/test_rules.py -k lr` 실행 → ay/az 불일치로 FAIL 확인.
2. **GREEN**: `lr.py` `c.mtc → c.lcg` 적용 후 재실행 → LR per-condition(abs_tol 1e-6) + summary(max/lc) PASS.
3. **회귀**: `pytest`(전체) → dnvgl/csr/bv/igc 불변, LR 신규 GREEN 확인.
4. **엔진 통합(스모크)**: 가능 시 3441 PDF 로 `ts_hull_acceleration.py` 실행 → result.json 의 `rules.lr`/`envelope.ranking` 에 LR 포함 확인.

## 7. 배포 / 보고 의무

- `InHouseProgram/TS/ts_rules/*` 는 git 미추적 → **운영 서버(145) 수동 교체 + 백엔드 재시작 필요**. 커밋 보고에 "서버(145)에 수동 교체할 파일: `InHouseProgram/TS/ts_rules/lr.py`, `ts_rules/__init__.py`, 교체 후 백엔드 재시작"을 명시.
- 프론트엔드 변경 + 픽스처/도구 + 테스트는 git 으로 반영(`git pull` 로 서버 코드 반영, 단 InHouseProgram 은 위와 같이 수동).
- DB `result_info` 의 과거 캐시 결과엔 LR 이 없다 → 신규 실행분부터 표시(정상).

## 8. 범위 외 (YAGNI)

- LR LABEL 풍성화, LR 전용 부가 출력(extra), LR 전용 UI 강조.
- 다른 4개 rule 의 재검증/리팩토링.
- `extract_summary_loading_conditions.py` / 조건 추출 로직 변경(이미 lcg 정상 추출 확인).

## 9. 리스크

- **낮음**: 단일 필드 교정 + 오라클 갱신. 회귀 영향은 LR 한 rule 로 국한.
- COM 재추출은 로컬에 Excel 필요(DRM 화이트리스트). 불가 시 §4 의 확정 캐시값으로 직접 기입(폴백).
- Envelope 최대값 불변이 보장되는지 검증 단계에서 재확인(LR 이 최소라 변동 없어야 함).
