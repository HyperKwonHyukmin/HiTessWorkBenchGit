# 러그 치수 기반 재작도 — 미리 변환해 둔 표준집 모델을 치수만 고쳐 해석 (2026-11-12)

## 왜

치공구표준집 '바로 변환'을 도면마다 자동으로 읽게 만드는 데 비용이 너무 크다. 11-12 하루를 들여 D형 4장을 더했다(글꼴 표본, 겹쳐 그린 선,
축척대로 안 그린 도면, gmsh 반올림 문제가 한 장씩 나옴). 러그만 46종이고 아직 35종이 남았다.

그런데 표준집은 **고정된 155종**이다. 매번 PDF 를 읽을 이유가 없다. 사용자 제안(11-12)대로 바꾼다:

1. 표준집 러그를 **미리 치수(파라미터)로 저장**해 둔다. 자동으로 안 읽히는 도면은 사람이 치수를 한 번 적는다(자중 대조로 검증).
2. 화면은 고른 러그의 **형상만** 3D 로 보여 주고 치수 표를 둔다. 메시는 없다.
3. 치수를 고치면 형상만 다시 그린다.
4. **[해석 실행]** 때 비로소 최종 치수 → 형상 → 메시 → BDF → Nastran 과 수계산을 돌린다.
5. 업로드 PDF 는 제목('LUG (D-50)')으로 표준집 항목에 맞으면 그 모델을 보여 주고 치수만 고치게 한다.
   표준집에 없는 도면만 지금의 자동 읽기를 시도한다.

## 결정

- **치수 → 형상(설계 JSON)** 은 엔진 안의 순수 파이썬 모듈 하나(`lugshell/lugshell/params/`)로 둔다. gmsh 와 PDF 를 쓰지 않는다.
  템플릿의 `extract()` 는 '도면 읽기 → 치수' 와 '치수 → 형상(이 모듈)' 으로 나뉜다. 같은 코드가 자동 읽기와 치수 편집 양쪽에 쓰인다.
- 형상 미리보기에 엔진 exe 를 쓰지 않는다. **exe 1회 기동이 약 10초**(11-12 실측, 단일 파일 압축 풀기와 보안 검사).
  대신 같은 모듈 파일을 InHouse 에 복사해 백엔드가 직접 import 한다(응답 수십 ms). JS 로 다시 짜지 않는다 — 이중 구현 금지.
  배포 방식은 `nastran_bridge.py` 와 같다(InHouse 수동 교체). 모듈에 버전 문자열을 두고 exe 와 어긋나면 화면에 알린다.
- **해석 실행**은 이미 있는 `DrawingToAnalysis.exe lugshell --design <설계 JSON>` 을 그대로 쓴다(기동 10초는 해석 1회라 괜찮음).
- 형상 표시는 설계 JSON 의 판 외곽만으로 그린다. STEP 파일은 필요 없다(원하면 'CAD 로 내보내기' 다운로드로만 나중에 덧붙임).

## 치수 파일 형식(초안)

`HiTessWorkBenchBackEnd/DrawingBook/params/<기호>.json` (git 추적, 서버는 `git pull`)

```json
{"schema": "lugparams/0.1", "form": "d_type_lug", "code": "D-50", "page": 18,
 "values": {"base_width": 660, "side_height": 120, "pin_height": 190, "arc_R": 130, "flank_R": 130, "hole_d": 76, "...": "..."},
 "source": "auto | hand", "review": [{"name": "bracket_t", "note": "재료표 22t ↔ 정면도 띠 20 — 도면 차이"}]}
```

값 이름은 지금 trace 이름을 그대로 쓴다(`base_width`, `arc_R` …). 형식마다 필수 값, 단위, 화면 라벨, 서로의 제약(예: `arc_R < base_width/2`)을
모듈의 `FORMS` 표 한 곳에 둔다. 화면의 치수 표는 이 표를 받아 그린다.

## 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 엔진: `params` 모듈 — `lapping_lug`, `d_type_lug` 의 '치수 → 설계 JSON' 분리, `FORMS` 표, 템플릿이 이 모듈을 쓰게. 회귀: 기존 예제와 형상이 같은지 | 끝남(11-12): 실도면 10장 형상 동일, 회귀 전부 통과, CLI `lugshell --params` |
| 2 | 표준집 11종 치수 파일 생성 스크립트(자동 읽기 결과 → params JSON) + 자중 대조 | 끝남(11-12): `scripts/drawing_book_index.py` 가 `DrawingBook/params/<기호>.json` 11개, 색인 항목에 `params` |
| 3 | 백엔드: 표준집 치수 조회, 치수 → 형상(모듈 import), 해석 실행(설계 JSON → `lugshell --design`) | 끝남(11-12): `services/lug_params.py`, 라우트 3개, 시험 `tests/test_lug_params.py` 11건 |
| 4 | 화면: 표준집에서 고르면 3D 형상 + 치수 표, 고치면 다시 그림, [해석 실행] | 코드 끝남(11-12): `LugParamEditor`, `LugGeometryView`, `utils/lugGeometry.js`. 사용자가 70 앱에서 형상 표시 확인. 아래 '화면 흐름' 추가분은 눈으로 확인 안 함 |
| 5 | 업로드 PDF 제목으로 표준집 항목 맞추기 | |
| 6 | 남은 러그 형식(T, TD, A, B 형 등) '치수 → 형상' 추가, 치수는 손으로 채움 | |

## 화면 흐름 (11-12 오후, 사용자 결정)

순서는 **① 형상 → ② 하중 및 경계 → 해석 실행**(메시는 실행 때 만들고 결과 화면에서 본다). 사용자가 추천안을 그대로 골랐다.
- ① 형상: 치수 칸을 누르면 그 치수의 판만 진하게, 나머지는 흐리게, 치수선은 주황으로 맨 앞에. 근거는 엔진 `params` 의 `info["marks"]`
  (칸 → 판 id + 치수선 좌표, `common.mark()`). 백엔드 params·lug-geometry 응답에 `marks`. [전체 화면] = 편집기 전체(3D + 표) `requestFullscreen`.
- ② 하중 및 경계: 안전하중, DAF, 핀 지름, 케이스 표(α 면내, β 면외, 1~8개, 더하기 빼기, 기본 케이스로), 핀 중심 하중 화살표(케이스 색, 고른 케이스만 진함),
  바닥 고정은 빨간 선과 빗금으로 **보여 주기만**(고칠 수 없음), 메시 요소 크기 2~50 mm. 범위 검사는 결과 화면 '하중 값 고치기'와 같은 `utils/lugshellEdits.js`.
- 서버: `run-params` 가 `mesh_size`(2~50)와 `cases`(전체 목록, 바뀐 때만 보냄)를 받아 `apply_lugshell_edits(replace_cases=True)` 로 바꿔 넣는다.
  새 케이스 이름 `LC{n}_user`, β ±90° 거절, 바뀐 내용은 확인 항목 `load_angles` 에 남는다. 최대 8 케이스(`MAX_LOAD_CASES`).
- 확인: 백엔드 시험(`test_lug_params.py` + `test_drawing_lugshell.py` 30건), 프론트 유틸 476건, 빌드, D-50 에 케이스 2개 + 메시 15 mm 로 InHouse exe 와 Nastran 끝까지(FATAL 0, UC 0.53/0.52).
- ⚠ 개발 중 3D 가 회색만 보이던 원인 = React StrictMode 이중 실행에서 카메라 맞춤 표식(`fittedRef`)이 남아 새 카메라를 맞추지 않음 → 장면 정리 때 표식도 지운다.
- ⚠ 9091 `--reload` 가 새 라우트를 읽지 않아 편집기가 'Not Found' 였다 → 404 'Not Found' 면 '서버를 다시 시작' 안내.
- 엔진 회귀는 반드시 `lugshell/.venv/Scripts/python.exe tools/regress.py`(시스템 파이썬은 거짓 실패 109건).
- 케이스별 하중 크기(kN, 같은 날): 비우면 안전하중 × g × DAF, 넣으면 서버가 그 케이스 `swl_t = p_kn / (g × daf)` 로 바꿔 넣는다(엔진 무수정). 3D 화살표 끝에 'LC1 491 kN', 길이는 가장 큰 하중 비례(최소 절반).
- **본창 통합(같은 날, 사용자 결정 A안)**: 모달 안 편집기와 본창 결과의 이중 구조를 없앴다. 도면 찾기 창은 고르기만 하고([형상 보고 치수 고치기] = 창 닫고 본창으로),
  본창 왼쪽 = 고른 도면 한 줄 + 단계 [치수 | 하중 및 경계 | 결과], 가운데 = [형상 | 해석 결과] 전환, 전체 화면은 왼쪽 단계와 3D 를 함께.
  상태 훅과 부품 = `components/analysis/LugParamWork.jsx`(`useLugParamWork`, 페이지 저장소 `bookWorkState` 로 고치던 값 유지). `LugParamEditor.jsx` 는 지웠다.
  [해석 실행] = 변환(메시, BDF, 수계산) 뒤 Nastran 을 이어서 부른다(`autoSolveRef`). 해석한 값의 지문과 지금 값이 다르면 '결과가 지금 값과 다릅니다' + [바꾼 값으로 다시 해석].
  결과 단계의 `LugshellReviewPanel paramsMode` = 하중은 읽기 전용 요약 + [하중 고치기], '도면에서 읽은 형상' 없음. 확인 항목은 '도면과 다름'만 펼침(두 경로 공통).
  결과나 치수 작업이 있으면 입력 상자를 한 줄로 접고, '지원 범위' 안내는 첫 화면에만.

## 주의

- 치수를 고친 결과가 판정에 쓰이므로, 형식마다 치수 제약을 검사해 모순이면 형상을 만들지 않고 이유를 보인다(예: 오목 원과 위 원이 겹침).
- 자동 읽기에서 남긴 '확인 항목'(review)은 치수 파일에 함께 저장해 화면에 계속 보인다.
- 1단계는 엔진 리팩터링이라 회귀(`tools/regress.py`)가 그대로 통과해야 한다. 형상 비교는 예제 JSON 과 바이트 수준이 아니라 값 허용치로 본다.

## 반영 (11-12)

- 70: InHouse `DrawingToAnalysis/lugparams/` 내보냄(엔진 `tools/export_lugparams.py`). 백엔드는 이 폴더 → 개발 PC 엔진 소스 순으로 찾는다.
  exe 는 바꾸지 않음(템플릿 리팩터링은 출력이 같고, 해석은 기존 `--design` 경로).
- 145 순서: InHouse `lugparams/` 폴더 복사 → `git pull`(색인과 치수 파일) → **백엔드 재시작**(새 라우터) → 다음 WorkBench exe(화면).
  `lugparams` 가 없으면 치수 화면은 503 '모듈이 서버에 없습니다' 를 보이고, 기존 '도면에서 다시 읽어 바로 변환'은 그대로 된다.
- 엔진 모듈을 고치면 `export_lugparams.py` 를 다시 돌려 InHouse 복사본을 맞춘다(같은 소스 복사, 버전 `lugparams/0.1`).
