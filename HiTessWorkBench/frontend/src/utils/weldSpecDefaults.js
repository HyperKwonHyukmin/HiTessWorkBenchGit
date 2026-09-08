/**
 * 정반 Leg 용접부 사양의 기본값과 비교 도구.
 *
 * ⚠ 이 값은 백엔드 `app/services/module_ocean_weld.DEFAULT_WELD_SPEC` 과 **같아야 한다**.
 *   판정은 전부 서버가 하지만, 화면이 처음 그리는 사양과 해석 요청에 실어 보내는 사양이
 *   여기서 나오기 때문이다. 양쪽이 갈라지면 화면에 보이는 사양과 실제 판정에 쓰인 사양이
 *   달라진다. 그래서 두 값을 각각 테스트로 고정해 뒀다:
 *     - 프론트 : utils/weldSpecDefaults.test.js
 *     - 백엔드 : tests/test_module_ocean_weld.py
 *                tests/test_module_ocean_structural_route.py
 *   한쪽만 고치면 반대편 테스트가 깨진다.
 *
 * 화면과 기본 형상은 `Weld Stress_ver01.xlsx`의 visible Length_Breadth 시트다.
 * 계산 엔진은 그 형상을 네 개의 유효목두께 line weld로 평가한다.
 */
export const DEFAULT_WELD_SPEC = Object.freeze({
  yieldMPa: 450,      // 용접부 항복강도 [MPa]
  safetyFactor: 3,    // 안전율 → 허용 = 150 MPa
  plateHeightMm: 500, // Plate 높이 [mm]
  plateBreadthMm: 500,// Plate 폭 [mm]
  tackCount: 4,       // 네 면 중앙 고정 용접 개수
  weldLengthMm: 268,  // 각 분절의 용접 길이 [mm]
  weldLegMm: 10,      // 필릿용접 각장 [mm]
});

export const WELD_SPEC_KEYS = Object.freeze(Object.keys(DEFAULT_WELD_SPEC));

/**
 * 저장된 schema v1의 `padSizeMm`을 새 직사각형 Plate 치수로 승격한다.
 * 허용 키만 복사해서 폐기된 필드가 API payload에 다시 섞이지 않게 한다.
 */
export function normalizeWeldSpec(value) {
  const source = value || {};
  const legacyPad = Number(source.padSizeMm);
  const result = {};
  WELD_SPEC_KEYS.forEach((key) => {
    let candidate = source[key];
    if ((key === 'plateHeightMm' || key === 'plateBreadthMm')
        && candidate == null && Number.isFinite(legacyPad)) {
      candidate = legacyPad;
    }
    const numeric = candidate == null ? Number.NaN : Number(candidate);
    result[key] = Number.isFinite(numeric) ? numeric : DEFAULT_WELD_SPEC[key];
  });
  // 화면 형상이 네 면 중앙 4분절로 고정되므로 저장된 임의 개수는 승계하지 않는다.
  result.tackCount = 4;
  return result;
}

/**
 * 두 사양이 같은가. 화면에 보이는 사양과 서버가 판정에 쓴 사양을 대조해
 * "지금 보이는 숫자가 이 판정을 만든 사양이 맞는지" 를 판단하는 데 쓴다.
 *
 * 서버는 값을 float 로 돌려주므로(4 -> 4.0) 반드시 **숫자로** 비교해야 한다.
 * 문자열이나 엄격 비교로 두면 매번 다르다고 나와 재평가 요청이 무한히 돈다.
 */
export function weldSpecEquals(a, b) {
  if (!a || !b) return false;
  const left = normalizeWeldSpec(a);
  const right = normalizeWeldSpec(b);
  return WELD_SPEC_KEYS.every(key => left[key] === right[key]);
}
