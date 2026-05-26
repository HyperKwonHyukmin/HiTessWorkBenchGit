import React from 'react';
import { Layers } from 'lucide-react';

export default function ReportProgramsTable({ programs, footnote }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden min-w-0">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Layers size={16} className="text-blue-600" /> 프로그램별 사용 통계
        </h3>
        <span className="text-xs text-slate-400">사용량순</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-bold">프로그램</th>
              <th className="px-4 py-3 text-right font-bold">실행</th>
              <th className="px-4 py-3 text-right font-bold">점유율</th>
              <th className="px-4 py-3 text-right font-bold">사용자</th>
              <th className="px-5 py-3 text-right font-bold">최근 실행</th>
            </tr>
          </thead>
          <tbody>
            {programs.length === 0 ? (
              <tr><td className="px-5 py-6 text-center text-slate-400" colSpan={5}>데이터 없음</td></tr>
            ) : programs.map(p => (
              <tr key={p.name} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-800">{p.name}</td>
                <td className="px-4 py-3 text-right text-slate-700">{p.count}</td>
                <td className="px-4 py-3 text-right text-slate-500">{p.share}%</td>
                <td className="px-4 py-3 text-right text-slate-700">{p.userCount}</td>
                <td className="px-5 py-3 text-right text-xs text-slate-500">
                  {p.lastRun ? new Date(p.lastRun).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footnote && (
        <div className="px-5 py-2 text-[11px] text-slate-400 border-t border-slate-100 bg-slate-50/60">
          {footnote}
        </div>
      )}
    </div>
  );
}
