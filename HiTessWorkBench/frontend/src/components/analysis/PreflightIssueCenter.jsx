import React, { useMemo } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, ShieldCheck } from 'lucide-react';
import Badge from '../ui/Badge';

const SEVERITY_CONFIG = {
  error: {
    label: '오류',
    badge: 'error',
    icon: AlertCircle,
    iconClass: 'text-red-600',
    rowClass: 'border-red-200 bg-red-50/70',
  },
  warning: {
    label: '주의',
    badge: 'warning',
    icon: AlertTriangle,
    iconClass: 'text-amber-600',
    rowClass: 'border-amber-200 bg-amber-50/70',
  },
  info: {
    label: '안내',
    badge: 'info',
    icon: Info,
    iconClass: 'text-blue-600',
    rowClass: 'border-blue-200 bg-blue-50/70',
  },
};

export default function PreflightIssueCenter({
  issues = [],
  title = 'Preflight Check',
  readyMessage = '실행 전 필수 검사를 통과했습니다.',
  onIssueClick,
  compact = false,
}) {
  const visibleIssues = useMemo(
    () => issues.filter(issue => issue && issue.severity !== 'success'),
    [issues],
  );
  const errorCount = visibleIssues.filter(issue => issue.severity === 'error').length;
  const warningCount = visibleIssues.filter(issue => issue.severity === 'warning').length;
  const isReady = errorCount === 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white" aria-label={title}>
      <header className={`flex items-center gap-2 border-b border-slate-100 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <ShieldCheck size={16} className={isReady ? 'text-emerald-600' : 'text-red-600'} />
        <h3 className="flex-1 text-xs font-bold text-slate-700">{title}</h3>
        {errorCount > 0 && <Badge variant="error" size="sm" dot>{errorCount} 오류</Badge>}
        {warningCount > 0 && <Badge variant="warning" size="sm" dot>{warningCount} 주의</Badge>}
        {visibleIssues.length === 0 && <Badge variant="success" size="sm" dot>준비됨</Badge>}
      </header>

      {visibleIssues.length === 0 ? (
        <div className={`flex items-center gap-2 text-emerald-800 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <p className="text-xs font-semibold">{readyMessage}</p>
        </div>
      ) : (
        <div className={`space-y-2 ${compact ? 'p-2' : 'p-3'}`}>
          {visibleIssues.map((issue, index) => {
            const config = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.info;
            const IssueIcon = config.icon;
            const Wrapper = onIssueClick && issue.field ? 'button' : 'div';
            return (
              <Wrapper
                key={issue.id || `${issue.severity}-${index}`}
                type={Wrapper === 'button' ? 'button' : undefined}
                onClick={Wrapper === 'button' ? () => onIssueClick(issue) : undefined}
                className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left ${config.rowClass} ${
                  Wrapper === 'button' ? 'cursor-pointer hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30' : ''
                }`}
              >
                <IssueIcon size={15} className={`mt-0.5 shrink-0 ${config.iconClass}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-slate-800">{issue.title}</p>
                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{config.label}</span>
                  </div>
                  {issue.detail && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{issue.detail}</p>}
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}
    </section>
  );
}
