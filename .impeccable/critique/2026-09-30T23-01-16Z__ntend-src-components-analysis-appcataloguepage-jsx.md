---
target: File-Based Apps 카드 디자인 재검토
total_score: 27
p0_count: 0
p1_count: 2
timestamp: 2026-09-30T23-01-16Z
slug: ntend-src-components-analysis-appcataloguepage-jsx
---
# File-Based Apps 카드 디자인 재검토 (2026-10-01)

대상: 개편된 카드(AppCard.jsx) + AppCataloguePage.jsx. 기준: 공학 엔지니어링 도구로서의 UI·UX·가시성·심미성.

## 휴리스틱 27/40
상태 3 · 현실 일치 3 · 제어 3 · 일관성 3 · 오류 예방 3 · 재인 2 · 효율 3 · 미니멀 2 · 오류 복구 3 · 도움말 2

## 안티패턴
- detect.mjs: 1건(AppCard.jsx:18 violet→fuchsia 그라데이션 윗줄, Interactive 모드 색).
- LLM: 동일 크기 카드 격자 + 카드마다 같은 아이콘. 앱 스토어식 소비자 UI 문법.

## 우선 과제
- [P1] 카드에서 가장 눈에 띄는 요소(44px 파란 아이콘)가 모든 카드에서 같아 정보가 없다.
- [P1] 입력·출력이 넷째 구역 회색 상자 안 11.5px 칩이라 가장 중요한 정보가 가장 약하다.
- [P2] 카테고리가 카드 아래 12px 회색 글자로 밀려 분류가 보이지 않는다.
- [P2] 장식 층(색 번짐·그라데이션 윗줄·큰 그림자·16px 둥근 모서리)이 계측·해석 도구보다 소비자 앱에 가깝다.
- [P2] '열기 →' 가 카드마다 반복된다(카드 전체가 버튼).
- [P3] 꺼진 별(slate-400) 대비 2.56:1, 입력 포맷 안내·샘플 실행 진입점 없음.

## 대안(시안: outputs/catalogue-card-review/index.html)
A 데이터시트 카드(추천) · B 공정 흐름도 · C 목록 + 상세 패널
