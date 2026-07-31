/**
 * Job Center(우측 하단 작업 센터) 목록 규칙 — 순수 함수 모음.
 *
 * 보관 정책:
 *  - App 당 최신 해석 1개만 남긴다. 같은 App 에서 새 해석을 시작하면 이전 기록을 교체한다.
 *  - 완료된 해석은 완료 시점부터 30분 뒤 만료된다. 실행 중인 해석은 만료되지 않는다.
 *  - 그 밖에는 사용자가 휴지통으로 지우거나 앱을 재시작할 때만 사라진다.
 *
 * ⚠ menu 값은 호출측(DashboardContext)에서 getAppMenuName() 으로 정규화한 뒤 넘긴다.
 *   여기서는 이미 정규화된 문자열로 보고 단순 비교만 한다(카탈로그 의존성 차단).
 */

/** 목록에 담아 둘 최대 개수. App 당 1개이므로 사실상 동시 사용 App 수 상한이다. */
export const GLOBAL_JOB_HISTORY_LIMIT = 10;

/** 완료된 해석을 목록에 남겨 두는 시간(30분). */
export const GLOBAL_JOB_VISIBLE_MS = 30 * 60 * 1000;

const TERMINAL_JOB_STATUSES = new Set(['Success', 'Failed', 'Interrupted']);

/** 더 이상 진행되지 않는 상태인지. 만료 타이머는 이 시점부터 돈다. */
export function isTerminalJobStatus(status) {
  return TERMINAL_JOB_STATUSES.has(status);
}

/**
 * 새 해석을 목록 맨 앞에 넣는다. 같은 App(menu)의 이전 해석은 제거해 App 당 1개를 지킨다.
 * 같은 jobId 로 다시 들어오면 갱신으로 취급한다(중복 누적 방지).
 */
export function upsertGlobalJob(jobs, nextJob, limit = GLOBAL_JOB_HISTORY_LIMIT) {
  const prev = Array.isArray(jobs) ? jobs : [];
  return [
    nextJob,
    ...prev.filter((job) => job.menu !== nextJob.menu && job.jobId !== nextJob.jobId),
  ].slice(0, limit);
}

/**
 * 해당 App 의 해석을 찾는다.
 *
 * 페이지는 '가장 최근 해석'이 아니라 '자기 App 의 해석'을 봐야 한다. 예전에는 목록의 첫
 * 항목만 참조해서, Model Builder 실행 중 Module Unit 을 돌리면 Model Builder 로 돌아가도
 * 진행 상태가 복원되지 않았다.
 */
export function findJobForMenu(jobs, menuName) {
  if (!Array.isArray(jobs) || !menuName) return null;
  return jobs.find((job) => job.menu === menuName) || null;
}

/**
 * 해당 App 의 해석만 목록에서 뺀다(페이지 '초기화' 버튼용).
 *
 * 메뉴명이 비어 있으면 아무것도 지우지 않는다 — 페이지 하나를 초기화하려다 다른 App 의
 * 진행 중인 해석까지 날리는 사고를 막기 위한 안전장치다.
 */
export function removeJobsForMenu(jobs, menuName) {
  if (!Array.isArray(jobs)) return [];
  if (!menuName) return jobs;
  const next = jobs.filter((job) => job.menu !== menuName);
  return next.length === jobs.length ? jobs : next;
}

/**
 * 만료된 해석을 걷어낸다. expiresAt 이 없는 해석(=실행 중)은 대상이 아니다.
 * 지울 것이 없으면 원본 배열을 그대로 반환해 불필요한 리렌더를 막는다.
 */
export function pruneExpiredJobs(jobs, now) {
  if (!Array.isArray(jobs)) return [];
  const next = jobs.filter((job) => !job.expiresAt || now < job.expiresAt);
  return next.length === jobs.length ? jobs : next;
}
