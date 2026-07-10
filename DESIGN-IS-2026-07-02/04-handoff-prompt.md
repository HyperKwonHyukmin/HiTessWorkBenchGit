# 04 — /make-plan 핸드오프

아래 프롬프트 하나를 그대로 복사해 `/make-plan`에 넣으면 다음 세션이 이 감사 없이도 자족적으로 계획을 세울 수 있다.

````
/make-plan HiTESS WorkBench 대시보드를 Dieter Rams 감사(합계 23/30) 기반으로 개선(REFINE)한다. 대상 파일: HiTessWorkBench/frontend/src/pages/dashboard/Dashboard.jsx (+ DashboardContext.jsx, components/DashboardFab.jsx).

판정(03-verdict.md 인용):
> 합계 23/30으로 뼈대가 견고하다 — 일관된 시각 시스템(#3), 정직한 라이브 데이터(#6), 6종 상태·reduced-motion까지 갖춘 꼼꼼함(#8). 재설계가 아니라 표면적 정밀 다듬기로 30에 근접할 수 있다.

보존(이미 3점 — 이번 패스에서 손대지 말 것):
- #3 미학: 카드 반경/slate-200 테두리/shadow-sm/navy 브랜드/의미색 단일 시스템. 회귀 점검: Dashboard.jsx의 DASHBOARD_CARD_BASE(39) 및 카드 클래스가 그대로인지 grep.
- #6 정직: 모든 지표 라이브 API. 회귀 점검: getQueueStatus/getTopPrograms/getAnalysisHistory/getNotices 호출과 실데이터 렌더가 유지되는지.
- #8 꼼꼼함: empty/loading/error/success/focus/disabled 6종 상태. 회귀 점검: 스켈레톤(1453,1644)·에러+재시도(1457,1648,1831)·빈상태(1712,1847)·focus-visible 링이 유지되는지.

우선순위 수정(감사 상위 5개, 원문 그대로):
1. [#4 이해가능성] 인기 해석 프로그램·프로젝트 이력 표의 program_name 코드키(GroupModuleUnit, HiTessModelBuilder, MooringFitting)를 사람이 읽는 앱 타이틀로 매핑 표시. 기존 findAppByProgramName 활용. 근거: Dashboard.jsx:1480, 1670, 1855.
2. [#2 유용성] 프로젝트 이력 행을 클릭 가능하게 만들어 해당 해석 결과 뷰어/재진입으로 연결(현재 비클릭, "전체 이력 보기"만 가능). 근거: Dashboard.jsx:273–295.
3. [#4/#8 접근성] 저대비 muted 텍스트 상향: slate-400 본문(표 ID열 277, "최근 5건…" 힌트 1802, "자료" 라벨 1529)은 2.4–2.6:1, text-blue-500 링크(1805)는 3.68:1 → slate-500/600·blue-600으로. 목표 본문 ≥4.5:1.
4. [#5/#7/#10 절제] 히어로 다이어트: 4타일 중 저가치 접속IP/연결서버 축소·통합(진단은 헤더 서버칩·진단모달에 이미 존재), 영문 대문자 eyebrow "ENGINEERING CONTROL ROOM" 재검토. 근거: Dashboard.jsx:1330–1364; PRODUCT.md Anti-references.
5. [#9 자원] 상시 유휴 애니메이션 2종(online animate-pulse 238, 공지 animate-ping 670)과 3초 큐 폴링(pollingPolicy.systemIntervalMs=3000) 필요성 재검토. document.hidden 가드·reduced-motion은 유지.

이번 REFINE 패스 비대상: 정보구조 전면 재편, 사이드바 구조 변경, 카드/토큰 시각 시스템 재작성.

계획 산출물:
- 수정별: 대상 파일·정확한 변경·검증 단계(라이브 localhost:5173에서 시각 확인 + 대비 재측정).
- 토큰/스펙 변경은 한곳에 통합.
- "보존" 3개 항목 회귀 체크리스트.

REFINE 안티패턴 경계:
- 직접 수정이면 될 곳에 새 추상화 추가 금지.
- 이미 3점인 영역 재스타일링 금지.
- 구조 재설계로 범위 확장 금지(그건 별도 REDESIGN).
- 우선순위 밖 원칙을 변형시키지 말 것.
````
