import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

// 로컬(KST) 캘린더 날짜를 YYYY-MM-DD 로 포맷. toISOString(UTC)을 쓰면 KST 자정↔UTC 전날
// 사이 오차로 날짜 계산이 어긋나므로(예: +1 이 같은 날로 되돌아옴) 로컬 연·월·일만 사용한다.
function localDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtToday() {
  return localDateISO(new Date());
}

function shiftDate(period, dateISO, direction) {
  // 문자열을 로컬 정수 성분으로 파싱해 로컬 기준으로만 가감(타임존 드리프트 없음).
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (period === 'daily')   dt.setDate(dt.getDate() + direction);
  if (period === 'weekly')  dt.setDate(dt.getDate() + 7 * direction);
  if (period === 'monthly') {
    // setMonth 는 일(day)이 대상 월의 말일보다 크면 다음 달로 넘쳐 월을 건너뛴다
    // (예: 1/31 +1달 → 3/3). 일을 1로 내렸다가 대상 월의 말일로 clamp 해 오버플로를 막는다.
    const targetDay = dt.getDate();
    dt.setDate(1);
    dt.setMonth(dt.getMonth() + direction);
    const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    dt.setDate(Math.min(targetDay, lastDay));
  }
  return localDateISO(dt);
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
