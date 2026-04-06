/// <summary>
/// 관리자 전용 해석 관리 및 통계 대시보드.
/// </summary>
import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { getAllAnalysisHistory } from '../../api/analysis';
import { getUsers } from '../../api/admin';
import AnalysisFilterBar from '../../components/admin/AnalysisFilterBar';
import AnalysisStatsDashboard from '../../components/admin/AnalysisStatsDashboard';
import AnalysisHistoryTable from '../../components/admin/AnalysisHistoryTable';

export default function AnalysisManagement() {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [analysisRes, userRes] = await Promise.all([getAllAnalysisHistory(), getUsers()]);
        const usersData = userRes.data;
        setAnalyses((analysisRes.data.items || analysisRes.data).map(a => {
          const u = usersData.find(user => user.employee_id === a.employee_id);
          return { ...a, department: u ? u.department || 'Unknown' : 'Unknown', userName: u ? u.name : 'Deleted User', source: a.source || 'Workbench' };
        }));
      } catch (err) {
        setError(err?.response?.data?.detail || err?.message || '데이터를 불러오지 못했습니다.');
      } finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const dateFilteredAnalyses = useMemo(() => {
    if (!dateFrom && !dateTo) return analyses;
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo + 'T23:59:59') : null;
    return analyses.filter(a => {
      const d = new Date(a.created_at);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [analyses, dateFrom, dateTo]);

  const stats = useMemo(() => {
    if (!dateFilteredAnalyses.length) return null;
    const total = dateFilteredAnalyses.length;
    const success = dateFilteredAnalyses.filter(a => a.status === 'Success').length;
    const apiCalls = dateFilteredAnalyses.filter(a => a.source === 'External API').length;
    const programMap = {};
    dateFilteredAnalyses.forEach(a => programMap[a.program_name] = (programMap[a.program_name] || 0) + 1);
    const deptMap = {};
    dateFilteredAnalyses.forEach(a => deptMap[a.department] = (deptMap[a.department] || 0) + 1);
    const dateMap = {};
    dateFilteredAnalyses.forEach(a => { const d = new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); dateMap[d] = (dateMap[d] || 0) + 1; });
    const moduleUsageData = Object.keys(programMap).map(k => ({ name: k, count: programMap[k], success: dateFilteredAnalyses.filter(a => a.program_name === k && a.status === 'Success').length })).sort((a, b) => b.count - a.count);
    const userMap = {};
    dateFilteredAnalyses.forEach(a => { if (!userMap[a.employee_id]) userMap[a.employee_id] = { name: a.userName, dept: a.department, count: 0 }; userMap[a.employee_id].count++; });
    const deptData = Object.keys(deptMap).map(k => ({ name: k, count: deptMap[k] }));
    const topDepts = [...deptData].sort((a, b) => b.count - a.count).slice(0, 5).map(d => ({ ...d, success: dateFilteredAnalyses.filter(a => a.department === d.name && a.status === 'Success').length }));
    const crossModules = Object.keys(programMap);
    const crossDepts = Object.keys(deptMap);
    const crossMatrix = crossDepts.map(dept => crossModules.map(mod => dateFilteredAnalyses.filter(a => a.department === dept && a.program_name === mod).length));
    const failuresByModuleData = Object.entries(
      dateFilteredAnalyses.filter(a => a.status !== 'Success').reduce((acc, a) => { acc[a.program_name || 'Unknown'] = (acc[a.program_name || 'Unknown'] || 0) + 1; return acc; }, {})
    ).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5);
    return {
      total, successRate: ((success / total) * 100).toFixed(1), apiCalls,
      programData: Object.keys(programMap).map(k => ({ name: k, value: programMap[k] })),
      deptData,
      trendData: Object.keys(dateMap).slice(0, 7).reverse().map(k => ({ date: k, count: dateMap[k] })),
      moduleUsageData,
      topUsers: Object.values(userMap).sort((a, b) => b.count - a.count).slice(0, 5),
      topDepts,
      failedCount: total - success,
      failuresByModuleData,
      recentFailures: dateFilteredAnalyses.filter(a => a.status !== 'Success').slice(0, 3),
      crossTable: { depts: crossDepts, modules: crossModules, matrix: crossMatrix, maxVal: Math.max(1, ...crossMatrix.flat()) }
    };
  }, [dateFilteredAnalyses]);

  const downloadCSV = () => {
    const rows = dateFilteredAnalyses.map(a => `${a.id},${a.project_name || ''},${a.program_name},${a.userName}(${a.employee_id}),${a.department},${a.source},${a.status},${new Date(a.created_at).toLocaleString()}`).join('\n');
    const blob = new Blob(['\uFEFF' + 'ID,Project,Module,Requester,Department,Source,Status,Date\n' + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Analysis_Report_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const filteredAnalyses = dateFilteredAnalyses.filter(a =>
    (a.program_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.userName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <AnalysisFilterBar dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} onDownloadCSV={downloadCSV} />

      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-blue-500" size={40}/></div>
      ) : error ? (
        <div className="text-center py-20 text-red-400">{error}</div>
      ) : !stats ? (
        <div className="text-center py-20 text-slate-400">{(dateFrom || dateTo) ? '선택한 기간에 해당하는 데이터가 없습니다.' : '데이터가 없습니다.'}</div>
      ) : (
        <>
          <AnalysisStatsDashboard stats={stats} />
          <AnalysisHistoryTable filteredAnalyses={filteredAnalyses} searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        </>
      )}
    </div>
  );
}
