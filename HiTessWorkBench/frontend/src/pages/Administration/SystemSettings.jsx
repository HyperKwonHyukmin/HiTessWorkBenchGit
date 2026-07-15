/// <summary>
/// 관리자 전용 시스템 환경설정 및 라이브 모니터링 대시보드.
/// CPU, Memory, Disk, DB, 작업 큐를 3초 주기로 폴링합니다.
/// 서버 버전, 총 사용자/해석 건수 요약 카드를 제공합니다.
/// </summary>
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings, Server, HardDrive, Cpu, Activity,
  Users, BarChart3, Tag, Database, Layers, Power, AlertTriangle,
  ClipboardList, Download, RefreshCw, Filter,
  Trash2, Clock, User, FolderMinus, PlayCircle, Inbox
} from 'lucide-react';
import { ACTION_TYPE_LABELS, ACTION_TYPE_COLORS } from '../../constants/activityLog';
import { POLLING_POLICY } from '../../hooks/pollingPolicy';

// ── sparkline buffer 길이 (3초 polling × 30 = 약 90초 윈도우) ──
const SPARK_LEN = 30;

// ── 도넛 게이지 (SVG) ──
const DonutGauge = ({ pct, size = 88, stroke = 9, color = 'blue' }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const safe = Math.max(0, Math.min(100, pct || 0));
  const dash = (safe / 100) * c;
  const palette = {
    blue:    { track: '#e2e8f0', fill: 'url(#g-blue)' },
    emerald: { track: '#e2e8f0', fill: 'url(#g-emerald)' },
    amber:   { track: '#e2e8f0', fill: 'url(#g-amber)' },
    red:     { track: '#fee2e2', fill: 'url(#g-red)' },
  };
  const p = palette[color] || palette.blue;
  return (
    <svg width={size} height={size} className="shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id="g-blue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="g-emerald" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="g-amber" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id="g-red" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f87171" />
          <stop offset="100%" stopColor="#dc2626" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.track} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={p.fill}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  );
};

// ── 미니 sparkline (SVG path, 영역 채움) ──
const Sparkline = ({ values, height = 36, width = 120, color = '#3b82f6', max = 100 }) => {
  if (!values || values.length < 2) {
    return (
      <div className="flex items-center justify-center text-[10px] font-bold text-slate-300" style={{ width, height }}>
        수집 중…
      </div>
    );
  }
  const ceiling = Math.max(max, ...values, 1);
  const stepX = width / (SPARK_LEN - 1);
  // 좌측을 빈 공간으로 두고 우측부터 채우기
  const offset = SPARK_LEN - values.length;
  const points = values.map((v, i) => {
    const x = (i + offset) * stepX;
    const y = height - (v / ceiling) * (height - 2) - 1;
    return [x, y];
  });
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} className="block" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${color.replace('#', '')})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill={color} />
    </svg>
  );
};
import {
  getSystemStatus, getUsers, getMaintenanceMode, setMaintenanceMode,
  getActiveJobs, getStoragePreview, runStorageCleanup,
} from '../../api/admin';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import { getAllAnalysisHistory } from '../../api/analysis';
import { getActivityLogs, getActivityLogsExportUrl } from '../../api/activity';
import { API_BASE_URL } from '../../config';
import axios from 'axios';

// 초 → "2시간 5분" / "3분 12초" 형태 표기.
const formatElapsed = (seconds) => {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${sec}초`;
  return `${sec}초`;
};

export default function SystemSettings() {

  const { showToast } = useToast();

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
  // 실행 중/대기 중 작업 상세 목록 (B5)
  const [activeJobs, setActiveJobs] = useState([]);

  // ── sparkline 시계열 (ring buffer) ──
  const [cpuHistory, setCpuHistory] = useState([]);
  const [memHistory, setMemHistory] = useState([]);
  const [queueHistory, setQueueHistory] = useState([]);

  // 유지보수 모드
  const [maintenanceMode, setMaintenanceModeState] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  // 스토리지 정리 (A1)
  const [storage, setStorage] = useState(null);          // preview 결과
  const [storageLoading, setStorageLoading] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);

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
      if (document.hidden) return;

      // 리소스/DB 상태 — 이 호출만 db_status 를 결정한다.
      try {
        const statusRes = await getSystemStatus();
        setSysStats(statusRes.data);
        const cpu = Number(statusRes.data?.cpu_usage) || 0;
        const memPctNow = statusRes.data?.memory_total_gb > 0
          ? (statusRes.data.memory_used_gb / statusRes.data.memory_total_gb) * 100
          : 0;
        setCpuHistory(h => [...h, cpu].slice(-SPARK_LEN));
        setMemHistory(h => [...h, memPctNow].slice(-SPARK_LEN));
      } catch {
        setSysStats(prev => ({ ...prev, db_status: 'Disconnected', latency_ms: 0 }));
      }

      // 작업 모니터 — 별도 호출로 분리해, 이 엔드포인트 실패(예: 구버전 백엔드 404)가
      // DB 상태 표시에 영향 주지 않게 한다.
      try {
        const jobsRes = await getActiveJobs();
        setQueue({
          running: jobsRes.data?.running ?? 0,
          pending: jobsRes.data?.pending ?? 0,
          limit: jobsRes.data?.limit ?? 5,
        });
        setActiveJobs(jobsRes.data?.jobs || []);
        const running = Number(jobsRes.data?.running) || 0;
        setQueueHistory(h => [...h, running].slice(-SPARK_LEN));
      } catch {
        // 작업 목록 조회 실패는 조용히 무시(다음 폴링에서 복구). DB 상태와 무관.
      }
    };
    poll();
    const id = setInterval(poll, POLLING_POLICY.systemIntervalMs);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `activity_logs_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  // 활동 로그 라벨/색상은 constants/activityLog.js 공용 상수 사용 (중복 제거).

  const performMaintenanceToggle = async () => {
    setConfirmMaintenance(false);
    setMaintenanceLoading(true);
    try {
      const res = await setMaintenanceMode(!maintenanceMode);
      setMaintenanceModeState(res.data.maintenance);
      showToast(
        res.data.maintenance ? '점검 모드가 활성화되었습니다.' : '점검 모드가 해제되었습니다.',
        res.data.maintenance ? 'info' : 'success',
      );
    } catch {
      showToast('점검 모드 변경에 실패했습니다.', 'error');
    } finally {
      setMaintenanceLoading(false);
    }
  };

  // 켜기(사용자 로그인 차단)는 파괴적이므로 확인을 받고, 해제는 즉시 수행한다.
  const handleToggleMaintenance = () => {
    if (maintenanceMode) performMaintenanceToggle();
    else setConfirmMaintenance(true);
  };

  // ── 스토리지 정리 (A1) ──
  const fetchStoragePreview = useCallback(async () => {
    setStorageLoading(true);
    try {
      const res = await getStoragePreview();
      setStorage(res.data);
    } catch {
      showToast('스토리지 미리보기에 실패했습니다.', 'error');
    } finally {
      setStorageLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchStoragePreview(); }, [fetchStoragePreview]);

  const performCleanup = async () => {
    setConfirmCleanup(false);
    setCleanupRunning(true);
    try {
      const res = await runStorageCleanup();
      const deleted = res.data?.deleted_count ?? 0;
      const errors = res.data?.error_count ?? 0;
      showToast(
        errors > 0
          ? `${deleted}개 폴더를 정리했습니다. (실패 ${errors}개)`
          : `${deleted}개 폴더를 정리했습니다.`,
        errors > 0 ? 'error' : 'success',
      );
      await fetchStoragePreview();
    } catch {
      showToast('스토리지 정리에 실패했습니다.', 'error');
    } finally {
      setCleanupRunning(false);
    }
  };

  const memPct  = sysStats.memory_total_gb > 0 ? (sysStats.memory_used_gb / sysStats.memory_total_gb) * 100 : 0;
  const diskPct = sysStats.disk_total_gb   > 0 ? (sysStats.disk_used_gb   / sysStats.disk_total_gb)   * 100 : 0;
  const queuePct = (queue.running / queue.limit) * 100;
  const operationalHealth = useMemo(() => {
    const flags = [];
    let score = 100;

    if (sysStats.db_status !== 'Connected') {
      score -= 35;
      flags.push({ level: 'critical', label: 'DB disconnected', detail: 'DB 연결 상태를 즉시 확인하세요.' });
    }
    if (Number(sysStats.cpu_usage) >= 85) {
      score -= 15;
      flags.push({ level: 'warning', label: 'High CPU', detail: `CPU ${Math.round(sysStats.cpu_usage)}%` });
    }
    if (memPct >= 85) {
      score -= 15;
      flags.push({ level: 'warning', label: 'High Memory', detail: `Memory ${Math.round(memPct)}%` });
    }
    if (diskPct >= 90) {
      score -= 20;
      flags.push({ level: 'critical', label: 'Disk pressure', detail: `Disk ${Math.round(diskPct)}%` });
    }
    if (queue.pending > 0 || queue.running >= queue.limit) {
      score -= queue.running >= queue.limit ? 12 : 6;
      flags.push({ level: 'warning', label: 'Queue pressure', detail: `${queue.running}/${queue.limit} running · ${queue.pending} pending` });
    }

    const failureCount = (logData.items || []).filter(row => row.status === 'failure').length;
    if (failureCount >= 5) {
      score -= 10;
      flags.push({ level: 'warning', label: 'Recent failures', detail: `현재 로그 페이지 실패 ${failureCount}건` });
    }
    if (maintenanceMode) {
      score -= 10;
      flags.push({ level: 'warning', label: 'Maintenance active', detail: '일반 사용자 로그인 차단 중' });
    }

    const safeScore = Math.max(0, Math.min(100, Math.round(score)));
    const level = safeScore >= 85 ? 'healthy' : safeScore >= 65 ? 'watch' : 'risk';
    return { score: safeScore, level, flags };
  }, [diskPct, logData.items, maintenanceMode, memPct, queue, sysStats.cpu_usage, sysStats.db_status]);

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

      {/* 운영 상태 요약 */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 mb-6">
        <div className={`rounded-2xl border p-5 shadow-sm ${
          operationalHealth.level === 'healthy'
            ? 'bg-emerald-50 border-emerald-200'
            : operationalHealth.level === 'watch'
            ? 'bg-amber-50 border-amber-200'
            : 'bg-red-50 border-red-200'
        }`}>
          <p className={`text-[10px] font-black uppercase tracking-wider ${
            operationalHealth.level === 'healthy' ? 'text-emerald-600' : operationalHealth.level === 'watch' ? 'text-amber-700' : 'text-red-700'
          }`}>
            Operational Health
          </p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-4xl font-black tabular-nums text-slate-800">{operationalHealth.score}</span>
            <span className="mb-1 text-sm font-bold text-slate-500">/ 100</span>
          </div>
          <p className="mt-2 text-xs font-medium text-slate-600">
            {operationalHealth.level === 'healthy'
              ? '주요 운영 지표가 안정적입니다.'
              : operationalHealth.level === 'watch'
              ? '주의가 필요한 지표가 있습니다.'
              : '운영 리스크가 높습니다. 즉시 확인이 필요합니다.'}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">운영 액션 플래그</h3>
            <span className="text-[10px] font-bold text-slate-400">CPU · MEM · DISK · DB · QUEUE · LOG</span>
          </div>
          {operationalHealth.flags.length === 0 ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
              현재 조치가 필요한 운영 플래그가 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {operationalHealth.flags.map(flag => (
                <div key={`${flag.label}-${flag.detail}`} className={`rounded-xl border px-3 py-2 ${
                  flag.level === 'critical' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
                }`}>
                  <p className={`text-xs font-black ${flag.level === 'critical' ? 'text-red-700' : 'text-amber-700'}`}>
                    {flag.label}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-600">{flag.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* B. 실시간 리소스 모니터링 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <Activity size={18} className="text-blue-500" /> Server Resource Monitoring
          </h3>
          <span className="text-[10px] font-bold text-slate-400 inline-flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
            </span>
            3초마다 자동 갱신 · 최근 {SPARK_LEN * 3}초 추이
          </span>
        </div>

        {/* Row 1: CPU / Memory / Disk — 도넛 게이지 + sparkline */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* CPU */}
          {(() => {
            const pct = Number(sysStats.cpu_usage) || 0;
            const color = pct >= 85 ? 'red' : pct >= 60 ? 'amber' : 'blue';
            const lineColor = pct >= 85 ? '#dc2626' : pct >= 60 ? '#d97706' : '#3b82f6';
            return (
              <div className="relative bg-gradient-to-br from-slate-50 to-white p-4 rounded-xl border border-slate-100 overflow-hidden">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-1.5 text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <Cpu size={13} /> CPU Usage
                  </div>
                  {pct >= 85 && (
                    <span className="text-[9px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full uppercase">
                      High
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <DonutGauge pct={pct} color={color} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-extrabold text-slate-800 tabular-nums leading-none">{Math.round(pct)}</span>
                      <span className="text-[9px] font-bold text-slate-400 mt-0.5">%</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Sparkline values={cpuHistory} color={lineColor} max={100} />
                    <p className="text-[10px] text-slate-400 mt-1 font-mono">
                      avg {cpuHistory.length > 0 ? Math.round(cpuHistory.reduce((a, b) => a + b, 0) / cpuHistory.length) : 0}%
                      <span className="mx-1.5 text-slate-300">·</span>
                      peak {cpuHistory.length > 0 ? Math.round(Math.max(...cpuHistory)) : 0}%
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Memory */}
          {(() => {
            const pct = memPct;
            const color = pct >= 85 ? 'red' : pct >= 70 ? 'amber' : 'emerald';
            const lineColor = pct >= 85 ? '#dc2626' : pct >= 70 ? '#d97706' : '#10b981';
            return (
              <div className="relative bg-gradient-to-br from-slate-50 to-white p-4 rounded-xl border border-slate-100 overflow-hidden">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-1.5 text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <HardDrive size={13} /> Memory
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    {sysStats.memory_used_gb}/{sysStats.memory_total_gb}GB
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <DonutGauge pct={pct} color={color} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-extrabold text-slate-800 tabular-nums leading-none">{Math.round(pct)}</span>
                      <span className="text-[9px] font-bold text-slate-400 mt-0.5">%</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Sparkline values={memHistory} color={lineColor} max={100} />
                    <p className="text-[10px] text-slate-400 mt-1 font-mono">
                      avg {memHistory.length > 0 ? Math.round(memHistory.reduce((a, b) => a + b, 0) / memHistory.length) : 0}%
                      <span className="mx-1.5 text-slate-300">·</span>
                      free {Math.max(0, (sysStats.memory_total_gb - sysStats.memory_used_gb)).toFixed(1)}GB
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Disk */}
          {(() => {
            const pct = diskPct;
            const color = pct >= 90 ? 'red' : pct >= 75 ? 'amber' : 'blue';
            return (
              <div className="relative bg-gradient-to-br from-slate-50 to-white p-4 rounded-xl border border-slate-100 overflow-hidden">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-1.5 text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <Database size={13} /> Disk
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    {sysStats.disk_used_gb}/{sysStats.disk_total_gb}GB
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <DonutGauge pct={pct} color={color} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-extrabold text-slate-800 tabular-nums leading-none">{Math.round(pct)}</span>
                      <span className="text-[9px] font-bold text-slate-400 mt-0.5">%</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-500 font-bold">사용 가능 공간</p>
                    <p className="text-lg font-extrabold text-slate-700 tabular-nums leading-tight mt-0.5">
                      {Math.max(0, sysStats.disk_total_gb - sysStats.disk_used_gb).toFixed(1)}
                      <span className="text-xs font-bold text-slate-400 ml-1">GB</span>
                    </p>
                    {pct >= 90 && (
                      <p className="text-[10px] font-bold text-red-600 mt-1 inline-flex items-center gap-0.5">
                        <AlertTriangle size={10} /> 디스크 정리 권장
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Row 2: DB / Queue */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* DB Status */}
          <div className="relative bg-gradient-to-br from-slate-50 to-white p-4 rounded-xl border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <Server size={13} /> DB Status
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sysStats.db_status === 'Connected' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {sysStats.db_status === 'Connected' ? 'OK' : 'DOWN'}
              </span>
            </div>
            <div className={`text-xl font-bold flex items-center gap-2 mt-1 ${sysStats.db_status === 'Connected' ? 'text-emerald-600' : 'text-red-600'}`}>
              {sysStats.db_status === 'Connected' ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 inline-block"></span>
              )}
              {sysStats.db_status}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Latency</span>
              <span className={`text-sm font-extrabold tabular-nums ${sysStats.latency_ms > 100 ? 'text-red-500' : sysStats.latency_ms > 30 ? 'text-amber-500' : 'text-emerald-600'}`}>
                {sysStats.latency_ms}<span className="text-[10px] text-slate-400 ml-0.5">ms</span>
              </span>
            </div>
          </div>

          {/* Job Queue */}
          <div className="relative bg-gradient-to-br from-slate-50 to-white p-4 rounded-xl border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <Layers size={13} /> Job Queue
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                {queue.running}/{queue.limit} slots
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-end gap-3">
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Running</p>
                  <p className="text-2xl font-extrabold text-blue-600 tabular-nums leading-tight">{queue.running}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Pending</p>
                  <p className="text-2xl font-extrabold text-amber-500 tabular-nums leading-tight">{queue.pending}</p>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <Sparkline values={queueHistory} color="#3b82f6" max={queue.limit || 5} />
              </div>
            </div>
            <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${queuePct >= 100 ? 'bg-red-500' : queuePct >= 60 ? 'bg-amber-400' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(queuePct, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 실행 중 작업 모니터 (B5) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <PlayCircle size={18} className="text-blue-500" /> 실행 중 작업 (Active Jobs)
          </h3>
          <div className="flex items-center gap-3 text-[11px] font-bold">
            <span className="text-blue-600">실행 {queue.running}</span>
            <span className="text-amber-500">대기 {queue.pending}</span>
            <span className="text-slate-400">동시 실행 한도 {queue.limit}</span>
          </div>
        </div>

        {activeJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400">
            <Inbox size={28} className="mb-2 text-slate-300" />
            <p className="text-sm font-bold">현재 실행 중이거나 대기 중인 작업이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeJobs.map(job => {
              const isRunning = job.job_status === 'Running';
              return (
                <div
                  key={job.job_id}
                  className={`flex items-center gap-4 p-3 rounded-xl border ${
                    job.stale ? 'border-red-200 bg-red-50'
                      : isRunning ? 'border-blue-100 bg-blue-50/40'
                      : 'border-slate-100 bg-slate-50'
                  }`}
                >
                  <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-black uppercase ${
                    job.stale ? 'bg-red-100 text-red-700'
                      : isRunning ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {job.stale ? 'Stale' : isRunning ? 'Running' : 'Pending'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 truncate">{job.program_name || '—'}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 shrink-0">
                        <User size={11} /> {job.name || job.employee_id || '알 수 없음'}
                      </span>
                    </div>
                    {isRunning && (
                      <div className="mt-1.5 w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(job.progress || 0, 100)}%` }}
                        />
                      </div>
                    )}
                    {job.message && (
                      <p className="mt-1 text-[11px] text-slate-400 truncate" title={job.message}>{job.message}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {isRunning && (
                      <p className="text-sm font-extrabold text-blue-600 tabular-nums">{job.progress ?? 0}%</p>
                    )}
                    <p className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                      <Clock size={11} /> {formatElapsed(job.elapsed_seconds)}
                    </p>
                  </div>
                </div>
              );
            })}
            {activeJobs.some(j => j.stale) && (
              <p className="text-[11px] text-red-500 mt-1">
                * Stale: 서버 재시작 등으로 상태가 유실된 항목(실제로는 종료되었을 수 있음).
              </p>
            )}
          </div>
        )}
      </div>

      {/* 스토리지 정리 (A1) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <FolderMinus size={18} className="text-orange-500" /> 스토리지 정리 (userConnection)
          </h3>
          <div className="flex gap-2">
            <button
              onClick={fetchStoragePreview}
              disabled={storageLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer disabled:opacity-60"
            >
              <RefreshCw size={13} className={storageLoading ? 'animate-spin' : ''} /> 미리보기 갱신
            </button>
            <button
              onClick={() => setConfirmCleanup(true)}
              disabled={cleanupRunning || storageLoading || !storage || (storage.to_delete?.length ?? 0) === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-colors cursor-pointer disabled:opacity-40"
            >
              <Trash2 size={13} /> {cleanupRunning ? '정리 중...' : '지금 정리'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="p-3 rounded-xl bg-orange-50 border border-orange-100 text-center">
            <p className="text-[10px] font-bold text-orange-500 uppercase">삭제 대상</p>
            <p className="text-2xl font-black text-orange-600 tabular-nums">{storage?.to_delete?.length ?? '—'}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase">유지</p>
            <p className="text-2xl font-black text-slate-700 tabular-nums">{storage?.to_keep ?? '—'}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase">보존 기간</p>
            <p className="text-2xl font-black text-slate-700 tabular-nums">{storage?.retention_days ?? 30}<span className="text-xs">일</span></p>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 mb-2 truncate" title={storage?.user_connection_dir}>
          경로: <span className="font-mono">{storage?.user_connection_dir || '—'}</span>
        </p>

        {storageLoading ? (
          <div className="text-center py-6 text-slate-400"><RefreshCw size={16} className="inline animate-spin mr-2" />조회 중...</div>
        ) : (storage?.to_delete?.length ?? 0) === 0 ? (
          <div className="text-center py-6 text-sm font-bold text-emerald-600">정리할 폴더가 없습니다. (30일 초과 폴더 없음)</div>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-50">
            {storage.to_delete.map(item => (
              <div key={item.folder} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50">
                <span className="font-mono text-slate-600 truncate mr-2">{item.folder}</span>
                <span className="shrink-0 text-slate-400">{item.age_days}일 경과</span>
              </div>
            ))}
          </div>
        )}
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
                <th className="px-3 py-2.5 text-left">사번 / 이름</th>
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
                    <td className="px-3 py-2">
                      <span className="font-mono font-bold text-slate-700">{row.employee_id || '—'}</span>
                      {row.name && <span className="block text-[11px] text-slate-400 mt-0.5">{row.name}</span>}
                    </td>
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

      <ConfirmDialog
        isOpen={confirmMaintenance}
        onCancel={() => setConfirmMaintenance(false)}
        onConfirm={performMaintenanceToggle}
        title="점검 모드 활성화"
        message="점검 모드를 켜면 관리자를 제외한 모든 사용자의 로그인이 즉시 차단됩니다. 계속하시겠습니까?"
        confirmLabel="점검 모드 켜기"
        cancelLabel="취소"
        variant="warning"
      />
      <ConfirmDialog
        isOpen={confirmCleanup}
        onCancel={() => setConfirmCleanup(false)}
        onConfirm={performCleanup}
        title="스토리지 정리"
        message={`30일이 지난 작업 폴더 ${storage?.to_delete?.length ?? 0}개를 영구 삭제합니다. 되돌릴 수 없습니다. 계속하시겠습니까?`}
        confirmLabel="삭제 실행"
        cancelLabel="취소"
        variant="danger"
      />

    </div>
  );
}
