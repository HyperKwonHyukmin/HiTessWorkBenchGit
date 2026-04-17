/// <summary>
/// 관리자 전용 시스템 환경설정 및 라이브 모니터링 대시보드.
/// CPU, Memory, Disk, DB, 작업 큐를 3초 주기로 폴링합니다.
/// 서버 버전, 총 사용자/해석 건수 요약 카드를 제공합니다.
/// </summary>
import React, { useState, useEffect } from 'react';
import {
  Settings, Server, HardDrive, Cpu, Activity,
  Users, BarChart3, Tag, Database, Layers, Power, AlertTriangle
} from 'lucide-react';
import { getSystemStatus, getQueueStatus, getUsers, getMaintenanceMode, setMaintenanceMode } from '../../api/admin';
import PageHeader from '../../components/ui/PageHeader';
import { getAllAnalysisHistory } from '../../api/analysis';
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
        title="System Settings"
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

    </div>
  );
}
