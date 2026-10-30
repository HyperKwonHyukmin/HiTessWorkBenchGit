const AXES = ['x', 'y', 'z'];

export const getRuleAxisMaxima = (rule, selectedLcSet = null) => Object.fromEntries(
  AXES.map((axis) => {
    const component = rule?.[axis] ?? {};
    const hasSelectionFilter = selectedLcSet != null;
    const selectedItems = (component.per_condition ?? [])
      .filter((item) => !hasSelectionFilter || selectedLcSet.has(Number(item.condition_no)));
    const top = selectedItems.reduce((best, item) => {
      const value = Number(item.value);
      if (!Number.isFinite(value)) return best;
      return best == null || value > best.value
        ? { conditionNo: Number(item.condition_no), value }
        : best;
    }, null);
    const conditionNo = top?.conditionNo ?? (hasSelectionFilter ? undefined : component.max_lc);
    const conditionValue = top?.value ?? (hasSelectionFilter ? undefined : (component.per_condition ?? [])
      .find((item) => Number(item.condition_no) === Number(conditionNo))?.value);

    return [
      axis,
      {
        value: top?.value ?? (
          hasSelectionFilter
            ? undefined
            : (Number.isFinite(Number(component.max)) ? Number(component.max) : conditionValue)
        ),
        conditionNo,
      },
    ];
  }),
);

export const getConditionNumbersFromRules = (rules) => Array.from(
  new Set(
    Object.values(rules ?? {}).flatMap((rule) => AXES.flatMap((axis) => (
      rule?.[axis]?.per_condition ?? []
    ).map((item) => Number(item.condition_no)).filter(Number.isFinite))),
  ),
).sort((a, b) => a - b);

export const buildFilteredEnvelope = (rules, selectedLcSet, gravity = 9.81) => {
  const envelope = {};
  const ranking = {};

  AXES.forEach((axis) => {
    const scored = Object.values(rules ?? {}).map((rule) => {
      const maxima = getRuleAxisMaxima(rule, selectedLcSet)[axis];
      const value = Number(maxima.value);
      const g = Number.isFinite(value) && gravity ? value / gravity : 0;
      return {
        rule: rule.key,
        label: rule.label,
        value: Number.isFinite(value) ? value : 0,
        g,
        lc: maxima.conditionNo,
      };
    }).filter((item) => Number.isFinite(item.value))
      .sort((a, b) => b.value - a.value);

    ranking[axis] = scored;
    if (scored.length > 0) envelope[axis] = scored[0];
  });

  envelope.ranking = ranking;
  return envelope;
};

// 주요 치수 직접 입력(엔진이 PDF 에서 못 읽었거나 값이 이상할 때). 키는 엔진 `manual_dimensions` 와 같다.
export const MANUAL_DIMENSION_KEYS = ['length', 'breadth', 'depth', 'scantling_draft'];

export const EMPTY_MANUAL_DIMENSIONS = Object.fromEntries(MANUAL_DIMENSION_KEYS.map((key) => [key, '']));

// 입력칸 값 → 엔진 페이로드. 0 보다 큰 숫자만 싣고, 하나도 없으면 null(키를 보내지 않음).
export const buildManualDimensionsPayload = (manualDims) => {
  const out = {};
  MANUAL_DIMENSION_KEYS.forEach((key) => {
    const raw = manualDims?.[key];
    if (raw === '' || raw === null || raw === undefined) return;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  });
  return Object.keys(out).length ? out : null;
};

// 치수 미검출 결과를 받았을 때 입력칸을 채운다: 사용자가 이미 넣은 칸은 그대로, 빈 칸만 PDF 에서 읽은 값으로.
// ⚠ 결과의 ship_constants 는 화면 기본값(다른 호선)이 섞여 있어 쓰지 않는다 — ship_particulars.values 만 쓴다.
export const prefillManualDimensions = (prev, pdfValues) => {
  const next = { ...EMPTY_MANUAL_DIMENSIONS, ...prev };
  MANUAL_DIMENSION_KEYS.forEach((key) => {
    if (next[key] !== '') return;
    const value = key === 'length' ? (pdfValues?.length ?? pdfValues?.lbp) : pdfValues?.[key];
    if (value !== null && value !== undefined) next[key] = String(value);
  });
  return next;
};

export const isManualDimensionsComplete = (manualDims) => {
  const payload = buildManualDimensionsPayload(manualDims);
  return Boolean(payload) && MANUAL_DIMENSION_KEYS.every((key) => payload[key] !== undefined);
};
