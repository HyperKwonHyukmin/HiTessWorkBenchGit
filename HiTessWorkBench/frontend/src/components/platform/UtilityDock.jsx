import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircle,
  Trash2,
  X,
} from 'lucide-react';
import { useGlobalJobs } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import ChatDock from '../chat/ChatDock';
import DoublePipePsaTray from '../analysis/DoublePipePsaTray';
import Badge from '../ui/Badge';

const RESUME_ENTRY_KEY = 'workbench:analysis-menu-resume-entry';

const TERMINAL_STATUSES = new Set(['Success', 'Failed', 'Interrupted']);

const STATUS_CONFIG = {
  Pending: {
    label: '대기 중',
    badge: 'warning',
    icon: Clock3,
    iconClass: 'text-amber-600',
  },
  Running: {
    label: '실행 중',
    badge: 'info',
    icon: Loader2,
    iconClass: 'animate-spin text-blue-600',
  },
  Success: {
    label: '완료',
    badge: 'success',
    icon: CheckCircle2,
    iconClass: 'text-emerald-600',
  },
  Failed: {
    label: '실패',
    badge: 'error',
    icon: AlertCircle,
    iconClass: 'text-red-600',
  },
  Interrupted: {
    label: '중단',
    badge: 'error',
    icon: AlertCircle,
    iconClass: 'text-red-600',
  },
};

function formatElapsed(startedAt, completedAt) {
  if (!startedAt) return '—';
  const end = completedAt || Date.now();
  const seconds = Math.max(0, Math.floor((end - Number(startedAt)) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}분 ${remainder}초` : `${remainder}초`;
}

function JobRow({ job, onNavigate, onDismiss }) {
  const config = STATUS_CONFIG[job.status] || STATUS_CONFIG.Pending;
  const StatusIcon = config.icon;
  const progress = Math.min(100, Math.max(0, Number(job.progress) || 0));
  const queuePosition = job.queuePosition ?? job.queue_position;
  const isTerminal = TERMINAL_STATUSES.has(job.status);

  return (
    <div className="border-b border-slate-100 px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <StatusIcon size={17} className={`mt-0.5 shrink-0 ${config.iconClass}`} aria-hidden="true" />
        <button
          type="button"
          onClick={() => onNavigate(job)}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 rounded-lg"
        >
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-slate-800" title={job.displayName || job.menu}>
              {job.displayName || job.menu}
            </p>
            <Badge variant={config.badge} size="sm" dot>{config.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500" title={job.message}>
            {job.message || config.label}
          </p>
        </button>
        <button
          type="button"
          onClick={() => onDismiss(job.jobId)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
          title="작업 목록에서 닫기"
          aria-label={`${job.displayName || job.menu} 작업 닫기`}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              job.status === 'Success'
                ? 'bg-emerald-500'
                : job.status === 'Failed' || job.status === 'Interrupted'
                  ? 'bg-red-500'
                  : 'bg-blue-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="w-9 text-right font-mono text-[10px] font-bold text-slate-500">{Math.round(progress)}%</span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Clock3 size={11} />
          경과 {formatElapsed(job.startedAt, job.completedAt)}
        </span>
        {!isTerminal && queuePosition != null && Number(queuePosition) > 0 ? (
          <span className="text-amber-700">대기열 {queuePosition}번째</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-blue-700">
            화면 열기 <ArrowUpRight size={11} />
          </span>
        )}
      </div>
    </div>
  );
}

export default function UtilityDock({ currentUserId, isAdmin = false }) {
  const { globalJobs = [], clearGlobalJob } = useGlobalJobs();
  const { currentMenu, setCurrentMenu } = useNavigation();
  const [activePanel, setActivePanel] = useState(null);
  const [chatUnread, setChatUnread] = useState(0);
  // 로그인한 모든 사용자에게 '메시지' 버튼을 노출한다(ChatDock 이 로그인 여부로 최종 확정).
  // UtilityDock 자체가 APP_STATE.MAIN(로그인 상태)에서만 렌더되므로 true 로 시작해도
  // 비로그인 화면에 버튼이 새지 않고, 첫 렌더에 버튼이 깜빡이는 현상도 없다.
  const [chatAvailable, setChatAvailable] = useState(true);
  const [psaActive, setPsaActive] = useState(false);

  useEffect(() => {
    const openJobCenter = () => setActivePanel('jobs');
    window.addEventListener('workbench:open-job-center', openJobCenter);
    return () => window.removeEventListener('workbench:open-job-center', openJobCenter);
  }, []);

  const activeJobCount = useMemo(
    () => globalJobs.filter(job => !TERMINAL_STATUSES.has(job.status)).length + (psaActive ? 1 : 0),
    [globalJobs, psaActive],
  );
  const failedJobCount = useMemo(
    () => globalJobs.filter(job => job.status === 'Failed' || job.status === 'Interrupted').length,
    [globalJobs],
  );

  const togglePanel = (panel) => {
    setActivePanel(current => current === panel ? null : panel);
  };

  const navigateToJob = (job) => {
    try {
      sessionStorage.setItem(
        RESUME_ENTRY_KEY,
        JSON.stringify({ menu: job.menu, jobId: job.jobId, at: Date.now() }),
      );
    } catch {
      // sessionStorage가 차단된 환경에서도 페이지 이동은 계속한다.
    }
    setCurrentMenu(job.menu);
    setActivePanel(null);
  };

  return (
    <>
      <section
        className={`fixed bottom-20 right-4 z-[99989] max-h-[min(620px,calc(100vh-7rem))] w-[min(430px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${
          activePanel === 'jobs' ? 'flex' : 'hidden'
        }`}
        aria-label="작업 센터"
        aria-hidden={activePanel === 'jobs' ? undefined : true}
      >
          <header className="flex items-center gap-3 border-b border-slate-200 bg-brand-blue px-4 py-3 text-white">
            <Activity size={18} />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold">Job Center</h2>
              <p className="text-[10px] text-blue-100">
                대기·실행·완료 작업을 한곳에서 추적합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActivePanel(null)}
              className="rounded-lg p-1.5 text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="작업 센터 닫기"
            >
              <X size={17} />
            </button>
          </header>

          <div className="overflow-y-auto">
            <DoublePipePsaTray
              currentMenu={currentMenu}
              onNavigate={(menu) => {
                setCurrentMenu(menu);
                setActivePanel(null);
              }}
              embedded
              onActiveChange={setPsaActive}
            />
            {globalJobs.length > 0 ? (
              globalJobs.map(job => (
                <JobRow
                  key={job.jobId}
                  job={job}
                  onNavigate={navigateToJob}
                  onDismiss={clearGlobalJob}
                />
              ))
            ) : !psaActive && (
              <div className="px-6 py-12 text-center">
                <CheckCircle2 size={30} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-bold text-slate-700">추적 중인 작업이 없습니다.</p>
                <p className="mt-1 text-xs text-slate-500">해석을 실행하면 진행률과 대기열 순서가 여기에 표시됩니다.</p>
              </div>
            )}
          </div>
      </section>

      <div className="fixed bottom-20 right-4 z-[99989]">
        <ChatDock
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          embedded
          hideLauncher
          isOpen={activePanel === 'chat'}
          onOpenChange={(next) => setActivePanel(next ? 'chat' : null)}
          onUnreadChange={setChatUnread}
          onAvailabilityChange={setChatAvailable}
        />
      </div>

      <nav
        className="fixed bottom-4 right-4 z-[99990] flex items-center gap-1 rounded-2xl border border-slate-700 bg-slate-900/95 p-1.5 shadow-xl backdrop-blur-xl"
        aria-label="전역 도구"
      >
        <button
          type="button"
          onClick={() => togglePanel('jobs')}
          className={`relative inline-flex h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
            activePanel === 'jobs' ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-slate-800'
          }`}
          aria-expanded={activePanel === 'jobs'}
          title="Job Center"
        >
          <Activity size={18} />
          <span className="hidden sm:inline">작업</span>
          {(activeJobCount > 0 || failedJobCount > 0) && (
            <span className={`absolute -right-1.5 -top-1.5 min-w-[19px] rounded-full px-1 text-center text-[10px] font-black leading-[19px] text-white ${
              failedJobCount > 0 ? 'bg-red-500' : 'bg-blue-500'
            }`}>
              {Math.min(99, activeJobCount || failedJobCount)}
            </span>
          )}
        </button>

        {chatAvailable && (
          <button
            type="button"
            onClick={() => togglePanel('chat')}
            className={`relative inline-flex h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              activePanel === 'chat' ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-slate-800'
            }`}
            aria-expanded={activePanel === 'chat'}
            title="메시지"
          >
            <MessageCircle size={18} />
            <span className="hidden sm:inline">메시지</span>
            {chatUnread > 0 && (
              <span className="absolute -right-1.5 -top-1.5 min-w-[19px] rounded-full bg-red-500 px-1 text-center text-[10px] font-black leading-[19px] text-white">
                {chatUnread > 99 ? '99+' : chatUnread}
              </span>
            )}
          </button>
        )}
      </nav>
    </>
  );
}
