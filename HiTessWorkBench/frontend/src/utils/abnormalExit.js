/**
 * 외부 프로그램이 Windows 예외로 죽었는지 엔진 로그·작업 메시지에서 읽는다(2026-11-10).
 * ⚠ 파이썬 bridge 자식에만 쓴다. C# 엔진에 그대로 붙이지 말 것 — .NET 예외(0xE0434352)·exit(-1) 도 이 범위라
 *   입력 탓 실패를 환경 문제로 안내하게 된다(백엔드 app/services/exit_codes.py 머리말과 같은 주의).
 *
 * 종료 코드가 0xC0000000 이상(예: 3221225477 = 0xC0000005 접근 위반)이면 입력 모델 탓이 아니라 실행 환경 문제다 —
 * 이 PC 에서는 회사 DRM 모듈이 파이썬을 끊은 일이 있었다. 그런데 화면은 'BDF 형식을 확인하세요' 로 안내했다.
 * 백엔드 사본: `app/services/exit_codes.py`(문구를 바꾸면 양쪽 다).
 */
const KNOWN = {
  0xC0000005: '접근 위반',
  0xC00000FD: '스택 넘침',
  0xC0000409: '버퍼 검사 실패',
  0xC0000135: '필요한 DLL 없음',
  0xC0000142: 'DLL 초기화 실패',
}

/** 글에서 종료 코드를 찾는다 — `[Exit code: N]` · `exit=N` · `exit code N`. 없으면 null. */
export function findExitCode(text) {
  if (!text) return null
  const m = String(text).match(/exit(?:\s*code)?\s*[:=]?\s*(-?\d{3,})/i)
  return m ? Number(m[1]) : null
}

export function isAbnormalExit(code) {
  if (code == null || !Number.isFinite(code)) return false
  return (code >>> 0) >= 0xC0000000
}

/** 비정상 종료면 사용자에게 보일 한 문장, 아니면 null. what = 무엇을 하다 죽었는지. */
export function abnormalExitText(text, what = '검증 프로그램') {
  const code = findExitCode(text)
  if (!isAbnormalExit(code)) return null
  const u = code >>> 0
  const kind = KNOWN[u] ?? '예외'
  return `${what}이 비정상 종료했습니다(Windows ${kind} 0x${u.toString(16).toUpperCase().padStart(8, '0')}). `
    + '입력 모델 문제가 아니라 실행 환경 문제일 가능성이 큽니다 — 다시 시도하고, 계속되면 관리자에게 알려 주세요.'
}
