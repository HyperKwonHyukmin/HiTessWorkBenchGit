import React from 'react';
import { PenTool } from 'lucide-react';
import ExternalAppLauncherPage from '../../components/analysis/ExternalAppLauncherPage';
import { EXTERNAL_APP_MODE } from '../../utils/externalAppLaunch';

const INDEPENDENT_TANK_BASE_URL = 'http://10.14.42.145:31870';

export default function IndependentTankAssessment() {
  return (
    <ExternalAppLauncherPage
      title="Independent Tank Assessment"
      subtitle="독립 탱크 구조 평가 도구"
      description="의장 단독형 탱크 구조 평가를 수행합니다."
      baseUrl={INDEPENDENT_TANK_BASE_URL}
      launchMode={EXTERNAL_APP_MODE.RAW}
      clearCacheOnLaunch={true}
      cacheBustOnLaunch={false}
      status="Developing"
      contributor="김한별"
      icon={PenTool}
    />
  );
}
