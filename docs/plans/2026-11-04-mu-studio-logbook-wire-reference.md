# MU Studio — LogBook 의 다른 Unit Wire 배치 참조 (B안)

작성 2026-11-04 · 상태: **구현됨·미커밋**(2026-11-04, 아래 '구현 상태') · 관련 저장소 4개(LogBook · WorkBench 백엔드 · WorkBench Electron · ModuleUnitStudio)

## 구현 상태 (2026-11-04)

- LogBook: `app/bdf/wires.py`(요약) · `app/lifting_refs.py` · `routers/integration.py` 2개 라우트 · `model_summaries.wires`(JSON, `ensure_columns`) · 변환 때 저장(`convert/job.py`).
  apex 판별은 구조만 본다(병진 123 구속 + CROD 에만 쓰임) — DeckReader 가 주석을 떼서 `$ PID=` 를 못 쓴다. 질량은 CONM2 단위 불확실로 뺐다.
  테스트 `test_lifting_wires_50.py`·`test_lifting_refs_50.py`, 전체 1,267 통과. 실제 3496 `_lifting.bdf` 요약이 `_lifting_meta.json` wire 4개와 일치.
- WorkBench 백엔드: `routers/logbook_link.py` `GET /api/logbook/lifting-refs[/{file_id}]`(옛 LogBook 404 → 501 `logbook_lifting_refs_unsupported`). `test_logbook_link.py` 통과.
- Electron: `viewer:searchLiftingRefs` · `viewer:getLiftingRef`(preload `searchLiftingReferences` · `getLiftingReference`) — **exe 재빌드 필요**.
- MU Studio 0.0.183(70 로컬 zip, 핀 동기화): Hoist 탭 STEP 2 아래 '다른 Unit 권상 참조'(`LiftingReferenceSection.jsx`, `data/liftingReference.js`+테스트).
  화면은 Chrome 헤드리스 + `workbenchAPI` 대역(실제 3496 요약)으로 확인. WorkBench 앱 안 실행·실제 LogBook 연결은 확인 안 함.
- 커밋(2026-11-04): LogBook `43f0540` · WorkBench `63c2165` · MU `6311d7a` · 릴리스 표 0.0.183 `8460c44`(UNC 업로드·검증, 푸시는 사용자).
  독립 리뷰 반영 — LogBook 목록 정렬은 id·날짜만(MySQL 1038), 변환 안 된 파일은 변환 작업까지 등록, 동시 요청 충돌 처리, 요청당 새로 읽기 5개, 확정 전 자료는 상세도 404 · Studio 늦은 응답 무시.
- 남은 일: 145 LogBook·백엔드 반영 → 새 exe(`/wb-release`) → 앱 안에서 목록·카드 1회 확인 · 145 Wire 모델 건수 확인(적어도 기능은 유지 — 사용자: Wire 자료를 늘릴 예정).

## 1. 목적

Module Unit 권상 Studio(Hoist 탭)에서 권상 위치를 정할 때, LogBook 에 쌓인 **다른 Unit 모델이 실제로 Wire 를 어떻게 걸었는지**를
Studio 안에서 찾아 같은 평면 그림으로 본다.

**하지 않는 것**
- 다른 모델의 배치를 지금 모델에 **자동 적용**하지 않는다. 노드 번호가 모델마다 달라 좌표 매칭이 필요하고, 틀리면 엉뚱한 노드에 권상점이 걸린다(비용 > 이득).
- LogBook 의 3D 뷰어를 Studio 로 옮기지 않는다(LogBook 무수정 사본이 하나 더 늘어남).

## 2. 출처 자료 — `_lifting.bdf` 를 읽는다 (JSON 아님)

| 후보 | 판단 |
|------|------|
| `_lifting_meta.json`(`lifting.wires[]`) · `_posture.json`(`hoisting.groups[]`) | LogBook 에 함께 들어가기 시작한 것은 2026-11-04(`aaf9a4e`)부터라 옛 자료가 없다. 또 integration `files/{id}/content` 는 `kind != model` 이면 415. |
| **`_lifting.bdf`** (채택) | 옛 자료에도 있다. `build_lifting_bdf`(nastran_bridge 4243~) 가 쓰는 구조가 정해져 있다 — 그룹마다 apex GRID 1개, lug→apex `CROD`, apex 에 SPC 123456, 주석 `$ HiTessWorkBench Lifting Analysis (SF=…)` · `$ wires=N, apex GRIDs=M, PID=p, MID=m`, Case Control `TITLE = HiTessWorkBench Lifting Analysis`. LogBook 은 이미 이 TITLE 로 `model_summaries.lifting` 을 켠다(`app/lifting.py`). |

**Wire 요약 추출 규칙** (BDF → JSON, 순수 함수)
1. 주석의 `PID=p` 로 wire property 를 찾는다. 주석이 없으면 SPC 가 걸린 노드에 한쪽 끝이 닿은 CROD 를 wire 로 본다.
2. 같은 apex 를 쓰는 wire = 한 그룹(훅 하나).
3. 그룹마다: apex 좌표, lug 좌표들, wire 길이, 슬링각(wire 와 수평면 사이 각), lug 사이 최대 간격.
4. 모델 전체: 구조 노드의 경계상자(L×B×H, wire·apex 제외), 그룹 수, wire 수, SF, 호선(`$ HiTessModelBuilder: HullNo=`) 주석.
5. 그룹 정보(어느 lug 가 어느 훅)는 BDF 만으로 충분하다 — apex 가 그룹 경계다.

⚠ 사람이 만든(WorkBench 밖) 권상 BDF 는 규칙 1의 대체 판정에 걸릴 수도, 안 걸릴 수도 있다. 1차는 WorkBench 형식(TITLE 있음)만 대상으로 하고, 그 밖은 목록에서 뺀다.

## 3. 구성

```
[MU Studio Hoist 탭]  '다른 Unit 권상 참조' 패널
   │ window.workbenchAPI.searchLiftingReferences({ q, hullNo, limit })
   │ window.workbenchAPI.getLiftingReference({ fileId })
[Electron main]  viewer:searchLiftingRefs · viewer:getLiftingRef   (새 IPC 2개 → exe 재빌드)
   │ fetchWithSessionRefresh(사용자 토큰)
[WorkBench 백엔드]  GET /api/logbook/lifting-refs · GET /api/logbook/lifting-refs/{fileId}
   │ 서버끼리: X-HiTESS-Integration + as=<로그인 사번>
[LogBook]  GET /api/integration/lifting-refs · GET /api/integration/lifting-refs/{fileId}
```

**요약은 LogBook 이 만든다.** 파일 원본·BDF 파서(`app/bdf/deck.py`)·권한·변환 워커가 모두 LogBook 에 있고, WorkBench 145 는 LogBook 공유폴더를 직접 보지 않는다.
WorkBench 백엔드는 중계와 사번 주입만 한다(Studio 가 비밀키를 갖지 않게).

## 4. 계약

### 4.1 LogBook (`routers/integration.py`, `require_integration`)

`GET /api/integration/lifting-refs?as=&q=&hull=&limit=30&offset=0`
- 대상: `is_mu`(대상 태그 Unit/Module Unit 또는 출처 GroupModuleUnit·SidePassage) **이고** 그 자료에 `is_wire_model` 파일이 있는 것, `as` 사번이 볼 수 있는 것만.
- 응답 `{ total, items: [{ fileId, entryId, name, hullNo, shipType, zone, uploadedAt, summary: {...} | null }] }` — summary 는 아래 요약(없으면 null + `summaryState: pending|failed`).

`GET /api/integration/lifting-refs/{fileId}?as=`
- 응답 = 요약 전체:
```json
{
  "schemaVersion": 1,
  "fileId": 123, "name": "3496_m04_lifting.bdf", "hullNo": "3496",
  "safetyFactor": 1.2,
  "bboxMm": { "min": [x,y,z], "max": [x,y,z] },
  "groups": [
    { "id": 1, "apexMm": [x,y,z],
      "wires": [ { "lugNodeId": 34, "lugMm": [x,y,z], "lengthMm": 7012.4, "slingAngleDeg": 61.2 } ] }
  ],
  "outline": [[x,y], ...]
}
```
- `outline` = 평면 투영 외곽(볼록 껍질 또는 부재 선분 축약) — Studio 가 모델 모양을 대략 그리게. 크기 상한(점 2,000개)을 둔다.
- 요약은 처음 요청 때 만들어 `model_summaries` 옆(새 테이블 `lifting_summaries` 또는 JSON 칸)에 캐시, 파일 sha256 이 바뀌면 다시 만든다.
- 오류: 404(권한·없음) · 415(Wire 모델 아님) · 422(요약 실패, 사유).

### 4.2 WorkBench 백엔드 (`routers/logbook_link.py` 옆)
- `GET /api/logbook/lifting-refs` · `GET /api/logbook/lifting-refs/{file_id}` — `require_auth`, `as` = 로그인 사번, 쿼리 그대로 전달.
- 연동 꺼짐(`LOGBOOK_INTEGRATION_SECRET` 비어 있음) → 503 `logbook_disabled`. LogBook 404 → "LogBook 이 이 기능을 모름(먼저 갱신)" 문구.
- GET 이라 `GUARDED_ROUTES` 게이트 대상이 아니다(게이트는 쓰기만 본다) — 등록하지 않는다.

### 4.3 Electron (`electron/index.js` · `preload.js`)
- `viewer:searchLiftingRefs`, `viewer:getLiftingRef` — `downloadLiftingBdf` 와 같은 틀(`sessionFromEvent` → `getWorkbenchRuntimeConfig` → `fetchWithSessionRefresh`). `VALID_INVOKE_CHANNELS` 에도 등록.
- 파일 저장 없음, JSON 만 돌려준다.

### 4.4 ModuleUnitStudio
- Hoist 탭 왼쪽 패널에 접힌 구역 **'다른 Unit 권상 참조'**(아코디언 1개, `TabPanel` 규칙).
  - 검색칸(호선·이름) + 목록. 기본 정렬 = 지금 모델 경계상자(L×B)와 가까운 순(`data/liftingReference.js` 순수 함수 + 테스트).
  - 행 = 이름 · 호선 · L×B · 훅 수/wire 수 · 최소 슬링각.
  - 행을 고르면 오른쪽 아래 비모달 카드에 **평면 그림** — `planViewProjector`·`HoistCandidateThumbnail` 과 같은 방향(→X·↑Y), outline 회색, lug ●, 훅 ○, 그룹 색. 지금 모델 후보 썸네일과 나란히 보이게 같은 축척 옵션.
  - 표·그림만. 3D 뷰포트에 남의 모델을 겹치지 않는다(좌표계가 달라 오해를 부른다).
- `window.workbenchAPI.searchLiftingReferences` 가 없으면(옛 exe) 구역 안에 "WorkBench 를 최신 버전으로 업데이트하세요" 한 줄.
- 버전 정책대로 `module-unit-studio` 버전 올림 → zip → `MODULE_STUDIO_VERSION` 핀 동기화.

## 5. 배포 순서

1. LogBook `git pull` + 재시작(145:9095) — 먼저. 옛 LogBook 이면 WorkBench 가 404 안내.
2. WorkBench 백엔드 `git pull` + 재시작(새 라우트).
3. WorkBench exe 릴리스(`/wb-release`, Electron IPC).
4. Studio zip → `/studio-release module-unit-studio`(145 공개). 옛 exe 사용자는 안내 문구만 본다.

## 6. 검증

- LogBook: 요약 추출 단위 테스트 — 70 에 있는 실제 `_lifting.bdf` 2~3개(3496·3542·3454)로 그룹 수·wire 수·슬링각을 Studio 평가 결과(`_stability.json`)와 대조. 권한 없는 사번 404.
- WorkBench: 라우트 테스트(연동 꺼짐 503 · 중계 · as 주입), 실제 LogBook(70 로컬)에 1회 호출.
- Studio: 정렬·투영 순수 함수 테스트, Chrome 헤드리스 + `workbenchAPI` 대역으로 패널 화면 확인. WorkBench 앱 안 실행은 exe 빌드 후.

## 7. 정할 것 (착수 전)

| 항목 | 추천 | 이유 |
|------|------|------|
| 보이는 범위 | ~~LogBook 권한 그대로(`as`=로그인 사번)~~ → **2026-11-06 변경: 레벨과 무관(LV1 포함)하게 확정 Wire 모델 전부, 차단(blocked) 자료만 뺀다** | 사용자 결정 — 권상 실적은 다른 Unit 을 잡을 때 모두가 참고해야 한다. LogBook `lifting_refs.reference_visible*` 가 목록·상세·결과에만 적용, 자료 화면·BDF 받기 권한은 그대로. 검색어는 이름·제목·자료 코드·**호선**을 함께 찾는다 |
| 대상 자료 | 확정된 자료만(정리 대기 묶음 제외) | 정리 전 자료는 대상 태그가 비어 있을 수 있음 |
| 정렬 기준 | 경계상자 L×B 가 가까운 순 | 권상 배치는 크기·평면 모양에 가장 좌우됨. 중량은 BDF 에서 얻기 비싸 2차 |
| 착수 전 확인 | 145 LogBook 에 Unit + Wire 포함 자료 건수 | 너무 적으면 효용이 낮다(관리 화면 › 검색 › 대상 Unit, 'Wire 포함' 칩) |

## 8. 단계

1. LogBook: 요약 추출 함수 + 테스트 → integration 2개 라우트 + 캐시.
2. WorkBench 백엔드: 중계 라우트 2개 + 테스트.
3. Electron: IPC 2개.
4. Studio: 순수 함수(정렬·투영) → 패널·카드.
5. 커밋 전 저장소마다 `hitess-code-reviewer` 1회.
