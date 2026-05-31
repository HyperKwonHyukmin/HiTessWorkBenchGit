import React from 'react';
import { GraduationCap } from 'lucide-react';
import AppCataloguePage from '../../components/analysis/AppCataloguePage';

export default function AcademicApps() {
  return (
    <AppCataloguePage
      mode="Academic"
      title="Academic Apps"
      icon={GraduationCap}
      subtitle="학술 연구 기반의 AI·고급 알고리즘 해석 앱입니다."
      accentColor="cyan"
      guideTitle="[학술] Academic Apps — AI 기반 해석 앱"
      emptyTitle="준비 중인 Academic 앱이 곧 추가될 예정입니다."
      emptySubtitle="새로운 연구 기반 도구를 기대해 주세요."
    />
  );
}
