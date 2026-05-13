---
name: StageSummaryPanel 리디자인
description: HiTessModelBuilder 해석 모델 검증 패널 전면 재작성 — 폭 넘침 수정, Hero-first 레이아웃, StageTrack 시각화
type: project
---

StageSummaryDetail / PhaseDeltaCard / KvLine / SummaryMetric 전면 재작성 완료.

**Why:** 사용자 피드백 — 정보가 조잡하고 한눈에 안 들어옴, Phase별 변화량 카드가 부모 폭을 벗어남.

**How to apply:**
- Hero 카드에 최종 FEM 4메트릭(노드/요소/RBE2/PM) + 진단 배지(에러/경고/정보) 통합
- 질량 특성: 총 질량 큰 수치 + BEAM/PM 분리 진행 바 + CG 좌표 컴팩트 표시
- StageTrack: 6 stage를 가로 연결선 트랙으로 시각화 (점 색상: 에러=red, 경고=amber, OK=emerald)
- PhaseDeltaCard: 3열 grid 대신 세로 스택 table-fixed 표로 전환 → 폭 절대 안 넘음
  - 변화량(Δ) 표 → 구분선 → 연결성/건전성 2열 grid (각각 table-fixed)
- Stage 상세 섹션은 기본 접힘 토글 (CollapseSection 패턴)
- 폭 제약: `w-full min-w-0 overflow-hidden` 전 레이어 적용, `table-fixed` + `colgroup` style width 사용
- KvRow 헬퍼 추가 (table 내부용), KvLine은 기존 호환 유지
