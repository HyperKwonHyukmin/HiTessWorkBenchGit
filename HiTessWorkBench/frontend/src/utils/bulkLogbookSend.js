/**
 * 관리자 All Projects '여러 건 보내기' 규칙(순수 함수).
 * 계획: docs/plans/2026-11-06-all-projects-bulk-logbook-send.md
 *
 * 서버 미리 보기(`POST /api/admin/projects/logbook/plan`)의 항목 =
 *   { id, ok, reason, title, model, files:[{path,size}], totalBytes, hasWire, hasResult, warnings, olderRunOf? }
 *   hasWire=false = 구조 해석 전(검증만) 기록 — 원본 모델만 보낸다.
 * 보내기는 기록마다 기존 `POST /api/admin/projects/{id}/logbook` 를 차례로 부른다.
 */

/** 여러 건 보내기를 여는 App — 보낼 파일 규칙(Wire 세트·결과 세트)이 권상 해석 전용이다. 백엔드 LIFTING_PROGRAMS 와 같아야 한다 */
export const BULK_LIFTING_PROGRAMS = ['GroupModuleUnit', 'SidePassage'];

/** 한 번에 미리 보고 보낼 수 있는 기록 수 — 백엔드 MAX_BULK_PLAN 과 같아야 한다 */
export const MAX_BULK_SEND = 50;

export function isBulkLiftingProgram(program) {
  return BULK_LIFTING_PROGRAMS.includes(program);
}

/** 미리 보기 뒤 처음 체크할 기록 — 보낼 수 있고, 같은 모델의 옛 실행이 아닌 것 */
export function initialPlanChecks(items = []) {
  return new Set(items.filter(it => it.ok && !it.olderRunOf).map(it => it.id));
}

/**
 * 행 아래 '확인할 것' 한 줄 — 옛 실행 표시 + 서버 경고. 'Wire 모델 없음' 경고는 구성 칸('Wire 없음')과 겹쳐 뺀다.
 */
export function planNotes(it) {
  if (!it?.ok) return [];
  const notes = it.olderRunOf ? [`같은 모델의 옛 실행 · 최신 #${it.olderRunOf}`] : [];
  for (const w of it.warnings || []) {
    // 구성 칸이 이미 'Wire 없음' 을 말하는 행에서만 뺀다(서버 문구 admin_projects.bulk_plan_item 과 맞춤)
    if (it.hasWire === false && String(w).startsWith('Wire 모델 없음')) continue;
    notes.push(w);
  }
  return notes;
}

/** 미리 보기 표 위 한 줄 요약 */
export function summarizePlan(items = [], checked = new Set()) {
  let count = 0;
  let bytes = 0;
  let withResult = 0;
  let withoutWire = 0;
  for (const it of items) {
    if (!it.ok || !checked.has(it.id)) continue;
    count += 1;
    bytes += Number(it.totalBytes) || 0;
    if (it.hasResult) withResult += 1;
    if (it.hasWire === false) withoutWire += 1;
  }
  return { count, bytes, withResult, withoutWire, blocked: items.filter(it => !it.ok).length };
}

/** 보내기 결과 한 줄 — 서버 응답(data) 또는 오류(error). 상태: sent | duplicate | failed */
export function describeSendOutcome({ data, error } = {}) {
  if (error) {
    const detail = error?.response?.data?.detail;
    return { state: 'failed', text: typeof detail === 'string' ? detail : (error?.message || '보내지 못했습니다.') };
  }
  if (!data) return { state: 'failed', text: '응답이 없습니다.' };
  if (data.state === 'blocked') return { state: 'duplicate', text: '모든 파일이 이미 LogBook 에 있음' };
  const extra = [];
  if (data.blocked?.length) extra.push(`이미 있는 BDF ${data.blocked.length}개 제외`);
  if (data.rejected?.length) extra.push(`DRM 파일 ${data.rejected.length}개 제외`);
  return { state: 'sent', text: `${data.file_count ?? 0}개 파일 보냄${extra.length ? ` · ${extra.join(' · ')}` : ''}` };
}
