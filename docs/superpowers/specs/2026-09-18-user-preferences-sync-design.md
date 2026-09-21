# Plan E — 최근 사용 앱 대시보드 노출 · 즐겨찾기 서버 동기화 · 최소 환경설정 페이지 설계

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` (§1 공통 규칙, **§2.2 사용자 환경설정 — 이 plan 이 소유**, §3 실행 순서 2번)
- 범위 밖(사용자 결정): 다크모드. Plan A(알림 센터)의 알림 생성·폴링·토스트는 여기서 만들지 않는다 — 이 plan 은
  알림 **수신 설정값**만 저장한다.
- 구현 plan: `docs/superpowers/plans/2026-09-18-user-preferences-sync.md`

## 1. 배경 — 현재 지형(코드 실측)

| 항목 | 현재 | 문제 |
|---|---|---|
| 즐겨찾기 | `contexts/DashboardContext.jsx` L322 `FAVORITES_KEY='favorites'` → localStorage(L354-370) + Electron `preferences:get/set`(L410-417, L444-479) **이중 저장**. `toggleFavorite`/`reorderFavorite`(L717-741)가 두 곳에 같이 쓴다. | PC(정확히는 Electron `userData/preferences.json`)에 묶여 있어 **다른 PC 에서 로그인하면 비어 있다.** 같은 PC 에서 다른 사번이 로그인해도 앞 사람 즐겨찾기가 그대로 보인다(사번 구분 없음). |
| 최근 앱 | `contexts/RecentActivityContext.jsx` — localStorage `hitess_recent_apps`, 최대 8개(L4-5). `Layout.jsx` L150-155 가 `currentMenu` 가 앱이면 `recordAppVisit` 호출. | **소비처가 명령 팔레트(`components/platform/CommandPalette.jsx` L37, L48-54) 하나뿐**이다. Ctrl+K 를 모르는 사용자는 이 데이터를 한 번도 보지 못한다. |
| 대시보드 | `pages/dashboard/Dashboard.jsx` — 즐겨찾기 섹션 L1781-1923(드래그 정렬·4개 창 페이징 `FAVORITE_WINDOW_SIZE=4` L44), 바로 아래 L1925 "프로젝트 이력". | 즐겨찾기를 안 만든 사용자는 매번 카탈로그를 뒤진다. "방금 쓰던 앱" 진입 경로가 없다. |
| 사용자 설정 화면 | 없음. `App.jsx` `renderPage` switch(L511-567)에 사용자용 설정 케이스 없음. 헤더(`Layout.jsx` L328-337)의 이름·직급 블록은 클릭 불가. | 시작 화면·알림 수신 같은 개인 설정을 둘 곳이 없다. Plan A 가 `prefs["notifications"]` 를 읽기로 했으므로 저장 UI 가 필요하다. |
| 백엔드 | `app/models.py` 에 `UserPreference` 없음(342행까지 15개 모델). `app/dependencies.py` `require_auth`(L7) 가 사번을 돌려준다. | 서버에 사용자 설정 저장소가 없다. |

## 2. 목표 / 비목표

**목표**
1. 즐겨찾기·최근 앱·알림 수신 설정·시작 화면을 **사번 단위로 서버에 저장**하고 어느 PC 에서 로그인해도 같게 한다.
2. 대시보드 즐겨찾기 아래에 **"최근 사용" 카드 행(최대 6)** 을 넣는다.
3. 헤더 사용자 블록에서 들어가는 **`'My Settings'` 페이지** 1개(내 정보·시작 화면·알림 수신·초기화).
4. 오프라인·서버 장애에서도 지금처럼 로컬만으로 동작하고, 복구되면 조용히 따라잡는다.

**비목표(YAGNI)**
- 다크모드, 언어, 글꼴 크기 같은 새 설정 항목. 알림 생성/표시(Plan A). 관리자가 남의 설정을 보는 화면.
- Electron `preferences.json` 의 스키마 확장(현재 `favorites` 만 저장, L380-402). 그대로 둔다 — 서버+localStorage 가 나머지를 담당하고, Electron 파일은 "로그인 전 콜드 스타트 즐겨찾기" 역할만 남는다.
- 설정 변경 이력, 설정 내보내기/가져오기.

## 3. 확정 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | **저장소 = `user_preferences` 테이블, 사번 PK, `prefs` JSON 한 칸.** 마스터 §2.2 정의 그대로(컬럼 3개). | Plan A 와 공유하는 계약. 키가 4개뿐이라 정규화 테이블은 과함. |
| D2 | **동기화 규칙 — 로그인 시 서버 우선 병합.** `GET /api/preferences` 를 받아 키별로: 서버 값이 비어 있지 않으면 서버, 비어 있으면 로컬을 쓰고 **그 키만 서버로 올려 시드**한다. "비어 있음" = 배열은 길이 0, `landing_menu` 는 null/빈 문자열, `notifications` 는 기본값(`muted_kinds=[]`, `desktop_toast=true`)과 같음. | 사용자 지시. 두 PC 의 목록을 union 하면 지운 즐겨찾기가 되살아난다 — 단순한 "서버가 진실" 이 예측 가능하다. |
| D3 | **변경은 500ms 디바운스로 `PUT /api/preferences`(부분 병합).** 드래그 정렬처럼 연속 변경은 마지막 값만 간다. 실패하면 pending 에 남기고 **30초 간격으로 재시도**, 다음 성공 시 반영. 그동안 localStorage 는 즉시 갱신된다(현행 UX 유지). | 사용자 지시. 폴링 철학(마스터 §2.1 WebSocket 금지)과 같다. |
| D4 | **로컬 캐시 키를 사번별로 나눈다**: `hitess_prefs:<employee_id>`. 기존 `favorites`·`hitess_recent_apps` 키는 **1회 마이그레이션 시드로만** 읽고(`hitess_prefs_legacy_migrated=1` 플래그), 이후엔 사번별 캐시만 진실이다. | 공용 PC 에서 앞 사람 즐겨찾기가 다음 사번의 서버 계정으로 시드되는 사고를 막는다. Electron `preferences.json` 은 사번 구분이 없으므로 **서버 하이드레이션 이후에는 덮어쓰지 못하게** 한다(§5.3). |
| D5 | **PUT 의 화이트리스트 밖 키는 422 가 아니라 무시하고 `ignored_keys` 로 응답.** 값 형식 오류(배열 아님, 모르는 알림 kind)는 422. | Electron 포터블 exe 는 사용자 PC 마다 버전이 다르다. 새 클라이언트가 새 키를 보냈다고 구 서버가 PUT 을 통째로 거부하면 즐겨찾기까지 안 올라간다. 값 오류는 클라이언트 버그이므로 요란하게. |
| D6 | **`notifications` 는 한 단계 더 부분 병합**(`desktop_toast` 만 보내면 `muted_kinds` 유지). `muted_kinds` 어휘 = 마스터 §2.1 의 9개 kind. Plan A 의 `notification_service.NOTIFICATION_KINDS` 가 있으면 그것을, 없으면 같은 목록의 폴백 상수를 쓴다(지연 import). | Plan A 미구현이어도 저장은 되어야 한다(사용자 지시). |
| D7 | **`landing_menu` 는 서버가 실존 여부를 검사하지 않는다**(문자열 ≤200자 또는 null). 프론트가 적용 시점에 검증: 관리자 메뉴(`constants/adminMenus.js`)는 비관리자에게 무시, 차단 앱(`useAppCatalogue().isBlockedFor`)이면 무시, 알 수 없는 메뉴면 Dashboard. | 메뉴 카탈로그는 프론트 코드(`ANALYSIS_DATA`)에만 있다(App Settings 와 같은 원칙). |
| D8 | **시작 화면 적용은 로그인당 1회**: `user_login_at` 을 키로, 하이드레이션 직후 `currentMenu==='Dashboard' && !canGoBack` 일 때만 `resetNavigation(landing_menu)`. | 세션 복원(앱 재실행) 중 사용자가 이미 다른 화면에 있으면 납치하지 않는다. |
| D9 | **"최근 사용" 은 `RecentActivityContext` 를 그대로 데이터원으로 쓰고**(추적 8개 유지) Dashboard 는 앞 6개를 카드로 그린다. 차단 앱(관리자 오버라이드)은 비관리자에게 숨김, `hasPage` 없는 앱·카탈로그에서 사라진 앱도 숨김. **항목이 0 이면 섹션 자체를 그리지 않는다.** | 데이터원을 두 개 만들지 않는다. 빈 섹션은 대시보드를 늘리기만 한다. |
| D10 | **`'My Settings'` 는 `App.jsx` switch 케이스 1개 + 헤더 사용자 블록 클릭 + 명령 팔레트 메뉴 항목.** 사이드바에는 넣지 않는다. | 사용자 지시("새 라우팅은 케이스 1개"). 개인 설정은 헤더의 '나' 옆이 자연스럽다. |
| D11 | **즐겨찾기/최근 앱 초기화 = `PUT {favorites: []}` / `PUT {recent_apps: []}`.** 별도 DELETE 엔드포인트 없음. `ConfirmDialog` 로 확인. | 엔드포인트 2개로 끝난다(마스터 §2.2). |
| D12 | `GUARDED_ROUTES` 에 등록하지 않는다. | 플랫폼 공통 기능(마스터 §1.8). |
| D13 | **Plan A 선행 여부 분기**: plan Task 1 이 `models.py` 에 `class UserPreference` 가 이미 있는지 grep 으로 확인하고, 있으면 컬럼 3개가 §2.2 와 같은지만 검증하고 건너뛴다. | 마스터 §2.2 "먼저 실행되는 쪽이 만든다". |

## 4. 데이터 모델과 API

### 4.1 모델 (`app/models.py`)

```python
class UserPreference(Base):
  """사용자별 환경설정 — 마스터 규약 §2.2 정의 그대로(Plan A 와 공유)."""
  __tablename__ = "user_preferences"
  employee_id = Column(String(50), primary_key=True)
  prefs = Column(JSON, nullable=False, default=dict)
  updated_at = Column(DateTime)
```

신규 테이블이므로 `models.Base.metadata.create_all`(`app/main.py` L66)로 생성된다. `schema_bootstrap.py` 의
`ensure_*` 함수는 **기존 테이블의 신규 컬럼**용이라 이번엔 추가하지 않는다(마스터 §1.3 의 취지). 서버(145)는
`git pull` + 재시작만으로 테이블이 생긴다.

### 4.2 `prefs` JSON 계약

```jsonc
{
  "favorites":   ["Truss Structural Assessment", "BDF Scanner"],   // ANALYSIS_DATA.title, 순서 = 표시 순서, ≤50
  "recent_apps": [                                                 // at 내림차순, menu 기준 유일, ≤8
    {"menu": "BDF Scanner", "label": "BDF Scanner", "mode": "File", "category": "검증", "at": 1758172800000}
  ],
  "notifications": {"muted_kinds": ["notice.published"], "desktop_toast": true},
  "landing_menu": "My Projects"                                     // null = Dashboard
}
```

정규화(`app/services/user_preferences.py`, 부수효과 없는 함수):
- `favorites`: 문자열만, trim, 빈 값 제거, **순서 유지 중복 제거**, 50개 초과는 잘림. 배열이 아니면 422.
- `recent_apps`: dict 만, `menu` 없으면 버림, `label` 없으면 `menu`, `at` 은 양의 정수(ms) 아니면 0, 같은 `menu` 는 `at` 큰 것만, `at` 내림차순 정렬 후 8개.
- `notifications`: 보낸 키만 갱신. `muted_kinds` 는 어휘 밖 값이 하나라도 있으면 422, 정렬·중복 제거. `desktop_toast` 는 bool 아니면 422.
- `landing_menu`: null 허용, 문자열 trim, 빈 문자열 → null, 200자 초과 422.
- `effective_prefs(stored)`: 저장값 위에 기본값을 채워 **응답은 항상 4키를 모두** 갖는다.

### 4.3 엔드포인트 (`app/routers/preferences.py`, prefix `/api/preferences`, `require_auth`)

| 메서드 | 요청 | 응답 | 비고 |
|---|---|---|---|
| `GET /api/preferences` | — | `{"prefs": {...4키}, "updated_at": "ISO"|null}` | 행이 없으면 기본값을 돌려주고 행을 만들지 않는다. |
| `PUT /api/preferences` | 본문 = 부분 prefs 객체 `{"favorites": [...]}` | `{"prefs": {...병합 결과}, "updated_at": "...", "ignored_keys": [...]}` | 행이 없으면 생성. 화이트리스트 밖 키는 무시하고 `ignored_keys` 에 나열(D5). JSON 컬럼은 **새 dict 를 대입**해야 변경이 추적된다. |

인증은 `require_auth` 만(관리자 구분 없음, 본인 행만 접근). `main.py` `include_router` 목록(L188-212) 끝에 추가.

## 5. 프론트 아키텍처

### 5.1 새 계층 — `contexts/PreferencesContext.jsx`

```
AuthProvider → NavigationProvider → ToastProvider → NetworkProvider
  → ★ PreferencesProvider (신규)          ← isAuthenticated/employeeId 로 하이드레이션
      → RecentActivityProvider             ← prefs.recent_apps 소비·갱신
          → AppInner → DashboardProvider   ← prefs.favorites 소비·갱신
```

Provider 가 갖는 것:
- `prefs` — 현재 실효값(4키). 초기값은 사번별 캐시(D4), 없으면 기본값.
- `status` — `idle | loading | ready | offline`. `offline` 은 GET/PUT 실패 상태(재시도 중).
- `hydration` — 서버 GET 이 끝날 때마다 +1 되는 카운터. **소비자는 이 값이 바뀔 때만 서버 값을 자기 state 에 반영**한다(매 `prefs` 변경마다 반영하면 자기 변경의 메아리로 루프가 생긴다).
- `updatePrefs(partial)` — ① 화이트리스트 키만 골라 ② `prefs` 와 사번별 캐시를 즉시 갱신 ③ 로그인 상태면 pending 에 합치고 500ms 디바운스로 `PUT`. 로그인 전 변경은 다음 하이드레이션 때 시드로 올라간다.
- `resetFavorites()` / `resetRecentApps()` 는 만들지 않는다 — 소비자(DashboardContext/RecentActivityContext)가 자기 state 를 비우고 `updatePrefs({favorites: []})` 를 부른다.

### 5.2 하이드레이션 순서(로그인 1회)

```
isAuthenticated=true
  → status=loading, GET /api/preferences
  → local = 사번별 캐시 ?? (legacy 키 1회 마이그레이션) ?? 기본값
  → { merged, seed } = mergeServerAndLocal(server.prefs, local)     // utils/preferencesMerge.js (순수)
  → prefs=merged, 캐시 저장, hydration+1, status=ready
  → seed 가 비어 있지 않으면 pending 에 넣고 디바운스 PUT (시드)
GET 실패 → prefs=local 그대로, hydration+1, status=offline → 30초마다 재시도(GET 다시)
```

### 5.3 소비자 변경

**`DashboardContext.jsx`(즐겨찾기)**
- `favorites` state 는 유지하되 **변경 함수 3개(`toggleFavorite`/`reorderFavorite`/신규 `clearFavorites`)가 `updatePrefs({favorites: next})` 를 함께 부른다.** 현행 `writeLocalFavorites`·`writeElectronFavorites` 도 그대로(콜드 스타트용).
- `hydration` 이 바뀌면 `prefs.favorites` 를 state·localStorage·Electron 에 반영한다.
- 기존 Electron 로드 effect(L444-479)는 **하이드레이션이 이미 일어났으면 적용하지 않는다**(ref 가드). 로그인 전 마운트 시점엔 지금처럼 Electron 값을 쓴다.
- state 갱신 함수 안에서 부수효과(IPC·PUT)를 부르던 현행 패턴을 **ref 로 현재값을 읽어 밖에서 계산**하는 형태로 바꾼다(StrictMode 이중 호출 시 PUT 이 두 번 나가는 것을 막는다).

**`RecentActivityContext.jsx`(최근 앱)**
- `recordAppVisit` → 다음 목록 계산 → state + localStorage(`hitess_recent_apps`, 현행 유지) + `updatePrefs({recent_apps: next})`.
- `hydration` 이 바뀌면 `prefs.recent_apps` 를 반영. `clearRecentApps` 는 `updatePrefs({recent_apps: []})` 까지.
- 상한 8 유지. 앱 방문마다 PUT 이 나가지만 디바운스가 있고 본문이 1KB 미만이라 부담 없음.

### 5.4 대시보드 "최근 사용" 섹션 (`Dashboard.jsx`)

- 위치: 즐겨찾기 블록(L1781-1923) 바로 뒤, "프로젝트 이력"(L1925) 앞. 같은 `shrink-0` 래퍼 + `DashboardSectionTitle`(icon `History`, accent `history`).
- 데이터: `useRecentActivity().recentApps` → `findAppByAnyName(item.label ?? item.menu)` 로 현재 카탈로그 앱을 찾고(앱 이름이 바뀌었을 수 있음) `useAppCatalogue()` 의 실효 앱으로 치환 → `hasPage` 없으면 제외 → `isBlockedFor(app, getIsAdmin())` 이면 제외 → 앞 6개(`RECENT_APPS_WINDOW_SIZE=6`).
- 카드(`RecentAppCard`, 새 지역 컴포넌트): 아이콘·제목·모드 칩·"n분 전"·별(즐겨찾기 토글). 클릭은 기존 `handleFavoriteClick(app.title)` 재사용(차단 모달·Truss 상태 초기화 규칙 그대로).
- 그리드 `grid-cols-2 md:grid-cols-3 xl:grid-cols-6`. 0건이면 섹션 미표시(D9).

### 5.5 `'My Settings'` 페이지 (`pages/settings/MySettings.jsx`)

`PageHeader`(icon `UserCog`, accent `indigo`) + 카드 4장. 상단에 동기화 상태 배지(`ready`=서버와 동기화됨 / `offline`=서버 연결 없음·이 PC 에만 저장됨 / `loading`).

| 섹션 | 내용 | 저장 |
|---|---|---|
| 내 정보 | 사번·이름·부서·직급 — `useAuth().user` 읽기 전용(`employee_id`, `name`, `department`, `position`). | 없음 |
| 시작 화면 | `<select>`: Dashboard(기본), File-Based Apps, Interactive Apps, Parametric Apps, Productivity Apps, My Projects, Model Library, Notice & Updates, User Guide + **즐겨찾기 앱**(`getAppMenuName(title)`). 관리자면 관리자 메뉴 7개 추가. | `updatePrefs({landing_menu})` 즉시 |
| 알림 수신 | 체크박스 "데스크톱 알림 표시"(`desktop_toast`) + kind 9개 체크박스(체크 = 수신, 해제 = `muted_kinds` 에 포함). 라벨은 `constants/notificationKinds.js`(Plan A 가 재사용 가능). Plan A 미구현 안내 문구 한 줄. | `updatePrefs({notifications: {...}})` 즉시 |
| 초기화 | "즐겨찾기 비우기"(n개) / "최근 사용 비우기"(n개) 버튼 → `ConfirmDialog(variant='warning')` → `clearFavorites()` / `clearRecentApps()`. | 소비자가 PUT |

진입: `Layout.jsx` 헤더의 이름·직급·아바타 블록(L328-337)을 `<button>` 으로 바꿔 `setCurrentMenu('My Settings')`.
명령 팔레트 `menuItems`(L94-116)에 `{ label: 'My Settings', menu: 'My Settings' }`. `App.jsx` switch 에 `case 'My Settings'`.

### 5.6 시작 화면 적용 (`App.jsx`)

`AppInner` 에서 `usePreferences()` 로 `prefs.landing_menu`·`hydration` 을 읽고 D8 규칙으로 1회 `resetNavigation`.
관리자 메뉴는 `ADMIN_MENUS.has(menu) && !isAdmin` 이면 무시, 앱이면 `isAppBlocked(app, isAdmin)` 이면 무시.
(관리자 메뉴로 시작해도 `Layout.handleNavigate` 의 비밀번호 게이트를 거치지 않지만, `renderPage` 의 `ADMIN_MENUS` 가드(L495-510)가 비관리자를 막는다. 관리자 본인이 고른 시작 화면이므로 게이트 생략은 의도된 동작이다.)

## 6. Plan A 연동 지점

- Plan A 는 `service.get_row(db, employee_id)` → `effective_prefs(row.prefs)["notifications"]` 로 읽는다. 폴백 상수 이름은 `NOTIFICATION_KINDS`(frozenset) — Plan A 가 같은 이름을 `notification_service.py` 에 두면 `user_preferences.py` 의 지연 import 가 자동으로 그것을 쓴다.
- 프론트 `constants/notificationKinds.js` 의 `NOTIFICATION_KINDS`(kind·label·group 배열)는 Plan A 의 알림 목록 렌더에도 그대로 쓸 수 있다.

## 7. 테스트 전략

- 백엔드(pytest, `tests/test_user_preferences.py`, 기존 `admin_client`/`switchable_client` 픽스처): 모델 컬럼 계약, 정규화 함수 6종, GET 기본값, PUT 부분 병합·영속, `ignored_keys`, 422(형식/어휘), 사번 격리, 미인증 401.
- 프론트 순수 로직(`node --test`, 기존 `src/utils/*.test.js` 관례): `utils/preferencesMerge.test.js` — 서버 우선, 빈 서버 키 시드, notifications 기본값 판정, 화이트리스트 필터.
- 프론트 화면: 러너가 없으므로 plan 의 각 Task 에 `npm run dev` 기반 수동 검증 절차(두 브라우저 프로필로 두 PC 를 흉내, DevTools Network 로 PUT 디바운스·오프라인 재시도 확인).

## 8. 서버(145) 반영

- 백엔드: `git pull` + 재시작 → `create_all` 이 `user_preferences` 생성. 추가 pip 없음.
- 프론트: WorkBench 포터블 exe 재배포(`npm run dist`) 필요 — 구 클라이언트는 그동안 지금처럼 로컬 저장으로 동작한다(서버는 GET/PUT 을 받을 준비만 되어 있음).
- InHouse 프로그램·Studio 변경 없음.

## 9. 리스크와 함정

| 리스크 | 대응 |
|---|---|
| 서버 값과 자기 변경의 메아리로 무한 PUT | 소비자는 `hydration` 변경 시에만 서버 값을 받아들이고, PUT 응답으로 state 를 되돌리지 않는다(§5.1). |
| 공용 PC 에서 다른 사번 로그인 시 앞 사람 목록이 시드됨 | 사번별 캐시 + legacy 키 1회 마이그레이션 플래그(D4). Electron 파일은 하이드레이션 후 무시(§5.3). |
| 오프라인에서 두 PC 가 엇갈려 수정 | 마지막 PUT 이 이긴다(단순 last-write-wins). 이력·충돌 UI 는 만들지 않는다. |
| 앱 이름 변경으로 저장된 제목이 카탈로그와 어긋남 | 즐겨찾기(L1225-1230)와 같은 `findAppByAnyName` 정규화를 최근 앱에도 적용. |
| JSON 컬럼 in-place 변경이 커밋되지 않음 | `row.prefs = {**current, **accepted}` 로 새 객체 대입(테스트 `test_put_merges_partially_and_persists` 가 재조회로 확인). |
| StrictMode 에서 state updater 안의 부수효과가 두 번 실행 | ref 로 현재값을 읽어 updater 밖에서 계산(§5.3). |
