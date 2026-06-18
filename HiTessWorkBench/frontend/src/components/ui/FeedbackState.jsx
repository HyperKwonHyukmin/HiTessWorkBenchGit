import React from 'react';
import { AlertCircle, Database, Loader2 } from 'lucide-react';

const VARIANTS = {
  empty: {
    iconClass: 'text-slate-300',
    titleClass: 'text-slate-600',
    textClass: 'text-slate-500',
  },
  loading: {
    iconClass: 'text-blue-500',
    titleClass: 'text-slate-700',
    textClass: 'text-slate-500',
  },
  error: {
    iconClass: 'text-red-500',
    titleClass: 'text-red-700',
    textClass: 'text-red-600',
  },
};

export default function FeedbackState({
  variant = 'empty',
  icon: Icon,
  title,
  message,
  compact = false,
  className = '',
  children,
}) {
  const meta = VARIANTS[variant] ?? VARIANTS.empty;
  const StateIcon = Icon || (variant === 'loading' ? Loader2 : variant === 'error' ? AlertCircle : Database);

  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'min-h-[220px] py-12 px-6',
        className,
      ].filter(Boolean).join(' ')}
      role={variant === 'loading' ? 'status' : undefined}
      aria-live={variant === 'loading' ? 'polite' : undefined}
    >
      <StateIcon
        size={compact ? 28 : 40}
        className={[
          'mb-3',
          variant === 'loading' ? 'animate-spin' : 'opacity-80',
          meta.iconClass,
        ].join(' ')}
        aria-hidden="true"
      />
      {title && <p className={`text-sm font-bold ${meta.titleClass}`}>{title}</p>}
      {message && <p className={`mt-1 text-xs leading-relaxed ${meta.textClass}`}>{message}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
