import React from 'react';

export default function JobProgressPanel({
  message,
  progress = 0,
  tone = 'blue',
  className = '',
}) {
  const clampedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  const toneClass = {
    blue: 'text-blue-600 bg-blue-500',
    sky: 'text-sky-600 bg-sky-500',
    emerald: 'text-emerald-600 bg-emerald-500',
    amber: 'text-amber-600 bg-amber-500',
  }[tone] || 'text-blue-600 bg-blue-500';

  const [textClass, barClass] = toneClass.split(' ');

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-4 shadow-sm ${className}`}>
      <div className="flex justify-between gap-3 text-xs text-slate-500 mb-1.5">
        <span className="truncate">{message || '작업 진행 중...'}</span>
        <span className={`font-bold ${textClass}`}>{clampedProgress}%</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barClass}`}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
    </div>
  );
}
