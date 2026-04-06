import React from 'react';
import { BarChart3, Download, CalendarRange } from 'lucide-react';

export default function AnalysisFilterBar({ dateFrom, dateTo, onDateFromChange, onDateToChange, onDownloadCSV }) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
      <div>
        <h1 className="text-3xl font-bold text-[#002554] flex items-center gap-3">
          <BarChart3 className="text-emerald-600" size={32} /> Analysis Management
        </h1>
        <p className="text-slate-500 mt-2">전체 구조 해석 수행 통계 및 호출 출처(API/UI) 트래킹 대시보드</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm">
          <CalendarRange size={16} className="text-slate-400 shrink-0" />
          <input type="date" value={dateFrom} onChange={e => onDateFromChange(e.target.value)}
            className="text-sm text-slate-700 outline-none bg-transparent cursor-pointer" />
          <span className="text-slate-300 font-bold">—</span>
          <input type="date" value={dateTo} onChange={e => onDateToChange(e.target.value)}
            className="text-sm text-slate-700 outline-none bg-transparent cursor-pointer" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { onDateFromChange(''); onDateToChange(''); }}
              className="text-slate-400 hover:text-red-400 transition-colors ml-1 cursor-pointer text-xs font-bold">초기화</button>
          )}
        </div>
        <button onClick={onDownloadCSV}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700 shadow-md transition-colors cursor-pointer">
          <Download size={18} /> CSV 내보내기
        </button>
      </div>
    </div>
  );
}
