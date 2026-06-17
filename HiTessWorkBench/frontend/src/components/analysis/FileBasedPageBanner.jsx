import React from 'react';
import { ArrowLeft } from 'lucide-react';
import PageBanner from '../ui/PageBanner';
import GuideButton from '../ui/GuideButton';

const DEFAULT_GRADIENT = 'from-brand-blue via-brand-blue-dark to-blue-700';

export default function FileBasedPageBanner({
  title,
  subtitle,
  icon: Icon,
  guideTitle,
  onBack,
  gradient = DEFAULT_GRADIENT,
  actions,
}) {
  return (
    <PageBanner gradient={gradient}>
      <div className="flex items-center gap-4 min-w-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg text-white transition-colors cursor-pointer shrink-0"
            aria-label="File-Based Apps로 돌아가기"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2 min-w-0">
            {Icon && <Icon size={18} className="text-blue-200 shrink-0" />}
            <span className="truncate">{title}</span>
          </h1>
          {subtitle && (
            <p className="text-sm text-blue-200/80 mt-0.5 leading-snug">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {guideTitle && <GuideButton guideTitle={guideTitle} variant="dark" />}
      </div>
    </PageBanner>
  );
}
