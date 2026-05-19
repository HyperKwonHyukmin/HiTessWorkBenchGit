// HP-SCR 배관해석 전용 BDF 카드 파서.
// FemScanner JSON 이 채우지 못하는 SPC / CBUSH / FORCE / TEMP 카드를 BDF 원본에서 보강한다.

/**
 * BDF 토큰화 — 콤마/공백을 모두 구분자로, 주석/빈줄 제외.
 */
export function tokenizeBdfLines(bdfText) {
  if (!bdfText) return [];
  return bdfText.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('$'))
    .map(l => l.split(/[\s,]+/).filter(Boolean));
}

/**
 * BDF 텍스트에서 SPC / SPC* / SPC1 / SPC1* 카드를 파싱한다.
 * 반환: [{ nodeId, dof, value }, ...]
 */
export function parseSpcCardsFromBdf(bdfText) {
  const out = [];
  for (const tokens of tokenizeBdfLines(bdfText)) {
    const head = tokens[0].toUpperCase();
    if (head === 'SPC' || head === 'SPC*') {
      if (tokens.length < 4) continue;
      const gid = parseInt(tokens[2], 10);
      const dof = String(tokens[3] ?? '').replace(/[^0-9]/g, '');
      const val = parseFloat(tokens[4] ?? '0');
      if (!isFinite(gid) || !dof) continue;
      out.push({ nodeId: gid, dof, value: isFinite(val) ? val : 0 });
    } else if (head === 'SPC1' || head === 'SPC1*') {
      if (tokens.length < 3) continue;
      const dof = String(tokens[2] ?? '').replace(/[^0-9]/g, '');
      if (!dof) continue;
      for (let i = 3; i < tokens.length; i++) {
        const t = tokens[i].toUpperCase();
        if (t === 'THRU') break;
        const gid = parseInt(tokens[i], 10);
        if (isFinite(gid)) out.push({ nodeId: gid, dof, value: 0 });
      }
    }
  }
  return out;
}

/**
 * CBUSH / CBUSH* 카드 파싱.
 * 반환: [{ id, nodeIds:[GA,GB], cardType:'CBUSH' }, ...] — modelData.elements 와 호환
 * 형식: CBUSH EID PID GA GB ...
 */
export function parseCbushFromBdf(bdfText) {
  const out = [];
  for (const tokens of tokenizeBdfLines(bdfText)) {
    const head = tokens[0].toUpperCase();
    if (head !== 'CBUSH' && head !== 'CBUSH*') continue;
    if (tokens.length < 5) continue;
    const eid = parseInt(tokens[1], 10);
    const ga  = parseInt(tokens[3], 10);
    const gb  = parseInt(tokens[4], 10);
    if (!isFinite(ga) || !isFinite(gb)) continue;
    out.push({ id: isFinite(eid) ? eid : undefined, nodeIds: [ga, gb], cardType: 'CBUSH' });
  }
  return out;
}

/**
 * FORCE 카드 파싱 — 노드별 벡터를 SID 무관하게 누적합산.
 * 형식: FORCE SID G CID F N1 N2 N3 → 결과 = F * (N1, N2, N3)
 * 반환: [{ nodeId, fx, fy, fz, mag }, ...]
 */
export function parseForcesFromBdf(bdfText) {
  const acc = new Map();
  for (const tokens of tokenizeBdfLines(bdfText)) {
    if (tokens[0].toUpperCase() !== 'FORCE') continue;
    if (tokens.length < 8) continue;
    const gid = parseInt(tokens[2], 10);
    const f   = parseFloat(tokens[4]);
    const n1  = parseFloat(tokens[5]);
    const n2  = parseFloat(tokens[6]);
    const n3  = parseFloat(tokens[7]);
    if (!isFinite(gid) || !isFinite(f)) continue;
    const fx = f * (isFinite(n1) ? n1 : 0);
    const fy = f * (isFinite(n2) ? n2 : 0);
    const fz = f * (isFinite(n3) ? n3 : 0);
    const cur = acc.get(gid) || { fx: 0, fy: 0, fz: 0 };
    cur.fx += fx; cur.fy += fy; cur.fz += fz;
    acc.set(gid, cur);
  }
  const out = [];
  acc.forEach((v, nodeId) => {
    const mag = Math.sqrt(v.fx * v.fx + v.fy * v.fy + v.fz * v.fz);
    if (mag > 0) out.push({ nodeId, fx: v.fx, fy: v.fy, fz: v.fz, mag });
  });
  return out;
}

/**
 * TEMP 카드 파싱 — 노드별 온도값. (TEMPD/TEMPRB 등은 미지원)
 * 형식: TEMP SID G T (한 카드에 G,T 쌍 여러 개 가능)
 */
export function parseTempsFromBdf(bdfText) {
  const map = new Map();
  for (const tokens of tokenizeBdfLines(bdfText)) {
    if (tokens[0].toUpperCase() !== 'TEMP') continue;
    for (let i = 2; i + 1 < tokens.length; i += 2) {
      const gid = parseInt(tokens[i], 10);
      const t   = parseFloat(tokens[i + 1]);
      if (isFinite(gid) && isFinite(t)) map.set(gid, t);
    }
  }
  const out = [];
  map.forEach((T, nodeId) => out.push({ nodeId, T }));
  return out;
}

/**
 * HP-SCR 결과 프로젝트에서 BdfModelViewer 가 사용할 modelData 를 빌드한다.
 * - JSON_ModelInfo: FemScanner 의 grids/elements
 * - BDF 본문: SPC / CBUSH / FORCE 보강 (FemScanner 미수집 정보)
 *
 * @param {string} modelJsonText - JSON_ModelInfo 파일 본문
 * @param {string} bdfText - BDF 본문 (없으면 보강 생략)
 * @returns {object | null} BdfModelViewer 에 그대로 전달 가능한 modelData
 */
export function buildHpScrModelData(modelJsonText, bdfText) {
  let parsed;
  try {
    parsed = JSON.parse(modelJsonText);
  } catch {
    return null;
  }
  if (!parsed?.grids || !parsed?.elements) return null;

  if (bdfText) {
    const spcs   = parseSpcCardsFromBdf(bdfText);
    const cbushs = parseCbushFromBdf(bdfText);
    const forces = parseForcesFromBdf(bdfText);
    if (spcs.length > 0) parsed.boundaryConditions = spcs;
    if (cbushs.length > 0) {
      const existing = new Set(
        (parsed.elements || [])
          .filter(e => e.cardType === 'CBUSH')
          .map(e => e.id)
      );
      const additions = cbushs.filter(c => !existing.has(c.id));
      if (additions.length > 0) {
        parsed.elements = [...(parsed.elements || []), ...additions];
      }
    }
    if (forces.length > 0) parsed.forces = forces;
  }
  return parsed;
}
