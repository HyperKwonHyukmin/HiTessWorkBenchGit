import React from 'react';
import { ArrowLeft } from 'lucide-react';
import PageBanner from '../ui/PageBanner';
import GuideButton from '../ui/GuideButton';
import AppUsageStatsButton from './AppUsageStatsButton';

const DEFAULT_GRADIENT = 'from-brand-blue via-brand-blue-dark to-blue-700';

export default function AnalysisPageBanner({
  title,
  subtitle,
  icon: Icon,
  guideTitle,
  htmlGuide,
  onBack,
  backLabel = '이전 페이지로 돌아가기',
  gradient = DEFAULT_GRADIENT,
  iconClassName = 'text-blue-200',
  subtitleClassName = 'text-blue-200/80',
  actions,
  statsProgramName,
}) {
  return (
    <PageBanner gradient={gradient}>
      <div className="flex items-center gap-4 min-w-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg text-white transition-colors cursor-pointer shrink-0"
            aria-label={backLabel}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2 min-w-0">
            {Icon && <Icon size={18} className={`${iconClassName} shrink-0`} />}
            <span className="truncate">{title}</span>
          </h1>
          {subtitle && (
            <p className={`text-sm mt-0.5 leading-snug ${subtitleClassName}`}>{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <AppUsageStatsButton appName={statsProgramName || title} />
        {actions}
        {(guideTitle || htmlGuide) && (
          <GuideButton guideTitle={guideTitle} htmlGuide={htmlGuide} variant="dark" />
        )}
      </div>
    </PageBanner>
  );
}
