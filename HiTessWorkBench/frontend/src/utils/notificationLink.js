/**
 * 알림 센터 순수 유틸 — 부수효과 없음(node --test 로 검증).
 * 링크 해석·목록 병합·kind 표시 메타·상대 시각.
 */

export const NOTIFICATION_LIST_CAP = 100;

// kind 어휘는 백엔드 notification_service.NOTIFICATION_KINDS 와 같다.
// tone 은 ToastContext 의 type(success/error/warning/info) 또는 neutral.
const KIND_META = {
  'job.completed': { label: '해석 완료', tone: 'success' },
  'job.failed': { label: '해석 실패', tone: 'error' },
  'job.cancelled': { label: '해석 중단', tone: 'warning' },
  'retention.expired': { label: '보관 만료', tone: 'neutral' },
  'batch.completed': { label: '배치 완료', tone: 'success' },
  'share.received': { label: '공유', tone: 'info' },
  'feature_request.status_changed': { label: '기능 요청', tone: 'info' },
  'notice.published': { label: '공지', tone: 'info' },
};

export function notificationKindMeta(kind) {
  return KIND_META[kind] || { label: '알림', tone: 'info' };
}

/** ToastContext 의 type 으로 변환(neutral 은 info). */
export function toastToneFor(kind) {
  const { tone } = notificationKindMeta(kind);
  return tone === 'neutral' ? 'info' : tone;
}

/**
 * 서버 link({menu, params}) → {menu, params, analysisId|null}. 이동 불가면 null.
 * analysisId 는 My Projects 상세 모달 자동 오픈에 쓴다.
 */
export function resolveNotificationTarget(link) {
  if (!link || typeof link !== 'object') return null;
  const menu = typeof link.menu === 'string' ? link.menu.trim() : '';
  if (!menu) return null;
  const params = link.params && typeof link.params === 'object' ? link.params : {};
  const raw = Number(params.analysis_id);
  const analysisId = Number.isInteger(raw) && raw > 0 ? raw : null;
  return { menu, params, analysisId };
}

/** 델타 병합: fresh 가 prev 를 덮고, id 내림차순, 중복 제거, cap 건. */
export function mergeNotifications(prev, fresh, cap = NOTIFICATION_LIST_CAP) {
  const byId = new Map();
  for (const item of [...(fresh || []), ...(prev || [])]) {
    if (!item || !Number.isInteger(item.id)) continue;
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, cap);
}

/** ISO 시각 → '방금 | n분 전 | n시간 전 | n일 전 | M/D'. 파싱 실패는 ''. */
export function formatNotificationTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const minutes = Math.floor(Math.max(0, now - t) / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
