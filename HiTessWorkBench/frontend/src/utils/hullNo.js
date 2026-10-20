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
