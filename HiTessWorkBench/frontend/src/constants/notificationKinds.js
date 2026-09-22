/**
 * @fileoverview 알림 kind 어휘 — 마스터 §2.1 의 9종.
 *
 * `label` 은 설정 UI 문구, `group` 은 카테고리 헤더로 쓴다.
 * 백엔드 `notification_service.NOTIFICATION_KINDS` / `user_preferences_service`
 * 의 어휘와 문자열이 같아야 한다(다르면 PUT /api/preferences 가 422).
 * 알림 센터(Plan A)가 없는 환경에서도 설정은 저장되어야 하므로(spec D6)
 * 이 상수는 알림 센터 구현과 무관하게 존재한다.
 */

export const NOTIFICATION_KINDS = Object.freeze([
  { kind: 'job.completed',                  label: '해석 완료',           group: '해석' },
  { kind: 'job.failed',                     label: '해석 실패',           group: '해석' },
  { kind: 'job.cancelled',                  label: '해석 중단',           group: '해석' },
  { kind: 'batch.completed',                label: '배치 완료',           group: '해석' },
  // 'retention.expiring'(만료 임박)은 알림으로 보내지 않는다 — 남은 일수는 My Projects
  // 화면의 '7일 내 만료' 카드·배지로만 보여 준다(사용자 결정 2026-09-22).
  { kind: 'retention.expired',              label: '보관 만료',           group: '보관' },
  { kind: 'share.received',                 label: '공유 수신',           group: '협업' },
  { kind: 'notice.published',               label: '공지',                group: '기타' },
  { kind: 'feature_request.status_changed', label: '기능 요청 상태 변경', group: '기타' },
]);

export const NOTIFICATION_KIND_LOOKUP = Object.freeze(
  Object.fromEntries(NOTIFICATION_KINDS.map(k => [k.kind, k])),
);
