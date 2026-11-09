// 단체 메일용 주소 목록 — User Management '메일 주소 복사' 버튼.
// 승인된(is_active) 사용자만, 주소는 대소문자 무시로 한 번만, Outlook 숨은 참조(BCC) 칸에 붙도록 '; ' 로 잇는다.
// 주소가 없거나 모양이 틀린 승인 사용자는 따로 돌려줘 화면이 알린다(PLM 미등록·협력사 계정 등).

const EMAIL_PATTERN = /^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$/;

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

// 토스트용 짧은 이름 목록 — 앞의 몇 명만 보이고 나머지는 '외 N명'.
export function describeMissing(missing, limit = 5) {
  const names = (missing || []).map((u) => u.name || u.employee_id || '?');
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} 외 ${names.length - limit}명`;
}
