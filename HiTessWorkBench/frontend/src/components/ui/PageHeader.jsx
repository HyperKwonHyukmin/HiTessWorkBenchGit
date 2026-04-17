import React, { useState } from 'react';
import { History } from 'lucide-react';
import ChangelogModal from './ChangelogModal';

const ACCENT_GRADIENTS = {
  blue:    'from-brand-blue via-brand-blue-dark to-indigo-800',
  teal:    'from-brand-blue via-teal-900 to-teal-700',
  violet:  'from-brand-blue via-violet-900 to-violet-700',
  emerald: 'from-brand-blue via-emerald-900 to-emerald-700',
  indigo:  'from-brand-blue via-indigo-900 to-indigo-700',
  amber:   'from-brand-blue via-amber-900 to-amber-700',
  cyan:    'from-cyan-800 via-cyan-900 to-slate-800',
};

const ACCENT_SUBTITLES = {
  blue:    'text-blue-200/80',
  teal:    'text-teal-200/80',
  violet:  'text-violet-200/80',
  emerald: 'text-emerald-200/80',
  indigo:  'text-indigo-200/80',
  amber:   'text-amber-200/80',
  cyan:    'text-cyan-200/80',
};

/**
 * PageHeader — 페이지 상단 표준 배너 헤더.
 *
 * @param {string}            props.title       - 페이지 제목 (필수)
 * @param {React.ElementType} [props.icon]      - lucide-react 아이콘
 * @param {string}            [props.subtitle]  - 보조 설명
 * @param {React.ReactNode}   [props.actions]   - 우측 액션 영역
 * @param {'blue'|'teal'|'violet'|'emerald'|'indigo'|'amber'} [props.accentColor='blue']
 */
export default function PageHeader({ title, icon: Icon, subtitle, actions, accentColor = 'blue', programKey }) {
  const gradient = ACCENT_GRADIENTS[accentColor] ?? ACCENT_GRADIENTS.blue;
  const subtitleColor = ACCENT_SUBTITLES[accentColor] ?? ACCENT_SUBTITLES.blue;
  const [changelogOpen, setChangelogOpen] = useState(false);

  return (
    <div className={`relative mb-8 -mx-6 -mt-6 px-8 py-7 bg-gradient-to-r ${gradient} overflow-hidden`}>
      <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
        <div className="absolute -right-8 -top-8 w-64 h-64 bg-white rounded-full" />
        <div className="absolute right-32 bottom-0 w-32 h-32 bg-white rounded-full" />
      </div>

      <div className="relative flex justify-between items-start max-w-7xl mx-auto">
        <div className="flex items-start gap-4">
          {Icon && (
            <div
              className="bg-white/10 backdrop-blur-sm p-3 rounded-xl text-white border border-white/10 shrink-0 mt-0.5"
              aria-hidden="true"
            >
              <Icon size={22} />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
            {subtitle && (
              <p className={`text-sm mt-1.5 ${subtitleColor}`}>{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {actions}
          {programKey && (
            <button
              onClick={() => setChangelogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors cursor-pointer"
              title="개발 이력 보기"
            >
              <History size={14} />
              이력
            </button>
          )}
        </div>
      </div>

      {programKey && (
        <ChangelogModal
          programKey={programKey}
          title={title}
          isOpen={changelogOpen}
          onClose={() => setChangelogOpen(false)}
        />
      )}
    </div>
  );
}
