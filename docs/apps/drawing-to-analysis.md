# DrawingToAnalysis (LugShell)

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### DrawingToAnalysis — 새 러그 엔진(LugShell) 연결 (2026-11-10~, WorkBench `5af8bfd`·`32e316f`)

엔진 저장소 `WorkBenchSubModule\DrawingToAnalysis`(로컬 git, 원격 없음)에 LugShell 을 `lugshell/` 로 병합했다(git subtree) — 상세는 그 저장소 CLAUDE.md '★LugShell 병합'.
사내 치공구표준집 L형(lap) 러그 실도면을 읽는다: 선 글자 인식 → 치수 연결 → 설계 JSON(`review[]`) → gmsh 메시·BDF(하중 케이스 3개 + lap 구역 고정) → 수계산.
- exe: `DrawingToAnalysis.exe lugshell --pdf … --out-dir … --page N --src-name <원래 이름>` (gmsh DLL 포함, 123 MB). 결과 = `lug_design.json`·`lug_trace.json`·`lug_model.bdf`·`mesh_preview.png`·`lug_report.json`·`lug_handcalc.json`, 종료 코드 2 = 지원 안 하는 형식, 3 = 모델 검증 실패.
- 백엔드 `drawing_to_analysis_service.py`: Lug 모드에서 `engine_supports_lugshell(exe)`(`--help`, exe 수정 시각 캐시)가 참이면 새 명령, 아니면 옛 `all` — **서버 반영 순서가 바뀌어도 안 깨진다**. `result_info.engine='lugshell'` + `lugshell` 요약(review·핵심 치수·수계산 최대 UC). 변환 요청에 `page`.
  해석 `use_model_loads=true` = BDF 하중·경계 그대로, 출력 요청만 F06 인쇄(`with_print_outputs`, CORNER 응력 요청은 빠짐). 시험 `tests/test_drawing_lugshell.py`.
- 화면 `DrawingToAnalysis.jsx`: 쪽 번호 칸 · 새 엔진 결과면 `components/analysis/LugshellReviewPanel.jsx`(확인 항목) + [모델 하중으로 해석], 옛 파라미터·하중/경계 탭 숨김, Y↔Z 표시 교환 안 함(모델이 처음부터 X-Z).
- 확인(70): 백엔드 작업 함수를 실제 exe·Nastran 으로 끝까지(L-25: 변환 성공 → 해석 3케이스, 최대 VM 220.7/225.2/275.8) · 프론트 빌드·유틸 시험 437 · lugshell 회귀 17. **WorkBench 앱 안 화면은 눈으로 확인 안 함.**
- InHouse 70 교체: `InHouseProgram\DrawingToAnalysis\DrawingToAnalysis.exe`(백업 `.bak_20261110_before_lugshell`). **145 반영**: exe 교체(git 미추적) + `git pull`·재시작(백엔드) + 다음 WorkBench exe(화면). 서버 실도면 PDF 는 업로드 경로로 평문이 된다.
- 판정 기준(D4)·lap 구역 경계(D6)·DAF/하중 각도/핀 지름은 아직 임시값 — 화면 '확인 항목'에 그대로 보인다.
- **D형 러그 (2026-11-12, 엔진 `b04908e`)** — 템플릿 `d_type_lug` 로 치공구표준집 D-25·D-35 가 '바로 변환'(색인 7종). 엔진 `lugshell --template` 기본값이 `auto`(L형 → D형 순으로 시도)라 **백엔드 수정 없음**.
  D형 모델 = 본판 + 덧판 2 + 브래킷 4, 갑판 없이 바닥 고정. 하중 4케이스(수직·면내 45°·90°·면외 10°)·DAF 1·용접 없음은 '확인 항목'. 수계산 하단 단면은 브래킷 밑변 합성(D-25 최대 UC 0.48, 예전 식이면 1.70 NG).
  확인(70): exe 로 D-25·D-35·L-25(UC 0.77 그대로)·D-16(종료 2), 백엔드 `lugshell_summary`·`with_print_outputs` → Nastran FATAL 0. 앱 안 화면은 눈으로 확인 안 함.
  70 InHouse exe 교체 sha256 14e53f0a…(백업 `.bak_20261112_before_dtype`, 리뷰 반영 뒤 다시 빌드). **145**: exe 교체 + `git pull`(색인 `DrawingBook/book_index.json`, 재시작 불필요).
  같은 날: Nastran 은 한글·작은따옴표가 든 폴더 이름에서 FATAL 1019(파일 못 엶) — 백엔드 작업 폴더는 영문이라 무관, 손으로 돌릴 때만 주의.
- **D-50~D-100 추가 (2026-11-12 오후)** — 옆이 오목 원호인 D형 4종이 '바로 변환'(색인 11종). 백엔드 수정 없음(색인과 시험 기대 목록만).
  D-75·D-85 는 도면이 축척대로 그려지지 않아 값은 글자, 기하 대조 어긋남이 '확인 항목'에 많이 뜬다(`scale_nts`). 자중은 네 장 모두 1~2% 안.
  **D-16 은 지원 안 함으로 막았다**(브래킷 2장이 앞뒤로 엇갈린 형식 — 4장 모델로 잘못 만들던 것을 숨은선·자중 10% 검사로 차단).
  확인(70): 새 exe 로 D-16(종료 2)·D-25·D-50~D-100·L-25 끝까지, 수계산 최대 UC 0.53/0.62/0.53/0.56, Nastran FATAL 0, 엔진 회귀·백엔드 시험 26건. 앱 안 화면은 눈으로 확인 안 함.
  70 InHouse exe 교체 sha256 b0fc0b5b…(백업 `.bak_20261112_before_dtype_flank` = 14e53f0a…). **145**: exe 교체(b0fc0b5b…) **먼저** → `git pull`(색인).
- **치수 기반 재작도 (2026-11-12, 미커밋)** — 표준집 러그를 치수 파일(`DrawingBook/params/<기호>.json`, 11종)로 두고, 화면에서 3D 형상만 보며 치수를 고친 뒤 [해석 실행] 때만 메시와 해석.
  계획과 화면 흐름 = `docs/plans/2026-11-12-lug-param-catalogue-plan.md`. **도면 찾기 창은 고르기만**, 본창 왼쪽 단계 [치수 | 하중 및 경계 | 결과] + 가운데 [형상 | 해석 결과](`components/analysis/LugParamWork.jsx`),
  [해석 실행] = 변환 뒤 Nastran 자동 이어서, 케이스별 하중 크기 kN(`p_kn` → 그 케이스 swl_t). 사용자가 70 앱에서 끝까지 확인(2026-11-12).
  치수 → 형상은 엔진 `lugshell/lugshell/params/` 를 InHouse `DrawingToAnalysis/lugparams/`(git 미추적, `tools/export_lugparams.py`)로 복사해 백엔드가 import(`services/lug_params.py`). 엔진 params 를 고치면 다시 내보낼 것.
  **145 순서**: InHouse `lugparams/` 폴더 복사 → `git pull` → 백엔드 재시작(새 라우트) → 다음 WorkBench exe. 커밋 전 `hitess-code-reviewer` 미실행, 편집 화면 추가분(강조, 전체 화면, ② 단계)은 눈으로 확인 안 함.
- **T형 5종 · 결과 화면 정리 (2026-11-16, WorkBench `43dee72` · 엔진 `e8ee7b6`, 145 미반영)** — T-15~T-50 손 치수(`params/T-*.json`, 도면 찾기 '치수로 해석'), 면내 α ±180.
  결과 화면 = 응력 먼저, 케이스 요약 표(`SolveCaseSummary`), 늘 펼친 값 표, 행 클릭 = 3D 가 그 요소로(`ShellModelViewer` `focusRequest`/`onFocusDone`). 상세 = 계획 문서 'T형 진행'.
  ⚠ Job Center 조회(`GlobalJobPoller`)는 이제 최대 30분(`POLLING_POLICY.globalJobMaxRetries`) — 예전 3분에서 포기하면 그 Failed 가 페이지 저장 상태로 전해져 페이지 조회까지 멈추고 근거 없는 실패가 떴다(모든 앱 공통).
  ⚠ 이 서비스의 자식 실행(엔진 exe, bridge, Nastran)은 `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` — 서버 콘솔 창의 Ctrl+C 에 bridge 가 0xC000013A 로 죽어 모델 JSON 없이 '성공'한 일(11-16). 다른 서비스는 아직 그대로.
  **145 순서**: InHouse `DrawingToAnalysis.exe`(sha256 dfef832b…) + `lugparams/`(0.2) 먼저 → `git pull` + 재시작 → 새 exe.
- **T-5, T-10 과 A-15~A-50 (2026-11-17)** — 새 형식 `t_tilted_lug`(엔진 `254aacf`, WorkBench `d6e6f32`), `a_type_lug`(**미커밋**). 상세 = 계획 문서 'T-5 · T-10', 'A형' 절.
  치수 파일만 늘고 exe 는 그대로다(설계 JSON 은 서버가 만들어 `lugshell --design` 에 넘김) — 145 는 T형 exe 뒤 `lugparams/` 만 다시 복사(0.4).
  손 치수 자중 3% 규칙의 첫 예외: A-20(−6.4%), A-40(+8.0%)은 형상이 PDF 벡터와 맞아 도면 자중 표기 오차로 보고 `drawing_mass_note` 에 이유를 적는다(시험이 그때만 10%).
  치수가 없는 기하(기울기, 따낸 자리)는 PDF 벡터(`page.get_drawings()`)로 잰다 — 이 세션의 방법.
