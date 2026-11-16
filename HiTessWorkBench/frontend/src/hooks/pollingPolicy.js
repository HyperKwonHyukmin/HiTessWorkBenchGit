export const POLLING_POLICY = {
  analysisIntervalMs: 1500,
  analysisMaxRetries: 120,
  longAnalysisMaxRetries: 240,
  // Job Center(GlobalJobPoller) — 페이지 조회보다 짧으면 안 된다. 넘으면 작업을 실패로 덮고 그 실패가
  // 페이지 저장 상태로 전해져 페이지 조회까지 멈춘다(2026-11-16, 3분 → 4분 변환 실패). 30분 = 가장 긴 서버 제한(1800초).
  globalJobMaxRetries: 1200,
  systemIntervalMs: 3000,
  externalAppIntervalMs: 20000,
  // 알림 센터(헤더 종 아이콘). presence 45초·chat 5초 사이 — 서버가 남긴 통지는 30초면 충분하다.
  notificationsIntervalMs: 30000,
  // 환경설정 서버 저장(부분 PUT)의 디바운스와, 오프라인 상태에서의 재시도 주기.
  preferencesDebounceMs: 500,
  preferencesRetryMs: 30000,
};
