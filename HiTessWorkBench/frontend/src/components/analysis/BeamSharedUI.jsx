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

export function SectionGuide({ type, lightMode = false }) {
  const s = { stroke: lightMode ? '#334155' : '#475569', strokeWidth: 2, fill: 'none' };
  const t = { fill: lightMode ? '#0369a1' : '#00E600', fontSize: '20px', fontFamily: 'monospace', fontWeight: 'bold' };
  const getSvgContent = () => {
    switch (type) {
      case 'I': return (<><path d="M 20,20 L 80,20 M 20,80 L 80,80 M 50,20 L 50,80" {...s} strokeWidth={6} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="55" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'H': return (<><path d="M 20,20 L 20,80 M 80,20 L 80,80 M 20,50 L 80,50" {...s} strokeWidth={6} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="45" y="45" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'BAR': return (<><rect x="20" y="25" width="60" height="50" {...s} fill={lightMode ? '#e2e8f0' : '#1e293b'} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text></>);
      case 'L': return (<><path d="M 20,20 L 20,80 L 80,80" {...s} strokeWidth={8} /><text x="45" y="95" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="25" y="45" {...t}>tw</text><text x="65" y="70" {...t}>tf</text></>);
      case 'T': return (<><path d="M 20,20 L 80,20 M 50,20 L 50,80" {...s} strokeWidth={8} /><text x="45" y="15" {...t}>W</text><text x="30" y="55" {...t}>H</text><text x="55" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'CHAN': return (<><path d="M 80,20 L 20,20 L 20,80 L 80,80" {...s} strokeWidth={8} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="25" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'TUBE': return (<><circle cx="50" cy="50" r="35" {...s} /><circle cx="50" cy="50" r="25" {...s} /><text x="45" y="55" {...t}>D</text><text x="80" y="55" {...t}>t</text></>);
      case 'ROD': return (<><circle cx="50" cy="50" r="35" {...s} fill={lightMode ? '#e2e8f0' : '#1e293b'} /><text x="45" y="55" {...t}>D</text></>);
      default: return null;
    }
  };
  return <svg viewBox="0 0 100 100" className="w-full h-full opacity-80">{getSvgContent()}</svg>;
}
