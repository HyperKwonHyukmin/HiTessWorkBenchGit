# HiTESS Studio Standard

이 문서는 `C:\Coding\WorkBenchSubModule\ModelBuilderStudio`의 디자인 컨셉, 메뉴 구조, 부재 선택, Edit 흐름, 저장/호스트 통합 방식을 WorkBench의 Studio 계열 기능 표준으로 정리한 것이다. 새 Studio를 만들거나 유사 Studio UI를 통일할 때 이 파일을 우선 참조한다.

## 1. Studio의 정체성

Studio는 일반 페이지가 아니라 **엔지니어링 모델을 직접 보고, 검증하고, 편집 의도를 쌓고, 다음 파이프라인 단계로 넘기는 작업장**이다. WorkBench 본체의 "Engineering Control Room" 톤을 유지하되, 화면 구성은 데이터 밀도가 높은 전문 도구에 맞춘다.

핵심 성격:

- 전체 화면 또는 큰 보조 창에서 동작하는 L3/L2급 작업형 Viewer/Editor.
- 중앙에는 3D/Canvas 작업면을 두고, 주변 도크에 파일, 레이어, 검사, 편집, 저장 도구를 배치한다.
- 사용자는 모델을 "직접 수정"하는 것이 아니라, 원본 데이터 위에 검증 가능한 변경 의도(intent)를 누적한다.
- 모든 변경은 미리보기로 즉시 확인하되, 최종 적용은 별도 빌더/백엔드 파이프라인이 책임진다.

Studio가 피해야 할 것:

- 마케팅용 랜딩 페이지, 큰 hero, 장식 카드 중심 UI.
- 의미 없는 그래디언트/오브/일러스트 배경.
- 원본 모델을 UI에서 암묵적으로 직접 변형하는 동작.
- 색상만으로 상태를 전달하는 진단/검증 표시.

## 2. 기본 레이아웃

ModelBuilderStudio의 표준 레이아웃은 다음 구조를 따른다.

```text
[TopMenuBar: Studio identity + mode tabs + theme]
└─ [Main Work Area]
   ├─ [LeftDock: active mode panel, width 300px 기본]
   └─ [Viewport Column]
      ├─ [ViewportContainer: 1~4개 viewport grid]
      └─ [BottomReviewDock: audit / diff / review dock, 필요 시만 표시]
```

레이아웃 원칙:

- 상단 바는 42px 내외의 얇은 리본이다. 브랜드/도구명과 모드 탭만 둔다.
- 좌측 도크는 기본 300px, 리사이즈 가능 범위는 대략 130~320px이다.
- 중앙 작업면은 항상 가장 큰 면적을 차지한다.
- 하단 리뷰 도크는 상시 점유하지 않고, 변환 감사/단계 비교 등 검토 데이터가 있을 때만 열린다.
- 오른쪽 Inspector가 필요한 Studio는 접힘 가능한 도크로 두되, 좌측 명령 도크와 역할을 분리한다. 좌측은 "행동", 우측은 "선택 상세/추적"이다.
- 작은 창/Windows 배율 대응을 위해 기준 작업면(예: 960x820)보다 작으면 전체 Studio UI를 균등 축소할 수 있다. 최소 스케일은 약 0.68까지 허용한다.

## 3. Top Menu Bar

상단 메뉴는 일반 네비게이션이 아니라 Studio의 **작업 모드 전환 리본**이다.

표준 탭:

| 탭 | 역할 |
|---|---|
| `Model` | 파일/폴더 로드, 뷰포트, 렌더, 레이어 등 기본 모델 조작 |
| `Model Check` | 노드, 그룹, 연결성, 진단 필터 중심의 검증 도구 |
| `Edit` | 편집 모드 진입, 삭제/연결 등 변경 의도 작성 |
| `Save` | 편집 의도 저장, WorkBench 다음 단계 요청, 종료 흐름 |

탭 동작:

- 탭 클릭은 좌측 `LeftDock`의 내용을 교체한다.
- `Edit` 탭으로 들어가면 편집 모드를 자동으로 켠다.
- 다른 탭으로 이동하면 편집 모드는 꺼질 수 있으나, 이미 쌓인 intent는 유지한다.
- 활성 탭은 초록 계열 accent 배경, 테두리, 약한 glow로 구분한다.
- 탭에는 `lucide-react` 아이콘을 붙인다. 예: `Box`, `CheckCircle2`, `Pencil`, `Save`.
- 우측에는 Light/Dark theme 토글을 둔다.

## 4. 좌측 도크 패널

좌측 도크는 모드별로 다른 패널을 보여준다.

### Model 패널

Model 패널은 Studio 기본 조작을 담당한다.

구성:

- `파일`: 파일 열기, 폴더 열기, 로딩/에러/로드 요약 표시.
- `뷰포트`: 뷰 추가, 현재 뷰포트 수 표시, 카메라 동기화.
- `렌더`: 3D 단면 렌더링, X-ray 등 표시 방식.
- `레이어`: Node, 구조, 배관, RBE, 질량, 경계조건, U-bolt, DOF, 무게중심 등 토글.
- `편집`: 간단한 편집 모드 토글. 전용 Edit 탭이 있으면 여기서는 축약 형태.
- `단계`: 로드된 stage 개수.
- `초기화`: stages, viewer state, edit state 전체 초기화.

호스트 통합 시 주의:

- WorkBench/Electron이 초기 폴더를 자동 주입하는 경우 `파일 열기`/`폴더 열기` 버튼은 숨길 수 있다.
- 브라우저 단독 실행에서는 수동 파일/폴더 선택을 제공한다.
- 이미 데이터가 로드된 상태에서 새 파일/폴더를 열려고 하면 섞임을 막기 위해 초기화를 요구한다.

### Model Check 패널

검증 모드는 뷰포트 색상 모드를 자동으로 검증 목적에 맞춘다.

표준 하위 탭:

- `Node Check`: Shared, Free, Orphan 노드 필터. 각 행은 색 점, 라벨, 개수, 설명을 포함한다.
- `Group`: connectivity group 표시/숨김, 전체 표시/숨김, 그룹별 요소/노드 수.

원칙:

- 검증 모드에서는 보이는 데이터와 필터 상태가 직접 연결되어야 한다.
- 그룹이 많으면 상위 N개만 개별 표시하고 나머지는 `기타`로 묶는다.
- 색상은 구분용으로 쓰되, 행에는 반드시 텍스트와 개수를 같이 둔다.

### Edit 패널

Edit 패널은 원본 모델 변경이 아니라 `EditIntent[]` 작성 도구다.

구성:

- `편집 모드` 토글.
- `Group 삭제`: 그룹별 삭제 예정 토글.
- `수정 내역`: intent 목록, 검증 배지, 선택/삭제/전체 초기화.
- `Rigid 만들기`: 3D 뷰포트에서 Shift+Click으로 선택한 노드가 있을 때 표시.
- `충돌/경고 요약`: warning/error를 한눈에 확인.

편집 모드가 꺼져 있을 때:

- 도구는 숨기고, 기존 미리보기/intent는 유지된다는 안내를 둔다.
- 다중 노드 선택은 꺼질 때 자동으로 비운다.

### Save 패널

Save 패널은 "현재 모델을 최종 저장하고 다음 단계로 넘긴다"는 명확한 액션만 제공한다.

구성:

- 큰 `Model 저장` 버튼.
- 현재 수정 내역 개수.
- 저장 중/성공/실패 상태 텍스트.
- 저장 전 확인 다이얼로그.

저장 흐름:

1. intent가 있으면 `_edit.json`을 원본 stage JSON 옆에 저장한다.
2. WorkBench 호스트가 있으면 `finalizeEditedModel` 같은 명령으로 다음 BDF 저장/검증 단계를 요청한다.
3. 호스트가 없으면 파일 저장만 완료하고 사용자에게 상태를 알려준다.

## 5. Viewport 구성

Viewport는 Studio의 중심이다.

기본 기능:

- 1개 뷰포트: 전체 영역.
- 2개 뷰포트: 1x2.
- 3~4개 뷰포트: 2x2.
- 최대 4개까지 허용한다.
- 각 viewport header에는 stage 선택 dropdown, 노드/요소 count, 닫기 버튼을 둔다.
- 활성 viewport는 테두리로 구분한다.
- 카메라 동기화가 켜져 있으면 모든 viewport camera를 함께 움직인다.

Stage 선택:

- 각 viewport는 서로 다른 stage를 볼 수 있다.
- Edit 미리보기는 마지막 stage(보통 Validation)에만 적용한다.
- Edit 탭 진입 시 활성 viewport를 마지막 stage로 자동 전환하는 것이 좋다.

빈 상태:

- stage가 없으면 중앙에 간단한 안내를 둔다. 장식적인 hero가 아니라 "어떤 파일/폴더를 선택해야 하는지"만 짧게 보여준다.

## 6. 선택 UX

Studio의 선택은 단일 선택과 편집용 다중 선택을 명확히 구분한다.

### 단일 선택

클릭 가능한 대상:

- Node
- Element/Beam
- RBE/Rigid
- Point Mass
- CSV/source row 매칭 항목

단일 선택 동작:

- raycaster로 가장 가까운 pickable을 선택한다.
- 선택 즉시 `PickTooltip`을 마우스 근처에 띄운다.
- Inspector가 있다면 선택 상세를 보여준다.
- 선택 대상과 연결된 요소/노드를 cyan 계열 highlight로 보여준다.
- 선택 상세에는 focus, isolate, clear 같은 icon action을 제공한다.

Tooltip 표준:

- Node: `Node #1485`
- Element: `Element #100 | Structure | 1 -> 2`
- RBE: `RBE #9001 UBOLT | ind 1485 <-> dep 3개 cm=123456`
- Mass: `Mass #11 | Node #1 | 1.50 kg`
- Source: `CSV: sourceName | kind | status | 매칭 n`

### 편집용 다중 노드 선택

편집 모드 + 마지막 stage에서만 활성화한다.

동작:

- `Shift + Click`으로 Node를 pending selection에 추가/제거한다.
- 선택된 노드는 노란색 sphere와 `N{id}` label로 표시한다.
- 다중 선택은 일반 Inspector selection으로 전파하지 않는다.
- 선택 수가 2개 이상이면 `Rigid 로 묶기` 액션을 활성화한다.
- `Esc`는 pending selection을 비운다.

색상 구분:

- 단일 선택 highlight: cyan (`#00E5FF` 계열).
- 편집 다중 선택: amber/yellow (`#FFB800` 계열).
- RBE ambient highlight: magenta.
- 삭제 예정: red dim.
- 추가될 RBE preview: yellow dashed line.
- 끊기는 RBE: yellow warning line.

## 7. EditIntent 원칙

가장 중요한 원칙:

> Studio는 원본 `StageData`를 직접 변경하지 않는다. 모든 편집은 `EditIntent[]`에 누적하고, 뷰포트는 `StageData + EditIntent[]`로 derived preview를 렌더링한다.

기본 intent 스키마:

```json
{
  "schemaVersion": "1.0",
  "stageRef": {
    "phase": "C",
    "stageName": "Validation",
    "sourceTimestamp": "20260429_075027"
  },
  "createdAt": "2026-04-29T15:42:00+09:00",
  "createdBy": "viewer",
  "intents": [
    {
      "id": "uuid",
      "kind": "deleteGroup",
      "createdAt": "2026-04-29T15:41:50+09:00",
      "params": { "groupId": 0, "memberNodeCount": 5389 },
      "validation": { "status": "ok", "warnings": [], "errors": [] }
    }
  ]
}
```

지원 intent:

| kind | 의미 | params |
|---|---|---|
| `deleteGroup` | connectivity group 삭제 예정 | `groupId`, `memberNodeCount?` |
| `addRigid` | 새 RBE/Rigid 연결 추가 | `independentNode`, `dependentNodes[]`, `remark?`, `cm?` |
| `deleteRigid` | 기존 RBE 삭제. 주로 RBE 병합 흡수용 | `rigidId`, `reason?` |

배열 순서가 적용 순서다. 예를 들어 기존 RBE를 흡수하고 새 RBE를 만들 때는 `deleteRigid...`가 먼저, `addRigid`가 마지막에 와야 한다.

## 8. 편집 기능 표준

### Group 삭제

입력:

- 마지막 stage의 `connectivity.groups`.
- 표시 ID는 UI index가 아니라 빌더와 일치하는 안정 ID(`builderId ?? id`)를 사용한다.

UX:

- 그룹 행은 색 점, `그룹 n`, 요소 수, 노드 수, trash/undo icon을 포함한다.
- 클릭하면 `deleteGroup` intent를 추가한다.
- 이미 삭제 예정이면 클릭 시 해당 intent를 제거한다.
- 삭제 예정 행은 red 계열 배경/테두리와 `삭제 예정` 라벨로 표시한다.

Preview:

- 삭제 대상 노드/요소/질량/RBE는 뷰에서 숨기거나 dim 처리한다.
- 삭제로 끊기는 RBE는 warning highlight를 표시한다.
- derived node/element/RBE/mass/group count를 즉시 계산해 보여준다.

검증:

- groupId가 정수가 아니면 error.
- 현재 stage에 없는 groupId면 error.
- 같은 그룹 삭제 intent가 이미 있으면 error.
- 삭제 대상 노드가 다른 RBE의 독립노드이고 종속 일부가 살아 있으면 warning.

### Rigid 만들기

입력:

- 편집 모드에서 Shift+Click으로 선택한 노드 목록.
- 선택 노드가 기존 RBE 멤버와 닿으면 기존 RBE들을 전이적으로 흡수해 하나의 RBE로 병합한다.

Dialog:

- 제목: `새 RBE 만들기`.
- 연결 노드 목록과 독립 노드 radio.
- `Remark` 입력. 기본 `UBOLT`.
- `DOF (cm)` 입력. 기본 `123456`.
- 종속 노드 요약.
- 검증 error/warning 인라인 표시.

검증:

- 독립 노드는 정수여야 한다.
- 종속 노드는 비어 있으면 안 된다.
- 독립 노드와 종속 노드가 같으면 error.
- 참조 노드가 StageData에 없으면 error.
- `cm`은 1~6 중복 없는 숫자 1~6자리여야 한다. 예: `123`, `26`, `123456`.
- 동일한 독립/종속 조합이 원본 또는 기존 intent에 있으면 warning.

병합 규칙:

- 선택 노드 중 하나라도 기존 RBE의 독립/종속 멤버면 해당 RBE를 흡수 대상으로 본다.
- 흡수된 RBE의 모든 노드를 병합 집합에 추가한다.
- 새로 추가된 노드가 다른 RBE와 닿으면 그것도 흡수한다.
- 결과 intent는 `deleteRigid` 여러 개 후 `addRigid` 하나로 생성한다.
- 이 방식은 한 노드가 여러 RBE의 종속이 되어 Nastran FATAL이 나는 상황을 예방한다.

Preview:

- 추가 예정 RBE는 yellow dashed line으로 렌더링한다.
- 기존 RBE 연결점은 magenta ambient highlight로 보여준다.
- 선택 노드는 amber sphere + node label로 표시한다.

## 9. 수정 내역 패널

EditIntent 목록은 사용자가 변경 세트를 검토하고 취소하는 중심 UI다.

행 구성:

- 순번.
- 검증 배지: `OK`, `WARN`, `ERR`.
- 사람이 읽는 요약.
- 삭제 icon.

요약 예:

- `RBE: 1485 <-> 1489,1490,1491 (UBOLT)`
- `그룹 #7 삭제 (23 노드)`
- `RBE #9123 삭제 (병합 흡수)`

패널 기능:

- 행 클릭으로 intent 선택/해제.
- 선택된 intent는 amber 계열 배경으로 강조.
- `Delete`/`Backspace`로 선택 intent 제거.
- `Ctrl/Cmd + Z`로 마지막 intent 제거.
- `Esc`로 pending node selection 또는 intent selection 해제.
- `전체 초기화`는 confirm 후 모든 intent 제거.
- warning/error count를 헤더에 함께 표시한다.

## 10. Inspector / Review Dock

Studio가 별도 Inspector를 둘 경우 다음 탭 구성을 따른다.

표준 Inspector 탭:

- `메타`: stageName, phase, schema, unit, timestamp.
- `모델지표`: node/element/RBE/mass count, 길이, mass, issue count. 편집 모드에서는 원본 -> 편집 후 값을 함께 표시.
- `연결성`: group count, largest group, isolated node, section kind distribution.
- `진단`: severity/code filter, 진단 행 클릭 시 3D 선택.
- `추적`: element/node 생성, 삭제, 병합, 분할 history. ID 검색과 stage/action filter 제공.
- `편집`: 편집 모드가 켜져 있으면 EditPanel을 보조로 표시.

BottomReviewDock 표준:

- 데이터가 있을 때만 표시한다.
- `변환 감사`: total/converted/ignored/parseFailed 등 summary chip.
- `단계 비교`: stage diff table.
- 접힘/닫기 버튼을 제공한다.
- 최대 높이는 전체 viewport column의 약 36% 이내로 제한한다.

## 11. 색상과 시각 언어

WorkBench 본체의 디자인 시스템을 따른다. Studio 내부는 3D 작업면 특성상 dark theme을 기본으로 허용하지만, 의미론적 palette를 통해 light/dark를 모두 지원한다.

Studio semantic token 예:

| 역할 | Light | Dark |
|---|---|---|
| panelBg | `#f8fafc` | `#0b0b1e` |
| panelBg2 | `#ffffff` | `#0f0f22` |
| panelBg3 | `#eef2f7` | `#101024` |
| border | `#e2e8f0` | `#1e1e38` |
| borderStrong | `#cbd5e1` | `#2a2a4a` |
| textPrimary | `#0f172a` | `#e6f1ff` |
| textSecondary | `#334155` | `#b0c4d8` |
| textMuted | `#64748b` | `#7a8aaa` |
| accent | `#059669` | `#059669` |
| accentLight | `#6ee7b7` | `#6ee7b7` |
| tabIndicator | `#2563eb` | `#4682B4` |

도메인 색상:

- Structure: blue 계열.
- Pipe: orange 계열.
- Node: red/pink 계열.
- RBE: magenta.
- U-bolt marker: cyan.
- U-bolt DOF: yellow.
- COG: gold.
- Success: emerald.
- Warning: amber.
- Danger/delete: red.

규칙:

- 색은 정보 전달용이다. 장식 면적을 키우지 않는다.
- ON/OFF 토글은 색 점, 텍스트, `ON/OFF` 라벨을 같이 사용한다.
- 상태 배지는 색만 쓰지 말고 `OK/WARN/ERR` 같은 텍스트를 포함한다.
- Edit 관련 yellow는 "편집 중/미리보기/추가 예정"에만 사용한다.
- Delete red는 "삭제 예정/위험/초기화 hover"에만 사용한다.

## 12. 컴포넌트 형태

Studio 컴포넌트는 WorkBench 본체보다 더 촘촘하지만, 컨트롤 크기와 시각 위계를 일정하게 유지한다.

표준 치수:

- Top bar 높이: 42px 내외.
- 좌측 도크 폭: 300px 기본.
- Panel section padding: 8~12px.
- Section label: 10px, uppercase, letter spacing 약 1.4~1.5px, font-weight 800.
- Tool button: height 28~34px, border-radius 5~7px.
- Icon button: 22~32px 정사각형.
- Modal radius: 8px.
- Tooltip radius: 5px.

버튼/행 스타일:

- `display: flex`, icon + label + trailing status 구조를 기본으로 한다.
- 행 버튼은 전체 폭을 클릭 가능하게 만든다.
- active 상태는 배경 tint + border + text weight로 표시한다.
- disabled 상태는 opacity만 낮추지 말고 cursor, text color, border도 비활성 톤으로 바꾼다.

카드 사용:

- Studio에서는 반복 항목, modal, inspector item 정도에만 카드 형태를 쓴다.
- 큰 섹션을 카드 안 카드로 중첩하지 않는다.
- 도크 내부는 섹션 구분선과 배경 차이로 나눈다.

## 13. 파일/호스트 통합

Studio는 브라우저 단독 실행과 WorkBench/Electron 임베드를 모두 지원할 수 있어야 한다.

HostAdapter 표준:

```ts
interface HostAdapter {
  name: 'web' | 'electron'
  pickFolder(): Promise<{ cancelled: true } | { folderRef: unknown, files: FileLike[] }>
  getInitialFolder(): Promise<null | { folderRef: unknown, files: FileLike[] }>
  writeFile(folderRef: unknown, fileName: string, content: string): Promise<{ ok: boolean, error?: string }>
}

interface FileLike {
  name: string
  text(): Promise<string>
}
```

원칙:

- 환경 분기는 컴포넌트 곳곳에 흩뿌리지 말고 host adapter 한 곳에 둔다.
- `folderRef`는 opaque 값으로 취급한다. 컴포넌트는 저장만 하고 host에 다시 넘긴다.
- WebHost는 File System Access API 또는 download fallback을 쓴다.
- ElectronHost는 preload가 노출한 `window.workbenchAPI`만 사용한다.
- 파일 쓰기 IPC는 path traversal을 방어해야 한다.

부팅:

- WorkBench가 초기 폴더를 주입하면 `getInitialFolder()`로 즉시 stage를 로드한다.
- Web 단독 실행에서는 `getInitialFolder()`가 `null`이어야 한다.

## 14. 저장/파이프라인 계약

Studio 저장은 "파일 다운로드"가 아니라 WorkBench 파이프라인의 다음 단계를 여는 계약이다.

EditIntent 파일명:

- 원본 stage 파일명이 있으면 `<basename>_edit.json`.
- 예: `06_Validation.json` -> `06_Validation_edit.json`.
- source file name이 없으면 `edit-intent_<phase>_<YYYYMMDD_HHmmss>.json`.

저장 위치 우선순위:

1. `host.writeFile(folderRef, fileName, json)`으로 원본 stage 폴더에 직접 저장.
2. Web의 `showSaveFilePicker`.
3. 브라우저 download fallback.

빌더/백엔드 책임:

- `_edit.json` 발견.
- schemaVersion/stageRef 검증.
- intent validation 재검증.
- intents 배열 순서대로 적용.
- 성공 시 `edited/` 하위에 새 BDF, 새 stage JSON, apply trace 출력.
- 실패 시 부분 적용 결과를 남기지 않는다.

Studio 책임:

- 사용자가 무엇을 바꿀지 명확히 선택하게 한다.
- 적용 전 preview와 영향 요약을 제공한다.
- intent JSON을 사람이 읽고 리뷰 가능한 형태로 저장한다.
- 원본 StageData를 오염시키지 않는다.

## 15. 상태 관리 표준

Studio는 최소 3개의 상태 영역으로 나눈다.

### Stage Store

역할:

- `stages`
- `inputAudit`
- `loadSummary`
- `sourceFolderRef`
- `loadStages(files)`
- `reset()`

원칙:

- 파일 로딩과 StageData 정규화는 store/action에서 처리한다.
- 컴포넌트는 stage 배열과 summary만 소비한다.

### Viewer Store

역할:

- viewport 목록/active viewport.
- stage index per viewport.
- color mode, layer visibility, filter state.
- camera linked, render mode, xray.
- picked entity, isolate selection, focus request.
- active top mode, inspector tab/collapsed, theme.

원칙:

- viewport별 상태와 전역 표시 상태를 구분한다.
- reset 시 theme은 유지하고, 모델 의존 상태는 초기화한다.

### Edit Store

역할:

- `enabled`
- `intents`
- `selectedIntentId`
- `pendingNodeSelection`
- `addIntent`, `connectRigid`, `removeIntent`, `clearIntents`
- `buildExportPayload`, `exportToFile`, `importFromJson`

원칙:

- StageData를 직접 수정하지 않는다.
- intent 추가 시 동기 검증을 수행한다.
- error는 추가 차단, warning은 추가 허용하되 사용자에게 노출한다.
- 편집 모드 OFF 시 pending selection만 비우고 intents는 유지한다.

## 16. 접근성/사용성

필수 규칙:

- 모든 icon-only 버튼은 `title` 또는 tooltip을 가진다.
- 행/버튼 텍스트는 긴 경우 ellipsis 또는 wrap으로 컨테이너를 넘지 않게 한다.
- 모든 상태는 색 + 텍스트로 표시한다.
- Delete/clear/save/finalize 같은 파괴적 또는 큰 전환 액션은 confirm을 둔다.
- 키보드 입력 중에는 global hotkey가 동작하지 않게 한다.
- `Esc`, `Delete`, `Ctrl/Cmd+Z` 같은 단축키는 편집 모드에서만 제한적으로 사용한다.
- 모달은 backdrop click과 Esc 닫기를 지원하되, 저장/적용 중에는 중복 실행을 막는다.

## 17. 신규 Studio 생성 체크리스트

새 Studio를 만들 때 이 순서로 설계한다.

1. Studio가 L1/L2/L3 중 무엇인지 결정한다. 멀티 뷰포트, 독립 store, 편집 intent, 별도 릴리즈가 있으면 L3를 검토한다.
2. 상단 모드 탭을 정의한다. 기본은 `Model`, `Model Check`, `Edit`, `Save`를 유지하고 도메인 특화 탭은 필요할 때만 추가한다.
3. 좌측 도크를 모드별 패널로 나눈다. 파일/뷰포트/레이어/검증/편집/저장을 한 패널에 섞지 않는다.
4. 중앙 viewport grid와 stage 선택 정책을 정한다.
5. 단일 선택과 편집 다중 선택을 분리한다.
6. 원본 데이터를 직접 변경하지 않는 intent 스키마를 먼저 정의한다.
7. intent validation rule과 preview rendering rule을 동시에 정의한다.
8. Save가 어떤 파일/호스트/백엔드 계약을 호출하는지 문서화한다.
9. Light/Dark semantic palette를 먼저 만들고 컴포넌트에서 직접 색상 난립을 피한다.
10. 하단 review dock과 inspector는 데이터가 있을 때만 열리게 한다.
11. 브라우저 단독 실행과 Electron 임베드를 모두 고려해 HostAdapter를 둔다.
12. 테스트는 data transform, intent validation, store action, scene builder의 핵심 분기를 우선 커버한다.

## 18. Studio별 확장 기록 방식

이 문서는 ModelBuilderStudio에서 출발했지만, 특정 Studio 하나의 기능 목록으로 고정하지 않는다. 다른 Studio가 생기면 아래 방식으로 내용을 추가한다.

문서 구조 원칙:

- `1~17장`은 모든 Studio가 공유해야 할 공통 표준으로 유지한다.
- 새 Studio 고유 기능은 이 장 또는 별도 하위 절에 추가한다.
- 공통 표준을 바꿀 때는 기존 ModelBuilderStudio 동작과 충돌하지 않는지 확인한다.
- 특정 Studio에만 해당하는 기능은 반드시 `적용 대상`을 적는다.
- 기능이 성숙해 여러 Studio에서 반복되면 공통 표준 장으로 승격한다.

Studio별 확장 템플릿:

```md
### [Studio 이름] 확장

적용 대상:

- `HoistStudio`
- `ResultReviewStudio`

추가 모드/메뉴:

- `Load Case`: 하중 케이스 선택, 조합, 필터.
- `Result`: 응력/변위/반력 결과 표시.

추가 선택 대상:

- Load Case
- Constraint
- Stress Hotspot
- Weld Line

추가 편집/명령:

- `assignLoadCase`
- `editConstraint`
- `markReviewIssue`

추가 저장 계약:

- 저장 파일명, backend endpoint, trace 형식.

공통 표준과 다른 점:

- 예외가 필요한 이유와 되돌릴 조건.
```

확장 가능한 기능 범주:

| 범주 | 예시 | 문서화해야 할 것 |
|---|---|---|
| 결과 후처리 | stress contour, displacement scale, mode shape animation | 결과 데이터 구조, legend, unit, color map, 선택 UX |
| 하중/경계조건 편집 | load case, SPC/MPC, support condition | 원본 보존 방식, intent schema, validation rule |
| 검토/승인 | issue marker, reviewer note, pass/fail gate | traceability, status badge, export/report 계약 |
| 파라메트릭 입력 | section size, material, load magnitude | 입력 validation, unit, preview, solver 호출 조건 |
| 시뮬레이션 실행 | run solver, queue status, cancel/retry | job lifecycle, progress, failure state, result handoff |
| 비교/버전 | before/after model, result diff | diff 기준, 색상, tolerance, review summary |
| 자동화/AI 보조 | 모델 오류 제안, 수정안 생성 | 제안/실행 분리, 사용자 승인, audit log |

새 기능 추가 판단:

- 기능이 모델 데이터의 구조나 결과 의미를 바꾸면 intent 또는 command schema를 먼저 정의한다.
- 단순 표시 옵션이면 Viewer Store/layer/filter로 둔다.
- 선택 대상이 늘어나면 tooltip, inspector row, focus/isolate, highlight 색상까지 같이 정의한다.
- 저장/실행이 외부 프로세스를 호출하면 HostAdapter 또는 backend contract를 명시한다.
- 공통 UX를 깨는 예외는 "왜 이 Studio에서만 필요한지"를 문서에 남긴다.

## 19. 구현 파일 패턴

권장 구조:

```text
src/
  App.jsx
  main.jsx
  host/
    host.js
    host.test.js
  store/
    useStageStore.js
    useViewerStore.js
    useEditStore.js
  data/
    StageData.js
    fileLoader.js
    EditIntent.js
    applyEditIntents.js
    stageDiff.js
    InputAuditData.js
  components/
    TopMenuBar.jsx
    LeftDock.jsx
    ViewportContainer.jsx
    ThreeViewport.jsx
    Sidebar.jsx
    PickTooltip.jsx
    EditPanel.jsx
    AddRigidDialog.jsx
    BottomReviewDock.jsx
    InspectorPanel.jsx
    panels/
      ModelPanel.jsx
      ModelCheckPanel.jsx
      EditPanelDock.jsx
      SavePanel.jsx
  three/
    SceneBuilder.js
    SelectionHighlight.js
    applyDeleteMask.js
    AddRigidPreview.js
    BrokenRbeHighlight.js
```

새 Studio가 2개 이상 생기면 공통 후보:

- `HostAdapter`
- `MultiViewportLayout`
- `ThreeViewport` shell
- `TopMenuBar`/mode tabs
- `LeftDock` panel shell
- `InspectorDock`
- `BottomReviewDock`
- `EditIntent` base utilities
- semantic `palette()`

단, 첫 Studio 하나만 있을 때 성급히 공통 패키지로 분리하지 않는다. 두 번째 실제 Studio가 생길 때 중복된 부분만 `packages/studio-core/`로 추출한다.

## 20. 최종 판단 기준

좋은 Studio는 다음 질문에 모두 "예"라고 답할 수 있어야 한다.

- 첫 화면에서 사용자가 파일/모델을 어떻게 열고 무엇을 해야 하는지 즉시 알 수 있는가?
- 중앙 작업면이 충분히 크고, 도크가 작업을 방해하지 않는가?
- 모델 선택, 검증, 편집, 저장이 서로 다른 모드로 명확히 분리되어 있는가?
- 편집 결과가 원본 데이터가 아니라 intent로 추적되는가?
- preview와 최종 적용 책임이 분리되어 있는가?
- warning/error/삭제/추가 예정 상태가 색과 텍스트로 모두 표현되는가?
- WorkBench 임베드와 브라우저 단독 실행을 같은 코드로 처리할 수 있는가?
- 이 문서만 보고 다른 에이전트가 같은 구조의 Studio를 만들 수 있는가?
