---
target: File-Based Apps 페이지
total_score: 27
p0_count: 0
p1_count: 3
timestamp: 2026-07-30T07-21-08Z
slug: ntend-src-components-analysis-appcataloguepage-jsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | 탭별 카운트·`N / M apps`·devStatus 배지까지 상태 노출은 좋다. 카탈로그/오버라이드 로딩 중 스켈레톤이 없어 첫 렌더에 코드 기본값이 잠깐 보인다 |
| 2 | Match System / Real World | 3 | 도메인 한국어는 자연스럽다. 카테고리 축이 섞여 있다 — `Truss`·`Pipe`(구조물) vs `FEM Pipeline`(공정) vs `PDF`(파일형식) |
| 3 | User Control and Freedom | 3 | 검색 초기화·All 탭·뷰 모드 유지 모두 있다. '개발 중' 섹션을 접거나 숨길 방법이 없다 |
| 4 | Consistency and Standards | 3 | 공유 컴포넌트 어휘는 일관적. `9 / 9 apps` 영문 혼용, 카드 상단 4px 컬러 밴드는 정보를 담지 않는 장식 |
| 5 | Error Prevention | 3 | AdminGateModal + '준비 중' 토스트 + `hasPage` 검사로 잘못된 진입을 사전 차단한다 |
| 6 | Recognition Rather Than Recall | 3 | 아이콘 전용 없음, 라벨·카운트 모두 보인다. 다만 8개 탭 중 5개가 항목 1개짜리라 분류를 기억하기 어렵다 |
| 7 | Flexibility and Efficiency | 2 | 즐겨찾기 별을 눌러도 **이 페이지에서는 아무 일도 일어나지 않는다**(정렬·고정 없음). 검색 포커스 단축키 없음, 정렬 옵션 없음 |
| 8 | Aesthetic and Minimalist Design | 2 | 9개 중 5개가 `opacity-60`으로 흐려진 '개발 중' 블록이 페이지 절반 이상을 차지한다 |
| 9 | Error Recovery | 3 | 검색 결과 없음 상태는 안내 문구까지 갖췄다. 카탈로그 조회 실패 시 사용자에게 알리는 경로는 없다 |
| 10 | Help and Documentation | 2 | 페이지 내 도움말이 없다. '개발 중' 앱을 눌러도 되는지, 누르면 무엇이 열리는지 화면만 봐서는 알 수 없다 |
| **Total** | | **27/40** | **Acceptable (상단) — 토대는 단단하고, 개선 지점이 분명하다** |

## Anti-Patterns Verdict

**LLM 평가**: AI가 만들었다고 단정할 화면은 아니다. 제품(product) 레지스터의 기준은 "카테고리 최고 도구에 익숙한 사용자가 신뢰하는가"인데, 이 페이지는 대체로 신뢰를 준다 — 헤더 배너, 검색, 카테고리 탭, 카드 그리드는 학습 비용이 0에 가까운 표준 어휘다. 카드 그리드 자체는 여기서 결함이 아니다(Notion·Linear의 템플릿 갤러리가 같은 패턴이다).

다만 두 가지가 "의도 없는 장식"으로 남는다.
1. **카드 상단 4px 컬러 밴드** — 9개 카드가 전부 같은 파란색이다. 색이 아무것도 구분하지 않으므로 정보가 아니라 데코다. DESIGN.md의 "색은 정보가 있을 때만 등장한다"와 충돌한다.
2. **8색 액센트 시스템이 실제로는 1색** — `AppCard`는 7개 클래스 맵 × 8색(약 56개 항목)을 들고 있는데, File 모드 앱 9개가 전부 `bg-blue-600`이라 이 화면에서 파랑 외의 색은 단 한 번도 렌더되지 않는다. 사용자에게 보이는 결함은 아니지만, 유지보수 표면이 실제 표현력의 8배다.

**결정론적 스캔**: `detect.mjs`를 대상 6개 파일(`AppCataloguePage`, `AppCard`, `AppListRow`, `PageHeader`, `FilterTabs`, `NewAnalysis`)에 실행 → **findings 0, exit 0**. 그라데이션 텍스트·사이드 스트라이프·섹션마다 반복되는 eyebrow 같은 서명 패턴은 하나도 없다. 스캐너가 잡지 못한 것(대비·ARIA 중첩·정보 구조)은 아래 Priority Issues에 있다.

**시각 오버레이**: 브라우저 자동화를 쓰지 않았으므로 사용자 화면에 오버레이는 없다. 판단 근거는 소스 코드와 카탈로그 데이터 실측이다.

## Overall Impression

**잘 만든 페이지다. 문제는 "무엇이 강조되는가"가 아니라 "무엇이 흐려지는가"에 있다.**

이 화면은 파일 기반 해석의 관문인데, 실제로 지금 쓸 수 있는 앱은 4개고 나머지 5개는 `opacity-60`으로 흐려진 채 '개발 중' 구분선 아래에 놓인다. 화면 면적의 절반 이상이 "아직 못 쓰는 것"에 배정돼 있고, 그 절반은 대비 기준도 통과하지 못한다. 엔지니어가 이 페이지에 오는 이유는 오늘 할 해석을 고르기 위해서인데, 페이지는 로드맵처럼 보인다.

가장 큰 기회 하나: **'개발 중' 앱을 흐리는 대신 접어두고, 쓸 수 있는 4개에 화면을 내주는 것.** 그것만으로 페이지의 목적이 선명해진다.

## What's Working

1. **차단 로직이 화면·API 양쪽에서 일관되다.** `getBlock()` → `AdminGateModal`, `hasPage` 미등록 앱 → '준비 중' 토스트, 카드 CTA는 `Lock` + "관리자 전용"으로 미리 알려준다. 클릭하고 나서야 막히는 게 아니라 **누르기 전에 상태가 보인다.** PRODUCT.md의 "작업 상태를 숨기지 않는다" 원칙이 실제 코드에 반영된 드문 사례다.

2. **모션 처리가 정석이다.** `main.jsx`의 `MotionConfig reducedMotion="user"`가 framer-motion을 OS 설정에 연동하고, `index.css`의 `@media (prefers-reduced-motion: reduce)`가 CSS 애니메이션을 별도로 잡는다. JS 모션과 CSS 모션을 각각 다른 메커니즘으로 처리해야 한다는 걸 아는 구현이다. 전환 시간도 200ms 안팎으로 제품 UI 기준에 맞다.

3. **검색이 표면 텍스트를 넘어선다.** `matchesSearch`가 title·description뿐 아니라 태그·담당자·입출력 형식·샘플 파일·관련 앱까지 인덱싱한다. "BDF"로 검색하면 설명에 BDF가 없는 앱도 입력 형식으로 잡힌다. 뷰 모드는 `localStorage`로 유지된다.

## Priority Issues

### [P1] '개발 중' 앱 5개가 페이지 절반을 흐린 채로 차지한다

- **What**: File 모드 앱 9개 중 5개가 `devStatus: "Developing"`이다(`이중관 구조 연료배관 해석` 등). 이들은 `renderSection(developingApps, true)`로 `opacity-60`이 적용된 채 '개발 중' 구분선 아래 렌더된다(`AppCataloguePage.jsx:288-298`).
- **Why it matters**: 두 가지가 동시에 나빠진다. (1) **대비 실패** — 카드 설명은 이미 `text-slate-500`(#64748b, 흰 배경에서 4.76:1)인데 여기에 60% 불투명도가 곱해지면 실효 대비가 약 2.6:1로 떨어져 WCAG AA(4.5:1)를 크게 밑돈다. PRODUCT.md 접근성 기준의 명시적 위반이다. (2) **목적 희석** — 오늘 해석을 하러 온 사용자에게 화면의 과반이 "아직 안 되는 것"으로 채워진다. 로드맵과 작업 도구가 한 화면에서 경쟁한다.
- **Fix**: '개발 중' 섹션을 **기본 접힘**으로 바꾸고 헤더에 개수만 노출한다(`개발 중 5개 ▾`). 펼쳤을 때는 `opacity-60`을 걷어내고, 대신 카드마다 이미 있는 `StatusBadge`(Developing)로 상태를 알린다 — 상태는 배지가 말하게 하고 가독성은 희생하지 않는다. 접힘 상태는 `localStorage`에 유지해 매번 접지 않아도 되게 한다.
- **Suggested command**: `/impeccable layout`

### [P1] 카드가 버튼 안에 버튼을 품고 있고, Space 키가 페이지를 스크롤시킨다

- **What**: `AppCard`는 루트가 `role="button" tabIndex={0}`인데(`AppCard.jsx:156-160`) 그 안에 즐겨찾기 버튼(`:197`)과 관리자 설정 버튼(`:185`)이 중첩돼 있다. 또 키 핸들러가 `if (e.key === 'Enter' || e.key === ' ') onStart?.()`로 끝나고 **`preventDefault()`가 없다**(`:160`). `AppListRow.jsx:67-70`도 동일하다.
- **Why it matters**: 버튼 안의 버튼은 ARIA 위반이다. 스크린리더는 중첩 인터랙티브 요소를 예측 불가능하게 평탄화하고, 키보드 사용자는 "버튼 내부로" 탭 이동하는 모순된 경험을 한다. Space 미차단은 더 즉각적이다 — **카드에 포커스를 두고 Space를 누르면 앱이 열리는 동시에 페이지가 한 화면 아래로 스크롤된다.**
- **Fix**: 루트에서 `role="button"`을 걷어내고 `<article>`로 두되, 카드 제목을 실제 `<button>`(또는 stretched-link 패턴의 앵커)으로 만들어 그 하나만 포커스 가능하게 한다. 즐겨찾기·설정 버튼은 형제로 남긴다. Space 처리는 `if (e.key === ' ') { e.preventDefault(); onStart?.(); }`로 분리한다.
- **Suggested command**: `/impeccable audit`

### [P1] `slate-400` 본문 텍스트가 대비 기준을 통과하지 못한다

- **What**: 흰 배경 위 `text-slate-400`(#94a3b8 ≈ **2.9:1**)이 본문·라벨로 반복해서 쓰인다 — 카드 담당자 줄(`AppCard.jsx:310`), Input/Output 형식 라벨(`:259`, `:272`), '개발 중' 구분선 라벨(`AppCataloguePage.jsx:293`), 검색 placeholder(`Input.jsx:54` `placeholder-slate-400`), 리스트 행 라벨(`AppListRow.jsx:102,112`).
- **Why it matters**: DESIGN.md가 "**보조 텍스트는 slate-500보다 연하게 내리지 않는다**"고 못박은 규칙을 시스템 컴포넌트가 스스로 어기고 있다. placeholder는 impeccable 일반 규칙에서도 4.5:1을 요구한다. 밝은 사무실 조명 아래 데스크탑에서 10~11px `slate-400`은 실질적으로 읽히지 않는다.
- **Fix**: 이 용도의 `slate-400`을 전부 `slate-500`(4.76:1)으로 올린다. 그래도 위계가 무너지지 않는다 — 본문이 이미 `slate-500`이므로 라벨은 크기(10px)와 `font-black uppercase tracking-wider`로 충분히 구분된다. 위계를 더 벌리고 싶으면 라벨을 `slate-600`, 본문을 `slate-500`으로 두는 편이 안전하다.
- **Suggested command**: `/impeccable audit`

### [P2] 앱 9개에 카테고리 탭 8개 — 5개는 항목이 1개뿐이다

- **What**: 카테고리는 `Truss`(2), `Pipe`(2), `Lifting`(1), `Mooring Fitting`(1), `Passage`(1), `PDF`(1), `FEM Pipeline`(1). `All`까지 8개 탭이 한 줄을 가득 채운다.
- **Why it matters**: 항목이 1개인 필터는 필터가 아니다. 사용자는 "이 앱이 Pipe인가 FEM Pipeline인가"를 판단해야 하는데, 분류 축이 섞여 있어(구조물 / 공정 / 파일형식) 그 판단에 근거가 없다. 작업기억 한계(≤4~5)를 넘는 선택지가 얻는 것 없이 인지 부담만 만든다.
- **Fix**: 축을 하나로 통일하고 3~4개로 묶는다. 예: `구조 해석`(Truss·Lifting·Passage) / `배관`(Pipe) / `의장·계류`(Mooring Fitting) / `파이프라인`(FEM Pipeline·PDF). 카테고리가 2개 이하가 되면 탭을 아예 감추고 검색만 남기는 것도 정당하다 — 9개는 눈으로 훑는 편이 빠르다.
- **Suggested command**: `/impeccable distill`

### [P2] 즐겨찾기 별이 이 페이지에서는 아무 일도 하지 않는다

- **What**: 카드의 별을 누르면 `toggleFavorite`로 상태는 저장되지만, 이 페이지의 정렬·필터는 `favorites`를 전혀 참조하지 않는다(`AppCataloguePage.jsx:105-116`의 `filtered`/`activeApps`/`developingApps` 어디에도 없다).
- **Why it matters**: 눌렀는데 화면이 그대로면 사용자는 "저장이 안 됐나?" 또는 "이게 무슨 의미지?"로 해석한다. 매일 같은 앱 2~3개만 쓰는 실무자에게 즐겨찾기는 가장 값싼 가속기인데, 그 보상이 다른 화면(Dashboard)에만 있다.
- **Fix**: 활성 앱 목록에서 즐겨찾기를 최상단으로 끌어올리거나(`activeApps`를 `isFavorite` 우선 정렬), 카테고리 탭에 `★ 즐겨찾기` 탭을 추가한다. 정렬을 바꿀 때는 별을 누른 카드가 이동하는 것을 모션으로 보여줘야 원인-결과가 읽힌다.
- **Suggested command**: `/impeccable layout`

## Persona Red Flags

**Alex (숙련 실무자 / 파워 유저)**
- 검색창 포커스 단축키가 없다. 매번 마우스로 입력란을 클릭해야 한다(`/` 또는 `Ctrl+K`가 표준 기대치다).
- 즐겨찾기를 눌러도 목록 순서가 바뀌지 않아, 매일 쓰는 2개 앱을 매번 9개 중에서 눈으로 찾는다.
- 정렬 옵션이 없다. 최근 사용순·이름순 중 어느 것도 고를 수 없다.
- 카드에 포커스를 두고 Space를 누르면 앱이 열리면서 페이지가 스크롤된다 — 키보드로 훑는 사람만 만나는 버그다.

**Jordan (첫 사용자)**
- '개발 중' 섹션이 흐려져 있지만 클릭은 된다. 눌러도 되는지, 누르면 실제로 해석이 되는지 화면만으로는 알 수 없다. 실제 동작은 `hasPage`에 따라 갈리는데(페이지가 있으면 진입, 없으면 '준비 중' 토스트) 그 차이가 카드에 표시되지 않는다.
- `FEM Pipeline`과 `Pipe`의 차이를 짐작할 근거가 없다. 도메인 초심자에게 이 두 탭은 같은 말로 읽힌다.
- 페이지 어디에도 도움말·가이드 링크가 없다. 다른 페이지의 `PageHeader`는 `programKey`로 '이력' 버튼을 붙일 수 있는데 이 페이지는 쓰지 않는다.

**Sam (접근성 의존 사용자)**
- 카드가 `role="button"`인데 내부에 버튼 2개(즐겨찾기·설정)가 중첩돼 있어 스크린리더 탐색이 예측 불가능하다.
- `opacity-60`이 적용된 '개발 중' 카드 5장은 본문 대비가 약 2.6:1로 읽기 어렵다.
- `slate-400` 라벨·placeholder가 2.9:1로 기준 미달이다.
- 즐겨찾기 버튼은 `aria-label`이 상태에 따라 바뀌어 좋다(`'즐겨찾기 해제' / '즐겨찾기 추가'`). 이건 제대로 돼 있다.

**구조 엔지니어 (프로젝트 고유 페르소나)**
- PRODUCT.md의 핵심 작업은 "업로드 → 실행 → 추적 → 결과 확인"의 반복이다. 그런데 이 관문 페이지는 **어떤 앱이 어떤 입력을 요구하는지**를 카드 하단 작은 칩으로만 알려준다. 손에 BDF 파일 하나를 들고 온 사용자가 "이 파일로 뭘 할 수 있지?"를 물으면, 입력 형식으로 필터링할 방법이 없다.
- 5개가 '개발 중'이라는 사실은 사내 도구의 신뢰(PRODUCT.md 브랜드 personality 1순위)에 직접 작용한다. 흐린 카드 5장은 "이 플랫폼은 아직 절반이 미완성"이라는 메시지를 매 방문마다 전달한다.

## Minor Observations

- `{filtered.length} / {apps.length} apps` — 한국어 UI에 영문 `apps`가 섞인다. `9개 중 9개 표시` 같은 표현이 나머지 화면과 맞는다.
- 카드 상단 4px 컬러 밴드(`AppCard.jsx:179-181`)는 9장이 전부 같은 파란색이라 구분 기능이 없다. 제거하거나, 카테고리별 색으로 실제 정보를 담게 한다.
- `AppCard`의 8색 액센트 맵 7세트(약 56개 클래스 항목) 중 이 화면에서 쓰이는 건 `blue` 하나다. 다른 모드 페이지에서도 실제로 다색을 쓰는지 확인하고, 안 쓰면 정리 대상이다.
- 카탈로그 로딩 중 스켈레톤이 없다. `useAppSettings`가 60초 폴링으로 오버라이드를 가져오므로 첫 렌더와 갱신 사이에 카드 상태가 조용히 바뀔 수 있다.
- '개발 중' 구분선 라벨이 `uppercase tracking-wider`인데 한글이라 `uppercase`는 아무 효과가 없다. 무해하지만 의도가 남아 있는 흔적이다.

## Questions to Consider

- 이 페이지의 성공 지표가 "앱을 찾는 시간"이라면, 9개 중 5개가 못 쓰는 앱인 화면이 그 지표를 돕고 있나? 개발 중 앱을 별도 화면(로드맵)으로 옮기면 무엇을 잃나?
- 엔지니어가 실제로 던지는 질문은 "Truss 카테고리 앱이 뭐지?"가 아니라 "이 BDF로 뭘 할 수 있지?"에 가깝지 않나? 분류축을 **입력 파일 형식**으로 바꾸면 어떤 화면이 되나?
- 매일 같은 2개 앱만 쓰는 사용자에게, 9개를 매번 동등하게 보여주는 것이 맞나? 최근 사용 앱이 상단에 고정되면 이 페이지는 몇 초 빨라지나?
- 카드에서 색을 완전히 걷어내면(아이콘 배경만 남기고) 이 화면은 더 나빠지나, 더 조용하고 정확해지나?
