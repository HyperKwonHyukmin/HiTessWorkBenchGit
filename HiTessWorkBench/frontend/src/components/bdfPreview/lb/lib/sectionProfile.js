/**
 * 1D 요소 단면 윤곽(04c §2) — three 를 모르는 순수 함수라 jsdom 에서 시험한다.
 *
 * 좌표는 Nastran 요소 좌표계의 (y, z) 평면이다. 점 = [y, z], 모델 단위(대개 mm).
 * 요소 x 축(GA→GB, 오프셋 반영)이 이 평면을 수직으로 뚫고, 원점(0,0)이 요소 축 위에 놓인다.
 * y·z 축 방향은 beamFrame.js 가 방향 벡터 v 로 정한다(z = x × v, y = z × x).
 *
 * DIM 규약은 MSC Nastran QRG 의 PBARL/PBEAML 그림을 따른다. 그림마다 y_elem 이 세로(위), z_elem 이 가로다.
 * 원점은 pyNastran `bdf/cards/elements/beam_connectivity.py` 의 *_setup(그림과 대조해 검증된 값)과 같다.
 * 비대칭 단면(CHAN·I 위아래 다른 플랜지)의 전단 중심 보정은 넣지 않았다(pyNastran 과 같은 근사).
 *
 *   종류  DIM1            DIM2             DIM3              DIM4             DIM5·DIM6     원점
 *   ROD   반지름 R        —                —                 —                —             중심
 *   TUBE  바깥 반지름     안 반지름        —                 —                —             중심
 *   BAR   폭(z)           높이(y)          —                 —                —             중심
 *   BOX   폭(z)           높이(y)          위·아래 벽 두께   좌·우 벽 두께    —             중심
 *   I     전체 높이(y)    아래 플랜지 폭   위 플랜지 폭      웹 두께(z)       아래·위 플랜지 두께  높이 가운데
 *   H     웹 길이(z, 두 날개 사이)  두 날개 두께 합   날개 높이(y)  웹 두께(y)   —             중심
 *         (I 를 옆으로 눕힌 모양: 날개가 y 방향 세로판, 웹이 z 방향 가로판)
 *   T     플랜지 폭(z)    전체 높이(y)     플랜지 두께       웹 두께          —             플랜지 두께 가운데, 웹은 −y 로
 *   L     가로 다리 폭(+z) 세로 다리 높이(+y) 가로 다리 두께(y) 세로 다리 두께(z) —           두 다리 중심선의 교점
 *   CHAN  플랜지 폭(+z)   전체 높이(y)     웹 두께(z)        플랜지 두께(y)   —             웹 바깥면 · 높이 가운데
 *
 * 근사(approx): v2 변환은 PBAR·PBEAM(형상 없음)을 BAR [√A, √A], PROD 를 ROD [√(A/π)] 로 준다.
 * v1 파일은 그 값이 없어 여기서 같은 규칙으로 만든다(CONROD 는 카드의 A).
 * 모르는 형상(I1·T2·Z·HAT 등)은 앞 두 DIM 으로 만든 상자(BAR 와 같은 축)로, DIM 이 없으면 선으로 둔다.
 */

export const ROUND_SEGMENTS = 20;
/** 단면 종류(색 기준·범례 순서). OTHER = 모르는 형상의 상자 근사. */
export const SECTION_TYPES = ['L', 'I', 'H', 'T', 'BOX', 'CHAN', 'TUBE', 'ROD', 'BAR', 'OTHER'];
const KNOWN = new Set(SECTION_TYPES);

const pos = (v) => Number.isFinite(v) && v > 0;

/**
 * 속성 → 단면 { type, dims, approx, shape } | null(선으로 그린다).
 * type 은 SECTION_TYPES 중 하나(모르는 형상은 'OTHER', shape 에 원래 이름).
 */
export function sectionOf(prop, card, conrod) {
  if (card === 'CBUSH') return null;
  if (card === 'CONROD') {
    const A = conrod?.A;
    return pos(A) ? { type: 'ROD', dims: [Math.sqrt(A / Math.PI)], approx: true, shape: 'ROD' } : null;
  }
  if (!prop) return null;
  const dims = Array.isArray(prop.dims) ? prop.dims.filter((v) => Number.isFinite(v)) : [];
  const shape = (prop.type || '').toUpperCase();
  if (shape && dims.length && dims.some(pos)) {
    const type = shape === 'TUBE2' ? 'TUBE' : KNOWN.has(shape) ? shape : 'OTHER';
    // TUBE2 = 바깥 반지름 + 두께 → TUBE 규약으로 바꾼다.
    const d = shape === 'TUBE2' ? [dims[0], Math.max((dims[0] || 0) - (dims[1] || 0), 0)] : dims;
    return { type, dims: d, approx: !!prop.approx || type === 'OTHER', shape };
  }
  const A = prop.A;
  if (!pos(A)) return null;
  if (prop.card === 'PROD') return { type: 'ROD', dims: [Math.sqrt(A / Math.PI)], approx: true, shape: 'ROD' };
  if (prop.card === 'PBAR' || prop.card === 'PBEAM') {
    const s = Math.sqrt(A);
    return { type: 'BAR', dims: [s, s], approx: true, shape: 'BAR' };
  }
  return null;
}

/** 같은 단면끼리 InstancedMesh 하나를 쓰도록 묶는 열쇠. */
export function sectionKey(sec) {
  return sec ? `${sec.type}:${sec.dims.map((v) => Number(v.toPrecision(6))).join('x')}` : '';
}

function circle(r, n = ROUND_SEGMENTS) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    out.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return out;
}

function rect(y0, y1, z0, z1) {
  return [[y0, z0], [y0, z1], [y1, z1], [y1, z0]];
}

/** 두께가 바깥 크기를 넘지 않게(잘못된 입력에서도 꼬인 윤곽을 만들지 않는다). */
const clampT = (t, limit) => Math.min(Math.max(t || 0, 0), limit * 0.98);

/**
 * 단면 윤곽. outer = 바깥 다각형, hole = 안쪽 구멍(TUBE·BOX) 또는 null. 점 = [y, z].
 * 크기가 0 이하인 단면은 null.
 */
export function sectionProfile(type, dims) {
  const d = (i, fallback = 0) => (Number.isFinite(dims?.[i]) ? dims[i] : fallback);
  switch (type) {
    case 'ROD': {
      const r = d(0);
      return pos(r) ? { outer: circle(r), hole: null, round: true } : null;
    }
    case 'TUBE': {
      const ro = d(0);
      if (!pos(ro)) return null;
      const ri = clampT(d(1), ro);
      return { outer: circle(ro), hole: ri > 0 ? circle(ri) : null, round: true };
    }
    case 'BAR': {
      const w = d(0); const h = d(1, w);
      if (!pos(w) || !pos(h)) return null;
      return { outer: rect(-h / 2, h / 2, -w / 2, w / 2), hole: null, round: false };
    }
    case 'BOX': {
      const w = d(0); const h = d(1);
      if (!pos(w) || !pos(h)) return null;
      const th = clampT(d(2), h / 2); const tw = clampT(d(3), w / 2);
      const hole = th > 0 && tw > 0 ? rect(-h / 2 + th, h / 2 - th, -w / 2 + tw, w / 2 - tw) : null;
      return { outer: rect(-h / 2, h / 2, -w / 2, w / 2), hole, round: false };
    }
    case 'I': {
      const h = d(0); const bb = d(1); const bt = d(2, bb);
      if (!pos(h) || !pos(bb)) return null;
      const tw = clampT(d(3), Math.min(bb, bt || bb));
      const tb = clampT(d(4), h / 2); const tt = clampT(d(5, tb), h / 2);
      const y0 = -h / 2; const y1 = y0 + tb; const y3 = h / 2; const y2 = y3 - tt;
      // 아래 플랜지 → 웹 → 위 플랜지, 반시계(오른쪽 아래부터)
      return {
        outer: [
          [y0, -bb / 2], [y0, bb / 2], [y1, bb / 2], [y1, tw / 2], [y2, tw / 2], [y2, bt / 2],
          [y3, bt / 2], [y3, -bt / 2], [y2, -bt / 2], [y2, -tw / 2], [y1, -tw / 2], [y1, -bb / 2],
        ],
        hole: null, round: false,
      };
    }
    case 'H': {
      const wi = d(0); const wo = d(1); const hall = d(2);
      if (!pos(wi) || !pos(wo) || !pos(hall)) return null;
      const hi = clampT(d(3), hall);
      const z1 = wi / 2; const z2 = (wi + wo) / 2;
      const ya = hall / 2; const yb = hi / 2;
      return {
        outer: [
          [-ya, -z2], [-ya, -z1], [-yb, -z1], [-yb, z1], [-ya, z1], [-ya, z2],
          [ya, z2], [ya, z1], [yb, z1], [yb, -z1], [ya, -z1], [ya, -z2],
        ],
        hole: null, round: false,
      };
    }
    case 'T': {
      const bf = d(0); const h = d(1);
      if (!pos(bf) || !pos(h)) return null;
      const tf = clampT(d(2), h); const tw = clampT(d(3), bf);
      const top = tf / 2; const under = -tf / 2; const bottom = -h + tf / 2;
      return {
        outer: [
          [top, -bf / 2], [under, -bf / 2], [under, -tw / 2], [bottom, -tw / 2],
          [bottom, tw / 2], [under, tw / 2], [under, bf / 2], [top, bf / 2],
        ],
        hole: null, round: false,
      };
    }
    case 'L': {
      const b = d(0); const h = d(1);
      if (!pos(b) || !pos(h)) return null;
      const tf = clampT(d(2), h); const tw = clampT(d(3), b);
      // 원점 = 두 다리 중심선의 교점. 모서리는 (y=−tf/2, z=−tw/2).
      return {
        outer: [
          [-tf / 2, -tw / 2], [-tf / 2, b - tw / 2], [tf / 2, b - tw / 2],
          [tf / 2, tw / 2], [h - tf / 2, tw / 2], [h - tf / 2, -tw / 2],
        ],
        hole: null, round: false,
      };
    }
    case 'CHAN': {
      const b = d(0); const h = d(1);
      if (!pos(b) || !pos(h)) return null;
      const tw = clampT(d(2), b); const tf = clampT(d(3), h / 2);
      const ya = h / 2;
      return {
        outer: [
          [-ya, 0], [-ya, b], [-ya + tf, b], [-ya + tf, tw],
          [ya - tf, tw], [ya - tf, b], [ya, b], [ya, 0],
        ],
        hole: null, round: false,
      };
    }
    default: {
      // 모르는 형상 — 앞 두 DIM 으로 상자(BAR 와 같은 축: DIM1 = z, DIM2 = y)
      const w = d(0); const h = d(1, w);
      if (!pos(w) || !pos(h)) return null;
      return { outer: rect(-h / 2, h / 2, -w / 2, w / 2), hole: null, round: false };
    }
  }
}

/** 윤곽의 경계 상자 — 시험과 프레이밍에 쓴다. */
export function profileBounds(profile) {
  let ymin = Infinity; let ymax = -Infinity; let zmin = Infinity; let zmax = -Infinity;
  for (const [y, z] of profile.outer) {
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
    if (z < zmin) zmin = z;
    if (z > zmax) zmax = z;
  }
  return { ymin, ymax, zmin, zmax };
}

/** 다각형 넓이(신발끈 공식, 부호 = 감는 방향). */
export function polygonArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [y1, z1] = points[i];
    const [y2, z2] = points[(i + 1) % points.length];
    s += y1 * z2 - y2 * z1;
  }
  return s / 2;
}
