/**
 * 뷰포트 범례(04c §2) — 색 기준별 항목 · 개수 · 숨김. 순수 함수.
 *
 * 항목 = { key, label, color, count, visible, hidden }
 *   count   = 그 항목의 요소 수
 *   visible = 지금 보이는 요소 수(PID 숨김·그룹 숨김을 둘 다 반영)
 *   hidden  = 요소가 있는데 하나도 안 보임 → 범례에 '숨김' 으로 표시한다(색만으로 알리지 않는다)
 */
import { cardColor, groupColor, pidColor, sectionColor } from './pidPalette.js';
import { SECTION_KEYS, SECTION_LABELS } from './modelIndex.js';

/** 처음 열 때의 색 기준은 PID(BDF 에는 배관·구조 구분이 없어 한 색으로는 모델이 읽히지 않는다). */
export const COLOR_MODES = ['pid', 'group', 'section', 'type'];
export const COLOR_MODE_LABELS = { pid: 'PID', group: '그룹', section: '단면 종류', type: '요소 종류' };
/** 범례에 개별로 보이는 항목 수 — 넘치면 '외 n개' 한 줄로 묶는다. */
export const LEGEND_MAX = 10;

/**
 * @param {object} p
 *   mode        COLOR_MODES 중 하나
 *   table       modelIndex.elementTable 결과
 *   elemGroup   modelGroups.computeGroups 의 elemGroup
 *   groupCount  그룹 수
 *   hiddenPids  Set<pid>
 *   hiddenGroups Set<group index>
 * @returns {{ title, items, rest: null|{ count, items } }}
 */
export function legendItems({ mode, table, elemGroup, groupCount = 0, hiddenPids = new Set(), hiddenGroups = new Set() }) {
  const total = table.pid.length;
  let keyOf; let labelOf; let colorOf; let order;
  if (mode === 'group') {
    keyOf = (e) => elemGroup[e];
    labelOf = (k) => `그룹 ${k + 1}`;
    colorOf = groupColor;
    order = (a, b) => a - b;
  } else if (mode === 'section') {
    keyOf = (e) => table.section[e];
    labelOf = (k) => SECTION_LABELS[SECTION_KEYS[k]];
    colorOf = (k) => sectionColor(SECTION_KEYS[k]);
    order = (a, b) => a - b;
  } else if (mode === 'type') {
    keyOf = (e) => table.card[e];
    labelOf = (k) => table.cards[k];
    colorOf = (k) => cardColor(table.cards[k]);
    order = (a, b) => table.cards[a].localeCompare(table.cards[b]);
  } else {
    keyOf = (e) => table.pid[e];
    labelOf = (k) => `PID ${k}`;
    colorOf = pidColor;
    order = (a, b) => a - b;
  }
  const count = new Map();
  const visible = new Map();
  for (let e = 0; e < total; e += 1) {
    const k = keyOf(e);
    count.set(k, (count.get(k) || 0) + 1);
    const on = !hiddenPids.has(table.pid[e]) && !(elemGroup && hiddenGroups.has(elemGroup[e]));
    if (on) visible.set(k, (visible.get(k) || 0) + 1);
  }
  let keys = [...count.keys()].sort(order);
  if (mode === 'group' && groupCount) keys = keys.filter((k) => k < groupCount);
  const items = keys.map((k) => {
    const v = visible.get(k) || 0;
    return { key: k, label: labelOf(k), color: colorOf(k), count: count.get(k), visible: v, hidden: v === 0 };
  });
  const head = items.slice(0, LEGEND_MAX);
  const tail = items.slice(LEGEND_MAX);
  return {
    title: `색 기준 · ${COLOR_MODE_LABELS[mode] || 'PID'}`,
    items: head,
    rest: tail.length ? { count: tail.length, elements: tail.reduce((s, it) => s + it.count, 0) } : null,
  };
}
