// 공지 조회 통계 화면 규칙 — 웹 뉴스레터(2026-11-10)와 업데이트 안내(2026-11-12) 패널이 같이 쓴다.
// 2026-11-12 사용자 결정: '얼마나 읽었는지'(읽은 깊이·머문 시간·구획 도달)는 화면에서 뺐다. 핵심 = 몇 번·몇 명이 봤나, 그 뒤 사용이 늘었나.

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

/** 업데이트 안내의 대상 App 사용자 가운데 본 사람 — '3 / 12명 (25%)'. 대상이 0 이면 'App 사용자 없음'. */
export function fmtReach(effect) {
  if (!effect) return '';
  if (typeof effect.targetUsers !== 'number') return '-';   // 옛 서버 응답(명단 이전 모양)
  if (!effect.targetUsers) return 'App 사용자 없음';
  return `${effect.viewedTargets} / ${effect.targetUsers}명 (${pct(effect.viewedTargets, effect.targetUsers)}%)`;
}

/** 안 본 대상 사용자의 메일 — Outlook 숨은 참조에 붙일 '; ' 연결. 주소가 없는 사람은 names 로 따로. */
export function unseenMailList(targets) {
  const unseen = (targets || []).filter(t => !t.seenDay);
  const ok = unseen.filter(t => /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(String(t.email || '').trim()));
  return {
    text: ok.map(t => t.email.trim()).join('; '),
    count: ok.length,
    missing: unseen.filter(t => !ok.includes(t)).map(t => t.name),
  };
}

/** App 사용자 명단을 그릴 수 있는지 — 옛 서버는 targets 가 없다(새 exe + 옛 서버에서 화면 전체가 죽던 결함, 2026-11-12). */
export function hasTargetList(effect) {
  return Array.isArray(effect?.targets);
}
