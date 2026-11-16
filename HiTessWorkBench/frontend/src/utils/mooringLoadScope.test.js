import test from 'node:test'
import assert from 'node:assert/strict'
import { loadScopeLabel, missingInputReason, needsLoadCsv, normalizeLoadScope } from './mooringLoadScope.js'

test('범위 값 정리 — 모르는 값은 전체', () => {
  assert.equal(normalizeLoadScope('winch'), 'winch')
  assert.equal(normalizeLoadScope(undefined), 'all')
  assert.equal(normalizeLoadScope('both'), 'all')
  assert.equal(loadScopeLabel('mf'), 'MF 만')
})

test('Load CSV 는 MF 만일 때만 생략', () => {
  assert.equal(needsLoadCsv('all'), true)
  assert.equal(needsLoadCsv('winch'), true)
  assert.equal(needsLoadCsv('mf'), false)
})

test('실행 버튼 사유', () => {
  const s = { name: 's.csv' }, l = { name: 'l.csv' }
  assert.equal(missingInputReason({ structureFile: s, loadFile: null, scope: 'mf' }), null)
  assert.equal(missingInputReason({ structureFile: s, loadFile: l, scope: 'all' }), null)
  assert.match(missingInputReason({ structureFile: s, loadFile: null, scope: 'winch' }), /Winch/)
  assert.match(missingInputReason({ structureFile: s, loadFile: null, scope: 'all' }), /MF 만/)
  assert.match(missingInputReason({ structureFile: null, loadFile: l, scope: 'all' }), /Structure CSV 를/)
})
