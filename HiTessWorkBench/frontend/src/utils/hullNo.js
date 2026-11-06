/**
 * 호선 번호 — Model Builder 가 BDF 첫 줄 주석(`$ HiTessModelBuilder: HullNo=3454`)으로 남긴다.
 * 입력은 선택이고, 비우면 CSV 파일명 앞 4자리를 쓴다(백엔드도 같은 규칙으로 다시 계산한다).
 *
 * 규칙 원본은 백엔드 `app/services/hull_no.py` 다. 한쪽을 고치면 양쪽 다 고칠 것.
 */

const FILENAME_HULL_RE = /^(\d{4})(?=[-_ .]|$)/;
export const HULL_NO_MAX_LENGTH = 20;

/** 입력칸 값 정리 — 영문·숫자·'-'·'_' 만 남기고 대문자, 20자까지. BDF 주석 한 줄에 그대로 들어간다. */
export function sanitizeHullInput(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, HULL_NO_MAX_LENGTH);
}

/** 파일명 앞 4자리 숫자를 호선으로 제안한다('3454-35020-struData-….csv' → '3454'). 없으면 null. */
export function suggestHullNoFromFilename(name) {
  if (!name) return null;
  const base = String(name).split(/[\\/]/).pop().trim();
  const match = base.match(FILENAME_HULL_RE);
  return match ? match[1] : null;
}

/** 여러 파일명 중 처음으로 제안이 나오는 값(구조 → 배관 → 장비 순으로 넘긴다). */
export function suggestHullNo(names) {
  for (const name of names || []) {
    const hull = suggestHullNoFromFilename(name);
    if (hull) return hull;
  }
  return null;
}

/** 호선 확인 창 문구(2026-11-06 사용자 요청) — 실행 전에 호선이 없으면 한 번 묻는다. */
export const HULL_PROMPT_TITLE = '호선 정보를 입력해 주세요';
export const HULL_PROMPT_MESSAGE =
  '파일명에서 호선을 찾지 못했습니다. 호선 정보가 있으면 나중에 Unit 권상에서 호선으로 이 모델을 찾아 참조로 활용할 수 있습니다.';

/**
 * 실행 전에 호선 확인 창을 띄울지 — 적은 값도 파일명 제안도 없고, 이 입력으로 '호선 없이 진행' 을 고른 적이 없을 때.
 * inputKey = 입력 파일 이름 묶음(같은 입력으로 다시 실행할 때 또 묻지 않게).
 */
export function needsHullPrompt({ hullNo, hullSuggestion, inputKey, skippedKey }) {
  if (sanitizeHullInput(hullNo) || hullSuggestion) return false;
  return !(inputKey && skippedKey === inputKey);
}

/** BDF 를 넣는 화면(GMU 권상)용 문구 — 호선은 Model Builder 주석 → 파일명 순으로 찾는다. */
export const HULL_PROMPT_MESSAGE_BDF =
  'BDF 의 호선 주석과 파일명에서 호선을 찾지 못했습니다. 호선 정보가 있으면 나중에 Unit 권상에서 호선으로 이 모델을 찾아 참조로 활용할 수 있습니다.';

// 백엔드 app/services/hull_no.py HULL_NO_COMMENT_RE 와 같은 규칙
const BDF_HULL_COMMENT_RE = /^\s*\$\s*HiTessModelBuilder:\s*.*?\bHullNo\s*=\s*(\S+)/im;

/** BDF 앞부분 글에서 Model Builder 호선 주석('$ HiTessModelBuilder: HullNo=3454')을 읽는다. 없거나 형식이 틀리면 null. */
export function readHullNoFromBdfText(text) {
  const match = String(text ?? '').match(BDF_HULL_COMMENT_RE);
  if (!match) return null;
  const hull = sanitizeHullInput(match[1]);
  return hull && hull === String(match[1]).toUpperCase() ? hull : null;
}
