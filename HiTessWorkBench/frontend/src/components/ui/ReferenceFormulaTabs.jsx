import React, { useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, ImageIcon } from 'lucide-react';

const DEFAULT_TABS = [
  { key: 'image', label: '참조 그림', icon: ImageIcon },
  { key: 'formula', label: '계산 수식', icon: BarChart3 },
];

export default function ReferenceFormulaTabs({
  title = '참조 그림 및 계산 수식',
  tabs = DEFAULT_TABS,
  defaultTab = 'image',
  defaultOpen = true,
  accent = 'emerald',
  children,
  className = 'mb-6',
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState(defaultTab);

  const active = tabs.find(tab => tab.key === activeTab) ?? tabs[0];
  // Parametric Apps share the Carling-style emerald signature color.
  // Legacy accent values are intentionally mapped to emerald for consistency.
  const accentClass = {
    emerald: 'border-emerald-500 text-emerald-700',
    indigo: 'border-emerald-500 text-emerald-700',
    violet: 'border-emerald-500 text-emerald-700',
  }[accent] ?? 'border-emerald-500 text-emerald-700';

  return (
    <div className={`bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden ${className}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-6 py-3.5 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-slate-500">
          <BarChart3 size={14} className="text-slate-400" />
          {title}
        </span>
        {open
          ? <ChevronUp size={15} className="text-slate-400" />
          : <ChevronDown size={15} className="text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100">
          <div className="flex border-b border-gray-100 bg-slate-50/60 overflow-x-auto">
            {tabs.map(({ key, label, icon: Icon }) => {
              const selected = active.key === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold transition-colors cursor-pointer border-b-2 -mb-px whitespace-nowrap ${
                    selected
                      ? `${accentClass} bg-white`
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              );
            })}
          </div>
          {children(active.key)}
        </div>
      )}
    </div>
  );
}
