# D Type Lug Assessment

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### D Type Lug Assessment — Bracket 형식 선택 · W1'·W2' 0 고정 (2026-10-30, v1.6.32)

엔진 = `WorkBenchSubModule/D_TypeLugCalculation`(Python, 별도 git, 기여 김연태) → `InHouseProgram/D_TypeLugCalculation/D_TypeLugCalculation.exe`(git 미추적). 엔진은 **세 형식을 한 번에** 계산한다.
- 화면(`pages/analysis/DTypeLugAssessment.jsx`, 규칙 `utils/dTypeLug.js`+테스트): 입력 맨 위 형식 선택 → E 단면 그림 교체, 결과는 고른 형식 기준(다른 두 형식은 한 줄 비교, 바꿔도 재계산 없음).
  형식 대응: 4EA = `bracket_4EA` · **2EA Opposite side = `bracket_2EA_double`**(양면, 대칭) · **2EA Same side = `bracket_2EA_single`**(단면, 비대칭). 그림 원본 = 엔진 저장소 `Figure/`.
- ⚠ **W1'·W2' 는 입력 칸 없이 항상 0 을 보낸다(사용자 결정).** 엔진 목두께 = (W+W')/√2 라 Excel 기본값(W1'=12)과 E 단면 결과가 다르다 —
  기본값에서 4EA 0.60→0.98, 2EA Opposite 0.89→**1.47 실패**, Same 0.87→**1.42 실패**(나머지 단면·입력은 같음, exe 로 확인). 그래서 단추 이름이 '기본값으로'('Excel' 을 뺌).
  W1·W2 가 둘 다 0 이면 엔진이 0 으로 나누므로 화면(`weldError`)과 라우터(422)가 막는다.
- 요청의 `bracket_type`(선택값) 은 `input_info` 에만 기록하고 엔진 입력(input.json)에는 넣지 않는다(`test_d_type_lug_bracket_type.py`).
- 헤더는 다른 Parametric 앱과 같은 에메랄드 그라데이션, 안쪽 강조(계산 버튼·형식 선택·'지배')는 Trust Blue(사용자 결정 — 판정 초록과 구분).
- 상태: 커밋 `d1aab40` · 릴리스 1.6.32(`a436e0a`) 푸시·exe 빌드. **145 ⟳ Update + 재시작**(라우터 스키마) · exe 배포는 사용자. 화면은 눈으로 확인 안 함.
  남은 후보: 입력 프리셋(`PresetPicker`)·배치 실행(2026-09-18 계획의 후속) 미부착.
