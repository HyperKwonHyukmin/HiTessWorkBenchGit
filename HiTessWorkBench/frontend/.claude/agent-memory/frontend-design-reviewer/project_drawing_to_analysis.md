---
name: drawing-to-analysis-redesign
description: DrawingToAnalysis 페이지 전체 레이아웃 개선 — 사이드바 통합, 진행률 패널 조건 정리, 완료 헤더 정보 밀도 향상
metadata:
  type: project
---

## 적용된 변경 사항 (2026-05-28)

### A. 사이드바 입력 카드 통합
- **기존**: 카탈로그 카드(보라 헤더) + 업로드 카드(파랑 헤더) 두 개 분리 → 각각 `rounded-2xl` + colored header strip
- **변경**: 하나의 `bg-white rounded-2xl` 카드 안에 colored dot(보라/파랑) + 구분선으로 두 섹션을 통합
- **이유**: 카드 2개가 각각 헤더 strip을 가지면 시각적 무게가 과도함. 단일 카드로 압축하면 사이드바 스크롤 부담 감소
- 사이드바 폭 360px → 340px 조정

### B. 중복 초기화 버튼 제거 + disabled 처리 추가
- 사이드바 내 별도 초기화 버튼 제거 (PageBanner 우측 버튼으로 일원화)
- PageBanner 초기화 버튼에 `disabled={isRunning}` 추가 (기존에 없었음)

### C. 진행률 패널 조건 수정
- **기존**: `{(isRunning || statusMessage) && ...}` — 완료 후 statusMessage='변환 완료' 라 패널이 잔존
- **변경**: `{isRunning && ...}` — 실행 중일 때만 표시, 불필요한 상태 잔존 제거
- 진행률 바 두께 h-1 → h-1.5, 파란 스피너 아이콘 추가

### D. 변환 완료 헤더 정보 밀도 향상
- 기존: 아이콘 + "변환 완료" + 작은 설명 텍스트 + 다운로드 버튼
- 변경: emerald 그라데이션 배경 추가 / ID 배지(slate-100 rounded) / mode 배지(lug=blue, support=indigo) / 설명 텍스트에 파라미터 편집 힌트 포함

### E. 빈 상태 개선
- 2-열 힌트 카드(카탈로그 | 직접 업로드) 추가 — 처음 사용자 진입 경로 명확화

### F. DrawingParamsPanel 소폭 조정
- 헤더에 오류 개수 배지(rose) + mode 배지(blue/indigo) 인라인 표시
- 입력 필드 너비 w-20 → w-[72px], 패딩 py-1.5 → py-1 — 340px 사이드바 최적화
- 힌트 텍스트 슬림화

## 디자인 패턴 메모
- 두 기능(카탈로그/업로드)을 colored dot + 구분선으로 묶는 패턴은 향후 유사 이중 입력 카드에도 재사용 가능
- 완료 헤더의 emerald 그라데이션(from-emerald-50 to-white) + mode/ID 배지 조합은 [[TrussAssessment]] 결과 헤더와 동일 패턴으로 맞춤
