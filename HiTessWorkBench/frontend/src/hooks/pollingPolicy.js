export const POLLING_POLICY = {
  analysisIntervalMs: 1500,
  analysisMaxRetries: 120,
  longAnalysisMaxRetries: 240,
  systemIntervalMs: 3000,
  externalAppIntervalMs: 20000,
  // 알림 센터(헤더 종 아이콘). presence 45초·chat 5초 사이 — 서버가 남긴 통지는 30초면 충분하다.
  notificationsIntervalMs: 30000,
  // 환경설정 서버 저장(부분 PUT)의 디바운스와, 오프라인 상태에서의 재시도 주기.
  preferencesDebounceMs: 500,
  preferencesRetryMs: 30000,
};
