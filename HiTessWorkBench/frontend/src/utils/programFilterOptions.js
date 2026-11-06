/**
 * App 필터 목록 — 서버의 program_name(내부 키) 목록을 사람이 읽는 'App 한 줄' 목록으로 바꾼다.
 * 한 App 이 내부 키를 여러 개 쓰면(예: HiTESS Model Builder = HiTessModelBuilder·AmToModelBuilder…)
 * 한 줄로 합치고 keys 에 모두 담는다 → 화면은 keys 로 서버에 묻는다(programFilterParams).
 * 분류(category)별로 묶고, 분류·제목 순으로 정렬한다. 카탈로그에 없는 키는 '기타' 로 자기 이름 그대로.
 *
 * @param {string[]} programs 서버가 준 내부 키 목록
 * @param {(key: string) => ({ title?: string, category?: string } | undefined)} findApp
 * @returns {{ value: string, label: string, group: string, keys: string[] }[]}
 */
export function buildProgramFilterOptions(programs = [], findApp = () => undefined) {
  const byValue = new Map();
  for (const key of programs) {
    if (!key) continue;
    const app = findApp(key);
    // App 이 있으면 'app:<제목>' 으로 묶고, 없으면 내부 키 자체가 한 줄이다
    const value = app?.title ? `app:${app.title}` : key;
    if (!byValue.has(value)) {
      byValue.set(value, { value, label: app?.title || key, group: app?.category || '기타', keys: [] });
    }
    const row = byValue.get(value);
    if (!row.keys.includes(key)) row.keys.push(key);
  }
  const rows = [...byValue.values()];
  for (const r of rows) r.keys.sort();

  const groupOrder = [...new Set(rows.map(r => r.group))]
    // '기타' 는 맨 뒤로, 나머지는 가나다순
    .sort((a, b) => (a === '기타') - (b === '기타') || a.localeCompare(b, 'ko'));

  return rows.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group)
    || a.label.localeCompare(b.label, 'ko'));
}

/**
 * 고른 App 줄 → 목록 API 조건. 키가 하나면 예전과 같은 program_name(옛 서버도 동작),
 * 여러 개면 program_names('|' 구분, 서버 2026-11-06 이후).
 * @param {{ keys: string[] } | undefined} option
 */
export function programFilterParams(option) {
  const keys = option?.keys || [];
  if (keys.length === 0) return {};
  if (keys.length === 1) return { program_name: keys[0] };
  return { program_names: keys.join('|') };
}
