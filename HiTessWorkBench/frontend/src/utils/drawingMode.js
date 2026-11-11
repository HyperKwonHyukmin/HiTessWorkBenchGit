/**
 * Drawing to Analysis — 파일 이름으로 변환 엔진 모드를 고른다.
 * 백엔드 `routers/analysis.py _resolve_drawing_mode` + `services/drawing_book.support_engine_allowed_for_name` 의 사본 — 한쪽을 고치면 양쪽 다.
 *
 * 옛 Block Support 엔진은 도면을 읽지 않고 SU-145 값으로 모델을 만든다(2026-11-11 실측: SU-A1 도면도 '성공' + SU-145 와 같은 모델).
 * 그래서 이름에 'support' 가 있어도 SU-145 도면일 때만 support, 나머지는 새 러그 엔진(모르는 도면이면 '지원 안 함' 으로 끝난다).
 */

export const SUPPORT_ENGINE_CODES = ['SU-145'];

const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** 'SU-145'·'SU_145'·'su145' 가 이름에 있는가(뒤에 숫자가 더 붙은 SU-1450 등은 아님) */
export function supportEngineAllowedForName(name) {
  const key = nameKey(name);
  return SUPPORT_ENGINE_CODES.some((code) => new RegExp(`${nameKey(code)}(?!\\d)`).test(key));
}

/** 파일 이름(또는 카탈로그 파일 이름) → 'support' | 'lug' */
export function resolveDrawingMode(filename) {
  const s = String(filename || '').split(/[\\/]/).pop().toLowerCase();
  const looksSupport = s.includes('support') || s.startsWith('bs_') || s.startsWith('bs.') || s === 'bs';
  return looksSupport && supportEngineAllowedForName(s) ? 'support' : 'lug';
}
