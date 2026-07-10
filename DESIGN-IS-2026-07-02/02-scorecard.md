# 02 — 점수표 (Scorecard)

Dieter Rams 10원칙, 각 0–3점. 동점 시 낮은 쪽, 최악 인스턴스 기준, 가중치 없음. (근거는 `01-evidence.md` 참조)

1. **Good design is innovative — 2/3**
   Evidence: dev-status 게이팅(1261)·화면높이 맞춤 행 숨김(1858–1864)·로드맵을 1급 시민으로 배치 등 기성 패턴의 명확한 개선. 근본적 신규 상호작용은 없음(사이드바+히어로+스탯카드+표).
   Justification: 경쟁 대비 개선이 뚜렷하나 새 패턴 창출은 아니어서 "기성 패턴 개선(2)"이지 "5+ 제품에 없는 패턴(3)"은 아님.

2. **Good design makes it useful — 2/3**
   Evidence: 도구 실행 진입점 6~7개로 허브 역할 충실(즐겨찾기/검색/로드맵/인기/팔레트). 그러나 프로젝트 이력 표 행이 **비클릭**(ProjectRow 273–295) — JTBD의 "결과 확인·다운로드"를 대시보드에서 바로 못 하고 My Projects로 우회.
   Justification: 주작업(도구 진입)은 최소 단계지만 결과 확인이 인접 화면으로 이탈 → 앵커 "인접 화면이 단계 추가(2)".

3. **Good design is aesthetic — 3/3**
   Evidence: 카드 반경·slate-200 테두리·shadow-sm·navy 브랜드·의미색 체계가 단일 시스템으로 렌더(스크린샷). 고아 스타일 없음, 레거시 회색폼 안티레퍼런스 완전 탈피.
   Justification: 간격/타이포/색이 보이는 단일 체계를 따르고 눈에 띄는 위반 없음 → 3.

4. **Good design makes it understandable — 2/3**
   Evidence: 섹션 아이콘+라벨로 구조 명확하나, 인기프로그램·이력 표가 코드키("GroupModuleUnit"·"HiTessModelBuilder", 1480/1670/1855) 노출 → 로드맵의 사람이 읽는 타이틀과 이름 불일치로 초심자 매핑 곤란. 히어로 접속IP/연결서버 타일 가치 불명.
   Justification: 대부분 자명하나 코드네임 불일치가 1급 개체 식별을 방해 → "일부 불명확(2)".

5. **Good design is unobtrusive — 2/3**
   Evidence: 전반적으로 크롬은 조용하고 데이터가 주인공. 그러나 navy 히어로가 가장 무겁고 저가치 진단 타일 2개 + 장식 eyebrow/아이콘이 크롬 비중을 키움.
   Justification: 크롬이 보이되 과하진 않음 → "보이지만 조용(2)".

6. **Good design is honest — 3/3**
   Evidence: 전 지표 라이브 API, 정직한 empty/error/loading 문구, 다크패턴 0, NEW 배지 실제 미읽음 계산(612/668). 유일 수사 "차세대…"는 실제 레거시 탈피 목적으로 방어 가능.
   Justification: 모든 배지·상태·수치가 동작과 1:1, 기만 흐름 없음 → 3(“차세대”는 감시 항목).

7. **Good design is long-lasting — 2/3**
   Evidence: 대체로 시대 초월적 절제(과한 글래스모피즘·유행 그라데이션 콘텐츠 없음). 다만 대문자 영문 eyebrow "ENGINEERING CONTROL ROOM"(1332)와 상시 pulse/ping 점(238/670)이 현시점 SaaS 트렌드 마커.
   Justification: 2개의 경미한 유행 마커 → 앵커 "1~2개 dated marker" 하단 = 2.

8. **Good design is thorough — 3/3**
   Evidence: empty(1712/1847/1492)·loading(스켈레톤 1453/1644, 스피너 1827)·error+재시도(1457/1648/1831)·success(상태배지)·focus(focus-visible 광범위)·disabled(순서편집 화살표 129/138) **6종 상태 완비** + reduced-motion 대응(index.css 139).
   Justification: 여섯 상태 모두 존재·배려됨 → 3(대비·코드네임은 #4/#9에서 감점).

9. **Good design is environmentally friendly — 2/3**
   Evidence: 대시보드 초기 ~712KB(비압축, gzip ~220–250KB 추정), 무거운 three/charts는 미로드(lazy), 모달 lazy 분할. reduced-motion 준수·폴링 document.hidden 가드(양호). 그러나 상시 유휴 애니메이션 2종 + 3초 큐 폴링.
   Justification: gzip <500KB·모션 게이팅 수준이나 상시 모션·폴링 존재 → 2.

10. **Good design is as little design as possible — 2/3**
    Evidence: 대부분 요소가 제 몫을 하나, 히어로 4타일 중 접속IP/연결서버 2개는 저가치(진단은 헤더 서버칩·진단모달에 이미 존재), 장식 eyebrow, 도구 진입 경로 6~7개 중복.
    Justification: 제거 가능 요소 ≤2류(히어로 저가치 타일·eyebrow) → 2.

---

## 합계: **23 / 30**

| # | 원칙 | 점수 |
|---|------|------|
| 1 | Innovative | 2 |
| 2 | Useful | 2 |
| 3 | Aesthetic | 3 |
| 4 | Understandable | 2 |
| 5 | Unobtrusive | 2 |
| 6 | Honest | 3 |
| 7 | Long-lasting | 2 |
| 8 | Thorough | 3 |
| 9 | Environmentally friendly | 2 |
| 10 | As little design as possible | 2 |
| **합계** | | **23/30** |
