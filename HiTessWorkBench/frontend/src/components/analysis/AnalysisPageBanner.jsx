import React from 'react';
import { ArrowLeft, Code2 } from 'lucide-react';
import PageBanner from '../ui/PageBanner';
import GuideButton from '../ui/GuideButton';
import AppUsageStatsButton from './AppUsageStatsButton';

const DEFAULT_GRADIENT = 'from-brand-blue via-brand-blue-dark to-blue-700';

/**
 * 해석 앱 공통 상단 배너.
 *
 * 가이드 버튼은 두 종류를 나란히 놓을 수 있다.
 *   · 사용 가이드 — 모든 사용자 대상 (guideTitle | htmlGuide | guidePlaceholder)
 *   · 개발 가이드 — 관리자 전용 (devHtmlGuide). 엔진 내부 동작·패치 이력처럼
 *     일반 사용자에게 공개하지 않는 문서를 여기에 건다.
 */
export default function AnalysisPageBanner({
  title,
  subtitle,
  icon: Icon,
  guideTitle,
  htmlGuide,
  guidePlaceholder,
  devHtmlGuide,
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
        {devHtmlGuide && (
          <GuideButton
            htmlGuide={devHtmlGuide}
            label="개발 가이드"
            emoji="🛠️"
            icon={Code2}
            adminOnly
            variant="admin"
            headerBg="bg-slate-800"
          />
        )}
        {(guideTitle || htmlGuide || guidePlaceholder) && (
          <GuideButton
            guideTitle={guideTitle}
            htmlGuide={htmlGuide}
            placeholder={guidePlaceholder}
            variant="dark"
          />
        )}
      </div>
    </PageBanner>
  );
}
