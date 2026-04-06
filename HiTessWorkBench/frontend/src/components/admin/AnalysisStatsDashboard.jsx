import React from 'react';
import {
  Activity, CheckCircle2, XCircle, Layers, Server, Users, Calendar,
  Trophy, AlertTriangle, TrendingUp, Grid3x3, BarChart3
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

// Tailwind JIT 호환 정적 클래스 맵 (동적 템플릿 리터럴 사용 불가)
const KPI_COLOR_MAP = {
  blue:    { border: 'border-l-blue-500',    icon: 'text-blue-200' },
  emerald: { border: 'border-l-emerald-500', icon: 'text-emerald-200' },
  indigo:  { border: 'border-l-indigo-500',  icon: 'text-indigo-200' },
  purple:  { border: 'border-l-purple-500',  icon: 'text-purple-200' },
};

export default function AnalysisStatsDashboard({ stats }) {
  return (
    <>
      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Executions', value: stats.total,                  icon: Activity,     color: 'blue' },
          { label: 'Success Rate',     value: `${stats.successRate}%`,      icon: CheckCircle2, color: 'emerald' },
          { label: 'Workbench UI',     value: stats.total - stats.apiCalls, icon: Layers,       color: 'indigo' },
          { label: 'External API',     value: stats.apiCalls,               icon: Server,       color: 'purple' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 ${KPI_COLOR_MAP[color].border}`}>
            <div><p className="text-xs font-bold text-slate-400 mb-1">{label}</p><h3 className="text-2xl font-black text-slate-800">{value}</h3></div>
            <Icon className={KPI_COLOR_MAP[color].icon} size={32}/>
          </div>
        ))}
      </div>

      {/* 차트 3종 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4"><Layers size={16} className="text-blue-500"/> Module Distribution</h3>
          <div className="flex-1 min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={stats.programData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={5} dataKey="value">{stats.programData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}</Pie><Tooltip/></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 mt-2">
            {stats.programData.map((e, i) => <span key={i} className="flex items-center gap-1 text-[11px] text-slate-600"><span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }}/>{e.name}</span>)}
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4"><Users size={16} className="text-indigo-500"/> Usage by Department</h3>
          <div className="flex-1 min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.deptData} margin={{ top:5, right:10, left:-20, bottom:0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/><XAxis dataKey="name" tick={{fontSize:10}} interval={0}/><YAxis tick={{fontSize:10}}/><Tooltip cursor={{fill:'#f1f5f9'}}/><Bar dataKey="count" fill="#4f46e5" radius={[4,4,0,0]} barSize={30}/></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4"><Calendar size={16} className="text-emerald-500"/> Recent Activity Trend</h3>
          <div className="flex-1 min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trendData} margin={{ top:5, right:10, left:-20, bottom:0 }}>
                <defs><linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/><XAxis dataKey="date" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/>
                <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Users + Top Departments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-5"><Trophy size={16} className="text-amber-500"/> Top Users</h3>
          <div className="space-y-3">
            {stats.topUsers.map((user, idx) => {
              const pct = Math.round((user.count / stats.total) * 100);
              return (
                <div key={idx} className="flex items-center gap-3">
                  <span className={`text-sm font-black w-5 text-center shrink-0 ${['text-amber-400','text-slate-400','text-amber-700'][idx] || 'text-slate-300'}`}>{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold text-slate-700 truncate">{user.name}</span><span className="text-xs text-slate-400 shrink-0 ml-2">{user.count}건</span></div>
                    <div className="flex items-center gap-2"><div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden"><div className="h-full rounded-full bg-amber-400 transition-all duration-500" style={{ width: `${Math.max(pct,2)}%` }}/></div><span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">{user.dept}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-5"><TrendingUp size={16} className="text-indigo-500"/> Top Departments</h3>
          <div className="space-y-3">
            {stats.topDepts.map((dept, idx) => {
              const pct = Math.round((dept.count / stats.total) * 100);
              const successPct = dept.count > 0 ? Math.round((dept.success / dept.count) * 100) : 0;
              return (
                <div key={idx} className="flex items-center gap-3">
                  <span className={`text-sm font-black w-5 text-center shrink-0 ${['text-amber-400','text-slate-400','text-amber-700'][idx] || 'text-slate-300'}`}>{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold text-slate-700 truncate">{dept.name}</span><span className="text-xs text-slate-400 shrink-0 ml-2">{dept.count}건</span></div>
                    <div className="flex items-center gap-2"><div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden"><div className="h-full rounded-full bg-indigo-400 transition-all duration-500" style={{ width: `${Math.max(pct,2)}%` }}/></div><span className={`text-[10px] font-bold shrink-0 ${successPct >= 80 ? 'text-emerald-500' : successPct >= 50 ? 'text-amber-500' : 'text-red-400'}`}>✓ {successPct}%</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 부서×모듈 교차표 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-5"><Grid3x3 size={16} className="text-violet-500"/> Department × Module Cross Table <span className="text-[10px] text-slate-400 font-normal ml-1">— 셀 숫자: 해석 수행 건수</span></h3>
        <div className="overflow-x-auto">
          <table className="text-xs w-full">
            <thead><tr><th className="text-left py-2 pr-4 text-slate-500 font-bold whitespace-nowrap w-32">부서 \ 모듈</th>{stats.crossTable.modules.map((m, i) => <th key={i} className="text-center py-2 px-2 font-bold text-slate-500 whitespace-nowrap min-w-[80px]">{m}</th>)}<th className="text-center py-2 px-2 font-bold text-slate-400 whitespace-nowrap">합계</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {stats.crossTable.depts.map((dept, di) => {
                const rowTotal = stats.crossTable.matrix[di].reduce((s, v) => s + v, 0);
                return (
                  <tr key={di} className="hover:bg-slate-50">
                    <td className="py-2 pr-4 font-bold text-slate-700 whitespace-nowrap">{dept}</td>
                    {stats.crossTable.matrix[di].map((val, mi) => {
                      const intensity = val / stats.crossTable.maxVal;
                      return <td key={mi} className="text-center py-2 px-2 font-bold rounded-lg" style={{ backgroundColor: val > 0 ? `rgba(99,102,241,${0.08+intensity*0.72})` : 'transparent', color: intensity > 0.5 ? 'white' : val > 0 ? '#4338ca' : '#cbd5e1' }}>{val > 0 ? val : '—'}</td>;
                    })}
                    <td className="text-center py-2 px-2 font-black text-slate-600">{rowTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 해석 종류별 사용량 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-5"><BarChart3 size={16} className="text-rose-500"/> Usage by Analysis Type</h3>
        <div className="space-y-3">
          {stats.moduleUsageData.map((item, idx) => {
            const pct = Math.round((item.count / stats.total) * 100);
            const successPct = item.count > 0 ? Math.round((item.success / item.count) * 100) : 0;
            return (
              <div key={idx} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 font-medium w-48 shrink-0 truncate" title={item.name}>{item.name}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden"><div className="h-full rounded-full flex items-center justify-end pr-2 transition-all duration-500" style={{ width: `${Math.max(pct,3)}%`, backgroundColor: COLORS[idx % COLORS.length] }}>{pct >= 8 && <span className="text-[10px] font-bold text-white">{item.count}</span>}</div></div>
                <span className="text-xs font-bold text-slate-500 w-10 text-right shrink-0">{pct}%</span>
                <span className={`text-[10px] font-bold w-16 text-right shrink-0 ${successPct >= 80 ? 'text-emerald-500' : successPct >= 50 ? 'text-amber-500' : 'text-red-400'}`}>✓ {successPct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 실패 분석 */}
      {stats.failedCount > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-5"><AlertTriangle size={16} className="text-red-500"/> Failure Analysis <span className="ml-auto text-xs font-bold text-red-500 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">총 {stats.failedCount}건 실패</span></h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">모듈별 실패 건수 (상위 5)</p>
              <div className="space-y-2">
                {stats.failuresByModuleData.map((item, idx) => {
                  const pct = Math.round((item.count / stats.failedCount) * 100);
                  return <div key={idx} className="flex items-center gap-3"><span className="text-xs text-slate-600 font-medium w-44 shrink-0 truncate" title={item.name}>{item.name}</span><div className="flex-1 bg-red-50 rounded-full h-4 overflow-hidden"><div className="h-full rounded-full bg-red-400 flex items-center justify-end pr-2 transition-all duration-500" style={{ width: `${Math.max(pct,4)}%` }}>{pct >= 15 && <span className="text-[9px] font-bold text-white">{item.count}</span>}</div></div><span className="text-xs font-bold text-red-400 w-8 text-right shrink-0">{item.count}</span></div>;
                })}
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">최근 실패 이력 (최근 3건)</p>
              <div className="space-y-2">
                {stats.recentFailures.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
                    <XCircle size={14} className="text-red-400 mt-0.5 shrink-0"/>
                    <div className="min-w-0"><span className="text-xs font-bold text-slate-700 block truncate">{item.program_name}</span><span className="text-[10px] text-slate-500">{item.userName} · {new Date(item.created_at).toLocaleDateString()}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
