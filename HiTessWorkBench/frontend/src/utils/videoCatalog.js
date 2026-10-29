// HiTESS Story 영상 목록을 화면에 보일 모양으로 정리한다(2026-10-26).
// 서버 순서(videos.json 순서)를 지키면서 category 별로 묶는다 — 묶음 순서는 처음 나온 순서.

export const UNCATEGORIZED_LABEL = '기타 영상';

/** [{ category, ... }] → [{ label, videos: [...] }] */
export function groupVideos(videos) {
  const groups = [];
  const byLabel = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    const label = String(video?.category || '').trim() || UNCATEGORIZED_LABEL;
    let group = byLabel.get(label);
    if (!group) {
      group = { label, videos: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.videos.push(video);
  }
  // 분류 없는 영상은 맨 뒤로 — 분류가 하나도 없으면 묶음 1개라 순서 영향 없음
  const rest = groups.filter(g => g.label !== UNCATEGORIZED_LABEL);
  const other = groups.filter(g => g.label === UNCATEGORIZED_LABEL);
  return [...rest, ...other];
}

/** 초 → '1:00' · '6:17' · '1:02:05'. 모르면 ''. */
export function formatDuration(seconds) {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 묶음 전체 길이 → '약 4분' (1분 미만이면 '1분 미만', 모르면 ''). */
export function formatTotalMinutes(videos) {
  const total = (videos || []).reduce((sum, v) => sum + (Number(v?.durationSeconds) > 0 ? Number(v.durationSeconds) : 0), 0);
  if (total <= 0) return '';
  const minutes = Math.round(total / 60);
  return minutes < 1 ? '1분 미만' : `약 ${minutes}분`;
}
