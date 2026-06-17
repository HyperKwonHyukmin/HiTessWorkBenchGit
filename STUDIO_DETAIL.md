# HiTESS Studio Standard

이 문서는 `C:\Coding\WorkBenchSubModule\ModelBuilderStudio`의 디자인 컨셉, 메뉴 구조, 부재 선택, **카메라 조작·3D 렌더링**, Edit 흐름, 저장/호스트 통합 방식을 WorkBench의 Studio 계열 기능 표준으로 정리한 것이다. 새 Studio를 만들거나 유사 Studio UI를 통일할 때 이 파일을 우선 참조한다.

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

### 카메라 조작 표준 (공통)

> 적용 대상: 모든 3D Studio viewport. 레퍼런스 구현 = ModelBuilderStudio `src/components/ThreeViewport.jsx` (v0.0.38, 2026-06-17 기준).

3D 작업면 카메라는 **"자유롭고 직관적"** 을 최우선으로 한다. CAD/뷰어 사용자가 기대하는 줌·팬·회전·피벗을 모두 제공하되, **줌이 중간에 막히거나 클리핑으로 잘리는 느낌이 없어야 한다.**

**조작 라이브러리**: `TrackballControls`(three/addons). OrbitControls와 달리 up-vector 고정이 없어 모델을 어느 축으로도 굴릴 수 있다(엔지니어링 모델 자유 관찰에 유리). 마운트 시 `camera.lookAt(target)`을 명시 호출해 내부 `_eye`를 초기화한다.

**버튼/감도 표준**:

| 입력 | 동작 | 기본값 |
|---|---|---|
| 좌클릭 드래그 | 회전(rotate) | `rotateSpeed = 1.5` |
| 우클릭 드래그 | 평행이동(pan) | `panSpeed = 0.72` |
| 가운데 버튼 드래그 / 핀치 | 줌(dolly) | `zoomSpeed = 1.2` |
| 휠 | 커서 방향 줌(zoom-to-cursor) | 아래 별도 핸들러 |
| 더블클릭 | 회전 원점(피벗) 지정 | — |
| `F` | 마지막 맞춤뷰(fitCamera)로 복귀 | — |

- 마우스 버튼 매핑은 `LEFT=ROTATE / MIDDLE=DOLLY / RIGHT=PAN`. 가운데 버튼을 줌으로 둬 우클릭 팬의 오작동을 줄인다.
- `staticMoving=false`, `dynamicDampingFactor=0.2`로 약한 관성(inertia)을 유지해 조작감을 부드럽게 한다.

**휠 = 커서 방향 줌(zoom-to-cursor)** — 표준이며 직관성의 핵심:

- TrackballControls 기본 휠 줌은 항상 화면 중앙(target)으로만 당겨져 "보는 곳"이 어긋난다. 그래서 컨테이너의 **capture 단계**에서 휠을 가로채(`{ capture: true }` + `stopPropagation()`) 캔버스의 기본 휠 줌으로 전파되지 않게 하고, 커서가 가리키는 지점을 향해 dolly 한다.
- 거리에 무관하게 일정 비율로 줌: `deltaMode` 정규화 후 지수 스케일(`scale = exp(deltaY * unit)`). 카메라와 target을 동시에 커서 초점평면(시선 수직, target 통과) 위 점 `p`로 `(1-scale)`만큼 이동 → `|eye|`가 정확히 새 거리, 줌 방향이 커서로 향한다.
- 오버레이(겹침 노드 팝업 등) 위의 휠은 `e.target !== canvas` 가드로 그대로 통과시켜 내부 스크롤을 보존한다(줌은 캔버스 위에서만).

**더블클릭 = 회전 원점(피벗) 지정** — 좌우로 긴 모델 대응 표준:

- 더블클릭한 부재/노드의 교점을 `controls.target`(회전 중심)으로 삼고 그 점을 화면 중앙으로 가져온다.
- 카메라와 target을 **같은 델타로 평행이동** → 시선(eye) 불변 → **회전 스냅·줌 변화 없이 피벗만** 이동.
- 빈 곳 더블클릭은 무시(피벗 변경 없음). 숨겨진(visible=false) 부모/자식은 피킹 대상에서 제외. `F`로 전체 맞춤뷰(피벗=모델 중심) 복귀.

**줌이 막히지 않게 — 적응형 near/far + 넉넉한 거리 한계**:

- 줌 한계는 **모델 크기 기준**으로 `fitCamera()`가 설정: `minDistance = max(size*0.0008, 0.01)`, `maxDistance = size*400`. (고정 한계로 "어느 순간 더 안 들어가는" 느낌을 제거 — 단일 노드 코앞까지 확대, 전체가 점이 될 때까지 축소.)
- near/far는 **매 프레임 카메라-타깃 거리에 비례**해 재계산(`updateClipPlanes`): `near = max(camDist*0.02, 0.001)`, `far = max(camDist*4, sceneRadius*8, near*2000)`. 고정 near/far면 깊게 확대 시 지오메트리가 near 평면에 잘려 "더 못 들어가는" 착시가 생기므로 **반드시 거리 적응형**으로 둔다.
- `fitCamera()`는 모델 특성 스케일(scene m)을 반환해 `sceneRadius`로 보관(near/far 하한 계산에 사용).

**카메라 링크(다중 뷰포트)**: 동기화 시 position/quaternion/up/target을 복사하고 `updateClip()`도 함께 호출해 링크된 뷰포트의 near/far가 깊은 줌에서 어긋나지 않게 한다(`hooks/useCameraSync.js`). 피벗(target)도 같이 동기화된다.

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

### 3D 엔티티 렌더링 표준 — Node sphere

> 적용 대상: 모든 Studio의 노드 표현. 레퍼런스 = `src/three/NodePoints.js`. MooringFittingStudio `src/three/NodeMesh.js`와 **동일 방식**(두 Studio 통일 기준).

노드는 **매끈한 반투명 빨간 구(sphere)** 로 그린다. 과거의 저폴리(10×7)+`flatShading:true` "칼로 깎은 듯 각진" 표현은 금지한다(전문성·가독성 저하).

**표준 형상/재질** (InstancedMesh, 노드당 1 인스턴스):

- 지오메트리: `SphereGeometry(NODE_RADIUS, 16, 12)` — 부드러운 구. (저폴리·flatShading 금지.)
- 재질: `MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.65, depthWrite: false })`.
  - `opacity 0.65` = 반투명: 부재(Line/Tube)가 노드를 통과해 비쳐 **"연결 여부" 판단이 쉽고** 시각적으로 더 전문적이다.
  - `depthWrite: false`로 겹친 노드/부재가 자연스럽게 비치게 한다.
- **per-instance 색상**: 베이스 재질 색을 흰색(`0xffffff`)으로 두면 `setColorAt`의 인스턴스 색이 그대로 곱해져 보존된다. 따라서 한 메시로 검증 진단색을 표현 가능:
  - Shared(2+ 연결) = 빨강(`#FF4455`, 도메인 Node 색) · Free(1 연결) = 노랑(`#FFDD00`) · Orphan(0 연결) = 보라(`#CC44FF`).
- picking은 구 raycast라 반투명/`depthWrite`와 무관하게 동작한다.

> 신규 Studio도 이 노드 재질 프리셋(매끈 구 + opacity 0.65 + depthWrite:false + 흰색 베이스×per-instance 색)을 그대로 따라 통일성을 유지한다.

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

---

# 부록 — Model Builder 구현 수치 레퍼런스 (벤치마킹 기준)

> **Model Builder Studio 가 모든 Studio 의 표준**이다. 아래 부록은 1~20장의 개념 표준을 **실제 구현의 정확한 상수·색·치수·기본값**으로 고정해, 신규/유사 Studio 가 그대로 복제·벤치마킹할 수 있게 한다.
> 모든 값은 `WorkBenchSubModule/ModelBuilderStudio/apps/model-studio/src/` 코드(`파일:라인`) 기준 실측이다. (검증: 2026-06-17, model-studio v0.0.38.)
> 카메라 조작 표준은 §5(카메라 조작 표준), 노드 구 재질은 §11(3D 엔티티 렌더링 표준)에 개념 설명이 있고, 여기서는 **수치 레퍼런스**를 보강한다.

## 부록 A. 좌표·뷰·렌더 루프 표준 (`components/ThreeViewport.jsx`)

### A.1 좌표·축 규약 (모든 Studio 동일 적용)

- **좌표계**: Z-up 오른손 좌표계. **X = 종방향(longitudinal), Y = 횡방향(lateral), Z = 수직(vertical).**
- **단위 변환**: 모델 데이터는 mm(CAD), 씬은 m. `getNodePos = (coord - center)/1000` (`StageData.js`). `center = bbox 중점` 으로 **센터링 후 mm→m**. → 씬 원점(0,0,0)이 모델 중심.
- **카메라(Perspective)**: FOV **45°**, 초기 위치 `(20,15,30)`, near/far 초기 `0.01 / 10000`(이후 매 프레임 적응형). `fitCamera` 가 모델 bbox 로 재프레이밍:
  - `size = max(dx,dy,dz,1)`(m), `dist = (size/2)/tan(fov/2) * 1.5`.
  - 카메라 위치 `(dist*0.9, dist*-0.7, dist*0.6)`(정면-우-상), up `(0,0,1)`, target `(0,0,0)`.
  - 줌 한계 `minDistance = max(size*0.0008, 0.01)`, `maxDistance = size*400`.
- **적응형 near/far**(`updateClipPlanes`, 매 프레임): `near = max(camDist*0.02, 0.001)`, `far = max(camDist*4, sceneRadius*8, near*2000)`. (깊은 줌에서 클리핑/줌 막힘 방지 — §5 참조.)

### A.2 뷰 단축키 (컨테이너 `:hover` 일 때만 동작)

| 키 | 뷰 | 카메라 위치 | up | 비고 |
|---|---|---|---|---|
| `F` | 맞춤뷰 복귀 | `fitStateRef`(마지막 fitCamera) | 저장값 | 피벗=모델 중심 복귀 |
| `A` | 평면(Top) | `(0, 0, dist)` | `(1,0,0)` | +Z 에서 내려봄 |
| `S` | 종단면(Front) | `(0, -dist, 0)` | `(0,0,1)` | +Y 에서 봄 |
| `D` | 횡단면(Side) | `(dist, 0, 0)` | `(0,0,1)` | +X 에서 봄 |

- `dist = fitPos.length()` 없으면 기본 `30`(m). 입력창 포커스 중에는 전역 단축키 미동작(§16).

### A.3 렌더 모드 / X-ray

- **`renderMode`**: `'cylinder'`(기본, 부재=실린더 InstancedMesh) ↔ `'section3d'`(부재=실제 단면 압출). 토글 시 씬 재빌드(useEffect deps 에 포함).
  - section3d pickables 는 `{ beams, nodes, masses, rigidLines }`, cylinder 는 `{ structure, pipe, nodes, masses, rigidLines }`.
- **`xray`**(`applyXray`): 구조/배관 재질만 `transparent=true, opacity=0.2, depthWrite=false`. 노드·RBE·질량은 제외. 대구경 배관 내부 노드 확인용.

### A.4 방위 기즈모(Axes gizmo)

- 별도 `axesScene`(`AxesHelper(0.7)` + X/Y/Z 라벨 스프라이트), `axesCam` FOV **50°**, near/far `0.1/10`.
- 매 프레임 메인 카메라 quaternion 복사 + 원점에서 `2.5` 거리에 배치(회전만 따라감).
- 우상단 scissor 렌더: 크기 `AXES_PX=108`px, 여백 `AXES_MARGIN=10`px, 배경 light `0xe7edf5` / dark `0x0d0d1a`.
- 라벨: X `#FF4444`(0.88,0,0) · Y `#44CC44`(0,0.88,0) · Z `#4488FF`(0,0,0.88).

### A.5 렌더 루프·성능 표준 (★ 모든 Studio 권장)

- **On-demand 렌더 + 관성 꼬리**: 평상시엔 변화 있을 때만 `requestRender()`(단일 RAF, `renderScheduled` 중복 방지). 드래그 중/직후엔 `animate()` 루프가 `controls.update()`+`updateClipPlanes`+render 를 돌린다.
- **상수**: `DRAG_THRESHOLD=3`px(클릭/드래그 구분), `DAMPING_TAIL=800`ms(관성 감쇠 지속), 픽셀비 `min(devicePixelRatio, 2)` cap(멀티 뷰포트 성능).
- **렌더러**: `antialias:true`, `NoToneMapping`, `SRGBColorSpace`, `autoClear:false`(축 인셋용 수동 scissor). `ResizeObserver` 로 size/aspect/pixelRatio + `controls.handleResize()` 갱신.
- **stale 클로저 방지**: `doRenderRef`/`editStateRef` 등 ref 로 최신 상태 참조(테마 토글 stale 방지).

### A.6 레이캐스팅/피킹 표준

- Line(=RBE 선) 피킹 임계값을 거리 비례로: `Line.threshold = max(0.05, camDist*0.01)`(초기 `0.3`). 줌 무관 ~6px 체감 픽 영역.
- `pointerup` 에서 이동량 `> DRAG_THRESHOLD`(3px)면 드래그로 보고 픽 무시. 더블클릭=피벗 지정(§5).

## 부록 B. 3D 엔티티 렌더 사양 (도메인 마커 치수·색·재질)

### B.1 도메인 색상 팔레트 (`utils/colors.js`) — §11 도메인 색의 정확값

| 키 | hex | 용도 |
|---|---|---|
| `structure` | `#5BA8E5` | 구조 부재(파랑) |
| `pipe` | `#FFAA22` | 배관(주황) |
| `node` | `#FF4455` | 노드/Shared(빨강) |
| `rigid` | `#FF44FF` | RBE 일반(마젠타) |
| `uboltRigid` | `#00E5FF` | U-bolt RBE·선택 하이라이트(시안) |
| `mass` | `#FF99BB` | 점질량(연분홍) |
| `boundary` | `#22DD66` | 경계조건/SPC(초록) |
| `weld` | `#FF6677` | 용접 태그(분홍-빨강) |

### B.2 엔티티 지오메트리·재질 표 (씬 단위 = m, 괄호 = mm)

| 엔티티 | 지오메트리 | 크기 | 재질 | 색 | 비고 |
|---|---|---|---|---|---|
| 구조 부재 | Cylinder(12 seg) | r `0.025`(25) | MeshStandard metal `0.15` rough `0.55` flat `true` | `#5BA8E5` | InstancedMesh, 단위높이 후 인스턴스 스케일 |
| 배관 부재 | Cylinder(12 seg) | r `0.020`(20) | 동일 | `#FFAA22` | 별도 mesh(레이어 토글) |
| 노드 | Sphere `16×12` | r `0.0448`(44.8) | MeshStandard white rough `0.35` metal `0.05` **opacity `0.65` depthWrite `false`** | per-instance | Shared `#FF4455`/Free `#FFDD00`/Orphan `#CC44FF` (§11) |
| 점질량(CONM2) | Box | 변 `0.09`(90) | MeshStandard metal `0.2` rough `0.55` | `#FF99BB` | InstancedMesh |
| RBE 선 | LineSegments | 선 | LineBasic | 일반 `#FF44FF` / U-bolt `#00E5FF` | independent↔dependent 쌍별 1선, 2 mesh 분리 |
| 경계조건 | Octahedron(다이아) | r `0.14`(140) | MeshStandard | `#22DD66` | |
| U-bolt 마커 | Sphere | r `0.12`(120) | MeshBasic opacity `0.96` depthTest `false` | `#00E5FF` | renderOrder `850`, 항상 보임 |
| U-bolt DOF 라벨 | Sprite | scale `0.09`(90) | canvas, font `bold 56px monospace`, bg `rgba(10,10,24,.78)` | text `#FFE066` | cm 코드별 텍스처 캐시 |
| 용접 마커 | Octahedron | r `0.04`(40) | MeshBasic | `#FF6677` | |
| **무게중심(COG)** | Sphere `24×16` | r `clamp(bbox*0.015, 0.15, 1.2)` | gold opacity `0.85` | `#FFD700` | + halo(×1.7, opacity `0.18`) + 십자선. renderOrder 999/998/1000 |

### B.3 단면3D(`section3d`) 프로파일 압출

- Bar `Box(w,1,h)` · Rod `Cylinder(r,r,1,20)` · Tube `ExtrudeGeometry`(내/외경 path, 20 seg) · L/H `ExtrudeGeometry`(2D Shape). 치수는 dims(mm)/1000.

### B.4 선택·편집 미리보기 렌더 (overlay)

| 용도 | 지오메트리 | 색 | 재질/속성 |
|---|---|---|---|
| 선택 하이라이트(연결 강조) | elem Cylinder r `0.042` / node Sphere r `0.090` | `#00E5FF` | MeshBasic opacity `0.80` depthTest `false`(X-ray식 위에 렌더) |
| 편집 다중선택 노드 | Sphere r `0.055` | `#FFB800`(amber) | + `N{id}` 라벨 |
| RBE 연결점(편집) | Sphere r `0.070` | `#FF44FF`(마젠타) | opacity `0.55` |
| addRigid 미리보기 | LineSegments | `#FFD740` | LineDashed dash `0.18`/gap `0.10` opacity `0.95` depthTest/Write `false` renderOrder `998` |
| 끊기는 RBE 경고 | LineSegments | `#FFB800` | LineBasic linewidth `2` opacity `0.95` depthTest `false` renderOrder `998` |
| 삭제 미리보기(`applyDeleteMask`) | — | — | **opacity 아님 — 인스턴스를 `scale 0.0001`** 로 축소(원본 matrix 복원, 멱등) |
| 겹침 노드 아웃라인 | 직교 3링(40 seg) | 멤버별(Pipe `#FFAA22`/Struct `#5BA8E5`/혼합 white/없음 `#FF4455`) | r `NODE_RADIUS*1.45≈0.065` LineBasic opacity `0.95` depthTest `false` renderOrder `19` |

### B.5 조명 표준 (`ThreeViewport.jsx`) — "엔지니어링 리뷰용 균형 조명"

| 광원 | 색 | 세기 | 위치 |
|---|---|---|---|
| Hemisphere | sky `0xd8eaff` / ground `0x3d3d48` | `1.25` | — |
| Ambient | `0xffffff` | `0.28` | — |
| Directional(Key) | `0xffffff` | `0.55` | `(4,-5,7)` |
| Directional(Rim) | `0x9fc8ff` | `0.35` | `(-5,4,5)` |
| Directional(Headlight) | `0xffffff` | `1.0` | 카메라에 부착 `(0.5,1,0.5)` |

### B.6 renderOrder / depth 규약

`기본 0` < coincident 아웃라인 `19` < 노드ID 라벨 `20` < U-bolt 마커 `850` < RBE/addRigid/brokenRbe `998` < COG sphere `999` < COG 십자선 `1000`. `depthTest:false` 마커는 순서와 무관하게 항상 위.

### B.7 Group 팔레트 (`utils/groupPalette.js`)

11색 고정 고대비: `#FFD23F #00C2FF #FF4DB8 #53E36D #FF8A3D #8B5CF6 #00D1B2 #F25F5C #B8F35A #4D96FF #C9CED6`. 그룹 0~9 개별색, 10+ 는 `기타`(마지막 light-neutral).

### B.8 리소스 해제

`disposeScene(root)` 가 **WeakSet 중복제거**로 geometry/material/texture(라벨 canvas 포함)를 1회씩 dispose. 반복 지오메트리는 전부 InstancedMesh, 원본 matrix 는 `userData.originalMatrices`(그룹 토글/삭제 복원용).

## 부록 C. 상태·테마·호스트·테스트·패키징 표준

### C.1 3-스토어 패턴 (Zustand) + 기본값

**ViewerStore**(`store/useViewerStore.js`) — 표시/뷰포트 상태:

| 키 | 기본값 | 키 | 기본값 |
|---|---|---|---|
| `activeViewportId` | `1` | `theme` | `'dark'` |
| `activeMode` | `'model'` | `cameraLinked` | `false` |
| `inspectorTab` | `'메타'` | `renderMode` | `'cylinder'` |
| `inspectorCollapsed` | `false` | `xray` | `false` |
| `isolateSelection` | `false` | `highlightCoincident` | `false` |
| `pickedEntity` | `null` | `focusSelectionRequest` | `0`(카운터) |

- **`DEFAULT_LAYERS`**: `structure/pipe/nodes/rigids = true`; `masses/boundaries/uboltMarkers/uboltDof/cog = false`. (기본 ON = 모델 형상, 기본 OFF = 보조 마커.)
- `viewports[]` 기본 1개: `{ id, stageIndex, colorMode:'category', freeNodeFilters:{normal,free,orphan:true}, groupFilters:{} }` (최대 4).
- 액션: `addViewport/removeViewport/setViewportStage`, `setViewportColorMode/toggleViewportFreeNodeFilter/toggleViewportGroupFilter`, `toggleTheme/toggleLayer/toggleCameraLink/toggleXray/toggleHighlightCoincident`, `setPickedEntity/toggleIsolateSelection/focusPickedEntity/setRenderMode`, `reset()`(theme 유지).

**StageStore**(`useStageStore.js`): `stages[] / inputAudit / stageSummary / loading / error / loadSummary{total,json,loaded,failed,skipped,failedFiles[]} / sourceFolderRef`. 액션 `setSourceFolderRef / loadStages(files) / reset`.

**EditStore**(`useEditStore.js`): `enabled / intents[] / selectedIntentId / hasShownEntryToast / pendingNodeSelection[] / groupPreview / groupPreviewVersion`. 액션 `toggleEnabled / toggleNodeSelection / addIntent → {ok,intent,validation} / connectRigid → {ok,absorbedCount,...} / removeIntent / clearIntents / refreshGroupPreview / buildExportPayload / exportToFile → {ok,fileName,location} / importFromJson / reset`.

### C.2 시맨틱 테마 토큰 전량 (`utils/theme.js` `palette(theme)`) — §11 표의 상위집합

| 토큰 | Light | Dark | 토큰 | Light | Dark |
|---|---|---|---|---|---|
| `panelBg` | `#f8fafc` | `#0b0b1e` | `textFaint` | `#94a3b8` | `#4a5470` |
| `panelBg2` | `#ffffff` | `#0f0f22` | `labelColor` | `#2563eb` | `#7ab2d4` |
| `panelBg3` | `#eef2f7` | `#101024` | `labelColorAlt` | `#059669` | `#6ee7b7` |
| `overlayBg` | `rgba(240,245,250,.94)` | `rgba(8,6,22,.92)` | `accent` | `#059669` | `#059669` |
| `border` | `#e2e8f0` | `#1e1e38` | `accentLight` | `#6ee7b7` | `#6ee7b7` |
| `borderStrong` | `#cbd5e1` | `#2a2a4a` | `dangerText` | `#dc2626` | `#e07070` |
| `borderSubtle` | `#f0f4f8` | `#181830` | `warnText` | `#d97706` | `#FFAA55` |
| `textPrimary` | `#0f172a` | `#e6f1ff` | `inputBg` | `#ffffff` | `#1a1a3a` |
| `textSecondary` | `#334155` | `#b0c4d8` | `tabIndicator` | `#2563eb` | `#4682B4` |
| `textMuted` | `#64748b` | `#7a8aaa` | `vpBg`(3D 배경) | `#dde4ef`/`0xf3f6fa` | `#0d0d1a`/`0x1a1a2e` |

(그 외 `btnBg/btnBgHover/btnBorder/btnText`, `cardBg/cardBgHover/cardBorder`, `tabBg/tabBgActive/tabTextActive/tabTextInactive`, `accentBg/accentBgSoft/accentBorder`, `dangerBg/dangerBorder`, `inputText/inputBorder`, `vpHeaderBg` 등 총 30+ 토큰. **색은 컴포넌트에 흩지 말고 `palette()` 한 곳에서.**)

### C.3 HostAdapter (`host/host.js`)

- **환경 감지**: `window.workbenchAPI` 존재 → `ElectronHost`, 없으면 `WebHost`. `detectHost()`(1회) → `getHost()`(lazy 싱글턴), `setHost()`(테스트 override).
- **인터페이스**: `pickFolder() / getInitialFolder() / writeFile(folderRef,name,content) / finalizeEditedModel(folderRef,req)`.
- **`folderRef` 는 opaque**: Web=`FileSystemDirectoryHandle`, Electron=절대경로 문자열. 컴포넌트는 저장만 하고 host 에 되돌려줌.
- **Web**: `showDirectoryPicker({mode:'readwrite'})` 재귀 `.json` 수집, `getInitialFolder()→null`(자동주입 없음), 쓰기=FS Access. `finalizeEditedModel`=미지원.
- **Electron**: `window.workbenchAPI.*` 래핑, finalize 는 `finalizeEditedModel | finalModelOutput | requestFinalModelOutput` 순 폴백.

### C.4 파일 분류 (`data/fileLoader.js`)

| 종류 | 판정 | 처리 |
|---|---|---|
| phase JSON | `Array.isArray(nodes) && Array.isArray(elements)` | → `StageData`, 파일명 선두 정수로 정렬 |
| InputAudit | `Array.isArray(rowAudit) && summary!=null` | → `InputAuditData`(폴더당 1) |
| StageSummary | `Array.isArray(stages) && summary.massProperties!=null` | → `StageSummaryData`(폴더당 1) |
| 기타 | nodes/elements 없음 | skip |

- 정렬: 선두 정수(`parseStageIndex`), 없으면 `Infinity`(끝). UTF-8 BOM(`charCodeAt(0)===0xFEFF`) 제거 후 `JSON.parse`.
- `applyFinalGroupMapping`: 전 stage 색/그룹번호를 **최종 stage 기준 통일**(`stage.finalGroups`/`finalElementGroupMap`) — 멀티 뷰포트 색 일관성.

### C.5 오버레이 컴포넌트 (위치/트리거)

| 컴포넌트 | 트리거 | 내용/위치 |
|---|---|---|
| `PickTooltip` | 픽 직후 | 1줄 라벨(§6 포맷). 마우스 `(clientX+12, clientY-10)`, z 9999, pointer-events none |
| `MassSummaryOverlay` | `stageSummary` 존재 + `layers.cog` | 총질량/BEAM/MASS, 우하단 `(right14,bottom14)`, gold 보더, z 25 |
| `EditModeWatermark` | `editStore.enabled` | "EDIT MODE"(대상=gold/비대상=gray) + 인셋 보더 + 5s 진입 토스트, z 49~51 |
| `CoincidentNodePicker` | 편집 모드 겹친 노드 클릭 | 겹친 노드 ID 목록 팝업(멤버색 dot + 체크박스), `(x+12,y+8)` 클램프, max 248×320, z 50, Esc 닫기 |

### C.6 테스트 표준 (Vitest)

- **13개 파일, 156 케이스 전체 통과**(`npm run test` = `vitest run`). 핵심 분기 우선 커버: data transform·intent validation·store action·scene builder·host IO.
- 파일: `data/{EditIntent, applyEditIntents, StageData, coincidentNodes, InputAuditData, stageDiff, fileLoader}.test.js`, `store/{useEditStore, useViewerStore}.test.js`, `host/host.test.js`, `three/{EntityBuilders, SceneBuilder, BeamMesh}.test.js`.

### C.7 패키징·버전·빌드 설정

- **`scripts/package-viewer.mjs`**: `package.json` version → `vite build`(manifestPlugin)이 `manifest.json` 으로 주입 → `release/<id>-<version>.zip`(zlib 9, **dist 래퍼 없이 루트 평탄**) + `<...>.zip.sha256`(`"<hash>  <file>"` POSIX 포맷). **버전은 `package.json` 한 곳만 bump.**
- **manifest 필드**: `id`(`model-studio`) · `name` · `version`(자동 주입) · `entry`(`index.html`) · `linkedMenu`(`HiTess Model Builder`) · `minWorkbenchVersion` · `description` · `hostApi`. (백엔드 `viewers.py` 서빙·DRM `read()` 함정은 `STUDIO_PIPELINE_STANDARD.md §2 S3` 참조.)
- **vite.config.js**: `base:'./'`(file://+http:// 호환), alias `@→src`, dev `port 5174 strictPort`, `build.target es2022`, `sourcemap false`, `chunkSizeWarningLimit 1500`, plugins `react()/tailwindcss()/workbenchManifestPlugin()`.
- **eslint.config.js**: ignore `dist`, `js.recommended` + `reactHooks.flat.recommended` + `reactRefresh.vite`, globals `browser`, jsx on. (배포 전 lint 0 errors 유지.)

> **신규 Studio 벤치마킹 순서**: §17 체크리스트로 구조를 잡고 → 부록 A(좌표·카메라·렌더 루프) → 부록 B(엔티티 색·치수·재질·조명) → 부록 C(스토어 기본값·테마 토큰·host·패키징) → 부록 D(앱 셸·모드 전환·부트스트랩·스케일) → 부록 E(씬 가시성·컬러모드·파생 미리보기·diff·audit) 의 값을 **그대로 채택**해 시각·조작·구조·동작 통일성을 확보한다. 도메인이 달라 값이 바뀌면 §18 확장 템플릿으로 "왜 다른지"를 기록한다.

## 부록 D. 앱 셸·모드 전환·부트스트랩·스케일 (`App.jsx`, `TopMenuBar.jsx`, `LeftDock.jsx`)

### D.1 앱 셸 구성 (3단 레이아웃)

- **최외곽**: flex column, 뷰포트 채움, 테마 배경 light `#eef2f7` / dark `#0d0d1a`(텍스트 `#0f172a` / `#e0e0e0`).
- **스케일 레이어**: `width/height = 100/uiScale %`, `transform: scale(uiScale)`, `transformOrigin: 'top left'`(소형 창 대응, D.4).
- **본문**: `TopMenuBar`(높이 42px) → row{ `LeftDock`(300px, flex-shrink 0, 모드별 패널) + 뷰포트 컬럼(flex1){ `ViewportContainer`(1~4 grid) + `BottomReviewDock`(데이터 있을 때만) } }.

### D.2 마운트 부트스트랩 (Electron 자동 로드)

```
useEffect(once):
  getHost().getInitialFolder()              // Electron=폴더, Web=null
  → guard: cancelled | !initial | files.length===0 → no-op
  → setSourceFolderRef(folderRef)
  → loadStages(files)                       // loading=true → loadFiles → stages/inputAudit/stageSummary
  → resetViewportStages(stages.length - 1)  // ★ 모든 뷰포트를 최종(보통 Validation) stage 로
```

- 로딩 "로딩 중…" / 에러(빨강) 는 좌측 패널, 빈 상태는 뷰포트 중앙("🏗️ 파이프라인 JSON 파일을 선택하세요"). Web 단독은 `getInitialFolder()→null` 이라 수동 열기.

### D.3 모드 전환 (4 탭) + 부작용 (★ 통일 핵심)

탭 `model · modelCheck · edit · save`. 클릭 = `setActiveMode(key)`; **`edit` 진입 시 `useEditStore.setEnabled(true)`**. 앱 전역 effect: **`activeMode !== 'edit'` 면 `setEnabled(false)`(단, intents 는 보존, pendingNodeSelection 만 비움)**.

| 모드 | 좌측 패널 | colorMode | stageIndex | editStore | 비고 |
|---|---|---|---|---|---|
| `model` | `ModelPanel` | `'category'` | 유지 | 무변경 | 레이어/렌더/뷰포트 |
| `modelCheck` | `ModelCheckPanel` | `'freeNode'`(Node Check) / `'group'`(Group) | 유지 | 무변경 | 서브탭이 colorMode 구동 |
| `edit` | `EditPanelDock` | **`'group'` 강제** | **최종 stage 강제** | **enabled=true** | 진입 시 6.5s 안내 토스트(최초 1회) |
| `save` | `SavePanel` | 상속 | 상속 | 무변경 | export/finalize 만 |

- **Model Check 노드 타입 범례**(통일): normal `#FF4455`(여러 요소 연결 정상) · free `#FFDD00`(한쪽만, 자유단 후보) · orphan `#CC44FF`(요소 미연결 고립). 필터는 뷰포트별 `freeNodeFilters[key]` 토글.

### D.4 소형 창 UI 스케일 (통일 공식)

```js
const scale = Math.min(width / 960, height / 820, 1)
uiScale = Math.max(0.68, Number(scale.toFixed(3)))   // 기준 960×820, 하한 0.68
```

- 적용: 스케일 레이어 `width/height=100/uiScale%` + `scale(uiScale)`. 재계산 트리거: `resize` · `visualViewport.resize` · `screen.orientation.change`.

### D.5 테마 전파

- 스토어 `theme:'dark'`(기본) `toggleTheme`. 앱 배경은 테마로 직접, 컴포넌트 색은 **전부 `palette(theme)` 인라인**(CSS class 없음, 부록 C.2 토큰). reset 시 theme 만 유지.

### D.6 초기화 게이팅 · confirm · 토스트

- **`guardLoad()`**: `stages.length>0` 면 `alert("…초기화 버튼으로 먼저 비운 뒤 재시도")` 후 차단 — 파일/폴더 열기 진입점마다 적용(데이터 혼입 방지).
- **`handleReset` = 3-스토어 동시 초기화**: `resetStages()`+`resetViewer()`(★ `isolateSelection=false` 로 되돌려 새 모델 전체은폐 버그 방지, theme 보존)+`resetEdit()`.
- **confirm**: 파괴/큰 전환은 네이티브 `window.confirm`(예: finalize "Model을 저장하고 Studio를 종료하시겠습니까?").
- **토스트**: 전역 ToastContext 없음 — 컴포넌트별 인라인 `status:{color,text}`. 편집 진입 안내 토스트는 최초 1회 6500ms(`hasShownEntryToast`).

### D.7 Inspector 마운트/접힘

- `inspectorCollapsed:false`(기본). **`setInspectorTab('편집')` 은 한 mutation 으로 `collapsed:false` 동반**(편집 탭 클릭=자동 펼침). 접힘=20px 스트립. 탭 `메타/모델지표/연결성/진단/추적/편집`, 폭 MIN 200·MAX 600·DEFAULT 300. 앱 전역 키 핸들러 없음(단축키는 뷰포트 스코프, §A.2/§6).

## 부록 E. 씬 가시성·컬러모드·파생 미리보기·diff·audit 알고리즘

### E.1 컬러모드 5종 (`SceneBuilder`/`BeamMesh`/`NodePoints`)

| colorMode | 대상 | 규칙 |
|---|---|---|
| `category`(기본) | 부재 | 구조 `#5BA8E5` / 배관 `#FFAA22` 고정. 노드는 흰색(override 없음) |
| `freeNode` | 노드 | 연결수 기반: orphan(0) `#CC44FF` / free(1) `#FFDD00` / shared(2+) `#FF4455`. **RBE 멤버는 강제 normal** |
| `group` | 부재 | connectivity group 별 `GROUP_COLORS`. top `min(len,10)` 개별색, 10+ 는 `기타` `#C9CED6` |
| `propertyId` | 부재 | 단면 property 별 고유 hue: `setHSL(idx/max(total,1), 0.7, 0.55)` |
| `shapeType` | 부재 | 단면종류 고정: Bar `#61b861` · Rod `#e06060` · Tube `#d4a843` · H `#7b7be8` · L `#45b8c4` · 미상 `#888888` |

per-instance 색은 `setColorAt`, 형상 변화 없는 색만 갱신은 인스턴스 색 버퍼만 업데이트.

### E.2 레이어 가시성

- 그룹 `.visible = layerState[key] ?? true` (structure/pipe/nodes/rigids/masses/boundaries/uboltMarkers/uboltDof/cog).
- **노드는 카테고리-레이어 비트필드로 추가 제어**(`STRUCTURE_BIT=1`, `PIPE_BIT=2`): 요소 참조 없음(orphan/RBE-only)=항상 표시; 있으면 `(inStru && showStru) || (inPipe && showPipe)`. 숨김 = 인스턴스 `scale 0.0001`.

### E.3 그룹 필터(뷰포트별) · isolate

- `groupFilters[key]`(키 `0..9` + `'others'`), `visible = groupFilters[key] !== false`. 숨김은 **`originalMatrices` 에서 복원 후 `scale 0.0001`**(멱등). `setAllViewportGroupFilters`: `maxIndividual = len<=5 ? len : 10`, 나머지 `'others'`.
- **isolate**: `isolateSelection && selectedElementIds.size>0` → 비선택 구조/배관 인스턴스 `scale 0.0001`, `object.visible = hasSelected`. 적용 순서: groupFilters → isolate → deleteMask.
- **freeNode 필터**: `visible = filters[cat] && visibleByCat`(E.2 카테고리 규칙 결합).

### E.4 파생 편집 미리보기 (`data/applyEditIntents.js` `computeDeleteMask`)

- **출력 집합**: `deletedNodeIds / deletedElementIds / deletedMassIds / deletedGroupIds / brokenRbeIds / fullyRemovedRbeIds / addedRigids[]` + **파생 카운트** `derivedNode/Element/Rigid/PointMass/GroupCount`.
- **적용**: `deleteGroup` → 그룹의 nodeIds/elementIds 삭제 집합 추가(groupId=`builderId ?? id`). `deleteRigid` → 해당 RBE fully-removed(**deleteGroup 과 충돌 시 deleteRigid 우선**).
- **RBE 분류**: `ind && allDeps 삭제` → fullyRemoved; `ind && !allDeps` → broken; `!ind && 일부 dep 삭제` → broken.
- **파생 RBE 수** = `원본 - fullyRemoved.size + addedRigids.length`. `addedRigids[]` 는 미리보기 오버레이(노란 dashed)용으로 별도 노출.
- **편집 후 그룹 재계산**(`computeEditedGroups`): 유효 BEAM + 비제거 RBE + 신규 addRigid 연결에 **Union-Find**(RBE 는 `union(independentNode, dep)`), `StageData` 그룹 계산과 동일 fallback.

### E.5 단계 비교 (`data/stageDiff.js`)

- 13행: 노드/요소(전체·구조·배관)/RBE/질량/총길이(m=mm/1000, 1자리)/그룹/Orphan/자유단/단락요소/미연결그룹.
- 행 `{label, a, b, delta=b-a, deltaPercent}`, `deltaPercent = a!==0 ? delta/a*100 : (b!==0 ? 100 : 0)`.

### E.6 겹침 노드 탐지 (`data/coincidentNodes.js`)

- **거리 임계값** `tol = NODE_MARKER_RADIUS_MM(44.8) × 2.4 ≈ 107.52 mm`. 공간 해시(cell=`tol`) + **27-이웃 셀** 검색, `ex²+ey²+ez² ≤ tol²`. 출력 `Map<nodeId, number[]>`(이웃 ≥1 인 노드만).
- **멤버 분류**(`classifyNodesByMember`, 비트필드 1=Struct·2=Pipe): `3→mixed` `2→pipe` `1→structure` `0→none`(아웃라인 색은 B.4와 동일 — pipe 주황/struct 파랑/mixed 흰/none 빨강).

### E.7 입력 감사 (`data/InputAuditData.js`, `00_InputAudit.json`)

- 구조: `meta / inputFiles[] / summary{totalDataRows, convertedRows, ignoredRows, parseFailedRows, blankRows, …} / rowAudit[]{kind,file,name,status,reasonCode,mappingConfidence,rawLine,…}`.
- `_byName: Map<sourceName, rowAudit[]>` 인덱스 → `rowsByName(name)`. 좌표 파싱 `parsePosition`: 정규식 `/X\s*(-?[\d.]+)mm.*?Y\s*(-?[\d.]+)mm.*?Z\s*(-?[\d.]+)mm/i` → `{x,y,z}|null`(음수·소수·공백 허용).
- status `converted`(매칭)/`ignored`(제외, 좌표만 있으면 ghost 마커)/`blank`/`parseFailed`. 식별: `Array.isArray(rowAudit) && summary != null`.

### E.8 그룹·연결성 기준 (`data/StageData.js`)

- 그룹: **`connectivity.groups`(빌더 산출) 우선**, 없으면 클라이언트 **Union-Find**(BEAM+RBE 간선) 폴백. 요소 수 내림차순 정렬 후 0..N-1 재라벨. RBE 는 `union(ind, dep)` 로 한 그룹에 병합.
- 좌표 `getNodePos = (mm - bboxCenter)/1000`. **단락 요소 임계값 `< 1 mm`**. free/orphan 카운트는 **RBE 멤버 제외**(항상 shared).
