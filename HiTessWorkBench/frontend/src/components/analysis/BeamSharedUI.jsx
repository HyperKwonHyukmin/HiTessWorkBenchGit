/**
 * @fileoverview 단면 해석기에 사용되는 공통 UI 조각 컴포넌트들
 */
import React from 'react';

/** 경계조건 타입별 Tailwind 색상 클래스 (3D 뷰어 색상과 동일) */
export const BC_TYPE_COLOR = {
  Fix: 'bg-red-500',
  Hinge: 'bg-blue-500',
  Roller: 'bg-emerald-500',
  Custom: 'bg-slate-400',
};

export function InputRow({ label, value, unit, onChange, disabled, lightMode = false }) {
  return (
    <div className={`flex items-center justify-between border rounded p-1 transition-colors group ${lightMode ? 'bg-slate-50 border-slate-200 hover:border-slate-300' : 'bg-slate-900 border-transparent hover:border-slate-700'} ${disabled ? 'opacity-60' : ''}`}>
      <span className={`text-[11px] pl-2 w-2/5 truncate ${lightMode ? 'text-slate-600 group-hover:text-slate-800' : 'text-slate-400 group-hover:text-slate-300'}`}>{label}</span>
      <div className={`flex items-center w-3/5 border rounded px-2 ${lightMode ? 'bg-white border-slate-300' : 'bg-slate-950 border-slate-800'} ${!disabled && 'focus-within:border-blue-500'}`}>
        <input type="number" value={value} onChange={onChange} disabled={disabled} className={`w-full bg-transparent py-1 text-sm font-bold outline-none font-mono text-right disabled:cursor-not-allowed ${lightMode ? 'text-brand-blue' : 'text-brand-accent'}`} />
        <span className={`text-[10px] font-mono ml-1 w-6 text-right ${lightMode ? 'text-slate-500' : 'text-slate-600'}`}>{unit}</span>
      </div>
    </div>
  );
}

export function SummaryRow({ label, value, unit, sub, lightMode = false }) {
  return (
    <div className={`flex justify-between items-center p-2 rounded border ${lightMode ? 'bg-slate-50 border-slate-200' : 'bg-slate-900 border-slate-800'}`}>
      <div className="flex flex-col">
        <span className={`font-medium ${lightMode ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
        {sub && <span className={`text-[10px] font-mono ${lightMode ? 'text-slate-500' : 'text-slate-500'}`}>{sub}</span>}
      </div>
      <div className="text-right">
        <span className={`${lightMode ? 'text-emerald-700' : 'text-emerald-400'} font-bold text-sm`}>{value || '0'}</span>
        {unit && <span className="text-[10px] text-slate-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export function SectionGuide({ type, params, lightMode = false }) {
  const s = { stroke: lightMode ? '#334155' : '#475569', strokeWidth: 2, fill: 'none' };
  const t = { fill: lightMode ? '#0369a1' : '#00E600', fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold' };
  
  const dim1 = Number(params?.dim1) || 100;
  const dim2 = Number(params?.dim2) || 100;
  const dim3 = Number(params?.dim3) || 10;
  const dim4 = Number(params?.dim4) || 10;

  const getSvgContent = () => {
    switch (type) {
      case 'I': {
        const maxVal = Math.max(dim1, dim2);
        const w = maxVal > 0 ? (dim1 / maxVal) * 50 + 20 : 60;
        const h = maxVal > 0 ? (dim2 / maxVal) * 50 + 20 : 60;
        const tfRatio = Math.max(0.08, Math.min(0.3, dim3 / (dim2 || 1)));
        const twRatio = Math.max(0.08, Math.min(0.3, dim4 / (dim1 || 1)));
        const tf = h * tfRatio;
        const tw = w * twRatio;
        const xStart = 50 - w/2;
        const yStart = 50 - h/2;
        const xEnd = 50 + w/2;
        const yEnd = 50 + h/2;
        const pathData = `M ${xStart},${yStart} L ${xEnd},${yStart} L ${xEnd},${yStart + tf} L ${50 + tw/2},${yStart + tf} L ${50 + tw/2},${yEnd - tf} L ${xEnd},${yEnd - tf} L ${xEnd},${yEnd} L ${xStart},${yEnd} L ${xStart},${yEnd - tf} L ${50 - tw/2},${yEnd - tf} L ${50 - tw/2},${yStart + tf} L ${xStart},${yStart + tf} Z`;
        return (
          <>
            <path d={pathData} {...s} fill={lightMode ? '#e2e8f0' : '#1e293b'} />
            <text x="50" y={Math.max(10, yStart - 4)} textAnchor="middle" {...t}>W</text>
            <text x={Math.max(6, xStart - 8)} y="54" textAnchor="middle" {...t}>H</text>
            <text x={50 + tw/2 + 3} y="54" textAnchor="start" {...t} fontSize="9px">tw</text>
            <text x={xEnd + 3} y={yStart + tf/2 + 3} textAnchor="start" {...t} fontSize="9px">tf</text>
          </>
        );
      }
      case 'H': {
        const maxVal = Math.max(dim1, dim2);
        const w = maxVal > 0 ? (dim1 / maxVal) * 50 + 20 : 60;
        const h = maxVal > 0 ? (dim2 / maxVal) * 50 + 20 : 60;
        const tfRatio = Math.max(0.08, Math.min(0.3, dim3 / (dim1 || 1)));
        const twRatio = Math.max(0.08, Math.min(0.3, dim4 / (dim2 || 1)));
        const tf = w * tfRatio;
        const tw = h * twRatio;
        const xStart = 50 - w/2;
        const yStart = 50 - h/2;
        const xEnd = 50 + w/2;
        const yEnd = 50 + h/2;
        const pathData = `M ${xStart},${yStart} L ${xStart + tf},${yStart} L ${xStart + tf},${50 - tw/2} L ${xEnd - tf},${50 - tw/2} L ${xEnd - tf},${yStart} L ${xEnd},${yStart} L ${xEnd},${yEnd} L ${xEnd - tf},${yEnd} L ${xEnd - tf},${50 + tw/2} L ${xStart + tf},${50 + tw/2} L ${xStart + tf},${yEnd} L ${xStart},${yEnd} Z`;
        return (
          <>
            <path d={pathData} {...s} fill={lightMode ? '#e2e8f0' : '#1e293b'} />
            <text x="50" y={Math.max(10, yStart - 4)} textAnchor="middle" {...t}>W</text>
            <text x={Math.max(6, xStart - 8)} y="54" textAnchor="middle" {...t}>H</text>
            <text x="50" y={50 - tw/2 - 2} textAnchor="middle" {...t} fontSize="9px">tw</text>
            <text x={xStart + tf/2} y={yEnd + 10} textAnchor="middle" {...t} fontSize="9px">tf</text>
          </>
        );
      }
      case 'BAR': {
        const maxVal = Math.max(dim1, dim2);
        const w = maxVal > 0 ? (dim1 / maxVal) * 50 + 20 : 60;
        const h = maxVal > 0 ? (dim2 / maxVal) * 50 + 20 : 50;
        const x = 50 - w / 2;
        const y = 50 - h / 2;
        return (
          <>
            <rect x={x} y={y} width={w} height={h} {...s} fill={lightMode ? '#e2e8f0' : '#1e293b'} />
            <text x="50" y={Math.max(10, y - 4)} textAnchor="middle" {...t}>W</text>
            <text x={Math.max(6, x - 8)} y="54" textAnchor="middle" {...t}>H</text>
          </>
        );
      }
      case 'L': {
        const maxVal = Math.max(dim1, dim2);
        const w = maxVal > 0 ? (dim1 / maxVal) * 50 + 20 : 60;
        const h = maxVal > 0 ? (dim2 / maxVal) * 50 + 20 : 60;
        const twRatio = Math.max(0.08, Math.min(0.4, dim4 / (dim1 || 1)));
        const tfRatio = Math.max(0.08, Math.min(0.4, dim3 / (dim2 || 1)));
        const tw = w * twRatio;
        const tf = h * tfRatio;
        const xStart = 50 - w/2;
        const yStart = 50 - h/2;
        const xEnd = 50 + w/2;
        const yEnd = 50 + h/2;
        const pathData = `M ${xStart},${yStart} L ${xStart + tw},${yStart} L ${xStart + tw},${yEnd - tf} L ${xEnd},${yEnd - tf} L ${xEnd},${yEnd} L ${xStart},${yEnd} Z`;
        return (
          <>
            <path d={pathData} {...s} fill={lightMode ? '#e2e8f0' : '#1e293b'} />
            <text x="50" y={yEnd + 10} textAnchor="middle" {...t}>W</text>
            <text x={Math.max(6, xStart - 8)} y="54" textAnchor="middle" {...t}>H</text>
            <text x={xStart + tw + 3} y={yStart + 12} textAnchor="start" {...t} fontSize="9px">tw</text>
            <text x={xEnd - 10} y={yEnd - tf - 3} textAnchor="middle" {...t} fontSize="9px">tf</text>
          </>
        );
      }
      case 'T': {
        const maxVal = Math.max(dim1, dim2);
        const w = maxVal > 0 ? (dim1 / maxVal) * 50 + 20 : 60;
        const h = maxVal > 0 ? (dim2 / maxVal) * 50 + 20 : 60;
        const tfRatio = Math.max(0.08, Math.min(0.4, dim3 / (dim2 || 1)));
        const twRatio = Math.max(0.08, Math.min(0.4, dim4 / (dim1 || 1)));
        const tf = h * tfRatio;
        const tw = w * twRatio;
        const xStart = 50 - w/2;
        const yStart = 50 - h/2;
        const xEnd = 50 + w/2;
        const yEnd = 50 + h/2;
        const pathData = `M ${xStart},${yStart} L ${xEnd},${yStart} L ${xEnd},${yStart + tf} L ${50 + tw/2},${yStart + tf} L ${50 + tw/2},${yEnd} L ${50 - tw/2},${yEnd} L ${50 - tw/2},${yStart + tf} L ${xStart},${yStart + tf} Z`;
        return (
          <>
            <path d={pathData} {...s} fill={lightMode ? '#e2e8f0' : '#1e293b'} />
            <text x="50" y={Math.max(10, yStart - 4)} textAnchor="middle" {...t}>W</text>
            <text x={Math.max(6, xStart - 8)} y="54" textAnchor="middle" {...t}>H</text>
            <text x={50 + tw/2 + 3} y={yEnd - 6} textAnchor="start" {...t} fontSize="9px">tw</text>
            <text x={xEnd + 3} y={yStart + tf/2 + 3} textAnchor="start" {...t} fontSize="9px">tf</text>
          </>
        );
      }
      case 'CHAN': {
        const maxVal = Math.max(dim1, dim2);
        const w = maxVal > 0 ? (dim1 / maxVal) * 50 + 20 : 60;
        const h = maxVal > 0 ? (dim2 / maxVal) * 50 + 20 : 60;
        const tfRatio = Math.max(0.08, Math.min(0.4, dim3 / (dim2 || 1)));
        const twRatio = Math.max(0.08, Math.min(0.4, dim4 / (dim1 || 1)));
        const tf = h * tfRatio;
        const tw = w * twRatio;
        const xStart = 50 - w/2;
        const yStart = 50 - h/2;
        const xEnd = 50 + w/2;
        const yEnd = 50 + h/2;
        const pathData = `M ${xEnd},${yStart} L ${xStart},${yStart} L ${xStart},${yEnd} L ${xEnd},${yEnd} L ${xEnd},${yEnd - tf} L ${xStart + tw},${yEnd - tf} L ${xStart + tw},${yStart + tf} L ${xEnd},${yStart + tf} Z`;
        return (
          <>
            <path d={pathData} {...s} fill={lightMode ? '#e2e8f0' : '#1e293b'} />
            <text x="50" y={Math.max(10, yStart - 4)} textAnchor="middle" {...t}>W</text>
            <text x={Math.max(6, xStart - 8)} y="54" textAnchor="middle" {...t}>H</text>
            <text x={xStart + tw + 3} y="54" textAnchor="start" {...t} fontSize="9px">tw</text>
            <text x={xEnd - 3} y={yStart + tf + 6} textAnchor="end" {...t} fontSize="9px">tf</text>
          </>
        );
      }
      case 'TUBE': {
        const rIn = Math.max(5, Math.min(30, 35 - (dim2 / (dim1 || 1)) * 35));
        return (
          <>
            <circle cx="50" cy="50" r="35" {...s} />
            <circle cx="50" cy="50" r={rIn} {...s} />
            <text x="50" y="54" textAnchor="middle" {...t}>D</text>
            <text x="78" y="54" textAnchor="middle" {...t} fontSize="9px">t</text>
          </>
        );
      }
      case 'ROD': {
        return (
          <>
            <circle cx="50" cy="50" r="35" {...s} fill={lightMode ? '#e2e8f0' : '#1e293b'} />
            <text x="50" y="54" textAnchor="middle" {...t}>D</text>
          </>
        );
      }
      default: return null;
    }
  };
  return <svg viewBox="0 0 100 100" className="w-full h-full opacity-80">{getSvgContent()}</svg>;
}
