# 선급 Rule 기반 선체 가속도

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### 선급 Rule 기반 선체 가속도 — 샘플 PDF 는 UNC 평문 (2026-11-16, 미커밋)

145 에서 샘플 실행이 모두 실패했다('PDF 파일을 열 수 없습니다. 회사 DRM…'). 원인은 코드가 아니라 **145 백엔드가 DRM 복호화를 못 받게 된 것**이다.
11-10 16:35 이 마지막 성공이고, 11-12 10:40 재부팅 뒤부터로 추정한다. 그때 성공했던 작업 폴더 PDF 도 지금은 백엔드로 읽으면 `HHIDRMC` 다(70 은 `%PDF`).
145 DRM 복구는 사용자가 진행 중이다. 복구 전에는 DRM PDF **업로드**도 실패할 것으로 본다(시험 안 함). 원격 확인법은 메모리 `reference_145_drm_decrypt_check`.
- 샘플 = `app/routers/analysis.py` `_hull_accel_sample_pdf()`: `.env HULL_ACCEL_SAMPLE_PDF` → 기본 UNC `[개인 자료]\권혁민 책임연구원\UnLock\TS_PDF\3252_TS_7G7000010_FINAL TRIM_STABILITY BOOKLET.pdf` → 없으면 옛 `SampleFile/TS`.
- ⚠ 샘플은 **작업 폴더로 복사하지 않고** 원본 경로를 엔진에 넘긴다. 백엔드가 `userConnection` 에 `.pdf` 로 쓰면 평문이어도 DRM 이 다시 감싼다(70 실측). 재실행도 샘플이면 UNC 를 그대로 쓴다(`_is_hull_accel_sample_pdf`).
- 미리보기 제원 쪽 = 세 낱말이 한 쪽에 있으면 그 쪽, 없으면 치수 쪽과 Lightship·Deadweight 쪽을 따로(3252 는 7·8쪽). UnLock 폴더 TS 7개 중 H3592s, H3606 은 제원 쪽을 못 찾는다(예전과 같음).
- 시험 `tests/test_hull_acceleration_sample_pdf.py`. 엔진 직접 실행(UNC, 6초, Condition 31개)과 미리보기 함수 직접 호출까지 확인. 70 서버가 코드를 다시 읽지 않아 API 를 거친 실행은 안 봄.
- 반영 = 145 `git pull + 재시작`, InHouse·exe 변경 없음.
