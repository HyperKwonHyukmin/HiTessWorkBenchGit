import React from 'react';
import ExternalAppLauncherPage from '../../components/analysis/ExternalAppLauncherPage';
import { API_BASE_URL } from '../../config';
import { EXTERNAL_APP_MODE } from '../../utils/externalAppLaunch';

// 카탈로그 모드 → 돌아갈 목록 화면(Layout GROUP_MENU_BY_MODE 와 같다).
const BACK_MENU_BY_MODE = {
  File: 'File-Based Apps',
  Interactive: 'Interactive Apps',
  Parametric: 'Parametric Apps',
  Productivity: 'Productivity Apps',
};

/**
 * App Settings 에서 등록한 외부 앱의 공용 실행 페이지.
 * Block Weld 와 같은 프록시 방식(/external-apps/<slug> → IP:Port/<사번>)으로 연다.
 */
export default function RegisteredExternalApp({ app }) {
  const baseUrl = `${API_BASE_URL}${app.proxyPath}`;
  const backMenu = BACK_MENU_BY_MODE[app.mode] || 'Interactive Apps';

  return (
    <ExternalAppLauncherPage
      title={app.title}
      subtitle={app.category ? `${app.category} · 외부 앱` : '외부 앱'}
      description={app.description}
      baseUrl={baseUrl}
      healthUrl={`${baseUrl}/__wb_proxy_health`}
      launchMode={EXTERNAL_APP_MODE.PROXY}
      clearCacheOnLaunch={true}
      cacheBustOnLaunch={true}
      status={app.devStatus}
      contributor={app.contributor}
      icon={app.icon}
      windowKey={`registered:${app.slug}`}
      backMenu={backMenu}
    />
  );
}
