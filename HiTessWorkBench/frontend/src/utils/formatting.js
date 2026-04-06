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
