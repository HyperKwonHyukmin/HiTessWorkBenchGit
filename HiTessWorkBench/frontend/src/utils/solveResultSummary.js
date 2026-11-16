/**
 * Drawing to Analysis 해석 결과 요약 — 순수 함수.
 *
 * 결과 화면은 3,000~4,000 줄 표보다 '케이스마다 최대 응력이 얼마, 어디' 가 먼저다
 * (2026-11-16 사용자 지적: 결과 화면 가독성, 응력이 먼저 나오게).
 * subcases = F06 결과 JSON `analysisResults.subcases`(quadStresses, triaStresses, displacements).
 */

const finite = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/** 케이스마다 { subcaseId, maxVm, maxVmElem, maxU, maxUNode }. 값이 없으면 null. */
export function summarizeSubcases(subcases = []) {
  return subcases.map((sc) => {
    let maxVm = null; let maxVmElem = null;
    for (const s of [...(sc?.quadStresses || []), ...(sc?.triaStresses || [])]) {
      const v = finite(s.vonMises);
      if (v != null && (maxVm == null || v > maxVm)) { maxVm = v; maxVmElem = s.elementId; }
    }
    let maxU = null; let maxUNode = null;
    for (const d of sc?.displacements || []) {
      const u = Math.hypot(Number(d.t1) || 0, Number(d.t2) || 0, Number(d.t3) || 0);
      if (maxU == null || u > maxU) { maxU = u; maxUNode = d.pointId; }
    }
    return { subcaseId: sc?.subcaseId, maxVm, maxVmElem, maxU, maxUNode };
  });
}

/** 최대 응력이 가장 큰 케이스의 순번. 없으면 -1. */
export function governingCase(rows = []) {
  let best = -1;
  rows.forEach((r, i) => {
    if (r?.maxVm != null && (best < 0 || r.maxVm > rows[best].maxVm)) best = i;
  });
  return best;
}

/**
 * 러그 하중 케이스 이름. case = 엔진 요약의 케이스({ alpha_deg, beta_deg }), i = 순번.
 * 케이스 정보가 없으면 SUBCASE 번호로.
 */
export function lugCaseLabel(c, i, subcaseId) {
  if (!c) return `SUBCASE ${subcaseId ?? i + 1}`;
  const a = Number(c.alpha_deg) || 0;
  const b = Number(c.beta_deg) || 0;
  const parts = [];
  if (a) parts.push(`면내 ${a}°`);
  if (b) parts.push(`면외 ${b}°`);
  const zero = /axial/i.test(c.id || '') ? '축방향' : /vertical/i.test(c.id || '') ? '수직' : '0°';
  return `LC${i + 1} ${parts.length ? parts.join(' ') : zero}`;
}
