// Model Builder 검증 표시(엔진 00_Review.json, 2026-11-12) — 엔진이 사용자 대신 정한 것 중 사람이 승인할 것.
// 같은 상태가 최종 BDF 머리 주석 `$ HiTessModelBuilder: Review=REQUIRED Items=N` 에도 있어,
// 받는 곳(권상 검증, LogBook 보내기)은 백엔드 bdf_deck_check 가 그 주석을 읽어 경고한다(문구 뜻을 같게 둘 것).
// 계획: docs/plans/2026-11-12-modelbuilder-engine-overhaul-plan.md 6단계 '검토 흐름과 검증 표시'.

const KIND_LABELS = {
  auto_rbe_assembly: '추정 연결',
  auto_rbe: '추정 연결',
  group_translate: '그룹 통째 이동',
  point_mass_moved: '질량점 옮김',
  point_mass_unattached: '질량점 부착 실패',
  equipment_mass_dropped: '빠진 장비 질량',
  equipment_box_attached: '경계 상자로 붙인 장비',
  point_mass_lost: '모델에서 빠진 질량점',
  ubolt_unsupported: '받칠 구조 없는 U-bolt',
  floating_group: '떨어진 그룹',
  small_group_removed: '지운 작은 외딴 그룹',
  pipe_rest: 'U-bolt 없는 배관 받침',
};

export function reviewKindLabel(kind) {
  return KIND_LABELS[kind] ?? kind ?? '기타';
}

/**
 * 00_Review.json → 아직 사람이 볼 것이 남았으면 {status, count, byKind:[{label,count}]}, 없으면 null.
 * status: 'required'(엔진이 쓴 그대로, 단위 state = pending) | 'manual'(Studio 검토에서 손으로 고칠 것이 남음).
 * none·done 이거나 파일이 없으면(옛 엔진) null.
 */
export function pendingReview(review) {
  if (!review || typeof review !== 'object') return null;
  const status = String(review.status ?? '').toLowerCase();
  if (status !== 'required' && status !== 'manual') return null;
  const want = status === 'manual' ? 'manual' : 'pending';
  const units = Array.isArray(review.units) ? review.units.filter(u => (u?.state ?? 'pending') === want) : null;
  const count = units ? units.length : Number(review.unitCount) || 0;
  if (count <= 0) return null;
  const tally = new Map();
  for (const u of units ?? []) {
    const label = reviewKindLabel(u?.kind);
    tally.set(label, (tally.get(label) ?? 0) + 1);
  }
  const byKind = [...tally.entries()]
    .map(([label, n]) => ({ label, count: n }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { status, count, byKind };
}

/** 판정 사유 한 줄. 종류는 많은 순 3개까지. */
export function reviewReasonText(pending) {
  if (!pending) return '';
  const kinds = pending.byKind.slice(0, 3).map(k => `${k.label} ${k.count.toLocaleString()}`).join(', ');
  const more = pending.byKind.length > 3 ? ' 외' : '';
  const what = kinds ? ` (${kinds}${more})` : '';
  if (pending.status === 'manual') {
    return `Studio 검토에서 손으로 고칠 것 ${pending.count.toLocaleString()}건이 남았습니다${what}.`;
  }
  return `검증 필요 ${pending.count.toLocaleString()}건 — 엔진이 대신 정한 것을 아직 사람이 확인하지 않았습니다${what}. `
    + 'Studio 에서 확인하세요.';
}

/** BDF 받기 칸 위 안내. 받기는 막지 않는다(사용자 결정 2026-11-12). */
export function reviewDownloadNote(pending) {
  if (!pending) return '';
  return `이 BDF 머리에 '검증 필요 ${pending.count.toLocaleString()}건' 표시가 남아 있어, 권상 검증과 LogBook 보내기에서 `
    + '검증 안 된 모델로 경고가 뜹니다. 받기와 전달은 그대로 됩니다.';
}

/** BDF 머리 표시({status:'REQUIRED'|'MANUAL', items}, 백엔드 bdf_deck_check.read_mb_review_marker) 설명 한 줄. */
export function mbReviewFileText(marker) {
  if (!marker) return '';
  const n = Number(marker.items) || 0;
  if (String(marker.status).toUpperCase() === 'MANUAL') {
    return `Model Builder 검토에서 손으로 고칠 것 ${n}건이 남은 모델입니다`;
  }
  return `검증 안 된 Model Builder 모델 — 엔진이 대신 정한 것 ${n}건을 사람이 아직 확인하지 않았습니다`;
}
