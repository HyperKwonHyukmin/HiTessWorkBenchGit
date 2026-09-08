import { rampColor } from './stressColorMap.js';

/**
 * Leg 반력 **개요도**를 화면용 지오메트리로 만든다.
 *
 * ⚠ 이것은 해석 모델이 아니다. 해석은 정반 실형상 + Module Unit 합본(GRID 4만여 개)으로
 *   푸는데, 그 덩어리를 여기 띄우면 정작 보려는 것 — 어느 Leg 에 얼마가 걸렸나 — 이
 *   묻힌다. 그래서 반력이 나온 자리만 뽑아 그린다.
 *
 *   합산 무게중심(CoG) ┈┈(표시선)┈┈ Leg 기둥 상단 ──기둥── Leg 절점(SPC = 용접부)
 *
 * CoG 에서 뻗는 선은 하중이 어느 쪽으로 쏠렸는지 읽으라고 그은 **표시선**이다.
 * 합본 모델에는 그런 강체가 없다 — 하중은 정반 구조 전체를 거쳐 Leg 로 내려간다.
 * 기둥은 정반 실물 그대로다: 하단이 Leg 절점(용접부), 상단이 Module Unit 을 받는
 * rigid 절점 높이(zTopMm)다.
 *
 * 절점 순서를 고정해 두는 것이 중요하다 — 뷰어의 클릭은 **positions 인덱스**로 돌아오고,
 * 그 인덱스를 다시 Leg 로 되짚어야 "찍은 자리의 반력"을 띄울 수 있다.
 *
 *   index 0            : CoG
 *   index 1 + 2*i      : i 번째 Leg 기둥 상단
 *   index 2 + 2*i      : i 번째 Leg 기둥 하단(용접부)
 */

/** 정반 A/B 실측 기둥 높이 [mm]. zTopMm 이 없는 옛 결과에만 쓴다. */
export const DEFAULT_COLUMN_HEIGHT_MM = 2145;

/** Leg 기둥 상단의 z. 결과가 zTopMm 을 실어 주면 그것이 해석에 쓰인 실제 높이다. */
export function legTopZ(leg, fallbackHeightMm = DEFAULT_COLUMN_HEIGHT_MM) {
  const z = Number.isFinite(leg?.z) ? leg.z : 0;
  return Number.isFinite(leg?.zTopMm) ? leg.zTopMm : z + fallbackHeightMm;
}

export const COG_INDEX = 0;
export const legTopIndex = (i) => 1 + i * 2;
export const legBottomIndex = (i) => 2 + i * 2;

/** positions 인덱스 -> Leg 순번(0-based). CoG 를 찍었으면 null. */
export function legIndexFromNodeIndex(index) {
  if (index === null || index === undefined || index <= COG_INDEX) return null;
  return Math.floor((index - 1) / 2);
}

/**
 * @param {Array} legs   결과의 legReaction.legs (x, y, z, zTopMm, 반력 포함)
 * @param {number[]} cogMm  합산 무게중심 [x, y, z]
 * @param {number} fallbackHeightMm  zTopMm 이 없는 옛 결과를 그릴 때의 기둥 높이
 */
export function buildLegReactionModel(legs, cogMm, fallbackHeightMm = DEFAULT_COLUMN_HEIGHT_MM) {
  if (!legs?.length || !cogMm) return null;

  const positions = [cogMm[0], cogMm[1], cogMm[2]];
  const nodeIds = [9999];
  const beams = [];    // 정반 Leg 기둥
  const rigids = [];   // CoG -> 기둥 상단 (표시선)

  legs.forEach((leg, i) => {
    const z = Number.isFinite(leg.z) ? leg.z : 0;
    positions.push(leg.x, leg.y, legTopZ(leg, fallbackHeightMm));
    positions.push(leg.x, leg.y, z);
    // 기둥 두 절점 모두 그 Leg 의 정반 절점 번호로 표시한다 — 상단(rigid 절점)의
    // 실제 번호는 결과에 실려 오지 않고, 화면에서 알아야 할 것은 "어느 Leg 인가" 다.
    nodeIds.push(leg.jungbanNodeId, leg.jungbanNodeId);
    beams.push(legTopIndex(i), legBottomIndex(i));
    rigids.push(COG_INDEX, legTopIndex(i));
  });

  const xs = positions.filter((_, i) => i % 3 === 0);
  const ys = positions.filter((_, i) => i % 3 === 1);
  const zs = positions.filter((_, i) => i % 3 === 2);

  return {
    name: 'Leg 반력 모델',
    positions,
    nodeIds,
    beams,
    rigids,
    quads: [],
    trias: [],
    nodeCount: nodeIds.length,
    beamCount: beams.length / 2,
    rigidCount: rigids.length / 2,
    quadCount: 0,
    triaCount: 0,
    bounds: {
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    },
  };
}

/**
 * 기둥 빔 색 — 합력 크기 기준. 어느 Leg 가 많이 받는지 색으로 먼저 읽히게 한다.
 * 선택한 Leg 는 흰색으로 짚는다.
 */
export function buildLegBeamColors(legs, { selectedIndex = null } = {}) {
  if (!legs?.length) return null;
  const values = legs.map(l => Math.abs(l.resultantN));
  const hi = Math.max(...values, 1);
  const out = new Float32Array(legs.length * 6);
  legs.forEach((leg, i) => {
    const rgb = i === selectedIndex ? [255, 255, 255] : rampColor(Math.abs(leg.resultantN), 0, hi);
    for (let v = 0; v < 2; v += 1) {
      out[i * 6 + v * 3]     = rgb[0] / 255;
      out[i * 6 + v * 3 + 1] = rgb[1] / 255;
      out[i * 6 + v * 3 + 2] = rgb[2] / 255;
    }
  });
  return out;
}

/**
 * 반력 벡터 화살표(선분)의 양 끝점.
 *
 * 반력은 절점이 구조를 **떠받치는** 힘이라 위로 향한다. 길이는 최대 합력이
 * `targetLenMm` 이 되도록 정규화한다 — 실제 N 값을 mm 로 그리면 화면 밖으로 나간다.
 */
export function buildReactionArrows(legs, scaleRefMm = DEFAULT_COLUMN_HEIGHT_MM, targetLenMm = null) {
  if (!legs?.length) return [];
  const hi = Math.max(...legs.map(l => Math.abs(l.resultantN)), 1);
  const target = targetLenMm ?? scaleRefMm;
  return legs.map((leg, i) => {
    // 반력은 SPC 절점 = 기둥 하단(용접부)에서 나온다.
    const z = Number.isFinite(leg.z) ? leg.z : 0;
    const k = target / hi;
    return {
      index: i,
      from: [leg.x, leg.y, z],
      to: [leg.x + leg.fxN * k, leg.y + leg.fyN * k, z + leg.fzN * k],
    };
  });
}

/** N -> kN 표시용. */
export const kN = (n) => (n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });

/** N·mm -> kN·m 표시용.
 *
 * ⚠ kN() 을 모멘트에 쓰면 안 된다. 반력 모멘트의 단위는 **N·mm** 라 1e3 으로 나누면
 *   N·m 가 나오는데 화면 라벨은 kN·m 였다 — 값이 1,000배 커 보였다(실제 버그).
 */
export const kNm = (nmm) => (nmm / 1.0e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
