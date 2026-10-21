/**
 * 연결 그룹(04c §2) — 부재·쉘·RBE 로 이어진 절점을 union-find 로 묶는다.
 * Model Builder Studio `data/StageData.js` `_computeGroups` 와 같은 뜻이고, Logbook 은 쉘과 RBE3 도 연결로 센다.
 *
 * 요소 순번은 modelGeometry 와 같다(1D → 삼각형 → 사각형). 그룹은 요소 수 내림차순(0번 = 주 구조),
 * 같으면 가장 작은 절점 순번 순. 요소가 하나도 없는 덩어리(RBE 끼리만 이어진 절점·고립 절점)는 그룹이 아니다(-1).
 */

function makeUnionFind(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (a) => {
    let x = a;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];   // 경로 반감
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a); const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra; else parent[ra] = rb;
  };
  return { find, union };
}

export function computeGroups({ blocks }) {
  const nNodes = blocks.node_ids?.length || 0;
  const beams = blocks.beams || new Int32Array(0);
  const tris = blocks.tris || new Int32Array(0);
  const quads = blocks.quads || new Int32Array(0);
  const lines = blocks.rigid_lines || new Int32Array(0);
  const nb = beams.length / 4; const nt = tris.length / 5; const nq = quads.length / 6;
  const total = nb + nt + nq;
  const uf = makeUnionFind(nNodes);

  for (let r = 0; r < nb; r += 1) uf.union(beams[r * 4 + 2], beams[r * 4 + 3]);
  for (let r = 0; r < nt; r += 1) {
    const o = r * 5;
    uf.union(tris[o + 2], tris[o + 3]); uf.union(tris[o + 2], tris[o + 4]);
  }
  for (let r = 0; r < nq; r += 1) {
    const o = r * 6;
    uf.union(quads[o + 2], quads[o + 3]); uf.union(quads[o + 2], quads[o + 4]); uf.union(quads[o + 2], quads[o + 5]);
  }
  for (let i = 0; i < lines.length; i += 3) uf.union(lines[i + 1], lines[i + 2]);

  // 요소마다 뿌리 → 뿌리별 요소 수
  const elemRoot = new Int32Array(total);
  const rootElems = new Map();
  const firstNode = (e) => {
    if (e < nb) return beams[e * 4 + 2];
    if (e < nb + nt) return tris[(e - nb) * 5 + 2];
    return quads[(e - nb - nt) * 6 + 2];
  };
  for (let e = 0; e < total; e += 1) {
    const root = uf.find(firstNode(e));
    elemRoot[e] = root;
    rootElems.set(root, (rootElems.get(root) || 0) + 1);
  }
  // 정렬: 요소 수 내림차순, 같으면 뿌리(= 덩어리의 가장 작은 절점 순번) 오름차순
  const roots = [...rootElems.keys()].sort((a, b) => (rootElems.get(b) - rootElems.get(a)) || (a - b));
  const rootIndex = new Map(roots.map((root, i) => [root, i]));

  const elemGroup = new Int32Array(total);
  for (let e = 0; e < total; e += 1) elemGroup[e] = rootIndex.get(elemRoot[e]);
  const nodeGroup = new Int32Array(nNodes);
  const nodeCounts = new Int32Array(roots.length);
  for (let n = 0; n < nNodes; n += 1) {
    const g = rootIndex.get(uf.find(n));
    nodeGroup[n] = g == null ? -1 : g;
    if (g != null) nodeCounts[g] += 1;
  }
  // RBE 개수 — 서로 다른 EID 를 기준 절점의 그룹에 센다.
  const rigidCounts = new Int32Array(roots.length);
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 3) {
    if (seen.has(lines[i])) continue;
    seen.add(lines[i]);
    const g = nodeGroup[lines[i + 1]];
    if (g >= 0) rigidCounts[g] += 1;
  }
  const groups = roots.map((root, i) => ({
    index: i, elements: rootElems.get(root), nodes: nodeCounts[i], rigids: rigidCounts[i],
  }));
  return { count: groups.length, groups, elemGroup, nodeGroup };
}
