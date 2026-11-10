// 웹 뉴스레터 통계 화면 규칙(2026-11-10) — 백엔드 services/newsletter_stats.py 의 응답을 사람이 읽는 값으로.

export const SECTION_LABELS = {
  video: '1분 영상 재생',
  video_end: '1분 영상 끝까지',
  lead: '첫머리(가입자 소식)',
  story: 'HiTESS Story 영상',
  apps: '새로 쓸 수 있는 앱',
  manuals: 'Studio 사용 설명서',
  easier: '더 편해진 Workbench',
};

export const OUTCOME_LABELS = [
  ['signups', '신규 가입'],
  ['activeUsers', '접속한 사용자'],
  ['runs', '해석 실행'],
  ['videoPlays', 'Story 영상 재생'],
];

/** 0 으로 나누지 않는 비율(%) — 정수. */
export function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((100 * (part || 0)) / whole);
}

/** 초 → '1분 05초' / '42초'. */
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}분 ${String(s % 60).padStart(2, '0')}초` : `${s}초`;
}

/** 전후 비교 문구 — '+12 (+40%)' / '−3' / '변화 없음'. 전이 0 이면 % 를 쓰지 않는다. */
export function fmtDelta(before, after) {
  const b = before || 0;
  const a = after || 0;
  const d = a - b;
  if (d === 0) return '변화 없음';
  const sign = d > 0 ? '+' : '−';
  const rate = b > 0 ? ` (${sign}${Math.round((Math.abs(d) / b) * 100)}%)` : '';
  return `${sign}${Math.abs(d)}${rate}`;
}
