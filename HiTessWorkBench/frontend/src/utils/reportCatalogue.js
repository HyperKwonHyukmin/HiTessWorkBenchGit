/**
 * 해석 이력 행에 '리포트 생성 가능 여부'를 붙이는 순수 함수.
 *
 * 백엔드 capabilities 는 program_id 키인데 이력 행은 program_name(표시명)을 가진다.
 * 표시명·별칭으로 매칭하고, 못 찾으면 **생성 불가**로 본다.
 *
 * ⚠️ 예전에는 완료 여부만 보고 전부 생성 가능으로 표시했다. 그래서 모델 생성 App
 *    (HiTessModelBuilder 등)까지 목록에 떠서 '해석 결과' 시트가 빈 계산서가 나왔고,
 *    미등록 App 도 아무 검토 없이 통과했다. 대상 여부는 백엔드가 선언한다.
 */

const COMPLETED = new Set(['success', 'completed', '완료']);

const UNREGISTERED_REASON = '등록되지 않은 App 이라 계산서를 만들 수 없습니다.';
const NOT_A_TARGET_REASON = '이 App 은 계산서 대상이 아닙니다.';

export function decorateHistoryForReport(rows, capabilities) {
  if (!Array.isArray(rows)) return [];
  const caps = capabilities || {};
  // 표시명 하나로만 맞추면 별칭으로 저장된 App(예: 'Jib Rest Assessment (1단)')이 빗나간다.
  const byName = new Map();
  for (const entry of Object.values(caps)) {
    if (!entry) continue;
    for (const name of [entry.displayName, ...(entry.aliases || [])]) {
      if (name && !byName.has(name)) byName.set(name, entry);
    }
  }

  return rows.map((row) => {
    const entry = byName.get(row.program_name) || null;
    const completed = COMPLETED.has(String(row.status || '').toLowerCase());
    const supported = Boolean(entry && entry.reportable);

    // 사유가 겹치면 사용자가 직접 손쓸 수 있는 쪽(재실행)을 먼저 보여 준다.
    let blockedReason = null;
    if (!completed) blockedReason = '완료된 해석만 리포트를 만들 수 있습니다.';
    else if (!entry) blockedReason = UNREGISTERED_REASON;
    else if (!supported) blockedReason = entry.reason || NOT_A_TARGET_REASON;

    return {
      ...row,
      hasTemplate: Boolean(entry && entry.hasTemplate),
      reportScope: entry ? entry.scope || null : null,
      reportable: completed && supported,
      blockedReason,
    };
  });
}
