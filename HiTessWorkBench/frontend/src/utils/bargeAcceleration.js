export const DEFAULT_BARGE_ACCEL_INPUT = Object.freeze({
  significantWaveHeightM: 2,
  criticalDampingPct: 3,
  cargoPosition: 'single-center',
  cargoWeightT: 207.7,
  cargoVcgFromBottomM: 1.2,
  bargeDepthM: 4.5,
  supportHeightM: 3.4,
  loadCase: 'LC1',
});

/**
 * 백엔드 `module_ocean_acceleration.LOAD_CASE_SIGNS` 와 **같은 순서·같은 부호**여야 한다.
 *
 * ⚠ LC1~4 는 x=±, z=± 를 훑으면서 y 가 항상 + 라 그 자체로는 포락이 아니다.
 *   모듈·정반 배치가 좌우 대칭이 아니므로 −Y 를 빼면 지배 Leg 를 놓친다
 *   (실측 3521·정반 B: +Y 는 Leg 2, −Y 는 Leg 7 지배 / 용접 114.9 → 117.6 MPa).
 *   LC5~8 이 그 −Y 쌍이다.
 */
export const BARGE_LOAD_CASES = Object.freeze([
  { id: 'LC1', signs: '++−', description: '+X · +Y · −Z' },
  { id: 'LC2', signs: '−+−', description: '−X · +Y · −Z' },
  { id: 'LC3', signs: '+++', description: '+X · +Y · +Z' },
  { id: 'LC4', signs: '−++', description: '−X · +Y · +Z' },
  { id: 'LC5', signs: '+−−', description: '+X · −Y · −Z' },
  { id: 'LC6', signs: '−−−', description: '−X · −Y · −Z' },
  { id: 'LC7', signs: '+−+', description: '+X · −Y · +Z' },
  { id: 'LC8', signs: '−−+', description: '−X · −Y · +Z' },
]);

/** 기본 포락 집합 = 8개 전부. 부분 집합은 사용자의 선택이지 기본값이 아니다. */
export const DEFAULT_ENVELOPE_LOAD_CASES = Object.freeze(
  BARGE_LOAD_CASES.map(item => item.id),
);

const INPUT_KEYS = [
  'significantWaveHeightM', 'criticalDampingPct', 'cargoPosition',
  'cargoWeightT', 'cargoVcgFromBottomM', 'bargeDepthM',
  'supportHeightM', 'loadCase',
];

/** 입력이 바뀐 뒤 예전 계산 결과를 구조 해석에 쓰지 않기 위한 안정 키. */
export function bargeAccelerationInputKey(input) {
  return JSON.stringify(INPUT_KEYS.map(key => input?.[key]));
}

function displayNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  return number.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/**
 * Excel 원시표가 보간을 보증하는 범위를 벗어난 입력을 구체적인 사용자 문장으로 반환한다.
 * 범위 밖 값을 임의로 하한/상한에 고정하면 다른 운송 조건을 해석하게 되므로 자동 보정하지 않는다.
 */
export function getBargeAccelerationInputIssues(input) {
  const issues = [];
  const hs = Number(input?.significantWaveHeightM);
  const cargoWeight = Number(input?.cargoWeightT);
  const vcgParts = [
    Number(input?.cargoVcgFromBottomM),
    Number(input?.bargeDepthM),
    Number(input?.supportHeightM),
  ];
  const baselineVcg = vcgParts.reduce((sum, value) => sum + value, 0);

  if (!Number.isFinite(hs)) {
    issues.push({ field: 'significantWaveHeightM', message: '유의파고 Hs에 숫자를 입력하세요.' });
  } else if (hs < 1 || hs > 3) {
    issues.push({
      field: 'significantWaveHeightM',
      message: `유의파고 Hs ${displayNumber(hs)} m는 Excel 계산 범위 1~3 m보다 ${hs < 1 ? '작습니다' : '큽니다'}.`,
    });
  }

  if (!Number.isFinite(cargoWeight)) {
    issues.push({ field: 'cargoWeightT', message: '화물 총중량에 숫자를 입력하세요.' });
  } else if (cargoWeight < 50 || cargoWeight > 1200) {
    issues.push({
      field: 'cargoWeightT',
      message: `화물 총중량 ${displayNumber(cargoWeight)} ton은 Excel 계산 범위 50~1,200 ton보다 ${cargoWeight < 50 ? '작습니다' : '큽니다'}.`,
    });
  }

  if (!vcgParts.every(Number.isFinite)) {
    issues.push({
      field: 'cargoVcgFromBaselineM',
      message: '화물 VCG, Barge Depth, Support Height에 숫자를 입력하세요.',
    });
  } else if (baselineVcg < 3 || baselineVcg > 25) {
    issues.push({
      field: 'cargoVcgFromBaselineM',
      message: `Barge baseline 기준 화물 VCG ${displayNumber(baselineVcg)} m는 Excel 계산 범위 3~25 m보다 ${baselineVcg < 3 ? '작습니다' : '큽니다'}.`,
    });
  }

  return issues;
}

/**
 * 2단계의 정반 + Unit **스택 전체**를 Excel 의 '화물' 로 보고 입력값을 만든다.
 *
 * ★ 2026-09-14 — 기준을 정합시켰다(사용자 결정).
 *   예전에는 중량은 `정반 + Unit`(실측 142.2 t)인데 VCG 는 `Unit 자체`(Unit 바닥 기준)라
 *   **두 값의 기준이 서로 달랐다.** 정반이 질량의 88%(125.8 t, COG z=4,986)를 차지하므로
 *   합산 무게중심보다 훨씬 높은 VCG 가 표에 들어가 가속도가 과대 계산됐다
 *   (실측 baseline VCG 17.65 m → ay +0.3198 g).
 *
 *   '화물' 이 스택 전체라는 근거: 표의 DWT 축 범위가 50~1,200 t 이라 Unit 만(16.4 t)으로는
 *   계산 자체가 성립하지 않는다. 그래서 셋을 한 기준으로 맞춘다.
 *     · 중량      = 정반 + Unit 합산
 *     · VCG       = **합산 무게중심** 의 정반 바닥 기준 높이
 *     · Support   = 0 — 정반이 곧 화물이라 그 아래 받침이 따로 없다
 *   결과: baseline VCG 10.13 m → ay +0.1965 g (실측, 종전 대비 −38%).
 *
 * @param {{unitBottomZMm:number, deckBottomZMm:number}} [stack] 배치 결과.
 *        정반 바닥(deckBottomZMm)이 곧 화물 바닥이다. 없으면 중량만 가져온다.
 */
export function moduleCargoAccelerationInputs(moduleModel, massForAnalysis, stack) {
  if (!massForAnalysis?.includes?.deck || !massForAnalysis?.includes?.module) return null;
  const mass = Number(massForAnalysis?.total?.massTon);
  const totalCogZMm = Number(massForAnalysis?.total?.cogMm?.z);
  if (!Number.isFinite(mass) || mass <= 0) return null;

  const out = { cargoWeightT: Number(mass.toFixed(4)) };

  // 화물 바닥 = 정반 최하단. 배치가 없으면 이 기준을 세울 수 없으므로 VCG 는 건드리지 않는다
  // — 잘못된 기준으로 덮어쓰느니 사용자가 입력한 값을 그대로 두는 편이 낫다.
  const deckBottomZMm = Number(stack?.deckBottomZMm);
  if (Number.isFinite(deckBottomZMm) && Number.isFinite(totalCogZMm)) {
    const vcgM = (totalCogZMm - deckBottomZMm) / 1000;
    if (vcgM >= 0) {
      out.cargoVcgFromBottomM = Number(vcgM.toFixed(4));
      // 화물(=스택) 아래에 별도 받침이 없다. baseline VCG = bargeDepth + 0 + 화물 VCG.
      out.supportHeightM = 0;
    }
  }
  return out;
}
