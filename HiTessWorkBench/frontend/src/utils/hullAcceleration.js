const AXES = ['x', 'y', 'z'];

export const getRuleAxisMaxima = (rule) => Object.fromEntries(
  AXES.map((axis) => {
    const component = rule?.[axis] ?? {};
    const conditionNo = component.max_lc;
    const conditionValue = (component.per_condition ?? [])
      .find((item) => item.condition_no === conditionNo)?.value;

    return [
      axis,
      {
        value: Number.isFinite(Number(component.max)) ? Number(component.max) : conditionValue,
        conditionNo,
      },
    ];
  }),
);
