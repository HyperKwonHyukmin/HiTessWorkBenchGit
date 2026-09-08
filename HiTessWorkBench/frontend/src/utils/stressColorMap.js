/**
 * 요소 응력 -> 정점 색 배열.
 *
 * 컴포넌트에서 분리한 이유: 여기서 인덱스가 한 칸만 어긋나도 **화면은 멀쩡해 보이는데
 * 붉은 부재가 실제 과응력 부재가 아니게 된다.** 눈으로는 못 잡는 실패라 테스트가 필요하다.
 */

// 색 구간 — 사용률(응력/허용응력) 기준. 허용 초과는 단일 빨강으로 못 박아
// "초과했다"가 색조 차이가 아니라 색 자체로 읽히게 한다.
export const RAMP = [
  [0.00, [37, 99, 235]],    // 파랑
  [0.35, [8, 145, 178]],    // 청록
  [0.60, [22, 163, 74]],    // 초록
  [0.85, [234, 179, 8]],    // 노랑
  [1.00, [249, 115, 22]],   // 주황 — 허용응력 도달
];
export const OVER_COLOR = [220, 38, 38];      // 초과
export const NO_DATA_COLOR = [100, 116, 139]; // 응력 결과가 없는 요소
export const DIMMED_COLOR = [51, 65, 85];     // '초과만 보기' 에서 가라앉힌 요소
export const HIGHLIGHT_COLOR = [255, 255, 255]; // 표에서 고른 부재

/** 사용률 -> RGB(0~255). 1.0 초과는 구간 보간 없이 빨강. */
export function usageColor(usage) {
  if (usage > 1) return OVER_COLOR;
  const u = Math.max(0, usage);
  for (let i = 1; i < RAMP.length; i += 1) {
    const [t1, c1] = RAMP[i];
    if (u > t1) continue;
    const [t0, c0] = RAMP[i - 1];
    const k = t1 === t0 ? 0 : (u - t0) / (t1 - t0);
    return [0, 1, 2].map(j => c0[j] + (c1[j] - c0[j]) * k);
  }
  return RAMP[RAMP.length - 1][1];
}

/**
 * 빔 선분마다 양 끝 정점 2개 × RGB 3 = 6 개 값.
 *
 * FeModelViewer 가 beamColors 를 받으면 인덱스를 풀어 선분마다 정점을 복제하므로,
 * 여기서도 **선분 순서(beams 쌍 = beamIds 원소)** 를 그대로 따라야 한다.
 *
 * @param {number[]} beams     절점 인덱스 쌍의 평탄 배열 [a0,b0, a1,b1, ...]
 * @param {number[]} beamIds   선분과 1:1 대응하는 BDF 요소 ID
 * @param {Map<number,{usage:number}>} usageOf  요소 ID -> 응력 레코드
 * @param {{onlyExceed?: boolean, highlightElementId?: number}} opts
 */
export function buildBeamColors(beams, beamIds, usageOf,
  { onlyExceed = false, highlightElementId = null } = {}) {
  if (!beams?.length || !beamIds?.length) return null;
  const segments = beams.length / 2;
  // 길이가 어긋나면 색이 통째로 밀린다 — 조용히 그리느니 멈춘다.
  if (beamIds.length !== segments) {
    throw new Error(`beamIds(${beamIds.length}) 와 빔 선분(${segments}) 개수가 다릅니다.`);
  }

  const out = new Float32Array(segments * 6);
  for (let s = 0; s < segments; s += 1) {
    const rec = usageOf.get(beamIds[s]);
    let rgb;
    // 표에서 고른 부재는 사용률과 무관하게 흰색 — 색맵 안에서 "이것" 을 짚어야 한다.
    if (highlightElementId != null && beamIds[s] === highlightElementId) rgb = HIGHLIGHT_COLOR;
    else if (!rec) rgb = NO_DATA_COLOR;
    else if (onlyExceed && rec.usage <= 1) rgb = DIMMED_COLOR;
    else rgb = usageColor(rec.usage);
    for (let v = 0; v < 2; v += 1) {
      out[s * 6 + v * 3]     = rgb[0] / 255;
      out[s * 6 + v * 3 + 1] = rgb[1] / 255;
      out[s * 6 + v * 3 + 2] = rgb[2] / 255;
    }
  }
  return out;
}

/** 요소 배열 -> 조회용 Map. */
export function indexByElementId(elements) {
  const map = new Map();
  (elements || []).forEach(e => map.set(e.elementId, e));
  return map;
}

/** 특정 요소가 붙은 선분의 중점(모델 좌표). 없으면 null. */
export function elementMidpoint(model, elementId) {
  const idx = model?.beamIds?.indexOf(elementId) ?? -1;
  if (idx < 0) return null;
  const p = model.positions;
  const a = model.beams[idx * 2] * 3;
  const b = model.beams[idx * 2 + 1] * 3;
  return {
    x: (p[a] + p[b]) / 2,
    y: (p[a + 1] + p[b + 1]) / 2,
    z: (p[a + 2] + p[b + 2]) / 2,
  };
}


/* ────────────────────────────────────────────────────────────────────────
   변위 — 절점 값이라 응력(요소 값)과 다루는 방식이 다르다.
   부재 하나가 한 색인 응력과 달리, 변위는 절점마다 값이 있으므로 선분의 두 정점을
   서로 다른 색으로 칠해 부재를 따라 색이 이어지게 한다(상용 후처리기와 같은 표현).
   ──────────────────────────────────────────────────────────────────────── */

/** 값 -> RGB(0~255). lo..hi 를 램프 전체에 선형으로 편다. */
export function rampColor(value, lo, hi) {
  const span = hi - lo;
  const t = span > 0 ? (value - lo) / span : 0;
  const u = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i += 1) {
    const [t1, c1] = RAMP[i];
    if (u > t1) continue;
    const [t0, c0] = RAMP[i - 1];
    const k = t1 === t0 ? 0 : (u - t0) / (t1 - t0);
    return [0, 1, 2].map(j => c0[j] + (c1[j] - c0[j]) * k);
  }
  return RAMP[RAMP.length - 1][1];
}

/**
 * 절점 값으로 빔 정점 색을 만든다.
 *
 * @param {number[]} beams        절점 인덱스 쌍 [a0,b0, a1,b1, ...]
 * @param {Float64Array|number[]} nodeValues  positions 인덱스와 같은 순서의 절점 값
 * @param {{lo:number, hi:number, highlightSegments?: Set<number>}} range
 */
export function buildNodalBeamColors(beams, nodeValues, { lo, hi, highlightSegments } = {}) {
  if (!beams?.length || !nodeValues) return null;
  const segments = beams.length / 2;
  const out = new Float32Array(segments * 6);
  for (let s = 0; s < segments; s += 1) {
    const hit = highlightSegments?.has(s);
    for (let v = 0; v < 2; v += 1) {
      const node = beams[s * 2 + v];
      const rgb = hit ? HIGHLIGHT_COLOR : rampColor(nodeValues[node] ?? 0, lo, hi);
      out[s * 6 + v * 3]     = rgb[0] / 255;
      out[s * 6 + v * 3 + 1] = rgb[1] / 255;
      out[s * 6 + v * 3 + 2] = rgb[2] / 255;
    }
  }
  return out;
}

/**
 * 절점 변위 목록 -> positions 인덱스 순서의 배열들.
 *
 * 변위는 **절점 ID** 로 오고 지오메트리는 **positions 인덱스** 로 그린다.
 * 그 사이를 nodeIds 가 잇는데, 여기가 어긋나면 엉뚱한 절점이 움직인다.
 *
 * @returns {{ tx, ty, tz, mag }} 각각 Float64Array(nodeCount)
 */
export function nodalDisplacementArrays(model, displacementNodes) {
  const count = model?.nodeIds?.length || 0;
  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  const tz = new Float64Array(count);
  const mag = new Float64Array(count);
  if (!count || !displacementNodes?.length) return { tx, ty, tz, mag };

  const indexOf = new Map();
  model.nodeIds.forEach((id, i) => indexOf.set(id, i));
  displacementNodes.forEach((d) => {
    const i = indexOf.get(d.nodeId);
    if (i === undefined) return;   // 이 모델에 없는 절점(있어서는 안 되지만 조용히 무시)
    tx[i] = d.t1; ty[i] = d.t2; tz[i] = d.t3;
    mag[i] = d.mag ?? Math.hypot(d.t1, d.t2, d.t3);
  });
  return { tx, ty, tz, mag };
}

/** 원형상 + 배율×변위 = 변형 형상 좌표. */
export function deformedPositions(positions, { tx, ty, tz }, scale) {
  const out = Float32Array.from(positions);
  const count = Math.min(out.length / 3, tx.length);
  for (let i = 0; i < count; i += 1) {
    out[i * 3]     += tx[i] * scale;
    out[i * 3 + 1] += ty[i] * scale;
    out[i * 3 + 2] += tz[i] * scale;
  }
  return out;
}

/**
 * 기본 변형 배율 — 최대 변위가 모델 크기의 targetRatio 만큼 보이게 한다.
 * 모델 크기·하중이 달라도 화면에서 항상 읽히는 정도로 과장된다.
 */
export function autoDeformScale(modelBounds, maxMagMm, targetRatio = 0.05) {
  if (!modelBounds || !(maxMagMm > 0)) return 1;
  const { min, max } = modelBounds;
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!(diagonal > 0)) return 1;
  return (diagonal * targetRatio) / maxMagMm;
}
