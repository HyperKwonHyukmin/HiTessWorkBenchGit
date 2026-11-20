/**
 * Truss Module Lifting 판정 (2026-11-17).
 *
 * 구조 해석 결과(Studio 가 돌려준 nastranResult JSON)의 trussAssessment 를 읽는다.
 * trussAssessment 는 백엔드가 소모듈 평가 exe(TrussModuleAssessment — 기존 TrussAssessment 와 같은 판정)를 돌려 넣은 값이다.
 *   - 부재 Fail(UC > 1)이 하나라도 있으면 '실패', 없으면 '통과'
 *   - 평가를 못 했으면(exe 없음, 실패) '검토 필요' — 구조 해석만 끝났고 판정이 없다는 뜻
 *   - 허용값 표에 없어 평가에서 빠진 부재가 있으면 '통과' 대신 '검토 필요'(빠진 부재는 판정되지 않았다)
 * 변위는 발생 값만 보인다(판정 없음, 계획 Q7).
 */
export function computeTrussLiftingVerdict(result) {
  const ta = result?.trussAssessment
  if (!ta) return { level: null }
  if (!ta.ok) {
    return { level: 'review', title: 'Truss 평가 없음', summary: ta.error || '소모듈 평가를 하지 못했습니다.', reasons: [], figures: null, rows: [] }
  }
  const lc = ta.summary?.loadCases?.[0] ?? {}
  const skipped = (ta.summary?.skippedByProperty ?? []).reduce((s, x) => s + (x.count ?? 0), 0)
  const fail = Number(lc.failCount ?? 0)
  const rows = [...(ta.elements ?? [])].sort((a, b) => (b.assessment ?? 0) - (a.assessment ?? 0))
  const reasons = []
  if (fail > 0) reasons.push(`UC 1.0 초과 부재 ${fail}개`)
  if (skipped > 0) reasons.push(`허용값 표에 없어 평가에서 빠진 부재 ${skipped}개`)
  const level = fail > 0 ? 'fail' : skipped > 0 ? 'review' : 'pass'
  return {
    level,
    title: level === 'fail' ? '실패' : level === 'review' ? '검토 필요' : '통과',
    summary: `부재 ${lc.evaluatedElements ?? rows.length}개 평가 · 최대 UC ${fmt(lc.maxUc, 3)}${lc.maxUcElement != null ? ` (E${lc.maxUcElement})` : ''}`,
    reasons,
    figures: {
      evaluated: lc.evaluatedElements ?? rows.length,
      failCount: fail,
      maxUc: lc.maxUc ?? null,
      maxUcElement: lc.maxUcElement ?? null,
      maxDisplacementMm: lc.maxDisplacement?.magnitudeMm ?? null,
      maxDisplacementNode: lc.maxDisplacement?.nodeId ?? null,
      skipped,
    },
    rows,
  }
}

/**
 * 소모듈 Case (2026-11-18) — Studio 가 소모듈 여러 개를 차례로 해석하면 완료 알림이 소모듈마다 온다.
 * 결과 JSON 의 case({ id, name }, 백엔드 unit_structural_service 가 넣음)로 어느 소모듈의 결과인지 가린다.
 * 표식이 없는 결과(소모듈 하나만 쓰던 예전 Studio)는 한 자리('_single')에 둔다.
 */
export const SINGLE_CASE_KEY = '_single'

export function trussCaseKey(payload) {
  const id = payload?.result?.case?.id
  return typeof id === 'string' && id ? id : SINGLE_CASE_KEY
}

const LEVEL_RANK = { fail: 3, review: 2, pass: 1 }

/**
 * 소모듈마다 받은 완료 알림({ [key]: payload }) → 목록과 가장 나쁜 판정.
 * @returns {{ rows: { key, name, level, title }[], worst: 'fail' | 'review' | 'pass' | null }}
 */
export function summarizeTrussCases(results) {
  const rows = Object.entries(results ?? {}).map(([key, payload], i) => {
    const v = computeTrussLiftingVerdict(payload?.result)
    return { key, name: payload?.result?.case?.name || (key === SINGLE_CASE_KEY ? '소모듈' : `소모듈 ${i + 1}`), level: v.level ?? null, title: v.title ?? '판정 없음' }
  })
  let worst = null
  for (const r of rows) if ((LEVEL_RANK[r.level] ?? 0) > (LEVEL_RANK[worst] ?? 0)) worst = r.level
  return { rows, worst }
}

function fmt(v, d) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(d) : '-'
}
