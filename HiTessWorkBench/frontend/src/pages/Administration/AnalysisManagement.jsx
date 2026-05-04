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
    const failed = total - success;
    const apiCalls = dateFilteredAnalyses.filter(a => a.source === 'External API').length;

    const sortedByDate = [...dateFilteredAnalyses].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const firstDate = new Date(sortedByDate[0].created_at);
    const lastDate = new Date(sortedByDate[sortedByDate.length - 1].created_at);
    const coveredDays = Math.max(1, Math.ceil((lastDate - firstDate) / 86400000) + 1);

    const programMap = new Map();
    const userMap = new Map();
    const deptMap = new Map();
    const sourceMap = new Map();

    dateFilteredAnalyses.forEach(a => {
      const programName = a.program_name || 'Unknown';
      const employeeId = a.employee_id || 'unknown';
      const department = a.department || 'Unknown';
      const source = a.source || 'Workbench';
      const createdAt = new Date(a.created_at);
      const ok = a.status === 'Success';

      if (!programMap.has(programName)) {
        programMap.set(programName, { name: programName, count: 0, success: 0, failed: 0, api: 0, users: new Set(), lastRun: null });
      }
      const program = programMap.get(programName);
      program.count += 1;
      program.success += ok ? 1 : 0;
      program.failed += ok ? 0 : 1;
      program.api += source === 'External API' ? 1 : 0;
      program.users.add(employeeId);
      if (!program.lastRun || createdAt > program.lastRun) program.lastRun = createdAt;

      if (!userMap.has(employeeId)) {
        userMap.set(employeeId, { employee_id: employeeId, name: a.userName || 'Unknown', dept: department, count: 0, success: 0, failed: 0, api: 0, programs: new Set(), lastRun: null });
      }
      const user = userMap.get(employeeId);
      user.count += 1;
      user.success += ok ? 1 : 0;
      user.failed += ok ? 0 : 1;
      user.api += source === 'External API' ? 1 : 0;
      user.programs.add(programName);
      if (!user.lastRun || createdAt > user.lastRun) user.lastRun = createdAt;

      deptMap.set(department, (deptMap.get(department) || 0) + 1);
      sourceMap.set(source, (sourceMap.get(source) || 0) + 1);
    });

    const programRows = [...programMap.values()]
      .map(p => ({
        ...p,
        share: Math.round((p.count / total) * 100),
        successRate: Math.round((p.success / p.count) * 100),
        apiRate: Math.round((p.api / p.count) * 100),
        userCount: p.users.size,
        lastRunLabel: p.lastRun ? p.lastRun.toLocaleString() : '-',
      }))
      .sort((a, b) => b.count - a.count);

    const userRows = [...userMap.values()]
      .map(u => ({
        ...u,
        share: Math.round((u.count / total) * 100),
        successRate: Math.round((u.success / u.count) * 100),
        apiRate: Math.round((u.api / u.count) * 100),
        programCount: u.programs.size,
        lastRunLabel: u.lastRun ? u.lastRun.toLocaleString() : '-',
      }))
      .sort((a, b) => b.count - a.count);

    const trendMap = new Map();
    sortedByDate.forEach(a => {
      const dayKey = new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      trendMap.set(dayKey, (trendMap.get(dayKey) || 0) + 1);
    });
    const trendData = [...trendMap.entries()].map(([date, count]) => ({ date, count })).slice(-14);
    const busiestProgram = programRows[0] || null;
    const riskyPrograms = programRows.filter(p => p.failed > 0).sort((a, b) => b.failed - a.failed).slice(0, 5);

    return {
      total,
      success,
      failed,
      successRate: Math.round((success / total) * 100),
      apiCalls,
      apiRate: Math.round((apiCalls / total) * 100),
      workbenchCalls: total - apiCalls,
      activePrograms: programMap.size,
      activeUsers: userMap.size,
      activeDepartments: deptMap.size,
      avgPerDay: (total / coveredDays).toFixed(1),
      coveredDays,
      busiestProgram,
      programRows,
      userRows,
      topPrograms: programRows.slice(0, 8),
      topUsers: userRows.slice(0, 8),
      riskyPrograms,
      trendData,
      sourceData: [...sourceMap.entries()].map(([name, value]) => ({ name, value })),
      deptData: [...deptMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      recentFailures: dateFilteredAnalyses.filter(a => a.status !== 'Success').slice(0, 5),
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
    (a.project_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.department || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.employee_id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.userName || '').toLowerCase().includes(searchTerm.toLowerCase())
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
