---
target: Side Passage Studio 전체 UI/UX (개선 후)
total_score: 33
p0_count: 0
p1_count: 0
timestamp: 2026-08-26T06-48-52Z
slug: side-passage-studio
---
# Side Passage Studio — 개선 후 재평가

대상: `C:\Coding\WorkBenchSubModule\SidePassageStudio\apps\side-passage-studio` (v0.0.102)
방법: 1차 크리틱(23/40)의 P0~P2 + 접근성 항목을 적용한 뒤 동일 조건 재측정
(dev 5199 · 3,810 node / 3,877 element 모델 · 6개 탭 · 텍스트 574개)

## Design Health Score

| # | Heuristic | 이전 | 현재 | 남은 문제 |
|---|-----------|------|------|-----------|
| 1 | Visibility of System Status | 3 | 4 | 해소 — 절차 단계 중복 활성 수정, 로드 진행률, 게이트 사유 |
| 2 | Match System / Real World | 2 | 3 | `stability JSON 없음`·`Workbench 환경 아님` 은 아직 구현 용어 |
| 3 | User Control and Freedom | 2 | 3 | 저장이 여전히 Studio 종료(단, 이제 제목에서 명시) |
| 4 | Consistency and Standards | 2 | 3 | 인라인 style 700여 개 — CSS 컴포넌트 계층은 여전히 없음 |
| 5 | Error Prevention | 3 | 4 | 해소 |
| 6 | Recognition Rather Than Recall | 2 | 3 | 단축키 안내 배너는 닫으면 다시 못 부른다 |
| 7 | Flexibility and Efficiency | 2 | 3 | 명령 팔레트·최근 폴더 없음 |
| 8 | Aesthetic and Minimalist Design | 2 | 3 | Edit 탭 도움말 문단은 아직 팝오버로 안 옮김 |
| 9 | Error Recovery | 3 | 4 | 해소 (테스트 중 실제로 ErrorBoundary 가 크래시를 잡아냄) |
| 10 | Help and Documentation | 2 | 3 | 문단형 도움말이 접힘선에서 잘리는 문제 잔존 |
| **Total** | | **23/40** | **33/40** | **Good — 견고한 기반, 약한 영역 보완 단계** |

## 실측 변화

| 지표 | 이전 | 현재 |
|---|---|---|
| WCAG AA 대비 실패 | 다크 27건 / 라이트 52건 (최악 1.27:1) | **0건** (텍스트 574개, 6개 탭) |
| 11px 미만 텍스트 | 41건 | **0건** |
| `:focus` CSS 규칙 | 0개 | 전역 `:focus-visible` |
| `h1~h6` | 0개 | 화면별 h1/h2 |
| `lang` | `en` (UI 는 한국어) | `ko` |
| 1280×720 세로 사장 | 88px (12%) | **0px** |
| detector findings | 8건 (side-stripe 2 포함) | 3건 (오탐 2 + 의도된 dock 높이 1) |
| 네이티브 대화상자 | 8곳 | 0곳 |
| lint | 30건 | 14건 (전부 기존, 신규 0) |
| 테스트 | 367 통과 | 367 통과 |

## 해결한 것

- **P0 라이트 모드** — 제거(사용자 결정). 다크 토큰 램프를 4단(17.0/11.4/8.1/5.8)으로 재정의해
  라이트 제거만으로는 남았을 다크 27건까지 함께 해소.
- **P1 타이포** — 하한 11px + 4단 스케일. 총질량 24px 로 승격.
- **P1 오버레이 충돌** — 스테퍼를 앱 레벨 행으로 분리, 나머지는 세로 스택, 토스트는 하단으로.
  Edit 탭에서 2·3·4 단계가 동시 활성되던 문제도 도구 기준 판정으로 수정.
- **P1 좌측 독** — 레이어를 공용 컴포넌트로 빼 뷰 도구(모든 탭)·Model Check 도크에 배치.
  탭 왕복 제거 + Model Check 의 700px 공백 해소.
- **P1 반응형** — `flexShrink: 0` 한 줄로 12% 세로 손실 해결.
- **P2 어휘·대화상자** — 스위치 1종 통일, 네이티브 대화상자 8곳 → Esc 취소 가능한 앱 내부 패널.
- **접근성** — 포커스 링, `lang="ko"`, 헤딩, `sr-only` 상태 병기, reduced-motion, 한글 어절 줄바꿈.
- **금지 패턴** — 측면 스트라이프 2곳 제거, 이모지 → lucide 아이콘.

## 남긴 것 (다음 사이클)

1. **Edit 탭 도움말 문단** — 아직 상시 노출이라 스크롤 밖에서 문장이 잘린다. `?` 팝오버 + 섹션 아코디언이 필요.
2. **Unit 구조 해석 차단 메시지** — `대기 — 자세안정성 미실행 / Workbench 환경 아님 / stability JSON 없음`.
   슬래시로 이어 붙인 세 사유가 모두 구현 용어다.
3. **파워 유저 효율** — 명령 팔레트, 최근 폴더, 단축키 안내 재호출 경로 없음.
4. **인라인 style 700여 개** — 토큰은 단일화됐지만 CSS 컴포넌트 계층은 여전히 없다.
   Tailwind·shadcn 이 의존성에 설치돼 있으나 `className` 은 3회뿐.
5. **브랜드 정합** — 스튜디오는 emerald(`#6ee7b7`), WorkBench 는 Trust Blue(`#002554`).
   같은 제품의 연속 화면으로 읽히지 않는다. 다른 스튜디오와의 통일 방침을 먼저 정해야 한다.
