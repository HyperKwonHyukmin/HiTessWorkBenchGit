# Mooring Fitting Assessment

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### Mooring Fitting Assessment — 3개 구성요소(엔진 / exe배포본 / 스튜디오)와 배포 흐름 ★작업 전 필독

Mooring Fitting Assessment(연결 메뉴 = "Mooring Fitting Assessment", viewer id=`mooring-fitting-studio`)는 **별개의 세 위치**로 구성된다. 어느 쪽을 건드리는지 먼저 구분할 것.

**① 해석 엔진 (C# .NET)**
- 소스: `C:\Coding\WorkBenchSubModule\MooringFitting\` (`MooringFitting.sln`, `src/`, `publish/`, `CONTEXT.md`, `README.md`).
- 빌드 산출물(실사용): `HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe` — 엔진 개발이 끝나면 여기로 복사. InHouse 규칙 그대로 적용 — **git 미추적 → 운영 서버(145)에 수동 교체 + 백엔드 재시작 필요**. (폴더에 기능단계별 `.bak_*` 백업 존재)
- CLI 태스크 2종 (`app/services/mooring_fitting_service.py`가 호출):
  - `build-full` — 모델/BDF 생성. 안전계수 `--mf-sf`(기본 1.25), Angle_H/Angle_V force 역산 기록.
  - `solve-bdf <bdf> <model.json> -o <result.json> --yield <σy기본315 AH32> --gamma <γM기본1.0>` — Nastran SOL 101 해석, von Mises Usage=σeff/(σy/γM). `SOLVE_TIMEOUT=1800s`.

**② 스튜디오 (React 뷰어)** — `C:\Coding\WorkBenchSubModule\MooringFittingStudio\` (로컬 git 만, `npm run package` 없음 → 수동 zip). `MooringFittingAssessment.jsx` 에는 **버전 핀이 없고** 백엔드 manifest 로 최신 버전을 동적으로 읽는다. 빌드·배포 절차는 `/deploy` 스킬.

**런타임 InHouse 의존 (서버 145 수동 반영 대상):** `InHouseProgram/MooringFitting/MooringFitting.exe` + `InHouseProgram/NastranBridge/nastran_bridge.py`(rbe2_fixed_lines 등 편집 BDF fix, `analysis.py` apply-edit 기본 경로) + `InHouseProgram/F06Parser/` + 외부 MSC `nastran.exe`.

⚠ **엔진·Studio 는 원격이 없고 코드가 70 PC 에만 있다** (2026-11-03 확인). 마지막 커밋은 엔진 2026-05-28, Studio 2026-06-15(0.1.59)이고 그 뒤 변경(Studio 0.1.73·엔진 9-04 exe)이 미커밋이다. 구현 전에 스냅숏 커밋부터 한다.

**정응력 상·하면 평가 (2026-11-03, P0-1 해소)** — `σ상면 = N/A − M1/Wt`, `σ하면 = N/A + M1/Wb`, 판정은 큰 쪽. 예전 식 `N/A + M1/min(W)` 는 하면만 본 값이었다.
부호는 NewCase_02 F06 회복점 응력 3.7만 station 과 0.0001 MPa 까지 일치 확인(I 상면 = C·F, T 상면 = D·F, `FiberStressTests` 에 고정). 엔진 `BeamForcePostProcessor.StrongAxisFiberStress` 한 곳이고,
CalcVerify 끝에 `Sn_Top,Sn_Bottom` 이 붙었다. 이 칸이 없는 옛 결과는 보고서가 '다시 해석하세요' 로 거절한다. ⚠ csv/NewCase_01·03 의 F06 은 BDF 보다 오래돼 대조에 쓰면 안 된다.

**재질별 판정 (2026-11-03)** — 규칙 원본 = 엔진 `SteelGrade`(`Core/Model`), 백엔드 `judge_member` 가 사본이라 **한쪽을 고치면 양쪽 다**.
- 등급: A·B·D·E 235 · AH·DH·EH·AH32·DH32·EH32·LT-60 315 · AH36·DH36·EH36 355 · 표에 없거나 비면 235 + '등급 미확인' 경고. **면별 판정(2026-11-03 사용자 결정)** — 상면(갑판 쪽)은 부착판 등급, 하면·전단은 보강재 등급(`SteelGrade.Resolve/JudgeFibers`, 백엔드 `judge_member_fibers`, 재질표 1.1 `plateGrade·plateYieldMPa`). 예전 '낮은 등급 하나' 는 AH 보강재 + A 갑판을 235 로 봐 계산서(보강재 315)보다 1.34배 엄했다. 3496 FORE: 재질 변경 20 → 12, 최대 1.711 → 1.527.
- 등급 칸(0부터): ANGLE·FLATBAR·TBAR 6·26 · PLATE·BRACKET below 6 · above 16. ⚠ above 의 6번 칸은 좌표다.
- 판정: OK / `MATERIAL_CHANGE`(일반 강재가 315 기준이면 만족) / NOT OK. 315 부재를 355 로 올려야 하는 경우는 NOT OK(사용자 결정). 전단 허용 0.6 × σy/γM.
- 흐름: build-full 이 `out/MEMBER_MATERIAL.json`(부재별 재질) → solve-bdf·report 가 이 파일만 읽는다(`MemberMaterialMap.LoadForModel`). 엔진이 만든 부재는 CSV 행이 없어 235 + 미확인, 보강 클론은 원본을 따른다.
  백엔드 `recompute_sigma_ny` 가 element 마다 `verdict` 를 붙이고 Studio `utils/verdict.js` 가 표시한다. σy 입력칸은 없앴다(`--yield` 는 재질표 없는 옛 결과의 일괄값). γM 은 그대로.
- NewCase 샘플 실측(SampleFile 호선 3516): OK 1,924 → 1,898 · 재질 변경 필요 26(전부 기존 OK) · NOT OK 35 그대로 · 최대 Usage 4.852 → 6.504(같은 E2121, A급).

**부재 ↔ CSV 행 대응 (2026-11-03)** — `element_names.json` 이 이제 엔진 출신 기록(`MODEL_EVIDENCE.json`)에서 나온다. 좌표 매칭은 겹친 부재를 첫 행으로 몰아 1,904개 중 160개가 틀렸다(증거 파일 없는 옛 결과에서만 폴백).

**CSV 행 단위 단면·재질 편집 (2026-11-03)** — Studio 편집 패널 '단면·재질 (CSV 행)'. 대상은 부재가 아니라 행이다(그 행의 조각이 함께 바뀜). intent `editCsvRow { csvLine, cells:{칸:값} }`.
`app/services/mooring_row_edit.py` 가 적용한다(`nastran_bridge` 수정 없음 — `git pull` 로 반영). 대상 요소는 서버가 출신 기록으로 찾고, 새 PBEAML 은 기존 치수에서 CSV 가 정하는 칸만 바꾼다(유효폭·갑판 두께 유지).
등급은 글자만 `mooring_solve.grades.json` 으로 넘기고 엔진이 `SteelGrade` 로 해석한다. '바뀐 행 CSV' = 원본 행에서 그 칸만 바꾼 글자(`utils/csvRowEdit.js`, BOM+CRLF). 3D 단면 표시·인스펙터 단면 값은 편집을 반영하지 않는다(해석 결과에는 반영).
실측: E2206 등급 B→AH(응력 불변) U 1.33 → 0.99 OK · E2121 웹 11→30 mm 재해석 U 6.50 → 4.15. 샘플 전 행 크기 편집 386행 예외·이상 치수 0.
⚠ 겹친 부재 병합(01_CollinearOverlap)으로 출신 행과 다른 행의 단면을 쓰는 요소가 있다(샘플 1,939개 중 135개). `_section_is_from_row` 가 행 값으로 재계산해 같을 때만 크기를 바꾸고, 다르면 건너뛴다 — 등급은 출신 행을 따른다. 화면이 `foreignElements` 로 알린다.
보강 클론 재질은 `LoadForModel` 이 `<bdf 이름>.model.json` 의 reinforceOf 로 물려받는다(해석·보고서 공통). 재질표 없는 옛 모델은 결과 JSON `materialTable:false` → Studio 가 일괄 σy 경고.
화면은 Chrome 헤드리스로 실제 viewer-zip·결과를 넣어 편집~CSV 저장~최종 검토까지 확인. WorkBench 앱 안 실행·3D 뷰포트 표시·OS 저장 대화상자는 확인 안 함. Studio 시험: `node --test src/utils/csvRowEdit.test.js src/store/useCsvRowStore.test.js`.
남은 공학 검토: `RecordMD/2026-09-07-mooring-fitting-engineering-review.md` P0-3 · P0-4 · P1. 적합 판정 보고서 발행 보류는 그대로다. P0-2 는 Studio 쪽만 막았다(아래).

**MB·MU 와 같은 셸로 개편 (Studio 0.1.78, 2026-11-03, 70 로컬만·미커밋)** — 사용자 지시: Studio 사용법을 MB·MU 와 통일. 개편 전 기준점 = MF 저장소 커밋 `6b323e9`·태그 `mf-before-shell-rework`.
- 배치: 상단 탭 Model │ Model Check │ Loads │ Edit │ Analysis │ Save(탭 상태 점) · 왼쪽 `shell/TabPanel`(300px, 푸터 = 다음 행동 하나, 좌하단 버전) · 오른쪽 `shell/RightDock` 표시/정보(Ctrl+B, 보이기 설정은 전부 여기) · 아래 `shell/BottomDock`(높이 끌기·Ctrl+J·Ctrl+Shift+J). 편집 모드 토글·소메뉴 리본은 없앴다.
- 사용자 확인 후 조정(같은 날): 아래 도크의 검토/경고·진단 탭 삭제 — Model Check 패널이 진단 묶음 펼침(대상 클릭 = 이동)과 엔진 원인 진단을 직접 보인다. 메시지 탭은 기록이 있을 때만 · 뷰포트(Model 비교·카메라 동기화) 삭제 · **부재를 고르면 늘 '정보' 탭으로**(MB·MU 셸 규칙 6 과 다른 MF 만의 결정) · 직교 이동 1:1(TrackballControls 가 직교에서도 카메라 거리를 곱하고 감속 모드가 총 이동을 1/dynamicDampingFactor 배로 키워 모델이 날아갔다 — 조작 시작 때 panSpeed 를 맞춘다).
- `/design` 재검토(28/40, 기록 MF 저장소 `.impeccable/critique/`): 판정 칩(OK·재질 변경·NOT OK 건수, 누르면 최종 검토 표 필터) · 11px 미만 글자 90곳 → 11px · 보조색 `#64748b`→`#8b98ab`(AA) · `:focus-visible` · Usage 를 소수로 통일(% 폐기) · 하중 kN 라벨 축소(사용자 결정: 끄지 않고 작게) · 단추 Fit/Reset → 전체 보기/처음 시점(XY·PNG 는 유지) · 작업 패널 접기 · 사각형 선택을 캔버스 밖에서 놓아도 끝나게.
- 0.1.79(같은 날, 사용자 지적 4건): ① 정보 패널 T 단면 D3·D4 이름이 뒤바뀌어 있었다(엔진 T = [유효폭, H, 갑판 두께, 웹 두께]) — 단면 그림(`components/SectionSketch.jsx`, 규칙 `utils/sectionSketch.js`+테스트, 새 치수 계산은 백엔드 `mooring_row_edit._new_dims` 사본)으로 바꾸고, 부재의 출신 기록 행과 단면을 만든 행이 다르면 그 행을 알린다(같은 치수 대칭 행은 부재 위치로 고름, 0.1.80). 실례 E2526: 출신 기록은 226행(PLATE below)인데 단면은 우현 133행 WID-WEB-A(PLATE above, 좌표 높이 15 mm)다. 226행 자체는 같은 절점의 E2491~2493(I, H 370 = 10+350+10)으로 바르게 들어가 있어, E2526 의 '226행' 은 엔진 출신 기록(MODEL_EVIDENCE) 오류로 보인다(미수정). ⚠ **CSV 오류가 아니다(정정, 같은 날)** — PLATE above 는 POS1~POS4 네 점 판이고(4~6·7~9·10~12·13~15칸, THK 16칸, 등급 17칸) WID-WEB-A 는 POS1 쪽 15 mm(스닙) ↔ POS2 쪽 234 mm 로 높이가 변하는 사다리꼴 판이다. 엔진 `ParsePlate` above 는 높이 = |POS1−POS4| 하나만 써서 ① 사다리꼴이면 한쪽 끝 높이를 전 길이에 쓰고 ② 변이 기울면 수직 높이 대신 빗변 길이를 쓴다(샘플 above 50행 중 31행이 수직 높이와 10 mm 넘게 다름, 예 WID-WEB-A_1 엔진 343 ↔ 실제 271). **엔진 수정(같은 날, 사용자 지시)**: 높이 = POS1–POS2 직선에서 POS4(POS1 쪽)·POS3(POS2 쪽)까지 수직 거리(CAD Height 와 일치, `Core/Model/PlateAboveGeometry` + 테스트), 조각마다 두 끝 사이 보간 — `PlateTaperKeys` 를 ExtraData 에 싣고 05_MeshRefinement 마지막 sub-stage `PlateTaperHeightModifier` 가 T 단면 H 만 바꾼다(단계 수·요소 수 불변). Studio `sectionSketch.aboveHeights` 가 사본. NewCase_01 실측: T 요소 145개 H 변경(E2526 25 → 165.5), 판정 OK 1,821→1,819 · 재질 변경 26→27 · NOT OK 35→36(E610·E3175 OK→재질 변경, E2484 재질 변경→NOT OK), 최대 Usage 6.504 그대로. 70 InHouse 교체(sha256 6133e058…, 백업 `.bak_20261103_before_plate_taper`), 145 미반영.
- **부재 출신 기록 오류 수정 (엔진, 같은 날)** — `ModelDiffTracer.FindParent` 가 겹친 부재(같은 선 위 아래 판·위 판)를 위치만으로 골라 동점이면 먼저 나온 행이 이겼다 → 샘플 135개 요소의 출신 행이 남의 행. 출신 기록을 따르는 **재질표(MEMBER_MATERIAL)도 133개가 남의 행 등급**이었고, 행 편집·element_names 도 틀렸다(샘플 NewCase_01 은 판정 변화 0, Usage 만 일부 변화). 이제 같은 단면·같은 부재 이름(ExtraData ID) 후보를 먼저 고른다(`OverlappingMembers_ChildKeepsOwnRow`, 수정 전 실패 확인). build-full 이 `[origin-check] 출신 행 이름 불일치 N건` 을 찍는다(0 이 정상). 모델(BDF)은 바이트 동일. 70 InHouse sha256 d9a75bd6…(백업 `.bak_20261103_before_origin_fix`). 옛 결과는 모델을 다시 만들어야 고쳐진다.
- **전 과정 검증·현업 검토 (2026-11-03 끝)** — 샘플 6건(중복 제거) 모두 build-full→Studio 자료→해석→판정 통과(FATAL 0, 평형 잔차 ≤5e-7, 하중 = SWL×9806.65×1.25 정확, Studio 경로 ↔ 엔진 CalcVerify 응력 차 0.01 MPa, 보고서 C01 47쪽 판정 건수 일치, 행 편집 대상 정확). **결론: 공식 판정 발행은 아직 불가, 예비 검토로만 조건부.** 남은 결함 — 입력에서 행을 통째로 복사하면 강성이 2배인데 경고 없음(C05P 75행, KeepAsDuplicates) · 0 하중 Winch 케이스가 다음 LoadCaseID 와 겹쳐 이름이 틀리게 보임(C03 1003 이 'CableLifter') · MF 하중 CSV 끝 설명 글이 Studio 에 행·유령 케이스 '0' 으로 들어옴(라우터 DictReader) · 위·아래 판이 같은 절점이면 출신 기록 1건 남음(C04) · 결과 JSON propertyId ≠ BDF PID. 공학 쪽 P0 = ADEQUATE 문구가 해 건전성과 무관(9-07 P0-4) · 보고서 실행 묶음(P0-3) · 약축 굽힘 제외 근거(갑판 판 요소 없음) · 하중 방향이 RigidRange 첫 변 기준(실제 로프 방향 아님) · 하중 기준 1.25×SWL 고정 · 자동 6자유도 구속. 가장 싼 결정적 검증 = 기존 제출 계산서(3445 AFT `csv/NewCase_04`, 3496 FORE `csv/NewCase_03`)와 같은 입력 비교(아직 한 적 없음). C03·C04 Winch 입력 700~1350 t 은 단위 확인 필요.
- **사용자 결정·후속 수정 (같은 날)** — 결정: Winch 입력은 **ton 이 맞다**(실입력 F1 = 69 t; 테스트 CSV 700 은 옛 계산서 kN 값을 옮긴 것) · 하중 방향(RigidRange 첫 변) 유지 · 자동 구속 유지 · **강축 굽힘만으로 판정이 현 평가 방식** · 테스트 CSV 는 공학적으로 불완전할 수 있다. 수정(엔진 70 InHouse sha256 610d0609…, 백업 `.bak_20261103_before_dup_zero_hold` / Studio 0.1.84 / 백엔드):
  ① 통째로 복사된 부재 행(PLATE·BRACKET·FLATBAR·ANGLE·TBAR, 칸 내용 같음)은 앞 행만 쓰고 `DuplicateRow` 로 뺀다(`StructureCsvParser.RowKey`) — 누락과 따로 `caseFacts.duplicateRows` → 진단 `INPUT_ROW_DUPLICATE`, CSV 표 '중복 행 · 뺌(N행)'. C05P 75행·C01 2행(333·408) 제외, C05P 142행 OK 0.54 → 재질 변경 1.01(전에는 강성 2배로 덜 보수적).
  ② 하중 0 Winch 케이스는 해석 케이스를 만들지 않고 하중표 LoadCaseID `-` + 경고 `WINCH_ZERO_LOAD_CASE`, Studio Loads 패널·Winch 표에 '해석 제외' 로 따로 보인다(전에는 번호를 안 올려 다음 케이스와 같은 번호).
  ③ MF 하중표 부록은 `Report_LoadCalculation_MF_Method.txt` 로 분리, 백엔드 `clean_load_rows` 와 Studio 가 옛 결과의 잡행·유령 케이스 '0' 도 거른다.
  ④ 01 정렬이 자식 끝을 부모 선분 밖으로 당기는 경우 같은 단면·이름 부모를 겹침(≥50%)으로 인정(`ModelDiffTracer.MostlyOverlaps`) — 6건 모두 origin-check 0.
  ⑤ 보고서 결론: 해가 건전하지 않거나(FATAL·특이·평형) 적합인데 하중 없는 fitting 이 있으면 ADEQUATE 대신 'ASSESSMENT ON HOLD'(`ReportSheet.VerdictHold`). 보류 경로는 실제 보고서로 확인 못 함(샘플 중 해당 케이스 없음).
- **갑판 두께 = 행의 부착판 두께(26번째 칸)** (2026-11-03 사용자 결정, 예전 10 mm 고정) — 칸이 없는 PLATE·BRACKET 행은 보강재 행 값의 중앙값. SF 는 WorkBench 화면 입력칸이 이미 있다(기본 1.25). 엔진 70 InHouse sha256 6a5dd152…(백업 `.bak_20261103_before_fiber_grade`), Studio 0.1.85(정보 패널에 '보강재 AH σy 315 · 갑판 A σy 235').
- **PLATE below = 면재 없는 T · Chock 두 가닥 (2026-11-03 사용자 결정)** — ① 90×10 면재는 근거 없는 초기 가정이었다(첫 커밋부터, 출처 없음) → `PbeamlDimMapper.PlateBelowToTBeam` [유효폭, 갑판+높이, 갑판, 두께]. 백엔드 `_new_dims`·Studio `rowDims` 는 옛 결과(I)와 새 결과(T) 둘 다 받는다. ② Chock 은 도면('IN HORIZONTAL / VERTICAL LOAD')대로 두 가닥 동시 — LC1 수평 = P·t + P·(n 을 a° t 쪽으로), LC2 수직 = (0,0,−P) + P·(−n), n = v1, t = (0,0,1)×n. **CSV b·c 칸은 쓰지 않는다**(사용자 지시). 하중 합력 점검은 `MooringLoadGenerator.ForcesPer`(CHOCK 4). ③ Roller 는 도면 정의(두 가닥 사이 각 α, 합력 2P·cos(α/2))와 이미 같아 그대로 — 3496 계산서 F08 은 α=144 와 맞지 않는 값(약 58°)을 썼다. 3496 FORE 결과: NOT OK 10 → 22(PLATE below 6 → 17), 재질 변경 20 → 18, 최대 1.711 → 1.815. 엔진 70 InHouse sha256 f9105a0b…(백업 `.bak_20261103_before_envelope` — 부재 집계를 최악 판정 순으로 고친 Envelope 포함, 커밋 전 리뷰 2026-11-03), Studio 0.1.86.
- **릴리스 (2026-11-04)** — Studio **0.1.87 = 릴리스 표**(`ad73a92`, 설명서 문서버전 03·04 기준 버전). MF 출처 `release\` 폴더는 0.1.73 에서 멈춰 있어 `dist` 를 메모리에서 zip 으로 묶어 UNC 에 직접 썼다(`reference_studio_release_drm_zip`). 사용자가 145 ⟳ Update 후 화면 확인(엔진 exe 교체 여부는 미확인).
  사용 설명서 = `outputs/MF-manual/MooringFitting_사용설명서_문서버전04.pdf`(2026-11-04, 문장 다듬기·내부 동작 설명 정리). 같은 폴더의 문서버전03 은 DRM 잠금으로 못 옮겨 `이전본\` 에 복사만 했다.
- **남은 일 (2026-11-04 갱신)** — ① 커밋: 엔진(MooringFitting, 로컬 git·원격 없음)·Studio(MooringFittingStudio, 로컬 git, 스냅숏 `6b323e9` 이후 0.1.74~0.1.87 전부) 미커밋. WorkBench 는 `79eff65` 로 대부분 커밋됐고, **해석 뒤 WorkBench 판정**(백엔드 `solve-summary` API·`mooring_solve.summary.json`, 프론트 `MooringFittingAssessment.jsx`·`mooringVerdict.js`, 테스트)만 미커밋 — 커밋 전 `hitess-code-reviewer` 1회, 반영은 145 재시작 + exe 릴리스(설명서 03·04 에 이미 적힌 동작). ② 145: 엔진 exe(sha256 f9105a0b…) 교체 확인. OP2 받기는 1.7.0 exe 부터. ③ 실제 ton 단위 Winch 가 든 CSV 로 3445·3496 계산서와 다시 비교(이번 비교는 테스트 CSV Winch 가 kN 값이라 무효) — ±15% 안에 들어오기 전에는 공식 판정 발행 금지. ④ 보고서 'ASSESSMENT ON HOLD' 경로·chock 새 문구가 든 보고서는 실제로 열어 보지 않음. ⑤ 결과 JSON propertyId ≠ BDF PID(잠재, 미수정).
- **기존 제출 계산서 비교 (같은 날, 에이전트)** — 3445 AFT(SeaTrust-Frame3D) = C04, 3496 FORE(Nauticus 3D-Beam) = C02. 하중 크기는 Bollard·Roller 1.00(3496 은 SF 1.15 라 1.087). **응력은 대부분 1.4~4.5배 높게 나와 ±15% 재현 못 함.** 주원인 후보: PLATE below 면재 90×10 고정(실제 150×16 등) · 갑판 두께 10 mm 고정(CSV 12.5) · 등급을 보강재·부착판 중 낮은 쪽(계산서는 보강재 HT32 315) · SF 1.25 고정(3496 은 1.15) · Chock 두 가닥 합력·수직+수평 동시(계산서) vs P 하나 따로(도구) · Roller 각도 해석 차(F08 0.38배, S04 방향 반대). Towing·ETS 케이스·fairlead 행 없음. 원문 추출 `scratchpad/bench`(세션 한정).
- **부식 마진 반영 (2026-11-12, 엔진·백엔드·Studio 0.1.88, 70 만·미커밋)** — 구조 CSV 2번째 줄 `corrosion,값`(mm, 양면 합계 tc)을 엔진이 모든 판 두께(웹, 면재, 부착 갑판, PLATE 판)에서 한 번 뺀다(높이와 폭 그대로, 강성과 응력 모두 순두께). 예전에는 이 줄을 버려 총두께 판정이었다.
  값은 CSV 그대로, IACS UR A2.4 최소 2.0 mm 미만이면 경고만(사용자 결정). 공제 원본 = `MODEL_EVIDENCE caseFacts.corrosionMm/corrosionSource`(없으면 옛 결과 = 총두께).
  ⚠ 백엔드 `mooring_row_edit._new_dims` 와 Studio `rowDims` 도 같은 tc 를 빼야 한다 — 빠지면 '이 행 단면' 검사가 모두 거짓이 되어 크기 편집이 조용히 건너뛰어진다. Studio 는 상단 칩과 Model 탭에 지정 값을 보인다.
- **구조도 표기 단면 이름 (2026-11-12, 현업 신고 3번, 엔진·Studio 0.1.90, 70 만·미커밋)** — 보고서 6장 표와 Studio 정보 패널의 단면 이름을 CSV 값으로 되짚어 쓴다:
  ANGLE `150x90x12 UA`(두께가 다르면 `13/17`, 사용자 결정) · TBAR `200x12+100x10 (T)` · FLATBAR, PLATE `600x11 FB`. 갑판은 빼고 두께는 부식 마진을 더한 총두께.
  예전 `FB 613x25`·`I 163x90x12/12` 는 갑판 두께가 높이에 더해져 어떤 부재인지 몰랐다. 원본 = 엔진 `ProfileInfo.ShortLabel`(행 종류 = 출신 기록 rawKind), 사본 = Studio `utils/shipLabel.js`(한쪽을 고치면 양쪽 다).
  보고서 표의 'Section'·'Size' 칸은 줄을 접지 않는다(`ReportSheet.NoWrap` — 접으면 `250x90x10/1` 처럼 숫자 가운데서 끊겼다).
  같은 신고의 2번(면재 누락)은 CSV `PLATE below` 행에 면재 칸이 없어서 생긴 입력 문제로 회신, 5번(부재 나누기, 새 부재)은 미착수.
- **부재 분할 · 부재 추가 (2026-11-12, 같은 신고 5번, bridge·백엔드·엔진 보고서·Studio 0.1.91, 70 만·미커밋)** — 11-03 '노드 편집은 MF 에 넣지 않는다' 결정을 이 두 가지에 한해 바꿨다(BDF 전용 수정).
  bridge intent `splitElement { elementId, newNodeId, newElementId, ratio | x,y,z }` · `addElement { elementId, startNode, endNode, refElementId, propertyId?, grades? }`(MB·MU 와 같은 이름).
  ⚠ 70 백엔드는 `WorkBenchSubModule/Nastran_bridge` 사본을 import 하고 145 는 InHouse 사본을 쓴다 — bridge 를 고치면 두 사본을 같게 둘 것.
  ⚠ 해석 BDF(`_build_solvable_edited_bdf`)는 출처(reinforceOf / splitOf / addedFrom) 없는 새 요소를 만나면 멈춘다(예전엔 조용히 건너뛰어 화면의 부재가 해석에서 빠질 수 있었다).
  계획과 상태 = `docs/plans/2026-11-12-mf-split-add-member-plan.md`.
- **해석할 하중 범위 (2026-11-12, 같은 신고 4번, 엔진·백엔드·WorkBench 프론트, 70 만·미커밋)** — `build-full --loads=all|mf|winch`(엔진 `Commands/LoadScope.cs`).
  winch = 구조 CSV 의 MF 행을 쓰지 않음(MF 받침 RBE 도 안 만듦, MF 행을 지운 것과 같다) · mf = Winch 하중 케이스를 비움. 고른 범위에 하중이 없으면 exit 2.
  백엔드: 요청 `load_scope` Form, Load CSV 는 mf 일 때만 생략 가능(주석 한 줄 빈 파일을 대신 둔다), `input_info.load_scope`(재실행 이어받음).
  ⚠ 옛 엔진은 `--loads` 를 조용히 무시해 전체로 풀리므로 `engine_supports_load_scope`(사용법 출력에 `--loads=`)가 거짓이면 실행하지 않고 '엔진 교체 필요' 로 실패한다.
  진단 `LOAD_SCOPE`(범위로 뺀 하중을 '입력 없음' 으로 말하지 않음), 보고서 1.2 에 범위 문장, `caseFacts.loadScope`. 화면 = 왼쪽 레일 '해석할 하중' [전체 | MF 만 | Winch 만](`utils/mooringLoadScope.js`).
  확인: NewCase_04 all 58 = mf 18 + winch 40 하중, 백엔드 작업 함수로 실제 exe 실행. WorkBench 화면은 눈으로 확인 안 함(빌드만). 사용 설명서(MF-manual)의 '별도 해석 불가' 문장은 아직 옛 내용.
- **MB·MU 뷰어 규칙 들여오기와 전반 검토 (2026-11-12~13, Studio 0.1.93~0.1.97, 70 만·미커밋)** — 판정과 근거 = 싱크 대장 24~46번(`docs/standards/studio-pair-sync.md`).
  0.1.93~0.1.94: 노드 = 화면 고정 구(Edit 탭은 늘 켬, 다른 탭 기본 끔) · 편집으로 카메라가 돌아가지 않음 · 새 노드와 나눈 조각 표시(`three/MemberEditOverlay.js`) · 작업 패널 결과 줄 · 선택 = 흰색 · 알림 칩.
  0.1.95(헤드리스 1600, 1280 캡처로 전 탭 검토): 작업 패널 = 왼쪽 아래, 범례 = 아래 오른쪽 · **Edit 에 들어오면 아래 도크의 하중 표는 접고 Loads 에서 다시 폄**(구조 CSV, 결과 표는 그대로) ·
  노드 크기 자동 맞춤(`NodeMesh.fitNodePx`)과 하중 화살표 머리 30px 상한(`three/arrowFit.js`) · 작업 패널 중 오른쪽 클릭 = 빼기 · 되돌리기로 없어진 노드를 고르던 칸에서 자동으로 뺌(`store/pruneOnEdit.js`) ·
  RBE 연결 이름표(독립, 종속, 빠짐, 새 독립 노드) · 앱 안 확인 창(`ConfirmDialog`·`useConfirmStore` 는 MB·MU 와 `same`).
  0.1.96: **누른 대상의 말풍선이 그 대상 옆에 고정**(`three/pinnedTip.js` — 3D 점에 묶여 화면을 돌려도 따라옴, 부재는 정응력과 전단, 판정 줄 추가, Esc 나 다른 곳 클릭으로 거둠). 마우스를 올리는 말풍선은 그대로.
  0.1.97(2026-11-13, 사용자 요청 'RBE 추가와 제거, 다른 Edit 패널도 MU 컨셉으로'): **Edit 작업 패널을 MU 방식으로** — RBE 연결은 고른 노드를 줄로 보이고(좌표, 경계조건, 다른 RBE 꼬리표, [보기], [×]),
  3개 이상이면 [중심에 새 독립 노드 | 고른 노드를 독립으로], 독립은 줄 클릭이나 3D Alt+클릭(규칙 `utils/rigidCheck.js` `connectShape`, 서버 변경 없음 — bridge 가 `independentNode + dependentNodes[…]` 를 이미 받음).
  RBE 수정과 삭제는 진행 단계, 번호로 고르기, 번호 칩, [처음 상태로]. 3D 색 = 독립 주황, 종속 파랑, 넣을 노드 초록, 뺄 노드 빨강(`data/rigidEditColors.js` 는 MB, MU 와 `same`).
  **부재 추가의 단면을 목록에서 찾기**([참조 부재 누르기 | 단면 목록에서 찾기] — 고르면 새 부재 자리에 가장 가까운 같은 단면 부재가 참조, `utils/propertyChoices.js`, 서버 규칙 그대로).
  Edit 탭에서 노드가 보이는데 눌러 고를 수 없던 결함(0.1.94~0.1.96, 노드 레이어 기본 끔의 부작용)도 고침.
  확인: Studio 시험 79, lint, 빌드, 헤드리스 동작 검사(말풍선, Alt+클릭, 오른쪽 클릭은 실제 마우스로), 1600과 1280 캡처. WorkBench 앱 안 화면은 확인 안 함. 0.1.97 zip 은 70 로컬에 저장하고 직접 열어 확인(그때 9091 이 꺼져 있어 manifest 주소는 확인 안 함).
  0.1.98(2026-11-16): 분할 조각과 새 부재가 3D 단면에서 하늘색으로 따로 그려지던 결함 — 화면용 모델(`data/editedStage.js`)이 새 노드·조각·새 부재를 연결 그룹에 넣지 않아 그룹 0(기본색, 그룹 숨기기 무시)이었다. 조각·새 노드 = 나눈 부재의 그룹, 새 부재 = 시작 노드 → 끝 노드 → 참조 부재의 그룹. 시험 `data/editedStage.test.js`, 사용자가 70 앱에서 노란색 확인.
  **145 공개 준비 (2026-11-16)**: 릴리스 표 0.1.87 → **0.1.98**(`32929e3`, UNC 업로드 검증 MATCH — dist 를 메모리에서 묶어 UNC 에 직접 씀, 출처 release 폴더는 0.1.94 에서 멈춤) ·
  MF 백엔드와 화면 커밋 `19cda8b`(커밋 전 리뷰 반영: 참조 복사 클론 등급은 grades.json 에 넣지 않고 엔진 reinforceOf 상속에 맡김 — 행 등급 편집을 따라가게) · **WorkBench 1.7.25**(`424f4f9`, '해석할 하중' 화면) ·
  업데이트 안내 `/updates/2026-11-16-mf-field-requests` · 현업 회신 메일은 Outlook 초안만(발송은 사용자, 145 반영과 exe 배포 뒤).
  145 순서 = ⟳ Update + 백엔드 재시작 → InHouse `MooringFitting.exe`(sha256 7cfb7d9a…)·`NastranBridge/nastran_bridge.py`(9d442686…) 수동 교체 → exe 1.7.25 배포. 전부 사용자 몫, 아직 안 함.
  ⚠ 안내와 메일의 부재 추가 그림은 0.1.98 이전 캡처를 잘라 하늘색 결함 부분을 뺐다. MF 엔진(`MooringFitting`)과 Studio 저장소의 0.1.98 이후 커밋은 아직 없음(로컬 스냅숏 `93b6ee5`·`0174b89` 이후 미커밋).
  남은 결정: 노드 자동 맞춤을 MB·MU 로 옮길지.
  **설명서 패널 (2026-11-16, MF 0.1.99 · 릴리스 표 0.1.99 `362889a` · Studio 로컬 커밋 `82b693b` · 설명서와 배너 `947f2aa`)** — MB, MU 와 같은 방식. 업데이트 안내에 6번 구획 추가.
  설명서 **문서버전 05**(기준 0.1.98): 부식 마진, 구조도 표기, 해석할 하중, 부재 분할과 추가 쪽 신설(`split`), RBE 연결과 수정 새 패널, 고정 말풍선, 문제 해결 4줄. 샘플은 지금 엔진으로 다시 만들어(`solve_mf.py` 는 **절대 경로**로 — 스크립트가 먼저 chdir 한다, 뷰어 자료에 corrosion 추가) Studio 화면 전부 다시 찍음. 옛 그림·자료 = `MF-manual/source/hi_bak_0187`·`data_bak_0187`.
  WorkBench 캡처는 입력 화면만 새로(`CLIPS` 환경 변수로 자를 범위 — 값이 파일에 없다, 입력 화면 = `{"x":284,"y":176,"width":1274,"height":566}`), 나머지는 옛 그림 그대로.
  `publish.py MF` → 백엔드 `Manuals/mooring-fitting/`(git 추적) + Studio `public/manual/`. Studio: `components/help/ManualDock.jsx`(MU 사본, 도크 폭 상수만 MF) · `data/manualSections.js`(+시험, 탭 → 쪽 id) · `useHelpStore`(MU 판, 키 `mf.manualDock.v1`) · 상단 탭 줄 뒤 [설명서](`.ribbon-manual`) · 도움말 창 '사용 설명서' · 3D 가 640px 미만이면 도구줄 아이콘만(container query).
  WorkBench MF 배너 `StudioManualButton manualId="mooring-fitting"`(다음 exe) · `test_manuals` 에 MF 추가. 헤드리스로 패널 열기와 탭 따라가기(`#loads`) 확인, WorkBench 앱 안은 확인 안 함.
  145 반영 = ⟳ Update(설명서, 안내, 릴리스 표 — 사용자 몫) → 다음 exe(배너 버튼). 설명서 기준 버전은 0.1.99 로 맞춤(커밋 전 리뷰).

  계획, 비교 결과, 남은 일 = `docs/plans/2026-11-12-mf-corrosion-margin-plan.md`. 70 InHouse exe 백업 `.bak_20261112_before_corrosion`. 145 순서 = 백엔드 pull+재시작 → exe 교체 → `/studio-release mooring-fitting-studio`.
- **구조 CSV 탭 (Studio 0.1.82, 0.1.83 원문 시트로)** — 아래 도크 '구조 CSV': CSV 원문을 줄·칸 그대로(행 = 파일 줄 = 엑셀 행 번호, 열 = A, B, C…, 머리글·corrosion·MF 줄 포함, 편집 예정 칸은 새 값 강조) + 오른쪽 고정 '모델 대응'(조각 수·상태·고치기). 원문은 백엔드가 `csv_rows.json` 의 `lines`(`mooring_row_edit.read_csv_lines`)로 싣는다 — 옛 백엔드면 부재 행만 보이고 안내가 뜬다. MF 줄 클릭 = 그 좌표에 가장 가까운 절점으로. 행 클릭 = 그 행 조각 전부 선택 + 행 양 끝으로 카메라, 3D 부재 클릭 = 그 행 강조, [고치기] = Edit 단면·재질로. 상태 = 정상/편집됨/다른 행 단면/모델에 없음(샘플 5행 — 같은 좌표의 다른 행과 합쳐짐 등). MB CSV 탭의 제외 행 상자·끊김 표시는 MF 에 쓸 일이 없어 넣지 않았다. 규칙 `utils/csvTable.js`+테스트. PLATE below 칸 대응(Width = POS1–POS2 길이라 미사용, Height = 웹 높이, THK = 웹 두께, 면재 90×10·갑판 유효폭은 엔진 가정)은 사용자 정의와 일치 확인 ② 해석 중 전체 화면 안내(`SolveProgressOverlay`, Esc = 뒤에서 계속 → 창 맨 위 진행 막대, 상단 '해석 중' 누르면 다시 펼침) ③ 단면·재질 작업 패널에 단면 그림 — 입력칸 번호 ↔ 그림 부위, 바꾸면 점선(지금)/채움(바뀔 단면) 비교 + PBEAML 치수 변화 ④ 결과 색이 안 보이던 것 — 빨간 절점 1,900개가 1px 부재 색을 덮었다(MU 와 같은 교훈) → 결과 표시 중 절점 회색·반투명, 해석 완료 시 07 단계·색 표시를 켠다. 탭에 따라 색이 안 입혀지는 현상은 재현 못 함(어느 탭이든 색은 입혀짐을 확인). 개발 모드에서 3D 첫 화면이 비던 원인 = StrictMode 재마운트 때 정리 코드가 예약 번호를 비우지 않아 다시 그리기가 막힘(배포본 무관, 수정).
- 사용자 결정: **다크 전용**(라이트 토글 삭제, MB·MU 와 같음) · MF 전용 탭 이름 `Loads` 유지. 셸 CSS `zoom`(useUiScale)은 배율이 두 번 곱해지는 문제(MU 0.0.148 기록)로 걷고 미디어쿼리로 바꿨다.
- 3D: 직교(기본)/원근 · 노드 = 화면 고정 4px 점(고르기는 `three/screenPick.js` 화면 거리) · 호버 말풍선 · Shift+드래그 사각형 · 선택 필터 · 선택만 보기 · 잘라 보기 · X-ray · 찾기(Ctrl+F, `data/findEntity.js` 는 MB 원본 무수정 사본 — 한쪽 고치면 세 곳) · Model Check 진단 표식.
- 편집: 뷰포트 왼쪽 도구 막대 5개(단면·재질 · 참조 복사 · RBE 연결 · RBE 수정 · 그룹 삭제) + 아래쪽 작업 패널(`edit/WorkPanelFrame`) · Ctrl+Z/Y · 참조 복사는 `batchId` 로 함께 지움 · RBE 연결 전 종속 중복은 막고 독립 노드 사슬은 병합 안내(`utils/rigidCheck.js`) · 수정 내역 저장·불러오기(모델 지문이 다르면 경고) · CSV 로 안 돌아가는 수정 수를 상태 줄에 표시. 노드·질량 편집은 MF 에 넣지 않는다(CSV 재빌드와 어긋남).
- **낡은 결과(P0-2, Studio 쪽)**: 결과에 입력 지문(수정 내역 + γM, `utils/resultFreshness.js`)을 붙여 바뀌면 '결과 낡음' 표시 · 보고서 단추와 `useReportStore.generate` 가 막는다. 서버 쪽 결과·보고서 묶음(P0-3)은 그대로다.
- **T 단면 3D 두께 뒤바뀜 수정** — 엔진 `PbeamlDimMapper` T = [플랜지 폭, 높이, 플랜지 두께, 웹 두께]. 표시만 틀렸고 해석값 영향 없음(`three/sectionShapes.test.js`).
- 실패 위치 안내: 백엔드 `mooring_fitting_service._solve_failure_message` 가 실패 문구 첫 줄에 `위치 후보 절점: …`(이번 실행 F06 만), 다음 줄에 엔진 '• 원인·조치' 를 싣는다(예전엔 job.message 가 고정 문구라 Studio 의 원인 상자가 늘 비었다). Studio `utils/solveFailure.js` 가 읽어 표식·이전/다음.
- OP2 받기: `GET /api/analysis/mooring-fitting/op2?output_dir=` + Electron `viewer:downloadMooringOp2`(**exe 재빌드 필요**, 옛 exe 면 '앱 업데이트 필요' 안내).
- 도움말: `data/helpContent.js`(MF 내용) + MU `components/help/*` 사본, `utils/theme.js` 는 MU 색 이름표 → MF CSS 변수 연결뿐. 테스트가 설명 없는 data-help 를 잡는다. Studio 테스트 `npm test`(38건).
- 화면은 Chrome 헤드리스 + 실제 viewer-zip 자료로 탭·도크·편집·찾기·도움말을 눌러 확인. WorkBench 앱 안 실행·실제 해석 실패 F06 으로 위치 안내·OP2 실제 저장은 확인 안 함. 헤드리스에서는 개편 전 코드도 첫 화면 3D 가 조작 전까지 비어 보인다(환경 특성으로 판단, 앱에서 확인 필요).
- **MF 고정 범위 겹침 문구 (2026-11-19, 현업 신고 3606)** — 같은 이름 MF 두 줄(파서가 `MF-S07A`, `MF-S07B` 로 나눔)의 RigidRange 가 한 변을 같이 써서 경계 절점이 두 RBE2 에 묶이자 06_LoadGen 이 `double dependency` 로 멈췄다. 예전 문구에는 위치가 없었다(엔진 log 는 `MooringFittingConnectionSubStage` 에서 버려짐).
  **자동 해결(같은 날, 사용자 결정 A안)**: 이제 멈추지 않는다. 공유 절점은 **장비 위치(CSV Location, XY)가 더 가까운 MF** 에만 남기고(같으면 고정 범위 거리, 그다음 CSV 앞 행), 06 진단 `MF_RIGID_SHARED_NODE`(절점마다 Warning) → `MODEL_EVIDENCE caseFacts.rigidSharedNodes[{nodeId,message}]` → 백엔드 `mooring_diagnosis` 케이스 진단 → Studio 진단 목록(Studio 코드 변경 없음). 공유 절점을 모두 넘겨 종속점이 0 이 된 MF 가 생기면(같은 장비를 두 줄로 넣은 경우 등) 위치를 담아 멈춘다 — 그대로 두면 그 MF 의 하중이 알림 없이 빠진다(커밋 전 리뷰 지적, `MFCONN_SKIPPED` 는 백엔드와 Studio 가 읽지 않음).
  범위 거리 우선 규칙은 시험해 보고 버렸다 — 신고 사례에서 S07A 에 절점 1개만 남았다. 해결 뒤에도 겹치면 `ValidateRigidDependencies` 가 위치(MF 쌍, CSV 행, 절점 좌표)를 담은 문구로 멈춘다(마지막 안전망).
  확인: 엔진 시험 109, 백엔드 mooring 시험 171 통과. 신고 CSV(3606) build-full --solve 성공, F06 FATAL 0, 절점 79 → MF-S07A. NewCase_01~04 BDF 옛 exe 와 바이트 동일.
  70 InHouse sha256 5c0d5ec3e7d2e942…(백업 `.bak_20261119_before_rigid_overlap_msg` = 이날 이전 원본). 145 = exe 수동 교체 + 백엔드 `git pull` 재시작(옛 엔진이면 진단만 안 뜸). 업데이트 안내만 커밋 `3050c55`(사용자 지시), 엔진과 진단 백엔드는 미커밋. 진단 등급은 '확정' 이라 맞닿은 배치는 WorkBench 판정이 '검토 필요' 가 된다(등급 결정 대기). WorkBench 앱과 Studio 화면에서 진단이 뜨는 것은 눈으로 확인 안 함.
