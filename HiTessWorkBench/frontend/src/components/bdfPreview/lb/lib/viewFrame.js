/**
 * 시점 프리셋과 화면 맞춤(설계 §7.3). 모델은 원점 중심으로 옮겨져 있다(modelGeometry).
 * 평면도는 화면 →X·↑Y(WorkBench Studio 들과 같은 결정, 2026-10-01).
 * 단축키: 기존 I·1·2·3 에 Studio 의 A(평면)·S(정면)·D(측면)를 더했다(F = 화면 맞춤).
 */
export const VIEW_PRESETS = {
  iso: { label: 'ISO', key: 'i', keys: ['i'], dir: [1, -1, 0.75], up: [0, 0, 1] },
  front: { label: '정면', key: '1', keys: ['1', 's'], dir: [0, -1, 0], up: [0, 0, 1] },
  side: { label: '측면', key: '2', keys: ['2', 'd'], dir: [1, 0, 0], up: [0, 0, 1] },
  top: { label: '평면', key: '3', keys: ['3', 'a'], dir: [0, 0, 1], up: [0, 1, 0] },
};

/** 글자 → 프리셋 id. */
export const VIEW_KEYS = Object.fromEntries(
  Object.entries(VIEW_PRESETS).flatMap(([id, p]) => p.keys.map((k) => [k, id])),
);

/** 직교 카메라 틀 — 중심에서 dir 방향 radius*4, 세로 반폭 radius*1.08(좁은 화면은 가로 기준). */
export function computeFrame(preset, radius, aspect) {
  const n = Math.hypot(...preset.dir);
  const dist = radius * 4;
  const position = preset.dir.map((v) => (v / n) * dist);
  let halfHeight = radius * 1.08;
  let halfWidth = halfHeight * aspect;
  if (aspect < 1) {
    halfWidth = radius * 1.08;
    halfHeight = halfWidth / aspect;
  }
  return { position, up: preset.up, halfHeight, halfWidth, near: -radius * 20, far: dist + radius * 20 };
}

/**
 * 원근 카메라 거리 — 반지름 r 인 구가 세로 시야각 fov(도) 안에 1.08 배 여백으로 들어오는 거리.
 * 좁은 화면(aspect < 1)은 가로 시야각으로 잰다.
 */
export function perspectiveDistance(radius, fovDeg, aspect) {
  const half = (fovDeg * Math.PI) / 360;
  const vHalf = aspect < 1 ? Math.atan(Math.tan(half) * aspect) : half;
  return (radius * 1.08) / Math.sin(vHalf);
}

/** 절점 순번들의 경계 — { center, radius } (뷰어 좌표). 없으면 null. 최소 반지름은 minRadius. */
export function nodeBounds(positions, indices, minRadius = 0) {
  let n = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const take = (i) => {
    for (let k = 0; k < 3; k += 1) {
      const v = positions[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
    n += 1;
  };
  if (typeof indices === 'function') {
    const total = positions.length / 3;
    for (let i = 0; i < total; i += 1) if (indices(i)) take(i);
  } else {
    for (const i of indices) take(i);
  }
  if (!n) return null;
  const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  const radius = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, minRadius, 1e-6);
  return { center, radius };
}
