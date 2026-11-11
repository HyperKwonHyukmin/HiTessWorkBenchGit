/**
 * 새 러그 엔진(LugShell) '하중 값 고치기' — 입력칸 초깃값·검사·서버로 보낼 고친 값 계산.
 *
 * 범위는 백엔드 drawing_to_analysis_service.LUGSHELL_EDIT_LIMITS 와 같아야 한다(서버가 다시 검사한다).
 * 핀 지름은 0 < pin_d < 구멍 지름(엔진 검사기 check_lug 와 같은 규칙).
 */
export const LUGSHELL_EDIT_LIMITS = {
  swl_t: [0.1, 2000],
  daf: [1, 5],
  alpha_deg: [-90, 90],
  beta_deg: [-90, 90],
};

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** 요약(result_info.lugshell)에서 입력칸 초깃값. 케이스마다 각도, SWL·DAF 는 첫 케이스 값(엔진은 모든 케이스에 같은 값을 쓴다). */
export function initialLugshellForm(summary) {
  const cases = Array.isArray(summary?.cases) ? summary.cases : [];
  const first = cases[0] || {};
  return {
    swl_t: str(first.swl_t ?? summary?.swl_t),
    daf: str(first.daf),
    pin_d: str(summary?.pin_d),
    cases: cases.map((c) => ({ id: c.id, alpha_deg: str(c.alpha_deg), beta_deg: str(c.beta_deg) })),
  };
}

const parse = (s) => {
  const t = String(s ?? '').trim();
  if (t === '') return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** 칸별 오류 문구. 키 = 'swl_t' | 'daf' | 'pin_d' | `${caseId}.alpha_deg` … 오류가 없으면 빈 객체. */
export function validateLugshellForm(form, holeD) {
  const errs = {};
  const range = (key, value, errKey = key) => {
    const v = parse(value);
    const [lo, hi] = LUGSHELL_EDIT_LIMITS[key];
    if (Number.isNaN(v)) errs[errKey] = '숫자를 넣으세요';
    else if (v < lo || v > hi) errs[errKey] = `${lo}~${hi}`;
  };
  range('swl_t', form?.swl_t);
  range('daf', form?.daf);
  const pin = parse(form?.pin_d);
  if (Number.isNaN(pin)) errs.pin_d = '숫자를 넣으세요';
  else if (!(pin > 0) || (Number.isFinite(holeD) && pin >= holeD)) errs.pin_d = `0 < 핀 지름 < 구멍 Ø${holeD}`;
  for (const c of form?.cases || []) {
    range('alpha_deg', c.alpha_deg, `${c.id}.alpha_deg`);
    range('beta_deg', c.beta_deg, `${c.id}.beta_deg`);
  }
  return errs;
}

/**
 * 3D 하중 화살표 — 케이스마다 방향(단위벡터)·크기(N)·라벨. 엔진 lugshell/loads.py 와 같은 식:
 *   F̂ = (sinα·cosβ, sinβ, cosα·cosβ),  P = SWL × 1000 × g × DAF
 * form 을 주면 입력 중인 값(다시 만들기 전)으로 계산한다 — 각도를 넣자마자 화살표가 움직이게.
 * 숫자가 아닌 칸이 있으면 그 케이스는 뺀다. 핀 중심이 없으면(옛 서버 요약) 빈 목록.
 */
export function lugshellLoadArrows(summary, form = null) {
  const center = summary?.pin_center;
  if (!Array.isArray(center) || center.length !== 3) return [];
  const f = form || initialLugshellForm(summary);
  const swl = parse(f.swl_t);
  const daf = parse(f.daf);
  const g = Number(summary?.g) || 9.81;
  const base = initialLugshellForm(summary);
  const out = [];
  (f.cases || []).forEach((c, i) => {
    const al = parse(c.alpha_deg);
    const be = parse(c.beta_deg);
    if ([al, be, swl, daf].some(Number.isNaN)) return;
    const a = (al * Math.PI) / 180;
    const b = (be * Math.PI) / 180;
    const b0 = base.cases.find((x) => x.id === c.id);
    const edited = !b0 || !same(b0.alpha_deg, c.alpha_deg) || !same(b0.beta_deg, c.beta_deg)
      || !same(base.swl_t, f.swl_t) || !same(base.daf, f.daf);
    out.push({
      id: c.id,
      index: i,
      dir: [Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)],
      magN: swl * 1000 * g * daf,
      label: `LC${i + 1} · ${Math.round((swl * g * daf)).toLocaleString()} kN${al ? ` · 면내 ${al}°` : ''}${be ? ` · 면외 ${be}°` : ''}`,
      // 3D 라벨용 짧은 글 — 크기는 케이스마다 같아 왼쪽 칸(SWL)에만 둔다
      tag: `LC${i + 1}${al ? ` 면내 ${al}°` : ''}${be ? ` 면외 ${be}°` : ''}`,
      edited,
    });
  });
  return out;
}

const same = (a, b) => Math.abs(parse(a) - parse(b)) < 1e-9;

/** 서버로 보낼 고친 값만 모은다. 바뀐 것이 없으면 null. */
export function diffLugshellEdits(summary, form) {
  const base = initialLugshellForm(summary);
  const edits = {};
  for (const key of ['swl_t', 'daf', 'pin_d']) {
    if (!same(base[key], form[key])) edits[key] = parse(form[key]);
  }
  const cases = [];
  for (const c of form.cases || []) {
    const b = base.cases.find((x) => x.id === c.id);
    if (!b) continue;
    const row = { id: c.id };
    if (!same(b.alpha_deg, c.alpha_deg)) row.alpha_deg = parse(c.alpha_deg);
    if (!same(b.beta_deg, c.beta_deg)) row.beta_deg = parse(c.beta_deg);
    if (Object.keys(row).length > 1) cases.push(row);
  }
  if (cases.length) edits.cases = cases;
  return Object.keys(edits).length ? edits : null;
}
