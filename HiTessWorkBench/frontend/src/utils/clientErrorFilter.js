/**
 * 화면 오류 보고 필터 — 같은 오류가 반복되거나 의미 없는 브라우저 경고가 서버를 채우지 않게 한다.
 * seen 은 세션 동안 유지되는 Map(메시지 → 보낸 횟수).
 */

// 기능에 영향이 없는데 자주 뜨는 브라우저 메시지.
const IGNORED_PATTERNS = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
];

export const MAX_SAME_MESSAGE = 3;
export const MAX_PER_SESSION = 30;

export const shouldReportClientError = (seen, message) => {
  const text = String(message || '').trim();
  if (!text) return false;
  if (IGNORED_PATTERNS.some((rx) => rx.test(text))) return false;
  let total = 0;
  for (const count of seen.values()) total += count;
  if (total >= MAX_PER_SESSION) return false;
  const key = text.slice(0, 200);
  const count = seen.get(key) || 0;
  if (count >= MAX_SAME_MESSAGE) return false;
  seen.set(key, count + 1);
  return true;
};
