---
description: Studio 릴리스 — WorkBench 버전은 그대로 두고 지정한 Studio 만 145 사용자에게 최신(또는 지정) 버전으로 연다
---

사용자가 `/studio-release`를 입력했다. 인자 `$ARGUMENTS` = `<viewer-id> [버전]` (예: `model-studio`, `model-studio 0.0.118`). 여러 개는 띄어 쓴다.
비어 있으면 `python scripts/studio_release.py --check` 결과(릴리스 대기 목록)를 보여 주고 어느 것을 열지 묻는다.
커밋·푸시까지 이 명령이 요청한 것이다.

배경(2026-10-29): 개발 PC(70)와 운영(145)이 같은 UNC `StudioProgram` 을 본다. 145 백엔드는
`HiTessWorkBenchBackEnd/app/studio_release.json` 에 적힌 버전만 내주므로(`viewers.py`), UNC 에 올리기(`/deploy`)와
145 사용자에게 열기(이 명령)가 나뉜다. 70 은 `.env` `STUDIO_CHANNEL=dev` 라 늘 최고 버전.
viewer id: `model-studio` · `module-unit-studio` · `mooring-fitting-studio` · `plate-studio` · `side-passage-studio`.

## 1. 확인
- `git fetch` — 원격이 앞서 있으면 멈추고 알린다.
- 그 버전 zip 이 UNC 에 있어야 한다(없으면 스크립트가 거부한다 — 먼저 `/deploy`).
- 145 는 표의 버전을 서버 로컬 `StudioProgram\` → UNC 순으로 찾고, 어디에도 없으면 그 Studio 가 404 다(이전 버전으로 넘어가지 않음).
  UNC 가 끊길 때를 대비하려면 145 로컬 `StudioProgram\` 에도 같은 zip 을 복사해 두라고 보고에 적는다.
- Studio 가 새 엔진 기능(새 intent 등)을 쓰면 145 InHouse exe(`Cmb.Cli.exe` 등)가 먼저 교체됐는지 확인한다 — 안 됐으면 사용자에게 알린다.
- 그 Studio 의 화면 확인이 끝났는지 사용자 말에서 확인한다. '눈으로 확인 안 함' 상태면 그 사실을 한 줄 알리고 진행한다(사용자가 이미 결정해서 부른 명령).

## 2. 표 고치기
```
python scripts/studio_release.py <viewer-id> [<viewer-id> …]            # UNC 최신 정상 zip 으로
python scripts/studio_release.py <viewer-id> --version X.Y.Z            # 지정 버전(롤백 포함)
```
- 바뀐 줄을 그대로 보고에 쓴다. `CHANGED=0` 이면 할 일 없음 — 커밋하지 않고 끝낸다.

## 3. 커밋·푸시
- `git add HiTessWorkBenchBackEnd/app/studio_release.json` **만**. 다른 변경은 섞지 않는다.
- `git diff --cached --stat` 확인 → 커밋 → `git push`. 메시지(파일로 넘긴다):
```
🚀 studio-release: <viewer-id> <이전> → <새 버전>

- <그 버전에서 사용자가 체감할 변화 한두 줄>
- 배포 영향: 145 Server Manager ⟳ Update(git pull)만 — 재시작·exe 배포 불필요

Co-Authored-By: (이 세션의 attribution 줄)
```

## 4. 보고 (짧게)
- 커밋 7자리, 바뀐 Studio·버전
- 145: ⟳ Update 하면 다음에 Studio 를 여는 사용자부터 새 버전을 받는다(설치본과 버전이 다르면 자동 재설치 — 롤백도 같은 길).
- 롤백: `/studio-release <viewer-id> <이전 버전>`.
