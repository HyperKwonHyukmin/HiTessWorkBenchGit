# MU Studio — 권상 실적의 해석 결과를 Studio 결과 화면으로 보기 (수정 전략)

작성 2026-11-06 · 상태: **구현됨·미커밋(2026-11-06, '구현 상태')**

## 구현 상태 (2026-11-06)

- 짝 보증은 묶음 표(5절) 대신 **LogBook 이 같은 자료·같은 폴더·같은 stem 으로 찾는다**(사용자: WorkBench 결과는 전체를 다시 보낸다 → 한 번에 같은 폴더에서 온 파일). 묶음 표는 만들지 않았다.
- WorkBench 보내기: `GET /api/admin/projects/{id}/files` 의 `liftingSet` → 상세 모달이 세트를 미리 체크(권장).
- LogBook(계획 번호 59): `lifting_refs.result_files/result_bundle` · `GET /api/integration/lifting-refs/{id}/result`(결과·모델 JSON 내용) · 목록·상세 `hasResult`. 오류 404 no_result · 415 · 422(drm·bad_json·too_large·file_missing) · 503.
- WorkBench 백엔드: `GET /api/logbook/lifting-refs/{id}/result` 중계(옛 LogBook → 501).
- Electron(**exe 재빌드 필요**): `viewer:open` 본체를 `openViewerSession(payload, extra)` 로 분리 · `viewer:openLiftingRefResult`(모델 JSON → `%TEMP%/hitess-lifting-ref/<id>/`, 세션 `reference` 에 결과) · `viewer:getReferenceContext`.
- MU Studio: `data/referenceMode.js`(+test) · `useReferenceModeStore` · 시작 때 `getReferenceContext` 가 있으면 결과를 `setSuccess` 로 넣고 Analysis 탭 · 탭 3개만(model·modelCheck·analysis) · 상단 띠 · `ReferenceAnalysisPanel` · 실적 상세의 [해석 결과 화면으로 열기].
- 확인: 각 저장소 테스트 통과, 실제 3496 결과·모델 JSON 으로 Chrome 헤드리스 화면(띠·판정 '실패 — 허용응력 초과 부재 25개'·결과 표). 3D 응력 색은 헤드리스에서 3D 가 비어 눈으로 확인 못 함. WorkBench 앱 안 실행·실제 LogBook 연결은 확인 안 함. · 선행: `2026-11-04-mu-studio-logbook-wire-reference.md`(실적 보기, MU 0.0.183~0.0.189)

방향(사용자, 2026-11-06): Wire 모델을 앞으로 늘린다. 보낼 때 `_lifting.bdf` 와 함께 해석 결과도 넘기고, Studio 에서 실적을 부르면
**MU Studio 의 구조 해석 결과 화면(응력 색·결과 표·변위·Wire 장력)과 같은 화면**으로 띄운다.
(같은 날 1차안 '서버에서 다시 해석' 은 옛 자료 1건 때문에 세운 것이라 버린다 — 9절.)

## 1. 핵심 사실 — F06 만으로는 결과 화면을 못 띄운다

Studio 결과 화면은 두 가지를 합쳐 그린다(MU `three/NastranResultOverlay.js:56-76` · `components/UnitStructuralResultDock.jsx`).

| 필요한 것 | 파일 | 크기(3496 실측) | 없으면 |
|-----------|------|----------------|--------|
| 결과 | `<stem>_lifting_nastranResult.json` (`members[]` 응력·활용도, `wires[]` 장력, `displacements[]`, `summary`, `evaluation.structuralAllowableMPa`) | 818 KB | 화면 없음 |
| **모델** | 해석에 쓴 모델 JSON = `<stem>_edited.json`(편집이 있었으면) 또는 `<stem>.json` — 노드 좌표·부재 연결·단면 | 782 KB ~ 1.3 MB | 결과의 elementId 를 그릴 좌표가 없다 |
| 원본 증거 | `<stem>_lifting.bdf`(이미 보냄) · `<stem 소문자>_lifting.f06` | 349 KB · 2.7 MB | 화면에는 불필요. 허용응력을 바꿔 다시 판정할 때(`lift-result`, Nastran 불필요) 필요 |
| Wire 표 | `<stem>_lifting_meta.json`(이미 보냄) | 4 KB | F06 으로 다시 판정할 때 필요 |

- Studio 에는 BDF 파서가 없다(JSON 만 읽음). 결과 JSON 의 elementId 는 **편집 모델 기준**이라 원본 `<stem>.json` 이 아니라 해석에 실제로 쓴 JSON 을 보내야 한다.
- 그래서 보낼 묶음 = **결과 JSON + 모델 JSON + F06** (+ 이미 가는 BDF·meta·posture). 한 건 약 5 MB. LogBook 업로드 상한에는 걸리지 않는다(조각 32 MiB, 보내기 1회 4 GiB).
- OP2(2.8 MB)는 보내지 않는다 — 읽는 곳이 없다.
- 70 폴더 파일에는 DRM 머리가 없었다. 145 에서도 그런지는 미확인(LogBook 은 DRM 파일을 거절하므로 첫 보내기에서 드러난다).

## 2. 전체 흐름

```
[WorkBench All Projects → LogBook 보내기]
   권상 해석이면 자동 첨부에 3개 추가: _lifting_nastranResult.json · 해석에 쓴 모델 JSON · _lifting.f06
   + 묶음 표 _lifting_bundle.json (WorkBench 가 보낼 때 만든다, 5절)
[LogBook]  같은 entry 에 저장. 서버 간으로 묶음을 내주는 라우트 추가(4절)
[MU Studio 실적 패널]  실적 행에 '해석 결과 있음' 표시 → [결과 화면으로 열기]
   │ workbenchAPI.openLiftingReference({ fileId })        ← 새 IPC → exe 재빌드
[Electron]  백엔드에서 묶음을 받아 임시 폴더에 풀고, MU Studio 를 '실적 보기' 창으로 연다
            (MULTI_INSTANCE, sourceKey = logbook:<fileId>, 창 제목 '실적 · 3503_M03_G')
[MU Studio 실적 보기 창]  모델 JSON 로드 + 결과 JSON 을 결과 저장소에 넣음 → 기존 결과 화면 그대로
```

지금 창(내 모델) 안에 겹쳐 그리지 않고 **별도 창**으로 연다. 결과 화면 코드가 stageData(로드된 모델) 하나를 전제로 짜여 있어,
같은 창에 모델 둘을 들이면 결과 화면·선택·찾기를 전부 손봐야 한다. 별도 창이면 기존 코드를 거의 그대로 쓴다.

## 3. MU Studio — '실적 보기' 모드 (새 개념)

- 진입: 시작 정보에 `mode: 'reference'` 가 오면 이 모드. 모델·결과 둘 다 있을 때만.
- 보이는 것: Model · Model Check · Analysis(결과) 탭. **Edit · Hoist · Save 탭과 해석 실행 단추는 숨긴다** — 남의 확정 자료를 고쳐 다시 올리는 경로를 만들지 않는다.
  Electron 쪽도 이 창의 `runUnitStructural`·업로드 IPC 를 거부한다(`parentAnalysisId` 없음 → 이미 거부되는 구조, 확인 필요).
- 상단 띠(항상): `실적 보기 · 3503_M03_G · 2026-10-14 해석 · 허용 220 MPa(해석 당시) · 읽기 전용`.
- 결과 화면은 지금과 같다: 판정 칩, 최대 응력·활용도·초과 부재, 최대 변위(참고), Wire 장력·압축, 결과 표 행 클릭 → 3D 이동.
- 판정은 결과 JSON 의 값으로 지금 규칙(`gmuLiftingVerdict.js` = Electron `viewer:runUnitStructural`)을 그대로 쓴다. 규칙을 새로 복사하지 않는다.
- 실적 패널(내 창)에서 결과가 없는 실적은 단추 대신 '해석 결과 없음(BDF 만 보관)' 표시.

## 4. LogBook

- 업로드는 이미 받는다(`.f06` = result, `.json` = other, 확장자 차단 없음). 바꿀 것은 **서버 간 조회** 하나:
  지금 `GET /api/integration/files/{id}/content` 는 `kind != model` 이면 415.
- 새 라우트 `GET /api/integration/lifting-refs/{fileId}/bundle?as=` — 그 Wire BDF 가 든 entry 에서 `_lifting_bundle.json` 이 가리키는 파일만 묶어 준다(zip 또는 파일별 목록 + 내용 라우트).
  권한·확정 여부는 기존 lifting-refs 규칙 그대로. 묶음 표가 없으면 404 `no_result_bundle`.
- 실적 목록·상세 요약에 `hasResult`(묶음 표 있음) 한 칸 추가 → Studio 가 단추를 켤지 정한다.
- entry 하나에 여러 해석 묶음이 들어오면? 묶음 표는 BDF sha256 으로 짝을 잡으므로 BDF 별로 갈린다.

## 5. 짝 보증 — `_lifting_bundle.json`

F06 안에는 BDF 이름이 없고, 결과 JSON·meta 에도 sha 가 없다. 같은 폴더에서 해석을 다시 돌리면 파일이 덮어써진다
(`unit_structural_service.py:259-266`). 그래서 **보내는 순간** WorkBench 가 묶음 표를 만든다:

```json
{ "schemaVersion": 1, "analysisId": 6732, "structuralAnalysisId": 6801,
  "files": { "liftingBdf": {"name": "…_lifting.bdf", "sha256": "…"},
             "result":     {"name": "…_lifting_nastranResult.json", "sha256": "…"},
             "model":      {"name": "…_edited.json", "sha256": "…"},
             "f06":        {"name": "…_lifting.f06", "sha256": "…"},
             "meta":       {"name": "…_lifting_meta.json", "sha256": "…"} },
  "allowableMPa": 220, "safetyFactor": 1.2, "analyzedAt": "2026-11-03T01:41:03Z" }
```

만들기 전 확인(하나라도 어긋나면 묶음 표를 만들지 않고 BDF 만 보낸다 — 화면에 사유 표시):
- 결과 JSON `meta.f06Path`·`meta.liftingMetaJson` 의 파일 이름 = 보내는 F06·meta 이름(대소문자 무시).
- 결과 JSON 의 시각 ≥ meta 시각, 결과에 FATAL 없음(`meta.hasFatal`) — FATAL 결과도 보내되 표에 `fatal: true`.
- 모델 JSON = 그 구조 해석이 실제로 쓴 것(`result_info` 또는 `_edited.json` 존재 규칙, 구현 때 코드로 확정).

nastran_bridge 를 고치지 않는다(InHouse 수동 교체를 늘리지 않으려고). 묶음 표는 WorkBench 백엔드 `admin_projects.py` 만 바꾼다.

## 6. 함정

1. **보관 기한** — WorkBench 작업 폴더는 30일 뒤 지워진다. 지금 실적 E000078 은 2026-10-14 해석이라 **2026-11-13 무렵 결과 파일이 사라진다.** 결과까지 남기려면 이 기능 배포 뒤 그 전에 다시 보내야 한다(배포가 늦으면 그 1건은 결과 없음으로 남는다).
2. **허용응력은 해석 당시 값**이다. 화면에 그 값을 쓴다. 다른 기준으로 보고 싶으면 F06 + meta 로 `lift-result` 를 서버에서 다시 부르는 단추를 2차로 둔다(Nastran 불필요, 수 초).
3. **옛 결과 JSON 형식** — 결과 JSON 필드가 바뀌면 옛 실적이 새 Studio 에서 깨질 수 있다. 묶음 표 `schemaVersion` 과 결과 JSON 형식을 Studio 가 확인하고 모르는 형식이면 '결과 형식이 오래됨' 으로 알린다.
4. **판정 규칙 사본** — 새 사본을 만들지 않는다(3절).
5. **크기** — 큰 Unit 은 F06 이 수십 MB 가 될 수 있다. 화면에 F06 은 필요 없으므로 Studio 로 내려줄 때는 결과·모델 JSON 만 받는다(F06 은 LogBook 보관·재판정용).
6. **WorkBench 보내기 경로는 관리자 All Projects 하나뿐**이다. Wire 모델을 늘리는 실제 경로가 이것이 맞는지 확인(7절).

## 7. 정할 것

| 항목 | 추천 | 이유 |
|------|------|------|
| 보낼 결과 | 결과 JSON + 모델 JSON + F06 | 결과 화면에 앞의 둘이 꼭 필요, F06 은 증거·재판정용 |
| 보는 화면 | 별도 MU Studio 창, 읽기 전용 '실적 보기' | 기존 결과 화면을 그대로 쓴다. 같은 창에 겹치면 고칠 곳이 많다 |
| 읽기 전용 범위 | Edit·Hoist·Save·해석 실행 숨김 | 확정 자료를 고쳐 쓰는 경로를 만들지 않는다 |
| 허용응력 다시 판정 | 2차(필요해지면) | 지금은 해석 당시 220 으로 충분 |
| 보내는 경로 | 지금처럼 관리자 All Projects | GMU 화면에 'LogBook 으로 보내기' 를 따로 두는 것은 확인 후 |
| E000078 | 배포 뒤 11-13 전 다시 보내기, 늦으면 결과 없음 | 서버 재해석 경로를 이 1건 때문에 만들지 않는다 |

## 8. 단계

0. **(2026-11-06 구현·미커밋) 보내기 화면이 세트를 권한다** — 사용자 결정: 강제 첨부가 아니라 권장, WorkBench 결과는 사용자가 전체를 다시 보낸다(6절 1번 걱정 해소).
   `GET /api/admin/projects/{id}/files` 가 권상 해석이면 `liftingSet: {wire, result, missing}`(`admin_projects.lifting_recommendation`) →
   상세 모달이 그 파일을 미리 체크하고 안내 상자('권상 Wire 모델 세트', 빠진 파일, [세트 다시 체크])를 띄운다. 결과 없으면 노란 경고.
   기존 강제 첨부(`with_lifting`: BDF·meta·posture)는 그대로. 묶음 표 `_lifting_bundle.json` 은 아직 없다 — 지금 보낸 자료는 LogBook entry 의 파일별 sha256 + 이름 규칙으로 짝을 잡는다.
1. WorkBench 백엔드: `_lifting_bundle.json` 생성·검사 + 테스트(실제 3496 폴더로 묶음 표, 어긋난 짝 거절).
2. LogBook: `bundle` 라우트 + `hasResult` + 테스트 → 70 에 실제 보내기 1회.
3. WorkBench 백엔드: 중계 라우트(`GET /api/logbook/lifting-refs/{id}/bundle`).
4. Electron: `viewer:openLiftingRef`(받기·임시 폴더·창 열기, 실적 창의 쓰기 IPC 거부) → exe 재빌드.
5. MU Studio: 실적 보기 모드(탭 숨김·상단 띠·결과 저장소 채우기) + 실적 패널 단추 → 버전·zip·핀.
6. 커밋 전 저장소마다 `hitess-code-reviewer`.
7. 배포 순서: LogBook → WorkBench 백엔드 → exe → `/studio-release module-unit-studio` → E000078 다시 보내기.

## 9. 버린 안

- **서버 재해석 + 캐시**(같은 날 1차안): 옛 자료에도 되지만 Nastran 을 다시 돌리고, 결과 화면을 띄우려면 결국 모델 JSON 을 BDF 에서 만들어야 한다(Studio 형식 변환기 신설). 앞으로 결과를 함께 보낸다면 필요 없다.
- **WorkBench DB 로 원래 결과 역추적**: 30일 삭제·짝 모호.
- **지금 창의 실적 3D 미리보기에 응력 색만 입히기**: 선분에 부재 번호가 없어 LogBook 요약 형식을 바꿔야 하고, 결과 표·Wire 장력·변위는 따로 다시 만들어야 한다. 요청('결과 화면처럼')에 못 미친다.
