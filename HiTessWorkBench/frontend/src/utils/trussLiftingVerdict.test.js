import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeTrussLiftingVerdict, summarizeTrussCases, trussCaseKey, SINGLE_CASE_KEY } from './trussLiftingVerdict.js'

const ok = (lc, extra = {}) => ({ trussAssessment: { ok: true, summary: { loadCases: [lc], skippedByProperty: [], ...extra }, elements: [
  { element: 1, assessment: 0.4, result: 'OK' }, { element: 2, assessment: 1.3, result: 'Fail' },
] } })

test('결과에 Truss 평가가 없으면 판정 없음', () => {
  assert.equal(computeTrussLiftingVerdict({}).level, null)
})

test('UC 초과 부재가 있으면 실패, 행은 UC 큰 순서', () => {
  const v = computeTrussLiftingVerdict(ok({ evaluatedElements: 2, failCount: 1, maxUc: 1.3, maxUcElement: 2, maxDisplacement: { nodeId: 9, magnitudeMm: 12.5 } }))
  assert.equal(v.level, 'fail')
  assert.equal(v.rows[0].element, 2)
  assert.equal(v.figures.maxDisplacementMm, 12.5)
  assert.match(v.summary, /최대 UC 1\.300 \(E2\)/)
})

test('초과가 없으면 통과, 빠진 부재가 있으면 검토 필요', () => {
  assert.equal(computeTrussLiftingVerdict(ok({ failCount: 0, maxUc: 0.8 })).level, 'pass')
  const v = computeTrussLiftingVerdict(ok({ failCount: 0, maxUc: 0.8 }, { skippedByProperty: [{ propertyId: 30, count: 4 }] }))
  assert.equal(v.level, 'review')
  assert.deepEqual(v.reasons, ['허용값 표에 없어 평가에서 빠진 부재 4개'])
})

test('평가를 못 했으면 검토 필요와 사유', () => {
  const v = computeTrussLiftingVerdict({ trussAssessment: { ok: false, error: '평가 exe 를 찾을 수 없습니다' } })
  assert.equal(v.level, 'review')
  assert.match(v.summary, /exe/)
})

test('소모듈 Case — 결과의 case 표식으로 자리를 가린다', () => {
  assert.equal(trussCaseKey({ result: { case: { id: 'm1ab', name: '소모듈 1' } } }), 'm1ab')
  assert.equal(trussCaseKey({ result: {} }), SINGLE_CASE_KEY)          // 표식 없는 예전 결과
  assert.equal(trussCaseKey({ ok: false, error: 'x' }), SINGLE_CASE_KEY)
})

test('소모듈 Case — 목록과 가장 나쁜 판정', () => {
  const pass = { ok: true, result: { case: { id: 'a', name: '선수 쪽' }, ...ok({ failCount: 0, maxUc: 0.5 }) } }
  const fail = { ok: true, result: { case: { id: 'b', name: '선미 쪽' }, ...ok({ failCount: 2, maxUc: 1.4 }) } }
  const none = { ok: true, result: { case: { id: 'c' } } }
  const s = summarizeTrussCases({ a: pass, b: fail, c: none })
  assert.deepEqual(s.rows.map(r => [r.key, r.name, r.level]), [['a', '선수 쪽', 'pass'], ['b', '선미 쪽', 'fail'], ['c', '소모듈 3', null]])
  assert.equal(s.worst, 'fail')
  assert.equal(summarizeTrussCases({ a: pass }).worst, 'pass')
  assert.deepEqual(summarizeTrussCases({}), { rows: [], worst: null })
  assert.equal(summarizeTrussCases({ [SINGLE_CASE_KEY]: { ok: true, result: ok({ failCount: 0 }) } }).rows[0].name, '소모듈')
})
