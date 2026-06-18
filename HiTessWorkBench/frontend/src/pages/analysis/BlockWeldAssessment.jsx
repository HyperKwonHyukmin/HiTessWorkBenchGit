import React from 'react';
import { PenTool } from 'lucide-react';
import ExternalAppLauncherPage from '../../components/analysis/ExternalAppLauncherPage';

const BLOCK_WELD_BASE_URL = 'http://10.14.42.145:31880';

export default function BlockWeldAssessment() {
  return (
    <ExternalAppLauncherPage
      title="Block Weld Assessment"
      subtitle="블록 용접부 구조 평가 도구"
      description="블록 전도 방지 구속 용접양을 산출합니다."
      baseUrl={BLOCK_WELD_BASE_URL}
      status="Active"
      contributor="김한별"
      icon={PenTool}
    />
  );
}
