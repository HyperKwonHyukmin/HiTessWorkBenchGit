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
          return { ...a, department: u ? u.department || 'Unknown' : 'Unknown', userName: u ? u.name : 'Deleted User' };
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

    const sortedByDate = [...dateFilteredAnalyses].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const firstDate = new Date(sortedByDate[0].created_at);
    const lastDate = new Date(sortedByDate[sortedByDate.length - 1].created_at);
    const coveredDays = Math.max(1, Math.ceil((lastDate - firstDate) / 86400000) + 1);

    const programMap = new Map();
    const userMap = new Map();
    const deptMap = new Map();
    const dayCountMap = new Map();
    const hourBuckets = Array.from({ length: 24 }, () => 0);
    const weekdayBuckets = Array.from({ length: 7 }, () => 0); // 0=일 ~ 6=토

    dateFilteredAnalyses.forEach(a => {
      const programName = a.program_name || 'Unknown';
      const employeeId = a.employee_id || 'unknown';
      const department = a.department || 'Unknown';
      const createdAt = new Date(a.created_at);
      const dayKey = createdAt.toISOString().slice(0, 10);

      if (!programMap.has(programName)) {
        programMap.set(programName, { name: programName, count: 0, users: new Set(), lastRun: null });
      }
      const program = programMap.get(programName);
      program.count += 1;
      program.users.add(employeeId);
      if (!program.lastRun || createdAt > program.lastRun) program.lastRun = createdAt;

      if (!userMap.has(employeeId)) {
        userMap.set(employeeId, { employee_id: employeeId, name: a.userName || 'Unknown', dept: department, count: 0, programs: new Set(), firstRun: null, lastRun: null });
      }
      const user = userMap.get(employeeId);
      user.count += 1;
      user.programs.add(programName);
      if (!user.firstRun || createdAt < user.firstRun) user.firstRun = createdAt;
      if (!user.lastRun || createdAt > user.lastRun) user.lastRun = createdAt;

      deptMap.set(department, (deptMap.get(department) || 0) + 1);
      dayCountMap.set(dayKey, (dayCountMap.get(dayKey) || 0) + 1);
      hourBuckets[createdAt.getHours()] += 1;
      weekdayBuckets[createdAt.getDay()] += 1;
    });

    const programRows = [...programMap.values()]
      .map(p => ({
        ...p,
        share: Math.round((p.count / total) * 100),
        userCount: p.users.size,
        lastRunLabel: p.lastRun ? p.lastRun.toLocaleString() : '-',
      }))
      .sort((a, b) => b.count - a.count);

    const userRows = [...userMap.values()]
      .map(u => ({
        ...u,
        share: Math.round((u.count / total) * 100),
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

    // 신규 사용자: 첫 실행이 데이터 범위 후반부(최근 30%)에 처음 등장한 사용자
    const cutoff = new Date(firstDate.getTime() + (lastDate - firstDate) * 0.7);
    const newUsers = userRows.filter(u => u.firstRun && u.firstRun >= cutoff).length;

    // 가장 바쁜 시간대(피크)
    const peakHour = hourBuckets.reduce((acc, v, i) => (v > acc.v ? { v, i } : acc), { v: 0, i: 0 });

    // 최대 일일 실행
    const maxDay = [...dayCountMap.values()].reduce((m, v) => Math.max(m, v), 0);

    const hourData = hourBuckets.map((count, hour) => ({ hour: `${String(hour).padStart(2, '0')}시`, count }));
    const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
    const weekdayData = weekdayBuckets.map((count, idx) => ({ name: WEEKDAY_LABELS[idx], count }));

    return {
      total,
      activePrograms: programMap.size,
      activeUsers: userMap.size,
      activeDepartments: deptMap.size,
      newUsers,
      avgPerDay: (total / coveredDays).toFixed(1),
      maxDay,
      coveredDays,
      busiestProgram,
      peakHour: peakHour.v ? `${String(peakHour.i).padStart(2, '0')}시` : '-',
      programRows,
      userRows,
      topPrograms: programRows.slice(0, 8),
      topUsers: userRows.slice(0, 8),
      trendData,
      hourData,
      weekdayData,
      deptData: [...deptMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    };
  }, [dateFilteredAnalyses]);

  const downloadCSV = () => {
    const rows = dateFilteredAnalyses.map(a => `${a.id},${a.project_name || ''},${a.program_name},${a.userName}(${a.employee_id}),${a.department},${a.status},${new Date(a.created_at).toLocaleString()}`).join('\n');
    const blob = new Blob(['\uFEFF' + 'ID,Project,Module,Requester,Department,Status,Date\n' + rows], { type: 'text/csv;charset=utf-8;' });
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
