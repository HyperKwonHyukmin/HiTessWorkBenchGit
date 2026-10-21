/**
 * 절점 점검(04c §2) — Model Builder Studio `three/NodePoints.js` 의 freeNode 분류와 같은 규칙.
 *   고립(orphan) = 어떤 요소도 쓰지 않는 절점(0연결)
 *   자유단(free) = 요소 하나만 쓰는 절점(1연결)
 *   공유(shared) = 요소 둘 이상이 쓰는 절점, 그리고 RBE 의 모든 절점(강체로 이어진 점이라 자유단·고립이 아니다)
 * 쉘의 연결도 같은 셈이다(사각형 모서리 절점이 판 한 장만 쓰면 자유단). CONM2·SPC 는 연결로 세지 않는다.
 */
export const NODE_SHARED = 0;
export const NODE_FREE = 1;
export const NODE_ORPHAN = 2;
export const NODE_CLASS_KEYS = ['shared', 'free', 'orphan'];
export const NODE_CLASS_LABELS = { shared: '공유', free: '자유단', orphan: '고립' };

export function classifyNodes({ blocks }) {
  const n = blocks.node_ids?.length || 0;
  const degree = new Int32Array(n);
  const beams = blocks.beams || new Int32Array(0);
  const tris = blocks.tris || new Int32Array(0);
  const quads = blocks.quads || new Int32Array(0);
  for (let i = 0; i < beams.length; i += 4) { degree[beams[i + 2]] += 1; degree[beams[i + 3]] += 1; }
  for (let i = 0; i < tris.length; i += 5) for (let k = 2; k < 5; k += 1) degree[tris[i + k]] += 1;
  for (let i = 0; i < quads.length; i += 6) for (let k = 2; k < 6; k += 1) degree[quads[i + k]] += 1;
  const inRigid = new Uint8Array(n);
  const lines = blocks.rigid_lines || new Int32Array(0);
  for (let i = 0; i < lines.length; i += 3) { inRigid[lines[i + 1]] = 1; inRigid[lines[i + 2]] = 1; }

  const cls = new Uint8Array(n);
  const counts = { shared: 0, free: 0, orphan: 0 };
  for (let i = 0; i < n; i += 1) {
    let c = NODE_SHARED;
    if (!inRigid[i]) c = degree[i] === 0 ? NODE_ORPHAN : degree[i] === 1 ? NODE_FREE : NODE_SHARED;
    cls[i] = c;
    counts[NODE_CLASS_KEYS[c]] += 1;
  }
  return { cls, degree, counts };
}

/** 그 분류의 절점 순번(앞에서부터 limit 개). */
export function nodesOfClass(check, c, limit = Infinity) {
  const out = [];
  for (let i = 0; i < check.cls.length && out.length < limit; i += 1) if (check.cls[i] === c) out.push(i);
  return out;
}
