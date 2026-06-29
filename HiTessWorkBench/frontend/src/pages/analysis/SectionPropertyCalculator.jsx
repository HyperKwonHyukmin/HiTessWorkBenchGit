import React, { useState, useMemo } from 'react';
import axios from 'axios';
import {
  PenTool, Calculator, AlertCircle, Loader2, Plus, Trash2, Ruler, Layers, CheckCircle2,
  BarChart3,
} from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useAuth } from '../../contexts/AuthContext';
import AnalysisPageBanner from '../../components/analysis/AnalysisPageBanner';
import { API_BASE_URL } from '../../config';
import SolverCredit from '../../components/ui/SolverCredit';

// ── 단면 정의 ───────────────────────────────────────────────────
const SHAPES = [
  {
    key: 'rod', label: 'Rod',
    icon: (
      <svg viewBox="-12 -12 24 24" width="28" height="28">
        <circle r="10" fill="#53d8fb" fillOpacity="0.6" stroke="#53d8fb" strokeWidth="1.5"/>
      </svg>
    ),
    params: [
      { key: 'd', label: '직경 (d)', unit: 'mm', min: 1, defaultValue: 100 },
    ],
  },
  {
    key: 'tube', label: 'Tube',
    icon: (
      <svg viewBox="-12 -12 24 24" width="28" height="28">
        <circle r="10" fill="none" stroke="#53d8fb" strokeWidth="2.5"/>
        <circle r="6" fill="none" stroke="#53d8fb" strokeWidth="1.5"/>
      </svg>
    ),
    params: [
      { key: 'd', label: '외경 (d)', unit: 'mm', min: 1, defaultValue: 216.3 },
      { key: 't', label: '두께 (t)', unit: 'mm', min: 1, defaultValue: 8 },
    ],
  },
  {
    key: 'rectangle', label: 'Rect',
    icon: (
      <svg viewBox="-12 -12 24 24" width="28" height="28">
        <rect x="-10" y="-8" width="20" height="16" fill="#53d8fb" fillOpacity="0.6" stroke="#53d8fb" strokeWidth="1.5"/>
      </svg>
    ),
    params: [
      { key: 'b', label: '폭 (b)',   unit: 'mm', min: 1, defaultValue: 100 },
      { key: 'h', label: '높이 (h)', unit: 'mm', min: 1, defaultValue: 150 },
    ],
  },
  {
    key: 'rectTube', label: 'R.Tube',
    icon: (
      <svg viewBox="-12 -12 24 24" width="28" height="28">
        <rect x="-10" y="-8" width="20" height="16" fill="none" stroke="#53d8fb" strokeWidth="2.5"/>
        <rect x="-6"  y="-4" width="12" height="8"  fill="none" stroke="#53d8fb" strokeWidth="1.2"/>
      </svg>
    ),
    params: [
      { key: 'b', label: '외폭 (b)',   unit: 'mm', min: 1, defaultValue: 150 },
      { key: 'h', label: '외높이 (h)', unit: 'mm', min: 1, defaultValue: 200 },
      { key: 't', label: '두께 (t)',   unit: 'mm', min: 1, defaultValue: 9 },
    ],
  },
  {
    key: 'ishape', label: 'I-Shape',
    icon: (
      <svg viewBox="-12 -12 24 24" width="28" height="28">
        <rect x="-10" y="-10" width="20" height="3" fill="#53d8fb" fillOpacity="0.8"/>
        <rect x="-2"  y="-7"  width="4"  height="14" fill="#53d8fb" fillOpacity="0.8"/>
        <rect x="-10" y="7"   width="20" height="3" fill="#53d8fb" fillOpacity="0.8"/>
      </svg>
    ),
    params: [
      { key: 'h',      label: '총 높이 (h)',              unit: 'mm', min: 1, defaultValue: 300 },
      { key: 'bf',     label: '플랜지 폭 (bf)',            unit: 'mm', min: 1, defaultValue: 150 },
      { key: 'tf',     label: '플랜지 두께 (tf)',          unit: 'mm', min: 1, defaultValue: 12 },
      { key: 'tw',     label: '웹 두께 (tw)',              unit: 'mm', min: 1, defaultValue: 7 },
      { key: 'bf_bot', label: '하부 플랜지 폭 (opt)', unit: 'mm', min: 0, defaultValue: 0 },
      { key: 'tf_bot', label: '하부 플랜지 두께 (opt)', unit: 'mm', min: 0, defaultValue: 0 },
    ],
  },
  {
    key: 'channel', label: 'Channel',
    icon: (
      <svg viewBox="-12 -12 24 24" width="28" height="28">
        <path d="M 6 -10 L -6 -10 L -6 10 L 6 10" fill="none" stroke="#53d8fb" strokeWidth="2.8" strokeLinejoin="round"/>
        <line x1="-6" y1="-8" x2="4" y2="-8" stroke="#53d8fb" strokeWidth="2"/>
        <line x1="-6" y1="8"  x2="4" y2="8"  stroke="#53d8fb" strokeWidth="2"/>
      </svg>
    ),
    params: [
      { key: 'h',  label: '총 높이 (h)',      unit: 'mm', min: 1, defaultValue: 200 },
      { key: 'b',  label: '플랜지 폭 (b)',    unit: 'mm', min: 1, defaultValue: 75 },
      { key: 'tf', label: '플랜지 두께 (tf)', unit: 'mm', min: 1, defaultValue: 11 },
      { key: 'tw', label: '웹 두께 (tw)',     unit: 'mm', min: 1, defaultValue: 7 },
    ],
  },
  {
    key: 'angle', label: 'Angle',
    icon: (
      <svg viewBox="-12 -12 24 24" width="28" height="28">
        <path d="M -8 -10 L -8 10 L 10 10" fill="none" stroke="#53d8fb" strokeWidth="2.8" strokeLinejoin="round"/>
      </svg>
    ),
    params: [
      { key: 'b', label: '수평 레그 폭 (b)',   unit: 'mm', min: 1, defaultValue: 100 },
      { key: 'h', label: '수직 레그 높이 (h)', unit: 'mm', min: 1, defaultValue: 100 },
      { key: 't', label: '두께 (t)',           unit: 'mm', min: 1, defaultValue: 10 },
    ],
  },
  {
    key: 'tee', label: 'Tee',
    icon: (
      <svg viewBox="-12 -12 24 24" width="28" height="28">
        <rect x="-10" y="-10" width="20" height="3" fill="#53d8fb" fillOpacity="0.8"/>
        <rect x="-2"  y="-7"  width="4"  height="17" fill="#53d8fb" fillOpacity="0.8"/>
      </svg>
    ),
    params: [
      { key: 'h',  label: '총 높이 (h)',      unit: 'mm', min: 1, defaultValue: 150 },
      { key: 'bf', label: '플랜지 폭 (bf)',   unit: 'mm', min: 1, defaultValue: 150 },
      { key: 'tf', label: '플랜지 두께 (tf)', unit: 'mm', min: 1, defaultValue: 10 },
      { key: 'tw', label: '스템 두께 (tw)',   unit: 'mm', min: 1, defaultValue: 6 },
    ],
  },
  {
    key: 'polygon', label: 'Polygon',
    icon: (
      <svg viewBox="-12 -12 24 24" width="28" height="28">
        <polygon
          points="0,-10 8,-5 8,5 0,10 -8,5 -8,-5"
          fill="#53d8fb" fillOpacity="0.4" stroke="#53d8fb" strokeWidth="1.5"
        />
      </svg>
    ),
    params: [],
  },
];

const DEFAULT_POLY = [
  { x: -50, y: -75 }, { x: 50, y: -75 },
  { x: 50, y: 75 },  { x: -50, y: 75 },
];

const DEFAULT_ATTACHED_PLATE = {
  bp: '800',
  tp: '10',
};

const RESULT_UNITS = {
  cm: {
    label: 'cm',
    length: 0.1,
    area: 0.01,
    volume: 0.001,
    inertia: 0.0001,
    warping: 0.000001,
  },
  mm: {
    label: 'mm',
    length: 1,
    area: 1,
    volume: 1,
    inertia: 1,
    warping: 1,
  },
};

const UNIT_LABELS = {
  length: { cm: 'cm', mm: 'mm' },
  area: { cm: 'cm²', mm: 'mm²' },
  volume: { cm: 'cm³', mm: 'mm³' },
  inertia: { cm: 'cm⁴', mm: 'mm⁴' },
  warping: { cm: 'cm⁶', mm: 'mm⁶' },
};

const MAX_POLY_VERTICES = 20;
const MIN_COORD = -5000;
const MAX_COORD = 5000;
const MIN_VERTEX_DIST = 1.0;

// ── 폴리곤 기하 유효성 검사 ────────────────────────────────────
function crossProduct(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsProperlyIntersect(p1, p2, p3, p4) {
  const d1 = crossProduct(p3, p4, p1);
  const d2 = crossProduct(p3, p4, p2);
  const d3 = crossProduct(p1, p2, p3);
  const d4 = crossProduct(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function validatePolygon(verts) {
  const errors = [];

  if (verts.length > MAX_POLY_VERTICES) {
    errors.push(`꼭짓점은 최대 ${MAX_POLY_VERTICES}개까지 허용됩니다 (현재 ${verts.length}개).`);
  }

  const outOfRange = verts.findIndex(v =>
    v.x < MIN_COORD || v.x > MAX_COORD || v.y < MIN_COORD || v.y > MAX_COORD
  );
  if (outOfRange !== -1) {
    errors.push(`꼭짓점 ${outOfRange + 1}: 좌표는 ${MIN_COORD}~${MAX_COORD} mm 범위 내여야 합니다.`);
  }

  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const dx = verts[i].x - verts[j].x;
      const dy = verts[i].y - verts[j].y;
      if (Math.sqrt(dx * dx + dy * dy) < MIN_VERTEX_DIST) {
        errors.push(`꼭짓점 ${i + 1}과 ${j + 1}이 너무 가깝습니다 (${MIN_VERTEX_DIST}mm 이상 이격 필요).`);
      }
    }
  }

  const n = verts.length;
  if (n >= 3) {
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
    }
    if (Math.abs(area / 2) < 10) {
      errors.push('폴리곤 면적이 너무 작습니다 (10 mm² 이상이어야 합니다). 꼭짓점이 거의 일직선 상에 있을 수 있습니다.');
    }

    const selfIntersections = [];
    for (let i = 0; i < n && selfIntersections.length < 3; i++) {
      const i2 = (i + 1) % n;
      for (let j = i + 2; j < n && selfIntersections.length < 3; j++) {
        const j2 = (j + 1) % n;
        if (i === 0 && j === n - 1) continue;
        if (segmentsProperlyIntersect(verts[i], verts[i2], verts[j], verts[j2])) {
          selfIntersections.push(`변 ${i + 1}-${i2 + 1}과 변 ${j + 1}-${j2 + 1}`);
        }
      }
    }
    if (selfIntersections.length > 0) {
      errors.push(`자기교차(Self-intersection) 발생: ${selfIntersections.join(', ')}. 폴리곤 변끼리 교차하면 안 됩니다.`);
    }

    const collinear = [];
    for (let i = 0; i < n && collinear.length < 2; i++) {
      const prev = verts[(i - 1 + n) % n];
      const curr = verts[i];
      const next = verts[(i + 1) % n];
      if (Math.abs(crossProduct(prev, curr, next)) < 1e-6) {
        collinear.push(i + 1);
      }
    }
    if (collinear.length > 0) {
      errors.push(`꼭짓점 ${collinear.join(', ')}이(가) 인접 변과 일직선입니다. 불필요한 꼭짓점을 제거하거나 위치를 조정하세요.`);
    }
  }

  return errors;
}

// ── 임의 형상 꼭짓점 편집기 ─────────────────────────────────────
function PolygonEditor({ vertices, onChange }) {
  const validationErrors = useMemo(() => validatePolygon(vertices), [vertices]);

  const update = (i, axis, raw) => {
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    onChange(vertices.map((v, idx) => idx === i ? { ...v, [axis]: val } : v));
  };

  const add = () => {
    if (vertices.length >= MAX_POLY_VERTICES) return;
    const last = vertices[vertices.length - 1] ?? { x: 0, y: 0 };
    onChange([...vertices, { x: last.x + 20, y: last.y }]);
  };

  const remove = (i) => {
    if (vertices.length <= 3) return;
    onChange(vertices.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="py-1.5 px-2 text-left text-[10px] font-bold text-slate-400 uppercase w-8">#</th>
              <th className="py-1.5 px-2 text-left text-[10px] font-bold text-slate-400 uppercase">X (mm)</th>
              <th className="py-1.5 px-2 text-left text-[10px] font-bold text-slate-400 uppercase">Y (mm)</th>
              <th className="w-8"/>
            </tr>
          </thead>
          <tbody>
            {vertices.map((v, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="py-1 px-2 text-[10px] text-slate-400 font-mono">{i + 1}</td>
                <td className="py-1 px-1">
                  <input
                    type="number"
                    step="0.1"
                    value={v.x}
                    onChange={e => update(i, 'x', e.target.value)}
                    className="w-full px-2 py-1 text-xs font-bold text-slate-800 border border-slate-200 rounded focus:border-violet-400 focus:outline-none bg-white"
                  />
                </td>
                <td className="py-1 px-1">
                  <input
                    type="number"
                    step="0.1"
                    value={v.y}
                    onChange={e => update(i, 'y', e.target.value)}
                    className="w-full px-2 py-1 text-xs font-bold text-slate-800 border border-slate-200 rounded focus:border-violet-400 focus:outline-none bg-white"
                  />
                </td>
                <td className="py-1 px-1">
                  <button
                    onClick={() => remove(i)}
                    disabled={vertices.length <= 3}
                    className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <Trash2 size={11}/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {validationErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 space-y-1">
          {validationErrors.map((msg, idx) => (
            <div key={idx} className="flex items-start gap-1.5">
              <AlertCircle size={11} className="text-red-500 mt-0.5 shrink-0"/>
              <span className="text-[10px] text-red-700 leading-tight">{msg}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={add}
          disabled={vertices.length >= MAX_POLY_VERTICES}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-200 hover:border-violet-300 hover:bg-violet-50 text-[11px] font-bold text-slate-500 hover:text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Plus size={11}/> 꼭짓점 추가 ({vertices.length}/{MAX_POLY_VERTICES})
        </button>
        <button
          onClick={() => onChange([...DEFAULT_POLY])}
          className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-[11px] font-bold text-slate-400 transition-colors cursor-pointer"
        >
          샘플
        </button>
      </div>
    </div>
  );
}

// ── 클라이언트 측 도심 정규화 (Green's theorem) ────────────────
function toCentroidalCoords(verts) {
  if (verts.length < 3) return null;
  let area = 0, cx = 0, cy = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = verts[i].x * verts[j].y - verts[j].x * verts[i].y;
    area += cross;
    cx += (verts[i].x + verts[j].x) * cross;
    cy += (verts[i].y + verts[j].y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-10) return null;
  cx /= 6 * area;
  cy /= 6 * area;
  return verts.map(v => ({ x: v.x - cx, y: v.y - cy }));
}

function getBounds(points) {
  if (!points || points.length === 0) return null;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  };
}

function makePlatePolygon(bp, tp, yBottom, cyShift = 0) {
  const left = -bp / 2;
  const right = bp / 2;
  const bottom = yBottom - cyShift;
  const top = yBottom + tp - cyShift;
  return [
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: right, y: top },
    { x: left, y: top },
  ];
}

function composeWithAttachedPlate(base, plate, fallbackPolygon) {
  const bp = Number(plate.bp);
  const tp = Number(plate.tp);
  if (!base || !(bp > 0) || !(tp > 0)) return base;

  const sourceBounds = base.bbox ?? getBounds(base.polygon ?? fallbackPolygon);
  if (!sourceBounds) return base;

  const baseArea = Number(base.area);
  const baseIx = Number(base.Ix);
  const baseIy = Number(base.Iy);
  const baseIxy = Number(base.Ixy ?? 0);
  if (!(baseArea > 0) || !Number.isFinite(baseIx) || !Number.isFinite(baseIy)) return base;

  const plateArea = bp * tp;
  const plateCx = 0;
  const plateCy = sourceBounds.ymax + tp / 2;
  const totalArea = baseArea + plateArea;
  const cx = (baseArea * 0 + plateArea * plateCx) / totalArea;
  const cy = (baseArea * 0 + plateArea * plateCy) / totalArea;

  const plateIx = (bp * Math.pow(tp, 3)) / 12;
  const plateIy = (tp * Math.pow(bp, 3)) / 12;
  const ix = baseIx + baseArea * Math.pow(0 - cy, 2) + plateIx + plateArea * Math.pow(plateCy - cy, 2);
  const iy = baseIy + baseArea * Math.pow(0 - cx, 2) + plateIy + plateArea * Math.pow(plateCx - cx, 2);
  const ixy = baseIxy + baseArea * (0 - cx) * (0 - cy) + plateArea * (plateCx - cx) * (plateCy - cy);

  const combinedBounds = {
    xmin: Math.min(sourceBounds.xmin, -bp / 2) - cx,
    xmax: Math.max(sourceBounds.xmax, bp / 2) - cx,
    ymin: sourceBounds.ymin - cy,
    ymax: sourceBounds.ymax + tp - cy,
  };

  const sxTopDenom = Math.abs(combinedBounds.ymax) || null;
  const sxBotDenom = Math.abs(combinedBounds.ymin) || null;
  const syLeftDenom = Math.abs(combinedBounds.xmin) || null;
  const syRightDenom = Math.abs(combinedBounds.xmax) || null;
  const radiusSafe = v => v > 0 ? Math.sqrt(v / totalArea) : null;
  const avg = (ix + iy) / 2;
  const root = Math.sqrt(Math.pow((ix - iy) / 2, 2) + Math.pow(ixy, 2));
  const iMax = avg + root;
  const iMin = avg - root;
  const angle = Math.abs(ixy) < 1e-9 && Math.abs(ix - iy) < 1e-9
    ? 0
    : 0.5 * Math.atan2(-2 * ixy, iy - ix);
  const shiftedBasePolygon = (base.polygon ?? fallbackPolygon)?.map(p => ({ x: p.x - cx, y: p.y - cy })) ?? null;

  return {
    ...base,
    area: totalArea,
    perimeter: null,
    centroid: { x: cx, y: cy },
    Ix: ix,
    Iy: iy,
    Ixy: ixy,
    Sx_top: sxTopDenom ? ix / sxTopDenom : null,
    Sx_bot: sxBotDenom ? ix / sxBotDenom : null,
    Sy_left: syLeftDenom ? iy / syLeftDenom : null,
    Sy_right: syRightDenom ? iy / syRightDenom : null,
    rx: radiusSafe(ix),
    ry: radiusSafe(iy),
    principal: {
      angle,
      Imax: iMax,
      Imin: iMin,
      rmax: radiusSafe(iMax),
      rmin: radiusSafe(iMin),
    },
    Zx: null,
    Zy: null,
    shapeFactorX: null,
    shapeFactorY: null,
    J: null,
    Cw: null,
    shearCenter: null,
    bbox: combinedBounds,
    polygon: shiftedBasePolygon,
    attachedPlate: {
      bp,
      tp,
      area: plateArea,
      polygon: makePlatePolygon(bp, tp, sourceBounds.ymax, cy),
    },
    isCompositeSection: true,
  };
}

// ── 클라이언트 측 shapeToPolygon (section-engine 로직 복제) ──────
const _PI = Math.PI;
function clientShapeToPolygon(key, p) {
  switch (key) {
    case 'rod': {
      const r = p.d / 2;
      return Array.from({ length: 72 }, (_, i) => {
        const a = (2 * _PI * i) / 72;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      });
    }
    case 'tube': {
      const ro = p.d / 2, ri = ro - p.t;
      const N = 72;
      const outer = Array.from({ length: N }, (_, i) => ({ x: ro * Math.cos((2*_PI*i)/N), y: ro * Math.sin((2*_PI*i)/N) }));
      const inner = Array.from({ length: N }, (_, i) => ({ x: ri * Math.cos(-(2*_PI*i)/N), y: ri * Math.sin(-(2*_PI*i)/N) }));
      return [...outer, outer[0], inner[0], ...inner, inner[0], outer[0]];
    }
    case 'rectangle': {
      const { b, h } = p;
      return [{ x:-b/2, y:-h/2 }, { x:b/2, y:-h/2 }, { x:b/2, y:h/2 }, { x:-b/2, y:h/2 }];
    }
    case 'rectTube': {
      const { b, h, t } = p; const bi = b-2*t, hi = h-2*t;
      return [
        { x:-b/2, y:-h/2 }, { x:b/2, y:-h/2 }, { x:b/2, y:h/2 }, { x:-b/2, y:h/2 }, { x:-b/2, y:-h/2 },
        { x:-bi/2, y:-hi/2 },
        { x:-bi/2, y:hi/2 }, { x:bi/2, y:hi/2 }, { x:bi/2, y:-hi/2 }, { x:-bi/2, y:-hi/2 },
      ];
    }
    case 'ishape': {
      const { h, bf, tf, tw } = p;
      const bf_bot = p.bf_bot > 0 ? p.bf_bot : bf;
      const tf_bot = p.tf_bot > 0 ? p.tf_bot : tf;
      const hw = h - tf - tf_bot;
      const A_tf = bf*tf, A_bf = bf_bot*tf_bot, A_web = hw*tw;
      const A = A_tf + A_bf + A_web;
      const yc = (A_tf*(h-tf/2) + A_web*(tf_bot+hw/2) + A_bf*(tf_bot/2)) / A;
      const s = -yc;
      return [
        { x:-bf_bot/2, y:0+s }, { x:bf_bot/2, y:0+s },
        { x:bf_bot/2, y:tf_bot+s }, { x:tw/2, y:tf_bot+s },
        { x:tw/2, y:tf_bot+hw+s }, { x:bf/2, y:tf_bot+hw+s },
        { x:bf/2, y:h+s }, { x:-bf/2, y:h+s },
        { x:-bf/2, y:tf_bot+hw+s }, { x:-tw/2, y:tf_bot+hw+s },
        { x:-tw/2, y:tf_bot+s }, { x:-bf_bot/2, y:tf_bot+s },
      ];
    }
    case 'channel': {
      const { h, b, tf, tw } = p;
      const hw = h-2*tf, A_web = hw*tw, A_fl = b*tf, A = A_web+2*A_fl;
      const xc = (A_web*tw/2 + 2*A_fl*b/2) / A;
      const sx = -xc, sy = -h/2;
      return [
        { x:0+sx, y:0+sy }, { x:b+sx, y:0+sy },
        { x:b+sx, y:tf+sy }, { x:tw+sx, y:tf+sy },
        { x:tw+sx, y:h-tf+sy }, { x:b+sx, y:h-tf+sy },
        { x:b+sx, y:h+sy }, { x:0+sx, y:h+sy },
      ];
    }
    case 'angle': {
      const { b, h, t } = p;
      const A1 = b*t, A2 = t*(h-t), A = A1+A2;
      const xc = (A1*b/2 + A2*t/2) / A;
      const yc = (A1*t/2 + A2*(t+(h-t)/2)) / A;
      return [
        { x:0-xc, y:0-yc }, { x:b-xc, y:0-yc },
        { x:b-xc, y:t-yc }, { x:t-xc, y:t-yc },
        { x:t-xc, y:h-yc }, { x:0-xc, y:h-yc },
      ];
    }
    case 'tee': {
      const { h, bf, tf, tw } = p;
      const hw = h-tf, A_fl = bf*tf, A_st = tw*hw, A = A_fl+A_st;
      const yc = (A_fl*(h-tf/2) + A_st*hw/2) / A;
      const s = -yc;
      return [
        { x:-tw/2, y:0+s }, { x:tw/2, y:0+s },
        { x:tw/2, y:hw+s }, { x:bf/2, y:hw+s },
        { x:bf/2, y:h+s }, { x:-bf/2, y:h+s },
        { x:-bf/2, y:hw+s }, { x:-tw/2, y:hw+s },
      ];
    }
    default: return null;
  }
}

// ── 치수 어노테이션 ─────────────────────────────────────────────
function DimAnnotations({ shapeKey, params: p, toSvg, scale }) {
  if (!p || !toSvg || !scale) return null;
  const off = Math.max(18, 22 / scale);

  const Lbl = ({ x, y, text, anchor = 'middle' }) => {
    const s = toSvg({ x, y });
    return <text x={s.x} y={s.y} textAnchor={anchor} dominantBaseline="middle"
                 fill="#7dd3fc" fontSize="11" fontFamily="monospace" opacity="0.9">{text}</text>;
  };
  const Seg = ({ x1, y1, x2, y2 }) => {
    const a = toSvg({ x: x1, y: y1 }), b = toSvg({ x: x2, y: y2 });
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3a6494" strokeWidth="0.9" strokeDasharray="4,3"/>;
  };

  switch (shapeKey) {
    case 'rod': {
      const r = p.d / 2;
      return <><Seg x1={-r} y1={0} x2={r} y2={0}/><Lbl x={0} y={r + off} text={`d = ${p.d}`}/></>;
    }
    case 'tube': {
      const ro = p.d / 2, ri = ro - p.t;
      return <>
        <Seg x1={-ro} y1={0} x2={ro} y2={0}/>
        <Lbl x={0} y={ro + off} text={`d = ${p.d}`}/>
        <Lbl x={ro + off} y={0} text={`t = ${p.t}`} anchor="start"/>
      </>;
    }
    case 'rectangle': {
      const { b, h } = p;
      return <>
        <Seg x1={-b/2} y1={-h/2 - off} x2={b/2} y2={-h/2 - off}/>
        <Lbl x={0} y={-h/2 - off*1.8} text={`b = ${b}`}/>
        <Seg x1={b/2 + off} y1={-h/2} x2={b/2 + off} y2={h/2}/>
        <Lbl x={b/2 + off*1.8} y={0} text={`h = ${h}`} anchor="start"/>
      </>;
    }
    case 'rectTube': {
      const { b, h, t } = p;
      return <>
        <Seg x1={-b/2} y1={h/2 + off} x2={b/2} y2={h/2 + off}/>
        <Lbl x={0} y={h/2 + off*1.8} text={`b = ${b}`}/>
        <Seg x1={b/2 + off} y1={-h/2} x2={b/2 + off} y2={h/2}/>
        <Lbl x={b/2 + off*1.8} y={0} text={`h = ${h}`} anchor="start"/>
        <Lbl x={b/2 + off*1.8} y={h/2 - t/2} text={`t = ${t}`} anchor="start"/>
      </>;
    }
    case 'ishape': {
      const { h, bf, tf, tw } = p;
      const bf_bot = p.bf_bot > 0 ? p.bf_bot : bf, tf_bot = p.tf_bot > 0 ? p.tf_bot : tf;
      const hw = h - tf - tf_bot;
      const A_tf = bf*tf, A_bf = bf_bot*tf_bot, A_web = hw*tw;
      const A = A_tf + A_bf + A_web;
      const yc = (A_tf*(h-tf/2) + A_web*(tf_bot+hw/2) + A_bf*(tf_bot/2)) / A;
      const ybot = 0 - yc, ytop = h - yc;
      const maxBf = Math.max(bf, bf_bot);
      return <>
        <Seg x1={maxBf/2 + off} y1={ybot} x2={maxBf/2 + off} y2={ytop}/>
        <Lbl x={maxBf/2 + off*1.9} y={(ybot+ytop)/2} text={`h = ${h}`} anchor="start"/>
        <Seg x1={-bf/2} y1={ytop + off} x2={bf/2} y2={ytop + off}/>
        <Lbl x={0} y={ytop + off*1.8} text={`bf = ${bf}`}/>
        <Lbl x={bf/2 + off} y={ytop - tf/2} text={`tf = ${tf}`} anchor="start"/>
        <Lbl x={tw/2 + off*0.5} y={(ybot+ytop)/2} text={`tw = ${tw}`} anchor="start"/>
      </>;
    }
    case 'channel': {
      const { h, b, tf, tw } = p;
      const hw = h-2*tf, A_web = hw*tw, A_fl = b*tf, A = A_web+2*A_fl;
      const xc = (A_web*tw/2 + 2*A_fl*b/2) / A;
      const xright = b - xc, ybot = -h/2, ytop = h/2;
      return <>
        <Seg x1={xright + off} y1={ybot} x2={xright + off} y2={ytop}/>
        <Lbl x={xright + off*1.9} y={0} text={`h = ${h}`} anchor="start"/>
        <Seg x1={0-xc} y1={ytop + off} x2={xright} y2={ytop + off}/>
        <Lbl x={(0-xc+xright)/2} y={ytop + off*1.8} text={`b = ${b}`}/>
        <Lbl x={xright + off} y={ytop - tf/2} text={`tf = ${tf}`} anchor="start"/>
        <Lbl x={tw-xc + off*0.5} y={0} text={`tw = ${tw}`} anchor="start"/>
      </>;
    }
    case 'angle': {
      const { b, h, t } = p;
      const A1 = b*t, A2 = t*(h-t), A = A1+A2;
      const xc = (A1*b/2 + A2*t/2) / A;
      const yc = (A1*t/2 + A2*(t+(h-t)/2)) / A;
      const xleft = -xc, xright = b - xc, ybot = -yc, ytop = h - yc;
      return <>
        <Seg x1={xleft} y1={ybot - off} x2={xright} y2={ybot - off}/>
        <Lbl x={(xleft+xright)/2} y={ybot - off*1.8} text={`b = ${b}`}/>
        <Seg x1={xright + off} y1={ybot} x2={xright + off} y2={ytop}/>
        <Lbl x={xright + off*1.9} y={(ybot+ytop)/2} text={`h = ${h}`} anchor="start"/>
        <Lbl x={t-xc + off*0.5} y={ybot + t/2} text={`t = ${t}`} anchor="start"/>
      </>;
    }
    case 'tee': {
      const { h, bf, tf, tw } = p;
      const hw = h-tf, A_fl = bf*tf, A_st = tw*hw, A = A_fl+A_st;
      const yc = (A_fl*(h-tf/2) + A_st*hw/2) / A;
      const ybot = -yc, ytop = h - yc;
      return <>
        <Seg x1={bf/2 + off} y1={ybot} x2={bf/2 + off} y2={ytop}/>
        <Lbl x={bf/2 + off*1.9} y={(ybot+ytop)/2} text={`h = ${h}`} anchor="start"/>
        <Seg x1={-bf/2} y1={ytop + off} x2={bf/2} y2={ytop + off}/>
        <Lbl x={0} y={ytop + off*1.8} text={`bf = ${bf}`}/>
        <Lbl x={bf/2 + off} y={ytop - tf/2} text={`tf = ${tf}`} anchor="start"/>
        <Lbl x={tw/2 + off*0.5} y={(ybot + hw - yc)/2} text={`tw = ${tw}`} anchor="start"/>
      </>;
    }
    default: return null;
  }
}

// ── SVG 단면 캔버스 ─────────────────────────────────────────────
function SectionCanvas({ polygon, platePolygon, properties, shapeKey, params }) {
  const VW = 800, VH = 400, PAD = 60;

  const computed = useMemo(() => {
    const allPoints = [...(polygon ?? []), ...(platePolygon ?? [])];
    if (allPoints.length < 3) return null;
    const xs = allPoints.map(p => p.x);
    const ys = allPoints.map(p => p.y);
    // 도심 기준 최대 반경으로 스케일 결정 → 비대칭 단면도 항상 캔버스 내에 위치
    const maxExtX = Math.max(Math.abs(Math.min(...xs)), Math.abs(Math.max(...xs))) || 1;
    const maxExtY = Math.max(Math.abs(Math.min(...ys)), Math.abs(Math.max(...ys))) || 1;
    const scale = Math.min((VW / 2 - PAD) / maxExtX, (VH / 2 - PAD) / maxExtY);
    const toSvg = p => ({ x: VW / 2 + p.x * scale, y: VH / 2 - p.y * scale });
    return {
      svgPts: polygon?.map(toSvg) ?? [],
      plateSvgPts: platePolygon?.map(toSvg) ?? [],
      scale,
      toSvg,
    };
  }, [polygon, platePolygon]);

  const principalAngle = properties?.principal?.angle;
  const isAsymmetric = principalAngle != null && Math.abs(principalAngle) > 0.001;
  const axisLen = Math.min(VW, VH) * 0.52;

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-slate-700 w-full shadow-sm"
      style={{ background: '#1a1a2e', aspectRatio: `${VW}/${VH}` }}
    >
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-300">
        <span className="rounded-full bg-slate-900/70 px-2 py-1 ring-1 ring-white/10">Centroid view</span>
        <span className="flex items-center gap-1 rounded-full bg-slate-900/70 px-2 py-1 ring-1 ring-white/10">
          <span className="h-2 w-2 rounded-full bg-cyan-300" /> Section
        </span>
        {platePolygon && (
          <span className="flex items-center gap-1 rounded-full bg-slate-900/70 px-2 py-1 ring-1 ring-white/10">
            <span className="h-2 w-2 rounded-full bg-amber-300" /> Attached plate
          </span>
        )}
      </div>
      <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: 'block' }}>
        {/* 격자 */}
        <defs>
          <pattern id="sc-grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#2d3561" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width={VW} height={VH} fill="url(#sc-grid)"/>

        {/* 도심축 */}
        <line x1={VW/2 - axisLen} y1={VH/2} x2={VW/2 + axisLen} y2={VH/2}
              stroke="#3a5f8a" strokeWidth="1.2" strokeDasharray="8,5"/>
        <line x1={VW/2} y1={VH/2 - axisLen} x2={VW/2} y2={VH/2 + axisLen}
              stroke="#3a5f8a" strokeWidth="1.2" strokeDasharray="8,5"/>

        {/* 주축 (비대칭 단면) */}
        {isAsymmetric && computed && (() => {
          const cos = Math.cos(principalAngle), sin = Math.sin(principalAngle);
          return (
            <>
              <line
                x1={VW/2 - axisLen * cos} y1={VH/2 + axisLen * sin}
                x2={VW/2 + axisLen * cos} y2={VH/2 - axisLen * sin}
                stroke="#e94560" strokeWidth="1.4" strokeDasharray="10,5" opacity="0.85"
              />
              <line
                x1={VW/2 + axisLen * sin} y1={VH/2 + axisLen * cos}
                x2={VW/2 - axisLen * sin} y2={VH/2 - axisLen * cos}
                stroke="#e94560" strokeWidth="1.4" strokeDasharray="10,5" opacity="0.85"
              />
              <text x={VW/2 + axisLen * cos + 8} y={VH/2 - axisLen * sin + 5}
                    fill="#e94560" fontSize="13" fontFamily="monospace">I₁</text>
              <text x={VW/2 - axisLen * sin + 8} y={VH/2 - axisLen * cos - 5}
                    fill="#e94560" fontSize="13" fontFamily="monospace">I₂</text>
            </>
          );
        })()}

        {/* 단면 외곽선 */}
        {computed ? (
          <>
            {computed.svgPts.length >= 3 && (
              <polygon
                points={computed.svgPts.map(p => `${p.x},${p.y}`).join(' ')}
                fill="#53d8fb" fillOpacity="0.22"
                stroke="#53d8fb" strokeWidth="2"
                fillRule="evenodd"
              />
            )}
            {computed.plateSvgPts.length >= 3 && (
              <polygon
                points={computed.plateSvgPts.map(p => `${p.x},${p.y}`).join(' ')}
                fill="#fbbf24" fillOpacity="0.24"
                stroke="#fbbf24" strokeWidth="2"
              />
            )}
          </>
        ) : (
          <text x={VW/2} y={VH/2 + 6} textAnchor="middle"
                fill="#3a5f8a" fontSize="15" fontFamily="sans-serif">
            단면을 선택하고 Calculate를 실행하세요
          </text>
        )}

        {/* 치수 어노테이션 */}
        {computed && shapeKey && params && (
          <DimAnnotations
            shapeKey={shapeKey} params={params}
            toSvg={computed.toSvg} scale={computed.scale}
          />
        )}

        {/* 도심 마커 */}
        <circle cx={VW/2} cy={VH/2} r="5.5" fill="#e94560"/>
        <line x1={VW/2-11} y1={VH/2} x2={VW/2+11} y2={VH/2} stroke="#e94560" strokeWidth="1.8"/>
        <line x1={VW/2} y1={VH/2-11} x2={VW/2} y2={VH/2+11} stroke="#e94560" strokeWidth="1.8"/>
        <text x={VW/2+13} y={VH/2-9} fill="#e94560" fontSize="13" fontFamily="monospace">C</text>

        {/* 축 라벨 */}
        <text x={VW/2 + axisLen - 4} y={VH/2 - 7} fill="#3a5f8a" fontSize="13" textAnchor="end" fontFamily="monospace">x</text>
        <text x={VW/2 + 9} y={VH/2 - axisLen + 15} fill="#3a5f8a" fontSize="13" fontFamily="monospace">y</text>
      </svg>
    </div>
  );
}

// ── 숫자 포매터 ────────────────────────────────────────────────
const fmt = (v, digits = 4) => {
  if (v == null) return null;
  const abs = Math.abs(v);
  if (abs >= 1e6) return v.toExponential(3);
  if (abs >= 1)   return parseFloat(v.toFixed(digits)).toLocaleString();
  return v.toExponential(3);
};

const formatByUnit = (value, dimension, resultUnit, digits = 4) => {
  if (value == null) return null;
  const factor = RESULT_UNITS[resultUnit]?.[dimension] ?? 1;
  return fmt(value * factor, digits);
};

const unitByDimension = (dimension, resultUnit) => UNIT_LABELS[dimension]?.[resultUnit] ?? '';

// ── Stat Block ─────────────────────────────────────────────────
function StatBlock({ label, value, unit, desc }) {
  if (value == null) return null;
  return (
    <div className="flex flex-col gap-0.5 px-3 py-3 border-b border-r border-gray-50 last:border-b-0">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">
        {label}{unit && <span className="normal-case text-slate-300 ml-1">[{unit}]</span>}
      </span>
      <span className="text-[15px] font-bold text-slate-800 tabular-nums leading-snug mt-0.5">
        {value}
      </span>
      {desc && <span className="text-[9px] text-slate-400 leading-tight mt-0.5">{desc}</span>}
    </div>
  );
}

function StepHeader({ step, title, desc, icon: Icon }) {
  return (
    <div className="bg-slate-50 border-b border-gray-100 px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-[11px] font-extrabold text-violet-700">
          {step}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {Icon && <Icon size={13} className="shrink-0 text-violet-600" />}
            <h2 className="text-xs font-extrabold text-slate-700 uppercase tracking-wide">{title}</h2>
          </div>
          {desc && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{desc}</p>}
        </div>
      </div>
    </div>
  );
}

function ResultMetric({ label, value, unit, desc, emphasis = false }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${emphasis ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'}`}>
      <p className={`text-[10px] font-extrabold uppercase tracking-wide ${emphasis ? 'text-violet-600' : 'text-slate-400'}`}>{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-xl font-extrabold tabular-nums ${emphasis ? 'text-violet-800' : 'text-slate-800'}`}>
          {value ?? '-'}
        </span>
        {unit && <span className="text-xs font-bold text-slate-400">{unit}</span>}
      </div>
      {desc && <p className="mt-1 text-[11px] leading-tight text-slate-500">{desc}</p>}
    </div>
  );
}

// ── 결과 카드 ──────────────────────────────────────────────────
function ResultCard({ title, accent, stats }) {
  const visible = stats.filter(([, v]) => v != null);
  if (visible.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className={`px-4 py-2 ${accent ? 'bg-gradient-to-r from-violet-700 to-violet-600' : 'bg-slate-50 border-b border-gray-100'}`}>
        <h3 className={`text-[10px] font-bold uppercase tracking-wider ${accent ? 'text-white' : 'text-slate-400'}`}>{title}</h3>
      </div>
      <div className="grid grid-cols-2">
        {stats.map(([label, value, unit, desc]) => (
          <StatBlock key={label} label={label} value={value} unit={unit} desc={desc} />
        ))}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────
export default function SectionPropertyCalculator() {
  const { employeeId } = useAuth();
  const { setCurrentMenu } = useNavigation();
  const [shapeKey, setShapeKey] = useState('ishape');
  const [paramValues, setParamValues] = useState({});
  const [polyVerts, setPolyVerts] = useState([...DEFAULT_POLY]);
  const [includeAttachedPlate, setIncludeAttachedPlate] = useState(false);
  const [attachedPlate, setAttachedPlate] = useState(DEFAULT_ATTACHED_PLATE);
  const [resultUnit, setResultUnit] = useState('cm');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const shape = SHAPES.find(s => s.key === shapeKey) ?? SHAPES[0];
  const isPolygon = shapeKey === 'polygon';

  // 현재 파라미터 값을 숫자 객체로 수집
  const currentParams = useMemo(() => {
    const p = {};
    shape.params.forEach(sp => {
      p[sp.key] = parseFloat(paramValues[`${shapeKey}_${sp.key}`] ?? String(sp.defaultValue)) || 0;
    });
    return p;
  }, [shapeKey, paramValues, shape.params]);

  // 실시간 미리보기: 결과 있으면 결과 polygon, 없으면 클라이언트 계산
  const displayPolygon = useMemo(() => {
    if (result?.polygon) return result.polygon;
    if (isPolygon && polyVerts.length >= 3) return toCentroidalCoords(polyVerts);
    if (!isPolygon) return clientShapeToPolygon(shapeKey, currentParams);
    return null;
  }, [result, isPolygon, polyVerts, shapeKey, currentParams]);

  const displayPlatePolygon = useMemo(() => {
    if (!includeAttachedPlate || isPolygon) return null;
    if (result?.attachedPlate?.polygon) return result.attachedPlate.polygon;
    const bp = Number(attachedPlate.bp);
    const tp = Number(attachedPlate.tp);
    const bounds = getBounds(displayPolygon);
    if (!(bp > 0) || !(tp > 0) || !bounds) return null;
    return makePlatePolygon(bp, tp, bounds.ymax, 0);
  }, [includeAttachedPlate, isPolygon, result, attachedPlate, displayPolygon]);

  const getValue = (key, defaultValue) =>
    paramValues[`${shapeKey}_${key}`] ?? String(defaultValue);
  const setValue = (key, val) => {
    setParamValues(prev => ({ ...prev, [`${shapeKey}_${key}`]: val }));
    setResult(null);
    setError(null);
  };
  const setPlateValue = (key, val) => {
    setAttachedPlate(prev => ({ ...prev, [key]: val }));
    setResult(null);
    setError(null);
  };

  const polyErrors = useMemo(() => isPolygon ? validatePolygon(polyVerts) : [], [isPolygon, polyVerts]);

  const baseInputValid = isPolygon
    ? polyVerts.length >= 3 && polyErrors.length === 0
    : shape.params.every(p => {
        const v = getValue(p.key, p.defaultValue);
        if (p.min === 0) return v !== '' && Number(v) >= 0;
        return v !== '' && Number(v) > 0;
      });
  const attachedPlateValid = !includeAttachedPlate || isPolygon
    ? true
    : Number(attachedPlate.bp) > 0 && Number(attachedPlate.tp) > 0;
  const isValid = baseInputValid && attachedPlateValid;


  const handleCalculate = async () => {
    if (!isValid) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      let payload;
      if (isPolygon) {
        payload = { shape: 'polygon', params: {}, vertices: polyVerts, units: 'mm', employee_id: employeeId || 'unknown' };
      } else {
        const params = {};
        shape.params.forEach(p => {
          const v = parseFloat(getValue(p.key, p.defaultValue));
          if (p.min === 0 && v === 0) return;
          params[p.key] = v;
        });
        payload = { shape: shapeKey, params, units: 'mm', employee_id: employeeId || 'unknown' };
      }
      const res = await axios.post(`${API_BASE_URL}/api/section-property/calculate`, payload);
      const baseResult = res.data;
      setResult(
        includeAttachedPlate && !isPolygon
          ? composeWithAttachedPlate(baseResult, attachedPlate, displayPolygon)
          : baseResult
      );
    } catch (e) {
      setError(e.response?.data?.detail ?? '계산 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleShapeChange = (newKey) => {
    setShapeKey(newKey);
    setResult(null);
    setError(null);
    if (newKey === 'polygon') setIncludeAttachedPlate(false);
  };

  const r = result ?? {};
  const principal = r.principal ?? {};

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">

      <AnalysisPageBanner
        title="Section Property Calculator"
        subtitle="단면 형상과 치수를 입력하여 면적, 관성모멘트, 단면계수 등 구조 특성값을 산출합니다."
        icon={PenTool}
        guideTitle="[인터랙티브] Section Property Calculator"
        onBack={() => setCurrentMenu('Interactive Apps')}
        backLabel="Interactive Apps로 돌아가기"
        gradient="from-brand-blue via-violet-900 to-violet-700"
        iconClassName="text-violet-300"
        subtitleClassName="text-violet-200/80"
      />

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {[
          ['1', 'Select shape', 'Rod, Tube, I-Shape, 임의 Polygon 중 계산 대상 선택'],
          ['2', 'Enter dimensions', '모든 치수는 mm 기준이며 미리보기는 즉시 갱신'],
          ['3', 'Calculate & review', '면적, Ix/Iy, Sx/Sy, 회전반경을 단위별로 확인'],
        ].map(([step, title, desc]) => (
          <div key={step} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-extrabold text-violet-700">{step}</span>
            <div>
              <p className="text-xs font-extrabold text-slate-700">{title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 2-컬럼 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">

        {/* ── LEFT SIDEBAR ── */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <StepHeader step="1" title="단면 선택" desc="계산할 기본 부재 형상을 선택합니다." icon={Layers} />
            <div className="p-4 grid grid-cols-3 gap-2">
              {SHAPES.map(s => (
                <button
                  key={s.key}
                  onClick={() => handleShapeChange(s.key)}
                  className={`min-h-[78px] flex flex-col items-center justify-center gap-1.5 rounded-xl border transition-all cursor-pointer text-center ${
                    shapeKey === s.key
                      ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm ring-2 ring-violet-100'
                      : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50 text-slate-500'
                  }`}
                  aria-pressed={shapeKey === s.key}
                >
                  <span className="leading-none">{s.icon}</span>
                  <span className="text-[11px] font-extrabold leading-tight">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <StepHeader
              step="2"
              title={isPolygon ? '꼭짓점 입력' : '단면 치수 입력'}
              desc={isPolygon ? '좌표를 순서대로 입력합니다. 자기교차가 있으면 계산할 수 없습니다.' : `${shape.label} 계산에 필요한 치수를 mm 기준으로 입력합니다.`}
              icon={Ruler}
            />
            <div className="p-4 space-y-3">
              {isPolygon ? (
                <PolygonEditor vertices={polyVerts} onChange={setPolyVerts}/>
              ) : (
                shape.params.map(p => (
                  <div key={`${shapeKey}_${p.key}`}>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">{p.label}</label>
                    <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-colors bg-white">
                      <input
                        type="number"
                        value={getValue(p.key, p.defaultValue)}
                        onChange={e => setValue(p.key, e.target.value)}
                        min={p.min}
                        className="min-w-0 flex-1 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none bg-transparent"
                      />
                      <span className="px-3 py-2.5 bg-slate-50 text-slate-500 text-[11px] font-bold border-l border-slate-200">{p.unit}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-gray-100 px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-[11px] font-extrabold text-violet-700">3</span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Layers size={13} className="text-violet-600" />
                      <h2 className="text-xs font-extrabold text-slate-700 uppercase tracking-wide">유효폭 선체 포함</h2>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">부재 상단에 선체판을 합성합니다.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (isPolygon) return;
                    setIncludeAttachedPlate(prev => !prev);
                    setResult(null);
                    setError(null);
                  }}
                  disabled={isPolygon}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    includeAttachedPlate && !isPolygon ? 'bg-violet-600' : 'bg-slate-300'
                  } ${isPolygon ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  aria-pressed={includeAttachedPlate && !isPolygon}
                  aria-label="유효폭 선체 포함"
                  title={isPolygon ? '임의 형상은 꼭짓점에 선체를 직접 포함하세요.' : '유효폭 선체 포함'}
                >
                  <span
                    className={`absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      includeAttachedPlate && !isPolygon ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className={`rounded-xl border p-3 ${includeAttachedPlate && !isPolygon ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-start gap-2">
                  {includeAttachedPlate && !isPolygon ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-violet-600"/>
                  ) : (
                    <Layers size={15} className="mt-0.5 shrink-0 text-slate-400"/>
                  )}
                  <p className={`text-[11px] leading-relaxed ${includeAttachedPlate && !isPolygon ? 'text-violet-800' : 'text-slate-500'}`}>
                    {isPolygon
                      ? '임의 형상은 꼭짓점 좌표에 선체판을 직접 포함해서 입력하세요.'
                      : includeAttachedPlate
                        ? '결과는 선택한 단면과 상부 선체판의 합성 단면 기준으로 계산됩니다.'
                        : '선체에 용접 또는 부착된 부재를 검토할 때 켜세요.'}
                  </p>
                </div>
              </div>

              {includeAttachedPlate && !isPolygon && (
                <div className="grid grid-cols-1 gap-3">
                  {[
                    ['bp', '선체 폭 (bp)', '유효폭으로 고려할 선체판 폭'],
                    ['tp', '선체 두께 (tp)', '유효폭으로 고려할 선체판 두께'],
                  ].map(([key, label, title]) => (
                    <div key={key}>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1" title={title}>{label}</label>
                      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:border-violet-400 transition-colors bg-white">
                        <input
                          type="number"
                          min="0"
                          value={attachedPlate[key]}
                          onChange={e => setPlateValue(key, e.target.value)}
                          className="min-w-0 flex-1 px-3 py-2 text-sm font-bold text-slate-800 outline-none bg-transparent"
                        />
                        <span className="px-3 py-2 bg-slate-50 text-slate-500 text-[11px] font-bold border-l border-slate-200">mm</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {includeAttachedPlate && !isPolygon && !attachedPlateValid && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={13} className="mt-0.5 shrink-0 text-red-600"/>
                    <p className="text-[11px] leading-relaxed text-red-700">
                      선체 폭과 선체 두께는 모두 0보다 큰 값이어야 합니다.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="sticky top-4 bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
            <button
              onClick={handleCalculate}
              disabled={!isValid || isLoading}
              className={`w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                isValid && !isLoading
                  ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-200 cursor-pointer'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isLoading
                ? <><Loader2 size={16} className="animate-spin"/> 계산 중...</>
                : <><Calculator size={16}/> Calculate</>}
            </button>
            <p className={`mt-2 text-center text-[11px] leading-relaxed ${isValid ? 'text-slate-500' : 'text-red-600'}`}>
              {isValid
                ? '계산 후 우측에서 핵심 결과와 상세 특성값을 확인합니다.'
                : '계산하려면 모든 필수 치수를 0보다 큰 값으로 입력해야 합니다.'}
            </p>
          </div>
        </div>

        {/* ── RIGHT MAIN ── */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                  <Ruler size={18}/>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-800">단면 미리보기 및 결과</h2>
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-extrabold text-violet-700">
                      {shape.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    입력은 mm 기준, 결과 표시는 선택한 단위 기준입니다.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500">결과 단위</span>
                <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
                  {['cm', 'mm'].map(unit => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => setResultUnit(unit)}
                      className={`min-w-[54px] rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                        resultUnit === unit
                          ? 'bg-white text-violet-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {result && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ResultMetric
                label="Area A"
                value={formatByUnit(r.area, 'area', resultUnit)}
                unit={unitByDimension('area', resultUnit)}
                desc="단면 전체 면적"
                emphasis
              />
              <ResultMetric
                label="Ix"
                value={formatByUnit(r.Ix, 'inertia', resultUnit)}
                unit={unitByDimension('inertia', resultUnit)}
                desc="x축 굽힘 강성"
              />
              <ResultMetric
                label="Iy"
                value={formatByUnit(r.Iy, 'inertia', resultUnit)}
                unit={unitByDimension('inertia', resultUnit)}
                desc="y축 굽힘 강성"
              />
              <ResultMetric
                label="rx / ry"
                value={`${formatByUnit(r.rx, 'length', resultUnit, 3) ?? '-'} / ${formatByUnit(r.ry, 'length', resultUnit, 3) ?? '-'}`}
                unit={unitByDimension('length', resultUnit)}
                desc="좌굴 검토용 회전반경"
              />
            </div>
          )}

          {/* SVG 캔버스 */}
          <SectionCanvas
            polygon={displayPolygon}
            platePolygon={displayPlatePolygon}
            properties={result}
            shapeKey={shapeKey}
            params={isPolygon ? null : currentParams}
          />

          {isLoading && (
            <div className="bg-white border border-violet-200 rounded-2xl shadow-sm p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
                  <Loader2 size={18} className="animate-spin"/>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">단면 특성값을 계산하는 중입니다.</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    입력 형상은 그대로 유지됩니다. 계산이 끝나면 핵심 결과와 상세 표가 아래에 표시됩니다.
                  </p>
                </div>
              </div>
            </div>
          )}

          {!result && !error && !isLoading && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Calculator size={16}/>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">입력값을 확인한 뒤 Calculate를 실행하세요.</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    좌측에서 단면 형상과 치수를 입력하면 미리보기는 즉시 갱신됩니다. 선체에 연결된 부재는 유효폭 선체 포함 옵션을 켠 뒤 선체 폭과 두께를 입력하세요.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {[
                      ['C', '빨간 마커는 도심입니다.'],
                      ['x/y', '파란 점선은 도심축입니다.'],
                      ['I1/I2', '비대칭 단면은 주축이 함께 표시됩니다.'],
                    ].map(([label, text]) => (
                      <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-extrabold text-slate-500">{label}</p>
                        <p className="text-[11px] leading-tight text-slate-500">{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 에러 */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18}/>
              <div>
                <p className="font-bold text-red-700 text-sm">계산 실패</p>
                <p className="text-sm text-red-600 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {result?.isCompositeSection && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-3">
              <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={16}/>
              <p className="text-xs leading-relaxed text-amber-800">
                유효폭 선체 포함 결과입니다. 면적, 도심, Ix/Iy/Ixy, 단면계수, 회전반경은 합성 단면 기준으로 갱신되며
                소성 단면계수와 비틀림 상수는 합성 모드에서 표시하지 않습니다.
              </p>
            </div>
          )}

          {/* 결과 카드 그리드 */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} className="text-violet-600" />
                  <h3 className="text-sm font-extrabold text-slate-800">상세 단면 특성값</h3>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                  Result unit: {resultUnit}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <ResultCard
                  title="일반 특성 (General)"
                  accent
                  stats={[
                    ['A (단면적)', formatByUnit(r.area, 'area', resultUnit), unitByDimension('area', resultUnit), '단면의 총 면적'],
                    ['P (둘레)', formatByUnit(r.perimeter, 'length', resultUnit), unitByDimension('length', resultUnit), '외곽선의 총 길이'],
                    ['cx (도심)', formatByUnit(r.centroid?.x, 'length', resultUnit, 3), unitByDimension('length', resultUnit), '수평 도심 위치 (기준 원점 기준)'],
                    ['cy (도심)', formatByUnit(r.centroid?.y, 'length', resultUnit, 3), unitByDimension('length', resultUnit), '수직 도심 위치 (기준 원점 기준)'],
                  ]}
                />

                {r.attachedPlate && (
                <ResultCard
                  title="유효폭 선체"
                  stats={[
                    ['선체 폭 (bp)', formatByUnit(r.attachedPlate.bp, 'length', resultUnit, 3), unitByDimension('length', resultUnit), '유효폭으로 고려한 선체 폭'],
                    ['선체 두께 (tp)', formatByUnit(r.attachedPlate.tp, 'length', resultUnit, 3), unitByDimension('length', resultUnit), '유효폭으로 고려한 선체 두께'],
                    ['A선체', formatByUnit(r.attachedPlate.area, 'area', resultUnit), unitByDimension('area', resultUnit), '유효폭 선체 면적'],
                  ]}
                />
                )}

                <ResultCard
                  title="단면 2차 모멘트"
                  stats={[
                    ['Ix', formatByUnit(r.Ix, 'inertia', resultUnit), unitByDimension('inertia', resultUnit), 'x축 굽힘 강성의 척도'],
                    ['Iy', formatByUnit(r.Iy, 'inertia', resultUnit), unitByDimension('inertia', resultUnit), 'y축 굽힘 강성의 척도'],
                    ['Ixy', formatByUnit(r.Ixy, 'inertia', resultUnit), unitByDimension('inertia', resultUnit), '비대칭 굽힘 해석 시 사용'],
                  ]}
                />

              <ResultCard
                title="탄성 단면계수"
                stats={[
                  ['Sx (상)', formatByUnit(r.Sx_top, 'volume', resultUnit), unitByDimension('volume', resultUnit), '상단 섬유 응력: σ = M / Sx_top'],
                  ['Sx (하)', formatByUnit(r.Sx_bot, 'volume', resultUnit), unitByDimension('volume', resultUnit), '하단 섬유 응력: σ = M / Sx_bot'],
                  ['Sy (좌)', formatByUnit(r.Sy_left, 'volume', resultUnit), unitByDimension('volume', resultUnit), '좌측 섬유 응력: σ = M / Sy_left'],
                  ['Sy (우)', formatByUnit(r.Sy_right, 'volume', resultUnit), unitByDimension('volume', resultUnit), '우측 섬유 응력: σ = M / Sy_right'],
                ]}
              />

              <ResultCard
                title="회전반경 (Radius of Gyration)"
                stats={[
                  ['rx', formatByUnit(r.rx, 'length', resultUnit, 3), unitByDimension('length', resultUnit), 'x축 기준 좌굴 계산: λ = L / rx'],
                  ['ry', formatByUnit(r.ry, 'length', resultUnit, 3), unitByDimension('length', resultUnit), 'y축 기준 좌굴 계산: λ = L / ry'],
                ]}
              />

              <ResultCard
                title="주축 (Principal Axes)"
                stats={[
                  ['θ',    principal.angle != null ? `${(principal.angle * 180 / Math.PI).toFixed(3)}°` : null, '', '주축이 x축과 이루는 각도 (비대칭 단면)'],
                  ['Imax', formatByUnit(principal.Imax, 'inertia', resultUnit), unitByDimension('inertia', resultUnit), '최대 굽힘 저항 방향의 관성모멘트'],
                  ['Imin', formatByUnit(principal.Imin, 'inertia', resultUnit), unitByDimension('inertia', resultUnit), '최소 굽힘 저항 방향의 관성모멘트'],
                  ['rmax', formatByUnit(principal.rmax, 'length', resultUnit, 3), unitByDimension('length', resultUnit), '주축 최대 회전반경'],
                  ['rmin', formatByUnit(principal.rmin, 'length', resultUnit, 3), unitByDimension('length', resultUnit), '주축 최소 회전반경'],
                ]}
              />

                <ResultCard
                  title="소성 단면계수 · 비틀림"
                  stats={[
                    ['Zx', formatByUnit(r.Zx, 'volume', resultUnit), unitByDimension('volume', resultUnit), '완전 소성 시 x축 모멘트 저항: Mp = Zx × Fy'],
                    ['Zy', formatByUnit(r.Zy, 'volume', resultUnit), unitByDimension('volume', resultUnit), '완전 소성 시 y축 모멘트 저항'],
                    ['SF_x', r.shapeFactorX != null ? r.shapeFactorX.toFixed(4) : null, '—', '형상계수 Zx/Sx — 소성 여유 (1.0 초과)'],
                    ['SF_y', r.shapeFactorY != null ? r.shapeFactorY.toFixed(4) : null, '—', '형상계수 Zy/Sy — 소성 여유 (1.0 초과)'],
                    ['J', r.J != null ? formatByUnit(r.J, 'inertia', resultUnit) : null, unitByDimension('inertia', resultUnit), '생 브낭 비틀림 상수'],
                    ['Cw', r.Cw != null ? formatByUnit(r.Cw, 'warping', resultUnit) : null, unitByDimension('warping', resultUnit), '뒤틀림 상수'],
                  ]}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <SolverCredit contributor="권혁민"/>
    </div>
  );
}
