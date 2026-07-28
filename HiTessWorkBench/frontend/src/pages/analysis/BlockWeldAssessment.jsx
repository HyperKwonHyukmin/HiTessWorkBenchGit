import React from 'react';
import { PenTool } from 'lucide-react';
import ExternalAppLauncherPage from '../../components/analysis/ExternalAppLauncherPage';
import { API_BASE_URL } from '../../config';
import { EXTERNAL_APP_MODE } from '../../utils/externalAppLaunch';

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
      launchMode={EXTERNAL_APP_MODE.PROXY}
      // 실행할 때마다 외부 앱 창의 캐시(HTTP 캐시·서비스워커·Cache Storage)를 비우고
      // 캐시버스트 파라미터를 붙인다. 이렇게 하지 않으면 상류(upstream) Block Weld
      // 프론트가 갱신돼도 이전에 캐시된 구버전이 새 창에 그대로 떠버린다.
      clearCacheOnLaunch={true}
      cacheBustOnLaunch={true}
      status="Active"
      contributor="김한별"
      icon={PenTool}
    />
  );
}
