/**
 * 3D 단면 계획(04c §2) — 어떤 1D 요소를 어떤 단면 InstancedMesh 에 넣을지 정한다. 순수 함수.
 *
 * 묶음(bucket) = 같은 PID · 같은 카드 · 같은 단면(sectionKey). 대부분 PID 하나에 묶음 하나다.
 * PID 묶음의 카드 범위(modelGeometry beamRanges) 안에 단면을 못 만드는 요소가 하나라도 있으면
 * 그 범위는 통째로 선으로 남긴다(범위 단위로 선을 숨기므로 부분 숨김을 하지 않는다).
 *
 * @returns {{
 *   buckets: Array<{ pid, card, section, profile, rows: Int32Array, elems: Int32Array }>,
 *   ranges: Map<pid, Array<{ sectioned: boolean, type: string }>>,  // beamRanges 와 같은 순서
 *   beams: number,   // 단면으로 그릴 1D 수
 * }}
 */
import { sectionKey, sectionOf, sectionProfile } from './sectionProfile.js';

export function planSections({ header, blocks }, geometry) {
  const props = header.properties || {};
  const conrods = header.conrods || {};
  const buckets = new Map();
  const ranges = new Map();
  let beams = 0;
  const profiles = new Map();
  const profileOf = (sec) => {
    const k = sectionKey(sec);
    if (!profiles.has(k)) profiles.set(k, sectionProfile(sec.type, sec.dims));
    return profiles.get(k);
  };

  for (const g of geometry.groups) {
    const out = [];
    for (const r of g.beamRanges || []) {
      const from = r.start / 2;
      const to = from + r.count / 2;
      const perElement = r.card === 'CONROD';
      const fixed = perElement ? null : sectionOf(props[g.pid], r.card, null);
      const fixedProfile = fixed ? profileOf(fixed) : null;
      // 1차: 범위 전체가 단면을 갖는지
      let ok = perElement || !!fixedProfile;
      const secs = perElement ? new Array(to - from) : null;
      if (perElement) {
        for (let k = from; k < to && ok; k += 1) {
          const row = geometry.elemRow[g.beamElem[k]];
          const s = sectionOf(null, 'CONROD', conrods[blocks.beams[row * 4]]);
          if (!s || !profileOf(s)) ok = false; else secs[k - from] = s;
        }
      }
      out.push({ sectioned: ok, type: ok ? (fixed || secs[0]).type : 'LINE' });
      if (!ok) continue;
      // 2차: 묶음에 넣는다
      for (let k = from; k < to; k += 1) {
        const sec = fixed || secs[k - from];
        const key = `${g.pid}|${r.card}|${sectionKey(sec)}`;
        let b = buckets.get(key);
        if (!b) {
          b = { pid: g.pid, card: r.card, section: sec, profile: profileOf(sec), rows: [], elems: [] };
          buckets.set(key, b);
        }
        const e = g.beamElem[k];
        b.elems.push(e);
        b.rows.push(geometry.elemRow[e]);
        beams += 1;
      }
    }
    ranges.set(g.pid, out);
  }
  return {
    buckets: [...buckets.values()].map((b) => ({ ...b, rows: Int32Array.from(b.rows), elems: Int32Array.from(b.elems) })),
    ranges,
    beams,
  };
}
