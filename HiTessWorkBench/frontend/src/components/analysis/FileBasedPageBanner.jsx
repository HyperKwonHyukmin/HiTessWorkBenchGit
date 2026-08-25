import React from 'react';
import AnalysisPageBanner from './AnalysisPageBanner';

const DEFAULT_GRADIENT = 'from-brand-blue via-brand-blue-dark to-blue-700';

export default function FileBasedPageBanner({
  title,
  subtitle,
  icon: Icon,
  guideTitle,
  htmlGuide,
  onBack,
  gradient = DEFAULT_GRADIENT,
  actions,
}) {
  return (
    <AnalysisPageBanner
      title={title}
      subtitle={subtitle}
      icon={Icon}
      guideTitle={guideTitle}
      htmlGuide={htmlGuide}
      onBack={onBack}
      backLabel="File-Based Apps로 돌아가기"
      gradient={gradient}
      actions={actions}
    />
  );
}
