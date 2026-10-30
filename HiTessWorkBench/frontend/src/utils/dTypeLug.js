// D Type Lug Assessment — 화면 규칙(순수 함수). 페이지: pages/analysis/DTypeLugAssessment.jsx

// 엔진 형식 키 ↔ 화면 이름. Opposite side = 엔진 '2EA 양면'(대칭), Same side = '2EA 단면'(비대칭).
export const BRACKETS = [
  { key: 'bracket_4EA', name: '4EA', side: '브라켓 4개' },
  { key: 'bracket_2EA_double', name: '2EA', side: 'Opposite side' },
  { key: 'bracket_2EA_single', name: '2EA', side: 'Same side' },
];

export const DEFAULT_BRACKET = BRACKETS[0].key;

export const bracketLabel = (key) => {
  const b = BRACKETS.find(item => item.key === key);
  if (!b) return key;
  return b.key === 'bracket_4EA' ? 'Bracket 4EA' : `Bracket 2EA (${b.side})`;
};

export const SECTIONS = [
  { key: 'A', name: 'Pin 전단' },
  { key: 'B', name: 'Pin Bearing' },
  { key: 'C', name: 'Lug Plate' },
  { key: 'D', name: 'Base Plate' },
  { key: 'E', name: 'Weld' },
];

// W1'·W2' 는 0 으로 고정한다(입력 칸 없음, 2026-10-30 사용자 결정). 엔진 스키마는 두 값을 요구하므로 보낼 때 붙인다.
export const FIXED_GEOMETRY = { w1_prime: 0, w2_prime: 0 };

export const toPayload = (inputs) => {
  const num = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Number(v)]));
  return {
    load: num(inputs.load),
    geometry: { ...num(inputs.geometry), ...FIXED_GEOMETRY },
    material: num(inputs.material),
  };
};

// 빈 칸·숫자 아님·범위 밖이면 사유. 힘·재료는 0 보다 커야 하고 치수는 0 이상.
export const fieldError = (value, { positive = false } = {}) => {
  if (value === '' || value == null) return '값을 입력하세요';
  const n = Number(value);
  if (!Number.isFinite(n)) return '숫자를 입력하세요';
  if (positive ? n <= 0 : n < 0) return positive ? '0보다 커야 합니다' : '0 이상이어야 합니다';
  return null;
};

// 용접 목두께는 (W + W')/√2 이고 W' 는 0 고정이다 — W1·W2 가 둘 다 0 이면 E 단면 면적이 0 이 되어 엔진이 0 으로 나눈다.
export const weldError = (geometry) => {
  // 빈 칸은 fieldError 가 잡는다(Number('') 은 0 이라 여기서 거르지 않으면 '둘 다 0' 으로 오판).
  if ([geometry?.w1, geometry?.w2].some(v => v === '' || v == null)) return null;
  const w1 = Number(geometry?.w1);
  const w2 = Number(geometry?.w2);
  if (!Number.isFinite(w1) || !Number.isFinite(w2)) return null;
  return w1 + w2 > 0 ? null : 'W1·W2 중 하나는 0보다 커야 합니다';
};

// 예전 Draft 에는 w1_prime(기본 12)·w2_prime 이 들어 있다 — 고정값과 어긋나지 않게 걷어 낸다.
export const sanitizeDraftInputs = (draftInputs, defaults) => {
  if (!draftInputs) return defaults;
  // eslint-disable-next-line no-unused-vars
  const { w1_prime, w2_prime, ...geometry } = draftInputs.geometry ?? {};
  return {
    load: { ...defaults.load, ...(draftInputs.load ?? {}) },
    geometry: { ...defaults.geometry, ...geometry },
    material: { ...defaults.material, ...(draftInputs.material ?? {}) },
  };
};

// 단면별로 사용률이 가장 큰 각도 케이스(엔진 max_usage_factor 는 값만 주고 케이스는 전체 기준 하나뿐).
export const governingCaseBySection = (perAngle = []) => {
  const out = {};
  for (const { key } of SECTIONS) {
    let best = null;
    for (const row of perAngle) {
      const v = Number(row?.usage_factor?.[key]);
      if (!Number.isFinite(v)) continue;
      if (!best || v > best.value) best = { value: v, index: row.index };
    }
    out[key] = best;
  }
  return out;
};

export const rowMaxUsage = (row) => {
  const vals = SECTIONS.map(s => Number(row?.usage_factor?.[s.key])).filter(Number.isFinite);
  return vals.length ? Math.max(...vals) : null;
};

export const caseLabel = (index) => (Number.isFinite(Number(index)) ? Number(index) + 1 : '-');
