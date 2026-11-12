// 엔진 healthMetrics.issues 의 값 하나를 개수로 읽는다.
// Model Builder 엔진(Cmb.Cli)은 issues 값을 숫자로 주는데(freeEndNodes·orphanNodes·shortElements·unresolvedUbolts·disconnectedGroups),
// 화면은 목록으로 보고 `.length` 를 읽어 편집 뒤 판정에서 늘 0 이 됐다(2026-11-12 커밋 전 리뷰 — 엔진이 미해결 U-bolt 를
// 처음으로 실제 수로 보고하면서 드러남). 옛 형식(목록)도 받는다.

/**
 * @param {...unknown} candidates 앞에서부터 처음으로 개수로 읽히는 값을 쓴다.
 * @returns {number|undefined}
 */
export function issueCount(...candidates) {
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.length;
  }
  return undefined;
}
