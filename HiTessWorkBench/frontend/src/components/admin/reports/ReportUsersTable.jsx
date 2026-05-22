import React from 'react';
import { Users } from 'lucide-react';

export default function ReportUsersTable({ users, footnote }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Users size={16} className="text-emerald-600" /> 사용자별 사용 통계
        </h3>
        <span className="text-xs text-slate-400">실행 횟수순</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-bold">사번</th>
              <th className="px-4 py-3 text-left font-bold">이름</th>
              <th className="px-4 py-3 text-left font-bold">부서</th>
              <th className="px-4 py-3 text-right font-bold">실행</th>
              <th className="px-4 py-3 text-right font-bold">점유율</th>
              <th className="px-4 py-3 text-right font-bold">사용 앱 수</th>
              <th className="px-5 py-3 text-right font-bold">최근 실행</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td className="px-5 py-6 text-center text-slate-400" colSpan={7}>데이터 없음</td></tr>
            ) : users.map(u => (
              <tr key={u.employeeId} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs text-slate-600">{u.employeeId}</td>
                <td className="px-4 py-3 text-slate-800">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.department}</td>
                <td className="px-4 py-3 text-right text-slate-700">{u.count}</td>
                <td className="px-4 py-3 text-right text-slate-500">{u.share}%</td>
                <td className="px-4 py-3 text-right text-slate-700">{u.programCount}</td>
                <td className="px-5 py-3 text-right text-xs text-slate-500">
                  {u.lastRun ? new Date(u.lastRun).toLocaleString() : '-'}
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
