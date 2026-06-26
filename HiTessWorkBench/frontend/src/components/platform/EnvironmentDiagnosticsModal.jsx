import React, { useMemo } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Copy, Server } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { API_BASE_URL } from '../../config';
import { version as CLIENT_VERSION } from '../../../package.json';

function formatTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function healthVariant(level) {
  if (level === 'online') return 'success';
  if (level === 'degraded' || level === 'unreliable') return 'warning';
  if (level === 'offline') return 'error';
  return 'neutral';
}

function row(label, value) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="max-w-[65%] break-all text-right text-xs font-mono text-slate-700">{value || '-'}</span>
    </div>
  );
}

export default function EnvironmentDiagnosticsModal({
  isOpen,
  onClose,
  health,
  networkEvents = [],
  onRecheck,
  onClearNetworkEvents,
  onOpenServerSettings,
}) {
  const diagnosticsText = useMemo(() => {
    const lines = [
      'HiTESS WorkBench Diagnostics',
      `Client Version: ${CLIENT_VERSION}`,
      `Server URL: ${API_BASE_URL}`,
      `Server Version: ${health?.serverVersion || '-'}`,
      `Server Health: ${health?.label || '-'}`,
      `Latency: ${health?.latencyMs ?? '-'} ms`,
      `Last Checked: ${health?.lastCheckedAt || '-'}`,
      `User Agent: ${navigator.userAgent}`,
      '',
      'Recent Network Events:',
      ...(networkEvents.length
        ? networkEvents.slice(0, 10).map(e => `- [${e.at}] ${e.method || ''} ${e.url || ''} ${e.status || ''} ${e.message || ''}`)
        : ['- none']),
    ];
    return lines.join('\n');
  }, [health, networkEvents]);

  const handleCopy = async () => {
    await navigator.clipboard?.writeText(diagnosticsText);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="환경 진단 및 네트워크 상태"
      size="xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClearNetworkEvents}>오류 기록 지우기</Button>
          {onOpenServerSettings && <Button variant="secondary" onClick={onOpenServerSettings}>서버 주소 설정</Button>}
          <Button variant="secondary" onClick={handleCopy}><Copy size={16} /> 진단 결과 복사</Button>
          <Button variant="primary" onClick={onRecheck}>상태 재확인</Button>
        </div>
      }
    >
      <div className="grid gap-4 p-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server size={18} className="text-blue-600" />
              <h3 className="text-sm font-bold text-slate-800">Connection</h3>
            </div>
            <Badge variant={healthVariant(health?.level)} dot>{health?.label || 'Unknown'}</Badge>
          </div>
          {row('Server URL', API_BASE_URL)}
          {row('Server Version', health?.serverVersion)}
          {row('Client Version', CLIENT_VERSION)}
          {row('Latency', health?.latencyMs == null ? '-' : `${health.latencyMs} ms`)}
          {row('Last Check', formatTime(health?.lastCheckedAt))}
          {row('Error', health?.error)}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-violet-600" />
              <h3 className="text-sm font-bold text-slate-800">Recent API Events</h3>
            </div>
            <Badge variant={networkEvents.length ? 'warning' : 'success'} dot>
              {networkEvents.length ? `${networkEvents.length} issues` : 'Clean'}
            </Badge>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {networkEvents.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                <CheckCircle2 size={15} /> 최근 API 오류가 없습니다.
              </div>
            ) : networkEvents.map(event => (
              <div key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <AlertTriangle size={14} className={event.severity === 'error' ? 'text-red-500' : 'text-amber-500'} />
                      <span className="truncate">{event.title}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] font-mono text-slate-500">
                      {event.method} {event.url}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">{event.message}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    {event.status && <Badge size="sm" variant={event.status >= 500 ? 'error' : 'warning'}>{event.status}</Badge>}
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                      <Clock size={10} /> {formatTime(event.at)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
