# Hi-TESS WorkBench · Brand Spec (발표 키비주얼용)

> 채집일: 2026-07-24
> 자산 출처: 프로젝트 내부 실물 자산 (frontend/public, frontend/src/assets/images) + DESIGN.md / PRODUCT.md
> 자산 완전도: **완전** (로고 락업·심볼·워드마크·가변 폰트 전부 실물 확보)

---

## 🎯 핵심 자산 (일등 시민 — 반드시 `<img>`로 실물 참조, CSS/SVG로 다시 그리지 말 것)

### Logo
| 파일 | 내용 | 용도 |
|---|---|---|
| `assets/logo-lockup-white.png` — **783 × 147** (비율 5.327), 투명 | Hi-TESS 심볼 + "Hi-TESS"(흰) + "WorkBench"(민트) + 하단 민트 언더라인 | **주 락업. 다크 배경 전용 — 이번 다크 네이비 키비주얼의 정답 자산** |
| `assets/hitess-mark.png` — **108 × 105** (비율 1.029) | Hi-TESS 심볼 단독 (회색 링 + 적/청/녹 삼각 프리즘) | 심볼만 필요할 때. 원본이 작아 크게 쓰면 뭉개짐 |
| `assets/hd-symbol.png` — **175 × 198** (비율 0.884), 투명 | HD현대 그린 쉐브론 심볼 | 코너 co-branding, "HD현대" 귀속 표기 |
| `assets/hhi-white-ko.png` — **1190 × 198** (비율 6.010) | HHI 한글 흰색 워드마크 | 하단 귀속 라인 |

### 래스터 상한 (4K 출력 기준 — 중요)
최종 렌더는 CSS 1920×1080 캔버스를 **2배(3840×2160)**로 출력한다. PNG는 벡터가 아니므로 표시 폭에 상한이 있다:

| 자산 | 픽셀 완벽 (권장) | 허용 상한 | 초과 시 |
|---|---|---|---|
| `logo-lockup-white.png` | ≤ **391** CSS px | 560 CSS px | 4K에서 가장자리 뭉개짐 |
| `hd-symbol.png` | ≤ **87** CSS px | 120 CSS px | 〃 |
| `hitess-mark.png` | ≤ **54** CSS px | 70 CSS px | 〃 (원본이 작음) |

→ **타이포(벡터, 무한 선명)가 주인공이 되어야 한다.** 로고를 화면 지배 요소로 키우지 않는다.

**금지**: 로고 비율 왜곡·색 변경·외곽선 추가. 심볼을 CSS/SVG로 재현하지 말 것 (적/청/녹 프리즘은 원본 그대로만).

### 제품 UI 스크린샷
- 이번 산출물(표지 키비주얼)에는 **불필요**. 표지는 로고 + 한 줄 정의가 주인공이며, UI 스크린샷을 넣으면 표지가 아니라 개요 슬라이드가 된다.
- 필요해질 경우: 실물 앱 캡처만 사용. mockup 생성기·가짜 대시보드 그리기 금지.

---

## 🎨 보조 자산

### 색 (DESIGN.md에서 그대로)
| 토큰 | HEX | 역할 |
|---|---|---|
| Trust Blue | `#002554` | HD현대 공식 메인. **키비주얼 배경 기조** |
| Trust Blue Dark | `#003366` | 깊이 음영 |
| Trust Blue Light | `#004080` | 그라디언트 상단, 얇은 구획선 |
| Heritage Green | `#008233` | 확정 액션 (표지에서는 거의 안 씀) |
| Heritage Green Light | `#00E600` | **The Rare Spark — 화면의 5% 이하. 주목 유도 단 한 점** |
| Ink Muted | `#64748b` | 다크 배경에서는 쓰지 않음 (대비 부족) |
| White | `#ffffff` | 주 타이포 |
| Line | `#e2e8f0` | 라이트 표면 전용 |

**다크 배경 위 보조 텍스트**는 `rgba(255,255,255,0.55~0.72)` 사용. slate-500 계열(`#64748b`)을 네이비 위에 올리면 대비 4.5:1 미달 → 금지.

### 폰트 (self-host, 실물 woff2 확보)
```css
@font-face { font-family:'Inter'; src:url('assets/Inter-Variable.woff2') format('woff2-variations');
             font-weight:100 900; font-display:block; }
@font-face { font-family:'SUIT';  src:url('assets/SUIT-Variable.woff2')  format('woff2-variations');
             font-weight:100 900; font-display:block; }
```
- Display/Body: `Inter, SUIT, sans-serif` (라틴은 Inter, 한글은 SUIT로 자동 분기)
- Mono: `Fira Code, Consolas, monospace` — 기술 텍스트/식별자 전용

> **Inter는 이 브랜드에서 slop이 아님.** DESIGN.md가 명시 지정한 브랜드 서체다 (반-slop 규칙의 "품牌本身用" 정당 예외).

### 서명 디테일 (120% 지점)
- **The Rare Spark**: `#00E600` 형광 그린을 화면에 **정확히 한 곳**만. 그것이 시선의 종착점.
- **The Two-Blue Rule**: 네이비=정체성(프레임/제목), Action Blue `#2563eb`=상호작용. 표지는 정체성 장면이므로 **Action Blue를 쓰지 않는다**.
- **The Weight-Not-Family Rule**: 위계는 세 번째 서체가 아니라 무게(400/600/700/800)와 크기로.
- 정밀한 정렬 — 엔지니어링 도구의 신뢰는 정렬·여백의 일관성에서 온다.

### 금지 구역
- ❌ 보라 그라디언트, `background-clip:text` 그라디언트 텍스트 (DESIGN.md 명시 금지)
- ❌ 이모지 아이콘, 모든 섹션 위 반복되는 대문자 eyebrow
- ❌ 칙칙한 회색 레거시 엔터프라이즈 톤 (PRODUCT.md 최우선 anti-reference)
- ❌ 지어낸 수치·가짜 통계 (`도입률 340%↑` 같은 것). 사실만, 없으면 비운다.
- ❌ 사이버 네온 / `#0D1117` GitHub 다크 복제

### 기질 키워드
**신뢰 · 정밀 · 절제 · 권위 · 관제실(Control Room)**

---

## ⚠️ 이번 산출물의 의도적 규범 이탈 (기록)

DESIGN.md의 **The No-Shout Rule**(디스플레이 상한 1.5rem)은 *제품 UI* 규칙이다. 이 산출물은 **10m 거리에서 읽는 발표 표지**로 매체가 다르므로 타이포 스케일을 크게 쓴다. 단, 색·서체·정렬·Rare Spark 규칙은 그대로 지켜 **같은 브랜드로 인식**되게 한다.

---

## 확정 사양 (사용자 결정)
- 구성: **표지 키비주얼 1장**
- 톤: **다크 네이비 관제실**
- 규격: **16:9 / 3840×2160** (CSS 1920×1080 캔버스를 deviceScaleFactor 2로 렌더)
