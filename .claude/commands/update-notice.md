---
description: 사용자 업데이트 안내 페이지(/updates) 작성 — UpdateNotice 폴더의 캡처를 기능과 맞춰 상자·번호를 얹고 updates.json 에 안내를 넣는다
---

사용자가 `/update-notice` 를 입력했다. 인자 `$ARGUMENTS` = 무엇을 안내할지(예: `MU 평가 모드`, `MB 0.1.15`) — 비어 있으면 그림과 최근 변경으로 정한다.
규칙 원본 = `docs/platform/public-pages.md` '사용자 업데이트 안내 페이지' 절 — **먼저 읽는다.** 여기는 순서만 적는다.
이 명령은 **안내 작성과 페이지 모양 확인까지** 요청한 것이다. 커밋·푸시는 사용자가 내용을 보고 확인한 뒤에만 한다.

## 1. 재료 모으기
- 그림: `HiTessWorkBenchBackEnd/UpdateNotice/` 의 캡처(사용자가 둔 것)를 전부 Read 로 본다. 화면 속 단추·문구로 어느 App·Studio·기능인지 판별한다
  (예: 'RBE 연결 반영해 그룹 색 합치기' = Model Builder Studio, Hoist 탭 = Module Unit Studio). 판별이 안 되면 추측하지 말고 묻는다.
- 바뀐 것: `HiTessWorkBenchBackEnd/app/changelog/changelog.json` 최근 항목, 해당 Studio·WorkBench `git log`, `HiTessWorkBenchBackEnd/app/studio_release.json`(145 공개 버전).
- 기존 안내: `HiTessWorkBenchBackEnd/UpdateWeb/updates.json` 의 `_comment` 와 맨 앞 안내 1~2건(형식·말투를 맞춘다).
- **사용 방법이 바뀌는 기능만** 안내한다. 작은 수정은 changelog.json 에만 둔다.
- 145 에 아직 안 열린 기능(릴리스 표 버전보다 새 것)이면 먼저 알린다 — 안내는 공개와 같은 날 나가야 한다.

## 2. 안내 나누기
- **안내 1건 = 기능 1개**(2026-11-26 사용자 지시, LogBook 처럼). 기능마다 주소가 하나라, 그 기능을 요청한 사람이나 쓸 사람에게 그 주소만 보낸다.
  같은 날 같은 App 에 기능이 넷이면 안내도 넷이다. 여러 기능을 한 안내에 묶지 않는다. 원인과 바뀐 점과 고치는 법이 한 기능의 이야기면 한 안내다.
- 안내마다 App 하나: `programs`(App 사용자 통계 키)는 `HiTessWorkBench/frontend/src/contexts/DashboardContext.jsx` 의 그 App `programNames` 를 그대로 쓴다.
  Studio 기능은 그 Studio 를 여는 App 으로(MU Studio = Group & Module Unit 권상 구조 해석, MB Studio = HiTESS Model Builder).
- 두 Studio 에 같이 들어간 기능은 App 마다 안내 하나씩(같은 글, 그림 하나를 같이 쓰고 어느 Studio 화면인지 캡션에 적는다).

## 3. 그림 만들기 (원본 캡처 그대로 넣지 않는다 — 작은 단추를 못 찾는다)
- `outputs/update-notice/spec-<날짜>.json` 에 그림마다 `{src, out, crop, scale, marks:[{box, n}]}` 를 적고
  `python -X utf8 scripts/update_notice_annotate.py <spec>` → 결과는 `HiTessWorkBenchBackEnd/UpdateWeb/img/<짧은-영문-이름>.png`.
  box 는 원본 좌표. 주황 상자 + 번호 ①②…, 번호는 본문 글의 '(그림 ①)' 와 맞춘다.
- 결과 그림을 Read 로 열어 상자가 제자리인지 본다. 넓은 캡처는 빈 곳을 잘라내거나 두 장으로 나눈다(페이지 본문 폭이 약 480px 라 줄어든다).

## 4. 안내 쓰기
- `updates.json` `entries` **맨 앞**에: `id`(`YYYY-MM-DD-영문-주제`), `date`, `app`, `programs`, `version`(예: `Module Unit Studio 0.0.225`), `title`, `summary`,
  `sections` = `{id:'change', heading:'바뀐 점', facts[{label,text}], points?, image|images?, note?}` + 순서가 있으면 `{id:'how', heading:'쓰는 법', steps, images?, note?}`.
  title 은 그 기능 이름(예: '부재 위에 권상점 만들기(부재 나누기)'), summary 는 한두 문장으로 무엇이 달라졌는지.
- facts 는 '무엇이 바뀌었나 / 어디서 보나 / 결과에 미치는 영향' 을 기본으로(필요하면 한 줄 더).
- 그림은 순서(steps)가 있으면 '쓰는 법' 구획에, 없으면 '바뀐 점' 구획에 둔다. 그림 번호는 안내마다 ①부터.
- 보고서 그림처럼 해석 결과를 그리는 그림은 `userConnection` 의 실제 결과 폴더(전체 모델)로 그린다. 시험용 자료(`tests/fixtures`)는 부재를 줄여 두어 구조가 조각나 보인다(2026-11-26 사고).
- 이미 공개한 그림을 고칠 때는 새 파일 이름으로 올린다(그림은 브라우저에 하루 저장돼, 같은 이름이면 옛 그림이 계속 보인다).
- `formerId` 는 2026-11-26 에 나눈 옛 안내의 주소를 살리려고 단 칸이다. 새 안내에는 쓰지 않는다.
- **태그는 Claude 가 단다**(2026-11-26 사용자 지시): 안내마다 `tags` 1~4개(보통 2~3개)를 `summary` 바로 뒤에 넣는다. 이름은 `updates.json` 맨 위 `tagList` 에서 고른다.
  기준: 사용자가 무엇으로 찾을지(화면 영역이나 대상: 권상점, RBE 연결, 보고서, 입력 CSV 같은 것). App 이름과 '개선' 같은 종류는 태그로 쓰지 않는다(App 은 따로 거른다). '오류 수정' 은 고친 것일 때만.
  맞는 태그가 없을 때만 `tagList` 에 새 이름을 더한다(16자 이하, 비슷한 이름을 만들지 않는다). `test_repo_tags_come_from_tag_list` 가 목록 밖 이름을 막는다.
- 사용자 눈높이로 쓴다 — 내부 파일명·함수명·버전 경과 금지, em dash 금지, 가운뎃점으로 낱말을 잇지 않는다(화면 이름 인용은 그대로).
  '⚠' 같은 기호는 페이지 글꼴이 다른 모양으로 그릴 수 있어 글로 쓴다.
- 아직 145 에 반영되지 않은 부분(서버·exe 가 따라와야 하는 것)은 note 로 사실대로 적는다.
- 그 기능의 `changelog.json` 항목에 `"page": "<안내 id>"` 를 단다(Update History 의 '사용자 안내 페이지' 단추).
- JSON 은 파이썬으로 고친다(기존 내용을 다시 쓰지 말고 앞에 넣기만 — `git diff --stat` 가 추가만인지 본다).

## 5. 확인
- `pytest tests/test_admin_updates.py tests/test_updates_web.py -q`(HiTessWorkBenchBackEnd/ 에서).
- 70 백엔드(9091)가 떠 있으면 헤드리스 Chrome 으로 `http://127.0.0.1:9091/updates/<id>` 를 넓은 폭(1400)으로 찍고,
  **390px 는 창 폭이 아니라 390px iframe 에 넣어** 찍는다(창은 그보다 좁아지지 않아 잘린 것처럼 보인다). 그림 글자를 읽을 수 있는지, 넘침이 없는지 본다.
  9091 이 꺼져 있으면 '페이지 모양 확인 안 함' 으로 보고한다.

## 6. 보고
- 안내마다: 주소 `http://10.14.42.145:9091/updates/<id>`, App, 제목, 쓴 그림(번호가 무엇을 가리키는지). 주소는 기능마다 따로 적어 사용자가 골라 보낼 수 있게 한다.
- 판단한 것(어느 그림이 어느 기능인지, 안내를 나눈 이유)과 확인 안 한 것.
- 마지막에 커밋할지 묻는다. 커밋 대상 = `updates.json`, 새 `img/*.png`, `changelog.json`(page 연결) — 다른 변경은 섞지 않는다.
  반영은 145 ⟳ Update(git pull)만(재시작 불필요). 원본 캡처(`UpdateNotice/`)는 커밋하지 않는다.
