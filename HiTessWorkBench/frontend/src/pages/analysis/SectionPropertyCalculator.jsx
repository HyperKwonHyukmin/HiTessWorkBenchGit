import React, { useState, useMemo } from 'react';
import axios from 'axios';
import {
  SlidersHorizontal, Calculator, AlertCircle, Loader2, ArrowLeft, Plus, Trash2,
} from 'lucide-react';
import GuideButton from '../../components/ui/GuideButton';
import ChangelogModal from '../../components/ui/ChangelogModal';
import { useNavigation } from '../../contexts/NavigationContext';
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

// ── 임의 형상 꼭짓점 편집기 ─────────────────────────────────────
function PolygonEditor({ vertices, onChange }) {
  const update = (i, axis, raw) => {
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    onChange(vertices.map((v, idx) => idx === i ? { ...v, [axis]: val } : v));
  };

  const add = () => {
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
      <div className="flex gap-2">
        <button
          onClick={add}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-200 hover:border-violet-300 hover:bg-violet-50 text-[11px] font-bold text-slate-500 hover:text-violet-700 transition-colors cursor-pointer"
        >
          <Plus size={11}/> 꼭짓점 추가
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
function SectionCanvas({ polygon, properties, shapeKey, params }) {
  const VW = 800, VH = 400, PAD = 60;

  const computed = useMemo(() => {
    if (!polygon || polygon.length < 3) return null;
    const xs = polygon.map(p => p.x);
    const ys = polygon.map(p => p.y);
    // 도심 기준 최대 반경으로 스케일 결정 → 비대칭 단면도 항상 캔버스 내에 위치
    const maxExtX = Math.max(Math.abs(Math.min(...xs)), Math.abs(Math.max(...xs))) || 1;
    const maxExtY = Math.max(Math.abs(Math.min(...ys)), Math.abs(Math.max(...ys))) || 1;
    const scale = Math.min((VW / 2 - PAD) / maxExtX, (VH / 2 - PAD) / maxExtY);
    const toSvg = p => ({ x: VW / 2 + p.x * scale, y: VH / 2 - p.y * scale });
    return { svgPts: polygon.map(toSvg), scale, toSvg };
  }, [polygon]);

  const principalAngle = properties?.principal?.angle;
  const isAsymmetric = principalAngle != null && Math.abs(principalAngle) > 0.001;
  const axisLen = Math.min(VW, VH) * 0.52;

  return (
    <div
      className="rounded-xl overflow-hidden border border-slate-700 w-full"
      style={{ background: '#1a1a2e', aspectRatio: `${VW}/${VH}` }}
    >
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
          <polygon
            points={computed.svgPts.map(p => `${p.x},${p.y}`).join(' ')}
            fill="#53d8fb" fillOpacity="0.22"
            stroke="#53d8fb" strokeWidth="2"
            fillRule="evenodd"
          />
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
  const { setCurrentMenu } = useNavigation();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [shapeKey, setShapeKey] = useState('ishape');
  const [paramValues, setParamValues] = useState({});
  const [polyVerts, setPolyVerts] = useState([...DEFAULT_POLY]);
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

  const getValue = (key, defaultValue) =>
    paramValues[`${shapeKey}_${key}`] ?? String(defaultValue);
  const setValue = (key, val) =>
    setParamValues(prev => ({ ...prev, [`${shapeKey}_${key}`]: val }));

  const isValid = isPolygon
    ? polyVerts.length >= 3
    : shape.params.every(p => {
        const v = getValue(p.key, p.defaultValue);
        if (p.min === 0) return v !== '' && Number(v) >= 0;
        return v !== '' && Number(v) > 0;
      });

  const getEmployeeId = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').employee_id || 'unknown'; }
    catch { return 'unknown'; }
  };

  const handleCalculate = async () => {
    if (!isValid) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      let payload;
      if (isPolygon) {
        payload = { shape: 'polygon', params: {}, vertices: polyVerts, units: 'mm', employee_id: getEmployeeId() };
      } else {
        const params = {};
        shape.params.forEach(p => {
          const v = parseFloat(getValue(p.key, p.defaultValue));
          if (p.min === 0 && v === 0) return;
          params[p.key] = v;
        });
        payload = { shape: shapeKey, params, units: 'mm', employee_id: getEmployeeId() };
      }
      const res = await axios.post(`${API_BASE_URL}/api/section-property/calculate`, payload);
      setResult(res.data);
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
  };

  const r = result ?? {};
  const principal = r.principal ?? {};

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">

      {/* 헤더 */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-brand-blue via-violet-900 to-violet-700 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
          <div className="absolute -right-6 -top-6 w-48 h-48 bg-white rounded-full"/>
          <div className="absolute right-24 bottom-0 w-24 h-24 bg-white rounded-full"/>
        </div>
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setCurrentMenu('Interactive Apps')}
              className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer">
              <ArrowLeft size={18}/>
            </button>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <SlidersHorizontal size={18} className="text-violet-300"/>
                Section Property Calculator
              </h1>
              <p className="text-sm text-violet-200/80 mt-0.5">단면 형상과 치수를 입력하여 면적, 관성모멘트, 단면계수 등 구조 특성값을 산출합니다.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setChangelogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors cursor-pointer">
              이력
            </button>
            <GuideButton guideTitle="[인터랙티브] Section Property Calculator" variant="dark"/>
          </div>
        </div>
      </div>

      {/* 2-컬럼 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">

        {/* ── LEFT SIDEBAR ── */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-violet-700 to-violet-600 px-5 py-3">
              <h2 className="text-[11px] font-bold text-white uppercase tracking-wider">단면 종류</h2>
            </div>
            {/* 단면 버튼 그리드 (4×3) */}
            <div className="p-4 grid grid-cols-4 gap-2">
              {SHAPES.map(s => (
                <button
                  key={s.key}
                  onClick={() => handleShapeChange(s.key)}
                  className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border transition-all cursor-pointer text-center ${
                    shapeKey === s.key
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50 text-slate-500'
                  }`}
                >
                  <span className="leading-none">{s.icon}</span>
                  <span className="text-[9px] font-bold leading-tight">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 파라미터 폼 or 꼭짓점 편집기 */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-gray-100 px-5 py-3">
              <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                {isPolygon ? '꼭짓점 (Vertices)' : '파라미터'}
              </h2>
            </div>
            <div className="p-4 space-y-3">
              {isPolygon ? (
                <PolygonEditor vertices={polyVerts} onChange={setPolyVerts}/>
              ) : (
                shape.params.map(p => (
                  <div key={`${shapeKey}_${p.key}`}>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">{p.label}</label>
                    <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:border-violet-400 transition-colors bg-white">
                      <input
                        type="number"
                        value={getValue(p.key, p.defaultValue)}
                        onChange={e => setValue(p.key, e.target.value)}
                        min={p.min}
                        className="flex-1 px-3 py-2 text-sm font-bold text-slate-800 outline-none bg-transparent"
                      />
                      <span className="px-3 py-2 bg-slate-50 text-slate-400 text-[11px] font-bold border-l border-slate-200">{p.unit}</span>
                    </div>
                  </div>
                ))
              )}

              <button
                onClick={handleCalculate}
                disabled={!isValid || isLoading}
                className={`w-full mt-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                  isValid && !isLoading
                    ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-200 cursor-pointer'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isLoading
                  ? <><Loader2 size={16} className="animate-spin"/> 계산 중...</>
                  : <><Calculator size={16}/> Calculate</>}
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT MAIN ── */}
        <div className="space-y-4">

          {/* SVG 캔버스 */}
          <SectionCanvas
            polygon={displayPolygon}
            properties={result}
            shapeKey={shapeKey}
            params={isPolygon ? null : currentParams}
          />

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

          {/* 결과 카드 그리드 */}
          {result && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <ResultCard
                title="일반 특성 (General)"
                accent
                stats={[
                  ['A (단면적)', fmt(r.area),           'mm²', '단면의 총 면적'],
                  ['P (둘레)',   fmt(r.perimeter),       'mm',  '외곽선의 총 길이'],
                  ['cx (도심)', fmt(r.centroid?.x, 3),  'mm',  '수평 도심 위치 (기준 원점 기준)'],
                  ['cy (도심)', fmt(r.centroid?.y, 3),  'mm',  '수직 도심 위치 (기준 원점 기준)'],
                ]}
              />

              <ResultCard
                title="단면 2차 모멘트"
                stats={[
                  ['Ix', fmt(r.Ix),  'mm⁴', 'x축 굽힘 강성의 척도 — 클수록 x축 굽힘에 강함'],
                  ['Iy', fmt(r.Iy),  'mm⁴', 'y축 굽힘 강성의 척도 — 클수록 y축 굽힘에 강함'],
                  ['Ixy', fmt(r.Ixy), 'mm⁴', '원심 모멘트 — 비대칭 굽힘 해석 시 사용'],
                ]}
              />

              <ResultCard
                title="탄성 단면계수"
                stats={[
                  ['Sx (상)', fmt(r.Sx_top),   'mm³', '상단 섬유 응력: σ = M / Sx_top'],
                  ['Sx (하)', fmt(r.Sx_bot),   'mm³', '하단 섬유 응력: σ = M / Sx_bot'],
                  ['Sy (좌)', fmt(r.Sy_left),  'mm³', '좌측 섬유 응력: σ = M / Sy_left'],
                  ['Sy (우)', fmt(r.Sy_right), 'mm³', '우측 섬유 응력: σ = M / Sy_right'],
                ]}
              />

              <ResultCard
                title="회전반경 (Radius of Gyration)"
                stats={[
                  ['rx', fmt(r.rx, 3), 'mm', 'x축 기준 — 좌굴 계산: λ = L / rx'],
                  ['ry', fmt(r.ry, 3), 'mm', 'y축 기준 — 좌굴 계산: λ = L / ry'],
                ]}
              />

              <ResultCard
                title="주축 (Principal Axes)"
                stats={[
                  ['θ',    principal.angle != null ? `${(principal.angle * 180 / Math.PI).toFixed(3)}°` : null, '', '주축이 x축과 이루는 각도 (비대칭 단면)'],
                  ['Imax', fmt(principal.Imax), 'mm⁴', '최대 굽힘 저항 방향의 관성모멘트'],
                  ['Imin', fmt(principal.Imin), 'mm⁴', '최소 굽힘 저항 방향의 관성모멘트'],
                  ['rmax', fmt(principal.rmax, 3), 'mm', '주축 최대 회전반경'],
                  ['rmin', fmt(principal.rmin, 3), 'mm', '주축 최소 회전반경'],
                ]}
              />

              <ResultCard
                title="소성 단면계수 · 비틀림"
                stats={[
                  ['Zx',   fmt(r.Zx),  'mm³', '완전 소성 시 x축 모멘트 저항: Mp = Zx × Fy'],
                  ['Zy',   fmt(r.Zy),  'mm³', '완전 소성 시 y축 모멘트 저항'],
                  ['SF_x', r.shapeFactorX != null ? r.shapeFactorX.toFixed(4) : null, '—', '형상계수 Zx/Sx — 소성 여유 (1.0 초과)'],
                  ['SF_y', r.shapeFactorY != null ? r.shapeFactorY.toFixed(4) : null, '—', '형상계수 Zy/Sy — 소성 여유 (1.0 초과)'],
                  ['J',    r.J  != null ? fmt(r.J)  : null, 'mm⁴', '생비낭 비틀림 상수 — 순수 비틀림 저항'],
                  ['Cw',   r.Cw != null ? fmt(r.Cw) : null, 'mm⁶', '뒤틀림 상수 — 플랜지 비틀림 저항'],
                ]}
              />
            </div>
          )}
        </div>
      </div>

      <SolverCredit contributor="권혁민"/>
      <ChangelogModal programKey="SectionPropertyCalculator" title="Section Property Calculator" isOpen={changelogOpen} onClose={() => setChangelogOpen(false)}/>
    </div>
  );
}
