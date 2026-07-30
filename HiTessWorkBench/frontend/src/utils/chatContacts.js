/**
 * 채팅 도크 목록 화면용 순수 함수 모음.
 *
 * 서버의 두 응답을 화면 구조로 합친다:
 *  - contacts: 대화 가능한 활성 관리자 전원 + 접속 상태 (GET /api/chat/contacts)
 *  - threads : 내가 관여한 대화 이력 (GET /api/chat/threads)
 *
 * 관리자 행이 곧 대화 행이므로 같은 상대가 두 섹션에 중복되지 않는다. contacts 조회가
 * 실패해 빈 배열이 들어와도 threads 만으로 목록이 성립해야 한다(기존 대화가 사라지면 안 됨).
 */

/** 정렬 우선순위 — 지금 응답 가능한 사람이 위로. */
const STATUS_ORDER = { online: 0, idle: 1, offline: 2 };

const STATUS_LABELS = { online: '온라인', idle: '자리비움', offline: '오프라인' };

/** 상태 라벨(한국어). 알 수 없는 값은 아무것도 표시하지 않는다. */
export function statusLabel(status) {
  return STATUS_LABELS[status] || '';
}

/** 상태 점 색상 클래스. 색만으로 정보를 전달하지 않으므로 항상 라벨과 함께 쓴다. */
export function statusDotClass(status) {
  if (status === 'online') return 'bg-emerald-500';
  if (status === 'idle') return 'bg-amber-400';
  return 'bg-slate-300';
}

/** 'HH:MM' 로컬 시각. 빈 값·잘못된 값은 빈 문자열. */
export function formatChatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * 미읽음 있음 → online → idle → offline → 이름순.
 * 답장을 기다리는 대화가 접속 상태 때문에 목록 아래로 묻히지 않게 한다.
 */
export function sortRoster(rows) {
  return [...rows].sort((a, b) => {
    const unreadDiff = (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0);
    if (unreadDiff !== 0) return unreadDiff;
    const statusDiff = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
    if (statusDiff !== 0) return statusDiff;
    return String(a.name || a.other_id).localeCompare(String(b.name || b.other_id), 'ko');
  });
}

/** 목록 화면의 두 섹션(관리자 로스터 / 기타 대화)을 만든다. */
export function buildChatSections(contacts = [], threads = []) {
  const threadById = new Map((threads || []).map((t) => [t.other_id, t]));

  const roster = sortRoster(
    (contacts || []).map((c) => {
      const t = threadById.get(c.employee_id);
      return {
        other_id: c.employee_id,
        name: c.name || c.employee_id,
        department: c.department || '',
        status: c.status || 'offline',
        last_message: t?.last_message || '',
        last_at: t?.last_at || null,
        unread: t?.unread || 0,
      };
    }),
  );

  const rosterIds = new Set(roster.map((r) => r.other_id));
  // threads 는 서버가 최신순으로 정렬해 주므로 순서를 그대로 유지한다.
  const others = (threads || [])
    .filter((t) => !rosterIds.has(t.other_id))
    .map((t) => ({
      other_id: t.other_id,
      name: t.other_name || t.other_id,
      department: '',
      status: null, // 상태 출처는 contacts 뿐 → 점·라벨을 생략하라는 신호
      last_message: t.last_message || '',
      last_at: t.last_at || null,
      unread: t.unread || 0,
    }));

  return { roster, others };
}
