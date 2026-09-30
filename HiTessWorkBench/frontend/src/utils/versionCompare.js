/**
 * 'x.y.z' 버전 비교 — 앱 업데이트 안내 판정용.
 *
 * 예전에는 서버 버전과 '같지 않으면' 업데이트를 요구해서, 새 exe 를 서버 반영보다 먼저
 * 배포하면 더 새로운 클라이언트(1.5.15)에 옛 버전(1.5.14)으로 '업데이트' 하라며 앱을 막았다.
 * 이제는 서버가 더 높을 때만 안내한다.
 */

const parts = (version) => String(version ?? '')
  .trim()
  .replace(/^v/i, '')
  .split(/[.-]/)
  .slice(0, 3)
  .map(p => Number.parseInt(p, 10));

/** a > b 이면 양수, 같으면 0, 작으면 음수. 숫자가 아닌 조각은 비교할 수 없어 null. */
export function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  if (pa.length === 0 || pb.length === 0 || [...pa, ...pb].some(Number.isNaN)) return null;
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 서버 버전이 클라이언트보다 높을 때만 true.
 * 형식을 해석할 수 없으면 예전 동작(다르면 안내)을 따른다 — 안전하게 업데이트 쪽으로.
 */
export function isServerVersionNewer(serverVersion, clientVersion) {
  if (!serverVersion) return false;
  const cmp = compareVersions(serverVersion, clientVersion);
  if (cmp === null) return serverVersion !== clientVersion;
  return cmp > 0;
}
