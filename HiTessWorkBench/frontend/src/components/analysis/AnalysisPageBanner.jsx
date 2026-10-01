import React from 'react';
import { ArrowLeft, Code2 } from 'lucide-react';
import PageBanner from '../ui/PageBanner';
import GuideButton from '../ui/GuideButton';
import AppUsageStatsButton from './AppUsageStatsButton';
import { resolveCardArt } from '../ui/cardArt';
import { findAppByAnyName } from '../../contexts/DashboardContext';

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
  // 배경 선화 이름(cardArt 라이브러리). 생략하면 제목으로 앱을 찾아 카탈로그 카드와 같은 그림을 쓴다.
  // false 면 그리지 않는다.
  art,
}) {
  // 카탈로그 카드에서 본 그림이 앱 안 배너까지 이어진다 — 어느 앱 안에 있는지 그림으로도 읽힌다.
  const artName = art === false ? null
    : art || resolveCardArt(findAppByAnyName(statsProgramName || title) || {});
  return (
    <PageBanner gradient={gradient} artName={artName}>
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
