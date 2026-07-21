import React from 'react';
import { Download, CalendarRange } from 'lucide-react';

// 상태 필터 옵션 — All(전체) / Success(성공) / Failed(실패)
const STATUS_OPTIONS = [['All', '전체'], ['Success', '성공'], ['Failed', '실패']];

export default function AnalysisFilterBar({
  dateFrom, dateTo, onDateFromChange, onDateToChange, onDownloadCSV,
  statusFilter, onStatusFilterChange,
}) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* 상태 필터 — /api/analysis/all 이 아직 status 파라미터를 지원하지 않아
            현재 로드된 페이지(analyses)에만 클라이언트 사이드로 적용된다. 완전한 결과를 위해서는
            백엔드 status 파라미터 지원이 필요하다(후속 작업). */}
        <div className="inline-flex items-center gap-0.5 bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
          {STATUS_OPTIONS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onStatusFilterChange(key)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                statusFilter === key
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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
      </div>
      <button onClick={onDownloadCSV}
        className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700 shadow-md transition-colors cursor-pointer">
        <Download size={18} /> CSV 내보내기
      </button>
    </div>
  );
}
