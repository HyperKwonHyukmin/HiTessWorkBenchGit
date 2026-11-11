# MU 권상 — 지난 구조 해석 결과를 Studio 로 다시 보기 (읽기 전용)

작성 2026-11-11 · 사용자 결정: **읽기 전용**(응력·변위 확인용). 편집을 이어서 다시 해석하는 복원은 범위 밖.

## 왜

Studio 는 구조 해석 결과를 해석 직후 메모리에만 들고 있다. 창을 닫거나 다음 날 다시 열면 응력 색·변위를 볼 길이 없고,
WorkBench '결과 다시 열기'는 판정 카드만 되살린다. 서버에는 이미 실행마다 입력·결과 사본이 남아 있다(`lifting_reviews/<해시>/manifest.json`).

## 방식 — LogBook '실적 보기' 부품을 그대로 쓴다

실적 보기(2026-11-06)는 "모델 JSON → initialFolder, 결과 JSON → 세션 reference" 로 읽기 전용 Studio 창에 결과 화면을 복원한다.
입력 출처만 LogBook 자료 대신 **내 Unit 구조 해석 기록(analysisId)** 으로 바꾼다.

```
ResultArtifactsCard [Studio 에서 결과 보기]
  → GET /api/analysis/unit-structural/{id}/result-set   (백엔드: 모델 JSON + 결과 JSON 한 번에)
  → IPC viewer:openPastStructuralResult(본창만)          (Electron: 모델을 %TEMP% 에 쓰고 openViewerSession)
  → Module Unit Studio 읽기 전용 창 (reference.kind = 'past')
```

## 해석에 쓴 모델 JSON 고르기 (결과 elementId 가 편집 모델 기준이라 중요)

1. manifest `editedModel` 사본 — 그 실행이 실제로 쓴 편집 모델(가서포트 포함). 작업 폴더 `_edited.json` 은 다음 해석에 덮어써지므로 쓰지 않는다.
2. manifest 는 있는데 편집 모델이 없음 = 편집 없이 해석 → 작업 폴더 원본 `<stem>.json`.
3. manifest 없음(보관 도입 전 기록) → 작업 폴더 `_edited.json` → `<stem>.json`, **'해석 뒤 모델이 바뀌었을 수 있음' 경고**를 붙인다.

결과 JSON 도 manifest 사본을 먼저, 없으면 `result_info.nastranResultJson`.

## 단계

| # | 위치 | 내용 |
|---|---|---|
| 1 | 백엔드 `services/unit_structural_result_set.py` + `analysis.py` 라우트 | 권한 = 기존 `_load_unit_structural_record`(본인·관리자, Success 만). DRM 머리·JSON 오류는 오류로. |
| 2 | Electron `viewer:openPastStructuralResult` | 본창(mainWindow)이 보낸 요청만. 창은 하나(sourceKey `unit-structural-past`) — 실적 창과 따로, 내 작업 창과도 따로. |
| 3 | Studio `data/referenceMode.js`·`ReferenceAnalysisPanel` | `kind:'past'` 면 띠·패널 문구를 '내 지난 해석'으로. 그 외(탭 제한·결과 화면)는 실적 보기 그대로. |
| 4 | 프론트 `ResultArtifactsCard` | 버튼 1개 — GMU 3단계·My Projects 상세가 함께 쓴다. 옛 exe(IPC 없음)면 '앱 업데이트 필요'. |

## 범위 밖 / 남는 한계

- 대상은 그 GMU 기록의 **가장 최근 성공한** 구조 해석 하나(artifacts 의 `unitStructuralAnalysisId`). 더 이전 실행 고르기는 필요하면 다음에.
- 보관 기간(30일)이 지나 폴더가 지워진 기록은 열 수 없다.
- 반영 = 145 `git pull + 재시작`(라우트) · 새 exe(IPC·버튼) · Studio bump(문구).

## 상태 (2026-11-11 세션 끝)

- 구현 완료 + **Wire·훅 표시 추가** — 서버가 그 실행의 `_stability.json` 사본(`stability`)도 보내고 Studio 가 `useStabilityStore.setReport` 로 Wire 를 그린다. 결과 창은 Node 레이어를 끈 채 연다.
- 확인: 사용자가 70 개발 앱에서 버튼 → Wire 포함 응력 화면 확인. 서버 시험 8건 · 프론트 4건 · Studio referenceMode 7건.
- 배포: 70 로컬 MU 0.0.211(이후 다른 세션이 0.0.212). 145 미반영.
- 남은 일: 커밋 전 `hitess-code-reviewer`(WorkBench + ModuleUnitStudio 미커밋 전체) → 커밋 → 145 `git pull`+재시작 · 새 exe · `/studio-release module-unit-studio`.
