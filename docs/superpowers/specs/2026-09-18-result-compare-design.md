# 결과 비교 (최대 6건) — 설계 (Plan F)

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1(공통 규칙) · §2.1(알림 지연 import — 이 plan 은 발신 없음) · **§2.6(이 문서의 담당)** · §2.7(`can_view` 계약, Plan G) · §3(실행 순서 7번, G 선택 의존). 충돌 시 상위 규약이 우선한다.
- 대상: `HiTessWorkBenchBackEnd/`(FastAPI) + `HiTessWorkBench/frontend/`(React). InHouse 프로그램은 건드리지 않는다.
- 구현 plan: `docs/superpowers/plans/2026-09-18-result-compare.md`

## 1. 배경 / 문제

MyProjects 화면(`pages/analysis/MyProjects.jsx`)에는 이미 "Run Compare" 흐름이 있다 — 표의 각 행에
체크박스가 있고(1108~1122행), 상단 버튼(1051~1063행)은 **정확히 2건이 선택돼야만** 열린다.
열리면 `ProjectCompareModal`(581~636행)이 `flattenComparisonData()`(535~570행)로 두 해석의
`input_info`/`result_info` 를 **JSON 을 통째로 평탄화**해서 왼쪽·오른쪽 두 열의 표로 그린다.

이 방식은 세 가지 이유로 좁다.

- **개수가 2로 못 박혀 있다.** "여러 케이스 안 중 가장 나은 것" 을 고르는 실사용 시나리오
  (Mast Post 파이프 후보, Column Buckling 규격 스윕, Group Module Unit 권상 위치 옵션 등)는
  **3~6건을 한 화면에 놓고 컬럼끼리 훑는** 문제라 2건은 부족하다.
- **모든 JSON 키를 다 보여준다.** `result_info` 는 프로그램마다 형태가 달라 수십~수백 필드가
  나오고, 대부분은 파일 경로·내부 통계라 사용자가 필요로 하는 "판정·활용도·최대 응력" 같은
  숫자가 묻힌다. 지금 모달은 노란 강조로 "값이 다른 행"을 표시하지만, **비교 대상 자체가 잡음**
  이라 강조가 의미를 잃는다.
- **비교 가능성이 프론트에 흩어져 있다.** 어떤 필드가 "비교할 만한 값" 인지는 프로그램의 도메인
  지식이다. 그걸 프론트 유틸이 문자열 매칭으로 정할 이유가 없다. 상위 규약 §2.6 이 요구하는
  대로 **`program_registry.ProgramSpec.compare_keys`** 로 선언해서 다른 plan(F 프론트·향후 계산서
  요약·검색 미리보기)이 같은 명세를 재사용할 수 있게 한다.

이 plan 은 2건 모달을 **N≤6 비교 모달**로 교체하고, 프로그램별 비교 키를 레지스트리에 선언하고,
읽기 전용 API 하나(`GET /api/analysis/compare`)로 서버가 값·단위·델타를 정돈해서 내려준다.

## 2. 확정 결정

| # | 결정 | 이유 |
|---|---|---|
| 1 | **비교 대상은 2 ≤ N ≤ 6.** 밖은 API 400 · 프론트 버튼 비활성 | 6열이면 1080px 폭 데스크톱에서 sticky 헤더로 한 화면에 담긴다. 그 이상은 표가 가로 스크롤로만 열리고 실제 사용자가 요청한 폭이 아니다. |
| 2 | **권한은 각 해석마다 `can_view(analysis, user, db)`**(Plan G §2.7 계약). Plan G 이전에는 지연 import 실패로 폴백해서 소유자/관리자만 통과 | 마스터 §3 의 "(선택) 의존" 규약. Plan G 없이도 이 plan 이 단독으로 동작해야 한다. |
| 3 | **비교 키는 `ProgramSpec.compare_keys: tuple[str, ...]`** 로 선언 (dot-path). 미선언 프로그램은 공통 메타(`status`·`duration_ms`·`verdict`·`created_at`)만 노출 | 상위 규약 §2.6. 도메인은 레지스트리 한 곳에서만 산다. 미선언이라도 "비교 자체가 안 된다"가 아니라 "숫자 행이 없다" 로 완만하게 열린다. |
| 4 | **키 형식은 `"dot.path[:label][:unit]"`**. `"summary.maxUtilization:최대 활용도"` · `"summary.maxStress:최대 응력:MPa"` | label·unit 을 별도 자료구조로 늘리면 튜플이 아니게 돼 `frozen=True` dataclass 의 이점이 사라진다. 파싱은 서비스 한 곳(§4.2)만 안다. |
| 5 | **델타는 숫자 값에 대해서만** — 첫 열을 기준으로 절대차 + 상대차(%). 비숫자·`None` 이 하나라도 있는 행은 델타 없이 값만 나열 | 문자열 라벨(예: "합격"/"불합격")에 델타를 계산하면 잘못된 강조가 뜬다. |
| 6 | **단위 불일치는 서버가 감지**해 행 응답에 `"unit_mismatch": true` 를 실어 프론트가 강조. 자동 환산은 하지 않는다 | 자동 환산(MPa↔ksi 등)은 도메인마다 규약이 다르다. 사용자가 알아채도록 표시만 한다. |
| 7 | **프로그램 혼합 허용.** 서로 다른 `program_id` 를 함께 비교할 수 있다. 그 경우 행은 **모든 대상의 `compare_keys` 교집합 + 공통 메타** 만 보인다 | Truss Assessment 3건 + Mooring 1건을 나란히 두는 것도 실사용에서 필요하다("같은 모듈의 여러 사례"). 교집합이라 항상 값이 채워진다. |
| 8 | **`Analysis.model_role`(before/after) 는 UI 프리셋일 뿐** 새 API 를 만들지 않는다 — 프론트가 그 두 건을 미리 체크해 두는 편의 버튼(v1 범위 밖, `MyProjects` 에서만 훅으로 남긴다) | 상위 규약 §2.6. 데이터 계약을 넓히지 않는다. |
| 9 | **응답은 서버가 미리 조립한 표.** `{"programs":[…], "rows":[{"key","label","unit","values":[…],"delta":…}]}`. 프론트는 렌더만 | 도메인 룰·권한 필터가 서버에 남아 있어야 프론트 러너 없는 환경(§1-5)에서도 테스트가 가능하다. |
| 10 | **별도 비교 페이지·라우트 없음.** `CompareModal.jsx` 하나로 끝 | 상위 규약 §2.6 "표/막대". 기존 `ProjectCompareModal` 을 대체하고 새 페이지를 만들지 않는다(마스터 §1-YAGNI). |
| 11 | **`GUARDED_ROUTES` 미등록.** GET·읽기 전용·플랫폼 공통이라 등록 조건 밖 | 상위 규약 §1-8. 게이트는 POST/PUT/PATCH/DELETE 만 검사한다. |
| 12 | **알림 발신 없음, 보관 없음.** 이 plan 은 순수 조회 | 마스터 §2.1 은 지연 import 규약만 따르면 되고, 이 plan 은 `notify` 를 부르지 않는다. |
| 13 | **v1 에 내보내기·저장된 비교 세트 없음** | 사용자 요구는 "지금 이 자리에서 비교" 다. 저장·PDF·차트는 §11. |

## 3. 데이터 모델

### 3.1 `ProgramSpec.compare_keys` (신규 필드, `app/services/program_registry.py`)

```python
@dataclass(frozen=True, slots=True)
class ProgramSpec:
    …
    compare_keys: tuple[str, ...] = ()   # "dot.path[:label][:unit]"
```

- 기본값 `()` — **선언이 없으면 공통 메타만** 비교된다. 등록된 30여 프로그램 중 어느 것도
  깨지지 않고, 필요할 때만 스펙에 한 줄이 늘어난다.
- 초기 등록(plan 이 채운다): `truss-assessment` = `("summary.maxUtilization:최대 활용도",
  "summary.maxStress:최대 응력:MPa", "summary.verdict:판정")` / `mast-post` · `jib-rest` ·
  `column-buckling` = `("summary.allowableLoad:허용 하중:kN", …)` / `mooring-fitting` · `mooring-fitting-solve`
  = `("summary.maxUtilization:최대 활용도", "summary.maxWireTension:최대 와이어 장력:kN")`.
  나머지는 이번 plan 에서 채우지 않는다(YAGNI — 실제 result_info 스키마를 확인한 프로그램만).
- 유일성 검증: `__post_init__` 에 "dot-path 중복 금지" 를 추가(같은 경로가 label 만 다르게 두 번 실리는 사고 방지).

### 3.2 신규 테이블 없음

읽기 전용이라 저장할 것이 없다. `Analysis.result_info` JSON 을 그대로 읽는다.

## 4. 서비스 계약 (`app/services/compare_service.py`, 신규)

### 4.1 진입 함수

```python
def build_compare(db: Session, ids: list[int], user: "str | models.User") -> dict
```

- **입력**
  - `ids` — 2~6 개. 벗어나면 `ValueError("compare requires 2 to 6 ids")`.
  - `user` — 사번 문자열 또는 `models.User`. Plan G 의 `can_view(analysis, user, db)` 를 지연 import,
    없으면 소유자(대소문자 무시) or `is_admin_user(db, user)` 폴백.
- **동작**
  1. `db.query(Analysis).filter(Analysis.id.in_(ids))` — 결과가 요청 수와 다르면 `LookupError("not found")` (라우터가 404).
  2. **각 해석마다** `can_view` 판정. 하나라도 실패면 `PermissionError` (라우터가 403). 부분 필터링(볼 수 있는 것만 반환)은 하지 않는다 — "비교 화면에 이유 없이 열이 사라지는" 것이 더 위험하다.
  3. `resolve_program(a.program_name)` 로 각 대상의 `ProgramSpec` 을 얻는다. 미등록이면 `program_id="unknown"`, `compare_keys=()` 로 취급.
  4. `compare_keys` 를 **모든 대상의 교집합**으로 계산. label·unit 은 **첫 등장 순서** 를 존중(첫 대상의 스펙이 라벨/단위의 원본).
  5. 값 추출 = `_walk(result_info, "summary.maxUtilization")` 같은 dot-path 워커. 배열 인덱스 지원 `"foo.0.bar"`. 없는 경로는 `None`.
  6. 델타 계산 = 모든 값이 `(int|float)` 이고 `None` 이 없을 때만. `delta = {"absolute": [v-v0 …], "relative_pct": […]}`(첫 값 기준). 첫 값이 0 이면 `relative_pct` 는 `None` 리스트.
  7. 단위 불일치 = 프로그램별 스펙에 선언된 단위가 서로 다르면 `unit_mismatch=True`. (동일 program_id 만 오면 항상 False.)
  8. 공통 메타 4행을 **항상** 앞에 붙인다 — `status`, `duration_ms`(밀리초 정수, 없으면 `None`), `verdict`(program_registry `verdict_kind` 가 `none` 이면 스킵), `created_at`(ISO).
- **반환** (§6 응답 스키마와 동일 구조)

### 4.2 부속 함수

```python
def parse_compare_key(spec: str) -> tuple[str, str, str | None]        # (path, label, unit_or_None)
def resolve_common_keys(specs: list[ProgramSpec]) -> list[tuple[str, str, str | None]]
def read_path(payload: Any, path: str) -> Any                          # dot & int-index
def compute_row_delta(values: list[Any]) -> dict | None
```

- 전부 순수 함수(세션 미의존) → `tests/test_compare_service.py` 가 fixture 없이 검증.

### 4.3 알림·발신 훅

**없음.** 이 plan 은 순수 조회다. `notify` 지연 import 도 하지 않는다.

## 5. 발신 훅

**해당 없음** (읽기 전용).

## 6. API (`app/routers/analysis.py` 에 추가, prefix 기존 `/api/analysis` 재사용)

| 메서드·경로 | 요청 | 응답 | 비고 |
|---|---|---|---|
| `GET /api/analysis/compare` | `ids: str`(쉼표 구분, 예 `1,2,3,4,5,6`) | `200 CompareResponse` | 아래 스키마 |

- 파라미터 파싱 = `ids.split(",")` → 정수 · 중복 제거(순서 유지). 개수 0/1 또는 7 이상 → 400.
- 인증 = `require_auth`.
- 오류 매핑: `ValueError` → 400 "비교는 2~6건까지 가능합니다." · `LookupError` → 404 "존재하지 않는 해석입니다." · `PermissionError` → 403 "접근 권한이 없는 해석이 포함돼 있습니다.".
- `main.py` `include_router` 순서는 그대로(기존 analysis 라우터 안에 추가). `GUARDED_ROUTES` 미등록(§2-11).

### 6.1 응답 스키마

```jsonc
{
  "programs": [
    {"id": 101, "program_id": "truss-assessment", "program_name": "Truss Assessment",
     "display_name": "Truss Assessment", "project_name": "3496 Truss A",
     "owner_id": "A476854", "owner_is_me": true, "created_at": "2026-09-10T14:33:22"}
  ],
  "rows": [
    {"key": "meta.status", "label": "상태", "unit": null,
     "values": ["Success", "Success", "Failed"], "delta": null, "unit_mismatch": false, "kind": "meta"},
    {"key": "summary.maxUtilization", "label": "최대 활용도", "unit": null,
     "values": [0.83, 0.91, null], "delta": {"absolute": [0.0, 0.08, null], "relative_pct": [0.0, 9.64, null]},
     "unit_mismatch": false, "kind": "numeric"},
    {"key": "summary.maxStress", "label": "최대 응력", "unit": "MPa",
     "values": [212.4, 235.7, null], "delta": {…}, "unit_mismatch": false, "kind": "numeric"}
  ],
  "warnings": ["A123: 비교 키가 정의되지 않은 프로그램입니다. 공통 메타만 표시합니다."]
}
```

`kind` = `"meta" | "numeric" | "text"`. 프론트 렌더 분기용.

## 7. 프론트 UI

### 7.1 `CompareModal.jsx` (`components/analysis/CompareModal.jsx`, 신규)

- **이전 `ProjectCompareModal`(MyProjects.jsx:581~636)을 대체**한다. `flattenComparisonData`(535~570)와 `ProjectCompareModal` 정의는 이 plan 에서 삭제.
- Props: `{isOpen, onClose, analyses: [{id, project_name, program_name}]}`. 열릴 때 `getAnalysisCompare(ids)`(§7.3) 호출, 결과를 표로.
- 표 레이아웃:
  - 컬럼 `[Field][단위][해석1][해석2][…][Δ]`. 해석 열 헤더 = `project_name` + 작은 사번/App 배지 + `owner_is_me=false` 인 열은 좌상단 "공유" 태그.
  - **sticky 헤더** (`sticky top-0 bg-slate-50`). `Δ` 열은 마지막에 고정, 첫 열 기준 절대차·상대차를 두 줄로.
  - 행 색: `kind==="meta"` 는 회색 하단선, `numeric` 은 값 차가 있으면 `bg-amber-50 text-amber-900`(현행과 톤 유지), 델타 상대차 절대값이 20% 초과면 `bg-rose-50 text-rose-900`.
  - `unit_mismatch=true` 행은 단위 열에 경고 아이콘 + `title="대상 프로그램마다 단위가 달라 값을 그대로 나열합니다"`.
  - `values` 중 `null` 은 `—`.
- 하단 안내: `warnings` 리스트를 회색 박스로 렌더. 예: "공통 비교 키가 없어 공통 메타만 표시합니다."
- 푸터: "닫기" 만. v1 은 내보내기·저장 없음(§2-13).

### 7.2 `MyProjects.jsx` 수정 지점

| 위치 (현행 line) | 변경 |
|---|---|
| 664 `useState([])` | `compareProjects` 는 `[{id, project_name, program_name}]` 로 최대 6건 유지 |
| 729~740 `toggleCompareProject` | `current.length >= 6` 에서 warning 토스트("최대 6건") + `return` |
| 1051~1063 "Run Compare" 버튼 | `disabled={compareProjects.length < 2}` · `title` = "선택한 해석 비교(2~6건)" · 배지 `{n}/6` |
| 1080 `<th>Compare</th>` | 유지 |
| 1108~1122 체크박스 셀 | 유지 (한도만 훅에서 조정) |
| 535~570 `flattenComparisonData` | **삭제** |
| 581~636 `ProjectCompareModal` | **삭제** |
| 1289~1292 사용부 | `<CompareModal isOpen={isCompareOpen} onClose={…} analyses={compareProjects} />` 로 교체 |

### 7.3 API 모듈 (`src/api/analysis.js`)

```js
export function getAnalysisCompare(ids) {
  return api.get('/api/analysis/compare', { params: { ids: ids.join(',') } });
}
```

페이지에서 axios 직접 호출 금지(상위 규약 §1-10).

## 8. 보관

**해당 없음.** 저장하는 데이터가 없다. 프론트도 결과를 캐시하지 않는다(모달을 열 때마다 서버 호출).

## 9. 테스트 전략

백엔드(pytest, `tests/conftest.py` fixture 재사용):

| 파일 | 검증 |
|---|---|
| `tests/test_compare_service.py` | `parse_compare_key` 3가지 형태(path 만 / path+label / path+label+unit) · `read_path` dot·인덱스·누락 · `resolve_common_keys` 교집합 · `compute_row_delta` 숫자·문자열·None 혼재 · `build_compare` : 2건 성공, 6건 성공, 1건·7건 ValueError, 미등록 program(compare_keys 비어도 메타 나옴), 프로그램 혼합 시 교집합, `ProgramSpec.compare_keys` 를 monkeypatch 해 unit_mismatch, verdict_kind='none' 인 프로그램에서 판정 행 스킵 |
| `tests/test_compare_router.py` | `require_auth` 미인증 401 · ids 파싱 400(빈/과다/비정수) · 없는 id 404 · `can_view` 로 막힌 대상 포함 시 403 · Plan G 부재 폴백(관리자·소유자만 200) · 6건 성공 응답 스키마(programs·rows·warnings 키) |

프론트는 러너가 없으므로 plan 에 수동 검증 절차를 쓴다(2건 선택 → 열림 · 7번째 클릭 시 warning · 삭제된 해석 id 로 URL 강제 호출 시 404 토스트 · 프로그램 다른 3건 섞기 · 단위 다른 프로그램 섞을 때 경고 아이콘).

`ProgramSpec.compare_keys` 자체는 dataclass 검증 테스트(`tests/test_program_registry.py` 에 케이스 추가)로 "dot-path 중복 → ValueError" 를 잡는다.

## 10. 서버(145) 반영 구분

- 백엔드: **`git pull` + 백엔드 재시작으로 끝.** 신규 테이블·컬럼 없음(스키마 부트스트랩 변경 없음). 신규 pip 의존성 없음.
- 프론트: **WorkBench 프론트 재배포 필요**(Electron 빌드) — `CompareModal.jsx` 추가·`MyProjects.jsx` 교체.
- InHouse 프로그램 수동 교체: **없음.**

## 11. 비목표

- **PDF/Excel 내보내기** — 요약 표 이미지를 계산서 어댑터에 얹는 논의는 Plan I 범위.
- **저장된 비교 세트** — "이 6건 조합을 이름 붙여 저장" 은 나중.
- **차트 렌더** — 히스토그램·막대는 v1 에 없다. 표만.
- **파일 시스템 diff** — result_info 안의 파일 경로가 다르더라도 그 파일들의 내용을 비교하지 않는다.
- **자동 단위 환산** — MPa↔ksi, kN↔ton 등의 환산은 도메인 규약이 얽혀 있어 이번 범위 밖(§2-6).
- **before/after 자동 선택 API** — `model_role` 기반 자동 짝짓기는 §2-8 대로 UI 프리셋 자리만 남기고 만들지 않는다.
- **알림 발신** — 이 plan 은 조회 전용(§2-12).
