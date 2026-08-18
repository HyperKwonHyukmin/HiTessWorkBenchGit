/**
 * 해석 이력 행에 '리포트 생성 가능 여부'를 붙이는 순수 함수.
 *
 * 백엔드 capabilities 는 program_id 키인데 이력 행은 program_name(표시명)을 가진다.
 * 표시명으로 매칭하고, 못 찾으면 범용 서식으로 생성 가능하다고 본다
 * (백엔드 generic 경로가 어떤 App 이든 받아 주기 때문).
 */

const COMPLETED = new Set(['success', 'completed', '완료']);

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
    return {
      ...row,
      hasTemplate: Boolean(entry && entry.hasTemplate),
      reportable: completed,
      blockedReason: completed ? null : '완료된 해석만 리포트를 만들 수 있습니다.',
    };
  });
}
