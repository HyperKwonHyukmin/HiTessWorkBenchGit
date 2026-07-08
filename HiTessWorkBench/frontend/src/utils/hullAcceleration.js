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
