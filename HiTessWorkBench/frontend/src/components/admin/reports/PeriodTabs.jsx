import React from 'react';
import { CalendarDays, CalendarRange, Calendar } from 'lucide-react';

const TABS = [
  { key: 'daily',   label: 'Daily',   icon: CalendarDays },
  { key: 'weekly',  label: 'Weekly',  icon: CalendarRange },
  { key: 'monthly', label: 'Monthly', icon: Calendar },
];

export default function PeriodTabs({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
      {TABS.map(t => {
        const Icon = t.icon;
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-bold transition ${
              active
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Icon size={16} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
