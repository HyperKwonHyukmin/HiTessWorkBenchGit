/**
 * 러그 설계 JSON(lugshell/0.2) → 판별 외곽 점 목록 (2026-11-12, 표준집 러그 치수 편집 화면).
 *
 * 설계 JSON 의 판 = plane(origin, u, v) + outline(start + segments: line | arc{center, ccw}).
 * 원호 방향 규칙은 엔진 lugshell/geom.py sweep() 과 같다 — ccw 면 끝 각도가 시작보다 커질 때까지 2π 를 더한다.
 * 메시가 아니라 '형상' 만 그린다. 메시는 해석 실행 때 엔진이 만든다.
 */

const TAU = Math.PI * 2;

/** 원호 시작·끝 각도 (엔진 geom.sweep 사본) */
export function sweep(p0, p1, c, ccw) {
  const a0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
  let a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  if (ccw && a1 <= a0) a1 += TAU;
  if (!ccw && a1 >= a0) a1 -= TAU;
  return [a0, a1];
}

/** 외곽 루프 → 2D 점 목록(닫는 점 제외). 원호는 stepDeg 간격으로 나눈다. */
export function loopPoints(loop, stepDeg = 5) {
  if (loop.circle) {
    const [cx, cy] = loop.circle;
    const r = loop.d / 2;
    const n = Math.max(12, Math.ceil(360 / stepDeg));
    return Array.from({ length: n }, (_, k) => [cx + r * Math.cos((TAU * k) / n), cy + r * Math.sin((TAU * k) / n)]);
  }
  const pts = [loop.start.slice()];
  let prev = loop.start;
  for (const s of loop.segments) {
    const end = s.line || s.arc;
    if (s.arc) {
      const c = s.center;
      const r = Math.hypot(prev[0] - c[0], prev[1] - c[1]);
      const [a0, a1] = sweep(prev, end, c, s.ccw);
      const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / ((stepDeg * Math.PI) / 180)));
      for (let k = 1; k < n; k += 1) {
        const t = a0 + ((a1 - a0) * k) / n;
        pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
      }
    }
    pts.push(end.slice());
    prev = end;
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < 1e-6) pts.pop();
  return pts;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** 설계 JSON → [{ id, role, t, origin, u, v, n, outline:[[u,v]…], holes:[[[u,v]…]] }] */
export function designToPlates(design, stepDeg = 5) {
  const pin = design?.pin;
  return (design?.plates || []).map((p) => {
    const { origin, u, v } = p.plane;
    const n = cross(u, v);
    const holes = [];
    if (pin && (pin.plates || []).includes(p.id)) {
      const rel = sub(pin.center, origin);
      holes.push(loopPoints({ circle: [dot(rel, u), dot(rel, v)], d: pin.hole_d }, stepDeg));
    }
    for (const h of p.holes || []) holes.push(loopPoints(h, stepDeg));
    return { id: p.id, role: p.role, t: p.t, origin, u, v, n, outline: loopPoints(p.outline, stepDeg), holes };
  });
}

/** 판 점들의 3D 상자 (카메라 맞추기용) → { min, max, center, size } */
export function plateBounds(plates) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of plates) {
    for (const [a, b] of p.outline) {
      for (let i = 0; i < 3; i += 1) {
        const x = p.origin[i] + a * p.u[i] + b * p.v[i];
        if (x < min[i]) min[i] = x;
        if (x > max[i]) max[i] = x;
      }
    }
  }
  if (!plates.length) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: 0 };
  const center = min.map((m, i) => (m + max[i]) / 2);
  const size = Math.max(...max.map((m, i) => m - min[i]));
  return { min, max, center, size };
}

/** 화면 치수 표 — 숫자 칸 값 다듬기. 빈 칸·숫자 아님은 null(엔진이 '비어 있음' 으로 알림). */
export function parseFieldValue(field, raw) {
  if (field.kind === 'text') return String(raw ?? '').trim() || null;
  if (raw === '' || raw == null) return null;
  const x = Number(String(raw).replace(',', '.'));
  return Number.isFinite(x) ? x : null;
}

/** 표준집 값과 다른 칸 이름 목록 */
export function changedFields(base, values) {
  return Object.keys(values).filter((k) => String(base?.[k] ?? '') !== String(values[k] ?? ''));
}

/**
 * 고정 경계 → 3D 선 목록 [[p0, p1]…] (설계 JSON boundary 의 where='region': 판의 v ≤ v_max 구간).
 * 판 외곽 점 중 v 가 v_max 이하인 점들의 u 범위를 v_max 높이의 선 하나로 그린다(바닥 고정 표시용).
 */
export function boundaryLines(design, stepDeg = 5) {
  const plates = new Map(designToPlates(design, stepDeg).map((p) => [p.id, p]));
  const out = [];
  for (const b of design?.boundary || []) {
    if (b.where !== 'region' || b.kind !== 'fixed') continue;
    const p = plates.get(b.plate);
    if (!p) continue;
    const vmax = Number(b.v_max ?? 0);
    const us = p.outline.filter(([, v]) => v <= vmax + 1e-6).map(([u]) => u);
    if (us.length < 2) continue;
    const at = (u) => [0, 1, 2].map((i) => p.origin[i] + u * p.u[i] + vmax * p.v[i]);
    out.push({ plate: p.id, line: [at(Math.min(...us)), at(Math.max(...us))] });
  }
  return out;
}

/**
 * 설계 JSON → utils/lugshellEdits 가 읽는 요약 모양 { cases, swl_t, pin_d, pin_center, g }.
 * 표준집 치수 편집의 '하중 및 경계' 단계가 결과 화면 '하중 값 고치기' 와 같은 검사·화살표 규칙을 쓰게 한다.
 */
export function designLoadSummary(design) {
  const cases = (design?.load_cases || []).map((c) => ({
    id: c.id, swl_t: c.swl_t, daf: c.daf, alpha_deg: c.alpha_deg, beta_deg: c.beta_deg,
  }));
  return {
    cases,
    swl_t: cases[0]?.swl_t,
    pin_d: design?.pin?.pin_d,
    pin_center: design?.pin?.center,
    g: design?.analysis?.g ?? 9.81,
  };
}

/** 하중 케이스 색 — 3D 화살표와 화면 표의 색 점이 같은 순서로 쓴다 */
export const LOAD_COLORS = ['#2563eb', '#16a34a', '#9333ea', '#d97706', '#0891b2', '#db2777', '#4d7c0f', '#475569'];
