import React from 'react';
import { PenTool } from 'lucide-react';
import ExternalAppLauncherPage from '../../components/analysis/ExternalAppLauncherPage';
import { EXTERNAL_APP_MODE } from '../../utils/externalAppLaunch';

const HEAVY_BLOCK_LIFTING_BASE_URL = 'http://10.14.42.114:31860';

export default function HeavyBlockLiftingSimulation() {
  return (
    <ExternalAppLauncherPage
      title="Heavy Block Lifting Simulation"
      subtitle="중량물 블록 권상 자세 안정성 검토 도구"
      description="중량물 블록의 권상 과정에서 자세 안정성을 사전에 예측·검증 합니다."
      baseUrl={HEAVY_BLOCK_LIFTING_BASE_URL}
      launchMode={EXTERNAL_APP_MODE.RAW}
      status="Developing"
      contributor="김한별"
      icon={PenTool}
    />
  );
}
