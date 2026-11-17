// 이중관 Piping Stress Analysis — 3D 배관 모델에서 해석 모델(inp)의 Node / Element 번호 찾기.
//
// 찾는 글: "E46, 47, N12" 처럼 쉼표(또는 공백)로 여러 개. 앞글자 N = Node, E = Element,
// 번호만 쓰면 화면에서 고른 기본 종류(기본 Element)를 따른다 — Node 와 Element 번호가 둘 다 1부터라 겹친다.
//
// 좌표: 3D 화면은 입력 CSV 좌표(외관과 내관을 15000 mm 떨어뜨려 그림)인데, 해석 모델(inp)은 엔진이
// 외관을 내관 옆으로 옮겨 둔 좌표다. 그래서 group(outer / inner) 별로 두 모델의 범위(경계 상자 최소점)를
// 맞대어 옮길 거리를 구한다(엔진 상수 15000·5 에 기대지 않으려고).

export const FIND_MAX_ITEMS = 300;

export function parseFindQuery(text, defaultKind = 'element') {
  const items = [];
  const invalid = [];
  const seen = new Set();
  const tokens = String(text ?? '').split(/[,\s;]+/).map(t => t.trim()).filter(Boolean);
  for (const token of tokens) {
    const m = /^([NnEe])?\s*#?(\d+)$/.exec(token);
    if (!m) { invalid.push(token); continue; }
    const kind = m[1] ? (m[1].toUpperCase() === 'N' ? 'node' : 'element') : defaultKind;
    const id = Number(m[2]);
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind, id, label: `${kind === 'node' ? 'N' : 'E'}${id}` });
    if (items.length >= FIND_MAX_ITEMS) break;
  }
  return { items, invalid };
}

// 요소를 화면에 그릴 때 잇는 Node 순서. ELBOW31B 의 세 번째 Node 는 곡률 중심이라 선에 넣지 않는다.
export function elementPathNodes(element) {
  const nodes = Array.isArray(element?.nodes) ? element.nodes : [];
  const type = String(element?.type || '').toUpperCase();
  if (type.startsWith('ELBOW')) return nodes.slice(0, 2);
  if (type.startsWith('CONN')) return nodes.slice(0, 2);
  return nodes;
}

function bboxMin(points) {
  if (!points.length) return null;
  const min = [Infinity, Infinity, Infinity];
  for (const p of points) for (let i = 0; i < 3; i += 1) min[i] = Math.min(min[i], p[i]);
  return min;
}

// Node 마다 속한 관(outer / inner). 관 요소(beam)에 들어간 Node 만 정하고, 연결 요소 Node 는 그 관을 따른다.
export function nodeGroups(model) {
  const groups = new Map();
  for (const el of Object.values(model?.elements || {})) {
    if (el.group !== 'outer' && el.group !== 'inner') continue;
    for (const n of el.nodes || []) if (!groups.has(n)) groups.set(n, el.group);
  }
  // U-bolt 지지 고정점처럼 연결 요소에만 쓰인 Node 는 짝 Node 의 관을 따른다(같은 자리에 있으므로).
  for (const el of Object.values(model?.elements || {})) {
    if (el.group !== 'connector') continue;
    const [a, b] = el.nodes || [];
    if (groups.has(a) && !groups.has(b)) groups.set(b, groups.get(a));
    else if (groups.has(b) && !groups.has(a)) groups.set(a, groups.get(b));
  }
  return groups;
}

// csvPoints = { outer: [[x,y,z]...], inner: [...] } — 화면 모델(입력 CSV)의 관별 점.
export function computeGroupOffsets(model, csvPoints) {
  const offsets = { outer: [0, 0, 0], inner: [0, 0, 0] };
  for (const group of ['outer', 'inner']) {
    const inpPts = [];
    for (const el of Object.values(model?.elements || {})) {
      if (el.group !== group) continue;
      for (const n of elementPathNodes(el)) {
        const p = model.nodes?.[n];
        if (p) inpPts.push(p);
      }
    }
    const a = bboxMin(inpPts);
    const b = bboxMin(csvPoints?.[group] || []);
    if (a && b) offsets[group] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  }
  return offsets;
}

// 찾는 항목 → 화면 좌표의 강조 대상.
export function resolveFind(items, model, offsets) {
  const groups = nodeGroups(model);
  const shift = (id) => {
    const p = model?.nodes?.[id];
    if (!p) return null;
    const o = offsets?.[groups.get(Number(id))] || [0, 0, 0];
    return [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  };
  const nodes = [];
  const elements = [];
  const missing = [];
  for (const item of items) {
    if (item.kind === 'node') {
      const pos = shift(item.id);
      if (pos) nodes.push({ id: item.id, label: item.label, pos, group: groups.get(item.id) || 'other' });
      else missing.push(item.label);
    } else {
      const el = model?.elements?.[item.id];
      const path = el ? elementPathNodes(el).map(shift).filter(Boolean) : [];
      if (el && path.length) {
        elements.push({ id: item.id, label: item.label, type: el.type, group: el.group, path });
      } else {
        missing.push(item.label);
      }
    }
  }
  return { nodes, elements, missing };
}

const GROUP_LABEL = { outer: '외관', inner: '내관', connector: 'U-bolt 연결', other: '' };
export function groupLabel(group) {
  return GROUP_LABEL[group] ?? '';
}
