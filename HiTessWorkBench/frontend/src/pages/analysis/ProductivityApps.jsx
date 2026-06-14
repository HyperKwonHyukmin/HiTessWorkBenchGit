import React from 'react';
import { Wrench } from 'lucide-react';
import AppCataloguePage from '../../components/analysis/AppCataloguePage';

export default function ProductivityApps() {
  return (
    <AppCataloguePage
      mode="Productivity"
      title="Productivity Apps"
      icon={Wrench}
      subtitle="업무 효율을 높이는 유틸리티 도구 모음입니다."
      accentColor="amber"
    />
  );
}
