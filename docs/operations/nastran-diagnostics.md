# 해석 오류 유형 기록 · 반복 오류 대응 절차

도입 2026-10-02. 목적: 같은 해석 오류가 반복되지 않게, 실제로 난 오류를 모아 코드로 하나씩 막아 간다.
완전한 무오류가 아니라 **"한 번 난 오류 유형은 다시 사용자에게 가지 않게"**가 목표다.

## 구성

| 위치 | 역할 |
|---|---|
| `app/services/nastran_diagnostics.py` | 작업 종료 시 수집 — F06 FATAL/WARNING + Nastran 전 단계 실패(엔진 로그) |
| `analysis_runner.mark_complete()` · `hitess_modelflow_service` 편집 적용 | 수집 호출 지점(백그라운드 스레드, 실패해도 해석 결과에 영향 없음) |
| DB `diagnostic_signatures` / `diagnostic_occurrences` | 오류 **유형**(지문) / 실제 **발생** 1건씩 |
| `DataStorage/DiagnosticsArchive/cases/` | **처음 보는 유형(또는 처리 후 재발)일 때만** 입력 BDF·F06 발췌·엔진 로그·meta.json 보관. 30일 정리 대상 아님 |
| `GET/PATCH /api/admin/diagnostics…` | 관리자 조회·재현 자료 zip·대응 결과 표시 |
| `scripts/backfill_diagnostics.py` | 배포 직후 1회 — userConnection 에 남은 최근 30일치를 소급 수집(재실행 안전) |
| `scripts/pull_diagnostics.py` | 개발 PC(70)에서 운영(145) 기록·재현 자료를 가져오고, 대응 결과를 표시 |

## 유형(지문) 규칙 — 바꿀 때 주의

- Nastran 메시지는 **코드 + 모듈**(예 `307 (IFPDRV)`)로 묶는다. 본문으로 묶으면 카드 이름·ID·에코 줄 때문에
  한 원인이 수십 유형으로 갈라진다(실측: 3542_m09 한 건 → 40유형). 본문은 대표 메시지·발생별 메시지로 남는다.
- 같은 F06 에 원인 FATAL 이 있으면 연쇄 코드(`6498 6624 9002 208 102`, 경고 `285`)는 세지 않는다.
- 엔진 실패(level=engine)는 정규화 본문 + App 이름으로 묶는다. 취소·서버 재시작 중단은 세지 않는다.
- F06 은 **작업 시작~끝 사이**에 쓰인 것만 그 작업 것이다. 권상 계열은 부모 GMU 폴더를 같이 써서, 끝 상한
  (실시간 = 지금, 소급 = 기록 updated_at + 10초)이 없으면 다음 작업의 F06 을 가져간다(실측 오귀속).
- 기록에 경로가 없는 작업: UnitStructural 은 `parent_analysis_id` 로 부모 폴더를, 편집 적용은 호출자가 산출 폴더를 준다.
- 경고는 세기만 하고 재현 자료는 남기지 않는다(사용자 결정: 새로운 **오류**가 난 BDF 만 모은다).

## 운영 반영(145)

`git pull` + 백엔드 재시작이면 표가 생기고 수집이 시작된다. 이어서 1회:

```
WorkBenchEnv\Scripts\python.exe scripts\backfill_diagnostics.py --dry-run   # 집계만 확인
WorkBenchEnv\Scripts\python.exe scripts\backfill_diagnostics.py             # 소급 수집
```

끄기: 환경변수 `HITESS_DIAGNOSTICS=0`. 보관 위치 바꾸기: `DIAGNOSTICS_ARCHIVE_DIR`.

## 대응 절차(개발 PC 70)

1. `scripts\pull_diagnostics.py --employee <관리자 사번> pull` → `DataStorage/DiagnosticsPull/<시각>/summary.md`
2. 많이 난 순·재발(regressed) 우선으로 고른다. `<지문>/case/` 의 BDF 로 재현한다(로컬 Nastran).
3. 막는 층을 고른다 — 앞쪽일수록 좋다.
   1) 원인 문구(사용자가 무엇을 고칠지 알게) — 예 `unit_structural_service.describe_f06_fatal`
   2) 검증 단계 사전 감지 — 예 `bdf_deck_check` 규칙 추가
   3) 사용자 확인 후 자동 수정 — 예 GMU 'BDF 자동 수정 후 다시 검증'
   4) BDF 를 쓰는 코드에서 원천 차단 — 예 nastran_bridge `bulk_start_index`
4. 재현 BDF(필요하면 축소)를 회귀 테스트로 넣는다. 오탐은 `userConnection/**/*.bdf` 전수 스캔으로 확인.
5. 배포 후 `pull_diagnostics.py mark --fingerprint … --status handled --note "<무엇으로·버전>"`.
   같은 유형이 다시 나면 수집기가 `regressed` 로 되돌리고 그 사례를 다시 보관한다.

모델 자체 문제(떨어진 그룹 → 9050 Mechanism 등)는 자동 수정 대상이 아니다 — 검증 단계에서 미리 잡아
이유를 설명하는 데까지(1·2층)를 목표로 한다.
