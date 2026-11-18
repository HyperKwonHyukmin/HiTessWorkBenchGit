# 짝 Studio 싱크 진행 기록

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### 짝 Studio 싱크 — MB·MU 는 한 쌍, 한쪽을 고치면 다른 쪽도 맞춘다 (2026-11-10)

사용자 지시: Model Builder Studio 와 Module Unit Studio 는 한 쌍이라, 한쪽이 개선·수정되면 다른 쪽이 들여올 수 있는 부분은 함께 맞춘다.
절차·싱크 대장·짝을 늘리는 법 = **`docs/standards/studio-pair-sync.md`**. Studio 소스를 고치기 전후로 이 문서를 본다.
- 검사 `python scripts/studio_pair.py`(규칙 `scripts/studio_pair.json`, 지문 `scripts/studio_pair.lock.json`, 시험 `tests/test_studio_pair.py`).
  `same`(내용이 같아야 함, 어긋나면 종료 코드 1 — MB·MU 20개, `data/findEntity.js` 는 MF 까지 세 곳) · `watch`(달라도 되는 짝 87개, 한쪽이 바뀌면 알림 → 판정 후 `--ack <경로>`).
- 전역 훅 `workbench_guard.js` 가 Studio 소스를 Write/Edit 한 직후 그 파일의 짝을 알린다(세션·파일당 한 번). `/deploy` `studio.md` 절차 0번이 빌드 전에 검사를 돌린다. 훅·`/deploy` 는 70 PC 에만 있다.
- 판정(도입함 / 해당 없음 / 보류)은 문서의 싱크 대장에 한 줄(번호가 붙는다). 보류는 `--ack` 하지 않는다. `--ack --all` 은 기준선을 잡을 때만.
- **옮기는 시점(사용자 결정)**: 개발 중에는 대장에 보류로만 적고, 그 Studio 를 145 에 공개한 뒤 묶어서 옮긴다 — **`/studio-sync`**(`.claude/commands/studio-sync.md`:
  인자 없음 = 보류를 추천과 함께 보여 주고 한 번 물음 · 번호나 `all` = 묻지 않고 옮김 · 글 = 대장에 없는 변경). 옮긴 Studio 의 테스트·대장·`--ack`·70 로컬 배포까지, 145 공개·커밋은 안 함.
  옮길 쪽 저장소에 진행 중인 변경이 있으면 멈춘다(두 세션이 한 Studio 를 동시에 고치지 않게). `/studio-release` 보고 끝에 '짝 Studio 싱크: 보류 N건' 안내 줄.
  `same` 파일만은 미루지 않고 고친 자리에서 짝에도 복사한다.
- 묶음은 MB·MU 하나(`mb-mu`)다. 다른 Studio 는 `--scan <id> <id>` 로 훑고 `groups` 에 묶음을 더한다(MU ↔ SP 가 내용 같은 파일 23개로 다음 후보, 미등록).
- 상태(2026-11-10): 기준선 = MB 0.1.8 · MU 0.0.205. 기준선에서 찾은 차이 8건(MU 의 찾기 바 키 가로채기 방지·단면 고정이 MB 에 없음, MB 의 ErrorBoundary 가 MU 에 없음 등)은 대장 1~8번 '보류' 로 남겼고 Studio 코드는 고치지 않았다 —
  MB 개선이 끝나 공개한 뒤 `/studio-sync` 첫 실행으로 처리하기로 함. `/studio-sync` 는 아직 한 번도 실행해 보지 않았다. 미커밋.
  같은 날 다른 세션의 MB 개선(다크 전용 전환·작업 패널을 뷰포트 안에·뷰포트 알림 칩 등, MB 미커밋)이 훅 알림을 받아 대장 9번~ 을 스스로 적었다 — 훅이 실제 세션에서 도는 것은 이것으로 확인.
  그때 검사는 'MB 쪽이 바뀜' 15개(`WATCH_CHANGED`)였다. ⚠ MB 가 다크 전용이 되면 대장 6번(테마 줄만 다른 5파일)은 양쪽을 같은 내용으로 맞출 수 있게 된다 — `/studio-sync` 때 다시 볼 것.
  **`/studio-sync` 첫 실행(2026-11-11)** — 보류 13건 중 12건 처리(도입 11 · 해당 없음 1). 그룹 색은 사용자 결정으로 **MB 방식**(모든 그룹 따로 칠하고 따로 지움, MU 의 '기타' 묶음 폐지).
  `same` 이 33 → 44개(textEntry·useSectionPick·orthoPan·ErrorBoundary·main·도움말 5·groupPalette). 일부러 다른 파일은 `ignore` 에 이유와 함께(`three/rigidClassification.js` — U-bolt 판별 규칙이 다름, `hooks/useFullReset.js` — 지우는 스토어가 다름).
  남은 보류 = 22번(MU 질량 정보 탭 → MB). 남은 일: 장치 파일·대장 커밋 · MU ↔ SP 묶음을 등록할지 사용자 결정.
