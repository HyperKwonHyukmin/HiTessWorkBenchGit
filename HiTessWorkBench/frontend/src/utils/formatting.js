/**
 * 공용 포매팅 유틸리티
 */

/**
 * 공학 표기 포매팅 - 큰/작은 수는 지수 표기, 일반 수는 소수점 2자리
 * @param {number|null|undefined} val
 * @returns {string}
 */
export function formatEngineering(val) {
  if (val === undefined || val === null) return '';
  if (typeof val !== 'number' || isNaN(val)) return '';
  const abs = Math.abs(val);
  if (abs >= 10000 || (abs > 0 && abs < 0.001)) return val.toExponential(2);
  return Number.isInteger(val) ? val.toString() : val.toFixed(2);
}

/**
 * 고정 소수점 포매팅 (null/undefined → '-')
 * @param {number|null|undefined} v
 * @param {number} [digits=2]
 * @returns {string}
 */
export function formatFixed(v, digits = 2) {
  return v != null ? Number(v).toFixed(digits) : '-';
}

/**
 * 날짜 포매팅
 * @param {string|Date} date
 * @param {object} [options] - Intl.DateTimeFormat 옵션
 * @returns {string}
 */
export function formatDate(date, options = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!date) return '';
  return new Date(date).toLocaleDateString(undefined, options);
}

/**
 * 날짜 + 시간 포매팅 (ko-KR 기본).
 * UserRequests / MyProjects 등에서 사용하던 `new Date(x).toLocaleString()` 패턴을 통합.
 *
 * @param {string|Date} date
 * @param {string} [locale='ko-KR']
 * @returns {string}
 */
export function formatDateTime(date, locale = 'ko-KR') {
  if (!date) return '';
  return new Date(date).toLocaleString(locale);
}

/**
 * 시간만 포매팅 (ko-KR 기본). 로그 시간 표시 등에 사용.
 * useAnalysisJob 훅의 addLog 내부에서 이미 사용 중이지만 페이지에서도 동일 포맷으로 통일.
 *
 * @param {string|Date} [date=new Date()]
 * @param {string} [locale='ko-KR']
 * @returns {string}
 */
export function formatTime(date = new Date(), locale = 'ko-KR') {
  return new Date(date).toLocaleTimeString(locale);
}
