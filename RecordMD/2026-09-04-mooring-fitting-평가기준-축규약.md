# Mooring Fitting 구조 평가 기준 — 축 규약 검증 기록

**작성** 2026-09-04
**대상** MooringFitting 엔진 / MooringFittingStudio / WorkBench 백엔드
**결론** 판정 축과 전단 짝 두 곳이 잘못돼 있었고, 실측 검증 후 수정 완료. 판정이 `전 부재 Pass` → `Fail 10건` 으로 뒤집혔다.

---

## 1. 발단

Studio 화면과 보고서의 Usage 가 서로 달랐다. 추적하다 보니 더 근본적인 질문이 나왔다.

> "My 로 평가한다"는 것이 강축인가 약축인가?

주석과 코드가 서로 반대로 적혀 있었고(`★ 사용자가 의심하는 부분 ★` 표식까지 남아 있었다), 사람 기억으로는 결론이 나지 않았다. 그래서 **검증 모델을 실제로 돌려** 확정했다.

---

## 2. 약축 / 강축이란

I 형 단면을 두 방향으로 굽힌다고 생각하면 된다.

| | **강축 (Strong)** | **약축 (Weak)** |
|---|---|---|
| 무엇이 버티나 | **웨브 높이** — 플랜지가 위아래로 멀리 떨어져 있음 | **플랜지 폭**만 |
| 관성모멘트 | 웨브 + 플랜지×(거리)² → **큼** | (Tb·Bb³ + Tt·Bt³ + Hw·Tw³)/12 → **작음** |
| 굽힘 평면 | **연직면** (상하로 휨) | **수평면** (좌우로 휨) |
| 같은 모멘트일 때 | 응력이 **작다** | 응력이 **크다** |

H빔을 세워 위에서 누르면 잘 안 휘고(강축), 옆으로 밀면 쉽게 휜다(약축).

---

## 3. ★ 핵심 — DNV 와 NASTRAN 의 국부축 규약이 정반대다

이번 혼선의 뿌리다. **`My` 라는 이름이 두 문서에서 서로 다른 축을 가리킨다.**

```
DNV 3D Beam   local z = up = 웹 방향   →  My 가 강축
NASTRAN       local y = up = 웹 방향   →  Mz 가 강축
```

| | DNV 3D Beam | NASTRAN CBEAM (방향벡터 `(0,0,1)`) |
|---|---|---|
| 깊이(웹) 방향 축 | **z** | **y** |
| 폭(플랜지) 방향 축 | y | z |
| 강축 굽힘 | `My` | `Mz` |
| 약축 굽힘 | `Mz` | `My` |
| 판정 조합응력 | `Sig-Ny = Sig-Nx ± Sig-My` | `σN = \|σNx + σMz\|` |

**위 두 판정값은 같은 물리량이다** — 축력 + 연직면 굽힘.

이름이 같다는 이유로 DNV 의 `My`(강축)를 NASTRAN 의 `Calc_My`(약축)에 대응시킨 것이 오류였다.

---

## 4. 근거 ① — DNV 3D Beam User Manual

`ModuleOceanMoving/AxisTest/3DBeamManual(1).pdf` (Nauticus Hull – 3D Beam)

> ⚠ 이 PDF 는 회사 DRM 으로 암호화돼 있다(헤더 `HHIDRMC`, +4096 byte). 허가된 뷰어에서 해제해야 프로그램으로 읽을 수 있다.

| 쪽 | 원문 | 의미 |
|---|---|---|
| p.16 | "The local **z-axis is the local 'up-axis'**" | z = 연직 |
| p.17 | "align the local **z-axis (direction of the I-profile web)**" | z = 웹 방향 |
| p.83 | 단면계수 간이식 "**Wy = Iy / z**" | Wy 의 최외단 거리가 z(깊이) |
| p.99 | "Sig-Ny: normal stress in **local xz-plane**, (Sig-Nx ± Sig-My)" | Sig-Ny 가 연직면 굽힘 |
| p.101 | Stress Check = **Sig-My** + **Tau-Qz** (*web-plate* shear) | 강축 굽힘 + 웹 전단 (거더 표준 검토) |

p.101 이 `Sig-My` 를 **웹 플레이트 전단**과 짝지은 것이 결정적이다 — 둘 다 웨브가 받는 하중이다.

### 허용응력의 출처

| 매뉴얼 위치 | 내용 | 우리 적용 |
|---|---|---|
| **p.100 Combined stresses** | `Usage = σeff / (σyield / γM)`, γM = 1.0 기본 | ✅ **이것이 근거** — 315 MPa |
| p.101 Stress Check | `Cs·ReH` / `Ct·ReH` (DNVGL-RU-SHIP Pt.3 Ch.6 Sec.6 [2.2.2]) | ❌ 해당 없음 |

> 옛 보고서의 `0.8·σy = 252` 는 p.101 의 `Cs·ReH` 에서 온 것으로 보인다. 다만 그 체크는 **선체거더 응력 σhg 가 들어가는 PSM 룰 검토**라 계선의장품 기초에는 적용되지 않는다.
> (세션 중 한때 "252 는 근거 없음" 이라고 판단했으나, 매뉴얼에서 출처를 찾아 정정했다.)

---

## 5. 근거 ② — AxisTest 실측 (MSC Nastran)

`ModuleOceanMoving/AxisTest/` — 이 결론을 확정한 검증 모델.

### 모델

```
CBEAM 8개, 스팬 10,000, 방향벡터 (0,0,1)   ← 실제 계선 모델과 같은 구성
PBEAML I : DIM = [150, 100, 100, 10, 10, 10]   (깊이 150, 플랜지 100x10, 웨브 10)
SPC 123456 : 양단(node 1, 2) 완전 고정
FORCE      : 중앙(node 3)에 -Z 방향 1,000 N   ← 순수 연직 하중
```

### ① MSC 가 직접 답을 준다 — PBEAML → PBEAM 변환

```
PBEAM  1  1  A=3.3000E+03  I1=1.1648E+07  I2=1.6775E+06  J=1.1251E+05
```

`property.png`(HyperMesh 단면 물성)와 대조:

```
HyperMesh                Nastran      축
Iz = 11,647,500     →    I1           강축   ← 큰 쪽이 I1
Iy =  1,677,500     →    I2           약축
Sz = 155,300                          강축 단면계수
Sy =  33,550                          약축 단면계수
Max Coord Ext: y = 75 (깊이), z = 50 (폭)
```

**`I1 = Izz = 강축`** 확정.

### ② 연직 하중은 PLANE 1 로 나온다

```
              - BENDING MOMENTS -
              PLANE 1          PLANE 2
          -1.250000E+06   -5.504678E-20
```

`P·L/8 = 1000×10000/8 = 1,250,000` 정확히 일치. PLANE 2 는 수치 0.
웹 전단(`WEB SHEARS PLANE 1`)도 `±500 = P/2` 로 PLANE 1 에 실린다.

### ③ 응력이 최종 확인

```
Nastran 출력     SXC = 8.048938E+00 MPa

강축으로 나누면  1,250,000 / 155,300 = 8.0489   ✔ 4자리 일치
약축으로 나누면  1,250,000 /  33,550 = 37.26    ✘ 4.6배 과대
```

### ④ 우리 계산기(`BeamSectionCalculator`)가 같은 숫자를 낸다

| | 코드 | Nastran / HyperMesh |
|---|---|---|
| A | 3,300 | 3,300 ✔ |
| Iy (강축) | 11,647,500 | I1 = 1.1648E+07 ✔ |
| Iz (약축) | 1,677,500 | I2 = 1.6775E+06 ✔ |
| minW_Strong | 155,300 | Sz = 155,300 ✔ |
| minW_Weak | 33,550 | Sy = 33,550 ✔ |

**전 구간 일치.** `Calc_Mz = BM1 / minW_Strong` 이 옳고, `Calc_My = BM2 / minW_Weak` 도 옳다.
→ 굽힘 계산 자체는 처음부터 맞았다. 틀린 것은 **주석**과, 판정에서 **어느 쪽을 고르느냐** 였다.

---

## 6. 발견된 오류 두 가지

### 오류 ① — 판정 축 (이식 오류)

```
이전:  σN = |σNx + σMy|    ← NASTRAN My = 약축(수평면 굽힘)
이후:  σN = |σNx + σMz|    ← NASTRAN Mz = 강축(연직면 굽힘) = DNV 의 Sig-Ny
```

**왜 약축을 빼는가**
실제 구조는 상판(deck plate) + 하부 보강재의 **판구조**다. 이를 1D 보로 이상화하면서 상판 유효폭이 플랜지로 들어간다.

```
PBEAML I : DIM = [260, 90, 750, 10, 15, 10]
     ┌──────── 상부 플랜지 750 × 10 = 상판 유효폭 ────────┐
                    │ 웨브 235 × 10
                ┌───┴───┐ 하부 플랜지 90 × 15 = 보강재 페이스
```

면내 수평력은 실제로는 **상판이 막응력으로 넓게 받는다.** 750 mm 짜리 조각이 홀로 수평 굽힘을 하지 않는다. 즉 약축 굽힘은 1D 이상화가 만든 값이지 실제 파괴 모드가 아니다.

단서가 단면계수에도 있다 — **"약축" 계수가 강축보다 크다**(939,982 vs 472,867). 상판 750 mm 폭이 약축 관성(`Iz ∝ B³`)을 부풀린 결과다.

### 오류 ② — 전단 짝 (계산 오류)

```csharp
// 이전 — 주석에 "강제 스왑 적용 유지" 라고 적혀 있었다
Calc_Qy = Shear1 / Ay;   // 웹 전단력 ÷ 플랜지 전단면적   ← 어긋남
Calc_Qz = Shear2 / Az;

// 이후
Calc_Qy = Shear1 / Az;   // 웹 전단력 ÷ 웹 전단면적
Calc_Qz = Shear2 / Ay;   // 플랜지 전단력 ÷ 플랜지 전단면적
```

- `Shear1` = F06 `WEB SHEARS PLANE 1` = 웹(연직) 전단 (AxisTest 에서 −500 = P/2 로 확인)
- `Az` = `Iy·Tw/Sy` = **웹** 전단면적, `Ay` = `Iz·(Tb+Tt)/Sz` = **플랜지** 전단면적

계선 단면에서 `Ay = 13,109` vs `Az = 3,364` — **3.9배 차이**. 웹 전단응력을 그만큼 과소평가하고 있었다.

> ⚠ **왜 오래 숨어 있었나**: AxisTest 같은 **대칭 단면에서는 `Ay ≈ Az`** 라 증상이 드러나지 않는다. 상판이 플랜지로 들어간 **비대칭 단면에서만** 벌어진다.

---

## 7. 이 모델에서 하중이 실제로 어떻게 흐르나

여기가 "수평 하중인데 왜 강축으로 평가하나" 의 답이다.

### 하중 구성 — 대부분 수평

```
Type            LC수   Fz≠0   max|수평|N    max|Fz|N
BOLLARD          4      0     1,078,732           0
STEEL-ROLLER    10      0     1,078,732           0
CHOCK            2      1     1,078,732   1,078,732
```

11개 LC 중 **10개가 수평 전용**. 직접 연직 하중은 CHOCK 1건뿐.

### 그런데 강축이 전 LC 를 지배 — 편심 때문

```
데크 주 평면   Z ≈ 23,065
하중 절점      Z = 23,618 ~ 24,621   (MF 독립절점, 평균 ~1,000 mm 위)

수평력 1.08 MN  ×  편심 ~1,000 mm  =  전도 모멘트 1.08×10⁹ N·mm
                    ↓  RBE2 가 데크로 전달
        데크 격자에 상하 반력  →  연직면 굽힘 = 강축
```

계선의장품이 데크 위로 솟아 있어 **수평으로 당겨도 뽑히려는 힘(prying)** 으로 바뀐다.

### 실측 — 전 LC 에서 강축이 2.3~26배

| Subcase | max\|Nx\| | max\|My\| (약축) | max\|Mz\| (강축) | Mz/My |
|---:|---:|---:|---:|---:|
| 1 | 46.7 | 20.8 | 286.2 | 13.8 |
| 2 | 2.5 | 6.7 | 175.6 | 26.1 |
| 3 | 40.4 | 73.2 | 199.8 | 2.7 |
| 4 | 18.9 | 83.8 | 287.4 | 3.4 |
| 5 | 21.6 | 90.0 | 230.9 | 2.6 |
| 6 | 20.7 | 89.0 | 332.7 | 3.7 |
| 7 | 22.2 | 103.5 | 257.6 | 2.5 |
| 8 | 15.4 | 73.7 | 357.5 | 4.9 |
| 9 | 27.2 | 82.0 | 283.6 | 3.5 |
| 10 | 26.8 | 62.2 | 302.5 | 4.9 |
| 11 | 25.9 | 56.7 | 128.9 | 2.3 |

> 강축이 받는 것은 "수직 하중" 이라기보다 **연직면 굽힘**이고, 그 원인이 여기서는 직접 수직 하중이 아니라 수평 하중의 전도 모멘트다. 개념은 같다.

---

## 8. 최종 평가 절차

### ① 스테이션마다 성분

```
σNx = Axial / Area
σMz = BM1 / W_strong      ← 연직면 굽힘   (DNV 의 Sig-My)
σMy = BM2 / W_weak        ← 수평면 굽힘   (DNV 의 Sig-Mz, 참고용)
τQy = Shear1 / A_web      ← 웹 전단       (DNV 의 Tau-Qz)
τQz = Shear2 / A_flange
τMx = Torque / Wx
```

- `W_strong = min(Wyb, Wyt)` = `Iy / c`, c = 깊이 방향 최외단 거리
- `W_weak = min(Wzb, Wzt)` = `Iz / (플랜지 반폭)`
- `min` 을 쓰는 이유: 상·하 플랜지 폭이 다르면 최외단 거리가 둘이라 계수도 둘. **더 먼 쪽(= 더 작은 W)** 을 골라야 보수적

### ② 조합·지배값 (부호 살려 더한 뒤, 전 스테이션 중 최악)

```
σN = max| σNx + σMz |
τ  = max( |τQy|, |τQz|, |τMx| )
```

### ③ 허용응력

```
정응력 허용 = σy / γM        = 315 / 1.0 = 315 MPa   (AH32)
전단   허용 = 0.6 × (σy/γM)              = 189 MPa
```

### ④ 판정 — 정응력과 전단은 **별개 검토**

```
U(정응력) = σN / 315
U(전단)   = τ  / 189
Usage     = max( U(정응력), U(전단) )     ≤ 1.0 이면 Pass
```

둘 다 통과해야 OK. 실적 보고서 서식과 동일하다:

```
ID       Stress   Beam No.  Size                     Actual  Allowable  Status
MF-F22   Normal   154       400X100X13/18 "AH" I.A   146     315        OK
         Shear    154       400X100X13/18 "AH" I.A   172     189        OK
```

### ⑤ 안전계수

MF 하중에만 **SF 1.25** 를 곱한다(`P = SWL × 9806.65 × SF`). Winch 는 별도 sub-stage 라 미적용.

---

## 9. 수정 전후 실측 (csv/NewCase_02)

동일 입력으로 재해석해 비교했다.

```
                     전단 max          강축 조합 max      약축 조합 max
구 exe / SF 1.00      97.7 (U 0.517)    342.1 (U 1.086)    109.7
신 exe / SF 1.25     193.6 (U 1.024)    427.6 (U 1.358)    137.1
```

두 효과가 깔끔하게 분리된다:

- 정응력 `342.1 × 1.25 = 427.6` — 차이가 순수하게 SF 뿐
- 전단 `97.7 × 1.25 = 122.1` 인데 실제 `193.6` → **1.586배가 전단 수정분** (CSV 예측치와 정확히 일치)

### 판정 변화

| 기준 | 최대 Usage | 결과 |
|---|---|---|
| 종전 (My 약축, SF 1.0) | 0.517 | 전 부재 Pass |
| 수정 후 (Mz 강축 + 전단 짝, SF 1.25) | **1.358** (beam 2312, LC 8 / SID 1008) | **Fail 10건** |

전단 단독 불합격도 드러났다: `beam 822, LC 10, τ = 193.6 > 189` (정응력은 145.5 / 0.462 로 여유)

---

## 10. 수정 파일

### 엔진 (`WorkBenchSubModule/MooringFitting`)

| 파일 | 변경 |
|---|---|
| `Services/Reporting/ReportData.cs` | `SigmaNy/SigmaNz` → **`SigmaNStrong/SigmaNWeak`** 개명 (축 글자로 부르지 않음) |
| `Services/Reporting/ReportStressEvaluator.cs` | 판정값·대표 station 을 강축 기준으로 |
| `Services/Analysis/BeamForcePostProcessor.cs` | 전단 짝 교정 + My/Mz 주석 정정 |
| `Exporters/F06ResultExporter.cs` | CalcVerify 열 순서 — 분모가 제 짝 옆에 오게 (`ShearY,Az,Qy_Stress`) |
| `Commands/SolveBdfCommand.cs` | station 선정 `Calc_Nx + Calc_Mz`, JSON 필드 `sigmaNy` → `sigmaNStrong` |
| `Commands/ReportCommand.cs` | `--gamma` 인자 추가 |
| `Services/Reporting/MooringReportBuilder.cs` | 표 6.2 를 실적 서식(Normal/Shear 2행)으로, 표 6.4 에 `U(N)`·`U(tau)` 분리, 표 6.5 헤더 `sNs/sNw` |
| `Tests/BeamAxisConventionTests.cs` | **신규** — AxisTest 실측값 6건 고정 |

### 백엔드 (`HiTessWorkBenchBackEnd`)

| 파일 | 변경 |
|---|---|
| `app/services/mooring_fitting_service.py` | `recompute_sigma_ny` 를 `mz` 기준으로, `--gamma` 전달 |
| `app/routers/analysis.py` | `_report_criteria()` 로 top/σy/γM 파싱 일원화 |
| `tests/test_mooring_sigma_ny.py` | 새 기준으로 재작성 |

### Studio (`WorkBenchSubModule/MooringFittingStudio`)

| 파일 | 변경 |
|---|---|
| `components/BottomReviewDock.jsx` | 기본 열 `σ_My` → **`σ_Mz (강축)`**, 헤더 `σNy` → `σN` |
| `components/FinalReviewTab.jsx` | 동일 + `U(정응력)`·`U(전단)` 열 추가 |
| `components/InspectorPanel.jsx` | 계산 근거 식을 `|σNx + σMz|` 로 정정 |
| `utils/lcEnvelope.js`, `store/useResultStore.js` | 성분·스키마 주석 갱신 |

---

## 11. 회귀 시험 — 같은 혼선 재발 방지

`src/MooringFitting.Tests/BeamAxisConventionTests.cs` (6건)

| 시험 | 고정하는 사실 |
|---|---|
| `SectionProperties_MatchNastranPbeamConversion` | A=3300, Iy=11,647,500, Iz=1,677,500 |
| `SectionModuli_MatchHyperMeshElasticSectionModulus` | Sz=155,300, Sy=33,550 |
| `Plane1Moment_DividedByStrongModulus_ReproducesNastranStress` | **8.048938 MPa** — 축을 바꿔 끼우면 37.26 으로 터짐 |
| `VerticalLoad_ProducesStrongAxisStressOnly` | BM1→Mz, BM2→My 짝 |
| `MooringSection_WebShearArea_IsMuchSmallerThanFlangeShearArea` | 계선 단면 `Ay > 4·Az` |
| `SymmetricSection_ShearAreasAreNearlyEqual_SoSwapIsInvisible` | **대칭 단면에서는 스왑 실수가 안 보인다는 사실 자체** |

---

## 12. 남은 사항

- **기존 산출물 재해석 필요** — 이전에 만든 결과·보고서는 전부 옛 기준이다.
- **Roller 연직 성분** — 현행 유지로 결정(수평 2가닥 벡터 합, `|R| = 2P·cos(a/2)`). BOLLARD 도 같은 상태로, 로프가 실제로 아래로 당기는 각도는 반영되지 않는다.
- **MF SF 1.25** — 1.25 미만 입력 시 경고만 내고 진행(하드 차단 아님).

---

## 부록 — 용어 대조표 (붙여두면 편한 것)

```
                    DNV 3D Beam        NASTRAN            물리적 의미
웹(up) 방향 축        z                  y
폭 방향 축            y                  z
강축 굽힘 응력        Sig-My             Calc_Mz            연직면 굽힘 (상하)
약축 굽힘 응력        Sig-Mz             Calc_My            수평면 굽힘 (좌우)
판정 조합응력         Sig-Ny             |σNx + σMz|        축력 + 강축 굽힘
웹 전단               Tau-Qz             Shear1 / Az
단면계수 (강축)       Sz                 min(Wyb, Wyt)
단면계수 (약축)       Sy                 min(Wzb, Wzt)
```

**한 줄 요약**: DNV 의 `My` 와 NASTRAN 의 `My` 는 정반대 축이다. 판정은 언제나 **축력 + 연직면(강축) 굽힘**으로 한다.
