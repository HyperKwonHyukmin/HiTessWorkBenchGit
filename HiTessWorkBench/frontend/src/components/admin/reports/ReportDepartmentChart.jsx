import React from 'react';
import { Building2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function ReportDepartmentChart({ departments }) {
  if (!departments?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Building2 size={16} className="text-violet-600" />
        <h3 className="text-sm font-bold text-slate-800">부서별 실행 분포</h3>
      </div>
      <div className="p-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={departments.slice(0, 8)} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={120} />
            <Tooltip />
            <Bar dataKey="count" fill="#7c3aed" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
