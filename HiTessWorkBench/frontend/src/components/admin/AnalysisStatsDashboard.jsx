import React from 'react';
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, Layers,
  Server, Trophy, Users
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';

const COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be123c', '#4f46e5'];

const KPI_COLOR_MAP = {
  blue: 'border-l-blue-500 bg-blue-50 text-blue-700',
  emerald: 'border-l-emerald-500 bg-emerald-50 text-emerald-700',
  amber: 'border-l-amber-500 bg-amber-50 text-amber-700',
  violet: 'border-l-violet-500 bg-violet-50 text-violet-700',
};

function KpiCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div className={`bg-white border border-slate-200 border-l-4 ${KPI_COLOR_MAP[color]} rounded-lg p-4 shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-500 truncate">{sub}</p>}
        </div>
        <Icon size={26} className="shrink-0 opacity-70" />
      </div>
    </div>
  );
}

function RateBadge({ value }) {
  const tone = value >= 90 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : value >= 70 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200';
  return <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${tone}`}>{value}%</span>;
}

function ProgramTable({ rows }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Layers size={16} className="text-blue-600" /> 프로그램별 사용 통계</h3>
        <span className="text-xs text-slate-400">사용량순</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-bold">프로그램</th>
              <th className="px-4 py-3 text-right font-bold">실행</th>
              <th className="px-4 py-3 text-right font-bold">점유율</th>
              <th className="px-4 py-3 text-center font-bold">성공률</th>
              <th className="px-4 py-3 text-right font-bold">사용자</th>
              <th className="px-4 py-3 text-right font-bold">API 비율</th>
              <th className="px-5 py-3 text-right font-bold">최근 실행</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={row.name} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <span className="font-bold text-slate-800 truncate" title={row.name}>{row.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-black text-slate-800">{row.count}</td>
                <td className="px-4 py-3 text-right text-slate-600">{row.share}%</td>
                <td className="px-4 py-3 text-center"><RateBadge value={row.successRate} /></td>
                <td className="px-4 py-3 text-right text-slate-600">{row.userCount}</td>
                <td className="px-4 py-3 text-right text-slate-600">{row.apiRate}%</td>
                <td className="px-5 py-3 text-right text-xs text-slate-500 font-mono">{row.lastRunLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserTable({ rows }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Users size={16} className="text-indigo-600" /> 사용자별 활용 통계</h3>
        <span className="text-xs text-slate-400">상위 사용자</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-bold">사용자</th>
              <th className="px-4 py-3 text-left font-bold">부서</th>
              <th className="px-4 py-3 text-right font-bold">실행</th>
              <th className="px-4 py-3 text-right font-bold">프로그램 수</th>
              <th className="px-4 py-3 text-center font-bold">성공률</th>
              <th className="px-4 py-3 text-right font-bold">API 비율</th>
              <th className="px-5 py-3 text-right font-bold">최근 실행</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={row.employee_id} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center text-xs font-black text-slate-400">{index + 1}</span>
                    <div>
                      <p className="font-bold text-slate-800">{row.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{row.employee_id}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{row.dept}</td>
                <td className="px-4 py-3 text-right font-black text-slate-800">{row.count}</td>
                <td className="px-4 py-3 text-right text-slate-600">{row.programCount}</td>
                <td className="px-4 py-3 text-center"><RateBadge value={row.successRate} /></td>
                <td className="px-4 py-3 text-right text-slate-600">{row.apiRate}%</td>
                <td className="px-5 py-3 text-right text-xs text-slate-500 font-mono">{row.lastRunLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AnalysisStatsDashboard({ stats }) {
  return (
    <div className="space-y-6 mb-8">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="총 실행" value={stats.total} sub={`${stats.coveredDays}일 기준, 일평균 ${stats.avgPerDay}건`} icon={Activity} color="blue" />
        <KpiCard label="성공률" value={`${stats.successRate}%`} sub={`성공 ${stats.success}건 / 실패 ${stats.failed}건`} icon={CheckCircle2} color="emerald" />
        <KpiCard label="활성 프로그램" value={stats.activePrograms} sub={stats.busiestProgram ? `최다 사용: ${stats.busiestProgram.name}` : '사용 기록 없음'} icon={Layers} color="amber" />
        <KpiCard label="활성 사용자" value={stats.activeUsers} sub={`${stats.activeDepartments}개 부서, API 호출 ${stats.apiRate}%`} icon={Users} color="violet" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Clock3 size={16} className="text-emerald-600" /> 실행 추이</h3>
            <span className="text-xs text-slate-400">최근 최대 14개 날짜</span>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trendData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="analysisTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="#059669" strokeWidth={3} fill="url(#analysisTrend)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-4"><Server size={16} className="text-violet-600" /> 호출 출처</h3>
          <div className="h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.sourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={76}>
                  {stats.sourceData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3">
              <p className="font-bold text-indigo-700">Workbench UI</p>
              <p className="text-xl font-black text-slate-900">{stats.workbenchCalls}</p>
            </div>
            <div className="rounded-lg bg-violet-50 border border-violet-100 p-3">
              <p className="font-bold text-violet-700">External API</p>
              <p className="text-xl font-black text-slate-900">{stats.apiCalls}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-4"><BarChart3 size={16} className="text-blue-600" /> 상위 프로그램 사용량</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.topPrograms} layout="vertical" margin={{ top: 4, right: 24, left: 24, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={150} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {stats.topPrograms.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-4"><Trophy size={16} className="text-amber-600" /> 상위 사용자</h3>
          <div className="space-y-3">
            {stats.topUsers.map((user, index) => (
              <div key={user.employee_id} className="flex items-center gap-3">
                <span className="w-6 text-center text-sm font-black text-slate-400">{index + 1}</span>
                <div className="min-w-0 w-44">
                  <p className="text-sm font-bold text-slate-800 truncate">{user.name}</p>
                  <p className="text-xs text-slate-400 truncate">{user.dept}</p>
                </div>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.max(user.share, 3)}%` }} />
                </div>
                <span className="w-12 text-right text-sm font-black text-slate-800">{user.count}</span>
                <RateBadge value={user.successRate} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <ProgramTable rows={stats.programRows} />
      <UserTable rows={stats.userRows} />

      {stats.riskyPrograms.length > 0 && (
        <div className="bg-white border border-red-200 rounded-lg shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-red-600" /> 실패가 발생한 프로그램
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {stats.riskyPrograms.map(item => (
              <div key={item.name} className="rounded-lg border border-red-100 bg-red-50 p-3">
                <p className="text-xs font-bold text-slate-700 truncate" title={item.name}>{item.name}</p>
                <p className="mt-2 text-xl font-black text-red-600">{item.failed}</p>
                <p className="text-xs text-slate-500">실패 / 총 {item.count}건</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
