/// <summary>
/// 관리자 전용 해석 관리 및 통계 대시보드.
/// Recharts 라이브러리를 활용하여 모듈별, 부서별, 기간별 통계를 시각화합니다.
/// </summary>
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../../config';
import { 
  BarChart3, Download, Search, Activity, CheckCircle2, XCircle,
  Layers, Server, Users, Calendar, RefreshCw
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from 'recharts';

export default function AnalysisManagement() {
  const [analyses, setAnalyses] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // 테마 색상 팔레트
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // 해석 이력과 유저 메타데이터를 동시에 가져와서 조인(Join)
        const [analysisRes, userRes] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/analysis/all`),
          axios.get(`${API_BASE_URL}/api/users`)
        ]);
        
        const usersData = userRes.data;
        const mappedAnalyses = analysisRes.data.map(a => {
          const u = usersData.find(user => user.employee_id === a.employee_id);
          return {
            ...a,
            department: u ? u.department || 'Unknown' : 'Unknown',
            userName: u ? u.name : 'Deleted User',
            source: a.source || 'Workbench' // 과거 데이터 호환성
          };
        });
        
        setAnalyses(mappedAnalyses);
        setUsers(usersData);
      } catch (err) {
        console.error("통계 데이터 로드 실패", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // ==========================================
  // [통계 데이터 가공 로직 - useMemo로 성능 최적화]
  // ==========================================
  const stats = useMemo(() => {
    if (!analyses.length) return null;

    const total = analyses.length;
    const success = analyses.filter(a => a.status === 'Success').length;
    const successRate = ((success / total) * 100).toFixed(1);
    
    const apiCalls = analyses.filter(a => a.source === 'External API').length;

    // 1. 모듈별 통계 (Pie Chart)
    const programMap = {};
    analyses.forEach(a => programMap[a.program_name] = (programMap[a.program_name] || 0) + 1);
    const programData = Object.keys(programMap).map(k => ({ name: k, value: programMap[k] }));

    // 2. 부서별 통계 (Bar Chart)
    const deptMap = {};
    analyses.forEach(a => deptMap[a.department] = (deptMap[a.department] || 0) + 1);
    const deptData = Object.keys(deptMap).map(k => ({ name: k, count: deptMap[k] }));

    // 3. 일자별 트렌드 통계 (Area Chart) - 최근 7일
    const dateMap = {};
    analyses.forEach(a => {
      const d = new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      dateMap[d] = (dateMap[d] || 0) + 1;
    });
    // 날짜별로 정렬이 안될 수 있으므로 간단한 객체 변환만 (실제 서비스에선 Date 정렬 필요)
    const trendData = Object.keys(dateMap).slice(0, 7).reverse().map(k => ({ date: k, count: dateMap[k] }));

    return { total, successRate, apiCalls, programData, deptData, trendData };
  }, [analyses]);

  // CSV 다운로드 기능
  const downloadCSV = () => {
    const headers = "ID,Project,Module,Requester,Department,Source,Status,Date\n";
    const rows = analyses.map(a => 
      `${a.id},${a.project_name || ''},${a.program_name},${a.userName}(${a.employee_id}),${a.department},${a.source},${a.status},${new Date(a.created_at).toLocaleString()}`
    ).join("\n");

    const blob = new Blob(["\uFEFF" + headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Analysis_Report_${new Date().getTime()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredAnalyses = analyses.filter(a => 
    a.program_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.userName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#002554] flex items-center gap-3">
            <BarChart3 className="text-emerald-600" size={32} /> Analysis Management
          </h1>
          <p className="text-slate-500 mt-2">전체 구조 해석 수행 통계 및 호출 출처(API/UI) 트래킹 대시보드</p>
        </div>
        <button onClick={downloadCSV} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700 shadow-md transition-colors cursor-pointer">
          <Download size={18} /> CSV 내보내기
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-blue-500" size={40}/></div>
      ) : !stats ? (
        <div className="text-center py-20 text-slate-400">데이터가 없습니다.</div>
      ) : (
        <>
          {/* KPI 요약 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 border-l-blue-500">
              <div><p className="text-xs font-bold text-slate-400 mb-1">Total Executions</p><h3 className="text-2xl font-black text-slate-800">{stats.total}</h3></div>
              <Activity className="text-blue-200" size={32}/>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 border-l-emerald-500">
              <div><p className="text-xs font-bold text-slate-400 mb-1">Success Rate</p><h3 className="text-2xl font-black text-slate-800">{stats.successRate}%</h3></div>
              <CheckCircle2 className="text-emerald-200" size={32}/>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 border-l-indigo-500">
              <div><p className="text-xs font-bold text-slate-400 mb-1">Workbench UI</p><h3 className="text-2xl font-black text-slate-800">{stats.total - stats.apiCalls}</h3></div>
              <Layers className="text-indigo-200" size={32}/>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 border-l-purple-500">
              <div><p className="text-xs font-bold text-slate-400 mb-1">External API</p><h3 className="text-2xl font-black text-slate-800">{stats.apiCalls}</h3></div>
              <Server className="text-purple-200" size={32}/>
            </div>
          </div>

          {/* 차트 영역 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            
            {/* 파이 차트 (모듈별) */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4"><Layers size={16} className="text-blue-500"/> Module Distribution</h3>
              <div className="flex-1 min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stats.programData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                      {stats.programData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 막대 차트 (부서별) */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4"><Users size={16} className="text-indigo-500"/> Usage by Department</h3>
              <div className="flex-1 min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.deptData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                    <XAxis dataKey="name" tick={{fontSize: 10}} interval={0} />
                    <YAxis tick={{fontSize: 10}} />
                    <Tooltip cursor={{fill: '#f1f5f9'}} />
                    <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 라인/영역 차트 (날짜별 트렌드) */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4"><Calendar size={16} className="text-emerald-500"/> Recent Activity Trend</h3>
              <div className="flex-1 min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.trendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                    <XAxis dataKey="date" tick={{fontSize: 10}} />
                    <YAxis tick={{fontSize: 10}} />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* 테이블 영역 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-700">Detailed Execution History</h3>
              <div className="relative w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/>
                <input type="text" placeholder="검색 (모듈, 부서, 이름)..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 shadow-sm"/>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[400px] custom-scrollbar">
              <table className="w-full text-left whitespace-nowrap">
                <thead className="bg-white border-b border-slate-200 text-slate-500 text-xs uppercase sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="py-4 px-6 font-bold">ID / Project</th>
                    <th className="py-4 px-6 font-bold">Module</th>
                    <th className="py-4 px-6 font-bold">Requester (Dept)</th>
                    <th className="py-4 px-6 font-bold text-center">Source</th>
                    <th className="py-4 px-6 font-bold text-center">Status</th>
                    <th className="py-4 px-6 font-bold text-right">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
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
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${item.source === 'External API' ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-indigo-50 text-indigo-600 border border-indigo-200'}`}>
                          {item.source}
                        </span>
                      </td>
                      <td className="py-3 px-6 text-center">
                        {item.status === 'Success' 
                          ? <span className="text-xs font-bold text-emerald-600 flex items-center justify-center gap-1"><CheckCircle2 size={14}/> Success</span> 
                          : <span className="text-xs font-bold text-red-500 flex items-center justify-center gap-1"><XCircle size={14}/> Failed</span>
                        }
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
        </>
      )}
    </div>
  );
}