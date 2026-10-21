/**
 * 찾기·선택 정보·범례가 쓰는 색인(04c §2). 순수 함수.
 *  · listRigids  — rigid_lines 를 RBE(EID) 단위로 묶는다(백엔드는 RBE 마다 '기준 절점 → 다른 절점' 줄을 잇달아 쓴다).
 *  · createIdIndex — 절점 ID·요소 EID·RBE EID → 순번(처음 찾을 때 만든다. 큰 모델에서 불러오기를 늦추지 않게).
 *  · elementTable — 요소 순번별 PID·카드·단면 종류(범례·색 기준용).
 */
import { ELEM_BEAM, ELEM_TRI } from './modelGeometry.js';
import { SECTION_TYPES, sectionOf } from './sectionProfile.js';

export const RBE_KIND_CARDS = ['RBE2', 'RBE3'];

/** RBE 목록 — { count, eid, kind, center, start(줄 시작), lines(줄 수) } (모두 TypedArray). */
export function listRigids({ blocks }) {
  const lines = blocks.rigid_lines || new Int32Array(0);
  const kinds = blocks.rigid_kinds || new Uint8Array(0);
  const n = kinds.length;
  const starts = [];
  for (let i = 0; i < n; i += 1) {
    if (i === 0 || lines[i * 3] !== lines[(i - 1) * 3] || kinds[i] !== kinds[i - 1]) starts.push(i);
  }
  const count = starts.length;
  const eid = new Int32Array(count); const kind = new Uint8Array(count); const center = new Int32Array(count);
  const start = new Int32Array(count); const len = new Int32Array(count);
  for (let k = 0; k < count; k += 1) {
    const s = starts[k];
    const e = k + 1 < count ? starts[k + 1] : n;
    eid[k] = lines[s * 3]; kind[k] = kinds[s]; center[k] = lines[s * 3 + 1];
    start[k] = s; len[k] = e - s;
  }
  // 줄 순번 → RBE 순번(피킹 색칠용)
  const ofLine = new Int32Array(n);
  for (let k = 0; k < count; k += 1) ofLine.fill(k, start[k], start[k] + len[k]);
  return { count, eid, kind, center, start, lines: len, ofLine };
}

/** RBE 하나의 절점 순번 — [기준, 다른 절점…]. */
export function rigidNodes({ blocks }, rigids, k) {
  const lines = blocks.rigid_lines;
  const out = [rigids.center[k]];
  for (let i = rigids.start[k]; i < rigids.start[k] + rigids.lines[k]; i += 1) out.push(lines[i * 3 + 2]);
  return out;
}

/** 요소 순번 → 그 요소의 절점 순번(뷰어 좌표 배열 순번). */
export function elementNodeIndices({ blocks }, geometry, index) {
  const row = geometry.elemRow[index];
  const kind = geometry.elemKind[index];
  if (kind === ELEM_BEAM) return [blocks.beams[row * 4 + 2], blocks.beams[row * 4 + 3]];
  if (kind === ELEM_TRI) return [2, 3, 4].map((k) => blocks.tris[row * 5 + k]);
  return [2, 3, 4, 5].map((k) => blocks.quads[row * 6 + k]);
}

export function createIdIndex(lbm, geometry, rigids) {
  let nodes = null; let elems = null; let rbes = null;
  return {
    node(id) {
      if (!nodes) {
        nodes = new Map();
        const ids = lbm.blocks.node_ids || [];
        for (let i = 0; i < ids.length; i += 1) nodes.set(ids[i], i);
      }
      return nodes.get(id) ?? null;
    },
    element(eid) {
      if (!elems) {
        elems = new Map();
        const { blocks } = lbm;
        for (let e = 0; e < geometry.total; e += 1) {
          const row = geometry.elemRow[e];
          const kind = geometry.elemKind[e];
          const id = kind === ELEM_BEAM ? blocks.beams[row * 4] : kind === ELEM_TRI ? blocks.tris[row * 5] : blocks.quads[row * 6];
          // 같은 EID 가 둘이면(잘못된 덱) 앞의 것
          if (!elems.has(id)) elems.set(id, e);
        }
      }
      return elems.get(eid) ?? null;
    },
    rigid(eid) {
      if (!rbes) {
        rbes = new Map();
        for (let k = 0; k < rigids.count; k += 1) if (!rbes.has(rigids.eid[k])) rbes.set(rigids.eid[k], k);
      }
      return rbes.get(eid) ?? null;
    },
    /** ID 범위(없음 안내용) */
    range(kind) {
      let arr;
      if (kind === 'node') arr = lbm.blocks.node_ids || [];
      else if (kind === 'rigid') arr = rigids.eid;
      else {
        arr = new Int32Array(geometry.total);
        for (let e = 0; e < geometry.total; e += 1) {
          const row = geometry.elemRow[e];
          const k = geometry.elemKind[e];
          arr[e] = k === ELEM_BEAM ? lbm.blocks.beams[row * 4] : k === ELEM_TRI ? lbm.blocks.tris[row * 5] : lbm.blocks.quads[row * 6];
        }
      }
      if (!arr.length) return null;
      let min = Infinity; let max = -Infinity;
      for (let i = 0; i < arr.length; i += 1) { if (arr[i] < min) min = arr[i]; if (arr[i] > max) max = arr[i]; }
      return { min, max, count: arr.length };
    },
  };
}

/** 요소 순번 → 단면 종류 이름(1D: SECTION_TYPES 또는 'LINE', 쉘: 'SHELL'). */
export const SECTION_KEYS = [...SECTION_TYPES, 'LINE', 'SHELL'];
export const SECTION_LABELS = {
  L: 'L', I: 'I', H: 'H', T: 'T', BOX: 'BOX', CHAN: 'CHAN', TUBE: 'TUBE', ROD: 'ROD', BAR: 'BAR',
  OTHER: '기타 단면', LINE: '단면 없음', SHELL: '쉘',
};

/**
 * 요소마다 PID·카드·단면 종류 — 범례 개수와 색 기준에 쓴다.
 * @returns {{ pid: Int32Array, card: Uint8Array, cards: string[], section: Uint8Array }}
 *   card 는 cards 의 순번, section 은 SECTION_KEYS 의 순번.
 */
export function elementTable({ header, blocks }, geometry) {
  const total = geometry.total;
  const pid = new Int32Array(total);
  const card = new Uint8Array(total);
  const section = new Uint8Array(total);
  const cards = [];
  const cardIndex = new Map();
  const cardOf = (name) => {
    const key = name || '?';
    let i = cardIndex.get(key);
    if (i == null) { i = cards.length; cards.push(key); cardIndex.set(key, i); }
    return i;
  };
  const secCache = new Map();
  const shellKey = SECTION_KEYS.indexOf('SHELL');
  const lineKey = SECTION_KEYS.indexOf('LINE');
  for (let e = 0; e < total; e += 1) {
    const row = geometry.elemRow[e];
    const kind = geometry.elemKind[e];
    if (kind === ELEM_BEAM) {
      const p = blocks.beams[row * 4 + 1];
      const name = header.cards?.beam?.[blocks.beam_cards?.[row]];
      pid[e] = p;
      card[e] = cardOf(name);
      const ck = `${p}|${name}`;
      let s = secCache.get(ck);
      if (s == null || name === 'CONROD') {
        const sec = sectionOf(header.properties?.[p], name, header.conrods?.[blocks.beams[row * 4]]);
        s = sec ? SECTION_KEYS.indexOf(sec.type) : lineKey;
        if (name !== 'CONROD') secCache.set(ck, s);
      }
      section[e] = s;
    } else if (kind === ELEM_TRI) {
      pid[e] = blocks.tris[row * 5 + 1];
      card[e] = cardOf(header.cards?.tri?.[blocks.tri_cards?.[row]]);
      section[e] = shellKey;
    } else {
      pid[e] = blocks.quads[row * 6 + 1];
      card[e] = cardOf(header.cards?.quad?.[blocks.quad_cards?.[row]]);
      section[e] = shellKey;
    }
  }
  return { pid, card, cards, section };
}
