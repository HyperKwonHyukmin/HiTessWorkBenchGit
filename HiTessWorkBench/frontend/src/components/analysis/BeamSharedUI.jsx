/**
 * @fileoverview 단면 해석기에 사용되는 공통 UI 조각 컴포넌트들
 */
import React from 'react';

export function InputRow({ label, value, unit, onChange, disabled }) {
  return (
    <div className={`flex items-center justify-between bg-slate-900 border border-transparent rounded p-1 transition-colors group ${disabled ? 'opacity-60' : 'hover:border-slate-700'}`}>
      <span className="text-[11px] text-slate-400 pl-2 group-hover:text-slate-300 w-2/5 truncate">{label}</span>
      <div className={`flex items-center w-3/5 bg-slate-950 border border-slate-800 rounded px-2 ${!disabled && 'focus-within:border-[#00E600]'}`}>
        <input type="number" value={value} onChange={onChange} disabled={disabled} className="w-full bg-transparent py-1 text-sm text-[#00E600] font-bold outline-none font-mono text-right disabled:cursor-not-allowed" />
        <span className="text-[10px] text-slate-600 font-mono ml-1 w-6 text-right">{unit}</span>
      </div>
    </div>
  );
}

export function SummaryRow({ label, value, unit, sub }) {
  return (
    <div className="flex justify-between items-center bg-slate-900 p-2 rounded border border-slate-800">
      <div className="flex flex-col">
        <span className="text-slate-400 font-medium">{label}</span>
        {sub && <span className="text-[10px] text-slate-500 font-mono">{sub}</span>}
      </div>
      <div className="text-right">
        <span className="text-emerald-400 font-bold text-sm">{value || '0'}</span>
        {unit && <span className="text-[10px] text-slate-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export function SectionGuide({ type }) {
  const s = { stroke: '#475569', strokeWidth: 2, fill: 'none' };
  const t = { fill: '#00E600', fontSize: '20px', fontFamily: 'monospace', fontWeight: 'bold' };
  const getSvgContent = () => {
    switch (type) {
      case 'I': return (<><path d="M 20,20 L 80,20 M 20,80 L 80,80 M 50,20 L 50,80" {...s} strokeWidth={6} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="55" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'H': return (<><path d="M 20,20 L 20,80 M 80,20 L 80,80 M 20,50 L 80,50" {...s} strokeWidth={6} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="45" y="45" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'BAR': return (<><rect x="20" y="25" width="60" height="50" {...s} fill="#1e293b" /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text></>);
      case 'L': return (<><path d="M 20,20 L 20,80 L 80,80" {...s} strokeWidth={8} /><text x="45" y="95" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="25" y="45" {...t}>tw</text><text x="65" y="70" {...t}>tf</text></>);
      case 'T': return (<><path d="M 20,20 L 80,20 M 50,20 L 50,80" {...s} strokeWidth={8} /><text x="45" y="15" {...t}>W</text><text x="30" y="55" {...t}>H</text><text x="55" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'CHAN': return (<><path d="M 80,20 L 20,20 L 20,80 L 80,80" {...s} strokeWidth={8} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="25" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'TUBE': return (<><circle cx="50" cy="50" r="35" {...s} /><circle cx="50" cy="50" r="25" {...s} /><text x="45" y="55" {...t}>D</text><text x="80" y="55" {...t}>t</text></>);
      case 'ROD': return (<><circle cx="50" cy="50" r="35" {...s} fill="#1e293b" /><text x="45" y="55" {...t}>D</text></>);
      default: return null;
    }
  };
  return <svg viewBox="0 0 100 100" className="w-full h-full opacity-80">{getSvgContent()}</svg>;
}