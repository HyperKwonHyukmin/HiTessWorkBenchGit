import React from 'react';
import { PenTool } from 'lucide-react';
import ExternalAppLauncherPage from '../../components/analysis/ExternalAppLauncherPage';
import { API_BASE_URL } from '../../config';

const BLOCK_WELD_PROXY_PATH = '/external-apps/block-weld';

export default function BlockWeldAssessment() {
  const blockWeldBaseUrl = `${API_BASE_URL}${BLOCK_WELD_PROXY_PATH}`;
  const blockWeldHealthUrl = `${blockWeldBaseUrl}/__wb_proxy_health`;

  return (
    <ExternalAppLauncherPage
      title="Block Weld Assessment"
      subtitle="블록 용접부 구조 평가 도구"
      description="블록 전도 방지 구속 용접양을 산출합니다."
      baseUrl={blockWeldBaseUrl}
      healthUrl={blockWeldHealthUrl}
      clearCacheOnLaunch={false}
      cacheBustOnLaunch={false}
      status="Active"
      contributor="김한별"
      icon={PenTool}
    />
  );
}
