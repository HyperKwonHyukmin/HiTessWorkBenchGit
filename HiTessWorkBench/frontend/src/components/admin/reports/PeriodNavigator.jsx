import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

function fmtToday() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(period, dateISO, direction) {
  const d = new Date(dateISO + 'T00:00:00');
  if (period === 'daily')   d.setDate(d.getDate() + direction);
  if (period === 'weekly')  d.setDate(d.getDate() + 7 * direction);
  if (period === 'monthly') d.setMonth(d.getMonth() + direction);
  return d.toISOString().slice(0, 10);
}

export default function PeriodNavigator({ period, date, label, onChange }) {
  const today = fmtToday();
  const isFutureNext = useMemo(() => shiftDate(period, date, +1) > today, [period, date, today]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(shiftDate(period, date, -1))}
        className="p-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
        aria-label="이전 기간"
      >
        <ChevronLeft size={18} className="text-slate-600" />
      </button>
      <div className="px-4 py-2 min-w-[260px] text-center rounded-md border border-slate-200 bg-white text-sm font-bold text-slate-800">
        {label || '—'}
      </div>
      <button
        type="button"
        disabled={isFutureNext}
        onClick={() => onChange(shiftDate(period, date, +1))}
        className={`p-2 rounded-md border border-slate-200 bg-white ${isFutureNext ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50'}`}
        aria-label="다음 기간"
      >
        <ChevronRight size={18} className="text-slate-600" />
      </button>
      <div className="flex items-center gap-1 px-3 py-2 rounded-md border border-slate-200 bg-white">
        <Calendar size={16} className="text-slate-500" />
        <input
          type="date"
          value={date}
          max={today}
          onChange={e => onChange(e.target.value)}
          className="text-sm text-slate-700 bg-transparent outline-none"
        />
      </div>
    </div>
  );
}
