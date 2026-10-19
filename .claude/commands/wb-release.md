---
description: WorkBench 릴리스 — 버전 올리기·exe 만들기·버전 커밋·푸시를 한 번에
---

사용자가 `/wb-release`를 입력했다. WorkBench 새 exe 를 만들고 버전 변경을 커밋·푸시한다. 인자 `$ARGUMENTS` 가 `X.Y.Z` 면 그 버전으로, 비어 있으면 패치 +1.
커밋·푸시까지 이 명령이 요청한 것이다(전역 규칙의 '사용자가 요청할 때'에 해당).

## 1. 시작 전 확인
- `git fetch` — 원격이 앞서 있으면 멈추고 알린다(pull 은 사용자에게 묻는다).
- `git status --short` — 버전 4파일·`HiTessWorkBench/frontend/src/config.js` 말고 커밋 안 된 변경이 있으면 목록을 보여 주고
  "릴리스 전에 먼저 커밋할지" 묻는다. 기능 변경은 릴리스 커밋에 섞지 않는다.
- 버전 4파일(`HiTessWorkBench/package.json`·`frontend/package.json`·`electron/package.json`·`HiTessWorkBenchBackEnd/app/routers/system.py`)이
  이미 바뀌어 있으면(지난번 빌드가 실패해 올린 버전만 남은 경우) **다시 올리지 않는다** — 4단계에서 `-Bump` 를 뺀다.

## 2. exe 만들기 (수 분)
```
pwsh -NoProfile -File scripts/release.ps1 -Bump -BuildOnly -Yes          # 인자 없음
pwsh -NoProfile -File scripts/release.ps1 -SetVersion X.Y.Z -BuildOnly -Yes   # 인자 X.Y.Z
```
- 작업 폴더 `C:\Coding\WorkBench`. 오래 걸리니 백그라운드로 돌리고 끝나면 이어 간다.
- 스크립트가 하는 일: 버전 4곳 → Python 문법 → `config.js` 를 145 주소로 바꿔 프런트 빌드 후 되돌림 → `npx electron-builder` → exe 이름에 버전이 맞는지.
- 끝 줄의 `RELEASE_EXE=`·`RELEASE_VERSION=` 을 읽는다. 실패하면(종료 코드 ≠ 0) **커밋하지 않고** 오류 줄을 그대로 보고한다.

## 3. 커밋 메시지
지난 릴리스 커밋 이후 커밋 제목을 모은다: `git log --format=%s <지난 '🔖 release:' 커밋>..HEAD`.
```
🔖 release: 버전 X.Y.Z — <이번에 사용자가 체감할 변화 한두 개>

- <지난 버전> 이후: <기능·수정 요약, 커밋 7자리>
- 버전 <지난 버전> → X.Y.Z(앱·프런트·Electron·서버)

Co-Authored-By: (이 세션의 attribution 줄)
```
- 테스트·문서만 바뀐 커밋은 요약에서 빼거나 한 줄로 묶는다. 한국어.

## 4. 커밋·푸시
- `git add` 는 **버전 4파일만**. `config.js`·`Darkmode.js`·다른 세션 파일은 넣지 않는다(커밋 훅도 막는다).
- 커밋 전 `git diff --cached --stat` 이 4파일·각 1줄인지 확인 → 커밋 → `git push`.

## 5. 보고 (짧게)
- 커밋 7자리, 버전, exe 경로·크기
- 145: 서버 코드가 바뀐 커밋이 있었으면 Server Manager ⟳ Update(새 `.env` 키가 있었으면 알림). exe 는 사용자가 배포한다.
- 눈으로 확인하지 않은 것(exe 실행)은 '확인 안 함'으로.
