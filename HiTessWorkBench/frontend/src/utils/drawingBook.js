/**
 * 치공구표준집 찾기 — 검색·거르기·상태 글자 (계획 docs/plans/2026-11-11-drawing-catalogue-search.md 2단계).
 * 색인은 백엔드 GET /api/analysis/drawing-to-analysis/book (DrawingBook/book_index.json).
 */

/** 러그 고르기 도우미 — 계열과 화면 설명. 용도 글자는 도면집 7쪽 표(색인 lugUsage)를 쓰고, 표에 없는 계열만 여기서 이름을 붙인다. */
export const LUG_FAMILIES = [
  { id: 'L', label: 'L형', hint: 'LAPPING 취부' },
  { id: 'D', label: 'D형', hint: '수직 LIFTING · T/O 보조' },
  { id: 'D-R', label: 'D형 곡가공', hint: '곡부 D형' },
  { id: 'T', label: 'T형', hint: 'T/O 전용' },
  { id: 'TD', label: 'TD형', hint: 'T/O' },
  { id: 'A', label: 'A형', hint: 'T/O 전용(곡부)' },
  { id: 'B', label: 'B형', hint: 'STIFF SIDE 취부' },
  { id: 'E', label: 'E형', hint: '' },
  { id: 'BKT', label: '보강 BKT · D/PLATE', hint: '러그 보강 부재' },
];

// 한글로 찾는 사람을 위한 낱말 → 색인 글자
const SYNONYMS = [
  [/러그/g, 'LUG'],
  [/샤클/g, 'SHACKLE'],
  [/브라켓|브래킷/g, 'BRAKET BRACKET'],
  [/타워/g, 'TOWER'],
  [/빔/g, 'BEAM'],
  [/서포트/g, 'SUPPORT'],
  [/피스/g, 'PIECE'],
  [/잭/g, 'JACK'],
];

/** 기호 비교용: 대문자·공백/하이픈/점 제거 ('D 50' · 'd-50' · 'D50' → 'D50') */
export const codeKey = (s) => String(s || '').toUpperCase().replace(/[\s\-_.·]/g, '');

const textKey = (s) => {
  let t = String(s || '');
  for (const [re, rep] of SYNONYMS) t = t.replace(re, ` ${rep} `);
  return t.toUpperCase();
};

/** 검색어 하나가 항목에 맞는가 — 기호(별칭 포함, 앞부분 일치) 또는 명칭·묶음 글자(포함) */
export function matchesQuery(item, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  const ck = codeKey(q);
  if (ck && (item.aliases || []).some((a) => codeKey(a).startsWith(ck))) return true;
  if (ck && codeKey(item.code).includes(ck)) return true;
  const words = textKey(q).split(/\s+/).filter(Boolean);
  const hay = textKey(`${item.name} ${item.groupLabel} ${item.code} ${item.usage || ''}`);
  return words.length > 0 && words.every((w) => hay.includes(w));
}

/**
 * 거르기. filters = { query, group, family, swl, convertibleOnly }
 * 정렬은 도면집 쪽 순서(같은 묶음끼리 모이고 사용자가 책에서 보던 순서).
 */
export function filterBookItems(items, filters = {}) {
  const { query = '', group = '', family = '', swl = null, convertibleOnly = false } = filters;
  return (items || [])
    .filter((i) => !group || i.group === group)
    .filter((i) => !family || i.family === family)
    .filter((i) => swl == null || i.swl_t === swl)
    .filter((i) => !convertibleOnly || i.convertible)
    .filter((i) => matchesQuery(i, query))
    .sort((a, b) => a.bookPage - b.bookPage);
}

/** 도우미 하중 칩 — 그 계열에 있는 하중(t)만, 작은 순 */
export function swlOptions(items, family) {
  const set = new Set((items || []).filter((i) => i.family === family && i.swl_t != null).map((i) => i.swl_t));
  return [...set].sort((a, b) => a - b);
}

/** 묶음별 개수 — 칩 옆 숫자 */
export function groupCounts(items) {
  const m = {};
  for (const i of items || []) m[i.group] = (m[i.group] || 0) + 1;
  return m;
}

/**
 * 상태 — 화면 글자와 버튼 가능 여부.
 *   ready     바로 변환 (엔진 템플릿이 이 도면을 읽음)
 *   drawing   도면만 (변환은 시도할 수 있지만 '지원 안 함' 으로 끝날 수 있음)
 *   excluded  해석 대상 아님 (반목·샤클) — 변환 버튼 없음
 */
export function bookItemState(item) {
  if (!item?.analysable) return { id: 'excluded', label: '해석 대상 아님', canRun: false };
  if (item.convertible) return { id: 'ready', label: '바로 변환', canRun: true };
  return { id: 'drawing', label: '도면만', canRun: true };
}
