---
name: mooring-fitting-redesign
description: MooringFittingAssessment.jsx — HiTessModelBuilder 패턴 기준으로 2차 재디자인 완료
metadata:
  type: project
---

MooringFittingAssessment.jsx 를 HiTessModelBuilder.jsx 의 시각 패턴으로 2차 전면 재디자인했습니다.

**Why:** 1차는 TrussAnalysis 패턴 기준이었지만, 사용자가 이번에 HiTessModelBuilder 를 기준 레퍼런스로 변경 지정.

**HiTessModelBuilder 일치 항목:**
- 레이아웃: `w-80 shrink-0` 좌측 사이드바 + `flex-1 min-w-0 overflow-y-auto` 우측 메인 (HiTessModelBuilder 동일 비율)
- 파이프라인 스텝퍼: 도트(w-4 h-4 rounded-full) + 세로 연결선(bg-blue-300) + 클릭 가능한 스텝 카드(border-blue-500 bg-blue-50 선택 활성)
- 실행 버튼: `bg-blue-600 hover:bg-blue-700` + `Loader2 animate-spin` + 경과 시간 표시
- "다음 단계 보기" 버튼: `border border-blue-200 bg-blue-50 hover:bg-blue-100` 스타일
- "전체 초기화" 버튼: `hover:bg-red-50 hover:border-red-300 hover:text-red-600` 스타일
- ProgressBar: 독립 컴포넌트, `h-1.5 rounded-full bg-slate-100` 트랙
- CSV 입력 카드: `CsvDropZone` 룩앤필 (헤더/바디 분리, 상태별 아이콘)
- 엔진 로그: `border border-red-200 bg-red-50` 카드에 `<pre>` + AlertTriangle 아이콘
- PageBanner: `gradient="from-brand-blue via-brand-blue-dark to-blue-700"` + 뒤로가기 버튼 동일

**Mooring 고유 UI (HiTessModelBuilder 와 다른 부분):**
- CSV 2개 (Structure + Load) — 3개(stru/pipe/equip)가 아닌 2개
- `classifyAndAssign` 분류 로직: 파일명 `load` 포함 여부로 분류
- 스텝 3개 (파이프라인 진행 / 핵심 산출물 5종 / 전체 8단계 파일) — HiTessModelBuilder 의 csv-validation/model-qc/nastran 와 다른 내용
- 8단계 파이프라인 시각화 그리드 (PipelineStageGrid)
- 핵심 산출물 5개 카드 (final_bdf/validation_json/lineage_json/report_mf_csv/report_winch_csv)

**How to apply:** HiTessModelBuilder 스타일로 통일이 필요한 File-Based 신규 페이지는 이 패턴을 레퍼런스로 활용.
