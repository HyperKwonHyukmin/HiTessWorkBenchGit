import React from 'react';
import AnimatedNumber from '../ui/AnimatedNumber';
import ProgressBar from '../ui/ProgressBar';

export default function JobProgressPanel({
  message,
  progress = 0,
  tone = 'blue',
  className = '',
}) {
  const clampedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  const textClass = {
    blue: 'text-blue-600',
    sky: 'text-sky-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
  }[tone] || 'text-blue-600';

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-4 shadow-sm ${className}`}>
      <div className="flex justify-between gap-3 text-xs text-slate-500 mb-1.5">
        <span className="truncate">{message || '작업 진행 중...'}</span>
        <span className={`font-bold tabular-nums ${textClass}`}><AnimatedNumber value={clampedProgress} />%</span>
      </div>
      <ProgressBar value={clampedProgress} tone={tone} size="md" trackClassName="bg-slate-100" />
    </div>
  );
}
