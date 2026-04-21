/// <summary>
/// 관리자 전용 시스템 환경설정 및 라이브 모니터링 대시보드.
/// CPU, Memory, Disk, DB, 작업 큐를 3초 주기로 폴링합니다.
/// 서버 버전, 총 사용자/해석 건수 요약 카드를 제공합니다.
/// </summary>
import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Server, HardDrive, Cpu, Activity,
  Users, BarChart3, Tag, Database, Layers, Power, AlertTriangle,
  ClipboardList, Download, RefreshCw, Filter
} from 'lucide-react';
import { getSystemStatus, getQueueStatus, getUsers, getMaintenanceMode, setMaintenanceMode } from '../../api/admin';
import PageHeader from '../../components/ui/PageHeader';
import { getAllAnalysisHistory } from '../../api/analysis';
import { getActivityLogs, getActivityLogsExportUrl } from '../../api/activity';
import { getAuthHeaders } from '../../utils/auth';
import { API_BASE_URL } from '../../config';
import axios from 'axios';

export default function SystemSettings() {

  // 실시간 폴링 상태
  const [sysStats, setSysStats] = useState({
    cpu_usage: 0,
    memory_used_gb: 0,
    memory_total_gb: 0,
    disk_used_gb: 0,
    disk_total_gb: 0,
    db_status: 'Checking...',
    latency_ms: 0
  });
  const [queue, setQueue] = useState({ running: 0, pending: 0, limit: 5 });

  // 유지보수 모드
  const [maintenanceMode, setMaintenanceModeState] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);

  // Activity Log
  const [logFilters, setLogFilters] = useState({ employee_id: '', action_type: '', date_from: '', date_to: '' });
  const [logData, setLogData] = useState({ total: 0, items: [] });
  const [logLoading, setLogLoading] = useState(false);
  const [logPage, setLogPage] = useState(0);
  const LOG_PAGE_SIZE = 50;

  // 1회성 요약 데이터
  const [version, setVersion] = useState('—');
  const [totalUsers, setTotalUsers] = useState('—');
  const [activeUsers, setActiveUsers] = useState('—');
  const [totalAnalyses, setTotalAnalyses] = useState('—');

  // 3초 폴링: 리소스 + 큐
  useEffect(() => {
    const poll = async () => {
      try {
        const [statusRes, queueRes] = await Promise.all([
          getSystemStatus(),
          getQueueStatus()
        ]);
        setSysStats(statusRes.data);
        setQueue(queueRes.data);
      } catch {
        setSysStats(prev => ({ ...prev, db_status: 'Disconnected', latency_ms: 0 }));
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // 1회성: 버전, 사용자 수, 해석 수, 유지보수 모드 초기값
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const [verRes, userRes, analysisRes, maintRes] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/version`),
          getUsers(),
          getAllAnalysisHistory(200),
          getMaintenanceMode()
        ]);
        setVersion(verRes.data.version || '—');
        const usersData = userRes.data || [];
        setTotalUsers(usersData.length);
        setActiveUsers(usersData.filter(u => u.is_active).length);
        const total = analysisRes.data?.total ?? (analysisRes.data?.items?.length ?? '—');
        setTotalAnalyses(total);
        setMaintenanceModeState(maintRes.data.maintenance);
      } catch {
        // 요약 데이터 실패 시 기본값 유지
      }
    };
    fetchSummary();
  }, []);

  const fetchLogs = useCallback(async (page = 0) => {
    setLogLoading(true);
    try {
      const params = { skip: page * LOG_PAGE_SIZE, limit: LOG_PAGE_SIZE };
      if (logFilters.employee_id) params.employee_id = logFilters.employee_id;
      if (logFilters.action_type) params.action_type = logFilters.action_type;
      if (logFilters.date_from) params.date_from = logFilters.date_from;
      if (logFilters.date_to) params.date_to = logFilters.date_to;
      const res = await getActivityLogs(params);
      setLogData(res.data);
      setLogPage(page);
    } catch {
      // 오류 시 빈 목록 유지
    } finally {
      setLogLoading(false);
    }
  }, [logFilters]);

  useEffect(() => { fetchLogs(0); }, []);

  const handleExportCsv = () => {
    const params = {};
    if (logFilters.employee_id) params.employee_id = logFilters.employee_id;
    if (logFilters.action_type) params.action_type = logFilters.action_type;
    if (logFilters.date_from) params.date_from = logFilters.date_from;
    if (logFilters.date_to) params.date_to = logFilters.date_to;
    const url = getActivityLogsExportUrl(params);
    const token = localStorage.getItem('session_token') || '';
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `activity_logs_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
      });
  };

  const ACTION_TYPE_LABELS = {
    LOGIN: '로그인',
    LOGOUT: '로그아웃',
    FILE_DOWNLOAD: '파일 다운로드',
    PROGRAM_DOWNLOAD: '프로그램 다운로드',
    VERSION_UPDATE: '버전 업데이트',
  };

  const ACTION_TYPE_COLORS = {
    LOGIN: 'bg-emerald-100 text-emerald-700',
    LOGOUT: 'bg-slate-100 text-slate-600',
    FILE_DOWNLOAD: 'bg-blue-100 text-blue-700',
    PROGRAM_DOWNLOAD: 'bg-indigo-100 text-indigo-700',
    VERSION_UPDATE: 'bg-amber-100 text-amber-700',
  };

  const handleToggleMaintenance = async () => {
    setMaintenanceLoading(true);
    try {
      const res = await setMaintenanceMode(!maintenanceMode);
      setMaintenanceModeState(res.data.maintenance);
    } catch {
      // 실패 시 상태 유지
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const memPct  = sysStats.memory_total_gb > 0 ? (sysStats.memory_used_gb / sysStats.memory_total_gb) * 100 : 0;
  const diskPct = sysStats.disk_total_gb   > 0 ? (sysStats.disk_used_gb   / sysStats.disk_total_gb)   * 100 : 0;
  const queuePct = (queue.running / queue.limit) * 100;

  const ResourceBar = ({ pct, warn = 80 }) => (
    <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
      <div
        className={`h-full transition-all duration-500 rounded-full ${pct > warn ? 'bg-red-500' : 'bg-blue-500'}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">

      <PageHeader
        title="System Management"
        icon={Settings}
        subtitle="시스템 리소스, 작업 큐, 서비스 현황을 실시간으로 모니터링합니다."
        accentColor="teal"
        actions={
          <div className="flex items-center gap-2 px-3 py-1 bg-white/10 border border-white/20 text-emerald-300 rounded-full text-xs font-bold">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live Monitoring Active
          </div>
        }
      />

      {/* D. 요약 KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 border-l-blue-500">
          <div>
            <p className="text-xs font-bold text-slate-400 mb-1">Total Users</p>
            <h3 className="text-2xl font-black text-slate-800">{totalUsers}</h3>
          </div>
          <Users className="text-blue-200" size={32} />
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 border-l-emerald-500">
          <div>
            <p className="text-xs font-bold text-slate-400 mb-1">Active Users</p>
            <h3 className="text-2xl font-black text-slate-800">{activeUsers}</h3>
          </div>
          <Users className="text-emerald-200" size={32} />
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 border-l-indigo-500">
          <div>
            <p className="text-xs font-bold text-slate-400 mb-1">Total Analyses</p>
            <h3 className="text-2xl font-black text-slate-800">{totalAnalyses}</h3>
          </div>
          <BarChart3 className="text-indigo-200" size={32} />
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 border-l-violet-500">
          <div>
            <p className="text-xs font-bold text-slate-400 mb-1">Server Version</p>
            <h3 className="text-2xl font-black text-slate-800">{version}</h3>
          </div>
          <Tag className="text-violet-200" size={32} />
        </div>
      </div>

      {/* B. 실시간 리소스 모니터링 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-6 flex items-center gap-2">
          <Activity size={18} className="text-blue-500" /> Server Resource Monitoring (Real-Time)
        </h3>

        {/* Row 1: CPU / Memory / Disk */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

          {/* CPU */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2 text-slate-500 mb-2 text-sm"><Cpu size={16} /> CPU Usage</div>
            <div className="text-2xl font-extrabold text-slate-800">
              {sysStats.cpu_usage}<span className="text-sm font-medium text-slate-500">%</span>
            </div>
            <ResourceBar pct={sysStats.cpu_usage} />
          </div>

          {/* Memory */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2 text-slate-500 mb-2 text-sm"><HardDrive size={16} /> Memory</div>
            <div className="text-2xl font-extrabold text-slate-800">
              {sysStats.memory_used_gb}<span className="text-sm font-medium text-slate-500"> / {sysStats.memory_total_gb} GB</span>
            </div>
            <ResourceBar pct={memPct} />
          </div>

          {/* Disk */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2 text-slate-500 mb-2 text-sm"><Database size={16} /> Disk Usage</div>
            <div className="text-2xl font-extrabold text-slate-800">
              {sysStats.disk_used_gb}<span className="text-sm font-medium text-slate-500"> / {sysStats.disk_total_gb} GB</span>
            </div>
            <ResourceBar pct={diskPct} warn={85} />
          </div>
        </div>

        {/* Row 2: DB / Queue */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* DB Status */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2 text-slate-500 mb-2 text-sm"><Server size={16} /> DB Status</div>
            <div className={`text-xl font-bold flex items-center gap-2 mt-1 ${sysStats.db_status === 'Connected' ? 'text-emerald-600' : 'text-red-600'}`}>
              {sysStats.db_status === 'Connected' ? (
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
              ) : (
                <span className="h-3 w-3 rounded-full bg-red-500 inline-block"></span>
              )}
              {sysStats.db_status}
            </div>
            <p className="text-xs text-slate-400 mt-2 font-mono">
              Latency: <span className={sysStats.latency_ms > 100 ? 'text-red-400 font-bold' : 'text-slate-600'}>{sysStats.latency_ms}ms</span>
            </p>
          </div>

          {/* Job Queue */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2 text-slate-500 mb-2 text-sm"><Layers size={16} /> Job Queue</div>
            <div className="flex items-end gap-4 mt-1">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Running</p>
                <p className="text-2xl font-extrabold text-blue-600">{queue.running}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Pending</p>
                <p className="text-2xl font-extrabold text-amber-500">{queue.pending}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Limit</p>
                <p className="text-2xl font-extrabold text-slate-400">{queue.limit}</p>
              </div>
            </div>
            <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${queuePct >= 100 ? 'bg-red-500' : queuePct >= 60 ? 'bg-amber-400' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(queuePct, 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1 font-mono">{queue.running} / {queue.limit} slots in use</p>
          </div>
        </div>
      </div>

      {/* Danger Zone: 유지보수 모드 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-6 flex items-center gap-2">
          <AlertTriangle size={18} className="text-orange-500" /> Danger Zone
        </h3>
        <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${maintenanceMode ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
          <div>
            <h4 className={`font-bold ${maintenanceMode ? 'text-red-700' : 'text-slate-700'}`}>
              시스템 점검 모드 (Maintenance Mode)
              {maintenanceMode && (
                <span className="ml-2 text-[10px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full uppercase">Active</span>
              )}
            </h4>
            <p className={`text-xs mt-1 ${maintenanceMode ? 'text-red-600' : 'text-slate-500'}`}>
              {maintenanceMode
                ? '현재 점검 모드가 활성화되어 있습니다. 관리자를 제외한 모든 사용자의 로그인이 차단됩니다.'
                : '활성화 시 관리자를 제외한 일반 사용자의 로그인이 즉시 차단됩니다.'}
            </p>
          </div>
          <button
            onClick={handleToggleMaintenance}
            disabled={maintenanceLoading}
            className={`ml-6 shrink-0 px-4 py-2 font-bold text-sm rounded-lg flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
              maintenanceMode
                ? 'bg-red-600 text-white hover:bg-red-700 shadow-md'
                : 'bg-white text-red-600 border border-red-200 hover:bg-red-50'
            }`}
          >
            <Power size={16} />
            {maintenanceLoading ? '처리 중...' : maintenanceMode ? '점검 모드 해제' : '점검 모드 켜기'}
          </button>
        </div>
      </div>

      {/* Activity Log */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mt-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <ClipboardList size={18} className="text-teal-500" /> Activity Log
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => fetchLogs(0)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <RefreshCw size={13} /> 새로고침
            </button>
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors cursor-pointer"
            >
              <Download size={13} /> CSV 내보내기
            </button>
          </div>
        </div>

        {/* 필터 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">사번</label>
            <input
              type="text"
              placeholder="예: EMP001"
              value={logFilters.employee_id}
              onChange={e => setLogFilters(f => ({ ...f, employee_id: e.target.value }))}
              className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">이벤트 유형</label>
            <select
              value={logFilters.action_type}
              onChange={e => setLogFilters(f => ({ ...f, action_type: e.target.value }))}
              className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400 bg-white"
            >
              <option value="">전체</option>
              {Object.entries(ACTION_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">시작일</label>
            <input
              type="date"
              value={logFilters.date_from}
              onChange={e => setLogFilters(f => ({ ...f, date_from: e.target.value }))}
              className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">종료일</label>
            <input
              type="date"
              value={logFilters.date_to}
              onChange={e => setLogFilters(f => ({ ...f, date_to: e.target.value }))}
              className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div className="col-span-2 md:col-span-4 flex justify-end">
            <button
              onClick={() => fetchLogs(0)}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors cursor-pointer"
            >
              <Filter size={13} /> 조회
            </button>
          </div>
        </div>

        {/* 테이블 */}
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-xs text-slate-700">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase">
                <th className="px-3 py-2.5 text-left">시간</th>
                <th className="px-3 py-2.5 text-left">사번</th>
                <th className="px-3 py-2.5 text-left">이벤트</th>
                <th className="px-3 py-2.5 text-left">상태</th>
                <th className="px-3 py-2.5 text-left">세부정보</th>
                <th className="px-3 py-2.5 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {logLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">
                    <RefreshCw size={16} className="inline animate-spin mr-2" />불러오는 중...
                  </td>
                </tr>
              ) : logData.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">
                    로그 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                logData.items.map(row => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                      {row.created_at ? new Date(row.created_at).toLocaleString('ko-KR') : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-slate-700">{row.employee_id || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ACTION_TYPE_COLORS[row.action_type] || 'bg-slate-100 text-slate-600'}`}>
                        {ACTION_TYPE_LABELS[row.action_type] || row.action_type}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.status === 'success' ? 'text-emerald-600' : row.status === 'failure' ? 'text-red-500' : 'text-slate-400'}`}>
                        {row.status || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate" title={JSON.stringify(row.action_detail)}>
                      {row.action_detail ? Object.entries(row.action_detail).map(([k, v]) => `${k}: ${v}`).join(' | ') : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-400">{row.ip_address || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {logData.total > LOG_PAGE_SIZE && (
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-slate-400">총 {logData.total}건</p>
            <div className="flex gap-2">
              <button
                disabled={logPage === 0}
                onClick={() => fetchLogs(logPage - 1)}
                className="px-3 py-1 text-xs font-bold rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
              >이전</button>
              <span className="px-3 py-1 text-xs text-slate-500">{logPage + 1} / {Math.ceil(logData.total / LOG_PAGE_SIZE)}</span>
              <button
                disabled={(logPage + 1) * LOG_PAGE_SIZE >= logData.total}
                onClick={() => fetchLogs(logPage + 1)}
                className="px-3 py-1 text-xs font-bold rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
              >다음</button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
