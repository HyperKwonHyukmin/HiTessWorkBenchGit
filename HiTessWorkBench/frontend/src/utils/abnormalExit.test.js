import test from 'node:test'
import assert from 'node:assert/strict'
import { abnormalExitText, findExitCode, isAbnormalExit } from './abnormalExit.js'

test('엔진 로그의 [Exit code: N] 를 읽는다', () => {
  const log = 'Wrote x.json\r\nCounts: nodes=3187\r\n\n[Exit code: 3221225477]\n[Error] nastran_bridge exit code 3221225477. stderr:\n'
  assert.equal(findExitCode(log), 3221225477)
})

test('Studio 편집 적용 문구의 exit=N 도 읽는다', () => {
  assert.equal(findExitCode('Studio 편집 적용 실패 (exit=3221225477). _edited.json 을 BDF 로 변환할 수 없습니다.'), 3221225477)
})

test('음수로 온 같은 코드도 비정상 종료로 본다', () => {
  assert.equal(isAbnormalExit(-1073741819), true)
})

test('보통 실패 코드(1·2·65)는 비정상 종료가 아니다', () => {
  for (const c of [1, 2, 65, 255]) assert.equal(isAbnormalExit(c), false)
  assert.equal(abnormalExitText('[Exit code: 1]'), null)
  assert.equal(abnormalExitText(''), null)
  assert.equal(abnormalExitText(null), null)
})

test('접근 위반이면 원인을 실행 환경으로 말한다', () => {
  const t = abnormalExitText('[Exit code: 3221225477]', 'BDF 검증 프로그램')
  assert.match(t, /BDF 검증 프로그램이 비정상 종료/)
  assert.match(t, /접근 위반 0xC0000005/)
  assert.match(t, /실행 환경 문제/)
})
