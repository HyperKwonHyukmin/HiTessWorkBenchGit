import React from 'react';
import { Clock3 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const TITLE_MAP = {
  hour:       '시간대별 실행 분포',
  weekday:    '요일별 실행 분포',
  dayOfMonth: '일자별 실행 분포',
};

export default function PeriodTimeChart({ timeBuckets }) {
  if (!timeBuckets || !timeBuckets.data?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Clock3 size={16} className="text-blue-600" />
        <h3 className="text-sm font-bold text-slate-800">{TITLE_MAP[timeBuckets.type] || '시간 분포'}</h3>
      </div>
      <div className="p-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={timeBuckets.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
