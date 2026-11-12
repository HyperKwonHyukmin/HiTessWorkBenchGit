// 단체 메일용 주소 목록 — User Management '메일 주소 복사' 버튼.
// 승인된(is_active) 사용자만, 주소는 대소문자 무시로 한 번만, Outlook 숨은 참조(BCC) 칸에 붙도록 '; ' 로 잇는다.
// 주소가 없거나 모양이 틀린 승인 사용자는 따로 돌려줘 화면이 알린다(PLM 미등록·협력사 계정 등).

// 백엔드 routers/users.py _MANUAL_EMAIL_PATTERN 과 같은 규칙 — 한쪽을 고치면 양쪽 다.
const EMAIL_PATTERN = /^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$/;

export function isValidEmail(value) {
  return EMAIL_PATTERN.test(String(value || '').trim());
}

// '메일 없음' 필터 — 승인 사용자 중 쓸 수 있는 주소가 없는 사람(단체 메일에서 빠지는 사람).
export function needsManualEmail(user) {
  return Boolean(user && user.is_active && !isValidEmail(user.email));
}

export function buildActiveMailList(users) {
  const seen = new Set();
  const addresses = [];
  const missing = [];
  let duplicates = 0;

  for (const user of users || []) {
    if (!user || !user.is_active) continue;
    const email = String(user.email || '').trim();
    if (!EMAIL_PATTERN.test(email)) {
      missing.push(user);
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    addresses.push(email);
  }

  return {
    text: addresses.join('; '),
    count: addresses.length,
    missing,
    duplicates,
  };
}

// '메일 한 번에 넣기' 창 — 칸에 적은 값({id: 문자열})을 저장할 것·틀린 것·빈 칸으로 나눈다.
// 빈 칸은 건너뛴다(못 찾은 사람은 비워 두고 아는 사람만 저장).
export function planBulkEmail(users, inputs) {
  const toSave = [];
  const invalidIds = [];
  let empty = 0;
  for (const user of users || []) {
    const value = String((inputs || {})[user.id] || '').trim();
    if (!value) { empty += 1; continue; }
    if (!isValidEmail(value)) { invalidIds.push(user.id); continue; }
    toSave.push({ id: user.id, email: value });
  }
  return { toSave, invalidIds, empty };
}

// 주소록에서 찾기 쉽게 — 이름·사번·부서를 탭으로 이은 줄(엑셀·메모장에 붙여도 칸이 맞음).
export function missingRosterText(users) {
  return (users || [])
    .map((u) => [u.name || '', u.employee_id || '', u.company || '', u.department || '', u.position || ''].join('\t'))
    .join('\n');
}

// 토스트용 짧은 이름 목록 — 앞의 몇 명만 보이고 나머지는 '외 N명'.
export function describeMissing(missing, limit = 5) {
  const names = (missing || []).map((u) => u.name || u.employee_id || '?');
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} 외 ${names.length - limit}명`;
}

// 'App 사용자' 필터 — 서버 rows([{program_name, employee_id}])를 App 한 줄(options 의 keys)별 사번 집합으로 묶는다.
// 한 App 이 내부 키를 여러 개 쓰면(예: HiTESS Model Builder) 그 키들의 사용자를 합친다. 사번은 대문자로 비교한다.
export function buildProgramUserSets(rows, options) {
  const byKey = new Map();
  for (const r of rows || []) {
    const key = r && r.program_name;
    const eid = String((r && r.employee_id) || '').trim().toUpperCase();
    if (!key || !eid) continue;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(eid);
  }
  const out = new Map();
  for (const opt of options || []) {
    const set = new Set();
    for (const k of opt.keys || []) for (const eid of byKey.get(k) || []) set.add(eid);
    out.set(opt.value, set);
  }
  return out;
}
