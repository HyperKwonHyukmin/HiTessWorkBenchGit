import React from 'react';
import { PenTool } from 'lucide-react';
import ExternalAppLauncherPage from '../../components/analysis/ExternalAppLauncherPage';
import { API_BASE_URL } from '../../config';
import { EXTERNAL_APP_MODE } from '../../utils/externalAppLaunch';

const INDEPENDENT_TANK_PROXY_PATH = '/external-apps/independent-tank';

export default function IndependentTankAssessment() {
  const independentTankBaseUrl = `${API_BASE_URL}${INDEPENDENT_TANK_PROXY_PATH}`;
  const independentTankHealthUrl = `${independentTankBaseUrl}/__wb_proxy_health`;

  return (
    <ExternalAppLauncherPage
      title="Independent Tank Assessment"
      subtitle="독립 탱크 구조 평가 도구"
      description="의장 단독형 탱크 구조 평가를 수행합니다."
      baseUrl={independentTankBaseUrl}
      healthUrl={independentTankHealthUrl}
      launchMode={EXTERNAL_APP_MODE.PROXY}
      // 외부 앱 프론트가 갱신돼도 이전 캐시본이 뜨지 않도록 실행할 때마다
      // 창의 캐시(HTTP 캐시·서비스워커·Cache Storage)를 비운다.
      clearCacheOnLaunch={true}
      cacheBustOnLaunch={true}
      status="Developing"
      contributor="김한별"
      icon={PenTool}
    />
  );
}
