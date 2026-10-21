/**
 * lbm → 렌더용 PID 묶음·피킹 표(설계 §7.3). three 를 모르는 순수 함수라 jsdom 에서 시험한다.
 * 묶음마다 beamRanges·shellRanges = [{ card, start, count }] (인덱스 단위) — 같은 카드끼리 이어져 있다.
 */
import { pidColor } from './pidPalette.js';

export const ELEM_BEAM = 0;
export const ELEM_TRI = 1;
export const ELEM_QUAD = 2;

/** 요소 순번 → 24비트 RGB(0 = 빈 곳이라 순번+1 을 쓴다). */
export function encodePick(index) {
  const id = index + 1;
  return [id & 255, (id >> 8) & 255, (id >> 16) & 255];
}

export function decodePick(r, g, b) {
  const id = r + g * 256 + b * 65536;
  return id === 0 ? null : id - 1;
}

export function buildGeometry({ header, blocks }) {
  const xyz = blocks.node_xyz;
  const box = header.bbox || { min: [0, 0, 0], max: [0, 0, 0] };
  const center = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
  const radius = Math.max(Math.hypot(...[0, 1, 2].map((k) => box.max[k] - box.min[k])) / 2, 1e-6);
  // 큰 좌표에서 float32 정밀도가 깨지지 않게 bbox 중심을 뺀다.
  const positions = new Float32Array(xyz.length);
  for (let i = 0; i < xyz.length; i += 3) {
    positions[i] = xyz[i] - center[0];
    positions[i + 1] = xyz[i + 1] - center[1];
    positions[i + 2] = xyz[i + 2] - center[2];
  }

  const beams = blocks.beams || new Int32Array(0);
  const tris = blocks.tris || new Int32Array(0);
  const quads = blocks.quads || new Int32Array(0);
  const nb = beams.length / 4;
  const nt = tris.length / 5;
  const nq = quads.length / 6;
  const total = nb + nt + nq;
  const elemKind = new Uint8Array(total);
  const elemRow = new Int32Array(total);

  const beamCards = blocks.beam_cards || new Uint8Array(nb);
  const triCards = blocks.tri_cards || new Uint8Array(nt);
  const quadCards = blocks.quad_cards || new Uint8Array(nq);

  // 1차: PID·카드마다 개수를 세어 TypedArray 를 미리 잡는다(큰 모델에서 거대한 JS 배열 push 를 피한다).
  // PID 묶음 안에서는 카드끼리 모아 둔다 — 범위(ranges)마다 재질을 달리할 수 있게(색 기준 = 요소 종류,
  // 3D 단면에서 단면이 있는 1D 선만 숨기기).
  const counts = new Map();
  const counter = (pid) => {
    let c = counts.get(pid);
    if (!c) { c = { b: new Map(), t: new Map(), q: new Map() }; counts.set(pid, c); }
    return c;
  };
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (let r = 0; r < nb; r += 1) bump(counter(beams[r * 4 + 1]).b, beamCards[r]);
  for (let r = 0; r < nt; r += 1) bump(counter(tris[r * 5 + 1]).t, triCards[r]);
  for (let r = 0; r < nq; r += 1) bump(counter(quads[r * 6 + 1]).q, quadCards[r]);
  const sum = (m) => { let s = 0; for (const v of m.values()) s += v; return s; };
  const cardName = (list, i) => header.cards?.[list]?.[i] ?? `?${i}`;
  const groups = new Map();
  for (const [pid, c] of counts) {
    const nbP = sum(c.b); const ntP = sum(c.t); const nqP = sum(c.q);
    const tri = ntP + nqP * 2;
    // 범위와 채움 위치(cursor) — 1D 는 선분 단위, 쉘은 삼각형 단위
    const beamRanges = []; const shellRanges = [];
    const cur = { b: new Map(), t: new Map(), q: new Map() };
    let at = 0;
    for (const k of [...c.b.keys()].sort((a, b) => a - b)) {
      beamRanges.push({ card: cardName('beam', k), start: at * 2, count: c.b.get(k) * 2 });
      cur.b.set(k, at); at += c.b.get(k);
    }
    at = 0;
    for (const k of [...c.t.keys()].sort((a, b) => a - b)) {
      shellRanges.push({ card: cardName('tri', k), start: at * 3, count: c.t.get(k) * 3 });
      cur.t.set(k, at); at += c.t.get(k);
    }
    for (const k of [...c.q.keys()].sort((a, b) => a - b)) {
      shellRanges.push({ card: cardName('quad', k), start: at * 3, count: c.q.get(k) * 6 });
      cur.q.set(k, at); at += c.q.get(k) * 2;
    }
    groups.set(pid, {
      pid, count: nbP + ntP + nqP,
      shell: new Uint32Array(tri * 3), shellElem: new Int32Array(tri),
      edges: new Uint32Array((ntP * 3 + nqP * 4) * 2),
      beams: new Uint32Array(nbP * 2), beamElem: new Int32Array(nbP),
      beamRanges, shellRanges, cur, ed: 0,
    });
  }

  // 2차: 채운다. 요소 순번: 1D → 삼각형 → 사각형(묶음 안 위치는 카드 범위의 cursor 가 정한다)
  let e = 0;
  for (let r = 0; r < nb; r += 1, e += 1) {
    const g = groups.get(beams[r * 4 + 1]);
    const k = beamCards[r];
    const i = g.cur.b.get(k);
    g.cur.b.set(k, i + 1);
    g.beams[i * 2] = beams[r * 4 + 2];
    g.beams[i * 2 + 1] = beams[r * 4 + 3];
    g.beamElem[i] = e;
    elemKind[e] = ELEM_BEAM;
    elemRow[e] = r;
  }
  for (let r = 0; r < nt; r += 1, e += 1) {
    const o = r * 5;
    const a = tris[o + 2]; const b = tris[o + 3]; const c = tris[o + 4];
    const g = groups.get(tris[o + 1]);
    const k = triCards[r];
    const i = g.cur.t.get(k);
    g.cur.t.set(k, i + 1);
    const sh = g.shell;
    sh[i * 3] = a; sh[i * 3 + 1] = b; sh[i * 3 + 2] = c;
    g.shellElem[i] = e;
    const ed = g.edges;
    ed[g.ed++] = a; ed[g.ed++] = b; ed[g.ed++] = b; ed[g.ed++] = c; ed[g.ed++] = c; ed[g.ed++] = a;
    elemKind[e] = ELEM_TRI;
    elemRow[e] = r;
  }
  for (let r = 0; r < nq; r += 1, e += 1) {
    const o = r * 6;
    const a = quads[o + 2]; const b = quads[o + 3]; const c = quads[o + 4]; const d = quads[o + 5];
    const g = groups.get(quads[o + 1]);
    const k = quadCards[r];
    const i = g.cur.q.get(k);
    g.cur.q.set(k, i + 2);
    // 사각형은 (a,b,c)·(a,c,d) 두 삼각형이 같은 요소 순번을 갖는다.
    const sh = g.shell;
    const s = i * 3;
    sh[s] = a; sh[s + 1] = b; sh[s + 2] = c; sh[s + 3] = a; sh[s + 4] = c; sh[s + 5] = d;
    g.shellElem[i] = e;
    g.shellElem[i + 1] = e;
    const ed = g.edges;
    ed[g.ed++] = a; ed[g.ed++] = b; ed[g.ed++] = b; ed[g.ed++] = c;
    ed[g.ed++] = c; ed[g.ed++] = d; ed[g.ed++] = d; ed[g.ed++] = a;
    elemKind[e] = ELEM_QUAD;
    elemRow[e] = r;
  }

  const lines = blocks.rigid_lines || new Int32Array(0);
  const kinds = blocks.rigid_kinds || new Uint8Array(0);
  let n2 = 0;
  for (let i = 0; i < kinds.length; i += 1) if (kinds[i] === 0) n2 += 1;
  const rbe2 = new Uint32Array(n2 * 2);
  const rbe3 = new Uint32Array((kinds.length - n2) * 2);
  for (let i = 0, p2 = 0, p3 = 0; i < kinds.length; i += 1) {
    const out = kinds[i] === 0 ? rbe2 : rbe3;
    const at = kinds[i] === 0 ? (p2 += 2) - 2 : (p3 += 2) - 2;
    out[at] = lines[i * 3 + 1];
    out[at + 1] = lines[i * 3 + 2];
  }
  const masses = blocks.masses || new Int32Array(0);
  const spcs = blocks.spcs || new Int32Array(0);

  // 뷰어 좌표의 경계 상자(자르기 평면 위치 계산용)
  const bounds = { min: [0, 1, 2].map((k) => box.min[k] - center[k]), max: [0, 1, 2].map((k) => box.max[k] - center[k]) };
  return {
    center, radius, bounds, positions, total, elemKind, elemRow,
    groups: [...groups.values()].sort((a, b) => a.pid - b.pid).map((g) => ({
      pid: g.pid, color: pidColor(g.pid), count: g.count,
      shell: g.shell, shellElem: g.shellElem, edges: g.edges, beams: g.beams, beamElem: g.beamElem,
      beamRanges: g.beamRanges, shellRanges: g.shellRanges,
    })),
    rigid: { rbe2, rbe3 },
    masses: Uint32Array.from({ length: masses.length / 2 }, (_, i) => masses[i * 2 + 1]),
    spcs: Uint32Array.from({ length: spcs.length / 2 }, (_, i) => spcs[i * 2]),
  };
}
