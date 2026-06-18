import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import AnalysisPageBanner from './AnalysisPageBanner';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import SolverCredit from '../ui/SolverCredit';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';

async function pingUrl(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function buildLaunchUrl(baseUrl, employeeId) {
  const url = new URL(`${baseUrl}/${encodeURIComponent(employeeId)}`);
  url.searchParams.set('__wb_cache_bust', String(Date.now()));
  return url.toString();
}

const STATUS_META = {
  checking: {
    label: '확인 중',
    icon: <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />,
    cls: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 focus-visible:ring-slate-300',
  },
  online: {
    label: '사용 가능',
    icon: <CheckCircle2 size={13} />,
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 focus-visible:ring-emerald-300',
  },
  offline: {
    label: '사용 불가',
    icon: <XCircle size={13} />,
    cls: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 focus-visible:ring-red-300',
  },
};

function StatusPill({ status, onRecheck }) {
  const meta = STATUS_META[status] || STATUS_META.checking;
  return (
    <button
      type="button"
      onClick={onRecheck}
      title="클릭하여 접속 상태 다시 확인"
      aria-label={`외부 앱 접속 상태: ${meta.label}. 클릭하여 다시 확인`}
      className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer outline-none focus-visible:ring-2 ${meta.cls}`}
    >
      {meta.icon}
      <span>{meta.label}</span>
      <RefreshCw size={11} className="opacity-0 group-hover:opacity-60 transition-opacity motion-reduce:transition-none" />
    </button>
  );
}

export default function ExternalAppLauncherPage({
  title,
  subtitle,
  description,
  baseUrl,
  status = 'Active',
  contributor,
  icon: Icon,
  toastName = title,
  windowKey = title,
}) {
  const { employeeId } = useAuth();
  const { setCurrentMenu } = useNavigation();
  const { showToast } = useToast();
  const [serverStatus, setServerStatus] = useState('checking');

  const checkStatus = useCallback(async (showSpinner = true) => {
    if (showSpinner) setServerStatus('checking');
    const ok = await pingUrl(baseUrl);
    setServerStatus(ok ? 'online' : 'offline');
  }, [baseUrl]);

  useEffect(() => {
    checkStatus(true);
    const id = setInterval(() => checkStatus(false), 20000);
    return () => clearInterval(id);
  }, [checkStatus]);

  const handleLaunch = () => {
    if (!employeeId) {
      showToast('로그인 사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.', 'error');
      return;
    }

    const url = buildLaunchUrl(baseUrl, employeeId);
    if (window.electron?.invoke) {
      window.electron.invoke('open-app-window', {
        url,
        title,
        windowKey,
        clearCache: true,
      });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    showToast(`${toastName} 을 WorkBench 내부 창에서 실행합니다.`, 'success');
  };

  const isOffline = serverStatus === 'offline';
  const statusVariant = status === 'Active' ? 'success' : 'warning';
  const statusLabel = status === 'Active' ? '서비스 중' : '개발 중';

  return (
    <div className="max-w-4xl mx-auto pb-16 animate-fade-in-up">
      <AnalysisPageBanner
        title={title}
        icon={Icon}
        subtitle={subtitle}
        onBack={() => setCurrentMenu('Interactive Apps')}
        backLabel="Interactive Apps로 돌아가기"
        gradient="from-brand-blue via-violet-900 to-violet-700"
        iconClassName="text-violet-300"
        subtitleClassName="text-violet-200/80"
      />

      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="absolute inset-x-0 top-0 h-1 bg-violet-600" aria-hidden="true" />

        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px]">
          <div className="px-7 md:px-8 py-7">
            <div className="flex items-start gap-5">
              {Icon && (
                <div className="shrink-0 grid place-items-center w-14 h-14 rounded-2xl bg-violet-600 text-white shadow-sm">
                  <Icon size={26} />
                </div>
              )}
              <div className="min-w-0">
                <Badge variant={statusVariant} size="sm" dot>{statusLabel}</Badge>
                <h2 className="mt-3 text-xl font-bold text-slate-800 tracking-tight">{title}</h2>
                <p className="mt-2 max-w-xl text-sm text-slate-500 leading-relaxed">{description}</p>
              </div>
            </div>
          </div>

          <div className="hidden md:grid place-items-center bg-violet-50/70 border-l border-violet-100">
            <div className="grid h-24 w-24 place-items-center rounded-[2rem] bg-white text-violet-600 shadow-sm border border-violet-100">
              {Icon && <Icon size={42} strokeWidth={1.7} />}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 bg-slate-50/80 px-7 md:px-8 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span>접속 상태</span>
              <StatusPill status={serverStatus} onRecheck={() => checkStatus(true)} />
            </div>

            <Button
              type="button"
              onClick={handleLaunch}
              disabled={isOffline}
              size="lg"
              className="w-full sm:w-auto bg-violet-600 hover:bg-violet-700 focus:ring-violet-500/40"
            >
              <ExternalLink size={18} />
              실행
            </Button>
          </div>

          {isOffline && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <XCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
              <p className="text-xs font-medium text-red-700">
                외부 앱 서버에 연결할 수 없습니다. 서버 상태를 확인한 뒤 다시 시도하세요.
              </p>
            </div>
          )}

          {status !== 'Active' && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-700" />
              <p className="text-xs font-medium leading-relaxed text-amber-800">
                개발 중 앱입니다.
              </p>
            </div>
          )}
        </div>
      </section>

      <SolverCredit contributor={contributor} />
    </div>
  );
}
