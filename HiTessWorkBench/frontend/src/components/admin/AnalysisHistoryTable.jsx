import React from 'react';
import { Search, CheckCircle2, XCircle } from 'lucide-react';

export default function AnalysisHistoryTable({ filteredAnalyses, searchTerm, onSearchChange }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h3 className="font-bold text-slate-700">Detailed Execution History</h3>
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/>
          <input type="text" placeholder="검색 (프로그램, 프로젝트, 사용자, 부서)..." value={searchTerm}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 shadow-sm"/>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[400px]">
        <table className="w-full text-left whitespace-nowrap">
          <thead className="bg-white border-b border-slate-200 text-slate-500 text-xs uppercase sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="py-4 px-6 font-bold">ID / Project</th>
              <th className="py-4 px-6 font-bold">Module</th>
              <th className="py-4 px-6 font-bold">Requester (Dept)</th>
              <th className="py-4 px-6 font-bold text-center">Status</th>
              <th className="py-4 px-6 font-bold text-right">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAnalyses.length === 0 && (
              <tr><td colSpan={5} className="py-12 text-center text-slate-400 text-sm">검색 결과가 없습니다.</td></tr>
            )}
            {filteredAnalyses.map(item => (
              <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-3 px-6">
                  <span className="text-xs font-mono font-bold text-slate-400 block mb-0.5">#{item.id}</span>
                  <span className="text-sm font-bold text-slate-700">{item.project_name || 'Unnamed'}</span>
                </td>
                <td className="py-3 px-6 text-sm font-medium text-blue-600">{item.program_name}</td>
                <td className="py-3 px-6">
                  <span className="text-sm font-bold text-slate-800 block">{item.userName} <span className="text-xs font-mono font-normal text-slate-400 ml-1">({item.employee_id})</span></span>
                  <span className="text-xs text-slate-500">{item.department}</span>
                </td>
                <td className="py-3 px-6 text-center">
                  {item.status === 'Success'
                    ? <span className="text-xs font-bold text-emerald-600 flex items-center justify-center gap-1"><CheckCircle2 size={14}/> Success</span>
                    : <span className="text-xs font-bold text-red-500 flex items-center justify-center gap-1"><XCircle size={14}/> Failed</span>}
                </td>
                <td className="py-3 px-6 text-right text-xs text-slate-500 font-mono">
                  {new Date(item.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
