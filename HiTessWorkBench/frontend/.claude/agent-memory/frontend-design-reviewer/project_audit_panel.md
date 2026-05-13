---
name: CsvAuditPanel 리디자인
description: HiTessModelBuilder CsvAuditPanel v3 전면 재작성 — 사용자 피드백(조잡함, 한눈에 안 보임) 반영
type: project
---

## 완료 상태 (2026-04-30, v3)

사용자 피드백: "정보가 너무 조잡해서 한눈에 들어오지 않는다, 어떻게 변환됐는지 한눈에 확인되어야 한다."

## 확정된 디자인 결정

### A. Hero 변환 요약 카드 (항상 노출)
- SVG 원형 게이지(donut 64px) + 3열 핵심 수치(전체/변환/제외) text-2xl font-bold
- 변환률 색상: emerald(정상) / amber(제외 있음) / red(실패)
- CollapseSection 없이 최상단 항상 노출

### B. KindBar 컴포넌트 (파일별 처리 현황 3열 카드)
- 스택 진행 바: emerald(변환) / amber(제외) / red(실패) 세그먼트
- 수치 text-2xl + 인라인 범례 + font-mono 파일명

### C. IgnoreReasonRow 컴포넌트 (제외 사유 분포)
- ignoredByReason 항목만. ambiguousDuplicateSourceNameRows 완전 제거
- 수평 막대 + 수치 정렬, amber 카드 배경

### D. 행 단위 감사 (기본 접힘)
- ChevronDown 토글, FilterPills text-xs 통일
- 테이블 본문 text-xs (이전 text-[9px]/[10px] 제거)

## 제거된 것들
- CollapseSection 컴포넌트 (남발 제거)
- showFiles / showReasons state + 입력 CSV 헤더 테이블 섹션 전체
- ambiguousDuplicateSourceNameRows 관련 모든 표시·문구

**Why:** 구조 해석 엔지니어는 빠른 스캔이 목적 — 숫자 임팩트와 시각적 비율이 세부 테이블보다 우선.

**How to apply:** 이후 결과 패널 설계 시 Hero → 카드형 비율 시각화 → 상세 접힘 순서 유지.
