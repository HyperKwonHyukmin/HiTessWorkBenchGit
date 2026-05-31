import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import AppCataloguePage from '../../components/analysis/AppCataloguePage';

export default function ParametricApps() {
  return (
    <AppCataloguePage
      mode="Parametric"
      title="Parametric Apps"
      icon={SlidersHorizontal}
      subtitle="설계 파라미터를 직접 입력하여 계산 결과를 즉시 확인하세요."
      accentColor="emerald"
      guideTitle="[파라메트릭] Parametric Apps — 도구 소개"
    />
  );
}
