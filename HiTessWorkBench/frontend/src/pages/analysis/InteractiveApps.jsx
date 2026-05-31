import React from 'react';
import { PenTool } from 'lucide-react';
import AppCataloguePage from '../../components/analysis/AppCataloguePage';

export default function InteractiveApps() {
  return (
    <AppCataloguePage
      mode="Interactive"
      title="Interactive Apps"
      icon={PenTool}
      subtitle="UI에서 설계 정보를 직접 입력하여 실시간으로 결과를 확인하세요."
      accentColor="violet"
      guideTitle="[대화형] Interactive Apps — 도구 소개"
    />
  );
}
