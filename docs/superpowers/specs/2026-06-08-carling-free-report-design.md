# Carling Free Calculator — Excel 리포트 다운로드 (설계)

- 날짜: 2026-06-08
- 범위: Carling Free Calculator(Free 모드)만. Optimization은 추후 별도.
- 상태: 승인됨 → 구현 진행

## 목적

Carling Free Calculator 계산 결과를 사내 표준 Excel 리포트 템플릿에 채워
사용자가 WorkBench에서 다운로드할 수 있게 한다. 템플릿은 **HHI DRM 암호화** 상태.

## 실현 가능성 검증 결과 (완료)

| 항목 | 결과 |
|---|---|
| 파일 at-rest | DRM 암호화 (헤더 `HHIDRMC`) |
| openpyxl / zipfile 직접 열기 | ❌ `BadZipFile` |
| Excel COM(자동화)으로 열기 | ✅ 성공 (Excel.exe가 DRM 인가 프로세스) |
| 개발 PC Excel | ✅ 16.0, COM 동작 |

→ **유일한 경로: Excel COM 자동화.** openpyxl 불가.

## 아키텍처

```
CarlingCalculator.jsx (Free 결과) ──POST /api/carling/free/report (blob)──▶ routers/carling.py
        ▲                                                                         │
        │  blob 자동 다운로드                                                      ▼
        └──────────────────────────────────────  services/carling_report_service.py
                                                          │ 템플릿 선택, 작업폴더 생성, input.json 기록
                                                          │ subprocess(sys.executable, report_filler.py) — Excel COM 격리
                                                          ▼
                              InHouseProgram/CarlingCalculator/Report/report_filler.py
                              템플릿 열기(DRM 복호화)→셀 채우기→userConnection SaveAs(.xlsm)→Quit
```

핵심 결정:
- **subprocess 격리**: Excel COM을 장수명 FastAPI 워커에서 직접 돌리지 않고 단기 프로세스로 격리(코드베이스의 EXE 호출 관례와 동일, timeout-kill 가능).
- **pywin32 신규 의존성**: `WorkBenchEnv`에 설치, `requirements.txt` 추가. filler는 `win32com.client` 사용. 호출은 `sys.executable`.
- **on-demand**: 다운로드 버튼 클릭 시에만 생성.
- **계산 엔진 불변**: CarlingCalculator.exe 재빌드 불필요.
- 파일 반환은 `Response(bytes)` (StreamingResponse는 h11 버그로 회피).

## 셀 맵 (Report 시트, 두 템플릿 동일 레이아웃; 차이는 다이어그램 그림뿐)

좌측 입력/계산 (G열):
- G15 Load Type ← inputs.load.type
- G16 Force ← inputs.load.value
- G17 Length ← inputs.hull.stiffener_span_mm
- G18 Position a ← intermediate.position_a_mm  (Distributed면 공란)
- G19 Position b ← intermediate.position_b_mm  (Distributed면 공란)
- G21 Moment ← intermediate.moment_Nmm
- G22 Shear Force ← intermediate.shear_N
- G24 Effective Breadth ← intermediate.effective_breadth_mm
- G25 Thickness ← inputs.hull.plate_thickness_gross_mm
- G26 Net Thickness ← intermediate.net_thickness_mm
- G27 Area ← intermediate.area_mm2
- G28 Neutral Axis ← intermediate.neutral_axis_mm
- G29 Inertia ← intermediate.inertia_mm4
- G30 Section Modulus ← intermediate.section_modulus_mm3

우측 패널 (실제 값 칸은 **L열** — 최초 덤프가 UsedRange 10열까지라 K~M 누락했던 것을
원본 01_Carling Free Calculator R1 의 Report 시트로 정정. J21/J25/J27 은 원본에서도 빈 스페이서 행):
- L15 σB_Calc.  ← intermediate.sigma_B_calc_MPa   (=Solver!P7)
- L16 σB_Allow. ← intermediate.sigma_B_allow_MPa  (=Solver!Q7)
- L17 Assessment ← checks.bending                 (=Solver!R7)
- L18 σS_Calc.  ← intermediate.sigma_S_calc_MPa   (=Solver!S7)
- L19 σS_Allow. ← intermediate.sigma_S_allow_MPa  (=Solver!T7)
- L20 Assessment ← checks.shear                   (=Solver!U7)
- L22 DCalc.    ← intermediate.d_calc_mm          (=Solver!V7)
- L23 DAllow.   ← intermediate.d_allow_mm         (=Solver!W7)
- L24 Assessment ← checks.displacement            (=Solver!X7)
- L26 Assessment(Total) ← result.assessment       (=Solver!Y7)

알려진 불일치(엔진 버그, 리포트와 무관): free/solver.py 의 σS_Allow = 0.6·σy 이나
원본 Excel(Solver!T7) 과 optimization 모듈은 0.4·σy. → Mild 기준 리포트 141 vs 원본 94.
엔진 수정 + EXE 재빌드는 별도 결정.

템플릿 선택: load.type=="distributed" → `Carling Free Calculator Report_Distributed.xlsm`,
그 외 → `..._Concentrated.xlsm`.

## 오류 처리

- filler: `DisplayAlerts=False`, `AutomationSecurity=ForceDisable`(매크로 차단), 항상 `finally`에서 Quit + 고아 EXCEL 정리, 실패 시 non-zero exit + stderr.
- 서비스: 60초 timeout, 실패/타임아웃 → `HTTPException(503, "리포트 생성 환경(Excel/DRM)을 사용할 수 없습니다")`.
- 프론트: 로딩 스피너 + 실패 메시지.

## 운영 리스크

프로덕션 백엔드 서버에 **Excel 설치 + DRM 에이전트(서버 프로세스 인가)** 필요.
없으면 503으로 우아하게 실패. 환경 구성은 별도 인프라 작업.

## 검증 계획

구현 후 개발 PC에서 write→save→재열람 전체 사이클 실테스트로
DRM 재암호화 산출물이 정상적으로 다시 열리는지 확인.
