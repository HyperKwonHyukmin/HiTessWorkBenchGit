# Hi-TESS WorkBench — 발표자료 삽입용 참조 도해

흰 배경 슬라이드에 삽입하는 설명용 그림. 전부 **3840×2160 (16:9)**, CSS 1920×1080 캔버스를 2배 렌더.

## 산출물

| 파일 (render/) | 내용 | 비고 |
|---|---|---|
| `fig-1-dashboard-final.png` | **도해① 플랫폼 개요 (A안)** — 좌 캡처 + 우 번호 콜아웃 6개 + 하단 해석 작업 흐름 5단계 | 정보 밀도 높음. **권장** |
| `fig-1-overview-4k.png` | **도해① 플랫폼 개요 (B안)** — 인출선으로 라벨을 화면 바깥에 배치 | 화면을 안 가려 읽기 편함. 하단 여백 큼 |
| `fig-2-modulemap-final.png` | **도해② 해석 모듈 맵** — 해석 앱 14 + 운영 도구 5, Module Unit Studio 실제 화면 포함 | |

소스 HTML은 같은 폴더의 `fig-*.html`. 문구·색·배치 수정 후 재렌더 가능.

## 사용한 실물 자산 (재현·모사 없음)

| 파일 | 원본 | 출처 |
|---|---|---|
| `assets/logo-lockup-white.png` | 783×147 | `HiTessWorkBench/frontend/public/hitess_logo_lockup_transparent.png` |
| `assets/hd-symbol.png` | 175×198 | `frontend/src/assets/images/HD_Logo.png` |
| `assets/shot-dashboard.png` | 2531×1121 | `Figure/1.png` (실제 대시보드 캡처) |
| `assets/shot-moduleunit-studio.png` | 1759×1329 | `Figure/2.png` (실제 Module Unit Studio 캡처) |
| `assets/Inter-Variable.woff2` / `SUIT-Variable.woff2` | — | `frontend/public/fonts/` |

**로고 주의**: 확보된 락업은 **흰색(다크 배경 전용)**이다. 흰 배경에 직접 올리면 보이지 않는다.
→ 그래서 두 도해 모두 상단에 **네이비(`#002554`) 헤더 밴드**를 두고 그 위에만 로고를 얹었다.
   제품 자체의 시그니처 컴포넌트(PageBanner = 네이비 그라디언트 배너)와 같은 문법이라 브랜드 일관성도 유지된다.

## 🔒 보안 마스킹 (기본 적용)

`Figure/1.png`에는 사내 정보가 노출되어 있어 도해에서 블러 처리했다:
- 해석 서버 주소 `10.14.42.145:9091` (+ 버전 표기)
- 개인 IP `10.133.122.70`

**해제 방법**: `fig-1-*.html`에서 `.redact` 클래스 div 두 줄을 삭제하면 원본이 그대로 보인다.
사용자 실명·소속은 대시보드 맥락상 자연스러워 그대로 두었다.

## ⚠️ 수치에 대한 판단 (중요)

대시보드 캡처에 보이는 수치들은 **집계 범위가 서로 다르다**:
- `해석 수행 건수` — 월간 69건 / 누적 340건
- `인기 해석 프로그램(최근 30일)` — Block Weld 719건 / Truss Structural 623건 / HiTESS Model Builder 117건

누적 340건보다 개별 프로그램 719건이 큰 모순처럼 보이므로, **도해에 지표로 재인용하지 않았다.**
캡처 안에서만 보이게 두었다. 실적 수치를 별도 슬라이드로 만들려면 **각 지표의 정의·집계 범위를 먼저 확인**할 것.

그 외 도해의 모든 서술은 코드베이스(`CLAUDE.md`) 근거이며 **지어낸 수치는 0건**이다.

## 렌더 방법 (재현)

```bash
node _serve.js                       # 127.0.0.1:8778 정적 서버 (file:// 은 Playwright가 차단)
# 브라우저 뷰포트를 3840×2160(device)으로 맞춘 뒤:
#   document.body.style.zoom = window.innerWidth / 1920
# → 스테이지가 CSS 뷰포트를 채워 device 3840×2160으로 정확히 캡처된다.
```

**주의**: 고정 `zoom:2`를 쓰면 안 된다. 이 환경의 브라우저는 CSS 뷰포트 5760px에 DPR 0.667이라
`zoom:2`로는 2/3 크기로 잘린다. 반드시 `innerWidth / 1920`로 실측 보정할 것.

## 래스터 표시 상한 (4K 기준, 초과 시 뭉개짐)

| 자산 | 픽셀 완벽 상한 |
|---|---|
| `shot-dashboard.png` | 1265 CSS px |
| `shot-moduleunit-studio.png` | 879 CSS px |
| `logo-lockup-white.png` | 391 CSS px |
| `hd-symbol.png` | 87 CSS px |
