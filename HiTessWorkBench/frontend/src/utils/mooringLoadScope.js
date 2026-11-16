/**
 * Mooring Fitting 해석할 하중 범위 — 백엔드 LOAD_SCOPES 와 엔진 build-full --loads 의 사본(2026-11-12 현업 요청).
 *   all   = MF + Winch (예전 동작)
 *   mf    = MF 하중만. Load CSV 없이 실행할 수 있다(백엔드가 빈 Load CSV 를 둔다).
 *   winch = Winch 하중만(Winch Seat). 구조 CSV 의 MF 행은 쓰지 않는다.
 */

export const LOAD_SCOPES = [
  { id: 'all', label: '전체', detail: 'MF 하중과 Winch 하중을 함께 해석합니다.' },
  { id: 'mf', label: 'MF 만', detail: 'Winch 하중은 넣지 않습니다. Load CSV 없이 실행할 수 있습니다.' },
  { id: 'winch', label: 'Winch 만', detail: 'Winch Seat 만 봅니다. 구조 CSV 의 MF 행은 쓰지 않습니다.' },
]

export const normalizeLoadScope = (v) => (LOAD_SCOPES.some(s => s.id === v) ? v : 'all')

export const loadScopeLabel = (v) => ({ all: 'MF + Winch', mf: 'MF 만', winch: 'Winch 만' })[normalizeLoadScope(v)]

/** Load CSV 가 꼭 있어야 하는가 — MF 만 해석할 때만 생략할 수 있다. */
export const needsLoadCsv = (scope) => normalizeLoadScope(scope) !== 'mf'

/** 실행 버튼을 열 수 있는가. 열 수 없으면 사유 문장, 열 수 있으면 null. */
export function missingInputReason({ structureFile, loadFile, scope }) {
  if (!structureFile && needsLoadCsv(scope) && !loadFile) return 'Structure CSV 와 Load CSV 를 올리면 열립니다.'
  if (!structureFile) return 'Structure CSV 를 올리면 열립니다.'
  if (needsLoadCsv(scope) && !loadFile) {
    return normalizeLoadScope(scope) === 'winch'
      ? 'Winch 하중이 든 Load CSV 를 올리면 열립니다.'
      : 'Load CSV 를 올리면 열립니다. MF 하중만 볼 때는 위에서 MF 만을 고르세요.'
  }
  return null
}
