import React from 'react';
import { PenTool } from 'lucide-react';
import ExternalAppLauncherPage from '../../components/analysis/ExternalAppLauncherPage';
import { API_BASE_URL } from '../../config';

const INDEPENDENT_TANK_PROXY_PATH = '/external-apps/independent-tank';

export default function IndependentTankAssessment() {
  const independentTankBaseUrl = `${API_BASE_URL}${INDEPENDENT_TANK_PROXY_PATH}`;
  const independentTankHealthUrl = `${independentTankBaseUrl}/__wb_proxy_health`;

  return (
    <ExternalAppLauncherPage
      title="Independent Tank Assessment"
      subtitle="독립 탱크 구조 평가 도구"
      description="독립 탱크 구조 평가를 위한 외부 앱을 실행합니다."
      baseUrl={independentTankBaseUrl}
      healthUrl={independentTankHealthUrl}
      clearCacheOnLaunch={true}
      cacheBustOnLaunch={true}
      status="Developing"
      contributor="김한별"
      icon={PenTool}
    />
  );
}
