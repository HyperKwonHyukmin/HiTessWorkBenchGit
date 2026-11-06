# All Projects — Module Unit 권상 해석 여러 건을 LogBook 으로 한 번에 보내기 (계획)

작성 2026-11-06 · 상태: **구현됨·미커밋(2026-11-06, 6절 추천안 그대로)** · 관련: `2026-11-06-mu-lifting-reference-stress-check.md`(보내기 세트 권장·실적 보기)

## 구현 상태 (2026-11-06)

- 백엔드: `GET /api/admin/projects?logbook=unsent` · `POST /api/admin/projects/logbook/plan`(`admin_projects.bulk_plan_item`·`mark_older_runs`·`bulk_title`, 최대 50) + 테스트 3건.
- 프론트: All Projects 에서 App = 권상(GroupModuleUnit·SidePassage)일 때 [여러 건 보내기] → 선택 모드(안 보낸 것만·해석 완료·파일 보관 중 필터로 시작, 페이지 넘겨도 체크 유지) →
  [선택 N건 미리 보기] = `BulkLogbookSendModal`(보낼 파일 수·크기·결과 세트·경고·못 보내는 사유, 옛 실행은 체크 해제) → 기존 1건 API 를 차례로, 행마다 결과, 끝나면 LogBook 정리 대기 1번 열기.
  규칙 = `utils/bulkLogbookSend.js`(+test).
- **Wire 없는 기록도 보낸다(2026-11-06 사용자 요청)**: 구조 해석 전(검증만) 기록은 원본 모델만, 묶음 이름 `… 권상(Wire 없음) · WB #id`, 표 'Wire' 칸.
  같은 모델의 여러 실행은 Wire 있는 실행 중 최근 1건을 남긴다(결과 유무는 앞세우지 않음 — 고친 모델의 새 실행이 옛 판 결과에 밀리지 않게)(검증만 다시 한 새 기록이 Wire 실적을 밀어내지 않게).
  LogBook 정리 대기 카드 머리에 'Wire 없음 / Wire 포함 / Wire · 결과 포함'(LogBook `lifting.brief.has_result`, `LiftingSetChip`).
- 확인: 백엔드·프론트 테스트, 빌드, 70 DB 실제 권상 기록에 규칙 실행(#3161 → 7개 파일·5 MB·결과 있음, 검증만 한 기록은 당시 'Wire 모델 없음'(지금은 원본 모델만 보냄), 30일 지난 기록은 '보관 기간 지남'). 화면은 눈으로 확인 안 함, 실제 LogBook 보내기는 안 함.

## 1. 목적

LogBook 에 아직 안 올라간 Module Unit 권상 해석(GroupModuleUnit · SidePassage)을 All Projects 에서 **골라 한 번에** 보낸다.
지금은 기록마다 상세 창을 열고 파일을 체크해 한 건씩 보내야 한다. Wire 실적 자료를 늘리는 것이 목적이다(실적 보기 창의 재료).

**하지 않는 것**
- 여러 해석을 LogBook 묶음 **하나로 합치지 않는다.** LogBook 은 묶음 하나 = 자료 하나라, 합치면 서로 다른 Unit 이 한 자료가 된다. 해석 1건 = 묶음 1개(지금과 같음).
- LogBook 쪽 확정을 자동으로 하지 않는다. 정리 대기 → 확정은 지금처럼 LogBook 에서(분류는 54 '여러 자료 분류 한꺼번에' 로 묶어 할 수 있다).

## 2. 지금 있는 것 (2026-11-06 확인)

| 있는 것 | 위치 |
|---|---|
| App(해석 종류) 필터 · 'LogBook 보낸 것만' 토글 · 기간·상태·파일 보관 필터 | `AllProjects.jsx`, `GET /api/admin/projects?program_name=&logbook=sent&file_status=` |
| 기록 1건 보내기(서버끼리, 정리 대기 묶음 1개) | `POST /api/admin/projects/{id}/logbook` `{paths, title, note}` |
| 권상 세트 판단(Wire 모델 + 결과 JSON·모델 JSON·F06, 빠진 것·해석 뒤 모델 변경·DRM 경고) | `admin_projects.lifting_recommendation` |
| 권상이면 Wire 3종 자동 첨부 | `with_lifting` |
| 보낸 기록(실패 포함) | `logbook_exports` |

## 3. 화면

All Projects 목록에 **'여러 건 보내기'** 흐름을 더한다.

1. App 필터에서 Group & Module Unit 권상(또는 Side Passage)을 고르면 목록 위에 '여러 건 보내기' 단추가 켜진다(권상 App 이 아니면 꺼짐 — 세트 규칙이 권상 전용).
2. 누르면 목록이 **선택 모드**: 행 왼쪽 체크칸 + 'LogBook 안 보낸 것만' 필터가 켜진 상태로 시작(새 `logbook=unsent`).
   기본 체크 = 보낼 수 있는 행 전부. 보낼 수 없는 행은 체크칸을 끄고 사유를 보인다:
   파일 보관 만료 · 실패한 해석 · 보낼 모델 없음. (Wire 없는 기록은 원본 모델만 보낸다 — 2026-11-06 변경)
3. **[미리 보기]** → 고른 기록마다 보낼 파일을 서버가 정한 결과를 표로(아래 4절 dry-run):
   `기록 · 모델 이름 · 보낼 파일 수/크기 · 결과 세트(있음/없음) · 경고` — 경고가 있는 행은 노란색, 관리자가 행을 뺄 수 있다.
4. **[N건 LogBook 으로 보내기]** → 한 건씩 차례로 보내며 진행(3/12), 행마다 결과(보냄 · 이미 있음 · DRM 제외 · 실패 사유).
   창을 닫으면 남은 건은 멈춘다(이미 보낸 건은 그대로). 끝나면 LogBook 정리 대기 창을 **한 번만** 연다.
5. 묶음 이름 기본값 = `<호선> <모델 이름> 권상 · WB #<id>`(호선 = input_info.hull_no → 파일명 앞 4자리). LogBook 정리 대기 목록에서 Unit 을 구분할 수 있게.

## 4. 서버

- `GET /api/admin/projects?logbook=unsent` — 보낸 적 없는(실패만 있는 것 포함) 기록. 지금의 `sent` 와 반대 기준.
- `POST /api/admin/projects/logbook/plan` `{ids: [..]}` (최대 50) → 기록마다 `{id, ok, title, files:[{path,size}], totalBytes, hasResult, warnings, reason}`.
  파일 = **입력 BDF + Wire 세트 + 결과 세트**(`lifting_recommendation` 의 wire + result, 입력 BDF 는 input_info 의 모델). 파일 목록을 직접 고르지 않는 대신 이 규칙 하나로 정한다.
- 보내기는 기존 `POST /{id}/logbook` 를 그대로 쓴다(plan 이 준 paths·title). 새 일괄 작업 대기열을 만들지 않는다 — 한 건 실패가 나머지를 막지 않고, 행마다 결과가 그대로 남고, 기존 감사·`logbook_exports` 기록을 다시 쓴다.
  화면이 순서대로 부른다(동시 1건 — LogBook 공유 폴더·DRM 부담을 키우지 않게).
- 같은 BDF 를 여러 번 돌린 기록: 기본은 **같은 입력 BDF 이름이면 가장 최근 성공 1건만 체크**(나머지는 '같은 모델의 옛 실행' 으로 체크 해제). LogBook 은 완전 동일 BDF 를 막아 주지만 Wire·결과 JSON 은 실행마다 달라 중복 자료가 생긴다.

## 5. 함정

1. **보관 기한 30일** — 작업 폴더가 지워진 기록은 보낼 파일이 없다. '안 올린 것' 중 상당수가 이미 만료일 수 있다(145 DB 로 건수 확인 필요). 만료 전 기록부터 보내야 하고, 필요하면 보관 연장(pinned)을 먼저.
2. **해석 뒤 모델 변경 경고** — 세트 경고가 있는 기록은 결과 화면 색이 어긋날 수 있다. 미리 보기에서 기본 체크 해제할지(6절).
3. **LogBook 부담** — 50건 × 약 5 MB = 250 MB. 한 번 상한 50건, 순차 전송.
4. **중간에 창 닫힘** — 순차 루프라 남은 건은 안 간다. 다시 열면 'LogBook 안 보낸 것만' 필터가 이미 보낸 건을 빼 주므로 이어서 보내면 된다.
5. **LogBook 확정은 사람 몫** — 12건을 보내면 정리 대기 12개. 54 로 분류를 한꺼번에 하고, 확정을 한꺼번에 하는 기능이 필요하면 LogBook 쪽 별도 계획.

## 6. 정할 것

| 항목 | 추천 | 이유 |
|---|---|---|
| 보낼 파일 | 입력 BDF + Wire 세트 + 결과 세트 | 실적 보기에 필요한 전부 + 원본 모델. 행마다 고르게 하면 '한 번에' 가 아님 |
| 같은 모델의 여러 실행 | 최신 성공 1건만 기본 체크 | 중복 자료 방지 |
| 경고 있는 기록 | 체크는 하되 노란색 표시 | 결과 없는 Wire 모델도 배치 참조로는 쓸모 있음 |
| 결과 세트 없는 기록 | 보냄('결과 없음' 으로) | 50 의 평면·3D 배치 참조는 Wire 모델만으로 됨 |
| 한 번 상한 | 50건 | LogBook 공유 폴더 부담 |
| 실행 방식 | 화면이 기존 1건 API 를 순서대로 | 새 작업 대기열·재시작 복구가 필요 없다 |

## 7. 단계

1. 백엔드: `logbook=unsent` · `POST /logbook/plan`(규칙·제목·중복 실행 판단) + 테스트(MySQL 정렬 — 목록 쿼리에 JSON 칸을 ORDER BY 하지 않기).
2. 프론트: 선택 모드·미리 보기 표·순차 보내기 진행·결과 표시(규칙은 `utils/` 순수 함수 + 테스트).
3. 커밋 전 `hitess-code-reviewer`. 반영 = 145 ⟳ Update + 재시작(새 라우트) + exe(프론트).
