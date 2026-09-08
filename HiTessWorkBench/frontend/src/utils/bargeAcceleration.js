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

export const BARGE_LOAD_CASES = Object.freeze([
  { id: 'LC1', signs: '++−', description: '+X · +Y · −Z' },
  { id: 'LC2', signs: '−+−', description: '−X · +Y · −Z' },
  { id: 'LC3', signs: '+++', description: '+X · +Y · +Z' },
  { id: 'LC4', signs: '−++', description: '−X · +Y · +Z' },
]);

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
 * 2단계의 정반 + Unit 합산 중량 · Unit 바닥 기준 VCG · 적치 높이를 Excel 입력 형식으로 바꾼다.
 * 합산 여부를 함수 안에서 확인해 호출부가 Unit 중량만 잘못 넘기는 회귀를 막는다.
 *
 * Support Height 는 **바지 갑판(=정반 최하단)에서 Unit 최하단까지**다. 2단 정반에서는
 * 어느 적치면에 앉느냐로 이 높이가 6m 넘게 달라지므로 배치에서 직접 읽어 온다 —
 * 사용자가 손으로 맞추게 두면 baseline VCG 가 통째로 어긋난다.
 *
 * @param {{unitBottomZMm:number, deckBottomZMm:number}} [stack] 배치 결과. 없으면
 *        Support Height 는 손대지 않는다(중량·VCG 만 가져온다).
 */
export function moduleCargoAccelerationInputs(moduleModel, massForAnalysis, stack) {
  if (!massForAnalysis?.includes?.deck || !massForAnalysis?.includes?.module) return null;
  const mass = Number(massForAnalysis?.total?.massTon);
  const bottomZMm = Number(moduleModel?.bounds?.min?.[2]);
  const cogZMm = Number(moduleModel?.massProperties?.centerOfGravityMm?.z);
  if (![mass, bottomZMm, cogZMm].every(Number.isFinite) || mass <= 0) return null;
  const vcgM = (cogZMm - bottomZMm) / 1000;
  if (!Number.isFinite(vcgM) || vcgM < 0) return null;

  const out = {
    cargoWeightT: Number(mass.toFixed(4)),
    cargoVcgFromBottomM: Number(vcgM.toFixed(4)),
  };

  const unitBottom = Number(stack?.unitBottomZMm);
  const deckBottom = Number(stack?.deckBottomZMm);
  if ([unitBottom, deckBottom].every(Number.isFinite)) {
    const supportM = (unitBottom - deckBottom) / 1000;
    if (supportM >= 0) out.supportHeightM = Number(supportM.toFixed(4));
  }
  return out;
}
