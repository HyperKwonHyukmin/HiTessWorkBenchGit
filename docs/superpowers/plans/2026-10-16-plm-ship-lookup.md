# PLM 호선 기본 제원 조회 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 호선 번호(예: `3370`)를 넣으면 사내 PLM(Oracle `HIPLM`)에서 기본 제원 5가지를 돌려주는 백엔드 서비스·API와 프론트 API 함수를 만든다.

| 돌려줄 항목 | 출처 컬럼 (`VT_PLM_SHIP`) | 3370 실측 → 응답 값 |
|---|---|---|
| 선형(용량+선종) | `SHIP_TYPE_NAME` | `'174K-LNG'` → `capacity:"174K"`, `shipKind:"LNG"`, `label:"174K LNG"` |
| 주기관 | `MAIN_ENGINE` | `'G70ME-C10.5-GA-EGRBP'` |
| 선급(1번만) | `SHIP_CLASS1` | `'BV'` |
| 인도 날짜 | `RESULT_DELIVERY_DATE` | `datetime(2025,2,28)` → `"2025-02-28"` |
| 인도 여부 | `RESULT_DELIVERY_YN` | `'Y'` → `true` |

**Architecture:** 백엔드 — PLM 접속 공통부를 `services/plm_connection.py` 로 분리(설정·thick 초기화·접속) → `plm_user_directory.py` 가 이를 쓰도록 교체(동작 불변) → 신규 `services/plm_ship_directory.py`(순수 파서 `parse_ship_type` + `lookup_plm_ship` + 메모리 TTL 캐시 + `set_fetcher` 테스트 훅) → 신규 라우터 `routers/plm.py` 의 `GET /api/plm/ships/{ship_no}`(로그인 사용자). 프론트 — `api/plm.js` 의 `getPlmShip(shipNo)`. **화면 연결은 이 계획 범위 밖**(아래 '남은 결정').

**Tech Stack:** Python 3.14 / FastAPI / python-oracledb 2.5.1(이미 requirements 에 있음) / pytest — React 18 + axios. 신규 의존성 없음.

**규칙:** 커밋은 사용자가 직접 한다 — 각 Task 마지막은 **"커밋 준비 완료 — 변경 파일 목록 보고"**. `HiTessWorkBench/frontend/src/config.js`·`Darkmode.js/` 는 건드리지 않는다. 백엔드는 TDD. 주석·문서·에러 문구는 한국어, 식별자는 영어.

**테스트 실행 위치:** `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest tests/<file> -q`.

---

## 배경 — 이미 확인된 사실 (2026-10-16, 145 서버 실측)

- 접속: 사번→메일 기능과 **같은 계정·같은 설정**(`.env` 의 `PLM_ORACLE_DSN/USER/PASSWORD` + `PLM_ORACLE_LIB_DIR` thick mode). 145 에서 `mode=thick` 접속 성공.
- `VT_PLM_SHIP` = 시노님 → 실제 `INFODBA2.VT_PLM_SHIP`. 3,634행, 45컬럼. caduser 가 **SELECT 가능**(샘플 행 조회 성공).
- 키: `SHIP_NO` **VARCHAR2(4)** — 정확 일치로 조회. `SHIP_PRE`(선행호선)·`SHIP_SEQ`(시리즈 순번)는 이번 범위 밖.
- 3370 실측 행(관련 컬럼만): `SHIP_KIND_NAME='MEMB LNG'`, `SHIP_TYPE_CODE='LG017'`, `SHIP_TYPE_NAME='174K-LNG'`, `MAIN_ENGINE='G70ME-C10.5-GA-EGRBP'`, `SHIP_CLASS1='BV'`, `SHIP_CLASS2='KR'`, `RESULT_DELIVERY_YN='Y'`, `RESULT_DELIVERY_DATE=2025-02-28`.
- ⚠ 선종은 `SHIP_KIND_NAME`(`MEMB LNG`)이 아니라 **`SHIP_TYPE_NAME` 에서 뽑는다** — 사용자가 원하는 표기는 `174K LNG`.
- 쓸 수 없는 것: 주요 치수(LOA/B/D/DWT)는 `ANET.VT_SHIP_SPECIFICS` 에 있으나 **ORA-01031 권한 없음**. `ELA_SHIP_PARTICULAR` 는 전력부하해석 기기 목록이라 무관.
- 조사 도구: `HiTessWorkBenchBackEnd/scripts/inspect_plm_hull_tables.py` (읽기 전용, `--table`, `--column/--value`, `--distinct`).
- 개발 PC(70)에는 oracledb·Oracle 클라이언트가 없어 **실제 PLM 조회는 145 에서만** 가능하다. 단위 테스트는 `set_fetcher` 로 대체한다.

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/services/plm_connection.py` | 생성 | `.env` 설정 읽기·`is_configured()`·thick 1회 초기화·`connect()`(타임아웃 포함). **프로세스당 thick 초기화 플래그가 하나여야 하므로** 공통 모듈이 필수 |
| `HiTessWorkBenchBackEnd/app/services/plm_user_directory.py` | 수정 | 접속 코드를 `plm_connection` 호출로 교체. 공개 API·동작 불변 |
| `HiTessWorkBenchBackEnd/scripts/inspect_plm_user_view.py`, `scripts/inspect_plm_hull_tables.py` | 수정 | `_plm_settings`/`_ensure_thick_mode` import 를 `plm_connection` 으로 교체 |
| `HiTessWorkBenchBackEnd/app/services/plm_ship_directory.py` | 생성 | `normalize_ship_no`, `parse_ship_type`, `lookup_plm_ship`, TTL 캐시, `set_fetcher`, `clear_cache` |
| `HiTessWorkBenchBackEnd/app/routers/plm.py` | 생성 | `GET /api/plm/ships/{ship_no}` |
| `HiTessWorkBenchBackEnd/app/main.py` | 수정 | `plm.router` 등록 |
| `HiTessWorkBenchBackEnd/tests/test_plm_ship_directory.py` | 생성 | 파서·정규화·조회 상태·캐시·라우터 |
| `HiTessWorkBench/frontend/src/api/plm.js` | 생성 | `getPlmShip(shipNo)` |

---

## Task 0 — (사용자, 145) 선형 이름 형식 수집 — `SHIP_TYPE_NAME` 완료, 나머지 선택

`SHIP_TYPE_NAME` 분포는 2026-10-16 수집 완료(598종, 원본 `HiTessWorkBenchBackEnd/scripts/ship_type_names.txt`, 커밋 금지).
분석 결과는 Task 2 의 '실측 형식'에 반영했다. 아래는 아직 안 돌린 선택 확인이다.

- [ ] (선택) `SHIP_NO` 중복 여부 — 맨 위 건수가 1 이면 유일:
  ```powershell
  WorkBenchEnv\Scripts\python.exe scripts\inspect_plm_hull_tables.py --table VT_PLM_SHIP --distinct SHIP_NO --limit 5
  ```
  2 이상이면 고를 행 기준(예: `DATE_LAST_UPDATE` 최신)을 사용자와 정한다.
- [ ] (선택) `--distinct SHIP_CLASS1`, `--distinct RESULT_DELIVERY_YN` — 값 종류 확인(Y 외에 N/None 만 있는지).

## Task 1 — PLM 접속 공통부 분리 (`plm_connection.py`)

동작 변경 없는 리팩터링. 기존 `tests/test_plm_user_directory.py` 가 그대로 통과해야 한다.

- [ ] `app/services/plm_connection.py` 생성 — `plm_user_directory.py` 에서 다음을 **옮긴다**(복사 아님):
  - `_plm_settings()` → `plm_settings() -> Optional[dict]`
  - `is_configured() -> bool`
  - `_thick_initialized` + `_ensure_thick_mode()` → `ensure_thick_mode() -> bool` (주석의 10G verifier·1회 호출 설명 유지)
  - 신규 `connect(timeout_sec: float)` — oracledb 지연 import → `ensure_thick_mode()` → `oracledb.connect(..., tcp_connect_timeout=timeout_sec)` → `connection.call_timeout = int(timeout_sec*1000)`(실패 무시). 설정 없음/드라이버 없음이면 **`PlmUnavailable` 예외**(사유 문자열 `"not_configured"` / `"driver_missing"`), 접속 실패는 원래 예외를 그대로 올린다.
- [ ] `plm_user_directory.py` — `_default_fetcher` 가 `plm_connection.connect(_CONNECT_TIMEOUT_SEC)` 를 쓰도록 교체. `PlmUnavailable` 과 기타 예외 모두 기존처럼 로그 후 `None`. `is_configured` 는 `from .plm_connection import is_configured` 로 **재노출**(라우터 `users.py` 가 이 이름으로 import 중).
- [ ] 두 조사 스크립트의 import 를 `plm_connection` 으로 교체(`plm_settings`, `ensure_thick_mode`, `is_configured`).
- [ ] `pytest tests/test_plm_user_directory.py -q` 통과 확인.
- [ ] 커밋 준비 완료 — 변경 파일 목록 보고.

## Task 2 — 선형 파서·호선 번호 정규화 (순수 함수, TDD)

`app/services/plm_ship_directory.py` 에 순수 함수 두 개.

**`normalize_ship_no(value) -> Optional[str]`**
- 앞뒤 공백 제거·대문자. `^[A-Z0-9]{1,4}$` 가 아니면 `None`(→ fetcher 호출 안 함). `SHIP_NO` 가 VARCHAR2(4) 라서 5자 이상은 존재할 수 없다.
- ⚠ 숫자 앞 0 을 지우거나 채우지 않는다(`'0370'`과 `'370'`은 다른 키일 수 있다).

**실측 형식 (`SHIP_TYPE_NAME` 598종, 3,634행)**

| 형식 | 예 (건수) | 비고 |
|---|---|---|
| 비어 있음 | `None` (1,239행, 34%) | 선형 없이 내려간다 — 화면은 '정보 없음' 처리 |
| `<숫자>K-<선종>` | `174K-LNG`(165) `300K-VLCC`(106) `84K-LPG` `158K-COT` `180K-B/C` `50K-P/C` `22.5K-LPG` `1.8K-SS` | 소수점 있음, 선종에 `/` 있음 |
| `<숫자>-<선종>` (단위 없음) | `4500-CNTR`(34) `13100-CNTR` `6500-PCTC` | 컨테이너=TEU, PCTC=대수. **단위를 지어내지 않는다** |
| 위 + 괄호 부가정보 | `90K-LPG(DF)` `150K-LNG(MOSS)` `16200-CNTR(MTNL DF)` `88K-VLAC(LPG DF)` `180K-B/C(LNGDF)` | 연료·화물창 방식 |
| 괄호가 **잘린 값** | `15900-CNTR(DF/Type-B` `2500-CNTR (MAERSK NI` | 원본 컬럼이 20자에서 잘림. 닫는 `)` 없음, 괄호 앞 공백 있음 |
| 선종 뒤 공백 단어 | `7.5K-LNG BV` `23K-NH3 BV` `1.8K-SS #6 특수도장` | |
| 데이터 오기 | `174-LNG`(K 누락) `13200K-CNTR` `9000K-CNTR`(K 잘못) `174K-LNGC` | **고치지 않고 그대로** 분해 |
| 선종 없음 | `105K` | |
| 규칙 밖(특수선·함정·과제) | `FPSO` `DRILL` `SUPPLY VESSEL` `F-LNG` `KDX-III` `24-N-함정 군 요구사항` `'23-4` `4Dock 2K-FF` `1.5K PATROL(제민2호)` `중형선(4280_CNTR)` | 분해하지 않고 원문 그대로 |

**`parse_ship_type(name) -> dict`** — 반환 `{"capacity", "shipKind", "variant", "label"}`
- 정규식(대소문자 구분 없음, `re.fullmatch`, 앞뒤 공백 strip 후):
  ```python
  _SHIP_TYPE_RE = re.compile(
      r"(?P<cap>\d+(?:\.\d+)?K|\d{3,})"   # 용량: '174K'·'22.5K' 또는 단위 없는 3자리 이상('4500', '174')
      r"-"                                 # 구분자는 하이픈만 (공백 구분 'X PATROL' 은 규칙 밖)
      r"(?P<kind>[A-Za-z0-9/]+(?: [A-Za-z0-9/#]+)*)"  # 선종: 'LNG' 'B/C' 'LNG BV' 'SS #6' — 반드시 greedy
      r"\s*(?:\((?P<var>[^)]*)\)?)?"       # 선택 괄호: 닫는 ')' 없어도 허용(잘린 값)
      r"(?P<rest>.*)",                     # 남는 꼬리(예: ' 특수도장') — kind 에 붙이지 않고 버린다
      re.IGNORECASE,
  )
  ```
  - `capacity = cap.upper()`, `shipKind = kind.strip()`, `variant = var.strip() or None`, `label = f"{capacity} {shipKind}"`.
  - ⚠ 용량을 `\d{3,}` 로 제한한 이유: `24-N-함정…` 같은 과제명을 '24 N' 으로 잘못 쪼개지 않게. 실측상 단위 없는 용량은 모두 3자리 이상(최소 `174`, 컨테이너 최소 `1000`).
  - ⚠ 구분자에 공백을 허용하지 않는다: `4Dock 2K-FF`·`1.5K PATROL(…)` 가 엉뚱하게 쪼개진다.
  - ⚠ 선종 반복 그룹을 lazy(`*?`)로 쓰면 뒤의 `rest` 가 공백 단어를 가져가 `'7.5K-LNG BV'` 가 `'7.5K LNG'` 가 된다(실측 실패). greedy 로 둘 것.
  - 구현자가 정규식을 다르게 써도 되지만 **아래 테스트 표를 전부 통과**해야 한다.
  - 검증 기록(2026-10-16): 이 정규식으로 아래 29케이스 전부 통과, 실측 598종 전체에 적용 시 값이 있는 2,395행 중 **1,966행(82%) 분해**,
    나머지 429행(365종)은 `DRILL`·`FPSO`·`SUPPLY VESSEL`·함정·과제명으로 원문 표시가 맞는 것들이다. 상선(LNG·VLCC·LPG·COT·B/C·P/C·CNTR·PCTC 등)은 전부 분해된다.
- 규칙 불일치: `capacity=None`, `shipKind=None`, `variant=None`, `label = 원문.strip()` **그대로**(`-` 를 공백으로 바꾸지 않는다 — `KDX-III`, `F-LNG` 가 깨진다). 빈 값·`None` 은 네 값 모두 `None`.
- `label` 에는 `variant` 를 넣지 않는다(사용자 요구: 용량+선종만 명확히). `variant` 는 응답에 따로 싣는다.
- 테스트(`tests/test_plm_ship_directory.py`, `pytest.mark.parametrize`) — 실패 테스트 먼저. `(입력, capacity, shipKind, variant, label)`:
  - [ ] `'174K-LNG'` → `'174K','LNG',None,'174K LNG'`
  - [ ] `'300K-VLCC'` → `'300K','VLCC',None,'300K VLCC'`
  - [ ] `'22.5K-LPG'` → `'22.5K','LPG',None,'22.5K LPG'`
  - [ ] `'180K-B/C'` → `'180K','B/C',None,'180K B/C'`
  - [ ] `'4500-CNTR'` → `'4500','CNTR',None,'4500 CNTR'`
  - [ ] `'6500-PCTC'` → `'6500','PCTC',None,'6500 PCTC'`
  - [ ] `'90K-LPG(DF)'` → `'90K','LPG','DF','90K LPG'`
  - [ ] `'16200-CNTR(MTNL DF)'` → `'16200','CNTR','MTNL DF','16200 CNTR'`
  - [ ] `'150K-LNG(MOSS)'` → `'150K','LNG','MOSS','150K LNG'`
  - [ ] `'15900-CNTR(DF/Type-B'`(잘림) → `'15900','CNTR','DF/Type-B','15900 CNTR'`
  - [ ] `'2500-CNTR (MAERSK NI'`(공백+잘림) → `'2500','CNTR','MAERSK NI','2500 CNTR'`
  - [ ] `'7.5K-LNG BV'` → `'7.5K','LNG BV',None,'7.5K LNG BV'`
  - [ ] `'174-LNG'` → `'174','LNG',None,'174 LNG'`
  - [ ] `'13200K-CNTR'` → `'13200K','CNTR',None,'13200K CNTR'` (오기 보정 안 함)
  - [ ] `'174k-lng'` → `'174K','lng',None,'174K lng'` (용량만 대문자화)
  - [ ] 규칙 밖 → 네 값 None·label 원문: `'105K'`, `'FPSO'`, `'SUPPLY VESSEL'`, `'F-LNG'`, `'KDX-III'`, `'24-N-함정 군 요구사항'`, `"'23-4"`, `'4Dock 2K-FF'`, `'1.5K PATROL(제민2호)'`, `'중형선(4280_CNTR)'`, `'0.3K-경비함'`
  - [ ] `None`, `''`, `'   '` → 네 값 모두 `None`
  - [ ] `normalize_ship_no`: `' 3370 '`→`'3370'`, `'h001'`→`'H001'`, `'33700'`→`None`, `'33-7'`→`None`, `None`→`None`
- [ ] 최소 구현 → 통과.
- [ ] 커밋 준비 완료.

## Task 3 — 조회 서비스 `lookup_plm_ship` (TDD)

사번 조회와 달리 **'없음'과 '조회 실패'를 구분**해야 API 가 404/502 를 나눌 수 있다.

```python
@dataclass
class ShipLookup:
    status: str              # "found" | "not_found" | "invalid" | "unavailable" | "error"
    ship: Optional[dict] = None
    reason: Optional[str] = None
```

- SQL(바인드 변수, 이름은 `:ship_no` — `:uid` 같은 예약어 금지):
  ```sql
  SELECT SHIP_NO, SHIP_TYPE_NAME, MAIN_ENGINE, SHIP_CLASS1,
         RESULT_DELIVERY_DATE, RESULT_DELIVERY_YN
  FROM VT_PLM_SHIP WHERE SHIP_NO = :ship_no
  ```
- 운영 fetcher `_default_fetcher(ship_no) -> Optional[dict]`: `plm_connection.connect(3.0)` → 위 SQL → 행 없으면 `None`, 있으면 **원시 행 dict**(컬럼명 키). `PlmUnavailable` 은 그대로 올리고, 접속·쿼리 예외도 그대로 올린다(분류는 `lookup_plm_ship` 이 한다). 여러 행이면 첫 행 + 경고 로그(Task 0 결과에 따라 조정).
- `set_fetcher(fn | None)` — 테스트 훅(`plm_user_directory` 와 같은 모양).
- `_to_ship(row) -> dict` 응답 모양(camelCase, 프론트 그대로 사용):
  ```python
  {
    "shipNo": "3370",
    "shipType": "174K-LNG",     # 원문(추적용)
    "capacity": "174K",
    "shipKind": "LNG",
    "variant": None,           # 괄호 부가정보(예: 'DF', 'MOSS', 'MTNL DF'), 없으면 None
    "label": "174K LNG",
    "mainEngine": "G70ME-C10.5-GA-EGRBP",
    "shipClass": "BV",
    "deliveryDate": "2025-02-28",  # date/datetime → ISO 날짜, 없으면 None
    "delivered": True,             # RESULT_DELIVERY_YN == 'Y' (대소문자·공백 무시), 그 외/None → False
  }
  ```
  문자열은 strip, 빈 문자열은 `None`.
- `lookup_plm_ship(value) -> ShipLookup`:
  1. `normalize_ship_no` 실패 → `invalid`
  2. 캐시 적중 → 그대로(아래)
  3. fetcher 호출: `PlmUnavailable` → `unavailable`(reason=사유), 기타 예외 → `error`(reason=예외 문자열 앞 200자, 로그 warning), `None` → `not_found`, dict → `found`
- **캐시**: 모듈 dict + `threading.Lock`. `found` 는 6시간, `not_found` 는 10분 보관. `error`/`unavailable`/`invalid` 는 **캐시하지 않는다**(일시 장애가 굳지 않게). `clear_cache()` 제공, `set_fetcher` 호출 시 캐시도 비운다.
- 테스트 — 실패 테스트 먼저:
  - [ ] 3370 원시 행(위 배경의 실측값)을 돌려주는 fetcher → `found` + `_to_ship` 모양 전체 일치
  - [ ] `RESULT_DELIVERY_YN=None`, `RESULT_DELIVERY_DATE=None` → `delivered False`, `deliveryDate None`
  - [ ] fetcher `None` → `not_found`
  - [ ] fetcher 가 `PlmUnavailable("not_configured")` → `unavailable`, reason `not_configured`
  - [ ] fetcher 가 `RuntimeError` → `error`
  - [ ] 잘못된 번호 → `invalid` 이고 fetcher 호출 0회
  - [ ] 같은 번호 두 번 조회 → fetcher 1회(캐시), `error` 는 두 번 다 호출
  - [ ] 소문자·공백 입력이 정규화된 값으로 fetcher 에 전달
- [ ] 각 테스트 후 `set_fetcher(None)` 복원(try/finally 또는 fixture).
- [ ] 커밋 준비 완료.

## Task 4 — API `GET /api/plm/ships/{ship_no}` (TDD)

- `app/routers/plm.py`: `router = APIRouter(prefix="/api/plm", tags=["plm"])`, 인증 `Depends(require_auth)`(로그인 사용자 누구나 — 보고서 입력용이라 관리자 한정 아님).
- 상태 → HTTP:

| status | HTTP | detail |
|---|---|---|
| found | 200 | `_to_ship` dict 그대로 |
| invalid | 422 | `"invalid_ship_no"` |
| not_found | 404 | `"ship_not_found"` |
| unavailable | 503 | `"plm_not_configured"` 또는 `"plm_driver_missing"` |
| error | 502 | `"plm_fetch_error"` (내부 예외 문자열은 응답에 싣지 않고 로그만) |

- `main.py` 의 `include_router` 목록에 `plm.router` 추가(`from .routers import ...` 줄도).
- App Settings 게이트(`GUARDED_ROUTES`)는 GET 을 검사하지 않으므로 등록 불필요.
- 테스트(`TestClient`, 인증 헤더는 기존 라우터 테스트의 로그인/세션 fixture 방식을 그대로 따른다 — `tests/test_plm_user_directory.py` 참고):
  - [ ] 200 + 본문, 404, 422, 503, 502, 인증 없음 401
- [ ] `pytest tests/test_plm_ship_directory.py tests/test_plm_user_directory.py -q` 통과.
- [ ] 커밋 준비 완료.

## Task 5 — 프론트 API 함수

- [ ] `HiTessWorkBench/frontend/src/api/plm.js` 생성(`api/admin.js` 와 같은 패턴):
  ```js
  import axios from 'axios';
  import { API_BASE_URL } from '../config';
  import { getAuthHeaders } from '../utils/auth';

  /** 사내 PLM(VT_PLM_SHIP)에서 호선 기본 제원을 조회한다.
   *  200: { shipNo, shipType, capacity, shipKind, variant, label, mainEngine, shipClass, deliveryDate, delivered }
   *  404 = PLM 에 없는 호선, 422 = 번호 형식 오류, 503 = PLM 미설정, 502 = PLM 조회 실패 */
  export const getPlmShip = (shipNo) =>
    axios.get(`${API_BASE_URL}/api/plm/ships/${encodeURIComponent(String(shipNo).trim())}`,
      { headers: getAuthHeaders() });
  ```
- [ ] `npm run build`(frontend) 통과.
- [ ] 커밋 준비 완료.

## Task 6 — 145 실측 검증 (사용자)

- [ ] 145 `git pull` + 백엔드 재시작(신규 의존성 없음, `.env` 변경 없음).
- [ ] 브라우저/HTTP 로 확인(토큰은 WorkBench 로그인 세션):
  - `GET /api/plm/ships/3370` → `label "174K LNG"`, `mainEngine "G70ME-C10.5-GA-EGRBP"`, `shipClass "BV"`, `deliveryDate "2025-02-28"`, `delivered true`
  - 미인도 호선 1건(Task 0 결과에서 `RESULT_DELIVERY_YN` ≠ Y 인 번호) → `delivered false`
  - 없는 번호(`9999` 등) → 404
- [ ] 개발 PC(70)에서는 PLM 미접속이라 503/502 가 정상이다 — 실패로 보지 말 것.

---

## 남은 결정 (구현 범위 밖, 사용자에게 물을 것)

1. **어느 화면에 붙일지** — 후보: Unit 권상 보고서 입력 폼의 HULL 칸(Studio `UnitStructuralReportDialog` · WorkBench `UnitLiftingReportDialog`, 두 곳 사본 규칙 있음), Carling 보고서, Mooring 보고서. 붙일 때 패턴: HULL 입력 blur/조회 버튼 → `getPlmShip` → 선형·주기관·선급·인도일을 폼 칸에 채우고 사용자가 수정 가능하게.
2. 컨테이너·PCTC 는 PLM 에 단위가 없어(`4500-CNTR`) `label` 이 `4500 CNTR` 로 나간다. `4500TEU CNTR` 처럼 단위를 붙일지는 사용자 결정 — 기본은 **붙이지 않음**(데이터에 없는 값을 만들지 않는다).
3. `SHIP_NO` 중복이 있으면 고를 행 기준.

## 메모

- 메모리 `reference_plm_user_directory.md` 에 VT_PLM_SHIP 조사 결과가 있다. 구현이 끝나면 서비스·API 위치를 거기에 한 줄 추가할 것.
- `CLAUDE.md` 백엔드 라우터 표에 `routers/plm.py` 행 추가.
