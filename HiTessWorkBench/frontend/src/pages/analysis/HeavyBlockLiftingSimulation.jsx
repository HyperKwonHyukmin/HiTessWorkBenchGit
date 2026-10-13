import React from 'react';
import { PenTool } from 'lucide-react';
import ExternalAppLauncherPage from '../../components/analysis/ExternalAppLauncherPage';
import { API_BASE_URL } from '../../config';
import { EXTERNAL_APP_MODE } from '../../utils/externalAppLaunch';

const HEAVY_BLOCK_LIFTING_PROXY_PATH = '/external-apps/heavy-block-lifting';

export default function HeavyBlockLiftingSimulation() {
  const heavyBlockLiftingBaseUrl = `${API_BASE_URL}${HEAVY_BLOCK_LIFTING_PROXY_PATH}`;
  const heavyBlockLiftingHealthUrl = `${heavyBlockLiftingBaseUrl}/__wb_proxy_health`;

  return (
    <ExternalAppLauncherPage
      title="Heavy Block Lifting Simulation"
      subtitle="소조블록 권상 러그 배치·구조강도 평가 도구"
      description="소조블록 권상 러그를 자동 배치하고 구조강도를 평가합니다."
      baseUrl={heavyBlockLiftingBaseUrl}
      healthUrl={heavyBlockLiftingHealthUrl}
      launchMode={EXTERNAL_APP_MODE.PROXY}
      // Block Weld 와 같은 이유로 실행할 때마다 외부 앱 창의 캐시를 비우고
      // 캐시버스트 파라미터를 붙인다(상류 프론트 갱신 후 구버전이 뜨는 것 방지).
      clearCacheOnLaunch={true}
      cacheBustOnLaunch={true}
      status="Active"
      contributor="김한별"
      icon={PenTool}
    />
  );
}
