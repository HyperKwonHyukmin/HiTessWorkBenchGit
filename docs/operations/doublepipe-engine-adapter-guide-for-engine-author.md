# HiTessAdapter 안내 — 이중관 PSA 엔진 개발자용

> **대상 독자**: 이중관 연료배관 응력해석(PSA) 엔진을 개발하는 연구원
> **작성**: 2026-08-28 · WorkBench 팀
> 이 문서는 그대로 전달·공유해도 되도록 작성했습니다.

---

## 한 줄로

**연구원님 엔진 코드를 한 줄도 고치지 않고 WorkBench(사내 웹 플랫폼)에서 무인 실행하기 위한 얇은 껍데기입니다.** 엔진 폴더 바깥에 따로 있고, 해석 로직에는 일절 관여하지 않습니다.

---

## 1. 왜 만들었나

그동안 WorkBench에서 돌리려면 엔진 소스 파일 안에 서버 환경용 코드를 직접 넣어야 했습니다. 사내 DRM, 콘솔 인코딩, 무인 실행 같은 **WorkBench 쪽 사정**이지 배관 해석과는 무관한 것들입니다.

문제는 새 버전을 받을 때마다 그 수정이 사라진다는 점이었습니다. 이번(2026-08)에도 `FuelLine_PSA_Report.preload_template()` 의 DRM 우회 로직이 유실됐습니다.

연구원님 잘못이 아니라 — **애초에 남의 코드에 얹어둔 저희 쪽 설계가 잘못**이었습니다. 그래서 그 부분을 전부 밖으로 빼냈습니다.

---

## 2. 무엇을 하나

엔진을 import 하기 직전에 파이썬 라이브러리 동작을 바깥에서 바꿔치기합니다(monkeypatch). 엔진 코드는 그대로 두고 환경만 맞춰주는 방식입니다.

| 하는 일 | 왜 필요한가 |
|---|---|
| `openpyxl.load_workbook` 을 감싸 PK(zip) 검사 → 실패 시 번들 템플릿으로 폴백 | 사내 DRM이 디스크의 `.xlsx` 를 암호화(HHIDRMC, +4096B)해서 서식이 깨짐 |
| `MergedCell.value` 쓰기를 무시하도록 교체 | 병합 셀 범위를 훑을 때 `AttributeError` 로 보고서 생성이 통째로 실패 |
| `abaqus job=...` 명령에 `ask_delete=OFF` 주입 + 로케일 인코딩 교정 | 무인 재실행 시 덮어쓰기 확인 프롬프트 / cp949 출력이 UTF-8 디코딩과 충돌 |
| stdout/stderr를 UTF-8로 고정 | 백엔드가 UTF-8로 로그를 읽어서, 안 맞추면 한글이 전부 깨짐 |

여기에 `Main.py` 를 대신하는 진입점(`cli.py`)이 하나 더 있습니다. `--load-cases` 인자 처리와 파이프라인 호출 순서만 담고 있고, **계산은 전부 연구원님 코드가 합니다.**

---

## 3. ⭐ 연구원님 입장에서 달라지는 것 — **없습니다**

이게 핵심입니다.

- **지금처럼 개발하시면 됩니다.** 저희를 위해 뭘 넣거나 유지하실 필요 없습니다.
- 코드에 남아 있는 WorkBench용 흔적(`preload_template` 의 DRM 처리, `_set_cell`, `ask_delete=OFF`, `sys.stdout.reconfigure` 등)은 **저희가 더 이상 의존하지 않습니다.** 연구원님 로컬 실행에 도움이 되면 두시고, 거슬리면 지우셔도 WorkBench는 영향받지 않습니다.
- **exe는 안 주셔도 됩니다.** 소스 폴더만 주시면 저희가 연구원님과 동일한 환경으로 직접 빌드합니다.

### 저희가 재현한 빌드 환경

exe 바이너리에서 역추출 + 동봉해주신 `requirements.txt` 로 확인했습니다.

```
Python 3.8.10 (64bit)
numpy 1.24.4   scipy 1.10.1   openpyxl 3.1.5
matplotlib 3.7.5   pyNastran 1.3.4
```

---

## 4. 딱 하나 부탁드릴 것 — 함수/클래스 **이름**

어댑터가 엔진을 호출하는 접점은 아래가 전부입니다. 내부 구현은 얼마든지 바뀌어도 되지만, **이 이름들이 바뀌면 저희 쪽을 같이 고쳐야 합니다.**

```
AbaqusModelCreator.AbaqusModelCreator(csv, inp, bdf, is_OLET=False)
  .AbaqusModelCreatorRun(csvInfo_dict, InnerPipeGroup, OuterPipeGroup)

Head_for_FuelLine_ASME_B313_v2018
  HeadClass_01(inp)  →  .LC_name / .LC_name_iter01 / .LC_name_iter02
                        .filename / .datname / .Abaqus_Run(names, message=)
  HeadClass_02(iter02_inp, iter02_dat, iter01_dat)  →  .check_overstress
  Non_fric_inp_parse / Fric_inp_parse / ModifyINP / INP / Parse_dat_file
  make_report()  /  F06Format().read_txt()
```

바꾸셔도 **사고는 안 납니다.** 어댑터가 실행 시작 시 이 목록을 검사해서 없어진 이름을 찍고 즉시 멈추고, 저희 자동 테스트도 새 소스를 받는 즉시 알려줍니다. 조용히 잘못된 결과가 나오는 일은 없습니다. 다만 **미리 한마디 주시면 저희가 먼저 맞춰둘 수 있습니다.**

---

## 5. 반영을 부탁드리는 엔진 이슈 2건

### ① Summary-2 초기화의 `idx` 누수 → `UnboundLocalError`

`FuelLine_PSA_Report.py` · `make_report()` 안:

```python
for row in sheet_ope[max_node_cell+str(idx) : max_dzm_cell + str(idx+999)]:
```

여기 `idx` 는 앞의 restraint 루프에서 흘러나온 값입니다. **OPE(L1~L16)를 하나도 선택하지 않고 해석하면** 그 루프가 아예 안 돌아 `idx` 가 정의되지 않고, `UnboundLocalError` 로 보고서 생성이 통째로 실패합니다. `idx` 가 16보다 작을 때는 13~15행 병합 헤더를 건드려 크래시가 나기도 합니다.

데이터 시작행을 16으로 고정하면 해결됩니다.

```python
for row in sheet_ope[max_node_cell + "16" : max_dzm_cell + "1015"]:
```

> 이건 환경 문제가 아니라 **엔진 로직 버그**라 어댑터로 우회가 안 됩니다. 지금은 저희가 빌드할 때 자동으로 이 한 줄만 치환하고 있는데, 원본에 반영해 주시면 그 장치를 없앨 수 있습니다.

### ② 배관에 안 붙은 U-BOLT → `KeyError: 'localAxisID'` (진단 불가 메시지)

`ExportINP.py` · `CreateBeamSection()`:

```
KeyError: 'localAxisID'
```

**메커니즘**

- `ModelAlgorithm` 의 국부좌표계 생성 루프는 U-BOLT 노드를 참조하는 **비-`CONN3D2` 요소**(즉 실제 배관 요소)를 찾아야만 `localAxis_dict` 항목을 만듭니다.
- `ExportINP.CreateLocalAxis()` 는 그 `localAxis_dict` 를 돌면서 Connector property 에 `localAxisID` 를 심습니다.
- `CreateBeamSection()` 은 **모든** Connector property 에 `localAxisID` 가 있다고 가정하고 접근합니다.

→ U-BOLT 노드가 배관 요소에 안 붙어 있으면 국부좌표계가 안 만들어지고, `CreateBeamSection` 에서 원인을 알 수 없는 `KeyError` 로 죽습니다.

**실측 사례** (`H3445_pipeData_R1_260528_Y-15000.csv`)

```
U-BOLT 노드 수       : 21
국부좌표계 생성 수   : 20
좌표계 못 받은 U-BOLT: [38]

U-BOLT node 38 @ (43258.0, 3850.0, 29710.0)
  이 노드를 참조하는 요소: CONN3D2 #104 (nodes=[38, 82]) 뿐 — 배관 요소 없음
  배관 요소에 실제 쓰이는 가장 가까운 노드까지 거리: 6,673 mm
```

**제안** — 조용한 `KeyError` 대신 어느 U-BOLT가 문제인지 알려주는 것만으로 충분합니다.

```python
# CreateBeamSection() 의 Connector 분기 진입 전
if 'localAxisID' not in propertyValue['rest']:
    raise ValueError(
        f"U-BOLT(property {propertyID}, ELSET {propertyValue['rest']['ELSET']})에 "
        f"국부좌표계가 없습니다. 해당 U-BOLT가 배관 요소에 연결되어 있는지 확인하세요."
    )
```

> 참고: 이 사례 자체는 입력 데이터 문제였습니다(내관 지지대가 내관이 없는 구간에 생성됨). 다만 **엔진이 원인을 못 알려주는 것**이 별개 문제라 말씀드립니다. 이 오류는 **2026-07 구버전 엔진에서도 동일하게 재현**되어, 최근 변경과 무관한 기존 동작입니다.

---

## 6. 정리

```
연구원님 폴더                          ← 수정 금지. 새 버전 오면 통째로 교체
  Piping Stress Analysis for all load cases/

HiTessAdapter/                        ← WorkBench 소유. 엔진 폴더 밖
  PSA_AllLoadCases.exe                   (저희가 빌드)
  report_template.bin
```

엔진 폴더 안에 있던 저희 exe·템플릿을 밖으로 뺐기 때문에, **이제 폴더를 통째로 덮어써도 아무것도 안 지워집니다.**

---

### WorkBench 팀 내부 참고

- 어댑터 소스: `HiTessWorkBenchBackEnd/InHouseAdapters/doublepipe_psa/` (git 추적)
- 설계 배경: `docs/superpowers/specs/2026-08-28-doublepipe-engine-adapter-design.md`
- 드리프트 검사: `pytest tests/test_doublepipe_adapter.py`
- 빌드: `InHouseAdapters/doublepipe_psa/build.ps1`
