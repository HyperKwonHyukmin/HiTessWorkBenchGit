---
description: Studio 릴리스 — WorkBench 버전은 그대로 두고 지정한 Studio 만 145 사용자에게 최신(또는 지정) 버전으로 연다
---

사용자가 `/studio-release`를 입력했다. 인자 `$ARGUMENTS` = `<viewer-id> [버전]` (예: `model-studio`, `model-studio 0.0.118`). 여러 개는 띄어 쓴다.
비어 있으면 `python scripts/studio_release.py --check` 결과(릴리스 대기 목록)를 보여 주고 어느 것을 열지 묻는다.
UNC 업로드·커밋·푸시까지 이 명령이 요청한 것이다.

배경(2026-10-29): 개발 PC(70)와 운영(145)이 같은 UNC `StudioProgram` 을 본다. 그래서 역할을 나눈다.
- `/deploy`("배포해") = **70 로컬 `HiTessWorkBenchBackEnd\StudioProgram\` 에만** 올린다 → 70 에서 테스트(70 `.env` `STUDIO_CHANNEL=dev` = 늘 최고 버전).
- `/studio-release`(이 명령) = 그 zip 을 **UNC 에 올리고** `HiTessWorkBenchBackEnd/app/studio_release.json` 을 그 버전으로 → 145 공개.
  145 백엔드는 표에 적힌 버전만 내준다(`viewers.py`). UNC 에 먼저 올리지 않으니 145 가 옛 백엔드여도 베타가 새지 않는다.

| viewer id | zip 출처(`C:\Coding\WorkBenchSubModule\`) |
|---|---|
| `model-studio` | `ModelBuilderStudio\apps\model-studio\release` |
| `module-unit-studio` | `ModuleUnitStudio\apps\module-unit-studio\release` |
| `side-passage-studio` | `SidePassageStudio\apps\side-passage-studio\release` |
| `plate-studio` | `PlateAnalysisStudio\apps\plate-studio\release` |
| `mooring-fitting-studio` | `MooringFittingStudio\release` |

## 1. 확인
- `git fetch` — 원격이 앞서 있으면 멈추고 알린다.
- 열 버전 = 인자 버전, 없으면 **70 로컬 StudioProgram 의 최고 버전**(= 70 에서 테스트한 것). 그 zip 이 위 출처 폴더에 있어야 한다(없으면 먼저 `/deploy`).
  ⚠ 70 로컬 `StudioProgram\` 의 zip 은 회사 DRM 이 암호화해 둔 상태라 UNC 로 복사하지 않는다 — **출처 폴더(release)** 에서 복사한다.
- Studio 가 새 엔진 기능(새 intent 등)을 쓰면 145 InHouse exe(`Cmb.Cli.exe` 등)가 먼저 교체됐는지 확인한다 — 안 됐으면 사용자에게 알린다.
- 그 Studio 의 화면 확인이 끝났는지 사용자 말에서 확인한다. '눈으로 확인 안 함' 상태면 그 사실을 한 줄 알리고 진행한다(사용자가 이미 결정해서 부른 명령).

## 2. UNC 업로드 (그 버전이 UNC 에 없을 때만)
```powershell
$unc='\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram'
robocopy <출처 release 폴더> $unc <id>-<ver>.zip <id>-<ver>.zip.sha256 /NJH /NJS /NP   # 종료 코드 1 = 복사됨
pwsh -NoProfile -File scripts/verify-studio-zips.ps1 -ViewerId <id>                    # SHA-256·루트 manifest
```

## 3. 표 고치기
```
python scripts/studio_release.py <viewer-id> [<viewer-id> …]            # UNC 최신 정상 zip 으로
python scripts/studio_release.py <viewer-id> --version X.Y.Z            # 지정 버전(롤백 포함)
```
- 바뀐 줄을 그대로 보고에 쓴다. `CHANGED=0` 이면 할 일 없음 — 커밋하지 않고 끝낸다.
- 145 는 표의 버전을 서버 로컬 `StudioProgram\` → UNC 순으로 찾고, 어디에도 없으면 그 Studio 가 404 다(이전 버전으로 넘어가지 않음).
  UNC 가 끊길 때를 대비하려면 145 로컬 `StudioProgram\` 에도 같은 zip 을 복사해 두라고 보고에 적는다.

## 4. 개발 이력 적기 (Update History)
Studio 개발 이력은 따로 파일을 두지 않고 관리자 화면 Update History 의 원본 `HiTessWorkBenchBackEnd/app/changelog/changelog.json` 에 적는다(2026-10-29 결정 — 솔버별 이력처럼 적을 곳이 흩어지면 멈춘다).
**공개할 때만** 적는다 — 70 로컬 빌드(`/deploy`)마다 적지 않는다.
- 범위 = 표의 이전 버전 → 새 버전 사이. 그 Studio 저장소 `git log` 에서 두 버전 커밋 사이를 본다(MB = `ModelBuilderStudio` `model-studio` 브랜치).
- `items` 맨 앞에 한 항목: `{date(공개일), version(Studio 새 버전), studio(viewer id), kind, title, summary, points?}`.
  title 은 `<Studio 이름> <주 변화>`. 중간 버전의 작은 수정은 points 에 `(0.0.122)` 처럼 버전을 붙여 합친다. 145 exe 교체가 함께 필요하면 points 에 한 줄.
- 사용자가 체감할 변화로 쓴다(내부 파일명·함수명 금지), em dash 금지. 롤백이면 적지 않는다.
- 확인: `pytest tests/test_admin_updates.py -q`(HiTessWorkBenchBackEnd/ 에서).

## 5. 커밋·푸시
- `git add HiTessWorkBenchBackEnd/app/studio_release.json HiTessWorkBenchBackEnd/app/changelog/changelog.json` **만**. 다른 변경은 섞지 않는다.
- `git diff --cached --stat` 확인 → 커밋 → `git push`. 메시지(파일로 넘긴다):
```
🚀 studio-release: <viewer-id> <이전> → <새 버전>

- <그 버전에서 사용자가 체감할 변화 한두 줄>
- 배포 영향: 145 Server Manager ⟳ Update(git pull)만 — 재시작·exe 배포 불필요

Co-Authored-By: (이 세션의 attribution 줄)
```

## 6. 보고 (짧게)
- **보고 첫 줄은 항상 이 문장(굵게)**: "**아직 145 에 안 열렸습니다 — 145 Server Manager 에서 ⟳ Update(git pull) 해야 공개됩니다(재시작 불필요).**"
  145 백엔드는 git 의 `studio_release.json` 을 읽으므로, 푸시만으로는 옛 버전이 그대로 뜬다(2026-10-29 사용자가 0.0.121 이 계속 보인다고 물음).
  1단계에서 145 exe 교체가 필요하다고 판단했으면 바로 다음 줄에 "그 전에 145 InHouse `<exe>` 교체"를 순서대로 적는다.
- 커밋 7자리, 바뀐 Studio·버전, UNC 업로드 여부(검증 결과), Update History 에 적은 항목 제목
- ⟳ Update 하면 다음에 Studio 를 여는 사용자부터 새 버전을 받는다(설치본과 버전이 다르면 자동 재설치 — 롤백도 같은 길).
- 롤백: `/studio-release <viewer-id> <이전 버전>`(이전 버전은 이미 UNC 에 있다).
